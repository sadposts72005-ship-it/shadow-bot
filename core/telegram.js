import axios from 'axios';
import { loadLocalDB, saveLocalDB } from './database.js';
import { 
    getSubBotsReport, 
    stopSubBot, 
    startSubBotRemote, 
    deleteSubBotRemote,
    cleanPhoneNumber,
    requestSubBotPairing,
    updateSubBotName,
    updateSubBotCallName,
    broadcastUpdateToSubBots
} from './subbot.js';
import { getMenuSection } from '../plugins/menu.js';

export const OFFICIAL_TELEGRAM_TOKEN = '9240074974:AAF8OWaXmW1ET_BqucTgkZ4qa0uMQWzJGNA';

/**
 * تنقية توكن تليجرام واستبعاد أي توكن قديم أو محظور في Google Play تلقائياً
 */
export function getSanitizedTelegramToken(token = null) {
    let resolved = token;
    if (!resolved) {
        resolved = process.env.TELEGRAM_BOT_TOKEN;
    }
    if (!resolved) {
        try {
            const db = loadLocalDB();
            resolved = db?.telegramToken;
        } catch (_) {}
    }
    if (!resolved) {
        resolved = OFFICIAL_TELEGRAM_TOKEN;
    }

    resolved = String(resolved).replace(/\s+/g, '').trim();

    // فحص واستبعاد التوكن القديم المحظور في جوجل بلاي (يبدأ بـ 9183897015) أو التوكن القديم المكتوب خطأ
    if (resolved.startsWith('9183897015') || resolved.includes('AAHVyS6ASNy_MuqJcn4Bsrd31NGVHU607AE') || resolved.includes('AAF80Wa')) {
        console.warn('⚠️ [Telegram Security] تم اكتشاف توكن غير صالح أو قديم، جاري التحويل التلقائي للتوكن الرسمي الجديد المعتمد!');
        resolved = OFFICIAL_TELEGRAM_TOKEN;
        try {
            const db = loadLocalDB();
            if (db) {
                db.telegramToken = OFFICIAL_TELEGRAM_TOKEN;
                saveLocalDB(db);
            }
        } catch (_) {}
    }

    return resolved;
}

let isPolling = false;
let pollingAbortController = null;
let currentBotInfo = null;
let telegramStartTime = 0;
let lastUpdateId = 0;
let telegramWatchdogInterval = null;
let pollingSessionId = 0;

// 🎮 إدارة الجلسات والألعاب والتنصيب النشطة
const activeTelegramGames = new Map();
const telegramInstallState = new Map();
const chatSleepMap = new Map();
const chatMuteMap = new Map();

/**
 * تنظيف ومطابقة النصوص العربية
 */
function normalizeArabic(text) {
    if (!text) return '';
    return text
        .trim()
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // إزالة التشكيل والتطويل
        .replace(/\s+/g, ' ');
}

/**
 * فحص صحة توكن تليجرام واستخراج بيانات البوت
 */
export async function verifyTelegramToken(token) {
    if (!token) return null;
    token = String(token).replace(/\s+/g, '').trim();
    if (!token || !token.includes(':')) return null;
    try {
        const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10000 });
        if (res.data && res.data.ok) {
            return res.data.result;
        }
    } catch (e) {
        console.error('❌ [Telegram] فشل التحقق من توكن التليجرام:', e?.response?.data?.description || e?.message || e);
    }
    return null;
}

/**
 * إرسال رسالة نصية عبر تليجرام مع دعم Markdown ومعالجة الأخطاء
 */
export async function sendTelegramMessage(token, chatId, text, options = {}) {
    if (!token || !chatId || !text) return false;
    token = String(token).replace(/\s+/g, '').trim();
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: options.parse_mode || 'Markdown',
            reply_to_message_id: options.replyTo || undefined
        }, { timeout: 15000 });
        return true;
    } catch (e) {
        // إذا فشل التنسيق بـ Markdown نرسلها كنص عادي نقي
        try {
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: text.replace(/[*_`\[\]]/g, ''),
                reply_to_message_id: options.replyTo || undefined
            }, { timeout: 15000 });
            return true;
        } catch (err2) {
            console.error('❌ [Telegram Send Error]:', err2?.response?.data?.description || err2?.message);
        }
        return false;
    }
}

/**
 * تنفيذ إجراءات الإشراف (طرد / كتم) في مجموعات تليجرام
 */
async function telegramAction(token, method, payload) {
    token = String(token).replace(/\s+/g, '').trim();
    try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 10000 });
        return res.data && res.data.ok;
    } catch (e) {
        console.error(`❌ [Telegram Action Error (${method})]:`, e?.response?.data?.description || e?.message);
        return false;
    }
}

// 📦 بنك الأسئلة والألعاب الشامل
const RIDDLES_EYE = [
    { q: 'أنا شيء أملك عيناً واحدة ولكن لا أرى بها؟', a: 'الابرة', h: 'تستخدم في الخياطة 🪡' },
    { q: 'ما هو الشيء الذي كلما زاد نقص؟', a: 'العمر', h: 'مرتبط بحياة الإنسان ⏳' },
    { q: 'شيء يمشي بلا أرجل ويبكي بلا عيون؟', a: 'السحاب', h: 'في السماء ويمطر 🌧️' },
    { q: 'ما هو الشيء الذي يقرصك ولا تراه؟', a: 'الجوع', h: 'تشعر به في بطنك 🍽️' },
    { q: 'شيء إذا أطعمته كبر وإذا سقيته بالماء مات؟', a: 'النار', h: 'تشتعل وتحرق 🔥' },
    { q: 'له أسنان كثيرة ولكنه لا يعض؟', a: 'المشط', h: 'نسرح به الشعر 🪮' },
    { q: 'له رقبة وليس له رأس فما هو؟', a: 'القميص', h: 'من الملابس 👔' },
    { q: 'ابن الماء وإذا وضعته في الماء مات؟', a: 'الثلج', h: 'يذوب في الماء 🧊' },
    { q: 'بيت ليس له أبواب ولا نوافذ؟', a: 'بيت الشعر', h: 'في القصائد والأدب 📜' },
    { q: 'شيء يكتب ولا يقرأ؟', a: 'القلم', h: 'نمسكه باليد لنكتب به ✏️' },
    { q: 'ما هو الباب الذي لا يمكن فتحه؟', a: 'الباب المفتوح', h: 'لأنه مفتوح بالفعل! 🚪' },
    { q: 'شيء يسير أمامك دائماً ولا تستطيع اللحاق به؟', a: 'المستقبل', h: 'الأيام القادمة 🔮' }
];

const RIDDLES_KATKOUT = [
    { q: 'ما هو الطائر الذي لا يطير في البحر؟', a: 'الكتكوت', h: 'ابن الدجاجة 🐣' },
    { q: 'حيوان ينام وحذاؤه في رجليه؟', a: 'الحصان', h: 'حوافر وحدوة 🐴' },
    { q: 'شيء أخف من الريشة ولا يستطيع أقوى رجل حبسه لأكثر من دقائق؟', a: 'النفس', h: 'الهواء الصادر من الرئتين 🫁' },
    { q: 'شيء تأكل منه دائماً ولا تأكله؟', a: 'الصحن', h: 'تضع فيه الطعام 🍽️' },
    { q: 'شيء إذا دخل الماء لا يبتل؟', a: 'الضوء', h: 'ينير الأعماق 💡' },
    { q: 'ما هو الشيء الذي يولد كبيراً ويموت صغيراً؟', a: 'الشمعة', h: 'تذوب بالنار 🕯️' },
    { q: 'عقرب لا يلدغ ولا يخاف منه أحد؟', a: 'عقرب الساعة', h: 'يدور ليحسب الوقت ⏰' },
    { q: 'أين يوجد البحر الذي لا يوجد به ماء؟', a: 'الخريطة', h: 'مرسوم على ورق 🗺️' }
];

const CAPITALS_DATA = [
    { country: 'مصر', capital: 'القاهرة' },
    { country: 'السعودية', capital: 'الرياض' },
    { country: 'فرنسا', capital: 'باريس' },
    { country: 'اليابان', capital: 'طوكيو' },
    { country: 'إسبانيا', capital: 'مدريد' },
    { country: 'ألمانيا', capital: 'برلين' },
    { country: 'إيطاليا', capital: 'روما' },
    { country: 'روسيا', capital: 'موسكو' },
    { country: 'بريطانيا', capital: 'لندن' },
    { country: 'الإمارات', capital: 'ابوظبي' },
    { country: 'العراق', capital: 'بغداد' },
    { country: 'لبنان', capital: 'بيروت' },
    { country: 'المغرب', capital: 'الرباط' },
    { country: 'تركيا', capital: 'انقرة' },
    { country: 'قطر', capital: 'الدوحة' },
    { country: 'الكويت', capital: 'الكويت' },
    { country: 'فلسطين', capital: 'القدس' },
    { country: 'الأردن', capital: 'عمان' }
];

const ISLAMIC_QUIZ = [
    { q: 'كم عدد سور القرآن الكريم؟', a: '114' },
    { q: 'من هو أول من أسلم من الرجال الأحرار؟', a: 'ابو بكر' },
    { q: 'ما هي أعظم سورة في القرآن الكريم؟', a: 'الفاتحة' },
    { q: 'ما هي أطول سورة في القرآن الكريم؟', a: 'البقرة' },
    { q: 'ما هي أقصر سورة في القرآن الكريم؟', a: 'الكوثر' },
    { q: 'من هو النبي الذي ابتلعه الحوت وسبح في بطنه؟', a: 'يونس' },
    { q: 'كم عدد أركان الإسلام؟', a: '5' },
    { q: 'ما هي عاصمة الدولة الإسلامية في عهد الخلفاء الراشدين؟', a: 'المدينة المنورة' },
    { q: 'من هو سيف الله المسلول؟', a: 'خالد بن الوليد' }
];

const SARAHA_QUESTIONS = [
    'هل ندمت يوماً على شخص دخل حياتك وتمنيت لو لم تقابله؟ 💔',
    'ما هو أكبر سر تخفيه عن أقرب الناس إليك حتى الآن؟ 🤫',
    'إذا كان بإمكانك مسح ذكرى واحدة من حياتك فماذا ستكون؟ 💭',
    'هل تعلقت بشخص لدرجة أنك غير قادر على تخيل يومك بدونه؟ 🥺',
    'ما هو أكثر شيء يجعلك تبكي في صمت بدون أن يشعر أحد؟ 🌧️',
    'هل أنت راضٍ عن نفسك بنسبة 100% في الوقت الحالي؟ ✨',
    'ما هو القرار الأكثر شجاعة الذي اتخذته في حياتك؟ ⚔️',
    'من هو الشخص الذي لا تستطيع رفض أي طلب له مهما كان؟ ❤️',
    'هل شعرت بالخذلان الشديد من أقرب صديق لك يوماً ما؟ 🥀',
    'ما هي الأمنية التي تدعو الله بها في كل صلاة وتنتظر تحقيقها؟ 🤲'
];

const DILEMMAS_LIST = [
    'لو خيروك: تسافر للمستقبل وتشوف حياتك، أو ترجع للماضي وتصلح غلطة؟ ⏳',
    'لو خيروك: تخسر كل ذكرياتك، أو تخسر كل فلوسك؟ 💸',
    'لو خيروك: تعيش وحيداً في قصر فاخر، أو تعيش مع أصحابك في بيت متواضع؟ 🏰',
    'لو خيروك: تقرأ أفكار الناس، أو تختفي في أي وقت تحبه؟ 🧙‍♂️',
    'لو خيروك: ما تنامش خالص وتفضل بطاقتك، أو ما تاكلش خالص وتشبع بدون طعام؟ ⚡',
    'لو خيروك: تعرف يوم وفاتك بالظبط، أو تعرف طريقة وفاتك؟ ⚖️'
];

const AZKAR_LIST = [
    'اللّهُـمَّ بِكَ أَصْـبَحْنا وَبِكَ أَمْسَـينا، وَبِكَ نَحْـيا وَبِكَ نَمُـوتُ وَإِلَـيْكَ النُّـشُور. ☀️',
    'أَصْبَـحْنا وَأَصْبَـحَ المـلكُ لله وَالحَمدُ لله، لا إلهَ إلاّ اللّهُ وَحدَهُ لا شَريكَ لهُ، لهُ المُـلكُ ولهُ الحَمْـد، وهُوَ على كلّ شَيءٍ قدير. 🤍',
    'أَسْتَغْفِرُ اللهَ العَظِيمَ الَّذِي لاَ إِلَهَ إِلاَّ هُوَ الحَيُّ القَيُّومُ وَأَتُوبُ إِلَيهِ. (استغفر الله تكفيك همك) 🌿',
    'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ العَظِيمِ. (كلمتان خفيفتان على اللسان، ثقيلتان في الميزان) ⚖️',
    'اللَّهُمَّ صَلِّ وَسَلِّمْ وَبَارِكْ عَلَى نَبِيِّنَا مُحَمَّدٍ وَعَلَى آلِهِ وَصَحْبِهِ أَجْمَعِينَ. 🌸',
    'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ العَلِيِّ العَظِيمِ. (كنز من كنوز الجنة) 💎',
    'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ العَرْشِ العَظِيمِ. 🛡️'
];

/**
 * فحص هل المستخدم مشرف في مجموعة تليجرام
 */
async function isTelegramChatAdmin(token, chatId, userId) {
    if (!token || !chatId || !userId) return false;
    try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/getChatMember`, {
            chat_id: chatId,
            user_id: userId
        });
        if (res.data?.ok && res.data?.result) {
            const status = res.data.result.status;
            return status === 'creator' || status === 'administrator';
        }
    } catch (_) {}
    return false;
}

/**
 * معالجة رسائل وأوامر التليجرام الواردة
 */
async function handleTelegramMessage(token, msg) {
    if (!msg) return;
    const chatId = msg.chat?.id;
    const fromId = msg.from?.id;
    const fromUsername = msg.from?.username ? String(msg.from.username).replace(/^@/, '') : '';
    const username = fromUsername || msg.from?.first_name || 'صديقي';
    const text = (msg.text || msg.caption || '').trim();
    if (!text) return;

    const isGroup = msg.chat?.type === 'group' || msg.chat?.type === 'supergroup';

    const normalizedBody = normalizeArabic(text);
    const textLower = text.toLowerCase();

    const localDB = loadLocalDB();
    if (!localDB.users) localDB.users = {};
    if (!localDB.telegramOwners) {
        localDB.telegramOwners = ['Shadwwmy', 'shadwwmy', '37122247649', '201129249396', '194961618301016'];
    }

    // فحص رقم الهاتف إذا تم إرسال جهة اتصال
    if (msg.contact?.phone_number) {
        const cleanContactPhone = cleanPhoneNumber(msg.contact.phone_number);
        if (cleanContactPhone === '201129249396' || cleanContactPhone === '01129249396') {
            if (!localDB.telegramOwners.includes(String(fromId))) {
                localDB.telegramOwners.push(String(fromId));
                if (fromUsername) localDB.telegramOwners.push(fromUsername);
                saveLocalDB(localDB);
            }
        }
    }

    // 👑 المالك المطلق هو الحج شادو فقط:
    // رقم: 01129249396 / 201129249396
    // يوزر تليجرام: @Shadwwmy
    const isHajjShado = (
        (fromUsername && fromUsername.toLowerCase() === 'shadwwmy') ||
        String(fromId) === '194961618301016' ||
        String(fromId) === '37122247649' ||
        String(fromId) === '6058342366' ||
        (Array.isArray(localDB.telegramOwners) && (
            localDB.telegramOwners.includes(String(fromId)) ||
            (fromUsername && localDB.telegramOwners.some(u => String(u).toLowerCase() === fromUsername.toLowerCase() || String(u).toLowerCase() === `@${fromUsername.toLowerCase()}`))
        ))
    );

    const isRaisedHajj = (
        (Array.isArray(localDB.hajjUsers) && (localDB.hajjUsers.includes(`tg_${fromId}`) || (fromUsername && localDB.hajjUsers.includes(fromUsername)))) ||
        (Array.isArray(localDB.mainHajjUsers) && (localDB.mainHajjUsers.includes(`tg_${fromId}`) || (fromUsername && localDB.mainHajjUsers.includes(fromUsername))))
    );
    const isHajj = isHajjShado || isRaisedHajj;

    let cachedGroupAdmin = null;
    const checkIsActualRoomAdminOrOwner = async () => {
        if (isHajj) return true;
        if (!isGroup) return false;
        if (cachedGroupAdmin !== null) return cachedGroupAdmin;
        cachedGroupAdmin = await isTelegramChatAdmin(token, chatId, fromId);
        return cachedGroupAdmin;
    };

    const isAbsoluteOwner = isHajjShado;
    const isMainHajj = isHajjShado;
    const isBotOwner = isHajjShado;

    // مفتاح المستخدم في قاعدة البيانات
    const userKey = isHajjShado ? '201129249396@s.whatsapp.net' : `tg_${fromId}`;

    // تسجيل الحساب الجديد في النظام
    if (!localDB.users[userKey]) {
        localDB.users[userKey] = {
            name: isHajjShado ? 'الحج شادو' : (msg.from?.first_name || username),
            telegramUsername: fromUsername,
            points: isHajjShado ? 999999999999 : 1000,
            level: isHajjShado ? 999 : 1,
            joinedAt: new Date().toLocaleDateString('ar-EG'),
            hasRegistered: true,
            isInfinite: isHajjShado
        };
        saveLocalDB(localDB);
    } else if (isHajjShado) {
        localDB.users[userKey].points = 999999999999;
        localDB.users[userKey].level = 999;
        localDB.users[userKey].isInfinite = true;
    }

    const userData = localDB.users[userKey];

    // 🚫 فحص حظر المستخدم
    if (localDB.bannedUsers && Array.isArray(localDB.bannedUsers)) {
        if (localDB.bannedUsers.includes(userKey) || localDB.bannedUsers.includes(`tg_${fromId}`)) {
            if (!isHajjShado) return; // محظور صامت
        }
    }

    // 🤫 فحص وضع الصمت التام (اسكت)
    if (chatMuteMap.get(chatId)) {
        if (!isHajj) return;
        if (['اتكلم', 'اصحي', '/unmute', '/wake'].includes(normalizedBody)) {
            chatMuteMap.delete(chatId);
            chatSleepMap.delete(chatId);
            await sendTelegramMessage(token, chatId, `⚡ *صباح الفل يا حج! تم فك الصمت عن شادو بوت وعاد للتحدث والعمل للجميع بكامل طاقته!* 🚀🔥`, { replyTo: msg.message_id });
            return;
        }
        return;
    }

    // 💤 فحص وضع النوم (نام)
    if (chatSleepMap.get(chatId)) {
        if (!isHajj) return;
        if (['اصحي', 'اتكلم', '/wake', '/unmute'].includes(normalizedBody)) {
            chatSleepMap.delete(chatId);
            await sendTelegramMessage(token, chatId, `⚡ *صباح الفل يا حج! تم استيقاظ شادو بوت في هذا الشات وعاد للعمل للجميع!* 🚀✨`, { replyTo: msg.message_id });
            return;
        }
    }

    // =========================================================================
    // 🤖 محرك التنصيب التفاعلي للبوتات الفرعية عبر تليجرام (خطوة بخطوة)
    // =========================================================================
    if (telegramInstallState.has(chatId)) {
        const installSession = telegramInstallState.get(chatId);

        // خيار الإلغاء
        if (['الغاء', 'إلغاء', 'انهاء', 'خروج', '/cancel'].includes(normalizedBody)) {
            if (installSession.timer) clearTimeout(installSession.timer);
            telegramInstallState.delete(chatId);
            await sendTelegramMessage(token, chatId, `✅ *تم إلغاء عملية التنصيب بنجاح.* يمكنك البدء من جديد بكتابة *(تنصيب)* في أي وقت!`, { replyTo: msg.message_id });
            return;
        }

        // الخطوة 1: استلام والتحقق من رقم الهاتف
        if (installSession.step === 1) {
            const rawDigits = text.replace(/[^0-9]/g, '');
            const cleanPhone = cleanPhoneNumber(rawDigits);
            if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 13) {
                await sendTelegramMessage(token, chatId, `❌ *رقم الهاتف غير صالح (+${rawDigits})!* \nبرجاء إرسال رقم هاتف واتساب بالأرقام مع كود الدولة (مثال: \`201012345678\` أو \`9647901234567\`). \n💡 _اكتب (الغاء) للتراجع._`, { replyTo: msg.message_id });
                return;
            }

            installSession.targetPhone = cleanPhone;
            installSession.step = 2;
            const step2Msg = 
                `✅ تم تسجيل رقم الهاتف: *+${cleanPhone}* 📱\n\n` +
                `🏷️ *الخطوة 2 من 4:* \n` +
                `ما هو *الاسم الرسمي* الذي تريده لبوتك؟ \n` +
                `(مثال: \`شادو بوت\`، \`بوت القيصر\`، \`العالمي\`):`;
            await sendTelegramMessage(token, chatId, step2Msg, { replyTo: msg.message_id });
            return;
        }

        // الخطوة 2: الاسم الرسمي للبوت
        if (installSession.step === 2) {
            const bName = text.trim();
            if (!bName || bName.length < 2) {
                await sendTelegramMessage(token, chatId, `⚠️ برجاء كتابة اسم واضح للبوت (حرفين على الأقل)!`, { replyTo: msg.message_id });
                return;
            }

            installSession.botName = bName;
            installSession.step = 3;
            const step3Msg = 
                `✅ تم تسجيل الاسم: *${bName}* 🏷️\n\n` +
                `🗣️ *الخطوة 3 من 4:* \n` +
                `ما هو *اسم النداء السهل* الذي تريد أن تنده عليه به في الشات؟ \n` +
                `(كلمة واحدة سهلة، مثال: \`شادو\` أو \`قيصر\`):`;
            await sendTelegramMessage(token, chatId, step3Msg, { replyTo: msg.message_id });
            return;
        }

        // الخطوة 3: اسم النداء
        if (installSession.step === 3) {
            const cName = text.trim();
            if (!cName) {
                await sendTelegramMessage(token, chatId, `⚠️ برجاء كتابة اسم نداء سهل!`, { replyTo: msg.message_id });
                return;
            }

            installSession.callName = cName;
            installSession.step = 4;
            const step4Msg = 
                `✅ تم تسجيل اسم النداء: *${cName}* 🗣️\n\n` +
                `🎭 *الخطوة 4 من 5:* \n` +
                `اختر شخصية البوت في الردود والتفاعل:\n` +
                `1️⃣ *محترم ومؤدب* 😇🤍 (شخصية محترمة ولبقة وأخلاقية)\n` +
                `2️⃣ *قليل الأدب* 😈🔥 (شخصية مشاكسة وجريئة وردود قوية)\n\n` +
                `👉 _أرسل رقم (1) أو (2):_`;
            await sendTelegramMessage(token, chatId, step4Msg, { replyTo: msg.message_id });
            return;
        }

        // الخطوة 4: اختيار الشخصية والانتقال لتحديد الحج الأساسي
        if (installSession.step === 4) {
            let personality = 'respectful';
            if (['2', 'قليل الادب', 'قليل أدب', 'مشاكس', 'توكسيك'].includes(normalizedBody)) {
                personality = 'bad';
            }

            installSession.personality = personality;
            installSession.step = 5;

            const step5Msg = 
                `✅ تم اختيار الشخصية: *${personality === 'bad' ? 'قليل الأدب 😈🔥' : 'محترم ومؤدب 😇🤍'}*\n\n` +
                `👑 *الخطوة 5 من 5: من هو الحج الأساسي (المالك والمتحكم بالبوت الفرعي)؟*\n` +
                `• اكتب رقم هاتف الحج مع كود الدولة (مثال: \`01129249396\` أو \`201129249396\` أو \`01012345678\`)\n` +
                `• أو إذا كنت أنت الحج الأساسي اكتب: *(رقمي)* أو *(نفسي)*:`;
            await sendTelegramMessage(token, chatId, step5Msg, { replyTo: msg.message_id });
            return;
        }

        // الخطوة 5: تحديد رقم الحج الأساسي واستخراج كود الربط
        if (installSession.step === 5) {
            let adminPhone = '201129249396';
            let adminLid = '194961618301016';

            const isSelf = ['رقمي', 'نفسي', 'انا', 'أنا', 'نفس الرقم', 'حسابي'].includes(normalizedBody);
            if (isSelf) {
                adminPhone = '201129249396';
                adminLid = '194961618301016';
            } else {
                const cleanInput = cleanPhoneNumber(text.replace(/[^0-9]/g, ''));
                if (cleanInput && cleanInput.length >= 8) {
                    adminPhone = cleanInput;
                    const db = loadLocalDB();
                    if (adminPhone === '201129249396' || adminPhone === '01129249396') {
                        adminPhone = '201129249396';
                        adminLid = '194961618301016';
                    } else if (db?.lidMap && db.lidMap[adminPhone]) {
                        adminLid = db.lidMap[adminPhone];
                    } else {
                        adminLid = '';
                    }
                } else if (isHajjShado) {
                    adminPhone = '201129249396';
                    adminLid = '194961618301016';
                }
            }

            // ضمان تسجيل رقم الحج المختار في قائمة الحجاج في قاعدة البيانات
            try {
                const db = loadLocalDB();
                if (!db.hajjUsers) db.hajjUsers = [];
                if (!db.hajjUsers.includes(adminPhone)) db.hajjUsers.push(adminPhone);
                const jid = `${adminPhone}@s.whatsapp.net`;
                if (!db.hajjUsers.includes(jid)) db.hajjUsers.push(jid);
                if (adminLid) {
                    if (!db.hajjUsers.includes(adminLid)) db.hajjUsers.push(adminLid);
                    if (!db.hajjUsers.includes(`${adminLid}@lid`)) db.hajjUsers.push(`${adminLid}@lid`);
                }
                saveLocalDB(db);
            } catch (_) {}

            installSession.adminPhone = adminPhone;
            installSession.adminLid = adminLid;
            if (installSession.timer) clearTimeout(installSession.timer);
            telegramInstallState.delete(chatId);

            const { targetPhone, botName, callName, personality } = installSession;

            await sendTelegramMessage(token, chatId, `⏳ *جاري الاتصال بخوادم واتساب وتوليد كود الاقتران لبوتك (${botName})...*\n👑 *الحج الأساسي:* +${adminPhone}\nبرجاء الانتظار ثوانٍ معدودة! 🚀`);

            // استدعاء محرك الاقتران مع موجه الرسائل لتليجرام
            try {
                await requestSubBotPairing(
                    targetPhone,
                    botName,
                    callName,
                    adminPhone,
                    adminLid,
                    'male',
                    personality,
                    global.conn,
                    `tg:${chatId}`,
                    null,
                    async (notifyText) => {
                        await sendTelegramMessage(token, chatId, notifyText);
                    }
                );
            } catch (pairErr) {
                console.error('❌ [Telegram Sub-Bot Pairing Error]:', pairErr);
                await sendTelegramMessage(token, chatId, `❌ حدث خطأ أثناء محاولة طلب كود الاقتران: ${pairErr?.message || pairErr}`);
            }
            return;
        }
    }

    // =========================================================================
    // 🎮 فحص ومطابقة إجابات الألعاب النشطة في الشات الحالي
    // =========================================================================
    if (activeTelegramGames.has(chatId)) {
        const game = activeTelegramGames.get(chatId);

        // إلغاء اللعبة
        if (['انسحاب', 'استسلام', 'كفاية', 'الغاء اللعبة', 'انهاء'].includes(normalizedBody)) {
            clearTimeout(game.timer);
            activeTelegramGames.delete(chatId);
            await sendTelegramMessage(token, chatId, `🛑 *تم إنهاء الجولة والاستسلام!*\n💡 الإجابة الصحيحة كانت: *[ ${game.answer} ]*\nاكتب اسم اللعبة لتجربة جولة جديدة! 🎮`, { replyTo: msg.message_id });
            return;
        }

        // طلب تلميح
        if (['تلميح', 'ساعدني', 'تلميح اللعبة'].includes(normalizedBody)) {
            await sendTelegramMessage(token, chatId, `💡 *تلميح ذكي:* ${game.hint}`, { replyTo: msg.message_id });
            return;
        }

        // مطابقة الإجابة
        const cleanAnswer = normalizeArabic(game.answer);
        if (normalizedBody === cleanAnswer || cleanAnswer.split(' ').every(w => normalizedBody.includes(w))) {
            clearTimeout(game.timer);
            activeTelegramGames.delete(chatId);

            userData.points = (userData.points || 0) + game.reward;
            saveLocalDB(localDB);

            const winMsg = 
                `🎉 *كفووووو يا عظمة @${fromUsername || username}! إجابتك صحيحة 100%!* ⚡\n\n` +
                `✅ الإجابة الصحيحة: *« ${game.answer} »*\n` +
                `🎁 تم إضافة *${game.reward}* نقطة في رصيدك!\n` +
                `💰 رصيدك الحالي الآن: [ *${userData.points}* ] نقطة.`;
            await sendTelegramMessage(token, chatId, winMsg, { replyTo: msg.message_id });
            return;
        }
    }

    // =========================================================================
    // 👑 1️⃣ الترحيب وأمر /start
    // =========================================================================
    if (text === '/start' || textLower === 'start' || text === 'هلا' || text === 'مرحبا') {
        let welcome = '';
        if (isHajjShado) {
            welcome = 
                `👑🕋 *أهلاً وسهلاً بالحج شادو الأصلي صاحب ومطور البوت!* ⚡❤️\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🤖 *شادو بوت (Shadow Bot) رهن إشارتك وتحت أمرك بالكامل على تليجرام!*\n\n` +
                `📱 *معرفك الملكي:* @${fromUsername || 'Shadwwmy'} (المتحكم المطلق)\n` +
                `💎 *الرصيد والمستوى:* نقاط لا نهائية ولفل 999 👑\n\n` +
                `📜 اكتب *(الاوامر)* أو *(منيو)* لعرض كافة الأقسام.\n` +
                `📊 اكتب *(كام تنصيب)* لمتابعة حالة وتحكم جميع البوتات الفرعية عن بُعد!\n` +
                `📢 *رابط البوت والقناة:* https://t.me/Shadowcomm_bot`;
        } else {
            welcome = 
                `👑 *أهلاً بك يا ${username} في شادو بوت (Shadow Bot)!* 🤖✨\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `البوت شغال بأعلى سرعة وذكاء على تليجرام بنفس أوامر وألعاب ومواقيت الواتساب!\n\n` +
                `📜 اكتب *(الاوامر)* أو *(منيو)* لعرض القائمة الكاملة.\n` +
                `🤖 اكتب *(تنصيب)* لتنصيب بوتك الخاص مجاناً.\n` +
                `🎮 اكتب *(صراحه)* أو *(عين)* أو *(كورة)* لبدء الألعاب.\n` +
                `🕌 اكتب *(مواقيت الصلاة)* لمعرفة مواعيد الصلاة والأذان.\n` +
                `🎁 هدية تسجيلك: تم إضافة *1000* نقطة مجانية في رصيدك!\n` +
                `📢 *رابط البوت:* https://t.me/Shadowcomm_bot`;
        }
        await sendTelegramMessage(token, chatId, welcome, { replyTo: msg.message_id });
        return;
    }

    // =========================================================================
    // 📜 2️⃣ قائمة الأوامر والمنيو والأقسام (مطابقة تماماً للواتساب 100%)
    // =========================================================================
    const isMenuCmd = ['/menu', 'menu', 'اوامر', 'الاوامر', 'القائمة', 'قائمة', 'منيو', 'المنيو', '/help'].includes(textLower) || ['اوامر', 'الاوامر', 'منيو', 'المنيو'].includes(normalizedBody);
    if (isMenuCmd) {
        const menuText = getMenuSection(0, 'شادو');
        await sendTelegramMessage(token, chatId, menuText, { replyTo: msg.message_id });
        return;
    }

    // اختيار الأقسام بالأرقام أو أسمائها (1 إلى 9 أو الكل)
    let selectedSection = null;
    if (/^(1|قسم\s*1)$/.test(normalizedBody) || ['الالعاب', 'الألعاب', 'قسم الألعاب', 'قسم الالعاب'].includes(normalizedBody)) {
        selectedSection = 1;
    } else if (/^(2|قسم\s*2)$/.test(normalizedBody) || ['البروفايل', 'النقاط', 'قسم البروفايل', 'قسم النقاط'].includes(normalizedBody)) {
        selectedSection = 2;
    } else if (/^(3|قسم\s*3)$/.test(normalizedBody) || ['الجروب', 'الاشراف', 'الإشراف', 'قسم الجروب', 'قسم الاشراف'].includes(normalizedBody)) {
        selectedSection = 3;
    } else if (/^(4|قسم\s*4)$/.test(normalizedBody) || ['التنبيهات', 'الانذارات', 'الإنذارات', 'قسم التنبيهات'].includes(normalizedBody)) {
        selectedSection = 4;
    } else if (/^(5|قسم\s*5)$/.test(normalizedBody) || ['التنصيب', 'البوتات الفرعية', 'قسم التنصيب'].includes(normalizedBody)) {
        selectedSection = 5;
    } else if (/^(6|قسم\s*6)$/.test(normalizedBody) || ['الحج', 'المالك', 'اوامر الحج', 'قسم الحج', 'قسم المالك'].includes(normalizedBody)) {
        selectedSection = 6;
    } else if (/^(7|قسم\s*7)$/.test(normalizedBody) || ['الميديا', 'الصوتيات', 'الملصقات', 'قسم الميديا'].includes(normalizedBody)) {
        selectedSection = 7;
    } else if (/^(8|قسم\s*8)$/.test(normalizedBody) || ['الردود', 'الدردشة', 'قسم الردود'].includes(normalizedBody)) {
        selectedSection = 8;
    } else if (/^(9|قسم\s*9)$/.test(normalizedBody) || ['القناة', 'القناه', 'قناة', 'قناه', 'قناة المطور', 'قناه المطور'].includes(normalizedBody)) {
        selectedSection = 9;
    } else if (['الكل', 'كل الاوامر', 'كل الأوامر', 'قائمة الكل'].includes(normalizedBody)) {
        selectedSection = 'all';
    }

    if (selectedSection !== null) {
        const secText = getMenuSection(selectedSection, 'شادو');
        if (secText) {
            await sendTelegramMessage(token, chatId, secText, { replyTo: msg.message_id });
            return;
        }
    }

    // =========================================================================
    // 🔄 أمر التحديث السحابي التلقائي (تحديث / ابديت) - للحج شادو فقط
    // =========================================================================
    if (['تحديث', 'ابديت', 'update', '/update', 'تحديث البوت'].includes(normalizedBody)) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (@Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        await sendTelegramMessage(token, chatId, `🔄 *جاري سحب وتثبيت آخر تحديثات شادو بوت من GitHub... برجاء الانتظار!* 🚀`, { replyTo: msg.message_id });
        try {
            const { exec } = await import('child_process');
            exec('git pull origin main', async (err, stdout, stderr) => {
                if (err) {
                    await sendTelegramMessage(token, chatId, `❌ فشل سحب التحديث:\n\`${err.message}\``);
                    return;
                }
                await sendTelegramMessage(token, chatId, `✅ *تم تحديث شادو بوت بنجاح!* 🎉\n\`${stdout || 'Already up to date.'}\`\n🔄 جاري إعادة تشغيل السيرفر لتطبيق التعديلات...`);
                setTimeout(() => {
                    process.exit(0);
                }, 1500);
            });
        } catch (e) {
            await sendTelegramMessage(token, chatId, `❌ خطأ في أمر التحديث: ${e?.message || e}`);
        }
        return;
    }

    // =========================================================================
    // 🤖 3️⃣ أوامر إدارة البوتات الفرعية والتنصيب - للحج شادو فقط
    // =========================================================================
    const isHowManySubBotsCmdTg = (
        /^(?:\.|\/)?(كام|كم|عدد)\s*(?:عدد\s*)?(تنصيب|بوت|بوتات|فرعي)/i.test(normalizedBody) ||
        /^(?:\.|\/)?(البوتات\s*الفرعية|البوتات\s*الفرعيه|بوتات\s*فرعية|بوتات\s*فرعيه|قائمة\s*التنصيب|قائمه\s*التنصيب|لوحة\s*التنصيب|لوحه\s*التنصيب|احصائيات\s*التنصيب|إحصائيات\s*التنصيب|subbots|bots)/i.test(normalizedBody)
    );

    if (isHowManySubBotsCmdTg) {
        if (!isHajjShado && !isAbsoluteOwner) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }

        const rep = getSubBotsReport();
        const headerText = 
            `╭━━━〔 🤖 *لوحة إحصائيات البوتات الفرعية على تليجرام* 〕━━━╮\n` +
            `┃ 🤖 *إجمالي البوتات المنصبة:* ${rep.total}\n` +
            `┃ 🟢 *البوتات النشطة الآن:* ${rep.activeCount}\n` +
            `┃ 🛑 *البوتات المتوقفة والمحظورة:* ${rep.stoppedCount}\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `${rep.listText}`;

        const dashText = 
            headerText + `\n\n` +
            `⚙️ *أوامر التحكم السريع عن بُعد:* \n` +
            `• لإيقاف بوت: *(ايقاف تنصيب <رقم_البوت>)*\n` +
            `• لتشغيل بوت: *(تشغيل تنصيب <رقم_البوت>)*\n` +
            `• لحذف بوت نهائياً: *(حذف تنصيب <رقم_البوت>)*\n` +
            `• إذاعة للبوتات: *(اذاعة للبوتات <الرسالة>)*`;

        await sendTelegramMessage(token, chatId, dashText, { replyTo: msg.message_id });
        return;
    }

    if (normalizedBody.startsWith('ايقاف تنصيب ') || normalizedBody.startsWith('إيقاف تنصيب ')) {
        if (!isHajjShado && !isAbsoluteOwner) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }
        const targetPhone = text.replace(/^(ايقاف تنصيب|إيقاف تنصيب)\s*/i, '').replace(/[^0-9]/g, '');
        if (!targetPhone) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب رقم البوت بعد الأمر، مثال:\nايقاف تنصيب 201012345678`, { replyTo: msg.message_id });
            return;
        }
        const res = await stopSubBot(targetPhone);
        await sendTelegramMessage(token, chatId, res.message, { replyTo: msg.message_id });
        return;
    }

    if (normalizedBody.startsWith('تشغيل تنصيب ')) {
        if (!isHajjShado && !isAbsoluteOwner) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }
        const targetPhone = text.replace(/^تشغيل تنصيب\s*/i, '').replace(/[^0-9]/g, '');
        if (!targetPhone) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب رقم البوت بعد الأمر، مثال:\nتشغيل تنصيب 201012345678`, { replyTo: msg.message_id });
            return;
        }
        const res = await startSubBotRemote(targetPhone, null);
        await sendTelegramMessage(token, chatId, res.message, { replyTo: msg.message_id });
        return;
    }

    if (normalizedBody.startsWith('حذف تنصيب ') || normalizedBody.startsWith('الغاء تنصيب ') || normalizedBody.startsWith('إلغاء تنصيب ')) {
        if (!isHajjShado && !isAbsoluteOwner) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }
        const targetPhone = text.replace(/^(حذف تنصيب|الغاء تنصيب|إلغاء تنصيب)\s*/i, '').replace(/[^0-9]/g, '');
        if (!targetPhone) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب رقم البوت بعد الأمر، مثال:\nحذف تنصيب 201012345678`, { replyTo: msg.message_id });
            return;
        }
        const res = await deleteSubBotRemote(targetPhone, null, false);
        await sendTelegramMessage(token, chatId, res.message, { replyTo: msg.message_id });
        return;
    }

    // إذاعة للبوتات الفرعية عبر تليجرام - للحج شادو فقط
    const isBroadcastCmdTg = (
        normalizedBody.startsWith('اذاعه للبوتات') ||
        normalizedBody.startsWith('اذاعة للبوتات') ||
        normalizedBody.startsWith('إذاعة للبوتات') ||
        normalizedBody.startsWith('نشر للبوتات') ||
        normalizedBody.startsWith('اعلان للبوتات') ||
        normalizedBody.startsWith('إعلان للبوتات') ||
        normalizedBody.startsWith('تحديث للبوتات')
    );

    if (isBroadcastCmdTg) {
        if (!isHajjShado && !isAbsoluteOwner) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }
        const broadcastText = text
            .replace(/^(اذاعة للبوتات|اذاعه للبوتات|إذاعة للبوتات|نشر للبوتات|اعلان للبوتات|إعلان للبوتات|تحديث للبوتات)\s*/i, '')
            .trim();

        if (!broadcastText) {
            const helpText = 
                `📢 *طريقة الإذاعة لجميع أصحاب البوتات الفرعية:* 👑\n\n` +
                `• اكتب: *اذاعة للبوتات [الرسالة أو الإعلان أو التحديث الجديد]*\n` +
                `• مثال: *اذاعة للبوتات تم إضافة أوامر جديدة وتحديث شامل!*\n\n` +
                `⚡ سيقوم البوت بإرسال الإشعار فوراً في الخاص لجميع الحجاج أصحاب البوتات الفرعية المسجلة.`;
            await sendTelegramMessage(token, chatId, helpText, { replyTo: msg.message_id });
            return;
        }

        const formattedMsg = 
            `📢 *〔 إشعار وتحديث هام من الحج شادو إلى جميع أصحاب البوتات الفرعية 〕* 👑\n\n` +
            `${broadcastText}\n\n` +
            `⚡ *تاريخ الإرسال:* ${new Date().toLocaleDateString('ar-EG')}\n` +
            `👑 *مع تحيات الحج شادو وإدارة البوت.*`;

        const result = await broadcastUpdateToSubBots(global.conn, formattedMsg);
        const reportMsg = 
            `╭━━━〔 📢 *تقرير إذاعة البوتات الفرعية* 〕━━━╮\n` +
            `┃ 🤖 *إجمالي البوتات الفرعية:* ${result.total}\n` +
            `┃ ✅ *تم الإرسال بنجاح إلى:* ${result.sentCount}\n` +
            `┃ ❌ *فشل الإرسال إلى:* ${result.failedCount}\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🎉 ${result.message}`;

        await sendTelegramMessage(token, chatId, reportMsg, { replyTo: msg.message_id });
        return;
    }

    if (normalizedBody.startsWith('تعديل اسم ') || normalizedBody.startsWith('تغيير اسم ') || normalizedBody.startsWith('تعديل اسم البوت ')) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (@Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        const cleanCmd = text.replace(/^(تعديل اسم البوت|تعديل اسم|تغيير اسم البوت|تغيير اسم)\s*/i, '').trim();
        const parts = cleanCmd.split(/\s+/);
        const targetPhone = cleanPhoneNumber(parts[0]);
        const newName = parts.slice(1).join(' ').trim();
        if (!targetPhone || !newName) {
            await sendTelegramMessage(token, chatId, `⚠️ برجاء كتابة رقم البوت والاسم الجديد، مثال:\n\`تعديل اسم 201012345678 بوت الزعيم\``, { replyTo: msg.message_id });
            return;
        }
        const ok = updateSubBotName(targetPhone, newName);
        if (ok) {
            await sendTelegramMessage(token, chatId, `✅ *تم تغيير اسم البوت (+${targetPhone}) إلى [${newName}] بنجاح!* 🎉`, { replyTo: msg.message_id });
        } else {
            await sendTelegramMessage(token, chatId, `❌ لم يتم العثور على بوت مسجل برقم (+${targetPhone})!`, { replyTo: msg.message_id });
        }
        return;
    }

    if (normalizedBody.startsWith('تعديل نداء ') || normalizedBody.startsWith('تغيير نداء ') || normalizedBody.startsWith('تعديل اسم النداء ')) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (@Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        const cleanCmd = text.replace(/^(تعديل اسم النداء|تعديل نداء|تغيير نداء)\s*/i, '').trim();
        const parts = cleanCmd.split(/\s+/);
        const targetPhone = cleanPhoneNumber(parts[0]);
        const newCallName = parts.slice(1).join(' ').trim();
        if (!targetPhone || !newCallName) {
            await sendTelegramMessage(token, chatId, `⚠️ برجاء كتابة رقم البوت واسم النداء الجديد، مثال:\n\`تعديل نداء 201012345678 زعيم\``, { replyTo: msg.message_id });
            return;
        }
        const ok = updateSubBotCallName(targetPhone, newCallName);
        if (ok) {
            await sendTelegramMessage(token, chatId, `✅ *تم تغيير اسم النداء للبوت (+${targetPhone}) إلى [${newCallName}] بنجاح!* 🎉`, { replyTo: msg.message_id });
        } else {
            await sendTelegramMessage(token, chatId, `❌ لم يتم العثور على بوت مسجل برقم (+${targetPhone})!`, { replyTo: msg.message_id });
        }
        return;
    }

    // أوامر الحج شادو لإدارة جلسة البوت الأساسي المحظورة وتغيير الرقم
    if (['حذف جلسة الرئيسي', 'تنظيف جلسة الرئيسي', 'مسح الجلسة', 'حذف الجلسة', 'حذف_الجلسة'].includes(normalizedBody)) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للمطور الأصلي (الحج شادو @Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        try {
            const fs = await import('fs');
            const path = await import('path');
            const sessionDir = path.join(process.cwd(), 'session_data');
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
            await sendTelegramMessage(token, chatId, `✅ *تم حذف ومسح بيانات جلسة البوت الأساسي (session_data) بنجاح يا حج شادو!* 🧹\nالآن يمكنك كتابة: *(ربط الرئيسي <رقم_الهاتف>)* لربط رقمك الجديد فوراً واستخراج كود الاقتران!`, { replyTo: msg.message_id });
        } catch (e) {
            await sendTelegramMessage(token, chatId, `❌ حدث خطأ أثناء حذف الجلسة: ${e?.message || e}`, { replyTo: msg.message_id });
        }
        return;
    }

    if (
        normalizedBody.startsWith('ربط الرئيسي ') || 
        normalizedBody.startsWith('تغيير رقم الرئيسي ') || 
        normalizedBody.startsWith('ربط اساسي ') ||
        normalizedBody.startsWith('ربط أساسي ') ||
        normalizedBody.startsWith('ربط واتساب ') ||
        normalizedBody.startsWith('ربط الوتس ') ||
        normalizedBody.startsWith('طلب كود ') ||
        normalizedBody.startsWith('/pair ')
    ) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للمطور الأصلي (الحج شادو @Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        const rawInput = text.replace(/^(ربط الرئيسي|تغيير رقم الرئيسي|ربط اساسي|ربط أساسي|ربط واتساب|ربط الوتس|طلب كود|\/pair)\s*/i, '').replace(/[^0-9]/g, '');
        const newPhone = cleanPhoneNumber(rawInput);
        if (!newPhone || newPhone.length < 10) {
            await sendTelegramMessage(token, chatId, `⚠️ برجاء كتابة رقم الهاتف مع كود الدولة، مثال:\n\`ربط واتساب 01012345678\`\nأو:\n\`ربط واتساب 201129249396\``, { replyTo: msg.message_id });
            return;
        }

        try {
            await sendTelegramMessage(token, chatId, `⏳ *جاري الاتصال وسحب كود اقتران واتساب للرقم (+${newPhone})...*\nبرجاء الانتظار ثوانٍ معدودة! 🚀`, { replyTo: msg.message_id });

            if (typeof global.requestMainWhatsAppPairing === 'function') {
                await global.requestMainWhatsAppPairing(newPhone, async (pairMsg) => {
                    await sendTelegramMessage(token, chatId, pairMsg);
                });
            } else {
                await sendTelegramMessage(token, chatId, `❌ محرك واتساب غير مهيأ حالياً بالسيرفر.`);
            }
        } catch (e) {
            await sendTelegramMessage(token, chatId, `❌ فشل طلب كود الاقتران: ${e?.message || e}`, { replyTo: msg.message_id });
        }
        return;
    }

    if (['ربط واتساب', 'ربط الوتس', 'ربط الرئيسي', 'ربط اساسي', '/pair'].includes(normalizedBody)) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (@Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        await sendTelegramMessage(token, chatId, `⚠️ برجاء كتابة رقم الهاتف المراد ربطه بعد الأمر، مثال:\n\`ربط واتساب 01012345678\`\nأو:\n\`ربط واتساب 201129249396\``, { replyTo: msg.message_id });
        return;
    }

    // 👑 أوامر رفع وتنزيل الحجاج - للحج شادو فقط
    if (normalizedBody.startsWith('رفع حج اساسي') || normalizedBody.startsWith('رفع حج أساسي') || (normalizedBody.startsWith('رفع حج') && !normalizedBody.includes('مساعد'))) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (@Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        let target = text.replace(/^(رفع حج اساسي|رفع حج أساسي|رفع حج)\s*/i, '').trim().replace(/^@/, '');
        let targetId = null;
        if (msg.reply_to_message?.from) {
            target = msg.reply_to_message.from.username || msg.reply_to_message.from.first_name;
            targetId = String(msg.reply_to_message.from.id);
        }
        if (!target && !targetId) {
            await sendTelegramMessage(token, chatId, `⚠️ منشن الشخص أو اكتب يوزره/آيديه أو رقم هاتفه أو رد على رسالته لترقيته حج!`, { replyTo: msg.message_id });
            return;
        }
        if (!localDB.telegramOwners) localDB.telegramOwners = [];
        if (!localDB.mainHajjUsers) localDB.mainHajjUsers = [];
        if (!localDB.hajjUsers) localDB.hajjUsers = [];

        const rawDigits = target.replace(/[^0-9]/g, '');
        const isPhone = !targetId && rawDigits.length >= 8 && rawDigits.length <= 15;

        if (isPhone) {
            const cleanPhone = cleanPhoneNumber(rawDigits);
            if (!localDB.mainHajjUsers.includes(cleanPhone)) localDB.mainHajjUsers.push(cleanPhone);
            if (!localDB.mainHajjUsers.includes(`${cleanPhone}@s.whatsapp.net`)) localDB.mainHajjUsers.push(`${cleanPhone}@s.whatsapp.net`);
            if (!localDB.hajjUsers.includes(cleanPhone)) localDB.hajjUsers.push(cleanPhone);
            if (!localDB.hajjUsers.includes(`${cleanPhone}@s.whatsapp.net`)) localDB.hajjUsers.push(`${cleanPhone}@s.whatsapp.net`);
            if (!localDB.telegramOwners.includes(cleanPhone)) localDB.telegramOwners.push(cleanPhone);

            if (localDB.lidMap && localDB.lidMap[cleanPhone]) {
                const lid = localDB.lidMap[cleanPhone];
                if (!localDB.mainHajjUsers.includes(lid)) localDB.mainHajjUsers.push(lid);
                if (!localDB.mainHajjUsers.includes(`${lid}@lid`)) localDB.mainHajjUsers.push(`${lid}@lid`);
                if (!localDB.hajjUsers.includes(lid)) localDB.hajjUsers.push(lid);
                if (!localDB.hajjUsers.includes(`${lid}@lid`)) localDB.hajjUsers.push(`${lid}@lid`);
            }

            saveLocalDB(localDB);
            await sendTelegramMessage(token, chatId, `👑🕋 *أمر ملكي سامي من الحج شادو الأصلي:*\nتم ترقية الرقم [+${cleanPhone}] إلى رتبة [ حج أساسي ] في شادو بوت وكافة البوتات بكامل الصلاحيات! 🎉✨`, { replyTo: msg.message_id });
            return;
        }

        if (target && !localDB.telegramOwners.includes(target)) localDB.telegramOwners.push(target);
        if (targetId && !localDB.telegramOwners.includes(targetId)) localDB.telegramOwners.push(targetId);
        if (targetId) {
            if (!localDB.mainHajjUsers.includes(`tg_${targetId}`)) localDB.mainHajjUsers.push(`tg_${targetId}`);
            if (!localDB.hajjUsers.includes(`tg_${targetId}`)) localDB.hajjUsers.push(`tg_${targetId}`);
        }
        saveLocalDB(localDB);
        await sendTelegramMessage(token, chatId, `👑🕋 *أمر ملكي سامي من الحج شادو الأصلي:* \nتم ترقية [ @${target || targetId} ] إلى رتبة [ حج أساسي ] في شادو بوت بكامل الصلاحيات! 🎉✨`, { replyTo: msg.message_id });
        return;
    }

    if (normalizedBody.startsWith('تنزيل حج') || normalizedBody.startsWith('نزل حج')) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (@Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        let target = text.replace(/^(تنزيل حج|نزل حج)\s*/i, '').trim().replace(/^@/, '');
        let targetId = null;
        if (msg.reply_to_message?.from) {
            target = msg.reply_to_message.from.username || msg.reply_to_message.from.first_name;
            targetId = String(msg.reply_to_message.from.id);
        }
        if (!target && !targetId) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب يوزر الشخص أو رقم هاتفه أو رد على رسالته لتنزيله من رتبة الحج!`, { replyTo: msg.message_id });
            return;
        }
        if (target.toLowerCase() === 'shadwwmy' || target === '194961618301016' || target === '201129249396' || target === '01129249396') {
            await sendTelegramMessage(token, chatId, `❌ هوب هوب يا فنان! ده الحج شادو الأصلي صاحب البوت ومحدش يقدر ينزله نهائياً! 👑🛡️`, { replyTo: msg.message_id });
            return;
        }

        const rawDigits = target.replace(/[^0-9]/g, '');
        const isPhone = !targetId && rawDigits.length >= 8 && rawDigits.length <= 15;

        if (isPhone) {
            const cleanPhone = cleanPhoneNumber(rawDigits);
            if (cleanPhone === '201129249396' || cleanPhone === '01129249396') {
                await sendTelegramMessage(token, chatId, `❌ هوب هوب يا فنان! ده الحج شادو الأصلي صاحب البوت ومحدش يقدر ينزله نهائياً! 👑🛡️`, { replyTo: msg.message_id });
                return;
            }
            if (localDB.mainHajjUsers) {
                localDB.mainHajjUsers = localDB.mainHajjUsers.filter(u => u !== cleanPhone && u !== `${cleanPhone}@s.whatsapp.net`);
            }
            if (localDB.hajjUsers) {
                localDB.hajjUsers = localDB.hajjUsers.filter(u => u !== cleanPhone && u !== `${cleanPhone}@s.whatsapp.net`);
            }
            if (localDB.telegramOwners) {
                localDB.telegramOwners = localDB.telegramOwners.filter(u => u !== cleanPhone);
            }
            if (localDB.lidMap && localDB.lidMap[cleanPhone]) {
                const lid = localDB.lidMap[cleanPhone];
                if (localDB.mainHajjUsers) localDB.mainHajjUsers = localDB.mainHajjUsers.filter(u => u !== lid && u !== `${lid}@lid`);
                if (localDB.hajjUsers) localDB.hajjUsers = localDB.hajjUsers.filter(u => u !== lid && u !== `${lid}@lid`);
            }
            saveLocalDB(localDB);
            await sendTelegramMessage(token, chatId, `📉 تم تنزيل الرقم [+${cleanPhone}] من رتبة الحج وسحب صلاحياته بنجاح!`, { replyTo: msg.message_id });
            return;
        }

        if (localDB.telegramOwners) {
            localDB.telegramOwners = localDB.telegramOwners.filter(u => u !== target && u !== targetId && u !== `@${target}`);
        }
        if (localDB.mainHajjUsers && targetId) {
            localDB.mainHajjUsers = localDB.mainHajjUsers.filter(u => u !== `tg_${targetId}` && u !== target);
        }
        if (localDB.hajjUsers && targetId) {
            localDB.hajjUsers = localDB.hajjUsers.filter(u => u !== `tg_${targetId}` && u !== target);
        }
        saveLocalDB(localDB);
        await sendTelegramMessage(token, chatId, `📉 تم تنزيل [ @${target || targetId} ] من رتبة الحج وسحب صلاحياته بنجاح!`, { replyTo: msg.message_id });
        return;
    }

    // 👑 أوامر رفع وتنزيل المشرفين والمطورين - للحج شادو الأصلي فقط
    if (normalizedBody.startsWith('رفع ادمن ') || normalizedBody.startsWith('رفع مطور ')) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (@Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        const target = text.replace(/^(رفع ادمن|رفع مطور)\s+/i, '').trim().replace(/^@/, '');
        if (!target) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب يوزر أو آيدي الشخص بعد الأمر، مثال:\n\`رفع ادمن @username\``, { replyTo: msg.message_id });
            return;
        }
        if (!localDB.telegramOwners) localDB.telegramOwners = [];
        if (!localDB.telegramOwners.includes(target)) {
            localDB.telegramOwners.push(target);
            saveLocalDB(localDB);
        }
        await sendTelegramMessage(token, chatId, `👑 *أمر ملكي من الحج شادو:*\n✅ تم ترقية ورفع [ @${target} ] كمشرف/مطور في شادو بوت بنجاح! 🎉`, { replyTo: msg.message_id });
        return;
    }

    if (normalizedBody.startsWith('تنزيل ادمن ') || normalizedBody.startsWith('تنزيل مطور ')) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (@Shadwwmy)! 👑🚫`, { replyTo: msg.message_id });
            return;
        }
        const target = text.replace(/^(تنزيل ادمن|تنزيل مطور)\s+/i, '').trim().replace(/^@/, '');
        if (!target) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب يوزر أو آيدي الشخص بعد الأمر، مثال:\n\`تنزيل ادمن @username\``, { replyTo: msg.message_id });
            return;
        }
        if (target.toLowerCase() === 'shadwwmy' || target === '194961618301016' || target === '201129249396' || target === '01129249396') {
            await sendTelegramMessage(token, chatId, `❌ هوب هوب يا فنان! دا بابا المجال الحج شادو الأصلي.. محدش يقدر ينزله نهائياً! 👑🛡️`, { replyTo: msg.message_id });
            return;
        }
        if (localDB.telegramOwners) {
            localDB.telegramOwners = localDB.telegramOwners.filter(u => u !== target && u !== `@${target}`);
            saveLocalDB(localDB);
        }
        await sendTelegramMessage(token, chatId, `👑 *أمر ملكي من الحج شادو:*\n📉 تم تنزيل وسحب صلاحيات [ @${target} ] بنجاح!`, { replyTo: msg.message_id });
        return;
    }

    // أمر تنصيب فوري سطر واحد: تنصيب <رقم_البوت> <اسم_البوت>
    if (normalizedBody.startsWith('تنصيب ') || normalizedBody.startsWith('/install ')) {
        const parts = text.replace(/^(تنصيب|\/install)\s+/i, '').trim().split(/\s+/);
        const rawPhone = parts[0]?.replace(/[^0-9]/g, '');
        const cleanPhone = cleanPhoneNumber(rawPhone);
        let adminPhone = '201129249396';
        let adminLid = '194961618301016';

        let nameTokens = parts.slice(1);
        if (nameTokens.length >= 2) {
            const lastTok = nameTokens[nameTokens.length - 1].replace(/[^0-9]/g, '');
            if (lastTok && (lastTok.length === 11 || lastTok.length === 12 || lastTok.length === 13)) {
                adminPhone = cleanPhoneNumber(lastTok);
                const db = loadLocalDB();
                if (adminPhone === '201129249396' || adminPhone === '01129249396') {
                    adminPhone = '201129249396';
                    adminLid = '194961618301016';
                } else if (db?.lidMap && db.lidMap[adminPhone]) {
                    adminLid = db.lidMap[adminPhone];
                } else {
                    adminLid = '';
                }
                nameTokens.pop();
            }
        }

        // تسجيل رقم الحج في قائمة الحجاج
        try {
            const db = loadLocalDB();
            if (!db.hajjUsers) db.hajjUsers = [];
            if (!db.hajjUsers.includes(adminPhone)) db.hajjUsers.push(adminPhone);
            const jid = `${adminPhone}@s.whatsapp.net`;
            if (!db.hajjUsers.includes(jid)) db.hajjUsers.push(jid);
            if (adminLid) {
                if (!db.hajjUsers.includes(adminLid)) db.hajjUsers.push(adminLid);
                if (!db.hajjUsers.includes(`${adminLid}@lid`)) db.hajjUsers.push(`${adminLid}@lid`);
            }
            saveLocalDB(db);
        } catch (_) {}

        const botName = nameTokens.join(' ') || 'بوت فرعي';
        const callName = botName.split(' ')[0] || 'فرعي';

        if (!cleanPhone || cleanPhone.length < 10) {
            await sendTelegramMessage(token, chatId, `⚠️ برجاء كتابة رقم الهاتف بشكل صحيح، مثال:\n\`تنصيب 201012345678 بوت الزعيم\`\nأو مع تحديد رقم الحج:\n\`تنصيب 201012345678 بوت الزعيم 201129249396\``, { replyTo: msg.message_id });
            return;
        }

        await sendTelegramMessage(token, chatId, `⏳ *جاري الاتصال وتوليد كود الاقتران للرقم (+${cleanPhone}) باسم [${botName}]...*\n👑 *الحج الأساسي:* +${adminPhone} 🚀`, { replyTo: msg.message_id });

        try {
            await requestSubBotPairing(
                cleanPhone,
                botName,
                callName,
                adminPhone,
                adminLid,
                'male',
                'respectful',
                global.conn,
                `tg:${chatId}`,
                null,
                async (notifyText) => {
                    await sendTelegramMessage(token, chatId, notifyText);
                }
            );
        } catch (fastErr) {
            console.error('❌ [Telegram Fast Pairing Error]:', fastErr);
            await sendTelegramMessage(token, chatId, `❌ فشل استخراج كود الاقتران: ${fastErr?.message || fastErr}`);
        }
        return;
    }

    // أمر تنصيب تفاعلي خطوة بخطوة
    if (['تنصيب', 'تنصيب بوت', 'بوت فرعي', 'كود التنصيب', '/install'].includes(normalizedBody)) {
        telegramInstallState.set(chatId, {
            step: 1,
            targetPhone: '',
            botName: '',
            callName: '',
            personality: 'respectful',
            timer: setTimeout(() => {
                telegramInstallState.delete(chatId);
            }, 5 * 60 * 1000)
        });

        const startInstallMsg = 
            `╭━━━〔 🤖 *نظام تنصيب بوت فرعي سحابي عبر تليجرام* 〕━━━╮\n` +
            `┃ 👑 مرحباً بك في خدمة تنصيب شادو بوت المجانية!\n` +
            `┃ 💡 يمكنك تشغيل نسختك الخاصة من البوت برقم واتسابك.\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `📱 *الخطوة 1 من 5:* \n` +
            `أرسل الآن *رقم هاتف واتساب* الذي تريد تشغيل البوت عليه مع كود الدولة:\n` +
            `مثال: \`201012345678\` أو \`9647901234567\`\n\n` +
            `💡 _اكتب *(الغاء)* في أي وقت للتراجع._`;

        await sendTelegramMessage(token, chatId, startInstallMsg, { replyTo: msg.message_id });
        return;
    }

    // =========================================================================
    // 🎮 4️⃣ قسم الألعاب والمسابقات التفاعلية
    // =========================================================================
    // لعبة عين (حزر فزر)
    if (normalizedBody === 'عين' || normalizedBody === 'حزر فزر') {
        if (activeTelegramGames.has(chatId)) {
            await sendTelegramMessage(token, chatId, `⚠️ هناك لعبة نشطة بالفعل في هذا الشات! جاوب عليها أو اكتب (انسحاب).`, { replyTo: msg.message_id });
            return;
        }

        const item = RIDDLES_EYE[Math.floor(Math.random() * RIDDLES_EYE.length)];
        const timer = setTimeout(async () => {
            if (activeTelegramGames.has(chatId)) {
                activeTelegramGames.delete(chatId);
                await sendTelegramMessage(token, chatId, `⏰ *انتهى الوقت!* محدش عرف يحلها 😴\n💡 الإجابة الصحيحة كانت: *[ ${item.a} ]*`);
            }
        }, 60000);

        activeTelegramGames.set(chatId, {
            type: 'eye',
            question: item.q,
            answer: item.a,
            hint: item.h,
            reward: 500,
            timer
        });

        const gameMsg = 
            `👁️ *لـعـبـة عـيـن (حزر فـزر للأذكـيـاء)* 👁️\n\n` +
            `❓ *السؤال:* « ${item.q} »\n\n` +
            `🎁 الجائزة: *500 نقطة* | ⏱️ الوقت: *60 ثانية*\n` +
            `💡 لطلب مساعدة اكتب: *(تلميح)* | 🛑 للاستسلام اكتب: *(انسحاب)*`;
        await sendTelegramMessage(token, chatId, gameMsg);
        return;
    }

    // لعبة كتكوت (سرعة بديهة)
    if (normalizedBody === 'كتكوت') {
        if (activeTelegramGames.has(chatId)) {
            await sendTelegramMessage(token, chatId, `⚠️ هناك لعبة نشطة بالفعل! جاوب عليها أو اكتب (انسحاب).`, { replyTo: msg.message_id });
            return;
        }

        const item = RIDDLES_KATKOUT[Math.floor(Math.random() * RIDDLES_KATKOUT.length)];
        const timer = setTimeout(async () => {
            if (activeTelegramGames.has(chatId)) {
                activeTelegramGames.delete(chatId);
                await sendTelegramMessage(token, chatId, `⏰ *انتهى الوقت!* 😴\n💡 الإجابة كانت: *[ ${item.a} ]*`);
            }
        }, 60000);

        activeTelegramGames.set(chatId, {
            type: 'katkout',
            question: item.q,
            answer: item.a,
            hint: item.h,
            reward: 500,
            timer
        });

        const gameMsg = 
            `🐣 *لـعـبـة كـتـكـوت (سرعة بديهة)* 🐣\n\n` +
            `❓ *السؤال:* « ${item.q} »\n\n` +
            `🎁 الجائزة: *500 نقطة* | ⏱️ الوقت: *60 ثانية*\n` +
            `💡 للمساعدة اكتب: *(تلميح)* | 🛑 للاستسلام اكتب: *(انسحاب)*`;
        await sendTelegramMessage(token, chatId, gameMsg);
        return;
    }

    // مسابقة عواصم الدول
    if (normalizedBody === 'عواصم' || normalizedBody === 'عاصمة') {
        if (activeTelegramGames.has(chatId)) {
            await sendTelegramMessage(token, chatId, `⚠️ هناك لعبة نشطة بالفعل! جاوب عليها أو اكتب (انسحاب).`, { replyTo: msg.message_id });
            return;
        }

        const item = CAPITALS_DATA[Math.floor(Math.random() * CAPITALS_DATA.length)];
        const timer = setTimeout(async () => {
            if (activeTelegramGames.has(chatId)) {
                activeTelegramGames.delete(chatId);
                await sendTelegramMessage(token, chatId, `⏰ *انتهى الوقت!* عاصمة *${item.country}* هي: *[ ${item.capital} ]* 🌍`);
            }
        }, 60000);

        activeTelegramGames.set(chatId, {
            type: 'capital',
            question: item.country,
            answer: item.capital,
            hint: `عاصمة شهيرة تبدأ بحرف (${item.capital[0]})`,
            reward: 500,
            timer
        });

        const gameMsg = 
            `🗺️ *مـسـابـقـة عـواصـم الـدول* 🗺️\n\n` +
            `❓ ما هي عاصمة دولة: *« ${item.country} »* ؟\n\n` +
            `🎁 الجائزة: *500 نقطة* | ⏱️ الوقت: *60 ثانية*\n` +
            `💡 للمساعدة اكتب: *(تلميح)* | 🛑 للاستسلام اكتب: *(انسحاب)*`;
        await sendTelegramMessage(token, chatId, gameMsg);
        return;
    }

    // لعبة احسب (رياضيات سريعة)
    if (normalizedBody === 'احسب' || normalizedBody === 'مسالة') {
        if (activeTelegramGames.has(chatId)) {
            await sendTelegramMessage(token, chatId, `⚠️ هناك لعبة نشطة بالفعل! جاوب عليها أو اكتب (انسحاب).`, { replyTo: msg.message_id });
            return;
        }

        const ops = ['+', '-', '*'];
        const op = ops[Math.floor(Math.random() * ops.length)];
        let num1 = Math.floor(Math.random() * 40) + 10;
        let num2 = Math.floor(Math.random() * 20) + 5;
        let ans = 0;
        if (op === '+') ans = num1 + num2;
        else if (op === '-') ans = num1 - num2;
        else if (op === '*') { num1 = Math.floor(Math.random() * 12) + 2; num2 = Math.floor(Math.random() * 12) + 2; ans = num1 * num2; }

        const timer = setTimeout(async () => {
            if (activeTelegramGames.has(chatId)) {
                activeTelegramGames.delete(chatId);
                await sendTelegramMessage(token, chatId, `⏰ *انتهى الوقت!* الناتج كان: *[ ${ans} ]* 🔢`);
            }
        }, 45000);

        activeTelegramGames.set(chatId, {
            type: 'math',
            question: `${num1} ${op} ${num2}`,
            answer: String(ans),
            hint: `العدد قريب من ${ans > 10 ? ans - 2 : ans + 2}`,
            reward: 500,
            timer
        });

        const mathMsg = 
            `🔢 *تـحـدي الـريـاضـيـات والـذكـاء* 🔢\n\n` +
            `❓ احسب الناتج فوراً: *« ${num1} ${op} ${num2} »* ؟\n\n` +
            `🎁 الجائزة: *500 نقطة* | ⏱️ الوقت: *45 ثانية*`;
        await sendTelegramMessage(token, chatId, mathMsg);
        return;
    }

    // سؤال ديني
    if (normalizedBody === 'دين' || normalizedBody === 'سؤال ديني') {
        if (activeTelegramGames.has(chatId)) {
            await sendTelegramMessage(token, chatId, `⚠️ هناك لعبة نشطة بالفعل! جاوب عليها أو اكتب (انسحاب).`, { replyTo: msg.message_id });
            return;
        }

        const item = ISLAMIC_QUIZ[Math.floor(Math.random() * ISLAMIC_QUIZ.length)];
        const timer = setTimeout(async () => {
            if (activeTelegramGames.has(chatId)) {
                activeTelegramGames.delete(chatId);
                await sendTelegramMessage(token, chatId, `⏰ *انتهى الوقت!* الإجابة الصحيحة: *[ ${item.a} ]* 🕌`);
            }
        }, 60000);

        activeTelegramGames.set(chatId, {
            type: 'islamic',
            question: item.q,
            answer: item.a,
            hint: `الإجابة تتكون من (${item.a.length}) حروف`,
            reward: 500,
            timer
        });

        const islamicMsg = 
            `🕌 *سـؤال ومـعـلـومـة إسـلامـيـة* 🕌\n\n` +
            `❓ *السؤال:* « ${item.q} »\n\n` +
            `🎁 الجائزة: *500 نقطة* | ⏱️ الوقت: *60 ثانية*`;
        await sendTelegramMessage(token, chatId, islamicMsg);
        return;
    }

    // لعبة الصراحة
    if (['صراحه', 'صراحة'].includes(normalizedBody)) {
        const q = SARAHA_QUESTIONS[Math.floor(Math.random() * SARAHA_QUESTIONS.length)];
        await sendTelegramMessage(token, chatId, `🎯 *سؤال صراحة لك يا @${fromUsername || username}:*\n\n« ${q} »\n\nجاوب بصراحة وبدون هروب! 😉🔥`, { replyTo: msg.message_id });
        return;
    }

    // لعبة لو خيروك
    if (['لو خيروك', 'لوخيروك'].includes(normalizedBody)) {
        const d = DILEMMAS_LIST[Math.floor(Math.random() * DILEMMAS_LIST.length)];
        await sendTelegramMessage(token, chatId, `🤔 *تحدي لو خيروك يا @${fromUsername || username}:*\n\n« ${d} »\n\nاختار إيه وقولنا ليه؟ ⚡`, { replyTo: msg.message_id });
        return;
    }

    // لعبة الروليت بالنقاط
    if (normalizedBody === 'روليت' || normalizedBody === 'الروليت') {
        const userPts = userData.points || 0;
        if (userPts < 100 && !isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ رصيدك قليل يا بطل! محتاج 100 نقطة على الأقل للعب الروليت. (رصيدك: ${userPts})`, { replyTo: msg.message_id });
            return;
        }

        const outcomes = ['win', 'lose', 'jackpot'];
        const lucky = outcomes[Math.floor(Math.random() * outcomes.length)];
        if (lucky === 'jackpot' || isHajjShado) {
            userData.points += 1000;
            saveLocalDB(localDB);
            await sendTelegramMessage(token, chatId, `🎰💥 *جاكبوت روليت عالمي!* 🎉\nضربت معاك في المليان وكسبت *1000* نقطة كاملة! 💰\nرصيدك الآن: [ *${userData.points}* ] نقطة.`, { replyTo: msg.message_id });
        } else if (lucky === 'win') {
            userData.points += 300;
            saveLocalDB(localDB);
            await sendTelegramMessage(token, chatId, `🎯 *مبروك يا كينج! نجوت وكسبت في الروليت!* 🔫✨\nربحت *300* نقطة! رصيدك الآن: [ *${userData.points}* ] نقطة.`, { replyTo: msg.message_id });
        } else {
            userData.points = Math.max(0, userData.points - 150);
            saveLocalDB(localDB);
            await sendTelegramMessage(token, chatId, `💥 *طاااخ! الرصاصة كانت في حجرتك وخسرت في الروليت!* 💀\nتم خصم 150 نقطة. رصيدك المتبقي: [ *${userData.points}* ] نقطة.`, { replyTo: msg.message_id });
        }
        return;
    }

    // لعبة كورة (تخمين لاعب من الإيموجي والمعلومات)
    if (['كورة', 'كوره', 'لاعب', 'كوره قدم', 'كورة قدم'].includes(normalizedBody)) {
        if (activeTelegramGames.has(chatId)) {
            await sendTelegramMessage(token, chatId, `⚠️ هناك مسابقة نشطة بالفعل في هذا الشات! جاوب عليها أو اكتب (انسحاب).`, { replyTo: msg.message_id });
            return;
        }
        const players = [
            { q: '🇦🇷 🔟 🐐 ⚽ نادي إنتر ميامي', a: 'ميسي', hint: 'البرغوث الأرجنتيني' },
            { q: '🇵🇹 7️⃣ 👑 ⚽ نادي النصر السعودي', a: 'رونالدو', hint: 'صاروخ ماديرا الدون' },
            { q: '🇪🇬 1️⃣1️⃣ 👑 ⚽ نادي ليفربول', a: 'محمد صلاح', hint: 'فخر العرب والملك المصري' },
            { q: '🇧🇷 🔟 🪄 ⚽ نادي الهلال السعودي', a: 'نيمار', hint: 'ساحر السامبا' },
            { q: '🇫🇷 9️⃣ ⚽ نادي ريال مدريد', a: 'مبابي', hint: 'القطار الفرنسي السريع' },
            { q: '🇧🇪 1️⃣7️⃣ 🎯 ⚽ نادي مانشستر سيتي', a: 'دي بروين', hint: 'مهندس التمريرات الحاسمة' },
            { q: '🇳🇴 9️⃣ 🤖 ⚽ نادي مانشستر سيتي', a: 'هالاند', hint: 'الوحش النرويجي الهداف' },
            { q: '🇩🇿 7️⃣ ⚽ نادي الأهلي السعودي', a: 'رياض محرز', hint: 'ساحر الجزائر ومحرز الأهداف' },
            { q: '🇪🇸 1️⃣9️⃣ ⚽ نادي برشلونة', a: 'لامين يامال', hint: 'الموهبة الإسبانية الصاعدة' }
        ];
        const chosen = players[Math.floor(Math.random() * players.length)];
        const timer = setTimeout(async () => {
            if (activeTelegramGames.has(chatId)) {
                activeTelegramGames.delete(chatId);
                await sendTelegramMessage(token, chatId, `⏰ *انتهى الوقت!* محدش عرف اللاعب ⚽\n💡 اللاعب هو: *[ ${chosen.a} ]*`);
            }
        }, 60000);
        activeTelegramGames.set(chatId, { answer: chosen.a, hint: chosen.hint, reward: 500, timer });
        await sendTelegramMessage(token, chatId, `⚽ *لعبة خمن اللاعب من الإيموجي والمعلومات:* ⚽\n\n${chosen.q}\n\n💡 اكتب اسم اللاعب فوراً! (+500 نقطة) ⚡\n_معك دقيقة واحدة للإجابة أو اكتب (تلميح) أو (انسحاب)._`, { replyTo: msg.message_id });
        return;
    }

    // لعبة أفلام (تخمين الفيلم من القصة والإيموجي)
    if (['افلام', 'فيلم', 'أفلام', 'سينما'].includes(normalizedBody)) {
        if (activeTelegramGames.has(chatId)) {
            await sendTelegramMessage(token, chatId, `⚠️ هناك مسابقة نشطة بالفعل في هذا الشات! جاوب عليها أو اكتب (انسحاب).`, { replyTo: msg.message_id });
            return;
        }
        const movies = [
            { q: '🚢 ❄️ 💔 🌊 غرق سفينة عملاقة في المحيط الأطلسي وقصة حب جاك وروز الشهيرة', a: 'تيتانيك', hint: 'سفينة الأحلام التي لا تغرق' },
            { q: '🦁 👑 🌅 🐗 شبل صغير يموت والده الملك ويهرب ثم يعود لاستعادة مملكته', a: 'الاسد الملك', hint: 'سيمبا وموفاسا' },
            { q: '🦇 🃏 🏙️ 🤡 بطل الليل المقنع يواجه الجوكر الشرير في مدينة جوثام', a: 'باتمان', hint: 'فارس الظلام (Dark Knight)' },
            { q: '🧙‍♂️ 💍 🌋 🧝‍♂️ هوبيت صغير يذهب في رحلة ملحمية لتدمير الخاتم الأوحد في جبل الهلاك', a: 'سيد الخواتم', hint: 'Lord of the Rings (فرودو)' },
            { q: '🕷️ 🧑‍🎓 🕸️ 🏙️ طالب ثانوي تلدغه عنكبوت معدلة جينياً فيكتسب قوى خارقة لإنقاذ المدينة', a: 'سبايدرمان', hint: 'بيتر باركر والرجل العنكبوت' },
            { q: '🪄 👓 ⚡ 🏰 فتى يتيم يكتشف أنه ساحر ويذهب للدراسة في مدرسة هوجوورتس للسحر', a: 'هاري بوتر', hint: 'الولد صاحب الندبة على جبينه' }
        ];
        const chosen = movies[Math.floor(Math.random() * movies.length)];
        const timer = setTimeout(async () => {
            if (activeTelegramGames.has(chatId)) {
                activeTelegramGames.delete(chatId);
                await sendTelegramMessage(token, chatId, `⏰ *انتهى الوقت!* محدش عرف الفيلم 🎬\n💡 الفيلم هو: *[ ${chosen.a} ]*`);
            }
        }, 60000);
        activeTelegramGames.set(chatId, { answer: chosen.a, hint: chosen.hint, reward: 500, timer });
        await sendTelegramMessage(token, chatId, `🎬 *لعبة خمن اسم الفيلم من القصة والإيموجي:* 🍿\n\n${chosen.q}\n\n💡 اكتب اسم الفيلم فوراً! (+500 نقطة) ⚡\n_معك دقيقة واحدة للإجابة أو اكتب (تلميح) أو (انسحاب)._`, { replyTo: msg.message_id });
        return;
    }

    // لعبة رتب حروف الكلمة
    if (['رتب', 'ترتيب'].includes(normalizedBody)) {
        if (activeTelegramGames.has(chatId)) {
            await sendTelegramMessage(token, chatId, `⚠️ هناك مسابقة نشطة بالفعل في هذا الشات! جاوب عليها أو اكتب (انسحاب).`, { replyTo: msg.message_id });
            return;
        }
        const words = [
            { original: 'كمبيوتر', scrambled: 'ر ي ت و ب م ك', hint: 'جهاز حاسوب مكتبي' },
            { original: 'فلسطين', scrambled: 'ن ي ط س ل ف', hint: 'دولة عربية حرة وعاصمتها القدس الشريف' },
            { original: 'مستشفى', scrambled: 'ى ف ش ت س م', hint: 'مكان علاج وفحص المرضى' },
            { original: 'برشلونة', scrambled: 'ة ن و ل ش ر ب', hint: 'نادي كروي إسباني كتالوني شهير' },
            { original: 'شوكولاتة', scrambled: 'ة ت ل و ك و ش', hint: 'حلوى لذيذة تصنع من حبوب الكاكاو' },
            { original: 'طائرة', scrambled: 'ة ر ئ ا ط', hint: 'وسيلة نقل تطير بين السحاب' },
            { original: 'مكتبة', scrambled: 'ة ب ت ك م', hint: 'مكان حفظ وقراءة واستعارة الكتب' }
        ];
        const chosen = words[Math.floor(Math.random() * words.length)];
        const timer = setTimeout(async () => {
            if (activeTelegramGames.has(chatId)) {
                activeTelegramGames.delete(chatId);
                await sendTelegramMessage(token, chatId, `⏰ *انتهى الوقت!* 😴\n💡 الكلمة المرتبة الصحيحة هي: *[ ${chosen.original} ]*`);
            }
        }, 60000);
        activeTelegramGames.set(chatId, { answer: chosen.original, hint: chosen.hint, reward: 500, timer });
        await sendTelegramMessage(token, chatId, `🔤 *لعبة رتب حروف الكلمة:* 🧩\n\nالحروف المبعثرة: *[ ${chosen.scrambled} ]*\n\n💡 اكتب الكلمة الصحيحة مرتبة فوراً! (+500 نقطة) ⚡`, { replyTo: msg.message_id });
        return;
    }

    // لعبة بازل
    if (['بازل', 'البازل'].includes(normalizedBody)) {
        await sendTelegramMessage(token, chatId, `🧩 *لعبة البازل الذكية (ترتيب الأرقام):*\n\n1️⃣ 2️⃣ 3️⃣\n4️⃣ 5️⃣ 6️⃣\n7️⃣ 8️⃣ ⬜\n\n🎯 الهدف: ترتيب الأرقام من 1 إلى 8 بذكاء!\nاكتب *(فوق)* أو *(تحت)* أو *(يمين)* أو *(شمال)* لتحريك المربع الفارغ.\nاكتب *(استسلام بازل)* للخروج.`);
        return;
    }

    // لعبة وشرح بكاسة
    if (['بكاسة', 'بكاسه', 'بكاسة شرح', 'شرح بكاسة'].includes(normalizedBody)) {
        const bakasaExplain = 
            `🕵️‍♂️ *شرح لعبة بكاسة (الحرامي والمواطنين):* 🎭\n\n` +
            `📌 *فكرة اللعبة:* لعبة غموض وخداع ذكية بين المواطنين وحرامي متخفي بينهم!\n\n` +
            `🔹 *طريقة اللعب:*\n` +
            `1️⃣ البوت بيختار كلمة سرية لكل المواطنين في الخاص، ما عدا الحرامي مش هيعرفها!\n` +
            `2️⃣ كل لاعب بيسأل سؤال تلميحي ذكي للطرف التاني بدون ما يكشف الكلمة للحرامي.\n` +
            `3️⃣ لما تخلصوا النقاش، بيبدأ التصويت على مين الحرامي!\n` +
            `4️⃣ الحرامي بيحاول يخمن الكلمة من اختيارات.\n\n` +
            `🪙 المصوت الصح يكسب 100 نقطة، والحرامي لو خمن صح يكسب 100 نقطة! 🏆\n` +
            `✨ العبها في الجروب مع أصحابك واستمتع!`;
        await sendTelegramMessage(token, chatId, bakasaExplain, { replyTo: msg.message_id });
        return;
    }

    // =========================================================================
    // 💰 5️⃣ قسم النقاط والبنك واللفلات
    // =========================================================================
    if (['نقاطي', 'رصيدي', 'فلوسي', 'حسابي'].includes(normalizedBody)) {
        const role = isHajjShado ? '👑 الحج شادو المطور الأصلي' : (userData.level > 50 ? '⚔️ فارس شادو' : '👤 عضو مميز');
        const ptsMsg = 
            `╭━━━〔 💰 *بطاقة الحساب والرصيد* 〕━━━╮\n` +
            `┃ 👤 *الاسم:* @${fromUsername || username}\n` +
            `┃ 🎖️ *الرتبة:* ${role}\n` +
            `┃ 🪙 *النقاط:* ${isHajjShado ? 'لا نهائي ♾️' : (userData.points || 0)} نقطة\n` +
            `┃ 🏆 *المستوى:* لفل ${userData.level || 1}\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `💡 العب واكسب نقاط إضافية بأوامر: *(عين - كتكوت - عواصم - روليت)*`;
        await sendTelegramMessage(token, chatId, ptsMsg, { replyTo: msg.message_id });
        return;
    }

    if (['لفلي', 'مستواي', 'رتبتي'].includes(normalizedBody)) {
        await sendTelegramMessage(token, chatId, `🏆 مستواك الحالي: *[ لفل ${userData.level || 1} ]* ⚡\nشد حيلك والعب عشان ترفع لفلك وتتصدر قائمة الأغنياء!`, { replyTo: msg.message_id });
        return;
    }

    // المكافأة اليومية (راتب / يومي)
    if (['راتب', 'يومي', 'مكافأة', 'مكافاتي'].includes(normalizedBody)) {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const lastDaily = userData.lastDailyClaim || 0;

        if (now - lastDaily < oneDay && !isHajjShado) {
            const remHours = Math.ceil((oneDay - (now - lastDaily)) / (60 * 60 * 1000));
            await sendTelegramMessage(token, chatId, `⏳ أخدت راتبك اليومي بالفعل يا غالي! تعالى بعد: *${remHours}* ساعة. 🎁`, { replyTo: msg.message_id });
            return;
        }

        userData.lastDailyClaim = now;
        userData.points = (userData.points || 0) + 500;
        saveLocalDB(localDB);

        await sendTelegramMessage(token, chatId, `🎁 *مبروك! تم صرف راتبك اليومي بنجاح (+500 نقطة)!* 💰\nرصيدك الحالي: [ *${userData.points}* ] نقطة. استمتع! ✨`, { replyTo: msg.message_id });
        return;
    }

    // توب الأغنياء
    if (['توب', 'المتصدرين', 'الاغنياء', 'توب النقاط'].includes(normalizedBody)) {
        const entries = Object.entries(localDB.users || {});
        entries.sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
        const top10 = entries.slice(0, 10);

        let topText = `╭━━━〔 🏆 *قائمة توب 10 أغنى لاعبين* 〕━━━╮\n`;
        top10.forEach((item, idx) => {
            const u = item[1];
            const name = u.name || (u.telegramUsername ? `@${u.telegramUsername}` : 'لاعب مجهول');
            topText += `┃ ${idx + 1}️⃣ ${name} ➔ *${u.isInfinite ? 'لا نهائي 👑' : (u.points || 0)}* نقطة\n`;
        });
        topText += `╰━━━━━━━━━━━━━━━━━━━━╯`;

        await sendTelegramMessage(token, chatId, topText, { replyTo: msg.message_id });
        return;
    }

    // إعطاء نقاط (للحج شادو فقط)
    // إعطاء نقاط / فلوس (للحج شادو فقط)
    if (
        normalizedBody.startsWith('اعطي ') || normalizedBody.startsWith('اعطي') ||
        normalizedBody.startsWith('اعطاء ') || normalizedBody.startsWith('اعطاء') ||
        normalizedBody.startsWith('زيد ') || normalizedBody.startsWith('زيد')
    ) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر الملكي مخصص حصرياً للحج شادو! 👑`, { replyTo: msg.message_id });
            return;
        }

        const isInfiniteCommand = normalizedBody.includes('لا نهائي') || normalizedBody.includes('لانهايي') || normalizedBody.includes('لا نهايه') || normalizedBody.includes('لانهايه');
        const replyUser = msg.reply_to_message?.from;
        if (!replyUser && !isInfiniteCommand) {
            await sendTelegramMessage(token, chatId, `⚠️ رد على رسالة الشخص واكتب: \`اعطي 5000\` أو \`اعطي فلوس 5000\``, { replyTo: msg.message_id });
            return;
        }

        const targetId = replyUser ? replyUser.id : fromId;
        const targetName = replyUser ? (replyUser.username ? `@${replyUser.username}` : replyUser.first_name) : `@${fromUsername || username}`;
        const targetKey = `tg_${targetId}`;
        if (!localDB.users[targetKey]) {
            localDB.users[targetKey] = { name: targetName, points: 1000, level: 1 };
        }

        if (isInfiniteCommand) {
            localDB.users[targetKey].points = 999999999999;
            localDB.users[targetKey].level = 999;
            localDB.users[targetKey].isInfinite = true;
            saveLocalDB(localDB);

            await sendTelegramMessage(token, chatId, `👑 *أمر ملكي من الحج الأصلي:*\n✅ تم منح رصيد نقاط [ ♾️ لا نهائي ] ومستوى 999 إلى ${targetName} بنجاح! 👑🎉`, { replyTo: msg.message_id });
            return;
        }

        let amount = 0;
        if (normalizedBody.includes('مليون')) amount = 1000000;
        else if (normalizedBody.includes('مليار')) amount = 1000000000;
        else amount = parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;

        if (amount <= 0) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب عدد النقاط المطلوب زيادتها، مثال:\n\`اعطي 5000\` (بالرد على الشخص)`, { replyTo: msg.message_id });
            return;
        }

        localDB.users[targetKey].points += amount;
        saveLocalDB(localDB);

        await sendTelegramMessage(token, chatId, `👑🕋 *أمر ملكي سامي من الحج شادو:* \nتم منح العضو ${targetName} عدد *${amount.toLocaleString('ar-EG')}* نقطة بنجاح! 🎉\nرصيده الجديد: [ *${localDB.users[targetKey].points.toLocaleString('ar-EG')}* ] نقطة.`, { replyTo: msg.message_id });
        return;
    }

    // سحب نقاط / فلوس (للحج شادو فقط)
    if (
        normalizedBody.startsWith('سحب ') || normalizedBody.startsWith('سحب') ||
        normalizedBody.startsWith('اخصم ') || normalizedBody.startsWith('اخصم')
    ) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ أمر السحب مخصص حصرياً للحج شادو! 👑`, { replyTo: msg.message_id });
            return;
        }
        const replyUser = msg.reply_to_message?.from;
        if (!replyUser) {
            await sendTelegramMessage(token, chatId, `⚠️ رد على رسالة الشخص واكتب: \`سحب 5000\` أو \`سحب كل النقاط\``, { replyTo: msg.message_id });
            return;
        }
        const targetKey = `tg_${replyUser.id}`;
        if (!localDB.users[targetKey]) {
            localDB.users[targetKey] = { name: replyUser.first_name, points: 1000, level: 1 };
        }

        const isClearAll = normalizedBody.includes('كل') || normalizedBody.includes('الكل') || normalizedBody.includes('النقاط');
        if (isClearAll) {
            localDB.users[targetKey].points = 0;
            localDB.users[targetKey].isInfinite = false;
            saveLocalDB(localDB);
            await sendTelegramMessage(token, chatId, `👑 *أمر ملكي من الحج شادو:* \n📉 تم سحب وتصفير جميع نقاط @${replyUser.username || replyUser.first_name} بنجاح! 💸`, { replyTo: msg.message_id });
            return;
        }

        let amount = 0;
        if (normalizedBody.includes('مليون')) amount = 1000000;
        else if (normalizedBody.includes('مليار')) amount = 1000000000;
        else amount = parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;

        if (amount <= 0) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب عدد النقاط المطلوب سحبها، مثال:\n\`سحب 5000\` (بالرد على الشخص)`, { replyTo: msg.message_id });
            return;
        }

        localDB.users[targetKey].points = Math.max(0, (localDB.users[targetKey].points || 0) - amount);
        saveLocalDB(localDB);
        await sendTelegramMessage(token, chatId, `🛑 تم سحب *${amount.toLocaleString('ar-EG')}* نقطة من @${replyUser.username || replyUser.first_name} بنجاح!\nرصيده المتبقي: [ *${localDB.users[targetKey].points.toLocaleString('ar-EG')}* ] نقطة.`, { replyTo: msg.message_id });
        return;
    }

    // أمر سجل / تسجيل (تسجيل البروفايل)
    if (normalizedBody.startsWith('سجل') || normalizedBody.startsWith('تسجيل')) {
        const registrationData = text.replace(/^(سجل|تسجيل)\s*/i, '').trim();
        let parts = registrationData ? registrationData.split(/[\|\-\/\,\،]+/).map(p => p.trim()).filter(Boolean) : [];
        if (parts.length < 2 && registrationData) {
            const spaceParts = registrationData.split(/\s+/).filter(Boolean);
            if (spaceParts.length >= 2) parts = spaceParts;
        }
        if (!registrationData || parts.length < 1) {
            await sendTelegramMessage(token, chatId, `*⚠️ طريقة التسجيل الصحيحة:*\n\nاكتب: \`سجل الاسم | السن | الحالة | البايو\`\n(يمكنك استخدام أي فاصل مثل | أو - أو / أو مسافة)\n\nمثال:\n\`سجل ${username} | 20 | مرتبط | شادو بوت الأفضل\``, { replyTo: msg.message_id });
            return;
        }
        const regName = parts[0] ? parts[0].replace(/^(الاسم|الاسم\s*:|اسم\s*:)\s*/i, '').trim() : (userData.name || username);
        const regAge = parts[1] ? parts[1].replace(/^(السن|العمر|السن\s*:|العمر\s*:)\s*/i, '').trim() : (userData.age || '20');
        const regStatus = parts[2] ? parts[2].replace(/^(الحالة|الحاله|الحالة\s*الاجتماعية|الحاله\s*الاجتماعيه)\s*:\s*/i, '').trim() : (userData.status || 'غير مسجل');
        const regBio = parts[3] ? parts[3].replace(/^(البايو|نبذة|نبذه|الوصف)\s*:\s*/i, '').trim() : (userData.bio || 'لا يوجد بايو حالياً');

        userData.name = regName;
        userData.age = regAge;
        userData.status = regStatus;
        userData.bio = regBio;
        userData.hasRegistered = true;
        saveLocalDB(localDB);
        await sendTelegramMessage(token, chatId, `✅ *تم تسجيل وتحديث بطاقتك بنجاح يا ${regName}!* 🪪\n• الاسم: ${regName}\n• السن: ${regAge}\n• الحالة: ${regStatus}\n• البايو: ${regBio}\n• رصيدك: ${isHajjShado ? '♾️ لا نهائي' : userData.points} نقطة\nاكتب *(بطاقتي)* أو *(بروفايل)* لعرض بطاقتك في أي وقت!`, { replyTo: msg.message_id });
        return;
    }

    // أمر بروفايل / بطاقتي / كارتي
    if ([
        'بروفايل', 'بطاقتي', 'بطاقة', 'بطاقه', 'بروفايلي', 'حسابي', 'كارتي', 'كرتي'
    ].includes(normalizedBody)) {
        const isMaster = isHajjShado;
        const profileMsg = 
            `╭━━━〔 🪪 *بطاقة البروفايل الشخصي* 〕━━━╮\n` +
            `┃ 👤 *الاسم:* ${userData.name || username}\n` +
            `┃ 🎂 *السن:* ${userData.age || 'غير محدد'}\n` +
            `┃ 💍 *الحالة:* ${userData.status || 'غير مسجل'}\n` +
            `┃ 📝 *البايو:* ${userData.bio || 'لا يوجد بايو'}\n` +
            `┃ 👑 *الرتبة:* ${isMaster ? '👑 الحج شادو الأصلي' : '🌱 عضو في شادو بوت'}\n` +
            `┃ 🪙 *النقاط:* ${isMaster ? '♾️ لا نهائي' : (userData.points || 0)}\n` +
            `┃ 🏆 *المستوى:* ${isMaster ? '999' : (userData.level || 1)}\n` +
            `┃ 🆔 *الآيدي:* \`${fromId}\`\n` +
            `┃ 📅 *تاريخ الانضمام:* ${userData.joinedAt || 'اليوم'}\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯`;
        await sendTelegramMessage(token, chatId, profileMsg, { replyTo: msg.message_id });
        return;
    }

    // أوامر قفل وفتح الشات في الجروبات
    if (['قفل', 'قفل الروم', 'قفل الشات', '/lock'].includes(normalizedBody)) {
        if (!(await checkIsActualRoomAdminOrOwner())) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص لمشرفين الجروب وللحج فقط! 🛡️`, { replyTo: msg.message_id });
            return;
        }
        const locked = await telegramAction(token, 'setChatPermissions', {
            chat_id: chatId,
            permissions: { can_send_messages: false }
        });
        if (locked) {
            await sendTelegramMessage(token, chatId, `🔒 *تم قفل إرسال الرسائل في المجموعة بنجاح للأعضاء!* 🛑\nلإعادة الفتح اكتب: *(فتح)*.`);
        } else {
            await sendTelegramMessage(token, chatId, `❌ تعذر قفل المجموعة، تأكد من رفع البوت أدمن ولديه صلاحيات إدارة الشات!`);
        }
        return;
    }

    if (['فتح', 'فتح الروم', 'فتح الشات', '/unlock'].includes(normalizedBody)) {
        if (!(await checkIsActualRoomAdminOrOwner())) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص لمشرفين الجروب وللحج فقط! 🛡️`, { replyTo: msg.message_id });
            return;
        }
        const unlocked = await telegramAction(token, 'setChatPermissions', {
            chat_id: chatId,
            permissions: { 
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true
            }
        });
        if (unlocked) {
            await sendTelegramMessage(token, chatId, `🔓 *تم فتح الشات لجميع الأعضاء بنجاح!* يمكن للجميع التحدث الآن بحرية. 🎉`);
        } else {
            await sendTelegramMessage(token, chatId, `❌ تعذر فتح المجموعة، تأكد من صلاحيات البوت الإدارية!`);
        }
        return;
    }

    // أمر رابط الجروب / لينك
    if (['رابط الجروب', 'لينك الجروب', 'لينك', 'رابط'].includes(normalizedBody)) {
        try {
            const res = await axios.post(`https://api.telegram.org/bot${token}/exportChatInviteLink`, { chat_id: chatId });
            if (res.data?.ok && res.data?.result) {
                await sendTelegramMessage(token, chatId, `🔗 *رابط دعوة المجموعة الرسمي:*\n${res.data.result}`);
                return;
            }
        } catch (_) {}
        await sendTelegramMessage(token, chatId, `⚠️ تعذر استخراج الرابط، تأكد من رفع البوت أدمن في المجموعة ولديه صلاحية دعوة المستخدمين!`);
        return;
    }

    // أمر الأغاني (بحث يوتيوب)
    if (normalizedBody.startsWith('اغنية ') || normalizedBody.startsWith('اغنيه ') || normalizedBody.startsWith('شغل ') || normalizedBody.startsWith('أغنية ')) {
        const songQuery = text.replace(/^(اغنية|اغنيه|شغل|أغنية)\s*/i, '').trim();
        if (!songQuery) {
            await sendTelegramMessage(token, chatId, `⚠️ اكتب اسم الأغنية بعد الأمر، مثال:\n\`اغنية عمرو دياب يا انا يا لا\``, { replyTo: msg.message_id });
            return;
        }
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(songQuery)}`;
        const songMsg = 
            `🎵 *نتائج البحث عن أغنية: [ ${songQuery} ]* 🎶\n\n` +
            `🎧 *استمع الآن وشاهد عبر يوتيوب:*\n` +
            `🔗 ${searchUrl}\n\n` +
            `✨ استماع ممتع مع شادو بوت! 🤍`;
        await sendTelegramMessage(token, chatId, songMsg, { replyTo: msg.message_id });
        return;
    }

    // أمر قول (تكرار الكلام)
    if (normalizedBody.startsWith('قول ') || normalizedBody.startsWith('قل ')) {
        const toSay = text.replace(/^(قول|قل)\s*/i, '').trim();
        if (toSay) {
            await sendTelegramMessage(token, chatId, toSay);
            return;
        }
    }

    // أمر ابوك مين
    if (['ابوك مين', 'أبوك مين', 'مين ابوك', 'مين أبوك'].includes(normalizedBody)) {
        await sendTelegramMessage(token, chatId, `أبويا وصاحب فضل عليا هو الحج شادو بابا الكل 👑❤️`, { replyTo: msg.message_id });
        return;
    }

    // أمر المطور
    if (['المطور', 'مطور', 'المالك', 'صاحب البوت'].includes(normalizedBody)) {
        const devMsg = 
            `╭━━━〔 👑 *معلومات مطور ومالك شادو بوت* 〕━━━╮\n` +
            `┃ 👤 *الاسم:* الحج شادو (Shadow)\n` +
            `┃ 📱 *رقم المطور:* +201129249396\n` +
            `┃ 🌐 *يوزر تليجرام المباشر:* @Shadwwmy\n` +
            `┃ 📢 *قناة وبوت شادو الرسمية:* https://t.me/Shadowcomm_bot\n` +
            `┃ 🟢 *قناة الواتساب الرسمية:* https://whatsapp.com/channel/0029VbDsDKlKgsNryj6w0A1F\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `✨ للتنصيب أو الاستفسار تواصل مباشرة مع الحج شادو! ⚡`;
        await sendTelegramMessage(token, chatId, devMsg, { replyTo: msg.message_id });
        return;
    }

    // =========================================================================
    // 🕌 6️⃣ القسم الإسلامي ومواقيت الصلاة والأذكار
    // =========================================================================
    if (['مواقيت الصلاة', 'مواعيد الصلاة', 'الصلوات', 'الاذان', 'الأذان', 'صلاة'].includes(normalizedBody)) {
        const prayerMsg = 
            `╭━━━〔 🕌 *مواقيت الصلاة الرسمية في مصر* 〕━━━╮\n` +
            `• الفجر: *04:55 ص*\n` +
            `• الشروق: *06:25 ص*\n` +
            `• الظهر: *11:42 ص*\n` +
            `• العصر: *02:41 م*\n` +
            `• المغرب: *04:59 م*\n` +
            `• العشاء: *06:19 م*\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🤍 *صلاتك حياتك فلا تؤخرها.. صَلِّ على النبي ﷺ*`;
        await sendTelegramMessage(token, chatId, prayerMsg, { replyTo: msg.message_id });
        return;
    }

    if (['اذكار', 'أذكار', 'ذكر', 'تسبيح', 'استغفار'].includes(normalizedBody)) {
        const zekr = AZKAR_LIST[Math.floor(Math.random() * AZKAR_LIST.length)];
        await sendTelegramMessage(token, chatId, `🌿 *ذكر اليوم المستحب:* \n\n« ${zekr} »\n\n🤍 اذكر الله يذكرك.`, { replyTo: msg.message_id });
        return;
    }

    if (['قران', 'قرآن', 'ايه', 'آية'].includes(normalizedBody)) {
        const verses = [
            '﴿ أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ ﴾ [الرعد: 28] 🤍',
            '﴿ وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مَخْرَجًا وَيَرْزُقْهُ مِنْ حَيْثُ لَا يَحْتَسِبُ ﴾ [الطلاق: 2-3] ✨',
            '﴿ إِنَّ مَعَ الْعُسْرِ يُسْرًا ﴾ [الشرح: 6] 🌸',
            '﴿ وَقَالَ رَبُّكُمُ ادْعُونِي أَسْتَجِبْ لَكُمْ ﴾ [غافر: 60] 🤲',
            '﴿ وَتَوَكَّلْ عَلَى الْحَيِّ الَّذِي لَا يَمُوتُ ﴾ [الفرقان: 58] 💎'
        ];
        const v = verses[Math.floor(Math.random() * verses.length)];
        await sendTelegramMessage(token, chatId, `📖 *آية كريمة مريحة للقلب:* \n\n${v}`, { replyTo: msg.message_id });
        return;
    }

    if (['حديث', 'حديث شريف'].includes(normalizedBody)) {
        const hadiths = [
            'قال رسول الله ﷺ: « مَنْ صَلَّى عَلَيَّ صَلاةً صَلَّى اللَّهُ عَلَيْهِ بِهَا عَشْرًا » [رواه مسلم].',
            'قال رسول الله ﷺ: « خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ » [رواه البخاري].',
            'قال رسول الله ﷺ: « الكَلِمَةُ الطَّيِّبَةُ صَدَقَةٌ » [متفق عليه].',
            'قال رسول الله ﷺ: « احْفَظِ اللَّهَ يَحْفَظْكَ، احْفَظِ اللَّهَ تَجِدْهُ تُجَاهَكَ » [رواه الترمذي].'
        ];
        const h = hadiths[Math.floor(Math.random() * hadiths.length)];
        await sendTelegramMessage(token, chatId, `🌸 *حديث نبوي شريف:* \n\n${h}`, { replyTo: msg.message_id });
        return;
    }

    // =========================================================================
    // 🛡️ 7️⃣ أوامر الإشراف وإدارة مجموعات تليجرام
    // =========================================================================
    // أمر طرد (بالرد على العضو)
    if (['طرد', 'بان', '/kick', '/ban'].includes(normalizedBody)) {
        const replyUser = msg.reply_to_message?.from;
        if (!replyUser) {
            await sendTelegramMessage(token, chatId, `⚠️ رد على رسالة العضو الذي تريد طرده!`, { replyTo: msg.message_id });
            return;
        }

        // فحص صلاحية الأدمن أو الحج
        if (!(await checkIsActualRoomAdminOrOwner())) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص لمشرفين الجروب وللحج فقط! 🛡️`, { replyTo: msg.message_id });
            return;
        }

        const kicked = await telegramAction(token, 'banChatMember', {
            chat_id: chatId,
            user_id: replyUser.id
        });

        if (kicked) {
            await sendTelegramMessage(token, chatId, `👋 تم طرد العضو @${replyUser.username || replyUser.first_name} من المجموعة بنجاح! 🚫`, { replyTo: msg.message_id });
        } else {
            await sendTelegramMessage(token, chatId, `❌ تعذر طرد العضو، تأكد من رفع البوت أدمن ولديه صلاحية الطرد!`, { replyTo: msg.message_id });
        }
        return;
    }

    // أمر كتم (بالرد على العضو)
    if (['كتم', '/mute'].includes(normalizedBody)) {
        const replyUser = msg.reply_to_message?.from;
        if (!replyUser) {
            await sendTelegramMessage(token, chatId, `⚠️ رد على رسالة العضو الذي تريد كتمه!`, { replyTo: msg.message_id });
            return;
        }

        if (!(await checkIsActualRoomAdminOrOwner())) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص لمشرفين الجروب وللحج فقط! 🛡️`, { replyTo: msg.message_id });
            return;
        }

        const muted = await telegramAction(token, 'restrictChatMember', {
            chat_id: chatId,
            user_id: replyUser.id,
            permissions: { can_send_messages: false }
        });

        if (muted) {
            await sendTelegramMessage(token, chatId, `🔇 تم كتم العضو @${replyUser.username || replyUser.first_name} ومنعه من الكتابة في المجموعة بنجاح!`, { replyTo: msg.message_id });
        } else {
            await sendTelegramMessage(token, chatId, `❌ تعذر كتم العضو، تأكد من صلاحيات البوت الإدارية!`, { replyTo: msg.message_id });
        }
        return;
    }

    // أمر فك كتم
    if (['فك كتم', 'الغاء كتم', '/unmute'].includes(normalizedBody)) {
        const replyUser = msg.reply_to_message?.from;
        if (!replyUser) {
            await sendTelegramMessage(token, chatId, `⚠️ رد على رسالة العضو لفك كتمه!`, { replyTo: msg.message_id });
            return;
        }

        if (!(await checkIsActualRoomAdminOrOwner())) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص لمشرفين الجروب وللحج فقط! 🛡️`, { replyTo: msg.message_id });
            return;
        }

        const unmuted = await telegramAction(token, 'restrictChatMember', {
            chat_id: chatId,
            user_id: replyUser.id,
            permissions: {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true
            }
        });

        if (unmuted) {
            await sendTelegramMessage(token, chatId, `🔊 تم فك كتم العضو @${replyUser.username || replyUser.first_name} ويمكنه التحدث الآن بحرية! 🎉`, { replyTo: msg.message_id });
        } else {
            await sendTelegramMessage(token, chatId, `❌ تعذر فك كتم العضو!`, { replyTo: msg.message_id });
        }
        return;
    }

    // حظر مستخدم من البوت بالكامل
    if (normalizedBody.startsWith('حظر مستخدم') || normalizedBody.startsWith('حظر عضو')) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }
        const replyUser = msg.reply_to_message?.from;
        let targetId = replyUser ? String(replyUser.id) : text.replace(/^(حظر مستخدم|حظر عضو)\s*/i, '').trim().replace(/^@/, '');
        if (!targetId) {
            await sendTelegramMessage(token, chatId, `⚠️ رد على رسالة المستخدم أو اكتب يوزره/آيديه لحظره!`, { replyTo: msg.message_id });
            return;
        }
        if (targetId.toLowerCase() === 'shadwwmy' || targetId === '194961618301016' || targetId === '201129249396' || targetId === '01129249396') {
            await sendTelegramMessage(token, chatId, `❌ لا يمكن حظر الحج شادو الأصلي! 👑🛡️`, { replyTo: msg.message_id });
            return;
        }
        if (!localDB.bannedUsers) localDB.bannedUsers = [];
        const banKey = `tg_${targetId}`;
        if (!localDB.bannedUsers.includes(banKey)) localDB.bannedUsers.push(banKey);
        if (!localDB.bannedUsers.includes(targetId)) localDB.bannedUsers.push(targetId);
        saveLocalDB(localDB);
        await sendTelegramMessage(token, chatId, `🚫 تم حظر المستخدم [ ${targetId} ] نهائياً من استخدام البوت!`, { replyTo: msg.message_id });
        return;
    }

    // فك حظر مستخدم
    if (normalizedBody.startsWith('فك حظر مستخدم') || normalizedBody.startsWith('فك حظر')) {
        if (!isHajjShado) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }
        const replyUser = msg.reply_to_message?.from;
        let targetId = replyUser ? String(replyUser.id) : text.replace(/^(فك حظر مستخدم|فك حظر)\s*/i, '').trim().replace(/^@/, '');
        if (!targetId) {
            await sendTelegramMessage(token, chatId, `⚠️ رد على رسالة المستخدم أو اكتب يوزره/آيديه لفك حظره!`, { replyTo: msg.message_id });
            return;
        }
        if (localDB.bannedUsers) {
            localDB.bannedUsers = localDB.bannedUsers.filter(u => u !== targetId && u !== `tg_${targetId}` && u !== `@${targetId}`);
            saveLocalDB(localDB);
        }
        await sendTelegramMessage(token, chatId, `✅ تم فك حظر المستخدم [ ${targetId} ] بنجاح!`, { replyTo: msg.message_id });
        return;
    }

    // نوم البوت في الشات (نام)
    if (normalizedBody === 'نام' || normalizedBody === '/sleep') {
        if (!isHajj) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }
        chatSleepMap.set(chatId, true);
        await sendTelegramMessage(token, chatId, `😴 *أمرك يا حج.. تم تنويم البوت عن العامة في هذا الشات!* لن يرد على أي شخص إلا حضرتك. اكتب *(اصحي)* لإعادته.`, { replyTo: msg.message_id });
        return;
    }

    // صمت البوت التام (اسكت)
    if (normalizedBody === 'اسكت' || normalizedBody === 'اخرس') {
        if (!isHajj) {
            await sendTelegramMessage(token, chatId, `❌ هذا الأمر مخصص للحج الأساسي فقط! 👑`, { replyTo: msg.message_id });
            return;
        }
        chatMuteMap.set(chatId, true);
        await sendTelegramMessage(token, chatId, `🤫 *أمرك يا حج.. تم إسكات البوت تماماً.* لن يتحدث حتى تأمره بـ *(اتكلم)*.`, { replyTo: msg.message_id });
        return;
    }

    // أمر معلومات البوت
    if (text === '/info' || textLower === 'info' || text === 'معلومات البوت') {
        const uptime = Math.floor(process.uptime());
        const hours = Math.floor(uptime / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        const secs = uptime % 60;
        const rep = getSubBotsReport();
        const infoMsg = 
            `╭━━━〔 🤖 *معلومات شادو بوت الشاملة* 〕━━━╮\n` +
            `┃ 👑 *المالك والمطور:* الحج شادو (@Shadwwmy)\n` +
            `┃ 🌐 *يوزر تليجرام:* @${currentBotInfo?.username || 'ShadowBot'}\n` +
            `┃ 🤖 *البوتات الفرعية المسجلة:* ${rep.total} بوت\n` +
            `┃ ⏱️ *وقت التشغيل المستمر:* ${hours} س و ${mins} د و ${secs} ث\n` +
            `┃ 🛡️ *حالة الأمان:* درع عكس الحظر مفعّل 24/7 ⚡\n` +
            `┃ 📢 *رابط البوت:* https://t.me/Shadowcomm_bot\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯`;
        await sendTelegramMessage(token, chatId, infoMsg, { replyTo: msg.message_id });
        return;
    }

    // =========================================================================
    // 💬 8️⃣ الردود الذكية والتفاعل مع المناداة
    // =========================================================================
    if (['شادو', 'يا شادو', 'بوت', 'يا بوت'].includes(normalizedBody)) {
        if (isHajjShado) {
            await sendTelegramMessage(token, chatId, `👑 عيون شادو وروحه يا حج شادو يا غالي! أؤمرني وأنا تحت طوعك في أي لحظة. ❤️⚡`, { replyTo: msg.message_id });
        } else {
            await sendTelegramMessage(token, chatId, `عيون شادو يا فنان! 🤍 أمرك إيه؟ اكتب *(الاوامر)* عشان تشوف الألعاب والأقسام كلها. ⚡`, { replyTo: msg.message_id });
        }
        return;
    }

    if (['بحبك', 'حبك', 'يا عسل'].includes(normalizedBody)) {
        await sendTelegramMessage(token, chatId, `وأنا بحبك أكتر في الله يا غالي! ربنا يسعدك دايماً 🤍✨`, { replyTo: msg.message_id });
        return;
    }

    if (['السلام عليكم', 'سلام عليكم'].includes(normalizedBody)) {
        await sendTelegramMessage(token, chatId, `وعليكم السلام ورحمة الله وبركاته يا هلا بيك! 🌸 نورت شادو بوت.`, { replyTo: msg.message_id });
        return;
    }
}

/**
 * بدء تشغيل بوت تليجرام واستقبال الرسائل بنظام Long Polling
 */
export async function startTelegramBot(token = null) {
    token = getSanitizedTelegramToken(token);

    // 1. إلغاء أي جلسة بولينج قديمة على الفور باستخدام المعرف الفرعي للجيل
    pollingSessionId++;
    const mySessionId = pollingSessionId;
    isPolling = false;
    if (pollingAbortController) {
        try { pollingAbortController.abort(); } catch (_) {}
        pollingAbortController = null;
    }

    // 2. إغلاق أي Webhook أو اتصالات سابقة عالقة على سيرفرات تليجرام لحل (409 Conflict) نهائياً
    try {
        await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`, {
            drop_pending_updates: false
        }, { timeout: 10000 });
    } catch (_) {}

    await new Promise(r => setTimeout(r, 1200));

    let botInfo = await verifyTelegramToken(token);
    if (!botInfo) {
        console.warn('⚠️ [Telegram] تعذر التحقق السريع من التوكن عبر getMe، جاري المتابعة بالبيانات الافتراضية لبدء الاستقبال...');
        botInfo = {
            id: 9240074974,
            is_bot: true,
            first_name: 'Shadow Bot',
            username: 'Shadowcomm_bot'
        };
    }

    if (mySessionId !== pollingSessionId) {
        return { success: false, message: 'Superseded' };
    }

    currentBotInfo = botInfo;
    telegramStartTime = Math.floor(Date.now() / 1000);
    isPolling = true;
    pollingAbortController = new AbortController();

    console.log(`\n🎉 [Telegram Bot] تم ربط وتشغيل بوت تليجرام بنجاح: @${botInfo.username} (${botInfo.first_name}) 🚀`);

    let consecutive409Errors = 0;

    // حلقة استقبال الرسائل (Long Polling Loop)
    (async () => {
        while (isPolling && mySessionId === pollingSessionId) {
            try {
                const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
                    params: {
                        offset: lastUpdateId + 1,
                        timeout: 25,
                        allowed_updates: ['message', 'callback_query']
                    },
                    timeout: 35000,
                    signal: pollingAbortController?.signal
                });

                if (mySessionId !== pollingSessionId) break;

                consecutive409Errors = 0;

                if (res.data && res.data.ok && Array.isArray(res.data.result)) {
                    for (const update of res.data.result) {
                        lastUpdateId = update.update_id;
                        if (update.message) {
                            handleTelegramMessage(token, update.message).catch(err => {
                                console.error('⚠️ [Telegram Msg Handler Error]:', err?.message || err);
                            });
                        }
                    }
                }
            } catch (pollErr) {
                if (!isPolling || mySessionId !== pollingSessionId) break;

                const status = pollErr?.response?.status;
                if (status === 409) {
                    consecutive409Errors++;
                    if (consecutive409Errors <= 2) {
                        console.log(`⏳ [Telegram Polling] جاري فض التعارض وإنهاء الجلسات العالقة على التوكن (409 Conflict)...`);
                    }
                    try {
                        await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`, { drop_pending_updates: false }, { timeout: 10000 });
                    } catch (_) {}
                    await new Promise(r => setTimeout(r, Math.min(consecutive409Errors * 3000, 15000)));
                } else {
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        }
    })();

    return { 
        success: true, 
        message: `✅ تم ربط وتشغيل البوت على تليجرام بنجاح: @${botInfo.username}`,
        botInfo 
    };
}

/**
 * حارس ومراقب بوت تليجرام السحابي (Watchdog) لضمان العمل 24/7 دون توقف
 */
export function startTelegramWatchdog(token = null) {
    if (telegramWatchdogInterval) return;
    const resolvedToken = getSanitizedTelegramToken(token);

    telegramWatchdogInterval = setInterval(async () => {
        try {
            if (!isPolling) {
                console.log('🛡️ [Telegram Watchdog] رصد توقف البوت على السيرفر، جاري إعادة تشغيله سحابياً...');
                await startTelegramBot(resolvedToken);
            }
        } catch (err) {
            console.error('⚠️ [Telegram Watchdog Error]:', err?.message || err);
        }
    }, 15000);
}

/**
 * إيقاف بوت تليجرام
 */
export function stopTelegramBot() {
    isPolling = false;
    if (pollingAbortController) {
        try { pollingAbortController.abort(); } catch (_) {}
        pollingAbortController = null;
    }
    currentBotInfo = null;
    console.log('🛑 [Telegram Bot] تم إيقاف خدمة تليجرام.');
    return true;
}

/**
 * جلب حالة اتصال تليجرام الحالية
 */
export function getTelegramStatus() {
    return {
        isActive: isPolling,
        username: currentBotInfo?.username || null,
        botName: currentBotInfo?.first_name || null,
        botId: currentBotInfo?.id || null,
        uptime: isPolling ? (Math.floor(Date.now() / 1000) - telegramStartTime) : 0
    };
}
