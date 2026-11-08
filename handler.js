import fs from 'fs';
import path from 'path'; // 🛑 استيراد ملفات الألعاب والـ Plugins المساعدة
import gameTicTacToe from './plugins/game-ttt.js';
import gameGuess from './plugins/game-guess.js';
import gameSaraha from './plugins/game-saraha.js';
import gameFootball from './plugins/game-football.js';
import gameBakasa from './plugins/game-bakasa.js';
import gamePuzzle from './plugins/puzzle.js';
import gameMovies from './plugins/game-movies.js';
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
    updateSubBotHajj,
    updateSubBotMainOwner,
    formatGenderText,
    activeSubBots,
    subBotSentMsgIds,
    broadcastUpdateToSubBots
} from './core/subbot.js';

// 💤 خريطة حفظ حالة وتوقيت النوم المعزولة لكل بوت (سواء الأساسي أو الفرعي)
const botSleepMap = new Map();
const botWakeTimeMap = new Map();
// 🤫 خريطة كتم الصوت المعزولة (اسكت / اتكلم) لكل بوت
const botMuteMap = new Map();

// 💾 ملف حفظ واسترجاع حالات التحكم (نام / اصحي / اسكت / اتكلم) عبر التحديثات والريستارت
const CONTROLS_FILE = path.join(process.cwd(), 'runtime_controls.json');

function loadRuntimeControls() {
    try {
        if (fs.existsSync(CONTROLS_FILE)) {
            const raw = fs.readFileSync(CONTROLS_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data.botSleep && typeof data.botSleep === 'object') {
                for (const [k, v] of Object.entries(data.botSleep)) {
                    if (v) botSleepMap.set(k, true);
                }
            }
            if (data.botMute && typeof data.botMute === 'object') {
                for (const [k, v] of Object.entries(data.botMute)) {
                    if (v) botMuteMap.set(k, true);
                }
            }
            if (data.botWakeTime && typeof data.botWakeTime === 'object') {
                for (const [k, v] of Object.entries(data.botWakeTime)) {
                    if (typeof v === 'number') botWakeTimeMap.set(k, v);
                }
            }
        }
    } catch (err) {
        console.error('⚠️ خطأ في قراءة ملف runtime_controls.json:', err?.message || err);
    }
}

function saveRuntimeControls() {
    try {
        const sleepObj = {};
        for (const [k, v] of botSleepMap.entries()) {
            if (v) sleepObj[k] = true;
        }
        const muteObj = {};
        for (const [k, v] of botMuteMap.entries()) {
            if (v) muteObj[k] = true;
        }
        const wakeObj = {};
        for (const [k, v] of botWakeTimeMap.entries()) {
            if (typeof v === 'number') wakeObj[k] = v;
        }

        const data = {
            botSleep: sleepObj,
            botMute: muteObj,
            botWakeTime: wakeObj,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(CONTROLS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('⚠️ خطأ في حفظ ملف runtime_controls.json:', err?.message || err);
    }
}

function setRoomSleep(roomKey) {
    botSleepMap.set(roomKey, true);
    saveRuntimeControls();
}

function setRoomMute(roomKey) {
    botMuteMap.set(roomKey, true);
    botSleepMap.delete(roomKey);
    saveRuntimeControls();
}

function clearRoomState(roomKey) {
    botSleepMap.delete(roomKey);
    botMuteMap.delete(roomKey);
    botWakeTimeMap.set(roomKey, Math.floor(Date.now() / 1000));
    saveRuntimeControls();
}

// استرجاع حالات النوم والكتم فوراً عند تشغيل أو تحديث البوت
loadRuntimeControls();

function extractContextInfo(mek) {
    if (!mek?.message) return null;
    let msg = mek.message;
    if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
    if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
    if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
    if (msg.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;

    return msg.extendedTextMessage?.contextInfo ||
           msg.imageMessage?.contextInfo ||
           msg.videoMessage?.contextInfo ||
           msg.stickerMessage?.contextInfo ||
           msg.documentMessage?.contextInfo ||
           msg.audioMessage?.contextInfo ||
           msg.contactMessage?.contextInfo ||
           null;
}

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
        let textLower = body.toLowerCase().trim();
        if (!textLower) return;

        let normalizedBody = normalizeArabic(textLower);
        mek.text = textLower;
        
        // 👑 المالك المطلق (الحج شادو الحقيقي الأصلي)
        const ownerPhone = '201129249396';
        const ownerLid = '194961618301016';
        const ownerAltPhone = '201229409956';
        let localDB = loadLocalDB();

        // 🏷️ استخراج اسم البوت وإعدادات البوت الفرعي (Sub-Bot) بأعلى دقة وشمولية
        let myNumber = currentConn.user?.id?.split(':')[0]?.replace(/[^0-9]/g, '') || '';
        let subBotConfig = currentConn.subBotConfig || null;
        let botName = currentConn.botName || 'شادو';

        if (currentConn.subBotPhone) {
            currentConn.isSubBot = true;
            if (!myNumber) myNumber = currentConn.subBotPhone;
        }

        if (!subBotConfig) {
            const registry = loadSubBotsRegistry();
            if (myNumber && registry[myNumber]) {
                subBotConfig = registry[myNumber];
            } else if (currentConn.subBotPhone && registry[currentConn.subBotPhone]) {
                subBotConfig = registry[currentConn.subBotPhone];
            } else {
                for (const [p, cfg] of Object.entries(registry)) {
                    if (p === myNumber || cfg.phone === myNumber || (myNumber && p.endsWith(myNumber))) {
                        subBotConfig = cfg;
                        break;
                    }
                }
            }
            if (!subBotConfig && myNumber) {
                const subConfigPath = path.join(process.cwd(), 'sessions', 'sub_bots', myNumber, 'config.json');
                if (fs.existsSync(subConfigPath)) {
                    try { subBotConfig = JSON.parse(fs.readFileSync(subConfigPath, 'utf8')); } catch (_) {}
                }
            }
        }

        if (subBotConfig) {
            currentConn.subBotConfig = subBotConfig;
            currentConn.isSubBot = true;
            if (subBotConfig.botName) botName = subBotConfig.botName;
            if (subBotConfig.callName) currentConn.callName = subBotConfig.callName;
        }

        // 🔍 تحديث خريطة الـ LID من أعضاء الجروب تلقائياً لتجاوز قيود تشفير واتساب للـ LID
        if (isRealGroup && (sender.endsWith('@lid') || cleanSender.length > 13)) {
            try {
                const groupMeta = await currentConn.groupMetadata(from).catch(() => null);
                if (groupMeta && groupMeta.participants) {
                    let mapUpdated = false;
                    if (!localDB.lidMap) localDB.lidMap = {};
                    for (const p of groupMeta.participants) {
                        const pPhone = cleanPhoneNumber(p.id?.split('@')[0]?.split(':')[0]);
                        const pLid = p.lid?.split('@')[0]?.split(':')[0]?.replace(/[^0-9]/g, '');
                        if (pPhone && pLid) {
                            if (localDB.lidMap[pPhone] !== pLid || localDB.lidMap[pLid] !== pPhone) {
                                localDB.lidMap[pPhone] = pLid;
                                localDB.lidMap[pLid] = pPhone;
                                mapUpdated = true;
                            }
                        }
                    }
                    if (mapUpdated) saveLocalDB(localDB);
                }
            } catch (_) {}
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

        // صاحب البوت الفرعي هو الحج الأساسي على بوته فقط (فحص شامل بالرقم الدولي والمحلي وLID ومعرف JID وسجل المشرفين)
        let isSubBotAdmin = false;
        let isSubBotMainOwner = false;
        let isSubBotHajj = false;
        if (subBotConfig) {
            const adminPhone = cleanPhoneNumber(subBotConfig.adminPhone) || subBotConfig.adminPhone || '';
            const adminLocalPhone = (adminPhone.startsWith('201') && adminPhone.length === 12) ? ('01' + adminPhone.slice(2)) : '';
            const adminLid = subBotConfig.adminLid ? String(subBotConfig.adminLid).replace(/[^0-9]/g, '') : '';
            const senderCleanPhone = cleanPhoneNumber(cleanSender);
            const mappedSender = localDB.lidMap?.[cleanSender] || '';
            const mappedSenderClean = cleanPhoneNumber(mappedSender);
            const adminNumbers = Array.isArray(subBotConfig.adminNumbers) ? subBotConfig.adminNumbers : [];

            // 1. فحص هل هو المالك الأساسي للبوت الفرعي
            if (
                (adminPhone && (cleanSender === adminPhone || senderCleanPhone === adminPhone)) ||
                (adminLocalPhone && (cleanSender === adminLocalPhone || senderCleanPhone === adminLocalPhone)) ||
                (adminLid && (cleanSender === adminLid || sender.startsWith(adminLid))) ||
                (mappedSender && (mappedSender === adminPhone || mappedSender === adminLid || mappedSenderClean === adminPhone || mappedSender === adminLocalPhone)) ||
                (subBotConfig.adminJid && sender === subBotConfig.adminJid) ||
                adminNumbers.includes(cleanSender) ||
                adminNumbers.includes(senderCleanPhone) ||
                adminNumbers.includes(sender) ||
                (mappedSender && adminNumbers.includes(mappedSender))
            ) {
                isSubBotAdmin = true;
                isSubBotMainOwner = true;
                // إذا كان المرسل هو الحج وعنده LID لم يكن مسجلاً في subBotConfig، نحدثه فوراً
                if (sender.endsWith('@lid') || cleanSender.length > 13) {
                    if (!subBotConfig.adminLid || subBotConfig.adminLid !== cleanSender) {
                        subBotConfig.adminLid = cleanSender;
                        if (!subBotConfig.adminNumbers.includes(cleanSender)) subBotConfig.adminNumbers.push(cleanSender);
                        if (!subBotConfig.adminNumbers.includes(`${cleanSender}@lid`)) subBotConfig.adminNumbers.push(`${cleanSender}@lid`);
                        
                        const subPhone = subBotConfig.phone || myNumber;
                        const sessionDir = path.join(process.cwd(), 'sessions', 'sub_bots', subPhone);
                        if (fs.existsSync(sessionDir)) {
                            try { fs.writeFileSync(path.join(sessionDir, 'config.json'), JSON.stringify(subBotConfig, null, 2), 'utf8'); } catch (_) {}
                        }
                        const reg = loadSubBotsRegistry();
                        if (reg[subPhone]) {
                            reg[subPhone].adminLid = cleanSender;
                            reg[subPhone].adminNumbers = subBotConfig.adminNumbers;
                            saveSubBotsRegistry(reg);
                        }
                        if (adminPhone) {
                            if (!localDB.lidMap) localDB.lidMap = {};
                            localDB.lidMap[adminPhone] = cleanSender;
                            localDB.lidMap[cleanSender] = adminPhone;
                            saveLocalDB(localDB);
                        }
                    }
                }
            }

            // فحص إضافي: إذا كان المرسل عبر LID ولم يتم التعرف عليه وكان مسجلاً في خريطة الـ LID
            if (!isSubBotMainOwner && (sender.endsWith('@lid') || cleanSender.length > 13) && adminPhone) {
                if (localDB.lidMap?.[cleanSender] === adminPhone || localDB.lidMap?.[cleanSender] === adminLocalPhone || localDB.lidMap?.[adminPhone] === cleanSender) {
                    isSubBotAdmin = true;
                    isSubBotMainOwner = true;
                }
            }

            // 2. فحص هل هو أحد الحجاج المرفوعين في هذا البوت الفرعي
            if (!isSubBotAdmin) {
                const subHajjs = subBotConfig.subHajjUsers || [];
                const subAdmins = subBotConfig.adminNumbers || [];
                if (
                    subHajjs.includes(cleanSender) ||
                    subHajjs.includes(senderCleanPhone) ||
                    (mappedSender && subHajjs.includes(mappedSender)) ||
                    subAdmins.includes(cleanSender) ||
                    subAdmins.includes(senderCleanPhone) ||
                    (mappedSender && subAdmins.includes(mappedSender))
                ) {
                    isSubBotAdmin = true;
                    isSubBotHajj = true;
                }
            }
        }

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
        mek.isSubBotMainOwner = isSubBotMainOwner;
        mek.isSubBotHajj = isSubBotHajj;
        mek.isBotOwner = isBotOwner;
        currentConn.botName = botName;
        currentConn.callName = botCallName;
        currentConn.isSubBot = Boolean(subBotConfig);
        currentConn.subBotConfig = subBotConfig;

        // ⏱️ دالة التوقيت الصارمة للحماية من حظر واتساب (محاكاة حركة بشرية)
        const respondWithStrictTiming = async (reactChar, actionFunction) => {
            await delay(2500);
            try {
                if (reactChar) await currentConn.sendMessage(from, { react: { text: reactChar, key: mek.key } });
            } catch (e) {}
            await delay(3000);
            await actionFunction();
        };

        // 🔑 المعرف الثابت الموحد للبوت وللجروب
        const botIdKey = currentConn.isSubBot 
            ? (cleanPhoneNumber(subBotConfig?.phone || currentConn.subBotPhone || myNumber) || 'sub') 
            : 'main_bot';
        const roomKey = `${botIdKey}_${from}`;

        // 👑 تحديد المسموح له بالتحكم بالنوم والصمت:
        // في البوت الأساسي: شادو فقط (isAbsoluteOwner)
        // في البوت الفرعي: شادو (isAbsoluteOwner) أو مالك البوت الفرعي (isSubBotMainOwner) أو الحجاج المرفوعين فيه (isSubBotHajj)
        const isSleepOwner = currentConn.isSubBot
            ? (isAbsoluteOwner || isSubBotMainOwner || isSubBotHajj)
            : isAbsoluteOwner;

        // 🤫 1. فحص هل الجروب في وضع الصمت التام (اسكت / اخرس 100%)
        const isCurrentRoomMuted = botMuteMap.get(roomKey) || false;
        if (isCurrentRoomMuted) {
            // البوت صامت 100% ولا يرد على أي شخص في هذا الجروب نهائياً (حتى للمالك وشادو)
            // الاستثناء الحصري الوحيد: أمر فك الكتم (اتكلم أو اصحي) من المالك أو شادو
            const isUnmute = isSleepOwner && (
                normalizedBody === 'اتكلم' ||
                normalizedBody === 'اصحي' ||
                normalizedBody === `اتكلم ${normalizedBotName}` ||
                normalizedBody === `اتكلم يا ${normalizedBotName}` ||
                normalizedBody === `اصحي ${normalizedBotName}` ||
                normalizedBody === `اصحي يا ${normalizedBotName}` ||
                (normalizedCallName && (
                    normalizedBody === `اتكلم ${normalizedCallName}` || 
                    normalizedBody === `اتكلم يا ${normalizedCallName}` ||
                    normalizedBody === `اصحي ${normalizedCallName}` ||
                    normalizedBody === `اصحي يا ${normalizedCallName}`
                )) ||
                (isAbsoluteOwner && (normalizedBody === 'اتكلم الكل' || normalizedBody === 'اتكلمو' || normalizedBody === 'اصحي الكل' || normalizedBody === 'اصحو'))
            );

            if (isUnmute) {
                const isWakeAll = isAbsoluteOwner && (normalizedBody === 'اتكلم الكل' || normalizedBody === 'اتكلمو' || normalizedBody === 'اصحي الكل' || normalizedBody === 'اصحو');
                if (isWakeAll) {
                    clearRoomState(roomKey);
                    clearRoomState(`main_bot_${from}`);
                    try {
                        const reg = loadSubBotsRegistry();
                        for (const p of Object.keys(reg)) {
                            const cp = cleanPhoneNumber(p);
                            if (cp) clearRoomState(`${cp}_${from}`);
                        }
                    } catch (_) {}
                } else {
                    clearRoomState(roomKey);
                }
                await respondWithStrictTiming('🗣️', async () => {
                    await currentConn.sendMessage(from, { text: `🗣️ *أمرك يا حج! تم فك كتم الصوت عن (${botName}) في هذا الجروب. رجعت أرد وأشتغل بكامل طاقتي!* ⚡` }, { quoted: mek });
                });
                return;
            }

            // صمت تام ولا يرد نهائياً!
            return;
        }

        // 🤫 2. أمر كتم الصوت التام في هذا الجروب (اسكت / اخرس / صمت)
        if (isSleepOwner && (normalizedBody.startsWith('اسكت') || normalizedBody.startsWith('اخرس') || normalizedBody.startsWith('صمت'))) {
            const isMuteAll = isAbsoluteOwner && (normalizedBody === 'اسكت الكل' || normalizedBody === 'اسكتو' || normalizedBody === 'اخرسو');
            const isNamedMute = normalizedBody === 'اسكت' || normalizedBody === 'اخرس' || normalizedBody === 'صمت' ||
                                normalizedBody === `اسكت ${normalizedBotName}` || 
                                normalizedBody === `اسكت يا ${normalizedBotName}` ||
                                (normalizedCallName && (normalizedBody === `اسكت ${normalizedCallName}` || normalizedBody === `اسكت يا ${normalizedCallName}`));

            if (isMuteAll || isNamedMute) {
                if (isMuteAll) {
                    setRoomMute(roomKey);
                    setRoomMute(`main_bot_${from}`);
                    try {
                        const reg = loadSubBotsRegistry();
                        for (const p of Object.keys(reg)) {
                            const cp = cleanPhoneNumber(p);
                            if (cp) setRoomMute(`${cp}_${from}`);
                        }
                    } catch (_) {}
                } else {
                    setRoomMute(roomKey);
                }
                await respondWithStrictTiming('🤫', async () => {
                    await currentConn.sendMessage(from, { 
                        text: `🤫 *أمرك يا حج! تم كتم صوت بوت (${botName}) بالكامل في ${isRealGroup ? 'هذا الجروب' : 'هذه المحادثة'} فقط.* 🤐\nلن يستجيب لأي شخص أو أي رسالة نهائياً (حتى لك شخصياً) حتى ترسل: (اتكلم) أو (اصحي) هنا.\n✨ _البوت ما زال يعمل بكامل طاقته في باقي المحادثات!_` 
                    }, { quoted: mek });
                });
                return;
            }
        }

        // 💤 3. أمر تفعيل وضع النوم (نام / خمول / وضع الخمول) في هذا الجروب فقط
        const isGeneralSleepCmd = ['نام', 'وضع الخمول', 'ايقاف مؤقت', 'خمول'].includes(normalizedBody);
        const isNamedSleepCmd = (
            normalizedBody === `نام ${normalizedBotName}` || 
            normalizedBody === `نام يا ${normalizedBotName}` ||
            normalizedBody === `خمول ${normalizedBotName}` ||
            (normalizedCallName && (
                normalizedBody === `نام ${normalizedCallName}` ||
                normalizedBody === `نام يا ${normalizedCallName}` ||
                normalizedBody === `خمول ${normalizedCallName}`
            )) ||
            (isAbsoluteOwner && (normalizedBody === 'نام الكل' || normalizedBody === 'نامو'))
        );

        if (isSleepOwner && (isGeneralSleepCmd || isNamedSleepCmd)) {
            // لو الأمر موجه لبوت آخر بالتحديد، يتجاهله
            if (!isNamedSleepCmd && normalizedBody.startsWith('نام ') && !normalizedBody.includes(normalizedBotName) && (!normalizedCallName || !normalizedBody.includes(normalizedCallName))) {
                return;
            }

            const isSleepAll = isAbsoluteOwner && (normalizedBody === 'نام الكل' || normalizedBody === 'نامو');
            if (isSleepAll) {
                setRoomSleep(roomKey);
                setRoomSleep(`main_bot_${from}`);
                try {
                    const reg = loadSubBotsRegistry();
                    for (const p of Object.keys(reg)) {
                        const cp = cleanPhoneNumber(p);
                        if (cp) setRoomSleep(`${cp}_${from}`);
                    }
                } catch (_) {}
            } else {
                setRoomSleep(roomKey);
            }
            const masterTitle = isAbsoluteOwner ? 'يا حج شادو' : 'يا صاحب البوت';
            await respondWithStrictTiming('💤', async () => {
                await currentConn.sendMessage(from, { 
                    text: `💤 *أمرك ${masterTitle}! تم تفعيل وضع النوم لبوت (${botName}) في ${isRealGroup ? 'هذا الجروب' : 'هذه المحادثة'} فقط!* 🌙\n` +
                          `البوت الآن نائم وصامت عن باقي الأعضاء، لكنه مستيقظ ويرد عليك فقط في أي وقت.\n` +
                          `💡 لإيقاظه للجميع أرسل: (اصحي).\n` +
                          `✨ _البوت ما زال يعمل بكامل طاقته في باقي المحادثات!_` 
                }, { quoted: mek });
            });
            return;
        }

        // ⚡ 4. أمر استيقاظ البوت وعودته للعمل للجميع (اصحي / استيقظ / تشغيل)
        const isGeneralWakeCmd = ['اصحي', 'استيقظ', 'تشغيل', 'الغاء الخمول', 'قوم', 'اتكلم'].includes(normalizedBody);
        const isNamedWakeCmd = (
            normalizedBody === `اصحي ${normalizedBotName}` || 
            normalizedBody === `اصحي يا ${normalizedBotName}` ||
            normalizedBody === `اتكلم ${normalizedBotName}` ||
            normalizedBody === `اتكلم يا ${normalizedBotName}` ||
            normalizedBody === `تشغيل ${normalizedBotName}` ||
            normalizedBody === `قوم ${normalizedBotName}` ||
            (normalizedCallName && (
                normalizedBody === `اصحي ${normalizedCallName}` ||
                normalizedBody === `اصحي يا ${normalizedCallName}` ||
                normalizedBody === `اتكلم ${normalizedCallName}` ||
                normalizedBody === `اتكلم يا ${normalizedCallName}` ||
                normalizedBody === `تشغيل ${normalizedCallName}` ||
                normalizedBody === `قوم ${normalizedCallName}`
            )) ||
            (isAbsoluteOwner && (normalizedBody === 'اصحي الكل' || normalizedBody === 'اصحو' || normalizedBody === 'اتكلم الكل' || normalizedBody === 'اتكلمو'))
        );

        if (isSleepOwner && (isGeneralWakeCmd || isNamedWakeCmd)) {
            if (!isNamedWakeCmd && normalizedBody.startsWith('اصحي ') && !normalizedBody.includes(normalizedBotName) && (!normalizedCallName || !normalizedBody.includes(normalizedCallName))) {
                return;
            }

            const isWakeAll = isAbsoluteOwner && (normalizedBody === 'اصحي الكل' || normalizedBody === 'اصحو' || normalizedBody === 'اتكلم الكل' || normalizedBody === 'اتكلمو');
            if (isWakeAll) {
                clearRoomState(roomKey);
                clearRoomState(`main_bot_${from}`);
                try {
                    const reg = loadSubBotsRegistry();
                    for (const p of Object.keys(reg)) {
                        const cp = cleanPhoneNumber(p);
                        if (cp) clearRoomState(`${cp}_${from}`);
                    }
                } catch (_) {}
                await respondWithStrictTiming('⚡', async () => {
                    await currentConn.sendMessage(from, { text: `⚡ *صباح الفل يا حج! تم استيقاظ (${botName}) في ${isRealGroup ? 'هذا الجروب' : 'هذه المحادثة'} وعاد للعمل بكامل طاقته للجميع!* 🚀🔥` }, { quoted: mek });
                });
                return;
            }

            const wasSleeping = botSleepMap.get(roomKey) || false;
            const wasMuted = botMuteMap.get(roomKey) || false;

            if (wasSleeping || wasMuted) {
                clearRoomState(roomKey);

                await respondWithStrictTiming('⚡', async () => {
                    await currentConn.sendMessage(from, { text: `⚡ *صباح الفل يا حج! تم استيقاظ (${botName}) في هذا الجروب وعاد للعمل بكامل طاقته للجميع!* 🚀🔥` }, { quoted: mek });
                });
                return;
            }
        }

        // 💤 5. فحص وضع النوم: إذا كان البوت نائماً في هذا الجروب
        const isCurrentRoomSleeping = botSleepMap.get(roomKey) || false;
        if (isCurrentRoomSleeping) {
            // البوت نائم عن العامة فقط في هذا الجروب!
            // ولا يرد على أي شخص نهائياً إلا صاحب البوت أو شادو:
            if (!isSleepOwner) {
                // أي شخص آخر (مشرفين، حجاج، أعضاء): البوت نائم ويتجاهله تماماً بصمت!
                return;
            }
            // إذا كان المرسل هو المالك المصرح له: يكمل وينفذ كل طلباته كالمعتاد!
        }

        // ⏰ فحص توقيت الاستيقاظ لهذا الجروب: تجاهل أي رسائل أُرسلت أثناء فترة نوم البوت بعد استيقاظه
        const lastWakeTime = botWakeTimeMap.get(roomKey);
        if (lastWakeTime && !isSleepOwner) {
            const mTime = getMsgTimestamp(mek);
            if (mTime > 0 && mTime < lastWakeTime) {
                return;
            }
        }

        // 🚫 فحص حظر المستخدم
        if (isUserBanned(sender, localDB) && !isAbsoluteOwner) return;

        // =========================================================================
        // 🤖 [اسم المناداة والنداء وتوجيه الأوامر للبوت المستهدف]
        // =========================================================================
        const subBotsRegistry = loadSubBotsRegistry();
        const otherBotNames = [];
        const otherCallNames = [];
        for (const [p, info] of Object.entries(subBotsRegistry)) {
            if (p !== myNumber) {
                if (info.botName) otherBotNames.push(normalizeArabic(info.botName.toLowerCase().trim()));
                if (info.callName) otherCallNames.push(normalizeArabic(info.callName.toLowerCase().trim()));
            }
        }
        if (currentConn.isSubBot) {
            otherBotNames.push('شادو');
            otherCallNames.push('شادو');
        }

        // 💫 الرد على "بوت" أو "يا بوت" (اسمي كذا يا نجم)
        if (normalizedBody === 'بوت' || normalizedBody === 'يا بوت') {
            const currentTime = Date.now();
            const isFemale = (currentConn.gender === 'female' || currentConn.subBotConfig?.gender === 'female');
            const starTitle = isFemale ? 'يا نجم/ة 🐤💫' : 'يا نجم 🐤💫';
            await respondWithStrictTiming('💫', async () => {
                if (lastBotTime[sender] && (currentTime - lastBotTime[sender] > 120000)) {
                    botCounter[sender] = 0;
                }
                if (!botCounter[sender]) botCounter[sender] = 0;
                botCounter[sender]++;
                lastBotTime[sender] = currentTime;
                if (botCounter[sender] >= 5) {
                    await currentConn.sendMessage(from, { text: `خلاص يا حبيبي/حبيبتي قولنا ${botName}` }, { quoted: mek });
                } else {
                    await currentConn.sendMessage(from, { text: `اسمي ${botName} ${starTitle}` }, { quoted: mek });
                }
            });
            return;
        }

        // 1️⃣ فحص هل الرسالة مجرد نداء بالاسم فقط (رد التحية والمساعدة)
        const isCallingMyName = (
            (normalizedBody !== 'بوت' && normalizedBody !== 'يا بوت') &&
            (
                (normalizedCallName && normalizedCallName !== 'بوت' && (normalizedBody === normalizedCallName || normalizedBody === `يا ${normalizedCallName}`)) ||
                (normalizedBotName !== 'بوت' && (normalizedBody === normalizedBotName || normalizedBody === `يا ${normalizedBotName}`)) ||
                (!currentConn.isSubBot && (normalizedBody === 'شادو' || normalizedBody === 'يا شادو'))
            )
        );

        if (isCallingMyName) {
            const isFemale = (currentConn.gender === 'female' || currentConn.subBotConfig?.gender === 'female');
            const fananTitle = isFemale ? 'يا فنان/ة اتفضل/ي يا حبيبي/حبيبتي اؤمر/ي❤️' : 'يا فنان اتفضل يا حبيبي اامر❤️';
            await respondWithStrictTiming('✨', async () => {
                await currentConn.sendMessage(from, { text: `تحت امرك ${fananTitle}` }, { quoted: mek });
            });
            return;
        }

        // 2️⃣ فحص هل الرسالة تبدأ باسم نداء هذا البوت ومتبوعة بأمر (مثلاً: زيزو بنك / يا زيزو منيو / الرعد روليت 500)
        let matchedPrefix = null;
        const myPrefixes = [];
        if (normalizedCallName) {
            myPrefixes.push(`يا ${normalizedCallName} `, `${normalizedCallName} `);
        }
        myPrefixes.push(`يا ${normalizedBotName} `, `${normalizedBotName} `);
        if (!currentConn.isSubBot) {
            myPrefixes.push('يا شادو ', 'شادو ');
        }

        for (const pfx of myPrefixes) {
            if (normalizedBody.startsWith(pfx)) {
                matchedPrefix = pfx;
                break;
            }
        }

        if (matchedPrefix) {
            // تم نداء هذا البوت بالتحديد: نقوم بقص اسم النداء لتمرير الأمر مباشرة للبوت
            normalizedBody = normalizedBody.slice(matchedPrefix.length).trim();
            textLower = textLower.slice(matchedPrefix.length).trim();
            mek.text = textLower;
        } else {
            // 3️⃣ فحص هل الرسالة موجهة صراحةً لبوت آخر في نفس الروم/النظام؟
            const isCallingOtherBot = otherCallNames.concat(otherBotNames).filter(Boolean).some(otherName => {
                return (
                    normalizedBody === otherName ||
                    normalizedBody === `يا ${otherName}` ||
                    normalizedBody.startsWith(otherName + ' ') ||
                    normalizedBody.startsWith(`يا ${otherName} `)
                );
            });

            if (isCallingOtherBot) {
                // الرسالة موجهة صراحةً لبوت آخر: هذا البوت يتجاهلها بصمت حتى يرد البوت المطلوب فقط!
                return;
            }
        }


        // =========================================================================
        // 🚪 [أمر خروج البوت من الجروب (اخرج [الاسم] / اخرج / غادر)]
        // =========================================================================
        if (isRealGroup) {
            let specifiedLeaveName = '';
            let isLeaveCmd = false;
            const leaveRegex1 = /^(?:اخرج|غادر|خروج)(?:\s+(?:يا\s+)?(.+))?$/i;
            const leaveRegex2 = /^(?:يا\s+)?(.+?)\s+(?:اخرج|غادر|خروج)$/i;

            let matchL1 = normalizedBody.match(leaveRegex1);
            let matchL2 = normalizedBody.match(leaveRegex2);

            if (matchL1) {
                isLeaveCmd = true;
                if (matchL1[1]) specifiedLeaveName = normalizeArabic(matchL1[1].replace(/^يا\s+/, '').trim().toLowerCase());
            } else if (matchL2) {
                isLeaveCmd = true;
                if (matchL2[1]) specifiedLeaveName = normalizeArabic(matchL2[1].replace(/^يا\s+/, '').trim().toLowerCase());
            }

            if (isLeaveCmd) {
                if (!isBotOwner) return;

                const matchesThisBot = (
                    specifiedLeaveName === normalizedBotName || 
                    (normalizedCallName && specifiedLeaveName === normalizedCallName) || 
                    specifiedLeaveName === 'الكل' ||
                    (!currentConn.isSubBot && (specifiedLeaveName === 'شادو' || specifiedLeaveName === 'الرئيسي'))
                );

                // مالك البوت الفرعي
                if (isSubBotAdmin && !isAbsoluteOwner) {
                    if (specifiedLeaveName && !matchesThisBot) return;

                    await respondWithStrictTiming('👋', async () => {
                        await currentConn.sendMessage(from, { text: `👋 *بأمر من الحج المالك.. جاري مغادرة بوت (${botName}) للمجموعة الآن! في رعاية الله.* 🤖✨` }, { quoted: mek });
                    });
                    setTimeout(async () => {
                        try { await currentConn.groupLeave(from); } catch (e) {}
                    }, 2000);
                    return;
                }

                // الحج شادو الأصلي
                if (isAbsoluteOwner) {
                    if (specifiedLeaveName) {
                        if (!matchesThisBot) return;

                        await respondWithStrictTiming('👋', async () => {
                            await currentConn.sendMessage(from, { text: `👋 *أمرك يا حج شادو.. جاري مغادرة بوت (${botName}) للمجموعة فوراً! في رعاية الله.* 🤖✨` }, { quoted: mek });
                        });
                        setTimeout(async () => {
                            try { await currentConn.groupLeave(from); } catch (e) {}
                        }, 2000);
                        return;
                    } else {
                        let botsInRoom = [];
                        try {
                            const groupMeta = await currentConn.groupMetadata(from).catch(() => null);
                            if (groupMeta && groupMeta.participants) {
                                const partNums = groupMeta.participants.map(p => p.id.split('@')[0].split(':')[0]);
                                const mainPhone = '201129249396';
                                if (partNums.includes(mainPhone) || partNums.includes(myNumber)) {
                                    botsInRoom.push({ name: 'شادو (البوت الرئيسي)', call: 'شادو', num: mainPhone });
                                }
                                const registry = loadSubBotsRegistry();
                                for (let p in registry) {
                                    if (partNums.includes(p) && p !== mainPhone) {
                                        botsInRoom.push({ 
                                            name: registry[p].botName || 'بوت فرعي', 
                                            call: registry[p].callName || registry[p].botName || p, 
                                            num: p 
                                        });
                                    }
                                }
                            }
                        } catch (_) {}

                        if (botsInRoom.length > 1) {
                            const isPrimary = !currentConn.isSubBot || myNumber === '201129249396';
                            if (isPrimary) {
                                await respondWithStrictTiming('❓', async () => {
                                    let listBots = botsInRoom.map((b, i) => `${i + 1}️⃣ *${b.name}* (اسم النداء: \`${b.call}\`)`).join('\n');
                                    const askMsg = 
                                        `❓ *عايز تخرج أنهو بوت يا حج شادو؟* 🤖🚪\n\n` +
                                        `📍 *البوتات الموجودة في الروم:* \n${listBots}\n\n` +
                                        `💡 *لتحديد البوت المطلوب، اكتب:*\n*(اخرج [اسم البوت أو اسم النداء])*\nمثال:\n` +
                                        `• \`اخرج شادو\`\n` +
                                        `• \`اخرج ${botsInRoom[1]?.call || 'اسم النداء'}\``;
                                    await currentConn.sendMessage(from, { text: askMsg }, { quoted: mek });
                                });
                            }
                            return;
                        }

                        // بوت واحد فقط في الروم
                        await respondWithStrictTiming('👋', async () => {
                            await currentConn.sendMessage(from, { text: `👋 *أمرك يا حج شادو.. جاري مغادرة بوت (${botName}) للمجموعة الآن! في رعاية الله.* 🤖✨` }, { quoted: mek });
                        });
                        setTimeout(async () => {
                            try { await currentConn.groupLeave(from); } catch (e) {}
                        }, 2000);
                        return;
                    }
                }
            }
        }

        // 🛡️ تشغيل ملف الإدارة للخاص والجروبات
        let handledByAdmin = false;
        if (datelsHandler && typeof datelsHandler.before === 'function') {
            handledByAdmin = await datelsHandler.before(mek, currentConn);
        } else if (datelsHandler?.default && typeof datelsHandler.default.before === 'function') {
            handledByAdmin = await datelsHandler.default.before(mek, currentConn);
        }
        if (handledByAdmin) return;
        
        const now = Date.now();

        // =========================================================================
        // 🤖 [نظام التنصيب التفاعلي للبوتات الفرعية (Sub-Bots / JadiBot)]
        // =========================================================================

        // 🗑️ فحص وجود تأكيد معلق لحذف بوت فرعي للحج شادو وسؤاله قبل إرسال الإشعار
        if (isAbsoluteOwner && global.pendingSubBotDelete && global.pendingSubBotDelete.has(cleanSender)) {
            const pendingDel = global.pendingSubBotDelete.get(cleanSender);
            // مهلة التأكيد: 3 دقائق
            if (Date.now() - pendingDel.time > 3 * 60 * 1000) {
                global.pendingSubBotDelete.delete(cleanSender);
            } else {
                const normAns = normalizedBody.trim();
                const isYes = ['نعم', 'اه', 'ايوه', 'ايوة', '1', 'ارسل', 'ابعت', 'بلغ'].includes(normAns);
                const isNo = ['لا', 'لأ', 'بدون', 'بدون اشعار', '2', 'متبعتش'].includes(normAns);
                const isCancel = ['الغاء', 'إلغاء', 'خروج', 'stop', 'cancel', '3'].includes(normAns);

                if (isYes || isNo) {
                    global.pendingSubBotDelete.delete(cleanSender);
                    const shouldNotify = isYes;
                    const res = await deleteSubBotRemote(pendingDel.phone, currentConn, shouldNotify);
                    await respondWithStrictTiming('🗑️', async () => {
                        await currentConn.sendMessage(from, { text: res.message }, { quoted: mek });
                    });
                    return;
                } else if (isCancel) {
                    global.pendingSubBotDelete.delete(cleanSender);
                    await respondWithStrictTiming('❌', async () => {
                        await currentConn.sendMessage(from, { text: `❌ تم إلغاء عملية حذف البوت الفرعي (+${pendingDel.phone}).` }, { quoted: mek });
                    });
                    return;
                }
            }
        }

        // 1. فحص وجود عملية تنصيب جارية لهذا المستخدم (تتم حصرياً في الخاص)
        const cleanFrom = getCleanNumber(from);
        const installKey = installState.has(cleanSender) ? cleanSender : (installState.has(cleanFrom) ? cleanFrom : null);

        if (installKey) {
            const currentInstall = installState.get(installKey);

            // التحقق من انتهاء مهلة الجلسة (10 دقائق)
            if (Date.now() - (currentInstall.createdAt || 0) > 10 * 60 * 1000) {
                installState.delete(installKey);
                installState.delete(cleanSender);
                installState.delete(cleanFrom);
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
                    // إزالة علامات التنسيق من الأطراف فقط مع الحفاظ على كل الزخارف والتشكيل والرموز والإيموجي
                    const chosenName = body.trim().replace(/^[*_~`]+|[*_~`]+$/g, '').trim().slice(0, 60);
                    if (!chosenName || chosenName.length < 1) {
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
                    const chosenCall = body.trim().replace(/^[*_~`]+|[*_~`]+$/g, '').trim().slice(0, 40);
                    if (!chosenCall || chosenCall.length < 1) {
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
                        `3️⃣ *حدد جنس وهوية البوت (ذكر أم أنثى)؟*\n` +
                        `• أرسل رقم *(1)* أو اكتب *(ذكر)*: البوت يتكلم بصيغة المذكر (ولد) 👦\n` +
                        `• أرسل رقم *(2)* أو اكتب *(أنثى)*: البوت يتكلم بصيغة المؤنث (بنت) 👧\n\n` +
                        `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

                    await respondWithStrictTiming('👤', async () => {
                        await currentConn.sendMessage(from, { text: step3Text }, { quoted: mek });
                    });
                    return;
                }

                // الخطوة 3: تحديد جنس البوت (ذكر أم أنثى)
                if (currentInstall.step === 3) {
                    let chosenGender = '';
                    if (['1', 'ذكر', 'ولد', 'مذكر', 'راجل', 'رجل'].includes(normalizedBody)) {
                        chosenGender = 'male';
                    } else if (['2', 'انثى', 'أنثى', 'بنت', 'مؤنث', 'ست'].includes(normalizedBody)) {
                        chosenGender = 'female';
                    } else {
                        await respondWithStrictTiming('⚠️', async () => {
                            await currentConn.sendMessage(from, { text: '⚠️ برجاء الاختيار بالأرقام أو الكلمات:\n1️⃣ للذكر (ولد) 👦\n2️⃣ للأنثى (بنت) 👧' }, { quoted: mek });
                        });
                        return;
                    }

                    currentInstall.step = 4;
                    currentInstall.gender = chosenGender;
                    installState.set(cleanSender, currentInstall);

                    const step4Text = 
                        `✅ *تم تحديد جنس البوت:* « ${chosenGender === 'female' ? 'أنثى 👧' : 'ذكر 👦'} »\n\n` +
                        `4️⃣ *حدد شخصية وأسلوب البوت في الشات والردود:*\n` +
                        `• أرسل رقم *(1)* أو اكتب *(محترم)*: بوت مهذب وراقي، بفلتر شتائم ورقابة صارمة ومبيقولش أي ألفاظ 😇✨\n` +
                        `• أرسل رقم *(2)* أو اكتب *(قليل الادب)*: بوت سرسجي ومسخرة، مفيهوش أي فلتر شتائم، بيرد ويشتم ومفتوح على البحري بدون أي قيود! 😈🔥\n\n` +
                        `⚠️ *تنبيه وإخلاء مسؤولية هامة:* ⚠️\n` +
                        `اختيار بوت (قليل الأدب) يجعله ينطق ويشتم بأقسى الألفاظ والشتائم بدون قيود، وقد يعرض رقم هاتفك للبلاغات والحظر من شركة واتساب! إدارة البوت غير مسؤولة تماماً عن حظر أي رقم يختار هذه الشخصية.\n\n` +
                        `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

                    await respondWithStrictTiming('🎭', async () => {
                        await currentConn.sendMessage(from, { text: step4Text }, { quoted: mek });
                    });
                    return;
                }

                // الخطوة 4: تحديد شخصية البوت (محترم أم قليل الأدب)
                if (currentInstall.step === 4) {
                    let chosenPersonality = '';
                    if (['1', 'محترم', 'مؤدب', 'راقي', 'مؤدبين'].includes(normalizedBody)) {
                        chosenPersonality = 'respectful';
                    } else if (['2', 'قليل الادب', 'قليل ادب', 'قليل أدب', 'سرسجي', 'مسخره', 'مسخرة', 'بيشتم'].includes(normalizedBody)) {
                        chosenPersonality = 'bad';
                    } else {
                        await respondWithStrictTiming('⚠️', async () => {
                            await currentConn.sendMessage(from, { text: '⚠️ برجاء الاختيار بالأرقام أو الكلمات:\n1️⃣ محترم (بفلتر شتائم وردود مهذبة) 😇✨\n2️⃣ قليل الأدب (سرسجي ومفتوح بدون قيود) 😈🔥\n\n⚠️ ملاحظة: اختيار (قليل الأدب) على مسؤوليتك الشخصية تجنباً لحظر رقمك من واتساب.' }, { quoted: mek });
                        });
                        return;
                    }

                    currentInstall.step = 5;
                    currentInstall.personality = chosenPersonality;
                    installState.set(cleanSender, currentInstall);

                    const step5Text = 
                        `✅ *تم تحديد شخصية البوت:* « ${chosenPersonality === 'bad' ? 'قليل الأدب 😈🔥 (على مسؤوليتك الكاملة)' : 'محترم 😇✨'} »\n\n` +
                        `5️⃣ *ما هو رقم الهاتف الذي تريد تشغيله كـ (بوت) وربطه بالكود؟*\n` +
                        `• اكتب رقم الهاتف الذي سيصبح بوتاً (مثال: 01012345678 أو 201012345678)\n` +
                        `• أو اكتب *(رقمي)* إذا كان هذا الرقم الذي تراسلني منه هو نفسه الذي تريد تحويله لبوت.\n\n` +
                        `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

                    await respondWithStrictTiming('📱', async () => {
                        await currentConn.sendMessage(from, { text: step5Text }, { quoted: mek });
                    });
                    return;
                }

                // الخطوة 5: رقم هاتف البوت
                if (currentInstall.step === 5) {
                    let targetBotPhone = '';
                    const isSelf = ['رقمي', 'نفسه', 'نفس الرقم', 'نفس رقمي', 'حسابي', 'ده', 'انا', 'أنا'].includes(normalizedBody);
                    if (isSelf) {
                        let resolved = '';
                        if (!sender.endsWith('@lid') && cleanSender.length <= 13) {
                            resolved = cleanSender;
                        } else if (localDB.lidMap?.[cleanSender]) {
                            resolved = localDB.lidMap[cleanSender];
                        } else if (from.endsWith('@s.whatsapp.net')) {
                            resolved = getCleanNumber(from);
                        } else if (mek.key?.remoteJid?.endsWith('@s.whatsapp.net')) {
                            resolved = getCleanNumber(mek.key.remoteJid);
                        }
                        targetBotPhone = cleanPhoneNumber(resolved);
                        if (!targetBotPhone || targetBotPhone.length < 10) {
                            await respondWithStrictTiming('⚠️', async () => {
                                await currentConn.sendMessage(from, { 
                                    text: '⚠️ حسابك يظهر برمز مشفر داخل واتساب (LID) تعذر استخراج رقم الشريحة منه تلقائياً لاستخراج كود الاقتران!\nبرجاء كتابة رقم هاتف البوت بالأرقام (مثال: 01012345678 أو 201012345678):' 
                                }, { quoted: mek });
                            });
                            return;
                        }
                    } else {
                        targetBotPhone = cleanPhoneNumber(body);
                    }

                    if (!targetBotPhone || targetBotPhone.length < 10) {
                        await respondWithStrictTiming('⚠️', async () => {
                            await currentConn.sendMessage(from, { text: '❌ هذا الرقم غير صالح!\nبرجاء كتابة رقم هاتف البوت بشكل صحيح (مثال: 01012345678 أو 201012345678)\nأو اكتب (رقمي) لاستخدام رقمك الحالي:' }, { quoted: mek });
                        });
                        return;
                    }

                    currentInstall.step = 6;
                    currentInstall.targetPhone = targetBotPhone;
                    installState.set(cleanSender, currentInstall);

                    const step6Text = 
                        `✅ *تم تحديد رقم البوت:* « +${targetBotPhone} » 📱\n\n` +
                        `6️⃣ *من هو الحج الأساسي (المالك والمتحكم الكامل بالبوت)؟*\n` +
                        `• اكتب رقم الحج الأساسي مع كود الدولة (مثال: 01012345678 أو 201012345678)\n` +
                        `• أو اكتب كلمة *(رقمي)* أو *(نفسي)* لتعيين نفسك أنت الحج الأساسي لهذا البوت!\n\n` +
                        `❌ للإلغاء في أي وقت اكتب: (الغاء)`;

                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { text: step6Text }, { quoted: mek });
                    });
                    return;
                }

                // الخطوة 6: رقم الحج الأساسي والتعرف على LID وإطلاق كود الربط
                if (currentInstall.step === 6) {
                    let adminPhone = '';
                    let adminLid = '';

                    const isSelf = ['رقمي', 'نفسي', 'نفسه', 'انا', 'أنا', 'نفس الرقم', 'حسابي', 'ده', 'نفس'].includes(normalizedBody);

                    if (isSelf) {
                        let candidatePhone = '';
                        if (!sender.endsWith('@lid') && cleanSender.length <= 13) {
                            candidatePhone = cleanSender;
                        } else if (localDB.lidMap?.[cleanSender]) {
                            candidatePhone = localDB.lidMap[cleanSender];
                        } else if (from.endsWith('@s.whatsapp.net')) {
                            candidatePhone = getCleanNumber(from);
                        } else if (mek.key?.remoteJid?.endsWith('@s.whatsapp.net')) {
                            candidatePhone = getCleanNumber(mek.key.remoteJid);
                        }

                        if (sender.endsWith('@lid') || cleanSender.length > 13) {
                            adminLid = cleanSender;
                        }

                        if (candidatePhone) {
                            adminPhone = cleanPhoneNumber(candidatePhone);
                        } else {
                            adminPhone = cleanSender;
                            adminLid = cleanSender;
                        }
                    } else {
                        const ctx = mek.message?.extendedTextMessage?.contextInfo;
                        const bodyDigits = body.replace(/[^0-9]/g, '');
                        let rawAdmin = '';

                        // 1. أولوية عليا: إذا كتب المستخدم أرقاماً في نص الرسالة، فهذا هو رقم الحج المطلوب تعيينه
                        if (bodyDigits.length >= 8) {
                            rawAdmin = bodyDigits;
                        } else if (ctx?.mentionedJid && ctx.mentionedJid.length > 0) {
                            // 2. إذا قام بعمل منشن لشخص
                            rawAdmin = ctx.mentionedJid[0];
                        } else if (ctx?.participant) {
                            // 3. إذا اقتبس رسالة شخص آخر (مع التأكد أنها ليست رسالة البوت نفسه)
                            const myId = currentConn.user?.id?.split(':')[0]?.replace(/[^0-9]/g, '');
                            const partNum = ctx.participant.split(':')[0]?.replace(/[^0-9]/g, '');
                            if (partNum && partNum !== myId && partNum !== '201229409956') {
                                rawAdmin = ctx.participant;
                            } else {
                                rawAdmin = body;
                            }
                        } else {
                            rawAdmin = body;
                        }

                        let cleaned = cleanPhoneNumber(rawAdmin) || getCleanNumber(rawAdmin);
                        adminPhone = cleaned;
                        adminLid = localDB.lidMap?.[cleaned] || '';
                    }

                    if (!adminPhone || adminPhone.length < 5) {
                        await respondWithStrictTiming('⚠️', async () => {
                            await currentConn.sendMessage(from, { 
                                text: '❌ تعذر التعرف على هوية أو رقم الحج الأساسي!\nبرجاء كتابة الرقم بالأرقام (مثال: 01012345678 أو 201012345678)\nأو اكتب كلمة (رقمي) أو (نفسي) لتعيين حسابك الحالي:' 
                            }, { quoted: mek });
                        });
                        return;
                    }

                    // استخراج الـ LID بطريقة سريعة مع مهلة مناسبة لتجنب أي تعليق
                    if (!adminLid && adminPhone.length <= 13) {
                        try {
                            const lidPromise = (async () => {
                                const waCheck = await currentConn.onWhatsApp(`${adminPhone}@s.whatsapp.net`);
                                if (waCheck && waCheck[0]?.lid) {
                                    return waCheck[0].lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                                }
                                return '';
                            })();
                            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(''), 2500));
                            adminLid = await Promise.race([lidPromise, timeoutPromise]);
                        } catch (_) {}
                    }

                    // إذا كان الحج هو نفس القائم بالتنصيب
                    if (!adminLid && (cleanSender === adminPhone || cleanPhoneNumber(cleanSender) === adminPhone)) {
                        if (sender.endsWith('@lid') || cleanSender.length > 13) {
                            adminLid = cleanSender;
                        }
                    }

                    if (adminPhone && adminLid) {
                        localDB.lidMap[adminPhone] = adminLid;
                        localDB.lidMap[adminLid] = adminPhone;
                        saveLocalDB(localDB);
                    }

                    const finalBotName = currentInstall.botName || 'بوت فرعي';
                    const finalCallName = currentInstall.callName || finalBotName;
                    const finalBotGender = currentInstall.gender || 'male';
                    const finalBotPersonality = currentInstall.personality || 'respectful';
                    const finalBotPhone = currentInstall.targetPhone;
                    installState.delete(installKey);
                    installState.delete(cleanSender);
                    installState.delete(cleanFrom);

                    await respondWithStrictTiming('⏳', async () => {
                        await currentConn.sendMessage(from, { 
                            text: `⏳ *جاري تجهيز الخادم وإنشاء كود الربط لبوتك (${finalBotName} - نداء: ${finalCallName})...*\n👤 الجنس: ${finalBotGender === 'female' ? 'أنثى 👧' : 'ذكر 👦'}\n🎭 الشخصية: ${finalBotPersonality === 'bad' ? 'قليل الأدب 😈🔥' : 'محترم 😇✨'}\n📱 رقم البوت: +${finalBotPhone}\n👑 الحج الأساسي: +${adminPhone}${adminLid ? ` (ID: ${adminLid})` : ''}\nبرجاء الانتظار بضع ثوانٍ ⚡` 
                        }, { quoted: mek });
                    });

                    // تشغيل كود الاقتران فوراً مع التقاط أي استثناء
                    requestSubBotPairing(finalBotPhone, finalBotName, finalCallName, adminPhone, adminLid, finalBotGender, finalBotPersonality, currentConn, from, mek).catch(err => {
                        console.error('⚠️ [Pairing Execution Error]:', err?.message || err);
                    });
                    return;
                }
            }
        }

        // 2. أمر بدء التنصيب
        if (['تنصيب', '.تنصيب', 'تنصيب بوت', 'بوت فرعي', 'جديد بوت', 'jadibot'].includes(normalizedBody)) {
            // توجيه مستخدمي البوتات الفرعية للبوت الأساسي فوراً
            if (currentConn.isSubBot) {
                const subBotNotice = 
                    `⚠️ *عفواً يا فنان/ة! التنصيب متاح حصرياً من البوت الأساسي (شادو بوت)!* 👑🤖\n\n` +
                    `📱 *رقم البوت الأساسي:*\n` +
                    `+201229409956\n` +
                    `🔗 *رابط الشات المباشر مع البوت الأساسي:*\n` +
                    `https://wa.me/201229409956\n\n` +
                    `✨ *طريقة التنصيب:*\n` +
                    `1️⃣ افتح الرابط واكتب للبوت الأساسي كلمة *(تنصيب)*.\n` +
                    `2️⃣ اتبع خطوات التنصيب (اسم البوت، ذكر أو أنثى، شخصية محترمة أو قليلة الأدب، ورقمك).\n` +
                    `3️⃣ هيوصلك كود الاقتران تربط بيه ويكون معاك بوتك الخاص مجاناً! 🚀`;

                await respondWithStrictTiming('⚠️', async () => {
                    await currentConn.sendMessage(from, { text: subBotNotice }, { quoted: mek });
                });
                return;
            }

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
            if (cleanFrom) installState.set(cleanFrom, { step: 1, createdAt: Date.now() });

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
                `• لحذف بوت نهائياً: *(حذف تنصيب <رقم_البوت>)*\n` +
                `• لإذاعة تحديث للبوتات: *(اذاعة للبوتات <الرسالة>)*`;

            await respondWithStrictTiming('📊', async () => {
                await currentConn.sendMessage(from, { text: dashText }, { quoted: mek });
            });
            return;
        }

        // 📢 [أمر إذاعة ونشر التحديثات لجميع البوتات الفرعية - للحج شادو الأصلي حصرياً]
        const isBroadcastCmd = 
            /^(?:\.|\/)?([إا]+ذاع[هة]|نشر|[إا]+علان|تحديث)\s*(للبوتات|للبوت|للبوتات الفرعي[هة])/i.test(body) ||
            /^(?:\.|\/)?([إا]+ذاع[هة]|نشر|[إا]+علان|تحديث)\s*(للبوتات|للبوت|للبوتات الفرعي[هة])/i.test(normalizedBody) ||
            normalizedBody.startsWith('اذاعه للبوتات') ||
            normalizedBody.startsWith('اذاعة للبوتات') ||
            normalizedBody.startsWith('إذاعة للبوتات') ||
            normalizedBody.startsWith('نشر للبوتات') ||
            normalizedBody.startsWith('اعلان للبوتات') ||
            normalizedBody.startsWith('تحديث للبوتات');

        if (isBroadcastCmd) {
            if (!isAbsoluteOwner) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي (المتحكم المطلق)! 👑' }, { quoted: mek });
                });
                return;
            }

            const broadcastText = body
                .replace(/^(?:\.|\/)?([إا]+ذاع[هة]|نشر|[إا]+علان|تحديث)\s*(للبوتات|للبوت|للبوتات الفرعي[هة]|الفرعية)\s*/i, '')
                .replace(/^(اذاعة للبوتات|اذاعه للبوتات|إذاعة للبوتات|نشر للبوتات|اعلان للبوتات|إعلان للبوتات|تحديث للبوتات)\s*/i, '')
                .trim();

            if (!broadcastText) {
                const helpText = 
                    `📢 *طريقة الإذاعة لجميع أصحاب البوتات الفرعية:* 👑\n\n` +
                    `• اكتب: *اذاعة للبوتات [الرسالة أو الإعلان أو التحديث الجديد]*\n` +
                    `• مثال: *اذاعة للبوتات تم إضافة أمر (صوره) بالذكاء الاصطناعي لرسم أي فكرة!*\n\n` +
                    `⚡ سيقوم البوت بإرسال الإشعار فوراً في الخاص لجميع الحجاج أصحاب البوتات الفرعية المسجلة.`;
                await respondWithStrictTiming('ℹ️', async () => {
                    await currentConn.sendMessage(from, { text: helpText }, { quoted: mek });
                });
                return;
            }

            await respondWithStrictTiming('⏳', async () => {
                await currentConn.sendMessage(from, { text: '⏳ جاري إرسال الإذاعة والتحديث لجميع أصحاب البوتات الفرعية... برجاء الانتظار ثوانٍ.' }, { quoted: mek });
            });

            const formattedMsg = 
                `📢 *رسالة وإعلان هام من إدارة شادو بوت الأساسي* 👑\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `${broadcastText}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `✨ *مع تحيات الحج شادو وإدارة البوت.*`;

            const result = await broadcastUpdateToSubBots(currentConn, formattedMsg);

            const reportMsg = 
                `╭━━━〔 📢 *تقرير إذاعة البوتات الفرعية* 〕━━━╮\n` +
                `┃ 🤖 *إجمالي البوتات الفرعية:* ${result.total}\n` +
                `┃ ✅ *تم الإرسال بنجاح إلى:* ${result.sentCount}\n` +
                `┃ ❌ *فشل الإرسال إلى:* ${result.failedCount}\n` +
                `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
                `🎉 ${result.message}`;

            await currentConn.sendMessage(from, { text: reportMsg }, { quoted: mek });
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

        // =========================================================================
        // 👑 [أمر تعيين وتغيير الحج الأساسي للبوت الفرعي دون الحاجة لإعادة التنصيب]
        // =========================================================================
        if (normalizedBody.startsWith('تعيين حج ') || normalizedBody.startsWith('تغيير حج ') || normalizedBody.startsWith('نقل ملكية البوت ')) {
            const isAuthorized = isAbsoluteOwner || (currentConn.isSubBot && isSubBotMainOwner);
            if (!isAuthorized) {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي أو لمالك البوت (الحج الأساسي)! 👑' }, { quoted: mek });
                });
                return;
            }

            const ctx = mek.message?.extendedTextMessage?.contextInfo;
            const parts = body.replace(/^(تعيين حج|تغيير حج|نقل ملكية البوت)\s*/i, '').trim().split(/\s+/);
            let botTarget = '';
            let newAdminTarget = '';

            if (currentConn.isSubBot) {
                botTarget = myNumber || currentConn.subBotPhone || (subBotConfig?.phone);
                newAdminTarget = ctx?.mentionedJid?.[0] || parts[0];
            } else {
                if (parts.length >= 2) {
                    botTarget = parts[0];
                    newAdminTarget = ctx?.mentionedJid?.[0] || parts[1];
                } else {
                    await respondWithStrictTiming('⚠️', async () => {
                        await currentConn.sendMessage(from, { 
                            text: '⚠️ طريقة الاستخدام الصحيحة:\n*(تعيين حج <رقم_البوت> <رقم_الحج_الجديد>)*\nمثال:\n(تعيين حج 201011111111 201022222222)' 
                        }, { quoted: mek });
                    });
                    return;
                }
            }

            const cleanBot = cleanPhoneNumber(botTarget);
            const cleanNewAdmin = cleanPhoneNumber(newAdminTarget);

            if (!cleanBot || !cleanNewAdmin) {
                await respondWithStrictTiming('⚠️', async () => {
                    await currentConn.sendMessage(from, { text: '❌ تعذر استخراج أرقام صحيحة للبوت والحج. يرجى التأكد من كتابة الأرقام بشكل صحيح.' }, { quoted: mek });
                });
                return;
            }

            let newLid = '';
            try {
                const waCheck = await currentConn.onWhatsApp(`${cleanNewAdmin}@s.whatsapp.net`);
                if (waCheck && waCheck[0]?.lid) {
                    newLid = waCheck[0].lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                }
            } catch (_) {}

            const updated = updateSubBotMainOwner(cleanBot, cleanNewAdmin, newLid);
            if (updated) {
                await respondWithStrictTiming('👑', async () => {
                    await currentConn.sendMessage(from, { 
                        text: `👑 *تم بنجاح تعيين الحج الأساسي الجديد!* ⚡\n🤖 *رقم البوت:* +${cleanBot}\n👤 *الحج الجديد:* +${cleanNewAdmin}${newLid ? ` (ID: ${newLid})` : ''}\n✨ أصبح لديه التحكم الكامل بهذا البوت الآن!` 
                    }, { quoted: mek });
                });
            } else {
                await respondWithStrictTiming('❌', async () => {
                    await currentConn.sendMessage(from, { text: `❌ لم يتم العثور على بوت فرعي مسجل بالرقم: +${cleanBot}` }, { quoted: mek });
                });
            }
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
                    await deleteSubBotRemote(myNumber, currentConn, false);

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
                await deleteSubBotRemote(userBotPhone, currentConn, false);
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

            const cleanTarget = cleanPhoneNumber(targetPhone);
            const registry = loadSubBotsRegistry();
            const botData = registry[cleanTarget] || null;
            const targetBotName = botData?.botName || cleanTarget;

            // إذا حدد الحج خياره مباشرة مع الأمر (مثال: حذف تنصيب 201012345678 نعم أو لا)
            const remaining = body.replace(/^(حذف تنصيب|الغاء تنصيب|إلغاء تنصيب)\s*/i, '').replace(targetPhone, '').trim();
            const normRem = normalizeArabic(remaining);
            if (['نعم', 'اه', 'ايوه', '1', 'ارسل', 'ابعت', 'بلغ'].includes(normRem)) {
                const res = await deleteSubBotRemote(cleanTarget, currentConn, true);
                await respondWithStrictTiming('🗑️', async () => {
                    await currentConn.sendMessage(from, { text: res.message }, { quoted: mek });
                });
                return;
            } else if (['لا', 'لأ', 'بدون', '2', 'متبعتش'].includes(normRem)) {
                const res = await deleteSubBotRemote(cleanTarget, currentConn, false);
                await respondWithStrictTiming('🗑️', async () => {
                    await currentConn.sendMessage(from, { text: res.message }, { quoted: mek });
                });
                return;
            }

            // سؤال المالك أولاً للتأكيد وتخييره بين إرسال إشعار التحديث أو الحذف في صمت
            if (!global.pendingSubBotDelete) global.pendingSubBotDelete = new Map();
            global.pendingSubBotDelete.set(cleanSender, {
                phone: cleanTarget,
                botName: targetBotName,
                time: Date.now()
            });

            const askText = 
                `🗑️ *تأكيد حذف البوت الفرعي (+${cleanTarget}):* ⚠️\n` +
                `🏷️ اسم البوت: *${targetBotName}*\n\n` +
                `هل تريد إرسال إشعار لصاحب البوت بأنه تم حذفه لإجراء تحديثات جديدة؟\n\n` +
                `1️⃣ اكتب: *نعم* ➔ لحذف البوت وإرسال رسالة التحديث لصاحبه.\n` +
                `2️⃣ اكتب: *لا* ➔ لحذف البوت في صمت تام دون إرسال أي رسالة.\n` +
                `3️⃣ اكتب: *الغاء* ➔ لإلغاء عملية الحذف.`;

            await respondWithStrictTiming('❓', async () => {
                await currentConn.sendMessage(from, { text: askText }, { quoted: mek });
            });
            return;
        }

        // مصفوفة الشتائم الموحدة والتعابير النمطية المتقدمة للكشف عن الشتائم
        const curseWords = [
            'كسمك', 'كسم', 'كسختك', 'كسامك', 'كسمكم', 'كسمكوا', 'كسمينك', 'كسمين امك',
            'خول', 'خولة', 'يا خول', 'معرص', 'معرصة', 'عرص', 'عرصة', 'يا عرص', 'يا معرص',
            'متناك', 'متناكة', 'يا متناك', 'يا متناكة',
            'منيوك', 'منيوكة', 'يا منيوك', 'منيكة',
            'شرموط', 'شرموطة', 'يا شرموط', 'يا شرموطة', 'شرمطة',
            'قحبة', 'يا قحبة',
            'بضان', 'يا بضان', 'انت بضان', 'مبضون', 'تبضن', 'ابضن',
            'عبيط', 'يا عبيط', 'اهبل', 'يا اهبل', 'جزمه', 'يا جزمه', 'عره', 'يا عره',
            'زاني', 'زانية', 'كلب', 'يا كلب', 'ابن الكلب', 'وسخ', 'وسخة', 'يا وسخ', 'يا وسخة', 'ابن الوسخة',
            'انيك', 'انيكك', 'نيكو', 'نيك', 'اركبك',
            'زباله', 'يا زبالة', 'دمج', 'يا دمج', 'حيوان', 'يا حيوان', 'ابن الحيوان',
            'قليل الادب', 'متربتش', 'حقير', 'يا حقير', 'واطي', 'يا واطي', 'نجس', 'يا نجس',
            'طيز', 'طيزك', 'زب', 'كس', 'كسك',
            'حمار', 'يا حمار', 'بغل', 'يا بغل', 'طور', 'يا طور',
            'يلعن', 'يلعنك', 'يلعن ميتينك', 'يلعن ابوك', 'يلعن امك', 'يلعن دينك', 'انعل',
            'غور', 'كول خرا', 'كل خرا', 'خرا'
        ];

        const curseRegex = /(كسم|كسخت|كسام|متناك|متناكه|منيوك|منيوكه|منيك|خول|خوله|عرص|عرصه|معرص|معرصه|شرموط|شرموطه|شرمط|قحب|قحبه|بضان|مبضون|تبضن|ابضن|عبيط|اهبل|جزمه|عره|زاني|كلب|وسخ|وسخه|انيك|انيكك|اركبك|نيك|زباله|حيوان|متربتش|حقير|دمج|طيز|طيزك|زب|نجس|واطي|يلعن|انعل|كول\s*خرا|كل\s*خرا|ابن\s*(الكلب|الوسخ|الوسخه|المتناك|المتناكه|الشرموط|الشرموطه|الحيوان|القحبه|الزانيه|الهبله)|يا\s*(ابن|كلب|خول|عرص|معرص|متناك|شرموط|وسخ|بضان|منيوك|حمار|حيوان|واطي|نجس|قذر|زباله|عبيط|اهبل|جزمه|عره|شحات))/i;

        const isExactShatema = curseWords.includes(normalizedBody);
        const isCursePresent = isExactShatema || 
            curseWords.some(w => normalizedBody.includes(w)) || 
            curseRegex.test(normalizedBody) ||
            curseRegex.test(textLower);

        const isBadPersonality = Boolean(
            currentConn.personality === 'bad' || 
            currentConn.subBotConfig?.personality === 'bad' || 
            subBotConfig?.personality === 'bad'
        );

        // استخراج بيانات الرد والمنشن للتأكد هل الشتيمة موجهة للبوت تحديداً أم للأعضاء
        const ctxInfo = extractContextInfo(mek);
        const quotedParticipant = ctxInfo?.participant || '';
        const quotedClean = getCleanNumber(quotedParticipant);
        const stanzaId = ctxInfo?.stanzaId || '';

        // بناء قائمة بكل المعرفات الممكنة للبوت الحالي (أرقام تليفون، LIDs، سجلات)
        const thisBotIdentities = new Set();
        if (myNumber) thisBotIdentities.add(myNumber);
        if (currentConn.user?.id) {
            const uPhone = currentConn.user.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (uPhone) thisBotIdentities.add(uPhone);
        }
        if (currentConn.user?.lid) {
            const uLid = currentConn.user.lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (uLid) thisBotIdentities.add(uLid);
        }
        if (subBotConfig?.phone) {
            const sPhone = cleanPhoneNumber(subBotConfig.phone);
            if (sPhone) thisBotIdentities.add(sPhone);
        }
        if (currentConn.subBotPhone) {
            const sPhone = cleanPhoneNumber(currentConn.subBotPhone);
            if (sPhone) thisBotIdentities.add(sPhone);
        }
        if (myNumber && localDB?.lidMap?.[myNumber]) {
            thisBotIdentities.add(String(localDB.lidMap[myNumber]).replace(/[^0-9]/g, ''));
        }
        if (localDB?.lidMap) {
            for (const [phone, lid] of Object.entries(localDB.lidMap)) {
                if (thisBotIdentities.has(phone)) thisBotIdentities.add(String(lid).replace(/[^0-9]/g, ''));
                if (thisBotIdentities.has(lid)) thisBotIdentities.add(String(phone).replace(/[^0-9]/g, ''));
            }
        }

        const isQuotedToMe = (quotedClean && thisBotIdentities.has(quotedClean)) ||
            (Boolean(stanzaId) && (
                (currentConn.sentMsgIds && currentConn.sentMsgIds.has(stanzaId)) ||
                (subBotSentMsgIds && subBotSentMsgIds.has(stanzaId)) ||
                (global.botSentMsgIds && global.botSentMsgIds.has(stanzaId))
            )) ||
            (Boolean(ctxInfo?.quotedMessage) && !isRealGroup);

        const mentionedJids = ctxInfo?.mentionedJid || [];
        const isMentioned = mentionedJids.some(jid => {
            const cleanJid = getCleanNumber(jid);
            return cleanJid && thisBotIdentities.has(cleanJid);
        });

        const hasBotKeyword = normalizedBody.includes('بوت') || 
            (botName && normalizedBody.includes(normalizeArabic(botName.toLowerCase()))) || 
            (botCallName && normalizedBody.includes(normalizeArabic(botCallName.toLowerCase())));

        // الشتيمة موجهة للبوت إذا كان ريبلاي عليه، أو منشن له، أو كتب اسم البوت مع الشتيمة، أو في الخاص
        const isCurseTargetingBot = isCursePresent && (isQuotedToMe || isMentioned || hasBotKeyword || !isRealGroup);

        // 🔥 لو البوت قليل الأدب ووصله شتيمة موجهة له (ريبلاي عليه أو منشن أو مع كلمة بوت): يشتم ويرد بقسوة!
        // استثناء: الحج شادو أو صاحب البوت الفرعي (أبوه) مبيشتمهمش وبيقولهم عشان انت ابويا مسموحلك
        if (isBadPersonality) {
            if (isCurseTargetingBot) {
                const isFather = isAbsoluteOwner || isSubBotMainOwner || (currentConn.isSubBot && isSubBotAdmin);
                if (isFather) {
                    const isFemale = (subBotConfig?.gender === 'female' || currentConn.gender === 'female');
                    const fatherReply = isFemale ? 
                        'عشان انت/ي ابويا/امي ف مسموحلك ومش هرد عليك 👑❤️' : 
                        'عشان انت ابويا ف مسموحلك ومش هرد عليك 👑❤️';
                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { text: fatherReply }, { quoted: mek });
                    });
                    return;
                }

                // لو أي شخص تاني شتمه: يقصفه ويشتمه بأقسى الردود!
                const savageReplies = [
                    'كسمك انت يابن المتناكة 🖕🔥',
                    'غور يا كسمك من هنا يلا بدل ما افشخك 🤬🖕',
                    'امك عارفة انك خول كده في الشاتات؟ 🖕😂',
                    'ملكش دعوة بيا يا عيل بضان يلا طير 🖕😏',
                    'شكلك عايز تتهان وتاخد على قفاك يا ابن الشرموطة 🖕🔥',
                    'كسمك على كسم اللي يزعلك يا خول 🖕😈',
                    'يلا يا ابن المتناكة من هنا متصدعناش 🖕',
                    'انت مالك يا منيوك هو حد كلمك؟ 🖕🤬',
                    'ياض يا عرص احترم نفسك بدل ما اركبك 🖕🔥',
                    'عيل مهزء وبضان كسم شكلك 🖕🤣',
                    'بتشتم مين يا ابن الوسخة انت ناسي نفسك؟ 🖕⚡',
                    'طب كسمك ليل ونهار يا روح امك 🖕😏'
                ];
                const chosenReply = savageReplies[Math.floor(Math.random() * savageReplies.length)];
                await respondWithStrictTiming('🖕', async () => {
                    await currentConn.sendMessage(from, { text: chosenReply }, { quoted: mek });
                });
                return;
            } else if (isCursePresent) {
                // الشتيمة مش موجهة للبوت (بين الأعضاء وبعض): يتجاهلها تماماً ولا يرد!
                return;
            }
        }

        // 🛡️ [نظام الفلتر والتكرار وحظر الكلمات للأعضاء]
        if (!isHajj && !isBadPersonality) {
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
            const isFemale = (subBotConfig?.gender === 'female');
            const isFather = isAbsoluteOwner || isSubBotMainOwner || (currentConn.isSubBot && isSubBotAdmin);
            let reply = '';
            if (isFather) {
                reply = isFemale ? 'عشان انت/ي ابويا/امي ف مسموحلك ومش هرد عليك 👑❤️' : 'عشان انت ابويا ف مسموحلك ومش هرد عليك 👑❤️';
            } else {
                reply = isFemale ? 'عشان انت/ي الحج/ة بس.. ف مسموحلك 👑👑❤️' : 'عشان انت الحج بس.. ف مسموحلك 👑👑❤️';
            }
            await respondWithStrictTiming('👑', async () => {
                await currentConn.sendMessage(from, { text: reply }, { quoted: mek });
            });
            return;
        }

        if (['metzaalsh', 'متزعلش', 'metzaalsh meny', 'خلاص متزعلش'].includes(normalizedBody)) {
            const isFemale = (subBotConfig?.gender === 'female');
            if (isAbsoluteOwner) {
                const reply = isFemale ? 'مقدرش ازعل من بابا/ماما الحج/ة حبيب/ة قلبي ❤️👑' : 'مقدرش ازعل من بابا الحج حبيب قلبي ❤️👑';
                await respondWithStrictTiming('❤️', async () => {
                    await currentConn.sendMessage(from, { text: reply }, { quoted: mek });
                });
                return;
            } else if (isHajj) {
                const reply = isFemale ? 'مقدرش ازعل من حبايب بابا/ماما الحج/ة شادو ❤️👑' : 'مقدرش ازعل من حبايب بابا الحج شادو ❤️👑';
                await respondWithStrictTiming('❤️', async () => {
                    await currentConn.sendMessage(from, { text: reply }, { quoted: mek });
                });
                return;
            }
        }

        // 👶 [أمر ابني / بنتي للبوتات الفرعية والأساسي]
        const isFemaleSubBot = (currentConn.isSubBot && (currentConn.gender === 'female' || subBotConfig?.gender === 'female'));
        const lowerBotName = (botName || 'شادو').toLowerCase().trim();

        // أوامر النداء للبوت الأنثى الفرعي (بنتي) وللبوت الذكر/الأساسي (ابني)
        const isDaughterCmd = isFemaleSubBot && [
            'بنتي', 'يا بنتي', `${lowerBotName} بنتي`, `بنتي ${lowerBotName}`,
            'ابني', 'يا ابني', `${lowerBotName} ابني`, `ابني ${lowerBotName}`
        ].includes(normalizedBody);

        const isSonCmd = !isFemaleSubBot && [
            'ابني', 'يا ابني', `${lowerBotName} ابني`, `ابني ${lowerBotName}`
        ].includes(normalizedBody);

        if (isDaughterCmd || isSonCmd) {
            if (isFemaleSubBot) {
                // ردود البوت الأنثى الفرعي (بنتي)
                if (isAbsoluteOwner) {
                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { text: 'بنتك وحبيبتك يا بابا الحج ونور عيني 👑❤️' }, { quoted: mek });
                    });
                } else if (isSubBotMainOwner) {
                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { text: 'بنتك وحبيبتك ونور عينك يابا ❤️👑' }, { quoted: mek });
                    });
                } else if (isSubBotHajj || isHajj) {
                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { 
                            text: `انت عمي بس ابويا صاحب البوت (+${subBotConfig?.adminPhone || 'المالك'}) والحج شادو 👑❤️` 
                        }, { quoted: mek });
                    });
                } else {
                    await respondWithStrictTiming('👧', async () => {
                        await currentConn.sendMessage(from, { 
                            text: 'ابوك مين يا نجم؟ انا بنوتة صاحب البوت والحج شادو 👑❤️' 
                        }, { quoted: mek });
                    });
                }
            } else {
                // ردود البوت الذكر وشادو الأساسي (ابني)
                if (isAbsoluteOwner) {
                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { text: 'حبيبي يا بابا الحج ونور عيني 👑❤️' }, { quoted: mek });
                    });
                } else if (isSubBotMainOwner) {
                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { text: 'حبيبي ونور عيني يابا ❤️👑' }, { quoted: mek });
                    });
                } else if (isSubBotHajj || isHajj) {
                    await respondWithStrictTiming('👑', async () => {
                        await currentConn.sendMessage(from, { 
                            text: `انت عمي بس ابويا صاحب البوت (+${subBotConfig?.adminPhone || 'المالك'}) والحج شادو 👑❤️` 
                        }, { quoted: mek });
                    });
                } else {
                    await respondWithStrictTiming('🐤', async () => {
                        await currentConn.sendMessage(from, { 
                            text: 'ابوك مين يا حبيبي؟ ابويا هو صاحب البوت والحج شادو 👑❤️' 
                        }, { quoted: mek });
                    });
                }
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
        let moviesAnswered = false;
        if (gameMovies) {
            if ((currentConn.movies && currentConn.movies[from]) || ['شرح لعبة افلام', 'شرح افلام', 'كيف لعب افلام', 'تلميح افلام', 'تلميح فيلم', 'انسحاب افلام', 'انسحاب فيلم', 'الغاء افلام', 'الغاء فيلم'].includes(normalizedBody)) {
                if (typeof gameMovies.before === 'function') moviesAnswered = await gameMovies.before(mek, currentConn);
                else if (gameMovies.default && typeof gameMovies.default.before === 'function') moviesAnswered = await gameMovies.default.before(mek, currentConn);
            }
        }

        if (guessAnswered || scrambleAnswered || footballAnswered || tttAnswered || bakasaAnswered || puzzleAnswered || moviesAnswered) {
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
        if (/^(افلام|فيلم|لعبة افلام|لعبه افلام|خمن الفيلم)$/i.test(normalizedBody)) {
            if (gameMovies) {
                await respondWithStrictTiming('🎬', async () => {
                    if (typeof gameMovies === 'function') await gameMovies(mek, currentConn);
                    else if (gameMovies.default && typeof gameMovies.default === 'function') await gameMovies.default(mek, currentConn);
                });
            }
            return;
        }

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
        // 👑 [أمر المطور ومعلومات التنصيب]
        if (['المطور', '.المطور', 'مطور', '.مطور', 'المالك', 'صاحب البوت'].includes(normalizedBody)) {
            await respondWithStrictTiming('👑', async () => {
                const devMsg = 
                    `👑 *المطور الأساسي للبوتات:* 💻✨\n` +
                    `🔗 https://wa.me/qr/P3CCDW4MYIZFL1\n\n` +
                    `🤖 *للتنصيب كلم البوت:* \n` +
                    `📱 رقم البوت: +201229409956\n` +
                    `💬 رابط شات البوت: https://wa.me/201229409956\n\n` +
                    `✨ افتح شات البوت واكتب له *(تنصيب)* وابدأ فوراً! 🚀`;
                await currentConn.sendMessage(from, { text: devMsg }, { quoted: mek });
            });
            return;
        }

        if (['من الي عملك', 'مين اللي عملك', 'مين عملك', 'صانع البوت'].includes(normalizedBody)) {
            await respondWithStrictTiming('🛠️', async () => {
                const makerMsg = 
                    `👑 *الحج شادو هو المطور الأساسي للبوت!* 🛠️✨\n` +
                    `🔗 https://wa.me/qr/P3CCDW4MYIZFL1\n` +
                    `📱 رقم الحج شادو: 01129249396\n\n` +
                    `🤖 *للتنصيب كلم البوت الأساسي:* https://wa.me/201229409956`;
                await currentConn.sendMessage(from, { text: makerMsg }, { quoted: mek });
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
        // 👑 [أمر مين شادو / من شادو]
        if (
            normalizedBody === 'مين شادو' ||
            normalizedBody === 'من شادو' ||
            normalizedBody === 'مين هو شادو' ||
            normalizedBody === 'من هو شادو' ||
            normalizedBody === 'مين شادو ده' ||
            normalizedBody === 'من شادو ده' ||
            normalizedBody === `من ${botName.toLowerCase()}` || 
            normalizedBody === `مين ${botName.toLowerCase()}`
        ) {
            await respondWithStrictTiming('👑', async () => {
                const shadowInfo = 
                    `👑 *الحج شادو ده المطور الأساسي للبوت!* ❤️✨\n\n` +
                    `📱 *وده رقم الحج شادو للتواصل:* 01129249396\n` +
                    `🔗 *رابط الشات المباشر:* https://wa.me/201129249396`;
                await currentConn.sendMessage(from, { text: shadowInfo }, { quoted: mek });
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

        if (normalizedBody === botName.toLowerCase() || (normalizedCallName && normalizedBody === normalizedCallName)) {
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
            await respondWithStrictTiming('🤖', async () => {
                await currentConn.sendMessage(from, { text: `أنا بوت (${botName}) في خدمتك يا نجم! 🤖✨` }, { quoted: mek });
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

        // 🛑 فحص الشتائم ككلمة مفردة ومطابقة تماماً (للبوت المحترم فقط)
        if (isExactShatema && !isBadPersonality) {
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

