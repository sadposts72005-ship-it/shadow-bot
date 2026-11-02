import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { handleAllMessages } from '../handler.js';
import { getMsgTimestamp } from './points.js';

const REGISTRY_FILE = path.join(process.cwd(), 'sub_bots.json');
const SUB_BOTS_DIR = path.join(process.cwd(), 'sessions', 'sub_bots');

// حفظ السوكيتات النشطة في الذاكرة
export const activeSubBots = new Map();
// تتبع الرسائل المرسلة من البوتات الفرعية لتجنب اللوب
const subBotSentMsgIds = new Set();

/**
 * تحميل سجل البوتات الفرعية من ملف sub_bots.json
 */
export function loadSubBotsRegistry() {
    try {
        if (fs.existsSync(REGISTRY_FILE)) {
            return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('❌ خطأ في قراءة سجل البوتات الفرعية:', e?.message || e);
    }
    return {};
}

/**
 * حفظ سجل البوتات الفرعية
 */
export function saveSubBotsRegistry(data) {
    try {
        fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('❌ خطأ في حفظ سجل البوتات الفرعية:', e?.message || e);
        return false;
    }
}

/**
 * تنظيف رقم الهاتف وإبقاؤه أرقاماً فقط مع تحويل الأرقام المحلية للدولية
 */
export function cleanPhoneNumber(phone) {
    if (!phone) return '';
    let clean = String(phone).replace(/[^0-9]/g, '');
    if (clean.startsWith('00')) clean = clean.substring(2);
    // تحويل أرقام مصر المحلية 010/011/012/015 المكونة من 11 رقماً تلقائياً إلى 201...
    if (clean.startsWith('01') && clean.length === 11) {
        clean = '20' + clean.substring(1);
    }
    return clean;
}

/**
 * توحيد صيغة المذكر والمؤنث لجميع الردود والألعاب وأوامر الحج للبوت الأنثى
 */
export function formatGenderText(text) {
    if (!text || typeof text !== 'string') return text;
    return text
        // الألقاب والمناداة العامة
        .replace(/يا فنانة/g, 'يا فنان/ة')
        .replace(/يا فنان\b/g, 'يا فنان/ة')
        .replace(/يا نجمة/g, 'يا نجم/ة')
        .replace(/يا نجم\b/g, 'يا نجم/ة')
        .replace(/يا بطلة/g, 'يا بطل/ة')
        .replace(/يا بطل\b/g, 'يا بطل/ة')
        .replace(/يا غالية/g, 'يا غالي/ة')
        .replace(/يا غالي\b/g, 'يا غالي/ة')
        .replace(/يا وحش/g, 'يا وحش/ة')
        .replace(/يا لاعب/g, 'يا لاعب/ة')
        .replace(/فائز/g, 'فائز/ة')
        .replace(/خاسر/g, 'خاسر/ة')
        .replace(/عضو/g, 'عضو/ة')
        .replace(/مشرف/g, 'مشرف/ة')
        .replace(/ادمن/g, 'ادمن/ة')
        
        // التحيات والأوامر والخدمة
        .replace(/اتفضل يا حبيبي اامر/g, 'اتفضل/ي يا حبيبي/حبيبتي اؤمر/ي')
        .replace(/اتفضلي يا حبيبتي اؤمري/g, 'اتفضل/ي يا حبيبي/حبيبتي اؤمر/ي')
        .replace(/اتفضل يا فنان/g, 'اتفضل/ي يا فنان/ة')
        .replace(/اتفضلي يا فنانة/g, 'اتفضل/ي يا فنان/ة')
        .replace(/تحت امرك يا فنان/g, 'تحت أمرك يا فنان/ة')
        .replace(/تحت امرك يا فنانة/g, 'تحت أمرك يا فنان/ة')
        .replace(/مبروك يا فنان/g, 'مبروك يا فنان/ة')
        .replace(/مبروك يا بطل/g, 'مبروك يا بطل/ة')
        .replace(/عاش يا وحش/g, 'عاش يا وحش/ة')
        .replace(/يا حبيبي/g, 'يا حبيبي/حبيبتي')
        .replace(/يا حبيبتي/g, 'يا حبيبي/حبيبتي')

        // أوامر ورتب وصلاحيات الحج للمؤنث (ولد وبنت معاً)
        .replace(/يا حج\b/g, 'يا حج/ة')
        .replace(/يا حاجة\b/g, 'يا حج/ة')
        .replace(/بابا الحج/g, 'بابا/ماما الحج/ة')
        .replace(/حج أساسي/g, 'حج/ة أساسي/ة')
        .replace(/حج اساسي/g, 'حج/ة أساسي/ة')
        .replace(/حج مساعد/g, 'حج/ة مساعد/ة')
        .replace(/رتبة الحج/g, 'رتبة الحج/ة')
        .replace(/صاحب البوت/g, 'صاحب/ة البوت')
        .replace(/مالك البوت/g, 'مالك/ة البوت')
        .replace(/يقدر ينيم ويصحي البوت ويأمره بأي أمر/g, 'يقدر/تقدر ينيم/تنيم ويصحي/تصحي البوت ويأمره/تأمره بأي أمر')
        .replace(/يقدر ينيم البوت/g, 'يقدر/تقدر ينيم/تنيم البوت')
        .replace(/سحب صلاحياته/g, 'سحب صلاحياته/صلاحياتها')
        .replace(/مرفوع حج/g, 'مرفوع/ة حج/ة')
        .replace(/مسجلاً كحج/g, 'مسجلاً/مسجلة كحج/ة')
        .replace(/عشان انت الحج بس/g, 'عشان انت/ي الحج/ة بس')
        .replace(/حبيبي يا بابا الحج/g, 'حبيبي/حبيبتي يا بابا/ماما الحج/ة')
        .replace(/حبيبي ونور عيني يابا/g, 'حبيبي/حبيبتي ونور عيني يابا/ياما')
        .replace(/حبيبتي ونور عيني يا بابا/g, 'حبيبي/حبيبتي ونور عيني يابا/ياما')
        .replace(/انت عمي بس ابويا/g, 'انت/ي عمي/عمتي بس ابويا/امي')
        .replace(/ابوك مين يا حبيبي؟/g, 'ابوك/امك مين يا حبيبي/حبيبتي؟')
        .replace(/ابويا هو/g, 'ابويا/امي هو')
        .replace(/مقدرش ازعل من بابا الحج/g, 'مقدرش ازعل من بابا/ماما الحج/ة')
        .replace(/مقدرش ازعل من حبايب بابا الحج/g, 'مقدرش ازعل من حبايب بابا/ماما الحج/ة');
}

/**
 * إعداد سوكيت بوت فرعي مع تطبيق معايير الأمان ومكافحة الحظر
 */
async function createSubBotSocket(phone, sessionDir) {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent', enabled: false }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent', enabled: false }))
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncPhonenumber: true,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        fireInitQueries: false,
        shouldSyncHistoryMessage: () => false,
        defaultQueryTimeoutMs: undefined,
        getMessage: async () => ({ conversation: '' })
    });

    // تتبع وتفادي تكرار ردود البوت على رسائله
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
        try {
            // توحيد صيغة المذكر والمؤنث لجميع ردود وألعاب وأوامر البوت الأنثى تلقائياً
            if (sock.gender === 'female' || sock.subBotConfig?.gender === 'female') {
                if (args[1] && typeof args[1] === 'object') {
                    if (typeof args[1].text === 'string') {
                        args[1].text = formatGenderText(args[1].text);
                    }
                    if (typeof args[1].caption === 'string') {
                        args[1].caption = formatGenderText(args[1].caption);
                    }
                }
            }
            const res = await originalSendMessage(...args);
            if (res?.key?.id) {
                subBotSentMsgIds.add(res.key.id);
                setTimeout(() => subBotSentMsgIds.delete(res.key.id), 120000);
            }
            return res;
        } catch (e) {
            console.error(`❌ خطأ إرسال رسالة في البوت الفرعي (+${phone}):`, e?.message || e);
            throw e;
        }
    };

    // تأمين الكاشات المستقلة للبوت الفرعي
    sock.football = {};
    sock.obito = {};
    sock.scramble = {};
    sock.gameSolo = {};
    sock.game = {};
    sock.bakasa = {};
    sock.sarahaGames = {};
    sock.pmUsers = new Set();

    return { sock, state, saveCreds };
}

/**
 * بدء تشغيل بوت فرعي مسجل ومربوط مسبقاً
 */
export async function bootSubBot(phone, cfg, mainConn = null) {
    const cleanPhone = cleanPhoneNumber(phone);
    if (!cleanPhone) return false;

    // إذا كان شغالاً بالفعل نتخطى
    if (activeSubBots.has(cleanPhone)) {
        return true;
    }

    const sessionDir = path.join(SUB_BOTS_DIR, cleanPhone);
    const credsPath = path.join(sessionDir, 'creds.json');
    if (!fs.existsSync(credsPath)) {
        console.log(`⚠️ جلسة البوت الفرعي (+${cleanPhone}) غير مكتملة، تم تجاهلها.`);
        return false;
    }

    try {
        const { sock, saveCreds } = await createSubBotSocket(cleanPhone, sessionDir);
        sock.botName = cfg.botName || 'بوت فرعي';
        sock.callName = cfg.callName || cfg.botName || 'فرعي';
        sock.gender = cfg.gender || 'male';
        sock.personality = cfg.personality || 'respectful';
        sock.subBotConfig = cfg;
        let subBotStartTime = Math.floor(Date.now() / 1000);

        sock.ev.on('creds.update', saveCreds);

        // ربط مستمع الرسائل بالـ Handler
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const nowSec = Math.floor(Date.now() / 1000);
            const activeStart = sock.subBotStartTime || subBotStartTime || nowSec;

            for (const m of messages) {
                try {
                    if (!m.message) continue;

                    // ⏰ تجاهل قاطع وفوري لأي رسالة قديمة وصلت أثناء انقطاع أو إغلاق البوت
                    const msgTime = getMsgTimestamp(m);
                    if (msgTime > 0) {
                        if (msgTime < (activeStart - 2) || msgTime < (nowSec - 30)) {
                            continue;
                        }
                    } else {
                        if ((nowSec - activeStart) < 45) {
                            continue;
                        }
                    }

                    if (m.key.id && subBotSentMsgIds.has(m.key.id)) continue;
                    const from = m.key.remoteJid;
                    if (!from) continue;

                    await handleAllMessages(m, sock);
                } catch (msgErr) {
                    console.error(`❌ خطأ في معالجة رسالة بالبوت الفرعي (+${cleanPhone}):`, msgErr?.message || msgErr);
                }
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                subBotStartTime = Math.floor(Date.now() / 1000);
                sock.subBotStartTime = subBotStartTime;
                console.log(`🤖 [Sub-Bot] البوت الفرعي (${cfg.botName || cleanPhone}) متصل وشغال الآن! (+${cleanPhone})`);
                activeSubBots.set(cleanPhone, { sock, cfg, startTime: subBotStartTime });
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                activeSubBots.delete(cleanPhone);

                console.log(`⚠️ [Sub-Bot] انقطع اتصال البوت الفرعي (+${cleanPhone}). الرمز: ${statusCode}`);

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(`🚫 [Sub-Bot] تم تسجيل الخروج للبوت الفرعي (+${cleanPhone}).`);
                    const registry = loadSubBotsRegistry();
                    if (registry[cleanPhone]) {
                        registry[cleanPhone].status = 'logged_out';
                        saveSubBotsRegistry(registry);
                    }
                    try {
                        if (fs.existsSync(sessionDir)) {
                            fs.rmSync(sessionDir, { recursive: true, force: true });
                        }
                    } catch (_) {}
                } else if (shouldReconnect) {
                    const registry = loadSubBotsRegistry();
                    if (registry[cleanPhone]?.status === 'active') {
                        setTimeout(() => {
                            bootSubBot(cleanPhone, cfg, mainConn).catch(e => console.error(e));
                        }, 5000);
                    }
                }
            }
        });

        activeSubBots.set(cleanPhone, { sock, cfg, startTime: subBotStartTime });
        return true;
    } catch (err) {
        console.error(`❌ فشل تشغيل البوت الفرعي (+${cleanPhone}):`, err?.message || err);
        return false;
    }
}

/**
 * طلب ربط بوت فرعي واستخراج كود الاقتران عبر واتساب
 */
export async function requestSubBotPairing(targetPhone, botName, callName, adminPhone, adminLid, gender = 'male', personality = 'respectful', mainConn, notifyJid, quotedMek) {
    // التوافق في حال تم تمرير المعاملات بالترتيب القديم
    if (typeof gender === 'object' && gender !== null && gender.sendMessage) {
        quotedMek = notifyJid;
        notifyJid = mainConn;
        mainConn = gender;
        gender = 'male';
        personality = 'respectful';
    }

    const cleanPhone = cleanPhoneNumber(targetPhone);
    const cleanAdmin = cleanPhoneNumber(adminPhone) || String(adminPhone).replace(/[^0-9]/g, '');
    let cleanLid = adminLid ? String(adminLid).replace(/[^0-9]/g, '') : '';
    if (!cleanLid && cleanAdmin.length > 13) cleanLid = cleanAdmin;
    const finalCallName = (callName || botName || 'فرعي').trim();
    const finalGender = (gender === 'female' || gender === '2') ? 'female' : 'male';
    const finalPersonality = (personality === 'bad' || personality === 'toxic' || personality === '2') ? 'bad' : 'respectful';

    if (!cleanPhone || cleanPhone.length < 10) {
        await mainConn.sendMessage(notifyJid, { text: '❌ رقم الهاتف غير صالح. برجاء كتابة رقم صحيح (مثال: 01012345678 أو 201012345678).' }, { quoted: quotedMek });
        return false;
    }

    const sessionDir = path.join(SUB_BOTS_DIR, cleanPhone);
    const credsPath = path.join(sessionDir, 'creds.json');

    // تنظيف أي جلسة غير مكتملة أو معلقة سابقة لضمان توليد مفاتيح ربط جديدة نقية
    if (fs.existsSync(sessionDir) && !activeSubBots.has(cleanPhone)) {
        try {
            if (fs.existsSync(credsPath)) {
                const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                if (!credsData.registered) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
            } else {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
        } catch (_) {
            try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
        }
    }
    fs.mkdirSync(sessionDir, { recursive: true });

    let pairingCodeSent = false;
    let isConnected = false;

    async function startPairingEngine() {
        try {
            const { sock, saveCreds } = await createSubBotSocket(cleanPhone, sessionDir);
            sock.botName = botName;
            sock.callName = finalCallName;
            sock.gender = finalGender;
            sock.personality = finalPersonality;
            let subBotStartTime = Math.floor(Date.now() / 1000);

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                // 🔑 طلب كود الاقتران عند الاتصال إذا لم يكن الجهاز مسجلاً
                if (!sock.authState.creds.registered && !pairingCodeSent) {
                    pairingCodeSent = true;
                    setTimeout(async () => {
                        try {
                            if (!sock.authState.creds.registered) {
                                let code = await sock.requestPairingCode(cleanPhone);
                                code = code?.match(/.{1,4}/g)?.join("-") || code;

                                const pairMsg = 
                                    `╭━━━〔 🤖 *كود تنصيب بوت فرعي* 〕━━━╮\n` +
                                    `┃ 🏷️ *اسم البوت الرسمي:* ${botName}\n` +
                                    `┃ 🗣️ *اسم النداء السهل:* ${finalCallName}\n` +
                                    `┃ 👤 *الجنس:* ${finalGender === 'female' ? 'أنثى 👧' : 'ذكر 👦'}\n` +
                                    `┃ 🎭 *الشخصية:* ${finalPersonality === 'bad' ? 'قليل الأدب 😈🔥' : 'محترم 😇✨'}\n` +
                                    `┃ 📱 *رقم البوت:* +${cleanPhone}\n` +
                                    `┃ 👑 *الحج الأساسي:* +${cleanAdmin}${cleanLid ? ` (LID: ${cleanLid})` : ''}\n` +
                                    `┃ 🔑 *كود الاقتران:* *${code}*\n` +
                                    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
                                    `📌 *طريقة الربط بالهاتف:* \n` +
                                    `1️⃣ افتح واتساب من الهاتف صاحب الرقم (+${cleanPhone}).\n` +
                                    `2️⃣ اضغط على الثلاث نقاط (⋮) ⬅️ *الأجهزة المرتبطة*.\n` +
                                    `3️⃣ اضغط *ربط جهاز*.\n` +
                                    `4️⃣ اضغط *الربط باستخدام رقم الهاتف بدلاً من ذلك*.\n` +
                                    `5️⃣ أدخل الكود أعلاه: *${code}*\n\n` +
                                    `⏳ *الكود صالح لدقيقتين فقط.* بمجرد الربط سيبدأ البوت العمل فوراً!`;

                                await mainConn.sendMessage(notifyJid, { text: pairMsg }, { quoted: quotedMek });
                            }
                        } catch (codeErr) {
                            console.error('❌ خطأ في استخراج كود الاقتران:', codeErr?.message || codeErr);
                            pairingCodeSent = false;
                        }
                    }, 3500);
                }

                if (connection === 'open') {
                    isConnected = true;
                    subBotStartTime = Math.floor(Date.now() / 1000);
                    sock.subBotStartTime = subBotStartTime;
                    console.log(`🎉 [Sub-Bot] تم ربط وتنصيب البوت الفرعي بنجاح! (+${cleanPhone})`);

                    const adminLocal = (cleanAdmin.startsWith('201') && cleanAdmin.length === 12) ? ('01' + cleanAdmin.slice(2)) : '';
                    const adminNumbersList = [cleanAdmin, adminLocal, `+${cleanAdmin}`, cleanLid, `${cleanAdmin}@s.whatsapp.net`, cleanLid ? `${cleanLid}@lid` : ''].filter(Boolean);
                    const cfgData = {
                        phone: cleanPhone,
                        botName: botName,
                        callName: finalCallName,
                        gender: finalGender,
                        personality: finalPersonality,
                        adminPhone: cleanAdmin,
                        adminLid: cleanLid || '',
                        adminJid: cleanAdmin ? `${cleanAdmin}@s.whatsapp.net` : '',
                        adminNumbers: adminNumbersList,
                        subHajjUsers: [],
                        installedAt: new Date().toISOString(),
                        status: 'active',
                        sleep: false,
                        muted: false
                    };

                    sock.subBotConfig = cfgData;

                    fs.writeFileSync(path.join(sessionDir, 'config.json'), JSON.stringify(cfgData, null, 2), 'utf8');

                    const registry = loadSubBotsRegistry();
                    registry[cleanPhone] = cfgData;
                    saveSubBotsRegistry(registry);

                    activeSubBots.set(cleanPhone, { sock, cfg: cfgData, startTime: subBotStartTime });

                    const successMsg = 
                        `🎉 *مبروك! تم تفعيل وتشغيل بوتك (${botName} - نداء: ${finalCallName}) بنجاح!* 🚀\n\n` +
                        `👑 أنت الآن الحج الأساسي على هذا البوت (+${cleanPhone}).\n` +
                        `🗣️ تقدر تنده عليه باسمه (${finalCallName}) وتتحكم فيه بشكل كامل!\n` +
                        `💬 البوت شغال الآن ويرد على الأوامر في الخاص والجروبات.\n` +
                        `📌 جرب اكتب (.اوامر) في أي شات مع البوت لتجربته واستكشاف مميزاته!\n\n` +
                        `🗑️ *إلغاء التنصيب:* إذا أردت إلغاء تنصيب هذا البوت وحذفه نهائياً في أي وقت، اكتب للبوت: *(الغاء تنصيب)* وسيتم حذفه فوراً.`;

                    await mainConn.sendMessage(notifyJid, { text: successMsg }, { quoted: quotedMek });

                    const masterPhone = '201129249396@s.whatsapp.net';
                    const ownerNotice = 
                        `📢 *إشعار تنصيب بوت فرعي جديد:*\n` +
                        `🏷️ *الاسم الرسمي:* ${botName}\n` +
                        `🗣️ *اسم النداء:* ${finalCallName}\n` +
                        `📱 *رقم البوت:* +${cleanPhone}\n` +
                        `👤 *الحج الأساسي:* +${cleanAdmin}${cleanLid ? ` (ID: ${cleanLid})` : ''}\n` +
                        `⏰ *التاريخ:* ${new Date().toLocaleString('ar-EG')}\n` +
                        `👑 الحج الأصلي لديه التحكم الكامل بهذا البوت.`;

                    try {
                        await mainConn.sendMessage(masterPhone, { text: ownerNotice });
                    } catch (_) {}
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`⚠️ [Sub-Bot Pairing] انقطع اتصال السوكيت للرقم (+${cleanPhone}) بكود: ${statusCode}`);
                    activeSubBots.delete(cleanPhone);

                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log(`🚫 [Sub-Bot Pairing] تم تسجيل الخروج (+${cleanPhone}).`);
                        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
                    } else if (!isConnected) {
                        // ⚡ الأهم: إعادة الاتصال فوراً لاستكمال المصافحة (Handshake) بعد إدخال الكود (خصوصاً خطأ 515 و 428)
                        console.log(`🔄 [Sub-Bot Pairing] إعادة الاتصال التلقائي لاستكمال الاقتران (+${cleanPhone})...`);
                        setTimeout(() => {
                            startPairingEngine().catch(e => console.error('Retry pairing error:', e));
                        }, 2500);
                    } else {
                        // إذا كان متصلاً وانقطع لاحقاً
                        const registry = loadSubBotsRegistry();
                        if (registry[cleanPhone]?.status === 'active') {
                            setTimeout(() => {
                                bootSubBot(cleanPhone, registry[cleanPhone], mainConn).catch(e => console.error(e));
                            }, 4000);
                        }
                    }
                }
            });

            // ربط مستمع الرسائل
            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                const nowSec = Math.floor(Date.now() / 1000);
                const activeStart = sock.subBotStartTime || subBotStartTime || nowSec;

                for (const m of messages) {
                    try {
                        if (!m.message) continue;

                        // ⏰ تجاهل قاطع وفوري لأي رسالة قديمة
                        const msgTime = getMsgTimestamp(m);
                        if (msgTime > 0) {
                            if (msgTime < (activeStart - 2) || msgTime < (nowSec - 30)) {
                                continue;
                            }
                        } else {
                            if ((nowSec - activeStart) < 45) {
                                continue;
                            }
                        }

                        if (m.key.id && subBotSentMsgIds.has(m.key.id)) continue;
                        const from = m.key.remoteJid;
                        if (!from) continue;

                        await handleAllMessages(m, sock);
                    } catch (err) {
                        console.error(`❌ خطأ في معالجة رسالة بالبوت الفرعي (+${cleanPhone}):`, err?.message || err);
                    }
                }
            });

            return sock;
        } catch (e) {
            console.error('❌ خطأ في محرك الاقتران:', e);
            throw e;
        }
    }

    return await startPairingEngine();
}

/**
 * تشغيل واسترجاع جميع البوتات الفرعية المسجلة عند إقلاع البوت الرئيسي
 * يتم تشغيلها بتأخير زمني مجدول (Staggered) لتفادي استهلاك الذاكرة أو حظر السيرفرات
 */
export async function initAllSubBots(mainConn) {
    const registry = loadSubBotsRegistry();
    const phones = Object.keys(registry);

    if (phones.length === 0) {
        console.log('ℹ️ [Sub-Bots] لا توجد بوتات فرعية مسجلة حالياً.');
        return;
    }

    console.log(`🔄 [Sub-Bots] جاري استرجاع وتشغيل ${phones.length} بوت فرعي مسجل...`);

    let delaySec = 3;
    for (const phone of phones) {
        const cfg = registry[phone];
        if (cfg && cfg.status === 'active') {
            setTimeout(async () => {
                try {
                    await bootSubBot(phone, cfg, mainConn);
                } catch (err) {
                    console.error(`❌ تعذر تشغيل البوت الفرعي (+${phone}):`, err?.message || err);
                }
            }, delaySec * 1000);
            delaySec += 4; // تأخير 4 ثوانٍ بين كل بوت فرعي والآخر للأمان التام
        }
    }
}

/**
 * إيقاف بوت فرعي عن العمل عن بُعد
 */
export async function stopSubBot(phone) {
    const cleanPhone = cleanPhoneNumber(phone);
    const registry = loadSubBotsRegistry();

    if (!registry[cleanPhone]) {
        return { success: false, message: `⚠️ البوت الفرعي (+${cleanPhone}) غير موجود بالسجل!` };
    }

    const active = activeSubBots.get(cleanPhone);
    if (active && active.sock) {
        try {
            active.sock.end(new Error('Manual shutdown by master owner'));
        } catch (_) {}
    }
    activeSubBots.delete(cleanPhone);

    registry[cleanPhone].status = 'stopped';
    saveSubBotsRegistry(registry);

    return { success: true, message: `🛑 تم إيقاف البوت الفرعي (+${cleanPhone}) بنجاح!` };
}

/**
 * إعادة تشغيل بوت فرعي موقوف
 */
export async function startSubBotRemote(phone, mainConn) {
    const cleanPhone = cleanPhoneNumber(phone);
    const registry = loadSubBotsRegistry();

    if (!registry[cleanPhone]) {
        return { success: false, message: `⚠️ البوت الفرعي (+${cleanPhone}) غير موجود بالسجل!` };
    }

    registry[cleanPhone].status = 'active';
    saveSubBotsRegistry(registry);

    const started = await bootSubBot(cleanPhone, registry[cleanPhone], mainConn);
    if (started) {
        return { success: true, message: `⚡ تم تشغيل البوت الفرعي (+${cleanPhone}) بنجاح!` };
    } else {
        return { success: false, message: `❌ فشل إعادة تشغيل البوت (+${cleanPhone}). تأكد من وجود ملفات الجلسة.` };
    }
}

/**
 * حذف بوت فرعي وملفاته نهائياً وإشعار المالك بإعادة التنصيب للتحديثات
 */
export async function deleteSubBotRemote(phone, mainConn = null) {
    const cleanPhone = cleanPhoneNumber(phone);
    const registry = loadSubBotsRegistry();
    const botData = registry[cleanPhone] || null;

    // إرسال إشعار لصاحب البوت لإبلاغه بالتحديثات وطلب إعادة التنصيب
    if (mainConn && botData) {
        const adminNum = botData.adminPhone || '';
        const targetBotName = botData.botName || 'بوتك الفرعي';
        const ownerJid = botData.adminJid || (adminNum ? `${cleanPhoneNumber(adminNum)}@s.whatsapp.net` : '');
        if (ownerJid) {
            try {
                const notifyMsg = 
                    `⚠️ *إشعار هام من إدارة شادو بوت* 👑🤖\n\n` +
                    `عذراً يا فنان/ة، تم إلغاء تنصيب بوتك (${targetBotName}) مؤقتاً نظراً لإجراء تحديثات وتطويرات جديدة شاملة على السيرفر.\n\n` +
                    `🔄 *معلش أنصبه تاني* للاستفادة من أحدث المميزات والإصلاحات والتطويرات الجديدة!\n` +
                    `✨ فقط افتح الشات الخاص مع البوت واكتب *(تنصيب)* واتبع الخطوات البسيطة للربط بكود جديد مجاناً ❤️`;
                await mainConn.sendMessage(ownerJid, { text: notifyMsg });
            } catch (err) {
                console.error(`خطأ في إرسال إشعار الحذف لصاحب البوت (+${adminNum}):`, err?.message || err);
            }
        }
    }

    const active = activeSubBots.get(cleanPhone);
    if (active && active.sock) {
        try {
            active.sock.end(new Error('Sub-bot uninstalled'));
        } catch (_) {}
    }
    activeSubBots.delete(cleanPhone);

    if (registry[cleanPhone]) {
        delete registry[cleanPhone];
        saveSubBotsRegistry(registry);
    }

    const sessionDir = path.join(SUB_BOTS_DIR, cleanPhone);
    try {
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    } catch (_) {}

    return { success: true, message: `🗑️ تم حذف البوت الفرعي (+${cleanPhone}) وملفاته بنجاح وإشعار المالك بالتحديثات!` };
}

/**
 * مسح وحذف جميع البوتات الفرعية وجلساتها وسجلاتها بالكامل
 */
export async function clearAllSubBots() {
    for (const [phone, item] of activeSubBots.entries()) {
        if (item && item.sock) {
            try {
                item.sock.end(new Error('All sub-bots cleared by master owner'));
            } catch (_) {}
        }
    }
    activeSubBots.clear();
    saveSubBotsRegistry({});

    try {
        if (fs.existsSync(SUB_BOTS_DIR)) {
            fs.rmSync(SUB_BOTS_DIR, { recursive: true, force: true });
        }
    } catch (_) {}

    return { success: true, message: '🗑️ تم إيقاف وحذف جميع البوتات الفرعية وملفاتها وسجلاتها بالكامل بنجاح!' };
}

/**
 * تحديث اسم البوت الفرعي
 */
export function updateSubBotName(phone, newName) {
    const cleanPhone = cleanPhoneNumber(phone);
    if (!cleanPhone || !newName) return false;

    const registry = loadSubBotsRegistry();
    if (registry[cleanPhone]) {
        registry[cleanPhone].botName = newName;
        saveSubBotsRegistry(registry);
    }

    const sessionDir = path.join(SUB_BOTS_DIR, cleanPhone);
    const cfgPath = path.join(sessionDir, 'config.json');
    if (fs.existsSync(cfgPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            cfg.botName = newName;
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (_) {}
    }

    const active = activeSubBots.get(cleanPhone);
    if (active) {
        active.cfg.botName = newName;
        if (active.sock) active.sock.botName = newName;
    }

    return true;
}

/**
 * تحديث اسم النداء للبوت الفرعي
 */
export function updateSubBotCallName(phone, newCallName) {
    const cleanPhone = cleanPhoneNumber(phone);
    if (!cleanPhone || !newCallName) return false;

    const registry = loadSubBotsRegistry();
    if (registry[cleanPhone]) {
        registry[cleanPhone].callName = newCallName;
        saveSubBotsRegistry(registry);
    }

    const sessionDir = path.join(SUB_BOTS_DIR, cleanPhone);
    const cfgPath = path.join(sessionDir, 'config.json');
    if (fs.existsSync(cfgPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            cfg.callName = newCallName;
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (_) {}
    }

    const active = activeSubBots.get(cleanPhone);
    if (active) {
        active.cfg.callName = newCallName;
        if (active.sock) active.sock.callName = newCallName;
    }

    return true;
}

/**
 * تحديث قائمة الحجاج للبوت الفرعي (إضافة أو إزالة)
 */
export function updateSubBotHajj(phone, targetNum, action = 'add') {
    const cleanPhone = cleanPhoneNumber(phone);
    const cleanTarget = cleanPhoneNumber(targetNum) || String(targetNum).replace(/[^0-9]/g, '');
    if (!cleanPhone || !cleanTarget) return false;

    const registry = loadSubBotsRegistry();
    if (registry[cleanPhone]) {
        if (!registry[cleanPhone].subHajjUsers) registry[cleanPhone].subHajjUsers = [];
        if (!registry[cleanPhone].adminNumbers) registry[cleanPhone].adminNumbers = [];
        if (action === 'add') {
            if (!registry[cleanPhone].subHajjUsers.includes(cleanTarget)) registry[cleanPhone].subHajjUsers.push(cleanTarget);
            if (!registry[cleanPhone].adminNumbers.includes(cleanTarget)) registry[cleanPhone].adminNumbers.push(cleanTarget);
        } else {
            registry[cleanPhone].subHajjUsers = registry[cleanPhone].subHajjUsers.filter(u => u !== cleanTarget);
            registry[cleanPhone].adminNumbers = registry[cleanPhone].adminNumbers.filter(u => u !== cleanTarget);
        }
        saveSubBotsRegistry(registry);
    }

    const sessionDir = path.join(SUB_BOTS_DIR, cleanPhone);
    const cfgPath = path.join(sessionDir, 'config.json');
    if (fs.existsSync(cfgPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (!cfg.subHajjUsers) cfg.subHajjUsers = [];
            if (!cfg.adminNumbers) cfg.adminNumbers = [];
            if (action === 'add') {
                if (!cfg.subHajjUsers.includes(cleanTarget)) cfg.subHajjUsers.push(cleanTarget);
                if (!cfg.adminNumbers.includes(cleanTarget)) cfg.adminNumbers.push(cleanTarget);
            } else {
                cfg.subHajjUsers = cfg.subHajjUsers.filter(u => u !== cleanTarget);
                cfg.adminNumbers = cfg.adminNumbers.filter(u => u !== cleanTarget);
            }
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (_) {}
    }

    const active = activeSubBots.get(cleanPhone);
    if (active) {
        if (!active.cfg.subHajjUsers) active.cfg.subHajjUsers = [];
        if (!active.cfg.adminNumbers) active.cfg.adminNumbers = [];
        if (action === 'add') {
            if (!active.cfg.subHajjUsers.includes(cleanTarget)) active.cfg.subHajjUsers.push(cleanTarget);
            if (!active.cfg.adminNumbers.includes(cleanTarget)) active.cfg.adminNumbers.push(cleanTarget);
        } else {
            active.cfg.subHajjUsers = active.cfg.subHajjUsers.filter(u => u !== cleanTarget);
            active.cfg.adminNumbers = active.cfg.adminNumbers.filter(u => u !== cleanTarget);
        }
        if (active.sock && active.sock.subBotConfig) {
            active.sock.subBotConfig.subHajjUsers = active.cfg.subHajjUsers;
            active.sock.subBotConfig.adminNumbers = active.cfg.adminNumbers;
        }
    }
    return true;
}

/**
 * جلب تقرير كامل عن حالة جميع البوتات الفرعية للمالك
 */
export function getSubBotsReport() {
    const registry = loadSubBotsRegistry();
    const phones = Object.keys(registry);
    const total = phones.length;

    let activeCount = 0;
    let stoppedCount = 0;
    const list = [];

    phones.forEach((phone, idx) => {
        const item = registry[phone];
        const isRunning = activeSubBots.has(phone);
        if (isRunning) activeCount++;
        else stoppedCount++;

        list.push(
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `*${idx + 1}️⃣ ${item.botName || 'بوت فرعي'}* (نداء: ${item.callName || item.botName || 'فرعي'})\n` +
            `📱 *رقم البوت:* +${item.phone}\n` +
            `👑 *الحج الأساسي:* +${item.adminPhone || 'غير محدد'}${item.adminLid ? ` (ID: ${item.adminLid})` : ''}\n` +
            `🟢 *الحالة:* ${isRunning ? '⚡ شغال الآن' : (item.status === 'stopped' ? '🛑 متوقف' : '⚠️ غير متصل')}\n` +
            `📅 *تاريخ التنصيب:* ${item.installedAt ? new Date(item.installedAt).toLocaleDateString('ar-EG') : 'غير مسجل'}`
        );
    });

    return {
        total,
        activeCount,
        stoppedCount,
        listText: list.length > 0 ? list.join('\n') : 'لا توجد بوتات فرعية مسجلة حالياً.'
    };
}
