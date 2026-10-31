import fs from 'fs';
import path from 'path'; // 🛑 استيراد ملفات الألعاب والـ Plugins المساعدة
import gameTicTacToe from './plugins/game-ttt.js';
import gameGuess from './plugins/game-guess.js';
import gameSaraha from './plugins/game-saraha.js';
import gameFootball from './plugins/game-football.js';
import gameBakasa from './plugins/game-bakasa.js';
import gamePuzzle from './plugins/puzzle.js';
import menuHandler from './plugins/menu.js';
import datelsHandler, { extractMessageBody } from './plugins/datels.js';
import { 
    requestSubBotPairing, 
    stopSubBot, 
    startSubBotRemote, 
    deleteSubBotRemote, 
    clearAllSubBots,
    getSubBotsReport,
    cleanPhoneNumber,
    loadSubBotsRegistry,
    updateSubBotName,
    updateSubBotCallName,
    activeSubBots
} from './core/subbot.js';

// 💤 خريطة حفظ حالة وتوقيت النوم المعزولة لكل بوت (سواء الأساسي أو الفرعي)
const botSleepMap = new Map();
const botWakeTimeMap = new Map();
// 🤫 خريطة كتم الصوت المعزولة (اسكت / اتكلم) لكل بوت
const botMuteMap = new Map();

const botCounter = {};
const lastBotTime = {};
const wordSpamTracker = {};
const wordBannedUsers = {};
const dynamicState = {};
const installState = new Map();

// ⏱️ دالة التأخير المخصصة لمنع الحظر والسبام
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 📂 قاعدة بيانات التنبيهات والتحكم المحلية لشادو بوت
const dbPath = path.join(process.cwd(), 'scramble_db.json');

function loadLocalDB() {
    try {
        if (fs.existsSync(dbPath)) {
            let db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
            if (!db.warnAdmins) db.warnAdmins = {};
            if (!db.warns) db.warns = {};
            if (!db.bannedUsers) db.bannedUsers = [];
            if (!db.bannedGroups) db.bannedGroups = [];
            if (!db.hajjUsers) db.hajjUsers = [];
            if (!db.mainHajjUsers) db.mainHajjUsers = [];
            if (!db.users) db.users = {};
            if (!db.lidMap) db.lidMap = {};
            if (typeof db.isBotSleeping !== 'boolean') db.isBotSleeping = false;
            // تثبيت معرفات الحج شادو الأصلي
            db.lidMap['201129249396'] = '194961618301016';
            db.lidMap['194961618301016'] = '201129249396';
            return db;
        }
    } catch (e) {
        console.error("Error loading DB:", e);
    }
    return {
        users: {},
        bannedUsers: [],
        bannedGroups: [],
        hajjUsers: [],
        mainHajjUsers: [],
        warns: {},
        warnAdmins: {},
        lidMap: { '201129249396': '194961618301016', '194961618301016': '201129249396' },
        isBotSleeping: false
    };
}

function saveLocalDB(db) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
    } catch (e) {
        console.error("Error saving DB:", e);
    }
}

function normalizeArabic(text) {
    if (!text) return '';
    return text.trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}

// دالة متوافقة تماماً مع تيرمكس لجلب التاريخ والوقت الحالي
function getArabicDateTime() {
    const date = new Date();
    const options = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true, timeZone: 'Africa/Cairo'
    };
    return date.toLocaleString('ar-EG', options);
}

// دالة موحدة لتنظيف الـ JID الخاص بالمستخدمين
function cleanUserJid(jid) {
    if (!jid) return '';
    let clean = jid.split('@')[0].split(':')[0].trim();
    return clean + '@s.whatsapp.net';
}

function getCleanNumber(jid) {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

function isUserInList(jid, list = []) {
    if (!jid || !Array.isArray(list)) return false;
    const cleanNum = getCleanNumber(jid);
    if (!cleanNum) return false;
    const localDB = loadLocalDB();
    const mapped = localDB.lidMap?.[cleanNum];
    return list.includes(jid) || list.some(item => {
        let cleanItem = getCleanNumber(item);
        return cleanItem === cleanNum || (mapped && cleanItem === mapped);
    });
}

function isUserBanned(jid, localDB) {
    if (!jid || !localDB || !localDB.bannedUsers) return false;
    const cleanNum = getCleanNumber(jid);
    if (!cleanNum) return false;
    const mapped = localDB.lidMap?.[cleanNum];
    return isUserInList(jid, localDB.bannedUsers) || (mapped && isUserInList(mapped, localDB.bannedUsers));
}

function findUserData(jid, localDB) {
    if (!jid || !localDB || !localDB.users) return null;
    let clean = getCleanNumber(jid);
    if (!clean) return null;
    if (localDB.users[jid]) return localDB.users[jid];
    let standardJid = clean + '@s.whatsapp.net';
    if (localDB.users[standardJid]) return localDB.users[standardJid];
    let lidJid = clean + '@lid';
    if (localDB.users[lidJid]) return localDB.users[lidJid];

    let mapped = localDB.lidMap?.[clean];
    if (mapped) {
        if (localDB.users[`${mapped}@s.whatsapp.net`]) return localDB.users[`${mapped}@s.whatsapp.net`];
        if (localDB.users[`${mapped}@lid`]) return localDB.users[`${mapped}@lid`];
    }

    for (const key of Object.keys(localDB.users)) {
        let cleanKey = getCleanNumber(key);
        if (cleanKey === clean || (mapped && cleanKey === mapped)) {
            return localDB.users[key];
        }
    }
    return null;
}

export function getMsgTimestamp(m) {
    if (!m) return 0;
    let ts = m.messageTimestamp;
    if (ts === undefined || ts === null) {
        ts = m.key?.timestamp || m.message?.messageContextInfo?.deviceListMetadata?.senderTimestamp;
    }
    if (ts === undefined || ts === null) return 0;

    let num = 0;
    if (typeof ts === 'number') {
        num = ts;
    } else if (typeof ts === 'string') {
        num = parseInt(ts, 10) || 0;
    } else if (typeof ts === 'object') {
        if (typeof ts.toNumber === 'function') {
            num = ts.toNumber();
        } else if (typeof ts.low === 'number') {
            const high = typeof ts.high === 'number' ? ts.high : 0;
            num = (high * 4294967296) + (ts.low >>> 0);
        }
    }

    if (num > 1e11) {
        num = Math.floor(num / 1000);
    }
    return num;
}

export async function handleAllMessages(mek, currentConn) {
    try {
        // ⏰ تجاهل قاطع وفوري لأي رسالة قديمة أُرسلت قبل تشغيل البوت الحالي أو أثناء إغلاقه
        const nowSec = Math.floor(Date.now() / 1000);
        const currentStartTime = currentConn.subBotStartTime || global.botStartTime || nowSec;
        const msgTime = getMsgTimestamp(mek);
        if (msgTime > 0) {
            if (msgTime < (currentStartTime - 2) || msgTime < (nowSec - 30)) return;
        } else {
            if ((nowSec - currentStartTime) < 45) return;
        }

        let from = mek.key.remoteJid;
        if (!from) return;
        // تحديد هل الشات جروب حقيقي أم خاص
        const isRealGroup = from.endsWith('@g.us');
        
        // 🛠️ تحويل معرّفات الخاص والـ LID العالقة لتبدو كأنها جروب للسستم داخلياً عند الحاجة
        let isGroup = false;
        if (from.endsWith('@s.whatsapp.net') || from.endsWith('@lid') || isRealGroup) {
            isGroup = true;
        }

        let sender = isRealGroup ? (mek.key.participant || '') : from;
        if (!sender && mek.key?.fromMe) sender = currentConn.user?.id || '';
        if (!sender) return;

        let cleanSender = getCleanNumber(sender);
        let standardSenderJid = cleanUserJid(sender);
        
        // 🔓 جلب النص بأعلى مرونة لفك تشفير كافة أنواع الرسائل
        const body = extractMessageBody(mek);
        const textLower = body.toLowerCase().trim();
        if (!textLower) return;

        const normalizedBody = normalizeArabic(textLower);
        mek.text = textLower;
        
        // 👑 المالك المطلق (الحج شادو الحقيقي الأصلي)
        const ownerPhone = '201129249396';
        const ownerLid = '194961618301016';
        const ownerAltPhone = '201229409956';
        let localDB = loadLocalDB();

        // 🏷️ استخراج اسم البوت والتحقق من كونه بوتاً فرعياً (Sub-Bot)
        let myNumber = currentConn.user?.id?.split(':')[0]?.replace(/[^0-9]/g, '') || '';
        let botName = 'شادو';
        let subBotConfig = null;
        if (myNumber) {
            const subConfigPath = path.join(process.cwd(), 'sessions', 'sub_bots', myNumber, 'config.json');
            if (fs.existsSync(subConfigPath)) {
                try {
                    subBotConfig = JSON.parse(fs.readFileSync(subConfigPath, 'utf8'));
                    if (subBotConfig.botName) botName = subBotConfig.botName;
                } catch (e) {}
            } else {
                const configPath = path.join(process.cwd(), 'sessions', `session_${myNumber}`, 'bot_config.json');
                if (fs.existsSync(configPath)) {
                    try {
                        let cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                        if (cfg.botName) botName = cfg.botName;
                    } catch (e) {}
                }
            }
        }

        // الحج الأصلي شادو (متحكم مطلق في البوت الرئيسي وجميع البوتات الفرعية)
        const isAbsoluteOwner = (
            cleanSender === ownerPhone ||
            cleanSender === ownerLid ||
            cleanSender === ownerAltPhone ||
            localDB.lidMap?.[cleanSender] === ownerPhone ||
            localDB.lidMap?.[cleanSender] === ownerLid ||
            mek.key.fromMe
        );

        // صاحب البوت الفرعي هو الحج الأساسي على بوته فقط (فحص شامل بالرقم وLID ومعرف JID وسجل المشرفين)
        const isSubBotAdmin = Boolean(
            subBotConfig &&
            (
                (subBotConfig.adminPhone && (cleanSender === subBotConfig.adminPhone || localDB.lidMap?.[cleanSender] === subBotConfig.adminPhone)) ||
                (subBotConfig.adminLid && (cleanSender === subBotConfig.adminLid || localDB.lidMap?.[cleanSender] === subBotConfig.adminLid)) ||
                (subBotConfig.adminJid && sender === subBotConfig.adminJid) ||
                (subBotConfig.adminNumbers && subBotConfig.adminNumbers.includes(cleanSender))
            )
        );

        // الحج الرئيسي لهذا البوت بالتحديد
        const isBotOwner = isAbsoluteOwner || isSubBotAdmin;
        const isMainHajj = isBotOwner || isUserInList(sender, localDB.mainHajjUsers);
        const isAssistantHajj = !isMainHajj && isUserInList(sender, localDB.hajjUsers);
        const isHajj = isMainHajj || isAssistantHajj;
        
        const botCallName = subBotConfig?.callName || currentConn.callName || '';
        const normalizedCallName = normalizeArabic((botCallName || '').toLowerCase().trim());
        const currentLowerName = (botName || 'شادو').toLowerCase().trim();
        const normalizedBotName = normalizeArabic(currentLowerName);

        mek.isSuperAdmin = isBotOwner;
        mek.botName = botName;
        mek.callName = botCallName;
        mek.isSubBotAdmin = isSubBotAdmin;
        mek.isBotOwner = isBotOwner;
        currentConn.botName = botName;
        currentConn.callName = botCallName;
        currentConn.isSubBot = Boolean(subBotConfig);
        currentConn.subBotConfig = subBotConfig;

        // 🤫 1. فحص وضع كتم الصوت التام للبوت (اسكت / اتكلم) المطبق من الحج شادو
        const currentBotMuted = botMuteMap.get(myNumber) || false;
        if (currentBotMuted) {
            // البوت صامت 100% ولا يرد على أي شخص ولا ينفذ أي أمر نهائياً
            // الاستثناء الحصري: الحج شادو فقط يرسل أمر فك الكتم (اتكلم [اسم البوت] أو اتكلم [اسم النداء] أو اتكلم الكل)
            const isUnmute = isAbsoluteOwner && (
                normalizedBody === `اتكلم ${normalizedBotName}` ||
                normalizedBody === `اتكلم يا ${normalizedBotName}` ||
                (normalizedCallName && (normalizedBody === `اتكلم ${normalizedCallName}` || normalizedBody === `اتكلم يا ${normalizedCallName}`)) ||
                normalizedBody === 'اتكلم الكل' ||
                normalizedBody === 'اتكلمو'
            );

            if (isUnmute) {
                botMuteMap.set(myNumber, false);
                await delay(1500);
                await currentConn.sendMessage(from, { react: { text: '🗣️', key: mek.key } }).catch(() => {});
                await delay(1500);
                await currentConn.sendMessage(from, { text: `🗣️ *أمرك يا حج شادو! تم فك كتم الصوت عن (${botName}). رجعت أرد وأشتغل بكامل طاقتي!* ⚡` }, { quoted: mek });
                return;
            }

            // صمت تام ولا يرد نهائياً!
            return;
        }

        // 🤫 2. أمر كتم الصوت للحج شادو حصرياً (اسكت [اسم البوت] / اسكت [اسم النداء] / اسكت الكل)
        if (isAbsoluteOwner && (normalizedBody.startsWith('اسكت') || normalizedBody.startsWith('اخرس'))) {
            const isMuteAll = normalizedBody === 'اسكت الكل' || normalizedBody === 'اسكتو' || normalizedBody === 'اخرسو';
            const isNamedMute = normalizedBody === `اسكت ${normalizedBotName}` || 
                                normalizedBody === `اسكت يا ${normalizedBotName}` ||
                                (normalizedCallName && (normalizedBody === `اسكت ${normalizedCallName}` || normalizedBody === `اسكت يا ${normalizedCallName}`));

            if (isMuteAll || isNamedMute) {
                botMuteMap.set(myNumber, true);
                await delay(1500);
                await currentConn.sendMessage(from, { react: { text: '🤫', key: mek.key } }).catch(() => {});
                await delay(1500);
                await currentConn.sendMessage(from, { text: `🤫 *أمرك يا حج شادو! تم كتم صوت بوت (${botName}) بالكامل.*\nلن يستجيب لأي شخص أو أي رسالة نهائياً (حتى لك شخصياً) حتى ترسل: (اتكلم ${normalizedCallName || normalizedBotName}) أو (اتكلم الكل).` }, { quoted: mek });
                return;
            }
        }

        // 💤 فحص وضع الخمول المعزول (Sleep Mode) الخاص بهذا البوت فقط
        const currentBotSleep = botSleepMap.get(myNumber) || false;
        if (currentBotSleep && !isBotOwner) {
            return;
        }

        // ⏰ فحص توقيت الاستيقاظ: تجاهل أي رسائل أُرسلت أثناء فترة نوم البوت بعد استيقاظه
        const lastWakeTime = botWakeTimeMap.get(myNumber);
        if (lastWakeTime && !isBotOwner) {
            const mTime = getMsgTimestamp(mek);
            if (mTime > 0 && mTime < lastWakeTime) {
                return;
            }
        }

        // 🚫 فحص حظر المستخدم
        if (isUserBanned(sender, localDB) && !isAbsoluteOwner) return;

        // 🛡️ تشغيل ملف الإدارة للخاص والجروبات (ادخل، نام، اصحي، الإدارة)
        let handledByAdmin = false;
        if (datelsHandler && typeof datelsHandler.before === 'function') {
            handledByAdmin = await datelsHandler.before(mek, currentConn);
        } else if (datelsHandler?.default && typeof datelsHandler.default.before === 'function') {
            handledByAdmin = await datelsHandler.default.before(mek, currentConn);
        }
        if (handledByAdmin) return;
        
        const now = Date.now();

        // ⏱️ دالة التوقيت الصارمة للحماية من حظر واتساب (محاكاة حركة بشرية)
        const respondWithStrictTiming = async (reactChar, actionFunction) => {
            await delay(2500);
            try {
                if (reactChar) await currentConn.sendMessage(from, { react: { text: reactChar, key: mek.key } });
            } catch (e) {}
            await delay(3000);
            await actionFunction();
        };

        // =========================================================================
        // 💤 [أوامر النوم والاستيقاظ المعزولة لكل بوت وباسمه واسم ندائه]
        // =========================================================================
        const isGeneralSleep = ['نام', 'وضع الخمول', 'ايقاف مؤقت', 'خمول'].includes(normalizedBody);
        const isNamedSleep = normalizedBody === `نام ${normalizedBotName}` || 
                             normalizedBody === `نام يا ${normalizedBotName}` ||
                             normalizedBody === `خمول ${normalizedBotName}` ||
                             (normalizedCallName && (
                                 normalizedBody === `نام ${normalizedCallName}` ||
                                 normalizedBody === `نام يا ${normalizedCallName}` ||
                                 normalizedBody === `خمول ${normalizedCallName}`
                             )) ||
                             (isAbsoluteOwner && (normalizedBody === 'نام الكل' || normalizedBody === 'نامو'));

        const isGeneralWake = ['اصحي', 'استيقظ', 'تشغيل', 'الغاء الخمول', 'قوم'].includes(normalizedBody);
        const isNamedWake = normalizedBody === `اصحي ${normalizedBotName}` || 
                            normalizedBody === `اصحي يا ${normalizedBotName}` ||
                            normalizedBody === `تشغيل ${normalizedBotName}` ||
                            normalizedBody === `قوم ${normalizedBotName}` ||
                            (normalizedCallName && (
                                normalizedBody === `اصحي ${normalizedCallName}` ||
                                normalizedBody === `اصحي يا ${normalizedCallName}` ||
                                normalizedBody === `تشغيل ${normalizedCallName}` ||
                                normalizedBody === `قوم ${normalizedCallName}`
                            )) ||
                            (isAbsoluteOwner && (normalizedBody === 'اصحي الكل' || normalizedBody === 'اصحو'));

        if (isGeneralSleep || isNamedSleep) {
            // لو الأمر محدد بالاسم لبوت تاني في نفس الجروب، هذا البوت يتجاهل بصمت
            if (!isNamedSleep && normalizedBody.startsWith('نام ') && !normalizedBody.includes(normalizedBotName) && (!normalizedCallName || !normalizedBody.includes(normalizedCallName))) {
                return;
            }

            if (!isBotOwner) {
                return;
            }

            const isAlreadySleeping = botSleepMap.get(myNumber) || false;
            if (isAlreadySleeping) {
                if (isNamedSleep) {
                    await respondWithStrictTiming('💤', async () => {
                        await currentConn.sendMessage(from, { text: `⚠️ وضع الخمول مفعل بالفعل يا حج وبوتك (${botName}) نائم حالياً! 💤` }, { quoted: mek });
                    });
                }
                return;
            }

            botSleepMap.set(myNumber, true);
            await respondWithStrictTiming('💤', async () => {
                await currentConn.sendMessage(from, { text: `💤 *تم تفعيل وضع الخمول لبوت (${botName}) بنجاح!* \nالبوت الآن صامت تماماً ولن يستجيب لأي شخص نهائياً غيرك حتى ترسل له أمر (اصحي) أو (اصحي ${normalizedCallName || normalizedBotName}). 🌙` }, { quoted: mek });
            });
            return;
        }

        if (isGeneralWake || isNamedWake) {
            if (!isNamedWake && normalizedBody.startsWith('اصحي ') && !normalizedBody.includes(normalizedBotName) && (!normalizedCallName || !normalizedBody.includes(normalizedCallName))) {
                return;
            }

            if (!isBotOwner) {
                return;
            }

            const isAlreadySleeping = botSleepMap.get(myNumber) || false;
            if (!isAlreadySleeping) {
                if (isNamedWake) {
                    await respondWithStrictTiming('⚡', async () => {
                        await currentConn.sendMessage(from, { text: `⚠️ بوتك (${botName}) شغال ومستيقظ بالفعل يا حج وجاهز لأي أوامر! ⚡` }, { quoted: mek });
                    });
                }
                return;
            }

            botSleepMap.set(myNumber, false);
            botWakeTimeMap.set(myNumber, Math.floor(Date.now() / 1000));
            await respondWithStrictTiming('⚡', async () => {
                await currentConn.sendMessage(from, { text: `⚡ *صباح الفل يا حج! تم استيقاظ (${botName}) وعاد للعمل بكامل طاقته للجميع!* 🚀🔥` }, { quoted: mek });
            });
            return;
        }

        // =========================================================================
        // 🤖 [نظام التنصيب التفاعلي للبوتات الفرعية (Sub-Bots / JadiBot)]
        // =========================================================================

        // 1. فحص وجود عملية تنصيب جارية لهذا المستخدم (تتم حصرياً في الخاص)
        if (installState.has(cleanSender)) {
            const currentInstall = installState.get(cleanSender);

            // التحقق من انتهاء مهلة الجلسة (10 دقائق)
            if (Date.now() - (currentInstall.createdAt || 0) > 10 * 60 * 1000) {
                installState.delete(cleanSender);
            } else if (!isRealGroup) {
                // معالجة خطوات التنصيب في الخاص فقط

                // إمكانية الإلغاء
                if (['الغاء', 'إلغاء', 'خروج', 'stop', 'cancel'].includes(normalizedBody)) {
                    installState.delete(cleanSender);
                    await respondWithStrictTiming('❌', async () => {
                        await currentConn.sendMessage(from, { text: '❌ تم إلغاء عملية تنصيب البوت الفرعي بنجاح.' }, { quoted: mek });
                    });
                    return;
                }

                // الخطوة 1: اختيار اسم البوت الرسمي
                if (currentInstall.step === 1) {
                    const chosenName = body.trim().replace(/[*_~`]/g, '').slice(0, 30);
                    if (!chosenName || chosenName.length < 2) {
                        await respondWithStrictTiming('⚠️', async () => {
                            await currentConn.sendMessage(from, { text: '⚠️ برجاء كتابة اسم رسمي واضح لبوتك (مثال: إمبراطور الظلام / شادو 2 / الصقر الملكي):' }, { quoted: mek });
                        });
                        return;
                    }

                    currentInstall.step = 2;
                    currentInstall.botName = chosenName;
                    installState.set(cleanSender, currentInstall);

                    const step2Text = 
                        `✅ *الاسم الرسمي للبوت:* « ${chosenName} » 🏷️\n\n` +
                        `2️⃣ *ما هو اسم النداء السهل الذي ستنادي به البوت للتحكم به وتوجيه الأوامر له؟*\n` +
                        `• اكتب اسماً سهلاً بدون ألقاب أو زخرفة (مثال: إمبراطور / سوسو / فهد / الصقر)\n` +
                        `• هذا الاسم هو الذي ستتحكم من خلاله في البوت وتوجه له الأوامر وتنده عليه به!\n\n` +
                        `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

                    await respondWithStrictTiming('🗣️', async () => {
                        await currentConn.sendMessage(from, { text: step2Text }, { quoted: mek });
                    });
                    return;
                }

                // الخطوة 2: اختيار اسم النداء السهل
                if (currentInstall.step === 2) {
                    const chosenCall = body.trim().replace(/[*_~`]/g, '').slice(0, 20);
                    if (!chosenCall || chosenCall.length < 2) {
                        await respondWithStrictTiming('⚠️', async () => {
                            await currentConn.sendMessage(from, { text: '⚠️ برجاء كتابة اسم نداء سهل ومختصر (مثال: إمبراطور / سوسو / فهد):' }, { quoted: mek });
                        });
                        return;
                    }

                    currentInstall.step = 3;
                    currentInstall.callName = chosenCall;
                    installState.set(cleanSender, currentInstall);

                    const step3Text = 
                        `✅ *تم اعتماد اسم النداء:* « ${chosenCall} » 🗣️\n\n` +
                        `3️⃣ *ما هو رقم الهاتف الذي تريد تشغيله كـ (بوت) وربطه بالكود؟*\n` +
                        `• اكتب رقم الهاتف الذي سيصبح بوتاً (مثال: 01012345678 أو 201012345678)\n` +
                        `• أو اكتب *(رقمي)* إذا كان هذا الرقم الذي تراسلني منه هو نفسه الذي تريد تحويله لبوت.\n\n` +
                        `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

                    await respondWithStrictTiming('📱', async () => {
                        await currentConn.sendMessage(from, { text: step3Text }, { quoted: mek });
                    });
                    return;
                }

                // الخطوة 3: رقم هاتف البوت
                if (currentInstall.step === 3) {
                    let targetBotPhone = '';
                    if (['رقمي', 'نفسه', 'نفس الرقم', 'نفس رقمي'].includes(normalizedBody)) {
                        let resolved = cleanSender;
                        if (sender.endsWith('@lid') || cleanSender.length > 13) {
                            resolved = localDB.lidMap?.[cleanSender] || '';
                        }
                        if (!resolved || resolved.length > 13) {
                            await respondWithStrictTiming('⚠️', async () => {
                                await currentConn.sendMessage(from, { 
                                    text: '⚠️ حسابك يظهر برمز مشفر داخل واتساب (LID)!\nبرجاء كتابة رقم الهاتف بالأرقام (مثال: 01012345678 أو 201012345678):' 
                                }, { quoted: mek });
                            });
                            return;
                        }
                        targetBotPhone = cleanPhoneNumber(resolved);
                    } else {
                        targetBotPhone = cleanPhoneNumber(body);
                    }

                    if (!targetBotPhone || targetBotPhone.length < 10) {
                        await respondWithStrictTiming('⚠️', async () => {
                            await currentConn.sendMessage(from, { text: '❌ هذا الرقم غير صالح!\nبرجاء كتابة رقم هاتف البوت بشكل صحيح (مثال: 01012345678 أو 201012345678)\nأو اكتب (رقمي) لاستخدام رقمك الحالي:' }, { quoted: mek });
                        });
                        return;
                    }

                    currentInstall.step = 4;
                    currentInstall.targetPhone = targetBotPhone;
                    installState.set(cleanSender, currentInstall);

                    const step4Text = 
                        `✅ *تم تحديد رقم البوت:* « +${targetBotPhone} » 📱\n\n` +
                        `4️⃣ *من هو الحج الأساسي (المالك والمتحكم الكامل بالبوت)؟*\n` +
                        `• اكتب رقم الحج الأساسي مع كود الدولة (مثال: 01012345678 أو 201012345678)\n` +
                        `• أو اكتب كلمة *(رقمي)* أو *(نفسي)* لتعيين نفسك أنت الحج الأساسي لهذا البوت!\n\n` +
                        `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { text: step4Text }, { quoted: mek });
                    });
                    return;
                }

                // الخطوة 4: رقم الحج الأساسي والتعرف على LID وإطلاق كود الربط
                if (currentInstall.step === 4) {
                    let adminPhone = '';
                    let adminLid = '';

                    if (['رقمي', 'نفسي', 'نفسه', 'انا', 'أنا', 'نفس الرقم'].includes(normalizedBody)) {
                        if (sender.endsWith('@lid') || cleanSender.length > 13) {
                            adminLid = cleanSender;
                            adminPhone = localDB.lidMap?.[cleanSender] || '';
                        } else {
                            adminPhone = cleanSender;
                            adminLid = localDB.lidMap?.[cleanSender] || '';
                        }
                    } else {
                        adminPhone = cleanPhoneNumber(body);
                        adminLid = localDB.lidMap?.[adminPhone] || '';
                    }

                    if (!adminPhone || adminPhone.length < 10) {
                        await respondWithStrictTiming('⚠️', async () => {
                            await currentConn.sendMessage(from, { 
                                text: '❌ رقم الحج الأساسي غير صالح أو غير مكتمل!\nبرجاء كتابة الرقم بشكل صحيح بالأرقام (مثال: 01012345678 أو 201012345678)\nأو اكتب (رقمي) لتعيين رقمك الحالي:' 
                            }, { quoted: mek });
                        });
                        return;
                    }

                    // استخراج الـ LID من واتساب تلقائياً للتحقق من هوية الحج بأي وضع اتصال
                    try {
                        const waCheck = await currentConn.onWhatsApp(`${adminPhone}@s.whatsapp.net`);
                        if (waCheck && waCheck[0]?.lid) {
                            adminLid = waCheck[0].lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                        }
                    } catch (_) {}

                    if (!adminLid && (sender.endsWith('@lid') || cleanSender.length > 13)) {
                        adminLid = cleanSender;
                    }

                    if (adminPhone && adminLid) {
                        localDB.lidMap[adminPhone] = adminLid;
                        localDB.lidMap[adminLid] = adminPhone;
                        saveLocalDB(localDB);
                    }

                    const finalBotName = currentInstall.botName || 'بوت فرعي';
                    const finalCallName = currentInstall.callName || finalBotName;
                    const finalBotPhone = currentInstall.targetPhone;
                    installState.delete(cleanSender);

                    await respondWithStrictTiming('⏳', async () => {
                        await currentConn.sendMessage(from, { 
                            text: `⏳ *جاري تجهيز الخادم وإنشاء كود الربط لبوتك (${finalBotName} - نداء: ${finalCallName})...*\n📱 رقم البوت: +${finalBotPhone}\n👑 الحج الأساسي: +${adminPhone}${adminLid ? ` (ID: ${adminLid})` : ''}\nبرجاء الانتظار بضع ثوانٍ ⚡` 
                        }, { quoted: mek });
                    });

                    await requestSubBotPairing(finalBotPhone, finalBotName, finalCallName, adminPhone, adminLid, currentConn, from, mek);
                    return;
                }
            }
        }

        // 2. أمر بدء التنصيب
        if (['تنصيب', '.تنصيب', 'تنصيب بوت', 'بوت فرعي', 'جديد بوت', 'jadibot'].includes(normalizedBody)) {
            // إذا كُتب الأمر داخل جروب، نحوله فوراً إلى الخاص للأمان والسرية
            if (isRealGroup) {
                await respondWithStrictTiming('🔒', async () => {
                    await currentConn.sendMessage(from, { 
                        text: `⚠️ *عفواً يا فنان! عملية تنصيب البوت تتم حصرياً في الخاص لسرية كود الربط وأمان حسابك.*\n💬 تم إرسال رسالة البدء لك في الخاص.. افتح الشات الخاص مع البوت وابدأ فوراً! 🚀` 
                    }, { quoted: mek });
                });

                const privateJid = `${cleanSender}@s.whatsapp.net`;
                const startInstallText = 
                    `✨ *مرحباً بك في نظام تنصيب البوتات الفرعية (Sub-Bot)!* 🤖\n\n` +
                    `يمكنك ربط وتشغيل نسخة كاملة من البوت برقم هاتف خاص بك مجاناً!\n` +
                    `👑 ستكون أنت *الحج الأساسي* على بوتك وتتحكم فيه بالكامل.\n\n` +
                    `1️⃣ *ما هو الاسم الرسمي الذي تريده لبوتك؟*\n` +
                    `(اكتب الاسم فقط في رسالة، مثال: إمبراطور الظلام / شادو 2 / الصقر الملكي)\n\n` +
                    `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

                installState.set(cleanSender, { step: 1, createdAt: Date.now() });
                try {
                    await currentConn.sendMessage(privateJid, { text: startInstallText });
                } catch (_) {}
                return;
            }

            // إذا كُتب في الخاص مباشرة
            installState.set(cleanSender, { step: 1, createdAt: Date.now() });

            const startInstallText = 
                `✨ *مرحباً بك في نظام تنصيب البوتات الفرعية (Sub-Bot)!* 🤖\n\n` +
                `يمكنك ربط وتشغيل نسخة كاملة من البوت برقم هاتف خاص بك مجاناً!\n` +
                `👑 ستكون أنت *الحج الأساسي* على بوتك وتتحكم فيه بالكامل، مع احتفاظ الحج شادو بالإشراف العام.\n\n` +
                `1️⃣ *ما هو الاسم الرسمي الذي تريده لبوتك؟*\n` +
                `(اكتب الاسم فقط في رسالة، مثال: إمبراطور الظلام / شادو 2 / الصقر الملكي)\n\n` +
                `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

            await respondWithStrictTiming('🤖', async () => {
                await currentConn.sendMessage(from, { text: startInstallText }, { quoted: mek });
            });
            return;
        }

        // =========================================================================
        // 👑 [أوامر إدارة البوتات الفرعية - للحج شادو الأصلي حصرياً]
        // =========================================================================
        if (['كام تنصيب', 'كم تنصيب', 'البوتات الفرعية', 'البوتات الفرعيه', 'قائمة التنصيب', 'قائمه التنصيب', 'لوحة التنصيب'].includes(normalizedBody)) {
            if (!isAbsoluteOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (صاحب البوت)! 👑' }, { quoted: mek });
                });
                return;
            }

            const rep = getSubBotsReport();
            const dashText = 
                `╭━━━〔 👑 *لوحة تحكم البوتات الفرعية* 〕━━━╮\n` +
                `┃ 🤖 *إجمالي البوتات المنصبة:* ${rep.total}\n` +
                `┃ 🟢 *البوتات النشطة الآن:* ${rep.activeCount}\n` +
                `┃ 🛑 *البوتات المتوقفة:* ${rep.stoppedCount}\n` +
                `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
                `${rep.listText}\n\n` +
                `⚙️ *أوامر التحكم عن بُعد:* \n` +
                `• لإيقاف بوت: *(ايقاف تنصيب <رقم_البوت>)*\n` +
                `• لتشغيل بوت: *(تشغيل تنصيب <رقم_البوت>)*\n` +
                `• لحذف بوت نهائياً: *(حذف تنصيب <رقم_البوت>)*`;

            await respondWithStrictTiming('📊', async () => {
                await currentConn.sendMessage(from, { text: dashText }, { quoted: mek });
            });
            return;
        }

        if (normalizedBody.startsWith('ايقاف تنصيب ') || normalizedBody.startsWith('إيقاف تنصيب ')) {
            if (!isAbsoluteOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي! 👑' }, { quoted: mek });
                });
                return;
            }
            const targetPhone = body.replace(/^(ايقاف تنصيب|إيقاف تنصيب)\s*/i, '').replace(/[^0-9]/g, '');
            if (!targetPhone) {
                await currentConn.sendMessage(from, { text: '⚠️ اكتب الرقم الذي تريد إيقافه، مثال:\n(ايقاف تنصيب 201012345678)' }, { quoted: mek });
                return;
            }
            const res = await stopSubBot(targetPhone);
            await respondWithStrictTiming('🛑', async () => {
                await currentConn.sendMessage(from, { text: res.message }, { quoted: mek });
            });
            return;
        }

        if (normalizedBody.startsWith('تشغيل تنصيب ')) {
            if (!isAbsoluteOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي! 👑' }, { quoted: mek });
                });
                return;
            }
            const targetPhone = body.replace(/^تشغيل تنصيب\s*/i, '').replace(/[^0-9]/g, '');
            if (!targetPhone) {
                await currentConn.sendMessage(from, { text: '⚠️ اكتب الرقم الذي تريد تشغيله، مثال:\n(تشغيل تنصيب 201012345678)' }, { quoted: mek });
                return;
            }
            const res = await startSubBotRemote(targetPhone, currentConn);
            await respondWithStrictTiming('⚡', async () => {
                await currentConn.sendMessage(from, { text: res.message }, { quoted: mek });
            });
            return;
        }

        // 🗑️ أمر تصفير وحذف جميع البوتات الفرعية وملفاتها نهائياً (للحج شادو الأصلي حصرياً)
        if (['مسح كل البوتات الفرعية', 'مسح كل البوتات الفرعيه', 'تصفير البوتات الفرعية', 'تصفير البوتات الفرعيه', 'حذف كل البوتات', 'تصفير التنصيب', 'مسح البوتات'].includes(normalizedBody)) {
            if (!isAbsoluteOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي! 👑' }, { quoted: mek });
                });
                return;
            }

            const res = await clearAllSubBots();
            await respondWithStrictTiming('🗑️', async () => {
                await currentConn.sendMessage(from, { text: res.message }, { quoted: mek });
            });
            return;
        }

        // =========================================================================
        // ✏️ [أمر تعديل وتغيير اسم البوت الفرعي بعد التنصيب]
        // =========================================================================
        const isRenameSubBot = (
            normalizedBody.startsWith('تعديل اسم البوت ') ||
            normalizedBody.startsWith('تغيير اسم البوت ') ||
            normalizedBody.startsWith('تعديل الاسم ') ||
            normalizedBody.startsWith('غير اسم البوت ') ||
            normalizedBody.startsWith('غير اسمك ')
        );

        if (isRenameSubBot) {
            if (!isBotOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً لمالك البوت (الحج الأساسي)! 👑' }, { quoted: mek });
                });
                return;
            }

            const newChosenName = body.replace(/^(تعديل اسم البوت|تغيير اسم البوت|تعديل الاسم|غير اسم البوت|غير اسمك)\s*/i, '').trim().replace(/[*_~`]/g, '').slice(0, 30);
            if (!newChosenName || newChosenName.length < 2) {
                await respondWithStrictTiming('⚠️', async () => {
                    await currentConn.sendMessage(from, { text: '⚠️ اكتب الاسم الجديد بعد الأمر، مثال:\n(تعديل اسم البوت الصقر)' }, { quoted: mek });
                });
                return;
            }

            // تحديث اسم البوت الفرعي
            updateSubBotName(myNumber, newChosenName);
            botName = newChosenName;
            mek.botName = newChosenName;
            currentConn.botName = newChosenName;

            await respondWithStrictTiming('✨', async () => {
                await currentConn.sendMessage(from, { 
                    text: `✅ *تم تغيير اسم البوت بنجاح إلى:* « ${newChosenName} » 🏷️\nسيظهر هذا الاسم في القوائم والردود والألعاب من الآن! 🎉` 
                }, { quoted: mek });
            });
            return;
        }

        // =========================================================================
        // 🗑️ [أمر إلغاء وحذف التنصيب - لحج البوت الفرعي أو الحج شادو الأصلي فقط]
        // =========================================================================
        const isCancelInstallDirect = (
            normalizedBody === 'الغاء تنصيب' || 
            normalizedBody === 'إلغاء تنصيب' || 
            normalizedBody === '.الغاء تنصيب' || 
            normalizedBody === '.إلغاء تنصيب' ||
            normalizedBody === 'حذف البوت' ||
            normalizedBody === 'الغاء البوت' ||
            normalizedBody === 'إلغاء البوت' ||
            normalizedBody === 'حذف تنصيب'
        );

        if (isCancelInstallDirect) {
            // الحالة 1: الأمر أُرسل على البوت الفرعي نفسه
            if (subBotConfig) {
                if (!isSubBotAdmin && !isAbsoluteOwner) {
                    await respondWithStrictTiming('❌', async () => {
                        await currentConn.sendMessage(from, { text: '❌ عذراً! أمر إلغاء التنصيب مخصص حصرياً لصاحب هذا البوت (الحج الأساسي) أو المطور الأصلي فقط! 👑🚫' }, { quoted: mek });
                    });
                    return;
                }

                await respondWithStrictTiming('⚠️', async () => {
                    await currentConn.sendMessage(from, { 
                        text: `⚠️ *تم تأكيد طلب إلغاء تنصيب البوت (${botName})!*\nسيتم تسجيل الخروج وإيقاف البوت وحذف جلسته نهائياً الآن.. في رعاية الله! 👋` 
                    }, { quoted: mek });
                });

                // تأخير ثانيتين لضمان وصول الرسالة قبل إغلاق السوكيت
                setTimeout(async () => {
                    await deleteSubBotRemote(myNumber);

                    // إشعار الحج الأصلي إذا كان الحاذف هو صاحب البوت الفرعي
                    if (!isAbsoluteOwner) {
                        try {
                            const masterPhone = '201129249396@s.whatsapp.net';
                            await currentConn.sendMessage(masterPhone, { 
                                text: `📢 *إشعار إلغاء تنصيب:*\nقام صاحب البوت (+${cleanSender}) بإلغاء تنصيب بوته الفرعي (${botName} / +${myNumber}) وحذف جلسته بالكامل.` 
                            }).catch(() => {});
                        } catch (_) {}
                    }
                }, 2000);
                return;
            }

            // الحالة 2: الأمر أُرسل على البوت الأساسي
            const registry = loadSubBotsRegistry();
            let userBotPhone = null;
            for (const p of Object.keys(registry)) {
                if (registry[p]?.adminPhone === cleanSender || localDB.lidMap?.[cleanSender] === registry[p]?.adminPhone) {
                    userBotPhone = p;
                    break;
                }
            }

            if (userBotPhone) {
                const targetBotName = registry[userBotPhone]?.botName || userBotPhone;
                await deleteSubBotRemote(userBotPhone);
                await respondWithStrictTiming('🗑️', async () => {
                    await currentConn.sendMessage(from, { 
                        text: `🛑 *تم إلغاء تنصيب بوتك الفرعي (${targetBotName}) وحذف ملفاته بالكامل بنجاح!* ✅` 
                    }, { quoted: mek });
                });
                return;
            } else if (isAbsoluteOwner) {
                await respondWithStrictTiming('ℹ️', async () => {
                    await currentConn.sendMessage(from, { 
                        text: '⚠️ يا حج شادو، لإلغاء أو حذف أي بوت فرعي من هنا اكتب الرقم مع الأمر، مثال:\n(الغاء تنصيب 201012345678) أو (حذف تنصيب 201012345678)' 
                    }, { quoted: mek });
                });
                return;
            } else {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { 
                        text: '❌ ليس لديك أي بوت فرعي مسجل لإلغائه!\nيمكنك إنشاء بوت جديد بكتابة: (تنصيب).' 
                    }, { quoted: mek });
                });
                return;
            }
        }

        if (normalizedBody.startsWith('حذف تنصيب ') || normalizedBody.startsWith('الغاء تنصيب ') || normalizedBody.startsWith('إلغاء تنصيب ')) {
            if (!isAbsoluteOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي! 👑' }, { quoted: mek });
                });
                return;
            }
            const targetPhone = body.replace(/^(حذف تنصيب|الغاء تنصيب|إلغاء تنصيب)\s*/i, '').replace(/[^0-9]/g, '');
            if (!targetPhone) {
                await currentConn.sendMessage(from, { text: '⚠️ اكتب الرقم الذي تريد حذفه، مثال:\n(حذف تنصيب 201012345678)' }, { quoted: mek });
                return;
            }
            const res = await deleteSubBotRemote(targetPhone);
            await respondWithStrictTiming('🗑️', async () => {
                await currentConn.sendMessage(from, { text: res.message }, { quoted: mek });
            });
            return;
        }

        // مصفوفة الشتائم الموحدة فحص تطابق كامل
        const shatemaWords = ['كسمك', 'خول', 'عرص', 'متناك', 'عبيط', 'اهبل', 'جزمه', 'عره', 'زاني', 'كلب', 'وسخ', 'انيك', 'زباله', 'دمج', 'حيوان', 'قليل الادب', 'متربتش', 'حقير', 'بضان', 'انت بضان'];
        const isExactShatema = shatemaWords.includes(normalizedBody);

        // 🛡️ [نظام الفلتر والتكرار وحظر الكلمات للأعضاء]
        if (!isHajj) {
            if (!wordSpamTracker[sender]) wordSpamTracker[sender] = {};
            if (!wordSpamTracker[sender][textLower]) wordSpamTracker[sender][textLower] = [];
            wordSpamTracker[sender][textLower] = wordSpamTracker[sender][textLower].filter(time => now - time < 60000);

            if (wordBannedUsers[sender] && wordBannedUsers[sender][textLower] && now < wordBannedUsers[sender][textLower]) {
                await respondWithStrictTiming('🚫', async () => {
                    if (normalizedBody.includes('بوت') || normalizedBody.includes(botName.toLowerCase())) {
                        await currentConn.sendMessage(from, { text: 'معمولك حظر من الكلمه دي عشان انت متربتش🐤😂' }, { quoted: mek });
                    } else {
                        await currentConn.sendMessage(from, { text: 'مش هرد عليك' }, { quoted: mek });
                    }
                });
                return;
            }

            wordSpamTracker[sender][textLower].push(now);
            if (wordSpamTracker[sender][textLower].length > 10) {
                if (!wordBannedUsers[sender]) wordBannedUsers[sender] = {};
                wordBannedUsers[sender][textLower] = now + (15 * 60 * 1000);
                await respondWithStrictTiming('🔇', async () => {
                    await currentConn.sendMessage(from, { text: 'مش هرد عليك' }, { quoted: mek });
                });
                return;
            }
        }

        // =========================================================================
        // 👑 [الأوامر الملكية للحج والمساعدين - الإضافة والسحب والتحصين]
        // =========================================================================
        
        // 🪙 [أمر إعطاء النقاط الملكي - للحج الأصلي فقط]
        if (normalizedBody.startsWith('اعطي ') || normalizedBody.startsWith('اعطي')) {
            if (!isAbsoluteOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ عفوًا! أمر إعطاء النقاط مخصص حصرياً للحج شادو الأصلي (صاحب البوت)! 👑' }, { quoted: mek });
                });
                return;
            }
            let rawTarget = mek.message?.extendedTextMessage?.contextInfo?.participant || mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (rawTarget) {
                let targetUser = rawTarget;
                let targetNumberOnly = getCleanNumber(targetUser);
                let cleanDBUser = cleanUserJid(targetUser);

                let amountText = normalizedBody.replace('اعطي', '').trim();
                let pointsToGive = 0;
                let isInfiniteCommand = amountText.includes('لا نهائي') || amountText.includes('لانهايي') || amountText.includes('لا نهايه') || amountText.includes('لانهايه');

                let targetData = findUserData(targetUser, localDB);
                if (!targetData) {
                    targetData = { name: mek.message?.extendedTextMessage?.contextInfo?.pushName || 'عضو جديد', age: 'غير مسجل', status: 'غير مسجل', bio: 'لا يوجد بايو حالياً', points: 1000, level: 1, joinedAt: getArabicDateTime(), hasRegistered: false, isInfinite: false };
                    localDB.users[cleanDBUser] = targetData;
                }

                if (isInfiniteCommand) {
                    targetData.isInfinite = true;
                    targetData.points = 999999999999;
                    saveLocalDB(localDB);
                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { text: `👑 *أمر ملكي من الحج الأصلي:*\n✅ تم منح رصيد نقاط [ ♾️ لا نهائي ] إلى بروفايل @${targetNumberOnly} بنجاح! 👑🎉`, mentions: [targetUser] }, { quoted: mek });
                    });
                    return;
                } else {
                    if (amountText.includes('مليون')) pointsToGive = 1000000;
                    else if (amountText.includes('مليار')) pointsToGive = 1000000000;
                    else pointsToGive = parseInt(amountText.replace(/[^0-9]/g, '')) || 0;

                    if (pointsToGive > 0) {
                        targetData.isInfinite = false;
                        targetData.points = (targetData.points || 0) + pointsToGive;
                        saveLocalDB(localDB);
                        await respondWithStrictTiming('🪙', async () => {
                            await currentConn.sendMessage(from, { text: `👑 *أمر ملكي من الحج الأصلي:*\n✅ تم إضافة [ ${pointsToGive.toLocaleString('ar-EG')} ] نقطة إلى بروفايل @${targetNumberOnly} بنجاح! 🎉`, mentions: [targetUser] }, { quoted: mek });
                        });
                        return;
                    }
                }
            }
            return;
        }

        // 💸 [أمر سحب النقاط الملكي المطوّر - للحج الأصلي فقط]
        if (normalizedBody.startsWith('سحب ') || normalizedBody.startsWith('سحب')) {
            if (!isAbsoluteOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: `❌ عفوًا! أمر السحب مخصص حصرياً للحج شادو الأصلي (صاحب البوت)! 👑` }, { quoted: mek });
                });
                return;
            }
            let rawTarget = mek.message?.extendedTextMessage?.contextInfo?.participant || mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (rawTarget) {
                let targetUser = rawTarget;
                let targetNumberOnly = getCleanNumber(targetUser);
                let cleanDBUser = cleanUserJid(targetUser);

                const isTargetOriginalHajj = (targetNumberOnly === ownerPhone || targetNumberOnly === ownerLid || targetNumberOnly === ownerAltPhone);
                if (isTargetOriginalHajj) {
                    await respondWithStrictTiming('❌', async () => {
                        await currentConn.sendMessage(from, { text: `❌ هوب هوب يا فنان! دا بابا المجال الحج شادو الأصلي.. محدش يقدر يقرب لنقاطه أو يسحب منه نهائيًا! 👑🛡️` }, { quoted: mek });
                    });
                    return;
                }

                let targetData = findUserData(targetUser, localDB);
                if (!targetData) {
                    targetData = { name: mek.message?.extendedTextMessage?.contextInfo?.pushName || 'عضو جديد', age: 'غير مسجل', status: 'غير مسجل', bio: 'لا يوجد بايو حالياً', points: 1000, level: 1, joinedAt: getArabicDateTime(), hasRegistered: false, isInfinite: false };
                    localDB.users[cleanDBUser] = targetData;
                }

                let amountText = normalizedBody.replace('سحب', '').trim();
                let isClearAll = amountText.includes('كل') || amountText.includes('الكل') || amountText.includes('النقاط') || amountText.includes('نقاطه');
                if (isClearAll) {
                    targetData.points = 0;
                    targetData.isInfinite = false;
                    saveLocalDB(localDB);
                    await respondWithStrictTiming('📉', async () => {
                        await currentConn.sendMessage(from, { text: `👑 *أمر ملكي من الحج الأصلي:* \n📉 تم سحب وتصفير جميع نقاط بروفايل @${targetNumberOnly} بنجاح! 💸`, mentions: [targetUser] }, { quoted: mek });
                    });
                    return;
                } else {
                    let pointsToSubtract = 0;
                    if (amountText.includes('مليون')) pointsToSubtract = 1000000;
                    else if (amountText.includes('مليار')) pointsToSubtract = 1000000000;
                    else pointsToSubtract = parseInt(amountText.replace(/[^0-9]/g, '')) || 0;

                    if (pointsToSubtract > 0) {
                        targetData.isInfinite = false;
                        targetData.points = Math.max(0, (targetData.points || 0) - pointsToSubtract);
                        saveLocalDB(localDB);
                        await respondWithStrictTiming('📉', async () => {
                            await currentConn.sendMessage(from, { text: `👑 *أمر ملكي من الحج الأصلي:* \n📉 تم سحب [ ${pointsToSubtract.toLocaleString('ar-EG')} ] نقطة من بروفايل @${targetNumberOnly} بنجاح! 🎉`, mentions: [targetUser] }, { quoted: mek });
                        });
                        return;
                    }
                }
            }
            return;
        }

        if (isExactShatema && isHajj) {
            await respondWithStrictTiming('👑', async () => {
                await currentConn.sendMessage(from, { text: 'عشان انت الحج بس.. ف مسموحلك 👑👑❤️' }, { quoted: mek });
            });
            return;
        }

        if (['metzaalsh', 'متزعلش', 'metzaalsh meny', 'خلاص متزعلش'].includes(normalizedBody)) {
            if (isAbsoluteOwner) {
                await respondWithStrictTiming('❤️', async () => {
                    await currentConn.sendMessage(from, { text: 'مقدرش ازعل من بابا الحج حبيب قلبي ❤️👑' }, { quoted: mek });
                });
                return;
            } else if (isHajj) {
                await respondWithStrictTiming('❤️', async () => {
                    await currentConn.sendMessage(from, { text: 'مقدرش ازعل من حبايب بابا الحج شادو ❤️👑' }, { quoted: mek });
                });
                return;
            }
        }

        if ([`${botName.toLowerCase()} ابني`, `ابني ${botName.toLowerCase()}`, 'ابني'].includes(normalizedBody)) {
            if (isAbsoluteOwner) {
                await respondWithStrictTiming('👑', async () => {
                    await currentConn.sendMessage(from, { text: 'حبيبي يا بابا الحج ونور عيني 👑❤️' }, { quoted: mek });
                });
            } else if (isHajj) {
                await respondWithStrictTiming('👑', async () => {
                    await currentConn.sendMessage(from, { text: 'انت عمي بس ابويا واحد بس شادو 👑❤️' }, { quoted: mek });
                });
            } else {
                await respondWithStrictTiming('🐤', async () => {
                    await currentConn.sendMessage(from, { text: 'ابوك مين يا حبيبي؟ ابويا واحد بس هو الحج شادو 👑❤️' }, { quoted: mek });
                });
            }
            return;
        }

        // 💬 زر اختبار سريع
        if (normalizedBody === 'تست' || normalizedBody === 'test') {
            await respondWithStrictTiming('🚀', async () => {
                await currentConn.sendMessage(from, { text: 'شغال يا فنان و فايق قولي محتاج اي💫❤️' }, { quoted: mek });
            });
            return;
        }

        // =========================================================================
        // 🛑 [نظام حماية وحظر الألعاب في الخاص]
        // =========================================================================
        let tttCommandCheck = gameTicTacToe?.command || gameTicTacToe?.default?.command;
        let isGameCommand = /^(كوره|كورة|لعبة الكورة|لعبة كوره|كيف لعب كوره|كيف العب كوره|طريقه كوره|تلميح كوره|تلميح كورة|الغاء كوره|الغاء كورة|ايقاف كوره|احزر|احذر|لعبة احزر|لعبة احذر|كيف لعب احزر|كيف العب احزر|طريقه احزر|شراء تلميح احزر|الغاء احزر|الغاء احذر|رتب|ترتيب|لعبة رتب|كيف لعب رتب|كيف العب رتب|طريقه رتب|شراء تلميح رتب|الغاء رتب|xo|الخروج|انسحاب|اكس|او|اكس او|صراحه|صراحة|بكاسه|بكاسة|انضمام بكاسه|انضمام بكاسة|خروج بكاسه|خروج بكاسة|ابدأ بكاسه|ابدأ بكاسة|تصويت|خلصت|تخمين|تكملة|تكمله|الغاء بكاسه|الغاء بكاسة|بازل|puzzle|فوق|تحت|يمين|شمال|تلميح بازل|الغاء بازل|تلميح البازل|الغاء البازل)$/i.test(normalizedBody) || (tttCommandCheck && tttCommandCheck.test(textLower));

        if (!isRealGroup) {
            let isBakasaActive = global.bakasa && global.bakasa[from];
            if (isGameCommand || (currentConn.obito && currentConn.obito[from]) || (currentConn.scramble && currentConn.scramble[from]) || (currentConn.gameSolo && currentConn.gameSolo[from]) || (currentConn.game && currentConn.game[from]) || isBakasaActive) {
                await respondWithStrictTiming('⚠️', async () => {
                    await currentConn.sendMessage(from, { text: '⚠️ الألعاب دي بتشتغل جوه الجروبات بس يا نجم! ⚽🎮' }, { quoted: mek });
                });
                return;
            }
        }

        // =========================================================================
        // 🛑 [الألعاب وأنظمة التسلية - معالجة الـ Before الذكية]
        // =========================================================================
        let guessAnswered = false;
        let scrambleAnswered = false;
        let footballAnswered = false;
        let tttAnswered = false;
        let bakasaAnswered = false;
        let puzzleAnswered = false;

        if (gamePuzzle) {
            if (['فوق', 'تحت', 'يمين', 'شمال'].includes(normalizedBody)) {
                if (typeof gamePuzzle.execute === 'function') {
                    await gamePuzzle.execute(currentConn, mek, [], 'move', body);
                    puzzleAnswered = true;
                }
            } else if (normalizedBody === 'تلميح بازل' || normalizedBody === 'تلميح البازل') {
                if (typeof gamePuzzle.execute === 'function') {
                    await gamePuzzle.execute(currentConn, mek, [], 'تلميح', body);
                    puzzleAnswered = true;
                }
            } else if (normalizedBody === 'الغاء بازل' || normalizedBody === 'الغاء البازل') {
                if (typeof gamePuzzle.execute === 'function') {
                    await gamePuzzle.execute(currentConn, mek, [], 'الغاء', body);
                    puzzleAnswered = true;
                }
            }
        }

        if (gameBakasa) {
            if (typeof gameBakasa.before === 'function') bakasaAnswered = await gameBakasa.before(mek, currentConn);
            else if (gameBakasa.default && typeof gameBakasa.default.before === 'function') bakasaAnswered = await gameBakasa.default.before(mek, currentConn);
        }
        if (gameFootball) {
            if (typeof gameFootball.before === 'function') footballAnswered = await gameFootball.before(mek, currentConn);
            else if (gameFootball.default && typeof gameFootball.default.before === 'function') footballAnswered = await gameFootball.default.before(mek, currentConn);
        }
        if (gameGuess) {
            if ((currentConn.obito && currentConn.obito[from]) || ['كيف لعب احزر', 'كيف العب احزر', 'طريقه احزر', 'شراء تلميح احزر'].includes(normalizedBody)) {
                if (typeof gameGuess.before === 'function') guessAnswered = await gameGuess.before(mek, currentConn);
                else if (gameGuess.default && typeof gameGuess.default.before === 'function') guessAnswered = await gameGuess.default.before(mek, currentConn);
            }
        }
        if ((currentConn.scramble && currentConn.scramble[from]) || ['كيف لعب رتب', 'كيف العب رتب', 'طريقه رتب', 'شراء تلميح رتب'].includes(normalizedBody)) {
            try {
                const gameWordModule = await import('./plugins/game-word.js');
                const gameWord = gameWordModule.default || gameWordModule;
                if (gameWord && typeof gameWord === 'function') scrambleAnswered = await gameWord.before(mek, currentConn);
            } catch (e) {
                console.error("Error in gameWord Before:", e);
            }
        }
        if ((currentConn.gameSolo && currentConn.gameSolo[from]) || (currentConn.game && currentConn.game[from])) {
            if (gameTicTacToe) {
                if (typeof gameTicTacToe.before === 'function') tttAnswered = await gameTicTacToe.before(mek, currentConn);
                else if (gameTicTacToe.default && typeof gameTicTacToe.default.before === 'function') tttAnswered = await gameTicTacToe.default.before(mek, currentConn);
            }
        }

        let sarahaHandled = false;
        if (gameSaraha) {
            if (typeof gameSaraha === 'function') sarahaHandled = await gameSaraha(mek, currentConn);
            else if (gameSaraha.default && typeof gameSaraha.default === 'function') sarahaHandled = await gameSaraha.default(mek, currentConn);
        }
        
        // 🎮 [معالجة الألعاب والتأكد من عدم تضارب النقاط] 🎮
        if (guessAnswered || scrambleAnswered || footballAnswered || tttAnswered || bakasaAnswered || puzzleAnswered) {
            return;
        }
        if (sarahaHandled) return;

        // =========================================================================
        // 🛑 [الألعاب وأنظمة التسلية - تشغيل الأوامر الأساسية لفتح الجيم]
        // =========================================================================
        if (/^(بازل|puzzle)$/i.test(normalizedBody)) {
            if (gamePuzzle) {
                await respondWithStrictTiming('🧩', async () => {
                    if (typeof gamePuzzle.execute === 'function') {
                        await gamePuzzle.execute(currentConn, mek, [], 'بازل', body);
                    }
                });
            }
            return;
        }

        let bakasaState = global.bakasa && global.bakasa[from];
        let isBakasaActive = bakasaState && bakasaState.status !== 'off';
        let isBakasaExplicitCmd = normalizedBody.startsWith('بكاسه') || normalizedBody.startsWith('بكاسة');
        
        let isBakasaSubCmd = false;
        if (isBakasaActive) {
            if (/^(انضمام|خروج|ابدأ|ابدا|بدا|خلصت|إلغاء|الغاء|تكملة|تكمله|كمل|\.)$/i.test(normalizedBody)) {
                isBakasaSubCmd = true;
            } else if (normalizedBody.startsWith('تصويت') || normalizedBody.startsWith('تخمين')) {
                isBakasaSubCmd = true;
            } else if (bakasaState.status === 'choosing_category' && /^(10|[1-9]|عشوائي|كل|ملابس|اكسسوارات|سيارات|عربيات|نقل|اكلات|طعام|مشروبات|دول|عواصم|بلاد|حيوانات|طيور|ادوات|اجهزة|منزلية|اماكن|مباني|مهن|وظائف|شغل|رياضة|رياضه|العاب|طبيعة|نباتات)/i.test(normalizedBody)) {
                isBakasaSubCmd = true;
            } else if (bakasaState.status === 'guessing' && /^[1-5]$/.test(normalizedBody)) {
                isBakasaSubCmd = true;
            }
        }

        if (isBakasaExplicitCmd || isBakasaSubCmd) {
            if (gameBakasa) {
                await respondWithStrictTiming('🃏', async () => {
                    if (typeof gameBakasa.after === 'function') await gameBakasa.after(mek, currentConn);
                    else if (gameBakasa.default && typeof gameBakasa.default.after === 'function') await gameBakasa.default.after(mek, currentConn);
                });
            }
            return;
        }

        if (/^(كوره|كورة|لعبة الكورة|لعبة كوره|كيف لعب كوره|كيف العب كوره|طريقه كوره|تلميح كوره|تلميح كورة|الغاء كوره|الغاء كورة|ايقاف كوره)$/i.test(normalizedBody)) {
            if (gameFootball) {
                await respondWithStrictTiming('⚽', async () => {
                    if (typeof gameFootball.after === 'function') await gameFootball.after(mek, currentConn);
                    else if (gameFootball.default && typeof gameFootball.default.before === 'function') await gameFootball.default.after(mek, currentConn);
                    else if (typeof gameFootball === 'function') await gameFootball(mek, currentConn);
                    else if (gameFootball.default && typeof gameFootball.default === 'function') await gameFootball.default(mek, currentConn);
                });
            }
            return;
        }
        let tttCommand = gameTicTacToe?.command || gameTicTacToe?.default?.command;
        if ((tttCommand && tttCommand.test(textLower)) || /^(xo|الخروج|انسحاب|اكس|او|اكس او)$/i.test(normalizedBody)) {
            if (gameTicTacToe) {
                await respondWithStrictTiming('❌', async () => {
                    if (typeof gameTicTacToe === 'function') await gameTicTacToe(mek, currentConn);
                    else if (gameTicTacToe.default && typeof gameTicTacToe.default === 'function') await gameTicTacToe.default(mek, currentConn);
                });
            }
            return;
        }
        if (/^(احزر|احذر|لعبة احزر|لعبة احذر|كيف لعب احزر|كيف العب احزر|طريقه احزر|شراء تلميح احزر|الغاء احزر|الغاء احذر)$/i.test(normalizedBody)) {
            if (gameGuess) {
                await respondWithStrictTiming('🔎', async () => {
                    if (typeof gameGuess === 'function') await gameGuess(mek, currentConn);
                    else if (gameGuess.default && typeof gameGuess.default === 'function') await gameGuess.default(mek, currentConn);
                });
            }
            return;
        }
        if (/^(رتب|ترتيب|لعبة رتب|كيف لعب رتب|كيف العب رتب|طريقه رتب|شراء تلميح رتب|الغاء رتب)$/i.test(normalizedBody)) {
            await respondWithStrictTiming('🔠', async () => {
                try {
                    const gameWordModule = await import('./plugins/game-word.js');
                    const gameWord = gameWordModule.default || gameWordModule;
                    if (gameWord && typeof gameWord === 'function') await gameWord(mek, currentConn);
                } catch (e) {
                    console.error("Error in gameWord Command:", e);
                }
            });
            return;
        }
        // =========================================================================
        // 📜 [قائمة الأوامر المقسمة إلى أقسام ذكية بالأرقام]
        // =========================================================================
        const isMainMenuCmd = ['اوامر', 'أوامر', 'منيو', 'المنيو', 'menu', 'help'].includes(normalizedBody);
        const isAllMenuCmd = ['اوامر الكل', 'أوامر الكل', 'منيو الكل', 'المنيو الكل', 'اوامر كل', 'منيو كل', 'الكل'].includes(normalizedBody);

        let targetMenuSec = null;
        if (isAllMenuCmd) {
            targetMenuSec = 'all';
        } else if (/^(قسم\s*1|1)$/.test(normalizedBody) || ['الالعاب', 'الألعاب', 'قسم الالعاب', 'قسم الألعاب'].includes(normalizedBody)) {
            targetMenuSec = 1;
        } else if (/^(قسم\s*2|2)$/.test(normalizedBody) || ['البروفايل', 'نقاط', 'قسم البروفايل', 'قسم النقاط'].includes(normalizedBody)) {
            targetMenuSec = 2;
        } else if (/^(قسم\s*3|3)$/.test(normalizedBody) || ['الجروب', 'الجروبات', 'الاشراف', 'الإشراف', 'قسم الجروب', 'قسم الاشراف'].includes(normalizedBody)) {
            targetMenuSec = 3;
        } else if (/^(قسم\s*4|4)$/.test(normalizedBody) || ['التنبيهات', 'الانذارات', 'قسم التنبيهات'].includes(normalizedBody)) {
            targetMenuSec = 4;
        } else if (/^(قسم\s*5|5)$/.test(normalizedBody) || ['التنصيب', 'البوتات الفرعية', 'قسم التنصيب'].includes(normalizedBody)) {
            targetMenuSec = 5;
        } else if (/^(قسم\s*6|6)$/.test(normalizedBody) || ['الحج', 'المالك', 'اوامر الحج', 'قسم الحج', 'قسم المالك'].includes(normalizedBody)) {
            targetMenuSec = 6;
        } else if (/^(قسم\s*7|7)$/.test(normalizedBody) || ['الذكاء', 'الميديا', 'قسم الذكاء', 'قسم الميديا'].includes(normalizedBody)) {
            targetMenuSec = 7;
        } else if (/^(قسم\s*8|8)$/.test(normalizedBody) || ['الردود', 'الدردشة', 'قسم الردود', 'قسم الدردشة'].includes(normalizedBody)) {
            targetMenuSec = 8;
        }

        let shouldExecuteMenu = isMainMenuCmd;
        if (targetMenuSec !== null) {
            const isNamedSectionWord = normalizedBody.startsWith('قسم ') || ['الالعاب', 'الألعاب', 'البروفايل', 'التنبيهات', 'التنصيب', 'اوامر الحج', 'الذكاء', 'الميديا', 'الردود'].includes(normalizedBody);
            if (isAllMenuCmd || isNamedSectionWord || !isRealGroup) {
                shouldExecuteMenu = true;
            } else if (isRealGroup) {
                // في الجروب إذا كتب رقماً من 1 لـ 8: نتأكد هل ريبلاي على المنيو أو طُلب المنيو مؤخراً بالجروب
                const ctxInfo = mek.message?.extendedTextMessage?.contextInfo;
                const quotedText = ctxInfo?.quotedMessage?.conversation ||
                                   ctxInfo?.quotedMessage?.extendedTextMessage?.text || '';
                const isQuotingMenu = quotedText.includes('قائمة أوامر') || quotedText.includes('Bot Menu') || quotedText.includes('اختر رقم القسم');
                const { recentMenuChats } = await import('./plugins/menu.js');
                const isRecentMenu = recentMenuChats.has(from) && (Date.now() - recentMenuChats.get(from) < 180000);
                if (isQuotingMenu || isRecentMenu) {
                    shouldExecuteMenu = true;
                }
            }
        }

        if (shouldExecuteMenu) {
            if (menuHandler) {
                await respondWithStrictTiming('📜', async () => {
                    const fn = typeof menuHandler === 'function' ? menuHandler : menuHandler.default;
                    if (typeof fn === 'function') await fn(mek, currentConn, targetMenuSec);
                });
            }
            return;
        }
        if (normalizedBody === 'من الي عملك' || normalizedBody === 'مين اللي عملك') {
            await respondWithStrictTiming('🛠️', async () => {
                await currentConn.sendMessage(from, { text: 'شادو الي عملني وده رقمو 01129249396' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'عدد الناس' || normalizedBody === 'العدد' || normalizedBody === 'عدد الاعضاء') {
            if (isRealGroup) {
                await respondWithStrictTiming('📊', async () => {
                    try {
                        let groupMetadata = await currentConn.groupMetadata(from);
                        let count = groupMetadata.participants.length;
                        await currentConn.sendMessage(from, { text: `📊 *عدد الناس المتواجدين في الروم حالياً هو:* ${count} عضو ✨` }, { quoted: mek });
                    } catch (e) {}
                });
            } else {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: `❌ الأمر ده بيشتغل جوه الجروبات بس يا فنان.` }, { quoted: mek });
                });
            }
            return;
        }
        
        // =========================================================================
        // 🪪 [نظام بطاقتي والتسجيل المتكامل المحفوظ بالداتا بيز]
        // =========================================================================
        let userProfileData = findUserData(sender, localDB);
        if (!userProfileData) {
            userProfileData = {
                name: mek.pushName || 'عضو جديد', age: 'غير مسجل', status: 'غير مسجل', bio: 'لا يوجد بايو حالياً',
                points: 1000, level: 1, joinedAt: getArabicDateTime(), hasRegistered: false, isInfinite: false
            };
            localDB.users[standardSenderJid] = userProfileData;
            saveLocalDB(localDB);
        }

        if (normalizedBody.startsWith('سجل')) {
            const registrationData = body.substring(3).trim();
            const parts = registrationData ? registrationData.split(/[\|\-\/\,\،]+/).map(p => p.trim()).filter(Boolean) : [];
            if (!registrationData || parts.length < 2) {
                await respondWithStrictTiming('⚠️', async () => {
                    await currentConn.sendMessage(from, { text: `*⚠️ طريقة التسجيل الصحيحة:*\n\nاكتب: سجل الاسم | السن | الحالة الاجتماعية | نبذة عنك\n(يمكنك استخدام أي فاصل مثل | أو - أو / أو ،)\n\n*💡 ملحوظة:* كل تعديل بيكلفك خصم 20 نقطة من رصيدك (مجاناً للحج).` }, { quoted: mek });
                });
                return;
            }
            if (!isAbsoluteOwner && !isMainHajj && !userProfileData.isInfinite) {
                if ((userProfileData.points || 0) < 20) {
                    await respondWithStrictTiming('❌', async () => {
                        await currentConn.sendMessage(from, { text: `❌ رصيد نقاطك الحالي [ ${userProfileData.points || 0} ] غير كافي لتعديل البروفايل! تحتاج على الأقل 20 نقطة.` }, { quoted: mek });
                    });
                    return;
                }
                userProfileData.points -= 20;
            }
            
            const partsList = parts;
            userProfileData.name = partsList[0] || 'عضو جديد';
            userProfileData.age = partsList[1] || 'غير مسجل';
            userProfileData.status = partsList[2] || 'غير مسجل';
            userProfileData.bio = partsList[3] || 'لا يوجد بايو حالياً';
            userProfileData.joinedAt = userProfileData.joinedAt || getArabicDateTime();
            userProfileData.hasRegistered = true;

            // مزامنة فورية على كل المعرفات
            localDB.users[standardSenderJid] = { ...userProfileData };
            localDB.users[`${cleanSender}@lid`] = { ...userProfileData };
            let mappedSender = localDB.lidMap?.[cleanSender];
            if (mappedSender) {
                localDB.users[`${mappedSender}@s.whatsapp.net`] = { ...userProfileData };
                localDB.users[`${mappedSender}@lid`] = { ...userProfileData };
            }

            // تثبيت بيانات الحج الأصلي الملكية
            if (isAbsoluteOwner) {
                userProfileData.name = 'شادو';
                userProfileData.age = '21';
                userProfileData.status = 'مرتبط';
                userProfileData.bio = 'Me and Zuzu always ❤️';
                userProfileData.isInfinite = true;
                userProfileData.points = 999999999999;
                userProfileData.level = 999;
                userProfileData.joinedAt = '١٣‏/٠٧‏/٢٠٢٦، ٠٦:٤٦:٤٨ م';
                localDB.users['194961618301016@s.whatsapp.net'] = { ...userProfileData };
                localDB.users['201129249396@s.whatsapp.net'] = { ...userProfileData };
                localDB.users['194961618301016@lid'] = { ...userProfileData };
                localDB.users['201229409956@s.whatsapp.net'] = { ...userProfileData };
            }
            saveLocalDB(localDB);

            await respondWithStrictTiming('🎉', async () => {
                let textSuccess = `*🎉 تم حفظ وتحديث بيانات بروفايلك بنجاح!*`;
                if (!isAbsoluteOwner && !isMainHajj && !userProfileData.isInfinite) textSuccess += `\n🪙 تم خصم 20 نقطة رسوم تعديل. رصيدك المتبقي: [ ${userProfileData.points} ] نقطة.`;
                await currentConn.sendMessage(from, { text: textSuccess }, { quoted: mek });
            });
            return;
        }
        
        // 📇 [عرض البروفايل]
        if (normalizedBody.startsWith('بطاقتي') || normalizedBody.startsWith('بروفيل') || normalizedBody.startsWith('بروفايل')) {
            let targetUser = mek.message?.extendedTextMessage?.contextInfo?.participant;
            if (!targetUser) {
                let mentioned = mek.message?.extendedTextMessage?.contextInfo?.mentionedJid;
                if (mentioned && mentioned.length > 0) targetUser = mentioned[0];
            }
            if (!targetUser) {
                let cleanNumbersInText = (body || '').match(/[0-9]{8,16}/g);
                if (cleanNumbersInText && cleanNumbersInText.length > 0) {
                    let num = cleanNumbersInText[0];
                    if (num.startsWith('01') && num.length === 11) num = '2' + num;
                    targetUser = num.length > 14 ? `${num}@lid` : `${num}@s.whatsapp.net`;
                }
            }
            if (!targetUser) targetUser = sender;

            let targetCleanNum = getCleanNumber(targetUser);
            let mappedNum = localDB.lidMap?.[targetCleanNum];
            let cleanDBUser = cleanUserJid(targetUser);

            const isTargetOriginalHajj = (
                targetCleanNum === ownerPhone ||
                targetCleanNum === ownerLid ||
                targetCleanNum === ownerAltPhone ||
                mappedNum === ownerPhone ||
                mappedNum === ownerLid ||
                (targetUser === sender && mek.key.fromMe)
            );
            const isTargetMainHajj = isTargetOriginalHajj || isUserInList(targetUser, localDB.mainHajjUsers);
            const isTargetAssistantHajj = !isTargetMainHajj && isUserInList(targetUser, localDB.hajjUsers);

            let targetData = findUserData(targetUser, localDB);
            if (!targetData) {
                targetData = {
                    name: isTargetOriginalHajj ? 'شادو' : (mek.message?.extendedTextMessage?.contextInfo?.pushName || mek.pushName || 'عضو غير مسجل'),
                    age: isTargetOriginalHajj ? '21' : 'غير مسجل',
                    status: isTargetOriginalHajj ? 'مرتبط' : 'غير مسجل',
                    bio: isTargetOriginalHajj ? 'Me and Zuzu always ❤️' : 'لا يوجد بايو حالياً',
                    points: isTargetOriginalHajj ? 999999999999 : (isTargetAssistantHajj ? 1000000 : 1000),
                    level: isTargetOriginalHajj ? 999 : (isTargetAssistantHajj ? 500 : 1),
                    joinedAt: isTargetOriginalHajj ? '١٣‏/٠٧‏/٢٠٢٦، ٠٦:٤٦:٤٨ م' : getArabicDateTime(),
                    hasRegistered: isTargetOriginalHajj,
                    isInfinite: isTargetOriginalHajj
                };
                localDB.users[cleanDBUser] = targetData;
                saveLocalDB(localDB);
            }

            if (isTargetOriginalHajj) {
                targetData.name = 'شادو';
                targetData.age = '21';
                targetData.status = 'مرتبط';
                targetData.bio = 'Me and Zuzu always ❤️';
                targetData.points = 999999999999;
                targetData.level = 999;
                targetData.joinedAt = '١٣‏/٠٧‏/٢٠٢٦، ٠٦:٤٦:٤٨ م';
                targetData.isInfinite = true;
            }

            let checkIsAdmin = false;
            try {
                if (isRealGroup) {
                    const groupMetadata = await currentConn.groupMetadata(from);
                    checkIsAdmin = !!groupMetadata.participants.find(p => {
                        let pClean = getCleanNumber(p.id);
                        return pClean === targetCleanNum || (mappedNum && pClean === mappedNum);
                    })?.admin;
                }
            } catch (e) {}

            let userRole = '🌱 عضو عادي';
            let finalPoints = (isTargetOriginalHajj || isTargetMainHajj || targetData.isInfinite) ? '♾️ لا نهائي' : (targetData.points || 0).toLocaleString('ar-EG');
            let finalLevel = (isTargetOriginalHajj || isTargetMainHajj) ? 999 : (targetData.level || 1);

            if (isTargetOriginalHajj) {
                userRole = '👑 الحج الأصلي (صاحب البوت وبابا المجال)';
                finalLevel = 999;
                finalPoints = '♾️ لا نهائي';
            } else if (isTargetMainHajj) {
                userRole = '👑 حج أساسي بالسستم';
                finalLevel = 999;
                finalPoints = '♾️ لا نهائي';
            } else if (isTargetAssistantHajj) {
                userRole = checkIsAdmin ? '🛡️ أدمن + ⚔️ حج مساعد' : '⚔️ حج مساعد';
                finalLevel = 500;
            } else if (checkIsAdmin) {
                userRole = '🛡️ أدمن الجروب';
            } else {
                userRole = ((targetData.points || 0) >= 5000 || targetData.isInfinite) ? '🏅 أسطورة الشادو' : '🌱 عضو عادي';
            }

            let displayTargetNum = (mappedNum && targetCleanNum.length > 14) ? mappedNum : targetCleanNum;

            let cardText = `*🪪 بـطـاقـة الـهـويـة الـشـخـصـيـة 🪪*\n`;
            cardText += `*━━━━━━━━━━━━━━━━━━━━━*\n\n`;
            cardText += `*👤 الاسـم:* ${targetData.name || 'عضو غير مسجل'}\n`;
            cardText += `*🔢 الـسـن:* ${targetData.age || 'غير مسجل'}\n`;
            cardText += `*💍 الـحـالـة:* ${targetData.status || 'غير مسجل'}\n`;
            cardText += `*📝 الـبـايو:* ${targetData.bio || 'لا يوجد بايو حالياً'}\n\n`;
            cardText += `*📊 إحـصـائـيـات الـسـسـتـم:*\n`;
            cardText += `*━━━━━━━━━━━━━━━━━━━━━*\n`;
            cardText += `*🎖️ الـرتبـة:* ${userRole}\n`;
            cardText += `*🪙 الـنـقـاط:* [ ${finalPoints} ] نقطة ✨\n`;
            cardText += `*📈 الـمـسـتـوى:* Level ${finalLevel}\n`;
            cardText += `*📅 تـاريخ التسجيل:* ${targetData.joinedAt || 'غير معروف'}\n\n`;
            cardText += `*📱 حـسـاب الـمـسـتـخـدم:* @${displayTargetNum}`;
            
            await respondWithStrictTiming('📇', async () => {
                await currentConn.sendMessage(from, { text: cardText, mentions: [targetUser] }, { quoted: mek });
            });
            return;
        }

        // =========================================================================
        // 💬 [الردود التلقائية الذكية المخصصة]
        // =========================================================================
        if (dynamicState[sender] === 'waiting_for_shatema_clarification') {
            if (['انت', 'اه انت', 'ايوا انت', 'انت وهو', 'اه انت وهو', 'ايوا انت وهو'].includes(normalizedBody)) {
                delete dynamicState[sender];
                await respondWithStrictTiming('🐤', async () => {
                    await currentConn.sendMessage(from, { text: 'مش هرد عليك لاجل ابويا' }, { quoted: mek });
                });
                return;
            } else if (['لا مش انت', 'لا', 'مش انت'].includes(normalizedBody)) {
                delete dynamicState[sender];
                await respondWithStrictTiming('🤝', async () => {
                    await currentConn.sendMessage(from, { text: 'خلصانه يا حب فهمت غلط 🐤' }, { quoted: mek });
                });
                return;
            }
        }
        
        if (dynamicState[sender] === 'waiting_for_call_clarification') {
            if (['لا قولي', 'قولي'].includes(normalizedBody)) {
                delete dynamicState[sender];
                await respondWithStrictTiming('😇', async () => {
                    await currentConn.sendMessage(from, { text: 'لا عشان انا محترم' }, { quoted: mek });
                });
                return;
            } else {
                delete dynamicState[sender];
            }
        }

        if (['بموت', 'مت', 'فطست', 'يلهوي بموت'].includes(normalizedBody)) {
            await respondWithStrictTiming('😂', async () => {
                await currentConn.sendMessage(from, { text: 'روح موت بعيد 🐤😂' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'بحبك ياض' || normalizedBody === 'انت قلبي' || normalizedBody === 'قلبي ياض' || normalizedBody === 'انتي قلبي' || normalizedBody === 'انتي مراتي' || normalizedBody === 'ما تيجي') {
            await respondWithStrictTiming('🏳️‍🌈', async () => {
                await currentConn.sendMessage(from, { text: 'انا شاكك فيكم من البدايه  🐤🏳️‍🌈' }, { quoted: mek });
            });
            return;
        }

        if (['بحبك', 'احبك', 'وحشتيني', 'حبك', 'حبي', 'بموت فيكي'].includes(normalizedBody)) {
            await respondWithStrictTiming('🐤', async () => {
                await currentConn.sendMessage(from, { text: 'مش ناقصه محن بقي🐤' }, { quoted: mek });
            });
            return;
        }
        if (new RegExp(`^بكرهك$|^بكرهكم$|^بكره$|^بكرهك يا ${botName.toLowerCase()}$|^بكرهك يا بوت$`).test(normalizedBody)) {
            await respondWithStrictTiming('😏', async () => {
                await currentConn.sendMessage(from, { text: 'اكتر  🐤😂' }, { quoted: mek });
            });
            return;
        }
        if (['جوزوني', 'عايز اتجوز', 'عايزه اتجوز'].includes(normalizedBody)) {
            await respondWithStrictTiming('🧞', async () => {
                await currentConn.sendMessage(from, { text: 'كلم جني هتحللك الحوار' }, { quoted: mek });
            });
            return;
        }
        if (['قلبي', 'حبيبي', 'قلبو'].includes(normalizedBody)) {
            await respondWithStrictTiming('❤️', async () => {
                await currentConn.sendMessage(from, { text: 'حبيبي يا فنان❤️' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === `اسمك ${botName.toLowerCase()}`) {
            await respondWithStrictTiming('👀', async () => {
                await currentConn.sendMessage(from, { text: 'اه' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === `${botName.toLowerCase()} اسمك الحقيقي`) {
            await respondWithStrictTiming('🤖', async () => {
                await currentConn.sendMessage(from, { text: 'اه ابويا الي مخترلهولي' }, { quoted: mek });
            });
            return;
        }
        if (['طيب', 'طويب'].includes(normalizedBody)) {
            await respondWithStrictTiming('🤝', async () => {
                await currentConn.sendMessage(from, { text: 'اخويا يعم 🐤' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'ابوك مين') {
            await respondWithStrictTiming('👑', async () => {
                await currentConn.sendMessage(from, { text: `أبويا وصاحب فضل عليا هو الحج شادو بابا الكل 👑❤️` }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === `من ${botName.toLowerCase()}` || normalizedBody === `مين ${botName.toLowerCase()}`) {
            await respondWithStrictTiming('📞', async () => {
                await currentConn.sendMessage(from, { text: 'الحج شادو ده و يبعت رقمي الي هو 01129249396' }, { quoted: mek });
            });
            return;
        }
        if (['metzaalsh', 'متزعلش', 'metzaalsh meny', 'خلاص متزعلش'].includes(normalizedBody)) {
            await respondWithStrictTiming('🥺', async () => {
                await currentConn.sendMessage(from, { text: `خلاص مش زعلان يا قلب ${botName} ❤️🐤` }, { quoted: mek });
            });
            return;
        }
        if (['metjiibi bosa', 'تعالي نجوز', 'مراتي'].includes(normalizedBody)) {
            await respondWithStrictTiming('🤦‍♂️', async () => {
                await currentConn.sendMessage(from, { text: 'حسبي الله فيكم' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'بوت عبيط') {
            await respondWithStrictTiming('😏', async () => {
                await currentConn.sendMessage(from, { text: 'فكريني زيك ولا اي' }, { quoted: mek });
            });
            return;
        }
        if (['metigi', 'متيجي', 'تيجي'].includes(normalizedBody)) {
            await respondWithStrictTiming('🤫', async () => {
                await currentConn.sendMessage(from, { text: 'بس يا بابا عيب' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'غور') {
            await respondWithStrictTiming('𫝩', async () => {
                await currentConn.sendMessage(from, { text: `لا قاعد مع ${botName} 🐤` }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'يوه') {
            await respondWithStrictTiming('😮', async () => {
                await currentConn.sendMessage(from, { text: 'وه' }, { quoted: mek });
            });
            return;
        }

        if (normalizedBody === botName.toLowerCase() || normalizedBody.startsWith(botName.toLowerCase() + ' ')) {
            await respondWithStrictTiming('✨', async () => {
                await currentConn.sendMessage(from, { text: 'تحت امرك يا فنان اتفضل يا حبيبي اامر❤️' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'بوت' || normalizedBody === 'يا بوت') {
            await respondWithStrictTiming('💫', async () => {
                if (lastBotTime[sender] && (now - lastBotTime[sender] > 120000)) {
                    botCounter[sender] = 0;
                }
                if (!botCounter[sender]) botCounter[sender] = 0;
                botCounter[sender]++;
                lastBotTime[sender] = now;
                if (botCounter[sender] >= 5) {
                    await currentConn.sendMessage(from, { text: `خلاص يا حبيبي قولنا ${botName}` }, { quoted: mek });
                } else {
                    await currentConn.sendMessage(from, { text: `اسمي ${botName} يا نجم  🐤💫` }, { quoted: mek });
                }
            });
            return;
        }
        if (['مزه', 'امزه'].includes(normalizedBody)) {
            await respondWithStrictTiming('🐤', async () => {
                await currentConn.sendMessage(from, { text: 'مزه ف عينك🐤' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'حصل') {
            await respondWithStrictTiming('📞', async () => {
                await currentConn.sendMessage(from, { text: 'عباس اتصل 🐤' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'اشط') {
            await respondWithStrictTiming('👍', async () => {
                await currentConn.sendMessage(from, { text: 'خلصا  🐤' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'atصل بمين' || normalizedBody === 'اتصل بمين') {
            dynamicState[sender] = 'waiting_for_call_clarification';
            await respondWithStrictTiming('🤔', async () => {
                await currentConn.sendMessage(from, { text: 'بلاش اقولك 🐤' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'اه') {
            await respondWithStrictTiming('🛣️', async () => {
                await currentConn.sendMessage(from, { text: 'في الشارع الي وراه 🐤' }, { quoted: mek });
            });
            return;
        }

        if (normalizedBody === 'انت بتاخد') {
            await respondWithStrictTiming('🤐', async () => {
                await currentConn.sendMessage(from, { text: 'بس يا بابا عيب 🐤' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'تعال اديك') {
            await respondWithStrictTiming('', async () => {
                await currentConn.sendMessage(from, { text: 'شرح مبكلمش عيال صغيره' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === ` فين ${botName.toLowerCase()}`) {
            await respondWithStrictTiming('🙋‍♂️', async () => {
                await currentConn.sendMessage(from, { text: 'انا موجود يا قلبي' }, { quoted: mek });
            });
            return;
        }
        if (['انت تبع مين', 'انت تبع مين يا بوت', 'تبع مين انت', 'تبع مين'].includes(normalizedBody)) {
            await respondWithStrictTiming('👑', async () => {
                const ownerName = currentConn.isSubBot ? `الحج الأساسي (+${currentConn.subBotConfig?.adminPhone || 'مالكي'})` : 'الحج شادو الأصلي';
                await currentConn.sendMessage(from, { text: `تبع ${ownerName} 👑❤️` }, { quoted: mek });
            });
            return;
        }
        if (['مين', 'انت مين', 'مين انت'].includes(normalizedBody)) {
            await respondWithStrictTiming('🥚', async () => {
                await currentConn.sendMessage(from, { text: `أنا بوت (${botName}) في خدمتك يا نجم! 🐤✨` }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'اععع') {
            await respondWithStrictTiming('🤢', async () => {
                await currentConn.sendMessage(from, { text: 'مش ناقصه ترجيع بقي🐤' }, { quoted: mek });
            });
            return;
        }
        if (['خلصا', 'خلصانه'].includes(normalizedBody)) {
            await respondWithStrictTiming('❤️', async () => {
                await currentConn.sendMessage(from, { text: 'حبيب اخوك ❤️' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'اخويا') {
            await respondWithStrictTiming('❤️', async () => {
                await currentConn.sendMessage(from, { text: 'قلب اخوك❤️' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'ودي يا فنان') {
            await respondWithStrictTiming('❤️', async () => {
                await currentConn.sendMessage(from, { text: 'قلب الفنان ❤️' }, { quoted: mek });
            });
            return;
        }
        if (['ودي', 'وديي', 'ودييي', 'وديييي'].includes(normalizedBody)) {
            await respondWithStrictTiming('💫', async () => {
                await currentConn.sendMessage(from, { text: 'اديلو يا فنانن 💫🐤' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody.includes('طرش')) {
            await respondWithStrictTiming('👂', async () => {
                await currentConn.sendMessage(from, { text: 'انت اطرش يابا🐤😂' }, { quoted: mek });
            });
            return;
        }
        if (normalizedBody === 'عاش') {
            await respondWithStrictTiming('❤️', async () => {
                await currentConn.sendMessage(from, { text: 'حبييي❤️' }, { quoted: mek });
            });
            return;
        }

        // 🛑 فحص الشتائم ككلمة مفردة ومطابقة تماماً
        if (isExactShatema) {
            dynamicState[sender] = 'waiting_for_shatema_clarification';
            await respondWithStrictTiming('🤨', async () => {
                await currentConn.sendMessage(from, { text: 'انا ولا مين' }, { quoted: mek });
            });
            return;
        }



    } catch (err) {
        console.log('خطأ في معالجة مفسر الرسائل داخل handler.js:', err);
    }
}

