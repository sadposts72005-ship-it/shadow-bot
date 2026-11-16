import axios from 'axios';
import { loadLocalDB, saveLocalDB } from './database.js';

let isPolling = false;
let pollingAbortController = null;
let currentBotInfo = null;
let telegramStartTime = 0;
let lastUpdateId = 0;

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
 * إرسال رسالة نصية عبر تليجرام
 */
export async function sendTelegramMessage(token, chatId, text, options = {}) {
    if (!token || !chatId || !text) return false;
    try {
        await axios.post(`https://api.telegram.org/bot${token.trim()}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: options.parse_mode || 'Markdown',
            reply_to_message_id: options.replyTo || undefined
        }, { timeout: 15000 });
        return true;
    } catch (e) {
        // إذا فشل التنسيق بـ Markdown نجرب بدون تنسيق
        try {
            await axios.post(`https://api.telegram.org/bot${token.trim()}/sendMessage`, {
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
 * معالجة رسائل وأوامر التليجرام الواردة
 */
async function handleTelegramMessage(token, msg) {
    if (!msg || !msg.text) return;
    const chatId = msg.chat?.id;
    const fromId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'صديقي';
    const text = msg.text.trim();
    const textLower = text.toLowerCase();

    // فحص صلاحيات المطور
    const db = loadLocalDB();
    const isOwner = (db.telegramOwners && db.telegramOwners.includes(fromId)) || (String(fromId) === '194961618301016');

    // الرد على أمر /start
    if (text === '/start' || textLower === 'start' || text === 'هلا' || text === 'مرحبا') {
        const welcome = 
            `👑 *أهلاً بك يا ${username} في شادو بوت (Shadow Bot) على تليجرام!* 🤖✨\n\n` +
            `البوت شغال الآن ومتصل بذكاء وسرعة على تليجرام وواتساب بنفس قاعدة البيانات والميزات!\n\n` +
            `📜 *لفتح قائمة الأوامر الكاملة اكتب:* /menu أو (الاوامر)\n` +
            `🕌 *لمواقيت الصلاة والأذكار اكتب:* (الصلاة) أو (الاذان)\n` +
            `🎮 *للألعاب والترفيه اكتب:* (العاب) أو (صراحه) أو (كتكوت)\n` +
            `💡 *لمعرفة معلومات البوت اكتب:* /info`;
        await sendTelegramMessage(token, chatId, welcome);
        return;
    }

    // أمر /menu أو الاوامر
    if (['/menu', 'menu', 'اوامر', 'الاوامر', 'القائمة', 'قائمة'].includes(textLower) || text === '/help') {
        const menuText = 
            `╭━━━〔 👑 *قائمة أوامر شادو بوت* 〕━━━╮\n` +
            `┃ 🤖 *مرحباً بك يا:* ${username}\n` +
            `┃ ⚡ *المنصة:* تليجرام + واتساب موحد 🌐\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🕌 *[ 1️⃣ القسم الإسلامي والمواقيت ]*\n` +
            `• *مواقيت الصلاة* ➔ عرض مواعيد الصلاة الحالية في مصر\n` +
            `• *اذكار* ➔ باقة من أذكار الصباح والمساء والاستغفار\n` +
            `• *دين* ➔ سؤال ديني إسلامي مفيد\n\n` +
            `🎮 *[ 2️⃣ قسم الألعاب والمسابقات ]*\n` +
            `• *صراحه* ➔ سؤال صراحة محرج وجريء\n` +
            `• *لو خيروك* ➔ لعبة التحديات والاختيارات\n` +
            `• *عين* ➔ لعبة حزر فزر للأذكياء\n` +
            `• *كتكوت* ➔ سؤال ذكاء وسرعة بديهة\n` +
            `• *عواصم* ➔ مسابقة عواصم الدول\n\n` +
            `📊 *[ 3️⃣ قسم الحساب والنقاط ]*\n` +
            `• *نقاطي* ➔ معرفة رصيدك الحالي من النقاط\n` +
            `• *لفلي* ➔ معرفة مستواك الحالي بالبوت\n\n` +
            `ℹ️ *[ 4️⃣ قسم المساعدة والدعم ]*\n` +
            `• */info* ➔ معلومات وسرعة استجابة البوت\n` +
            `• *تنصيب* ➔ معلومات تنصيب بوتك الخاص مجاناً\n\n` +
            `👑 *المطور والمالك العام:* الحج شادو ⚡`;
        await sendTelegramMessage(token, chatId, menuText);
        return;
    }

    // أمر /info
    if (text === '/info' || textLower === 'info' || text === 'معلومات البوت') {
        const uptime = Math.floor(process.uptime());
        const hours = Math.floor(uptime / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        const secs = uptime % 60;
        const infoMsg = 
            `╭━━━〔 🤖 *معلومات شادو بوت* 〕━━━╮\n` +
            `┃ 👑 *الاسم:* Shadow Bot\n` +
            `┃ 🌐 *تليجرام:* @${currentBotInfo?.username || 'ShadowBot'}\n` +
            `┃ ⏱️ *وقت التشغيل المستمر:* ${hours} س و ${mins} د و ${secs} ث\n` +
            `┃ 🟢 *الحالة:* متصل ومحمي بنظام الأمان وعكس الحظر ⚡\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯`;
        await sendTelegramMessage(token, chatId, infoMsg);
        return;
    }

    // أوامر مواقيت الصلاة
    if (['مواقيت الصلاة', 'مواعيد الصلاة', 'الصلوات', 'الاذان', 'الأذان', 'صلاة'].includes(textLower)) {
        const prayerMsg = 
            `🕌 *مواقيت الصلاة الرسمية (بتوقيت مصر)* 🇪🇬\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `• الفجر: 04:55 ص\n` +
            `• الشروق: 06:25 ص\n` +
            `• الظهر: 11:42 ص\n` +
            `• العصر: 02:41 م\n` +
            `• المغرب: 04:59 م\n` +
            `• العشاء: 06:19 م\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🤍 *صلاتك حياتك فلا تؤخرها.. صَلِّ على النبي ﷺ*`;
        await sendTelegramMessage(token, chatId, prayerMsg);
        return;
    }

    // ألعاب سريعة
    if (text === 'صراحه' || text === 'صراحة') {
        const questions = [
            'هل ندمت يوماً على شخص دخل حياتك؟ 💔',
            'ما هو أكبر سر تخفيه عن أقرب الناس إليك؟ 🤫',
            'إذا كان بإمكانك مسح ذكرى واحدة من حياتك فماذا ستكون؟ 💭',
            'هل تعلقت بشخص لدرجة أنك غير قادر على تخيل يومك بدونه؟ 🥺',
            'ما هو أكثر شيء يجعلك تبكي في صمت؟ 🌧️',
            'هل أنت راضٍ عن نفسك بنسبة 100% حالياً؟ ✨'
        ];
        const randomQ = questions[Math.floor(Math.random() * questions.length)];
        await sendTelegramMessage(token, chatId, `🎯 *سؤال صراحة لك يا ${username}:*\n\n« ${randomQ} »\n\nجاوب بصراحة ومتهربش! 😉🔥`);
        return;
    }

    if (text === 'لو خيروك') {
        const dilemmas = [
            'لو خيروك: تسافر للمستقبل وتشوف حياتك، أو ترجع للماضي وتصلح غلطة؟ ⏳',
            'لو خيروك: تخسر كل ذكرياتك، أو تخسر كل فلوسك؟ 💸',
            'لو خيروك: تعيش وحيداً في قصر فاخر، أو تعيش مع أصحابك في بيت متواضع؟ 🏰',
            'لو خيروك: تقرأ أفكار الناس، أو تختفي في أي وقت تحبه؟ 🧙‍♂️'
        ];
        const randomD = dilemmas[Math.floor(Math.random() * dilemmas.length)];
        await sendTelegramMessage(token, chatId, `🤔 *تحدي لو خيروك يا ${username}:*\n\n« ${randomD} »\n\nاختار إيه وليه؟ ⚡`);
        return;
    }

    // أمر تنصيب
    if (['تنصيب', 'تنصيب بوت', 'بوت فرعي'].includes(textLower)) {
        const installText = 
            `🤖 *تنصيب بوتك الخاص مجاناً عبر شادو بوت* 👑\n\n` +
            `يمكنك تنصيب نسختك الخاصة من البوت باسمك وشخصيتك وبكامل الصلاحيات!\n` +
            `للتنصيب، تواصل مع الحج شادو عبر واتساب أو اكتب أمر (تنصيب) في واتساب لبدء الخطوات فوراً. 🚀`;
        await sendTelegramMessage(token, chatId, installText);
        return;
    }

    // الرد على المناداة
    if (['شادو', 'يا شادو', 'بوت', 'يا بوت'].includes(textLower)) {
        await sendTelegramMessage(token, chatId, `عيون شادو يا غالي! 🤍 أمرك إيه؟ اكتب /menu وشوف الأوامر كلها. ⚡`);
        return;
    }
}

/**
 * بدء تشغيل بوت تليجرام واستقبال الرسائل بنظام Long Polling
 */
export async function startTelegramBot(token) {
    if (!token) return { success: false, message: 'التوكن غير محدد' };
    token = String(token).replace(/\s+/g, '').trim();

    if (isPolling) {
        stopTelegramBot();
        await new Promise(r => setTimeout(r, 1000));
    }

    const botInfo = await verifyTelegramToken(token);
    if (!botInfo) {
        return { success: false, message: 'فشل التحقق من التوكن! تأكد من صحة التوكن المأخوذ من @BotFather' };
    }

    currentBotInfo = botInfo;
    telegramStartTime = Math.floor(Date.now() / 1000);
    isPolling = true;
    pollingAbortController = new AbortController();

    console.log(`\n🎉 [Telegram Bot] تم ربط وتشغيل بوت تليجرام بنجاح: @${botInfo.username} (${botInfo.first_name}) 🚀`);

    // حلقة استقبال الرسائل (Long Polling Loop)
    (async () => {
        while (isPolling) {
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
                if (!isPolling) break;
                // تأخير بسيط عند حدوث خطأ شبكة قبل إعادة المحاولة
                await new Promise(r => setTimeout(r, 3000));
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
