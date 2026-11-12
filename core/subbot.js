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
export const subBotSentMsgIds = new Set();
global.subBotSentMsgIds = subBotSentMsgIds;

/**
 * تحميل سجل البوتات الفرعية من ملف sub_bots.json مع استرجاع تلقائي من النسخة الاحتياطية
 */
export function loadSubBotsRegistry() {
    try {
        if (fs.existsSync(REGISTRY_FILE)) {
            const content = fs.readFileSync(REGISTRY_FILE, 'utf8').trim();
            if (content && content !== '{}') {
                return JSON.parse(content);
            }
        }
        // استرجاع تلقائي من مجلد الجلسات المحمي في حال تم تحديث السيرفر
        const backupFile = path.join(process.cwd(), 'sessions', 'sub_bots_registry_backup.json');
        if (fs.existsSync(backupFile)) {
            const backupContent = fs.readFileSync(backupFile, 'utf8').trim();
            if (backupContent && backupContent !== '{}') {
                const data = JSON.parse(backupContent);
                try { fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
                return data;
            }
        }
    } catch (e) {
        console.error('❌ خطأ في قراءة سجل البوتات الفرعية:', e?.message || e);
    }
    return {};
}

/**
 * حفظ سجل البوتات الفرعية مع إنشاء نسخة احتياطية في مجلد الجلسات المحمي من التحديثات
 */
export function saveSubBotsRegistry(data) {
    try {
        fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf8');
        try {
            const backupDir = path.join(process.cwd(), 'sessions');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const backupFile = path.join(backupDir, 'sub_bots_registry_backup.json');
            fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (_) {}
        return true;
    } catch (e) {
        console.error('❌ خطأ في حفظ سجل البوتات الفرعية:', e?.message || e);
        return false;
    }
}

const SAVED_PROFILES_FILE = path.join(process.cwd(), 'sub_bots_saved.json');

/**
 * تحميل إعدادات البوتات المحفوظة لأصحابها
 */
export function loadSavedBotProfiles() {
    try {
        if (fs.existsSync(SAVED_PROFILES_FILE)) {
            const content = fs.readFileSync(SAVED_PROFILES_FILE, 'utf8').trim();
            if (content && content !== '{}') {
                return JSON.parse(content);
            }
        }
        const backupFile = path.join(process.cwd(), 'sessions', 'sub_bots_saved_backup.json');
        if (fs.existsSync(backupFile)) {
            return JSON.parse(fs.readFileSync(backupFile, 'utf8'));
        }
    } catch (e) {
        console.error('❌ خطأ في قراءة إعدادات البوتات المحفوظة:', e?.message || e);
    }
    return {};
}

/**
 * حفظ إعدادات البوت برقم صاحبه للحفاظ على الخصوصية وإمكانية الاسترجاع
 */
export function saveSavedBotProfile(phone, profile) {
    if (!phone) return;
    try {
        const cleanP = cleanPhoneNumber(phone) || String(phone).replace(/[^0-9]/g, '');
        if (!cleanP) return;
        const data = loadSavedBotProfiles();
        data[cleanP] = {
            ...profile,
            updatedAt: Date.now()
        };
        fs.writeFileSync(SAVED_PROFILES_FILE, JSON.stringify(data, null, 2), 'utf8');
        try {
            const backupDir = path.join(process.cwd(), 'sessions');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const backupFile = path.join(backupDir, 'sub_bots_saved_backup.json');
            fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (_) {}
        return true;
    } catch (e) {
        console.error('❌ خطأ في حفظ إعدادات البوت المحفوظ:', e?.message || e);
        return false;
    }
}

/**
 * حذف إعدادات البوت المحفوظ للمستخدم
 */
export function removeSavedBotProfile(phone) {
    if (!phone) return;
    try {
        const cleanP = cleanPhoneNumber(phone) || String(phone).replace(/[^0-9]/g, '');
        if (!cleanP) return;
        const data = loadSavedBotProfiles();
        if (data[cleanP]) {
            delete data[cleanP];
            fs.writeFileSync(SAVED_PROFILES_FILE, JSON.stringify(data, null, 2), 'utf8');
        }
    } catch (_) {}
}

/**
 * تنظيف رقم الهاتف وإبقاؤه أرقاماً فقط مع تحويل الأرقام المحلية للدولية
 */
export function cleanPhoneNumber(phone) {
    if (!phone) return '';
    let str = String(phone);
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    for (let i = 0; i < 10; i++) {
        str = str.replaceAll(arabicDigits[i], String(i)).replaceAll(persianDigits[i], String(i));
    }
    let clean = str.replace(/[^0-9]/g, '');
    if (clean.startsWith('00')) clean = clean.substring(2);
    // تحويل أرقام مصر المحلية 010/011/012/015 المكونة من 11 رقماً تلقائياً إلى 201...
    if (clean.startsWith('01') && clean.length === 11) {
        clean = '20' + clean.substring(1);
    }
    return clean;
}

/**
 * استخراج الرقم المجرد من JID أو LID
 */
export function getCleanNumber(jid) {
    if (!jid) return '';
    return String(jid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
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
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2000,
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
                sock.sentMsgIds = sock.sentMsgIds || new Set();
                sock.sentMsgIds.add(res.key.id);
                setTimeout(() => {
                    subBotSentMsgIds.delete(res.key.id);
                    sock.sentMsgIds?.delete(res.key.id);
                }, 120000);
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
    sock.movies = {};
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
        sock.isSubBot = true;
        sock.subBotPhone = cleanPhone;
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

        // 📥 تسجيل مجموعات البوت الفرعي تلقائياً فور انضمامه أو تحديثها لضمان إرسال الأذكار والصلوات
        sock.ev.on('groups.upsert', async (groups) => {
            try {
                if (!sock.subBotConfig) sock.subBotConfig = {};
                if (!sock.subBotConfig.knownGroups) sock.subBotConfig.knownGroups = [];
                let updated = false;
                for (const g of groups) {
                    const gid = g.id;
                    if (gid && gid.endsWith('@g.us') && !sock.subBotConfig.knownGroups.includes(gid)) {
                        sock.subBotConfig.knownGroups.push(gid);
                        updated = true;
                    }
                }
                if (updated) {
                    const cfgPath = path.join(process.cwd(), 'sessions', 'sub_bots', cleanPhone, 'config.json');
                    if (fs.existsSync(path.dirname(cfgPath))) {
                        fs.writeFileSync(cfgPath, JSON.stringify(sock.subBotConfig, null, 2), 'utf8');
                    }
                }
            } catch (_) {}
        });

        // 🔥 الترحيب التلقائي وتسجيل الجروب بالبوت الفرعي
        sock.ev.on('group-participants.update', async (update) => {
            try {
                if (update?.id && update.id.endsWith('@g.us')) {
                    if (!sock.subBotConfig) sock.subBotConfig = {};
                    if (!sock.subBotConfig.knownGroups) sock.subBotConfig.knownGroups = [];
                    if (!sock.subBotConfig.knownGroups.includes(update.id)) {
                        sock.subBotConfig.knownGroups.push(update.id);
                        const cfgPath = path.join(process.cwd(), 'sessions', 'sub_bots', cleanPhone, 'config.json');
                        if (fs.existsSync(path.dirname(cfgPath))) {
                            fs.writeFileSync(cfgPath, JSON.stringify(sock.subBotConfig, null, 2), 'utf8');
                        }
                    }
                }
                const datelsModule = await import('../plugins/datels.js');
                const handler = datelsModule.default || datelsModule;
                if (handler && typeof handler.participantsUpdate === 'function') {
                    await handler.participantsUpdate(update, sock);
                }
            } catch (_) {}
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                subBotStartTime = Math.floor(Date.now() / 1000);
                sock.subBotStartTime = subBotStartTime;
                console.log(`🤖 [Sub-Bot] البوت الفرعي (${cfg.botName || cleanPhone}) متصل وشغال الآن! (+${cleanPhone})`);

                // اكتشاف وتوثيق LID الحج الأساسي تلقائياً عند بدء التشغيل
                if (!cfg.adminLid && cfg.adminPhone && cfg.adminPhone.length <= 13) {
                    try {
                        const waCheck = await sock.onWhatsApp(`${cfg.adminPhone}@s.whatsapp.net`);
                        if (waCheck && waCheck[0]?.lid) {
                            const fetchedLid = waCheck[0].lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                            if (fetchedLid) {
                                cfg.adminLid = fetchedLid;
                                if (!Array.isArray(cfg.adminNumbers)) cfg.adminNumbers = [];
                                if (!cfg.adminNumbers.includes(fetchedLid)) cfg.adminNumbers.push(fetchedLid);
                                if (!cfg.adminNumbers.includes(`${fetchedLid}@lid`)) cfg.adminNumbers.push(`${fetchedLid}@lid`);
                                sock.subBotConfig = cfg;

                                const registry = loadSubBotsRegistry();
                                if (registry[cleanPhone]) {
                                    registry[cleanPhone].adminLid = fetchedLid;
                                    registry[cleanPhone].adminNumbers = cfg.adminNumbers;
                                    saveSubBotsRegistry(registry);
                                }
                                try {
                                    fs.writeFileSync(path.join(sessionDir, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
                                    const dbPath = path.join(process.cwd(), 'scramble_db.json');
                                    if (fs.existsSync(dbPath)) {
                                        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                                        if (!db.lidMap) db.lidMap = {};
                                        db.lidMap[cfg.adminPhone] = fetchedLid;
                                        db.lidMap[fetchedLid] = cfg.adminPhone;
                                        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
                                    }
                                } catch (_) {}
                            }
                        }
                    } catch (_) {}
                }

                activeSubBots.set(cleanPhone, { sock, cfg, startTime: subBotStartTime });
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                activeSubBots.delete(cleanPhone);

                console.log(`⚠️ [Sub-Bot] انقطع اتصال البوت الفرعي (+${cleanPhone}). الرمز: ${statusCode}`);

                // لا نقوم بحذف الجلسة مطلقاً، ونعيد الاتصال تلقائياً طالما لم يتم إيقافه يدوياً بأمر (ايقاف تنصيب)
                const isManuallyStopped = cfg.status === 'stopped';
                if (!isManuallyStopped) {
                    console.log(`🔄 [Sub-Bot] إعادة تشغيل البوت الفرعي تلقائياً (+${cleanPhone}) بعد 5 ثوانٍ...`);
                    setTimeout(() => {
                        bootSubBot(cleanPhone, cfg, mainConn || global.conn).catch(e => console.error(e));
                    }, 5000);
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

    if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 13) {
        await mainConn.sendMessage(notifyJid, { text: '❌ رقم هاتف البوت غير صالح (+${cleanPhone})، يبدو أنه معرف مشفر (LID) وليس رقم شريحة هاتف حقيقي!\nبرجاء كتابة رقم الهاتف بالأرقام (مثال: 01012345678 أو 201012345678).' }, { quoted: quotedMek });
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
    let isExpired = false;
    let warnTimer = null;
    let expireTimer = null;

    async function sendNotify(text, quoted = null) {
        const c = global.conn || mainConn;
        if (!c || !notifyJid) return false;
        if (quoted) {
            try {
                await c.sendMessage(notifyJid, { text }, { quoted });
                return true;
            } catch (_) {}
        }
        try {
            await c.sendMessage(notifyJid, { text });
            return true;
        } catch (e) {
            console.error('❌ [Sub-Bot Notify Error]:', e?.message || e);
            return false;
        }
    }

    async function startPairingEngine() {
        if (isExpired) return;
        try {
            const { sock, saveCreds } = await createSubBotSocket(cleanPhone, sessionDir);
            sock.botName = botName;
            sock.callName = finalCallName;
            sock.gender = finalGender;
            sock.personality = finalPersonality;
            sock.isSubBot = true;
            sock.subBotPhone = cleanPhone;
            let subBotStartTime = Math.floor(Date.now() / 1000);

            sock.ev.on('creds.update', async () => {
                try {
                    await saveCreds();
                } catch (_) {}
                if (sock.authState?.creds?.registered) {
                    if (warnTimer) clearTimeout(warnTimer);
                    if (expireTimer) clearTimeout(expireTimer);
                    isExpired = false;
                }
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                // 🔑 طلب كود الاقتران عند الاتصال إذا لم يكن الجهاز مسجلاً
                if (!sock.authState.creds.registered && !pairingCodeSent) {
                    pairingCodeSent = true;
                    setTimeout(async () => {
                        try {
                            if (!sock.authState.creds.registered && !isExpired) {
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
                                    `┃ 🔑 *كود الاقتران:* \`${code}\`\n` +
                                    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
                                    `📌 *طريقة الربط بالهاتف:* \n` +
                                    `1️⃣ افتح واتساب من الهاتف صاحب الرقم (+${cleanPhone}).\n` +
                                    `2️⃣ اضغط على الثلاث نقاط (⋮) ⬅️ *الأجهزة المرتبطة*.\n` +
                                    `3️⃣ اضغط *ربط جهاز*.\n` +
                                    `4️⃣ اضغط *الربط باستخدام رقم الهاتف بدلاً من ذلك*.\n` +
                                    `5️⃣ انسخ الكود من الرسالة التالية وأدخله مباشرة.\n\n` +
                                    `📋👇 *تم إرسال الكود في الرسالة التالية بمفرده لنسخه بنقرة واحدة بسهولة!* 👇\n\n` +
                                    `⏳ *الكود صالح لمدة 3 دقائق فقط.*\n` +
                                    `⚠️ سيصلك إشعار تنبيه قبل دقيقة من انتهاء الوقت إذا لم تقم بالربط!`;

                                await sendNotify(pairMsg, quotedMek);

                                // 📋 إرسال الكود في رسالة منفصلة مخصصة لنسخه بنقرة واحدة
                                await new Promise(r => setTimeout(r, 800));
                                await sendNotify(`${code}`);

                                // ⏱️ تنبيه بعد دقيقتين (120 ثانية) بأن المتبقي دقيقة واحدة فقط
                                warnTimer = setTimeout(async () => {
                                    if (!isConnected && !isExpired && (!sock.authState?.creds?.registered)) {
                                        try {
                                            console.log(`⏱️ [Sub-Bot Pairing] إرسال تنبيه الدقيقة المتبقية للرقم (+${cleanPhone})`);
                                            const warnMsg = 
                                                `⚠️ *تنبيه هام: متبقي دقيقة واحدة فقط!* ⏳\n\n` +
                                                `كود اقتران بوتك (${botName}) سينتهي ويصبح غير صالح بعد 60 ثانية!\n` +
                                                `📱 الكود متاح في الرسالة التالية لنسخه فوراً:`;
                                            await sendNotify(warnMsg, quotedMek);
                                            await new Promise(r => setTimeout(r, 600));
                                            await sendNotify(`${code}`);
                                        } catch (_) {}
                                    }
                                }, 120000);

                                // ⏱️ انتهاء صلاحية الكود بعد 3 دقائق (180 ثانية) وسؤال المستخدم إذا كان يريد كوداً آخر أم إلغاء
                                expireTimer = setTimeout(async () => {
                                    if (!isConnected && !isExpired && (!sock.authState?.creds?.registered)) {
                                        isExpired = true;
                                        console.log(`⌛ [Sub-Bot Pairing] انتهاء صلاحية الكود للرقم (+${cleanPhone})`);

                                        try {
                                            sock.end(new Error('Pairing code 3m timeout'));
                                        } catch (_) {}

                                        const retryKey = cleanAdmin || getCleanNumber(notifyJid) || cleanPhone;
                                        const retryMsg = 
                                            `⌛ *انتهت صلاحية كود الاقتران الحالي (3 دقائق)!* ⌛\n\n` +
                                            `❓ *عايز تطلب كود جديد بنفس التنصيب ولا تلغي العملية؟*\n\n` +
                                            `1️⃣ اكتب *(تجديد)* أو *(كود جديد)* أو *(1)* لتجديد الكود واستخراج كود ساري بنفس بيانات التنصيب 🔄\n` +
                                            `2️⃣ اكتب *(الغاء)* أو *(2)* لإلغاء عملية التنصيب ❌\n\n` +
                                            `⏱️ _الرسالة دي هتقعد 5 دقائق، لو مردتش البوت هيلغي العملية تلقائياً ويحفظ بيانات بوتك لتشغيله في أي وقت._`;

                                        await sendNotify(retryMsg);

                                        // حفظ بيانات البوت الملغي للحفاظ على الخصوصية وإمكانية الاسترجاع
                                        saveSavedBotProfile(retryKey, {
                                            botName,
                                            callName: finalCallName,
                                            gender: finalGender,
                                            personality: finalPersonality,
                                            targetPhone: cleanPhone,
                                            adminPhone: cleanAdmin || retryKey
                                        });

                                        // تايمر الـ 5 دقائق للإلغاء التلقائي في حال عدم الرد
                                        const autoCancelTimer = setTimeout(async () => {
                                            if (global.pendingPairingRetry && (global.pendingPairingRetry.has(retryKey) || global.pendingPairingRetry.has(cleanAdmin))) {
                                                global.pendingPairingRetry.delete(retryKey);
                                                if (cleanAdmin) global.pendingPairingRetry.delete(cleanAdmin);
                                                if (notifyJid) global.pendingPairingRetry.delete(getCleanNumber(notifyJid));

                                                try {
                                                    if (fs.existsSync(sessionDir)) {
                                                        fs.rmSync(sessionDir, { recursive: true, force: true });
                                                    }
                                                } catch (_) {}

                                                console.log(`❌ [Sub-Bot Pairing] إلغاء تلقائي للتنصيب بعد 5 دقائق لعدم الرد (+${cleanPhone})`);
                                                const autoCancelMsg = `❌ *تم إلغاء عملية التنصيب تلقائياً لعدم الرد خلال 5 دقائق.* ⌛\n💡 _تم حفظ بيانات بوتك (${botName})، لو حبيت ترجع تشغله في أي وقت اكتب فقط (تنصيب)._`;
                                                await sendNotify(autoCancelMsg);
                                            }
                                        }, 5 * 60 * 1000);

                                        if (!global.pendingPairingRetry) global.pendingPairingRetry = new Map();
                                        const retryData = {
                                            targetPhone: cleanPhone,
                                            botName,
                                            callName: finalCallName,
                                            gender: finalGender,
                                            personality: finalPersonality,
                                            adminPhone: cleanAdmin,
                                            adminLid: cleanLid,
                                            sessionDir,
                                            notifyJid,
                                            quotedMek,
                                            mainConn,
                                            autoCancelTimer,
                                            createdAt: Date.now()
                                        };

                                        global.pendingPairingRetry.set(retryKey, retryData);
                                        if (cleanAdmin) global.pendingPairingRetry.set(cleanAdmin, retryData);
                                        if (notifyJid) {
                                             const notifyClean = getCleanNumber(notifyJid);
                                             if (notifyClean) global.pendingPairingRetry.set(notifyClean, retryData);
                                        }
                                    }
                                }, 180000);
                            }
                        } catch (codeErr) {
                            console.error('❌ خطأ في استخراج كود الاقتران:', codeErr?.message || codeErr);
                            pairingCodeSent = false;
                        }
                    }, 3500);
                }

                if (connection === 'open') {
                    try {
                        isConnected = true;
                        isExpired = false;
                        if (warnTimer) clearTimeout(warnTimer);
                        if (expireTimer) clearTimeout(expireTimer);
                        if (global.pendingPairingRetry) {
                            global.pendingPairingRetry.delete(cleanAdmin);
                            global.pendingPairingRetry.delete(cleanPhone);
                            if (notifyJid) global.pendingPairingRetry.delete(getCleanNumber(notifyJid));
                        }
                        removeSavedBotProfile(cleanAdmin);
                        removeSavedBotProfile(cleanPhone);
                        if (notifyJid) removeSavedBotProfile(getCleanNumber(notifyJid));
                        subBotStartTime = Math.floor(Date.now() / 1000);
                        sock.subBotStartTime = subBotStartTime;
                        console.log(`🎉 [Sub-Bot] تم ربط وتنصيب البوت الفرعي بنجاح! (+${cleanPhone})`);

                        // إذا لم يكن LID الحج مستخرجاً، نستخرجه فوراً عبر السوكيت بعد الاتصال مباشرة
                        if (!cleanLid && cleanAdmin && cleanAdmin.length <= 13) {
                            try {
                                const waCheck = await sock.onWhatsApp(`${cleanAdmin}@s.whatsapp.net`);
                                if (waCheck && waCheck[0]?.lid) {
                                    cleanLid = waCheck[0].lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                                    console.log(`🔍 [Sub-Bot] تم اكتشاف LID الحج بنجاح: ${cleanLid}`);
                                }
                            } catch (_) {}
                        }

                        const adminLocal = (cleanAdmin.startsWith('201') && cleanAdmin.length === 12) ? ('01' + cleanAdmin.slice(2)) : '';
                        const adminNumbersList = [
                            cleanAdmin, 
                            adminLocal, 
                            `+${cleanAdmin}`, 
                            cleanLid, 
                            `${cleanAdmin}@s.whatsapp.net`, 
                            cleanLid ? `${cleanLid}@lid` : '',
                            adminLocal ? `${adminLocal}@s.whatsapp.net` : ''
                        ].filter(Boolean);

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

                        // توثيق الـ LID في scramble_db.json
                        if (cleanAdmin && cleanLid) {
                            try {
                                const dbPath = path.join(process.cwd(), 'scramble_db.json');
                                if (fs.existsSync(dbPath)) {
                                    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                                    if (!db.lidMap) db.lidMap = {};
                                    db.lidMap[cleanAdmin] = cleanLid;
                                    db.lidMap[cleanLid] = cleanAdmin;
                                    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
                                }
                            } catch (_) {}
                        }

                        activeSubBots.set(cleanPhone, { sock, cfg: cfgData, startTime: subBotStartTime });

                        const successMsg = 
                            `🎉 *مبروك! تم تفعيل وتشغيل بوتك (${botName} - نداء: ${finalCallName}) بنجاح!* 🚀\n\n` +
                            `👑 أنت الآن الحج الأساسي على هذا البوت (+${cleanPhone}).\n` +
                            `🗣️ تقدر تنده عليه باسمه (${finalCallName}) وتتحكم فيه بشكل كامل!\n` +
                            `💬 البوت شغال الآن ويرد على الأوامر في الخاص والجروبات.\n` +
                            `📌 جرب اكتب (.اوامر) في أي شات مع البوت لتجربته واستكشاف مميزاته!\n\n` +
                            `🗑️ *إلغاء التنصيب:* إذا أردت إلغاء تنصيب هذا البوت وحذفه نهائياً في أي وقت، اكتب للبوت: *(الغاء تنصيب)* وسيتم حذفه فوراً.`;

                        // 1. إرسال رسالة النجاح للشخص الذي نصب البوت (مرة واحدة فقط)
                        try {
                            const sent = await sendNotify(successMsg, quotedMek);
                            if (!sent && sock) {
                                await sock.sendMessage(notifyJid, { text: successMsg });
                            }
                        } catch (e) {
                            console.error('❌ [Sub-Bot Success Send Error]:', e?.message || e);
                            try { if (sock) await sock.sendMessage(notifyJid, { text: successMsg }); } catch (_) {}
                        }

                        // 2. إشعار فوري للحج شادو (المالك الأصلي) فقط دون الإرسال لرقم البوت نفسه
                        const ownerNotice = 
                            `📢 *إشعار تنصيب بوت فرعي جديد:*\n` +
                            `🏷️ *الاسم الرسمي:* ${botName}\n` +
                            `🗣️ *اسم النداء:* ${finalCallName}\n` +
                            `📱 *رقم البوت:* +${cleanPhone}\n` +
                            `👤 *الحج الأساسي:* +${cleanAdmin}${cleanLid ? ` (ID: ${cleanLid})` : ''}\n` +
                            `⏰ *التاريخ:* ${new Date().toLocaleString('ar-EG')}\n` +
                            `👑 الحج الأصلي لديه التحكم الكامل بهذا البوت.`;

                        const masterPhone = '201129249396@s.whatsapp.net';
                        try {
                            const c = global.conn || mainConn;
                            if (c) {
                                await c.sendMessage(masterPhone, { text: ownerNotice });
                            } else if (sock) {
                                await sock.sendMessage(masterPhone, { text: ownerNotice });
                            }
                        } catch (err) {
                            console.error(`❌ [Sub-Bot Notice Send Error for ${masterPhone}]:`, err?.message || err);
                            try {
                                if (sock) await sock.sendMessage(masterPhone, { text: ownerNotice });
                            } catch (_) {}
                        }
                    } catch (openErr) {
                        console.error('❌ [Sub-Bot Connection Open Handling Error]:', openErr?.message || openErr);
                    }
                }

                if (connection === 'close') {
                    if (isExpired) return;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`⚠️ [Sub-Bot Pairing] انقطع اتصال السوكيت للرقم (+${cleanPhone}) بكود: ${statusCode}`);
                    activeSubBots.delete(cleanPhone);

                    if (!isConnected) {
                        // ⚡ الأهم: إعادة الاتصال فوراً لاستكمال المصافحة (Handshake) بعد إدخال الكود (خصوصاً خطأ 515 و 428)
                        console.log(`🔄 [Sub-Bot Pairing] إعادة الاتصال التلقائي لاستكمال الاقتران (+${cleanPhone})...`);
                        setTimeout(() => {
                            if (!isExpired) {
                                startPairingEngine().catch(e => console.error('Retry pairing error:', e));
                            }
                        }, 2500);
                    } else {
                        // إذا كان متصلاً وانقطع لاحقاً (إعادة تشغيله تلقائياً طالما لم يتم إيقافه يدوياً)
                        const registry = loadSubBotsRegistry();
                        const currentCfg = registry[cleanPhone] || cfgData;
                        if (currentCfg?.status !== 'stopped') {
                            console.log(`🔄 [Sub-Bot] إعادة تشغيل البوت الفرعي المتصل (+${cleanPhone}) تلقائياً بعد 4 ثوانٍ...`);
                            setTimeout(() => {
                                bootSubBot(cleanPhone, currentCfg, mainConn || global.conn).catch(e => console.error(e));
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

            // 📥 تسجيل مجموعات البوت الفرعي تلقائياً
            sock.ev.on('groups.upsert', async (groups) => {
                try {
                    if (!sock.subBotConfig) sock.subBotConfig = {};
                    if (!sock.subBotConfig.knownGroups) sock.subBotConfig.knownGroups = [];
                    let updated = false;
                    for (const g of groups) {
                        const gid = g.id;
                        if (gid && gid.endsWith('@g.us') && !sock.subBotConfig.knownGroups.includes(gid)) {
                            sock.subBotConfig.knownGroups.push(gid);
                            updated = true;
                        }
                    }
                    if (updated) {
                        const cfgPath = path.join(process.cwd(), 'sessions', 'sub_bots', cleanPhone, 'config.json');
                        if (fs.existsSync(path.dirname(cfgPath))) {
                            fs.writeFileSync(cfgPath, JSON.stringify(sock.subBotConfig, null, 2), 'utf8');
                        }
                    }
                } catch (_) {}
            });

            // 🔥 الترحيب التلقائي وتسجيل الجروب بالبوت الفرعي
            sock.ev.on('group-participants.update', async (update) => {
                try {
                    if (update?.id && update.id.endsWith('@g.us')) {
                        if (!sock.subBotConfig) sock.subBotConfig = {};
                        if (!sock.subBotConfig.knownGroups) sock.subBotConfig.knownGroups = [];
                        if (!sock.subBotConfig.knownGroups.includes(update.id)) {
                            sock.subBotConfig.knownGroups.push(update.id);
                            const cfgPath = path.join(process.cwd(), 'sessions', 'sub_bots', cleanPhone, 'config.json');
                            if (fs.existsSync(path.dirname(cfgPath))) {
                                fs.writeFileSync(cfgPath, JSON.stringify(sock.subBotConfig, null, 2), 'utf8');
                            }
                        }
                    }
                    const datelsModule = await import('../plugins/datels.js');
                    const handler = datelsModule.default || datelsModule;
                    if (handler && typeof handler.participantsUpdate === 'function') {
                        await handler.participantsUpdate(update, sock);
                    }
                } catch (_) {}
            });

            return sock;
        } catch (e) {
            console.error('❌ خطأ في محرك الاقتران:', e);
            throw e;
        }
    }

    return await startPairingEngine();
}

// 💓 [Watchdog & Heartbeat] حارس ذكي دائم لمنع خروج أو فصل البوتات الفرعية نهائياً (24/7)
let isSubBotWatchdogStarted = false;
export function startSubBotWatchdog(mainConn) {
    if (isSubBotWatchdogStarted) return;
    isSubBotWatchdogStarted = true;

    console.log('🛡️ [Sub-Bot Watchdog] تم تفعيل نظام النبض والحماية لمنع خروج البوتات الفرعية نهائياً (24/7).');

    // 1. نبض نشط كل دقيقتين لمنع واتساب من اعتبار الجلسة خاملة وقطعها بعد 20-30 دقيقة
    setInterval(async () => {
        for (const [phone, item] of activeSubBots.entries()) {
            try {
                if (item.sock?.ws?.isOpen) {
                    await item.sock.sendPresenceUpdate('available');
                }
            } catch (_) {}
        }
    }, 2 * 60 * 1000);

    // 2. فحص دوري كل دقيقة لإعادة تشغيل أي بوت فرعي مسجل انقطع اتصاله تلقائياً
    setInterval(async () => {
        try {
            const registry = loadSubBotsRegistry() || {};
            for (const [phone, cfg] of Object.entries(registry)) {
                const clean = cleanPhoneNumber(phone);
                if (!clean || cfg?.status === 'stopped') continue;

                const activeItem = activeSubBots.get(clean);
                const isSocketAlive = activeItem?.sock?.ws?.isOpen;

                if (!isSocketAlive) {
                    console.log(`🛡️ [Sub-Bot Watchdog] رصد انقطاع البوت الفرعي (+${clean})، جاري إعادة تشغيله تلقائياً...`);
                    activeSubBots.delete(clean);
                    bootSubBot(clean, cfg, mainConn || global.conn).catch(() => {});
                }
            }
        } catch (_) {}
    }, 60 * 1000);
}

/**
 * تشغيل واسترجاع جميع البوتات الفرعية المسجلة عند إقلاع البوت الرئيسي
 * يتم استرجاعها تلقائياً من السجل ومجلد الجلسات لمنع مسح أي بوت بعد أي تحديث
 */
export async function initAllSubBots(mainConn) {
    startSubBotWatchdog(mainConn || global.conn);

    const registry = loadSubBotsRegistry() || {};
    let registryModified = false;

    // 1. فحص شامل لمجلدات الجلسات في sessions/sub_bots لضمان عدم ضياع أي بوت بعد أي تحديث كود أو ريستارت
    if (fs.existsSync(SUB_BOTS_DIR)) {
        try {
            const dirs = fs.readdirSync(SUB_BOTS_DIR);
            for (const d of dirs) {
                const clean = cleanPhoneNumber(d);
                if (!clean) continue;

                const sessionFolder = path.join(SUB_BOTS_DIR, d);
                const credsFile = path.join(sessionFolder, 'creds.json');
                const cfgFile = path.join(sessionFolder, 'config.json');

                if (fs.existsSync(credsFile)) {
                    let cfg = null;
                    if (fs.existsSync(cfgFile)) {
                        try {
                            cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
                        } catch (_) {}
                    }
                    if (!cfg) {
                        cfg = {
                            phone: clean,
                            botName: 'بوت فرعي',
                            callName: 'فرعي',
                            gender: 'male',
                            personality: 'respectful',
                            status: 'active',
                            installedAt: new Date().toISOString()
                        };
                    }
                    if (!registry[clean]) {
                        console.log(`♻️ [Sub-Bots] تم استرجاع وحفظ بيانات البوت الفرعي (+${clean}) تلقائياً بعد التحديث!`);
                        registry[clean] = cfg;
                        registryModified = true;
                    }
                }
            }
        } catch (scanErr) {
            console.error('❌ خطأ في فحص مجلدات الجلسات:', scanErr);
        }
    }

    if (registryModified) {
        saveSubBotsRegistry(registry);
    }

    const phones = Object.keys(registry);

    if (phones.length === 0) {
        console.log('ℹ️ [Sub-Bots] لا توجد بوتات فرعية مسجلة حالياً.');
        return;
    }

    console.log(`🔄 [Sub-Bots] جاري استرجاع وتشغيل ${phones.length} بوت فرعي مسجل ومحفوظ...`);

    let delaySec = 3;
    for (const phone of phones) {
        const cfg = registry[phone];
        if (cfg && cfg.status !== 'stopped') {
            setTimeout(async () => {
                try {
                    await bootSubBot(phone, cfg, mainConn || global.conn);
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
 * حذف بوت فرعي وملفاته نهائياً وإشعار رقم البوت بإعادة التنصيب فقط إذا قام الحج شادو بالحذف للتحديثات
 */
export async function deleteSubBotRemote(phone, mainConn = null, notifyOwner = false) {
    const cleanPhone = cleanPhoneNumber(phone);
    const registry = loadSubBotsRegistry();
    const botData = registry[cleanPhone] || null;

    // إرسال إشعار لرقم البوت الفرعي فقط عندما يقوم المطور الأساسي (شادو) بالحذف للتحديثات
    if (notifyOwner && mainConn && cleanPhone) {
        const targetBotName = botData?.botName || 'بوتك الفرعي';
        const botPhoneJid = `${cleanPhone}@s.whatsapp.net`;
        try {
            const notifyMsg = 
                `⚠️ *إشعار هام من إدارة شادو بوت* 👑🤖\n\n` +
                `عذراً يا فنان/ة، تم إلغاء تنصيب بوتك (${targetBotName}) مؤقتاً نظراً لإجراء تحديثات وتطويرات جديدة شاملة على السيرفر.\n\n` +
                `🔄 *معلش أنصبه تاني* للاستفادة من أحدث المميزات والإصلاحات والتطويرات الجديدة!\n` +
                `✨ فقط افتح الشات الخاص مع البوت واكتب *(تنصيب)* واتبع الخطوات البسيطة للربط بكود جديد مجاناً ❤️`;
            await mainConn.sendMessage(botPhoneJid, { text: notifyMsg });
        } catch (err) {
            console.error(`خطأ في إرسال إشعار الحذف لرقم البوت الفرعي (+${cleanPhone}):`, err?.message || err);
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

    return { 
        success: true, 
        message: notifyOwner 
            ? `🗑️ تم حذف البوت الفرعي (+${cleanPhone}) وملفاته بنجاح وإرسال إشعار التحديث لصاحبه! ✅`
            : `🗑️ تم حذف البوت الفرعي (+${cleanPhone}) وملفاته بنجاح في صمت تام دون إرسال أي إشعار لصاحبه! 🤫`
    };
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
 * تعديل ونقل ملكية الحج الأساسي للبوت الفرعي بالكامل
 */
export function updateSubBotMainOwner(botPhone, newAdminPhone, newAdminLid = '') {
    const cleanBot = cleanPhoneNumber(botPhone);
    const cleanAdmin = cleanPhoneNumber(newAdminPhone);
    if (!cleanBot || !cleanAdmin) return false;

    const registry = loadSubBotsRegistry();
    if (!registry[cleanBot]) return false;

    const adminLocal = (cleanAdmin.startsWith('201') && cleanAdmin.length === 12) ? ('01' + cleanAdmin.slice(2)) : '';
    const adminNumbersList = [
        cleanAdmin,
        adminLocal,
        `+${cleanAdmin}`,
        newAdminLid,
        `${cleanAdmin}@s.whatsapp.net`,
        newAdminLid ? `${newAdminLid}@lid` : '',
        adminLocal ? `${adminLocal}@s.whatsapp.net` : ''
    ].filter(Boolean);

    registry[cleanBot].adminPhone = cleanAdmin;
    if (newAdminLid) registry[cleanBot].adminLid = newAdminLid;
    registry[cleanBot].adminJid = `${cleanAdmin}@s.whatsapp.net`;
    registry[cleanBot].adminNumbers = adminNumbersList;
    saveSubBotsRegistry(registry);

    const sessionDir = path.join(SUB_BOTS_DIR, cleanBot);
    const cfgPath = path.join(sessionDir, 'config.json');
    if (fs.existsSync(cfgPath)) {
        try {
            const currentCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            currentCfg.adminPhone = cleanAdmin;
            if (newAdminLid) currentCfg.adminLid = newAdminLid;
            currentCfg.adminJid = `${cleanAdmin}@s.whatsapp.net`;
            currentCfg.adminNumbers = adminNumbersList;
            fs.writeFileSync(cfgPath, JSON.stringify(currentCfg, null, 2), 'utf8');
        } catch (_) {}
    }

    if (activeSubBots.has(cleanBot)) {
        const active = activeSubBots.get(cleanBot);
        if (active.cfg) {
            active.cfg.adminPhone = cleanAdmin;
            if (newAdminLid) active.cfg.adminLid = newAdminLid;
            active.cfg.adminJid = `${cleanAdmin}@s.whatsapp.net`;
            active.cfg.adminNumbers = adminNumbersList;
        }
        if (active.sock && active.sock.subBotConfig) {
            active.sock.subBotConfig.adminPhone = cleanAdmin;
            if (newAdminLid) active.sock.subBotConfig.adminLid = newAdminLid;
            active.sock.subBotConfig.adminJid = `${cleanAdmin}@s.whatsapp.net`;
            active.sock.subBotConfig.adminNumbers = adminNumbersList;
        }
    }

    // ربط الـ LID برقم الهاتف في scramble_db.json
    if (cleanAdmin && newAdminLid) {
        try {
            const dbPath = path.join(process.cwd(), 'scramble_db.json');
            if (fs.existsSync(dbPath)) {
                const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                if (!db.lidMap) db.lidMap = {};
                db.lidMap[cleanAdmin] = newAdminLid;
                db.lidMap[newAdminLid] = cleanAdmin;
                fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
            }
        } catch (_) {}
    }

    return true;
}

/**
 * جلب تقرير كامل عن حالة جميع البوتات الفرعية للمالك
 */
export function getSubBotsReport() {
    const registry = loadSubBotsRegistry() || {};
    let registryModified = false;

    // 1. فحص البوتات النشطة في الذاكرة حالياً وإضافتها إذا لم تكن مسجلة بالسجل
    for (const [phone, activeObj] of activeSubBots.entries()) {
        const clean = cleanPhoneNumber(phone);
        if (clean && !registry[clean]) {
            registry[clean] = activeObj.cfg || {
                phone: clean,
                botName: activeObj.sock?.botName || 'بوت فرعي',
                callName: activeObj.sock?.callName || 'فرعي',
                gender: activeObj.sock?.gender || 'male',
                personality: activeObj.sock?.personality || 'respectful',
                status: 'active',
                installedAt: new Date().toISOString()
            };
            registryModified = true;
        }
    }

    // 2. فحص مجلدات الجلسات في sessions/sub_bots لضمان عدم ضياع أي بوت مسجل على السيرفر
    if (fs.existsSync(SUB_BOTS_DIR)) {
        try {
            const dirs = fs.readdirSync(SUB_BOTS_DIR);
            for (const d of dirs) {
                const clean = cleanPhoneNumber(d);
                if (clean && !registry[clean]) {
                    const cfgFile = path.join(SUB_BOTS_DIR, d, 'config.json');
                    if (fs.existsSync(cfgFile)) {
                        try {
                            const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
                            registry[clean] = cfg;
                            registryModified = true;
                        } catch (_) {}
                    }
                }
            }
        } catch (_) {}
    }

    if (registryModified) {
        saveSubBotsRegistry(registry);
    }

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

const UPDATES_TRACKER_FILE = path.join(process.cwd(), 'broadcasted_updates.json');

/**
 * تحميل سجل التحديثات المذاعة للبوتات الفرعية
 */
export function loadBroadcastedUpdates() {
    try {
        if (fs.existsSync(UPDATES_TRACKER_FILE)) {
            return JSON.parse(fs.readFileSync(UPDATES_TRACKER_FILE, 'utf8'));
        }
    } catch (_) {}
    return { broadcastedIds: [], history: [] };
}

/**
 * حفظ سجل التحديثات المذاعة
 */
export function saveBroadcastedUpdates(data) {
    try {
        fs.writeFileSync(UPDATES_TRACKER_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * قائمة التحديثات والميزات الجديدة المسجلة في النظام
 * أي ميزة جديدة تضاف هنا يتم بثها تلقائياً لجميع أصحاب البوتات الفرعية عند تشغيل البوت
 */
export const SYSTEM_FEATURE_UPDATES = [
    {
        id: 'feat_image_v1',
        title: 'أمر الصور الشامل والرسم بالذكاء الاصطناعي (صوره)',
        message:
            `📢 *تحديث جديد ومميز في شادو بوت!* 🚀✨\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `مرحباً يا حج! تم إضافة وتفعيل ميزة جديدة في البوت وبوتك الفرعي:\n\n` +
            `🖼️ *أمر الصور الشامل والذكاء الاصطناعي (صوره)*:\n` +
            `صار بإمكانك وبإمكان أي عضو في جروباتك طلب أي صورة في العالم أو رسم وتخيل أي فكرة بالذكاء الاصطناعي مع توقيع اسم البوت الرسمي في أسفل الصورة تلقائياً!\n\n` +
            `📌 *طريقة استخدام الميزة الجديدة:*\n` +
            `1️⃣ *البحث عن أي صورة في العالم:*\n` +
            `• اكتب: *صوره [اسم أي شخص أو شيء]*\n` +
            `• مثال: *صوره ميسي وهو رافع كاس العالم*\n` +
            `• مثال: *صوره خلفيات سيارات فخمة 4k*\n\n` +
            `2️⃣ *الرسم والتخيل بالذكاء الاصطناعي (AI):*\n` +
            `• اكتب: *صوره ai [الوصف اللي في خيالك]* أو *صوره تخيل [الوصف]*\n` +
            `• مثال: *صوره ai قطة بتشرب قهوة على القمر*\n` +
            `• مثال: *صوره تخيل قلعة فرعونية في المستقبل لسنة 3000*\n\n` +
            `⚡ *أبرز المميزات:*\n` +
            `✅ فهم اللهجة المصرية وترجمة فورية احترافية بدون أخطاء\n` +
            `✅ دقة فائقة HD مع تجنب أي صور تالفة نهائياً\n` +
            `✅ وضع علامة وتوقيع باسم البوت في الزاوية اليمنى بالأسفل تلقائياً\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `👑 *فريق تطوير شادو بوت يتمنى لكم تجربة ممتعة ومميزة!*`
    },
    {
        id: 'feat_accept_egyptian_requests_v1',
        title: 'أمر قبول طلبات الانضمام المصرية فقط (اقبل طلبات مصري)',
        message:
            `📢 *تحديث وتطوير جديد في شادو بوت!* 🇪🇬✨\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `مرحباً يا حج! تم إضافة وتفعيل أمر جديد في بوتك:\n\n` +
            `🇪🇬 *أمر قبول طلبات الانضمام المصرية فقط (اقبل طلبات مصري)*:\n` +
            `دلوقتي المشرفين يقدرو يقبلو طلبات الانضمام المعلقة في الجروب للأرقام المصرية فقط (+20) مع إمكانية تحديد العدد المطلوب!\n\n` +
            `📌 *طريقة استخدام الأمر في الجروب:*\n` +
            `1️⃣ *لقبول عدد معين من الطلبات المصرية:* \n` +
            `• اكتب: *اقبل طلبات مصري [العدد]*\n` +
            `• مثال: \`اقبل طلبات مصري 10\` أو \`اقبل طلبات مصري 25\`\n\n` +
            `2️⃣ *لقبول كل الطلبات المصرية المعلقة:* \n` +
            `• اكتب: *اقبل طلبات مصري*\n\n` +
            `🛑 *للإيقاف في أي وقت:* اكتب \`وقف طلبات\`\n\n` +
            `🧪 *تنبيه هـام:* \n` +
            `⚠️ *الأمر تم إضافته حديثاً وما زال تحت التجربة حالياً!* 🧪\n` +
            `يرجى تجربته في جروباتكم، وإذا واجهتكم أي ملاحظة بلغوا المطور فوراً لتطويره.\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `👑 *فريق تطوير شادو بوت يتمنى لكم تجربة ممتازة وممتعة!*`
    }
];

/**
 * إرسال إذاعة أو إشعار بميزة جديدة إلى أصحاب جميع البوتات الفرعية
 */
export async function broadcastUpdateToSubBots(mainConn, messageText, updateId = null) {
    if (!mainConn) return { success: false, message: 'اتصال البوت الرئيسي غير متوفر' };

    const registry = loadSubBotsRegistry() || {};
    const allBots = new Map();

    // 1. جمع البوتات من السجل
    for (const [phone, cfg] of Object.entries(registry)) {
        if (cfg) allBots.set(cleanPhoneNumber(phone), cfg);
    }

    // 2. جمع أي بوتات من مجلدات الجلسات غير المسجلة بالسجل
    if (fs.existsSync(SUB_BOTS_DIR)) {
        try {
            const dirs = fs.readdirSync(SUB_BOTS_DIR);
            for (const d of dirs) {
                const clean = cleanPhoneNumber(d);
                if (!allBots.has(clean)) {
                    const cfgFile = path.join(SUB_BOTS_DIR, d, 'config.json');
                    if (fs.existsSync(cfgFile)) {
                        try {
                            const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
                            allBots.set(clean, cfg);
                        } catch (_) {}
                    }
                }
            }
        } catch (_) {}
    }

    const botList = Array.from(allBots.values());
    if (botList.length === 0) {
        return { success: true, total: 0, sentCount: 0, failedCount: 0, message: 'لا توجد أي بوتات فرعية مسجلة حالياً.' };
    }

    console.log(`📢 [Broadcast] بدء إرسال التحديث لـ ${botList.length} بوت فرعي...`);

    let sentCount = 0;
    let failedCount = 0;
    const notifiedAdmins = new Set();

    for (const cfg of botList) {
        const adminPhone = cleanPhoneNumber(cfg.adminPhone || cfg.phone);
        if (!adminPhone) continue;

        const botTitle = cfg.botName || 'بوتك الفرعي';
        const customMessage = 
            `🤖 *إشعار موجه لبوتك: [ ${botTitle} ]* ✨\n` +
            `📱 رقم البوت: +${cfg.phone || adminPhone}\n\n` +
            messageText;

        const targetJid = `${adminPhone}@s.whatsapp.net`;

        try {
            await mainConn.sendMessage(targetJid, { text: customMessage });
            sentCount++;
            notifiedAdmins.add(adminPhone);
            console.log(`✅ [Broadcast] تم إرسال الإشعار لحج البوت (${botTitle}) على الرقم (+${adminPhone})`);
        } catch (e) {
            console.error(`❌ [Broadcast] فشل الإرسال لحج البوت (${botTitle}) على (+${adminPhone}):`, e?.message || e);
            failedCount++;
        }

        // إذا كان البوت الفرعي نفسه نشطاً، نرسل أيضاً تنبيهاً عبر سوكيت البوت الفرعي
        const activeSub = activeSubBots.get(cleanPhoneNumber(cfg.phone));
        if (activeSub && activeSub.sock) {
            try {
                await activeSub.sock.sendMessage(targetJid, { 
                    text: `📢 *تنبيه من بوتك (${botTitle}):*\nتم تفعيل أحدث التحديثات والميزات على بوتك بنجاح! 🚀` 
                });
            } catch (_) {}
        }

        // تأخير ثانية ونصف بين كل رسالة لحماية البوت من ليميت واتساب
        await new Promise(r => setTimeout(r, 1500));
    }

    // تسجيل التحديث في ملف السجل إذا كان له updateId
    if (updateId) {
        const tracker = loadBroadcastedUpdates();
        if (!tracker.broadcastedIds.includes(updateId)) {
            tracker.broadcastedIds.push(updateId);
            tracker.history.push({
                updateId,
                timestamp: Date.now(),
                sentCount,
                failedCount,
                total: botList.length
            });
            saveBroadcastedUpdates(tracker);
        }
    }

    return {
        success: true,
        total: botList.length,
        sentCount,
        failedCount,
        message: `تم الإرسال بنجاح إلى ${sentCount} من أصحاب البوتات الفرعية.`
    };
}

/**
 * فحص وإرسال أي تحديثات جديدة معلقة لم يتم إرسالها بعد للبوتات الفرعية
 * (تم تعطيل الإرسال التلقائي بناء على رغبة المطور، والاعتماد على أمر الإذاعة اليدوي)
 */
export async function checkAndBroadcastPendingUpdates(mainConn) {
    return;
}
