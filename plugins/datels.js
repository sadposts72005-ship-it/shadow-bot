import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { loadSubBotsRegistry, updateSubBotHajj, activeSubBots, cleanPhoneNumber } from '../core/subbot.js';
import handleStickerCommand from './sticker.js';
import handleImageCommand from './image.js';

const dbPath = path.join(process.cwd(), 'scramble_db.json');

// ⏱️ فترات التأخير المضبوطة بالملي ثانية للحماية من الحظر
const DELAYS = {
    commandReact: 1500,     // وقت الرياكت الطبيعي
    textReply: 1500,        // التأخير قبل التنفيذ والرد
    welcomeDelay: 3000,     // ترحيب الأعضاء الجدد
    actionExecute: 2000     // التأخير قبل الطرد أو الخروج
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const pendingGroupRequests = {};
const linkSpamCounter = {};
const stopRequestsControl = {};
const recentWelcomes = new Set();
let cronStarted = false;
let dynamicPrayers = {};

function loadLocalDB() {
    try {
        if (fs.existsSync(dbPath)) {
            let db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
            if (!db.users) db.users = {};
            if (!db.warns) db.warns = {};
            if (!db.warnGivers) db.warnGivers = {};
            if (!db.hajjUsers) db.hajjUsers = [];
            if (!db.mainHajjUsers) db.mainHajjUsers = [];
            if (!db.bannedGroups) db.bannedGroups = [];
            if (!db.disabledWelcomes) db.disabledWelcomes = [];
            if (!db.bannedUsers) db.bannedUsers = [];
            if (!db.timedGroupControls) db.timedGroupControls = {};
            if (!db.sentRemindersLog) db.sentRemindersLog = { date: "", list: [] };
            if (!db.lidMap) db.lidMap = {};
            if (typeof db.isBotSleeping !== 'boolean') db.isBotSleeping = false;
            // تثبيت معرفات الحج شادو الأصلي
            db.lidMap['201129249396'] = '194961618301016';
            db.lidMap['194961618301016'] = '201129249396';
            return db;
        }
    } catch (e) {
        console.error("Error loading DB in datels:", e);
    }
    return {
        users: {},
        bannedUsers: [],
        bannedGroups: [],
        disabledWelcomes: [],
        warns: {},
        warnGivers: {},
        hajjUsers: [],
        mainHajjUsers: [],
        timedGroupControls: {},
        sentRemindersLog: { date: "", list: [] },
        lidMap: { '201129249396': '194961618301016', '194961618301016': '201129249396' },
        isBotSleeping: false
    };
}

function saveLocalDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error("Error saving DB in datels:", e);
    }
}

function normalizeArabic(text) {
    if (!text) return '';
    return text.trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}

function convertArabicNumbers(text) {
    if (!text) return '';
    const arabicNums = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return text.replace(/[٠-٩]/g, (w) => arabicNums.indexOf(w));
}

// 🗄️ ذاكرة التخزين المؤقت لبيانات الجروبات لسرعة الاستجابة ومنع الـ Rate-limit
const groupMetaCache = new Map();
const GROUP_META_CACHE_TTL = 30000;

async function getCachedGroupMetadata(conn, gid) {
    if (!conn || !gid || !gid.endsWith('@g.us')) return null;
    const now = Date.now();
    const cached = groupMetaCache.get(gid);
    if (cached && (now - cached.timestamp < GROUP_META_CACHE_TTL) && cached.data) {
        return cached.data;
    }
    try {
        const metaPromise = conn.groupMetadata(gid);
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 4000));
        const data = await Promise.race([metaPromise, timeoutPromise]);
        if (data && data.participants) {
            groupMetaCache.set(gid, { data, timestamp: now });
            return data;
        }
    } catch (_) {}
    return cached?.data || null;
}

function cleanUserJid(jid) {
    if (!jid) return '';
    let clean = jid.split('@')[0].split(':')[0].trim();
    return clean + '@s.whatsapp.net';
}

function getCleanNumber(jid) {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

/**
 * التحقق مما إذا كان المعرف أو الرقم مصرياً (+20 / 201...)
 */
export function isEgyptianNumber(numOrJid) {
    if (!numOrJid) return false;
    if (typeof numOrJid === 'object') {
        const candidates = [
            numOrJid.phone_number,
            numOrJid.phoneNumber,
            numOrJid.phone,
            numOrJid.user,
            numOrJid.id,
            numOrJid.jid
        ].filter(Boolean);
        for (const c of candidates) {
            if (isEgyptianNumber(c)) return true;
        }
        return false;
    }

    let clean = getCleanNumber(numOrJid);
    if (!clean) return false;

    // فحص أرقام الموبايل المصرية (تبدأ بـ 201 ومكونة من 11-12 رقماً)
    if (clean.startsWith('201') && (clean.length === 12 || clean.length === 11)) {
        return true;
    }
    // فحص الأرقام الأرضية أو كود مصر الدولي عامة
    if (clean.startsWith('20') && clean.length >= 10 && clean.length <= 13) {
        return true;
    }

    // فحص في خريطة الـ LID
    try {
        const localDB = loadLocalDB();
        const mapped = localDB?.lidMap?.[clean];
        if (mapped && mapped.startsWith('20')) {
            return true;
        }
    } catch (_) {}

    return false;
}

/**
 * فحص المتقدم لطلب الانضمام بالكامل مع كشف الـ LID عبر السوكيت وقاعدة البيانات
 */
export async function isEgyptianParticipant(req, currentConn) {
    if (!req) return false;
    if (isEgyptianNumber(req)) return true;

    const rawJid = req.jid || (typeof req === 'string' ? req : '');
    const cleanId = getCleanNumber(rawJid);

    // فحص خريطة الـ LID المخزنة محلياً
    try {
        const localDB = loadLocalDB();
        const mapped = localDB?.lidMap?.[cleanId];
        if (mapped && isEgyptianNumber(mapped)) return true;
    } catch (_) {}

    // فحص خريطة الـ LID في Baileys Signal Repository
    if (rawJid && (rawJid.includes('@lid') || cleanId.length > 13)) {
        try {
            if (currentConn?.signalRepository?.lidMapping?.getPNForLID) {
                const pn = await currentConn.signalRepository.lidMapping.getPNForLID(rawJid);
                if (pn && isEgyptianNumber(pn)) return true;
            }
        } catch (_) {}
    }

    return false;
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

function containsBadWords(text) {
    if (!text) return false;

    // 1. تنظيف وتوحيد الأحرف العربية وإزالة التشكيل والتطويل
    const clean = text.toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآا]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/[يىئ]/g, 'ي')
        .replace(/ؤ/g, 'و');

    // 2. فحص الأنماط المباشرة مع الفواصل أو النقاط أو المسافات البينية
    const badPatterns = [
        /(\b|\s|^)ك[\s\.\-_*]*س(\b|\s|$|م|ك|ها|هن|هم|[\s\.\-_*]*(امك|اختك|ابوك|دينك|اهلك|عرضك))/,
        /ش[\s\.\-_*]*ر[\s\.\-_*]*م[\s\.\-_*]*و[\s\.\-_*]*ط/,
        /ش[\s\.\-_*]*ر[\s\.\-_*]*م[\s\.\-_*]*ي[\s\.\-_*]*ط/,
        /م[\s\.\-_*]*ت[\s\.\-_*]*ن[\s\.\-_*]*ا[\s\.\-_*]*ك/,
        /م[\s\.\-_*]*ن[\s\.\-_*]*ي[\s\.\-_*]*و[\s\.\-_*]*ك/,
        /(\b|\s|^)[يبت]?ت?ن[\s\.\-_*]*ا[\s\.\-_*]*ك(\b|\s|$|ك|ه|هم|نا|وا)/,
        /(\b|\s|^)ع[\s\.\-_*]*ر[\s\.\-_*]*ص(\b|\s|$|ه|ات|ين)/,
        /(\b|\s|^)خ[\s\.\-_*]*و[\s\.\-_*]*ل(\b|\s|$|ه|ات|ين)/,
        /ق[\s\.\-_*]*ح[\s\.\-_*]*ب/,
        /د[\s\.\-_*]*ي[\s\.\-_*]*و[\s\.\-_*]*ث/,
        /(\b|\s|^)ل[\s\.\-_*]*ب[\s\.\-_*]*و[\s\.\-_*]*ه(\b|\s|$)/,
        /(\b|\s|^)ز[\s\.\-_*]*ب(\b|\s|$|ي|ك|ه|هم|هن)/,
        /ط[\s\.\-_*]*ي[\s\.\-_*]*ز/,
        /(\b|\s|^)[ايبت]?ن[\s\.\-_*]*ي[\s\.\-_*]*ك(\b|\s|$|ك|ه|هم|هن|وا|نا)/,
        /س[\s\.\-_*]*ك[\s\.\-_*]*س/,
        /ف[\s\.\-_*]*ش[\s\.\-_*]*خ/,
        /ي[\s\.\-_*]*ل[\s\.\-_*]*ع[\s\.\-_*]*ن[\s\.\-_*]*(د|ك|ا|ام|اب)/,
        /ا[\s\.\-_*]*ر[\s\.\-_*]*ك[\s\.\-_*]*ب[\s\.\-_*]*ك/,
        /ابن\s*(الاحبه|القحبه|المتناكه|الوسخه|الكلب|الزانيه|الشرموطه)/,
        /سكسي/, /بورن/
    ];

    if (badPatterns.some(pattern => pattern.test(clean))) return true;

    // 3. نظام منع التحايل الصارم (Anti-Evasion):
    // تجريد النص تماماً من كل المسافات والنقاط والفواصل والإيموجيات
    const lettersOnly = clean.replace(/[^a-zA-Z\u0621-\u064A]/g, '');
    const collapsed = lettersOnly.replace(/(.)\1+/g, (m, c) => c);

    // جذور محظورة حتى لو حاول المستخدم تقطيعها وتفريقها بنقاط أو مسافات
    const forbiddenStems = [
        'كسم', 'كسام', 'كسخت', 'كسابو', 'كسدين', 'كسامك', 'شرموط', 'شرميط', 'متناك', 'منيوك',
        'ديوث', 'قحبه', 'قحب', 'سكس', 'منيوكه', 'طيز', 'اركبك', 'يلعندين', 'يلعنك',
        'kosom', 'kosmk', 'sharmout', 'metnak', 'manyok', '3ars', 'fuck', 'bitch',
        'asshole', 'pussy', 'dick', 'porn'
    ];

    for (const stem of forbiddenStems) {
        if (lettersOnly.includes(stem) || collapsed.includes(stem)) return true;
    }

    // كلمات مفردة محظورة عند كتابتها متفرقة
    const singleEvasionWords = ['عرص', 'خول', 'لبوه', 'عنطز', 'شلق'];
    for (const w of singleEvasionWords) {
        if (lettersOnly === w || collapsed === w || lettersOnly.includes('يا' + w) || collapsed.includes('يا' + w)) return true;
        const spacedRegex = new RegExp(w.split('').join('[\\s\\.\\-_*]+'));
        if (spacedRegex.test(clean)) return true;
    }

    return false;
}

function isUserMuted(senderJid, fromGid, localDB) {
    if (!fromGid || !localDB?.mutedUsers?.[fromGid]) return false;
    const mutedList = localDB.mutedUsers[fromGid];
    if (!Array.isArray(mutedList) || mutedList.length === 0) return false;

    const senderClean = getCleanNumber(senderJid);
    const mappedPhone = localDB.lidMap?.[senderClean] || '';

    return mutedList.some(u => {
        const cleanU = getCleanNumber(u);
        return cleanU === senderClean || (mappedPhone && cleanU === mappedPhone) || (localDB.lidMap?.[cleanU] && localDB.lidMap[cleanU] === senderClean) || u === senderJid;
    });
}

function extractTarget(mek, bodyText = '') {
    let msg = mek?.message;
    if (msg?.ephemeralMessage) msg = msg.ephemeralMessage.message;
    if (msg?.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
    if (msg?.viewOnceMessage) msg = msg.viewOnceMessage.message;

    const ctx = msg?.extendedTextMessage?.contextInfo ||
                msg?.imageMessage?.contextInfo ||
                msg?.videoMessage?.contextInfo ||
                msg?.stickerMessage?.contextInfo ||
                msg?.documentMessage?.contextInfo ||
                msg?.audioMessage?.contextInfo ||
                msg?.contactMessage?.contextInfo ||
                mek?.message?.extendedTextMessage?.contextInfo ||
                mek?.contextInfo ||
                null;

    // 1. Quoted participant (الرد على رسالة)
    const quoted = ctx?.participant || ctx?.quotedMessage?.participant;
    if (quoted) return quoted;

    // 2. Mentioned jids (المنشن)
    const mentioned = ctx?.mentionedJid;
    if (mentioned && Array.isArray(mentioned) && mentioned.length > 0) {
        return mentioned[0];
    }

    // 3. Extracted phone number or LID from text (يدعم الأرقام العربية والإنجليزية والمسافات)
    const converted = convertArabicNumbers(bodyText || '');
    const cleanNumbersInText = converted.match(/[0-9]{8,16}/g);
    if (cleanNumbersInText && cleanNumbersInText.length > 0) {
        let num = cleanNumbersInText[0];
        if (num.startsWith('01') && num.length === 11) {
            num = '2' + num;
        }
        return num.length > 14 ? `${num}@lid` : `${num}@s.whatsapp.net`;
    }

    // فحص إضافي للأرقام التي قد تحتوي على مسافات أو رموز
    const digitsOnly = converted.replace(/[^0-9]/g, '');
    if (digitsOnly.length >= 10 && digitsOnly.length <= 16) {
        let num = digitsOnly;
        if (num.startsWith('01') && num.length === 11) {
            num = '2' + num;
        }
        return num.length > 14 ? `${num}@lid` : `${num}@s.whatsapp.net`;
    }

    return null;
}

async function generateTTSBuffer(text) {
    if (!text) return null;
    const cleanText = text.replace(/[*_~`]/g, '').slice(0, 500);
    const sentences = cleanText.match(/[^.!?،\n]+[.!?،\n]?/g) || [cleanText];
    const chunks = [];
    let current = '';
    for (const s of sentences) {
        if ((current + ' ' + s).trim().length <= 150) {
            current = (current + ' ' + s).trim();
        } else {
            if (current) chunks.push(current);
            current = s.trim();
        }
    }
    if (current) chunks.push(current);

    const buffers = [];
    for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk.trim())}&tl=ar&client=tw-ob`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
        if (res.ok) {
            buffers.push(Buffer.from(await res.arrayBuffer()));
        }
    }
    return buffers.length > 0 ? Buffer.concat(buffers) : null;
}

function convertMp3ToOpus(mp3Buffer) {
    return new Promise((resolve) => {
        const randId = Math.random().toString(36).substring(2, 8);
        const tmpInput = path.join(os.tmpdir(), `tts_in_${Date.now()}_${randId}.mp3`);
        const tmpOutput = path.join(os.tmpdir(), `tts_out_${Date.now()}_${randId}.opus`);

        try {
            fs.writeFileSync(tmpInput, mp3Buffer);
            const ff = spawn('ffmpeg', [
                '-y',
                '-i', tmpInput,
                '-vn',
                '-c:a', 'libopus',
                '-b:a', '32k',
                '-vbr', 'on',
                '-compression_level', '10',
                '-ar', '48000',
                '-ac', '1',
                '-f', 'ogg',
                tmpOutput
            ]);

            ff.on('close', (code) => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                if (code === 0 && fs.existsSync(tmpOutput)) {
                    try {
                        const outBuf = fs.readFileSync(tmpOutput);
                        try { fs.unlinkSync(tmpOutput); } catch (_) {}
                        if (outBuf && outBuf.length > 0) {
                            return resolve(outBuf);
                        }
                    } catch (_) {}
                }
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                resolve(null);
            });

            ff.on('error', () => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                resolve(null);
            });
        } catch (e) {
            try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
            try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
            resolve(null);
        }
    });
}


async function searchYouTubeSong(query) {
    if (!query) return null;
    try {
        const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
            },
            signal: controller.signal
        });
        clearTimeout(timeout);
        const html = await res.text();
        const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[1]);
            const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
            if (contents && Array.isArray(contents)) {
                for (const item of contents) {
                    if (item.videoRenderer) {
                        const v = item.videoRenderer;
                        const videoId = v.videoId;
                        if (!videoId) continue;
                        const title = v.title?.runs?.[0]?.text || query;
                        const duration = v.lengthText?.simpleText || 'غير محدد';
                        let durationSec = 0;
                        if (duration && duration !== 'غير محدد') {
                            const p = duration.split(':').map(Number);
                            if (p.length === 2) durationSec = p[0] * 60 + p[1];
                            else if (p.length === 3) durationSec = p[0] * 3600 + p[1] * 60 + p[2];
                        }
                        const channel = v.ownerText?.runs?.[0]?.text || 'YouTube';
                        const thumbnail = v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                        return { videoId, title, duration, durationSec, channel, thumbnail, url: 'https://youtu.be/' + videoId };
                    }
                }
            }
        }
    } catch (e) {
        console.error('YouTube search error:', e?.message || e);
    }
    return null;
}

async function fetchAudioBufferForSong(songTitle) {
    if (!songTitle) return null;
    try {
        const cleanQuery = songTitle.replace(/\(.*?\)|\[.*?\]/g, '').trim();
        const url = 'https://api.deezer.com/search?q=' + encodeURIComponent(cleanQuery);
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (res.ok) {
            const data = await res.json();
            const previewUrl = data.data?.[0]?.preview;
            if (previewUrl) {
                const audioRes = await fetch(previewUrl);
                if (audioRes.ok) {
                    return Buffer.from(await audioRes.arrayBuffer());
                }
            }
        }
    } catch (e) {
        console.error('Deezer preview fetch error:', e?.message || e);
    }
    return null;
}

export function extractMessageBody(mek) {
    if (!mek || !mek.message) return '';
    let msg = mek.message;
    while (msg.ephemeralMessage || msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.documentWithCaptionMessage) {
        msg = msg.ephemeralMessage?.message ||
              msg.viewOnceMessage?.message ||
              msg.viewOnceMessageV2?.message ||
              msg.documentWithCaptionMessage?.message || msg;
    }
    return msg.conversation ||
           msg.extendedTextMessage?.text ||
           msg.imageMessage?.caption ||
           msg.videoMessage?.caption ||
           msg.buttonsResponseMessage?.selectedButtonId ||
           msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
           msg.templateButtonReplyMessage?.selectedId ||
           msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
           msg.text || '';
}

export function getCairoTimeParts() {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const map = {};
    for (const p of parts) {
        map[p.type] = p.value;
    }
    let h = map.hour === '24' ? '00' : map.hour;
    const hours = String(h).padStart(2, '0');
    const minutes = String(map.minute).padStart(2, '0');
    const currentTimeStr = `${hours}:${minutes}`;
    const todayDateStr = `${map.year}-${map.month}-${map.day}`;
    return {
        hours,
        minutes,
        currentTimeStr,
        todayDateStr,
        hourNum: parseInt(hours, 10),
        minNum: parseInt(minutes, 10)
    };
}

async function fetchEgyptPrayerTimes() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch('https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5', { signal: controller.signal });
        clearTimeout(timeoutId);
        const json = await response.json();
        if (json && json.code === 200 && json.data?.timings) {
            const timings = json.data.timings;
            const cleanTime = (timeStr) => timeStr.split(' ')[0].trim();

            dynamicPrayers = {
                [cleanTime(timings.Fajr)]: "الفجر 🌌",
                [cleanTime(timings.Dhuhr)]: "الظهر ☀️",
                [cleanTime(timings.Asr)]: "العصر 🌤️",
                [cleanTime(timings.Maghrib)]: "المغرب 🌅",
                [cleanTime(timings.Isha)]: "العشاء 🌃"
            };
            console.log("🕋 [Shadow Bot] تم تحديث مواعيد الصلاة بنجاح:", dynamicPrayers);
            return;
        }
    } catch (error) {
        // Fallback في حال تعذر الاتصال بـ API
    }
    dynamicPrayers = { 
        "04:48": "الفجر 🌌", 
        "11:39": "الظهر ☀️", 
        "14:43": "العصر 🌤️", 
        "17:02": "المغرب 🌅", 
        "18:22": "العشاء 🌃" 
    };
}

function getWelcomeMessage(userJid) {
    if (!userJid) return '';
    let userRaw = userJid.split('@')[0].split(':')[0];
    return `✨ *مرحباً بك يا غالي في الجروب!* 🥳 ❤️ \n` +
           `👋 نورتنا يا @${userRaw}\n\n` +
           `📜 *قوانين الجروب الرجاء الالتزام بها:*\n` +
           `1️⃣ *ممنوع الشتائم* تماماً لعدم التعرض للحظر الذكي لحسابك البوت هيرد عليك.\n` +
           `2️⃣ *ممنوع إرسال الروابط (اللينكات)*، البوت بيحذفها تلقائياً و الـ 10 روابط ورا بعض طرد نهائي.\n` +
           `3️⃣ *ممنوع دخول لبنت خاص* احترم خصوصية الأعضاء منعا للمشاكل والطرد.\n` +
           `─── 𖤐 ──── 𖤐 ───\n` +
           `🕵️‍♂️ *تعرف على شادو بوت (Shadow Bot):*\n` +
           `أنا بوت مساعد ومسلي جوه الجروب، بقدم ألعاب وتسلية ردود تلقائية تفاعلية.\n\n` +
           `🎮 *تقدر تلعب معايا دلوقتي ألعاب زي:*\n` +
           `• *بازل* ➔ لعبة ترتيب الأرقام والأشكال الأسطورية.\n` +
           `• *بكاسة* ➔ لعبة مين فينا الحرامي واكتشاف الجاسوس.\n` +
           `• *اكس او* ➔ تحدي صاحبك أو البوت في الشات.\n` +
           `• *احزر* ➔ لعبة تخمين الشخصيات والمشاهير بالصور.\n` +
           `• *صراحة* ➔ أسئلة جريئة وممتعة للتسلية.\n` +
           `• *رتب* ➔ ترتيب الحروف المبعثرة وكسب نقاط.\n` +
           `• *كوره* ➔ أسئلة كروية وتحدي معلومات ملحمية.\n\n` +
           `💡 لمعرفة كل الأوامر بالتفصيل اكتب في أي وقت كلمة: *اوامر* أو *أوامر* في الشات!`;
}

async function getParticipatingGroupIds(conn, localDB) {
    if (!conn) return [];
    const groupsSet = new Set();

    // 1. استخدام سجل الجروبات المعروفة المحفوظة مسبقاً في قاعدة البيانات للبوت الأساسي
    if (!conn.isSubBot && localDB?.knownGroups && Array.isArray(localDB.knownGroups)) {
        for (const gid of localDB.knownGroups) {
            if (gid && gid.endsWith('@g.us') && !localDB.bannedGroups?.includes(gid)) {
                groupsSet.add(gid);
            }
        }
    }

    // 2. فحص سجل الجروبات الخاص بالبوت الفرعي إن وجد
    if (conn.isSubBot && conn.subBotConfig?.knownGroups && Array.isArray(conn.subBotConfig.knownGroups)) {
        for (const gid of conn.subBotConfig.knownGroups) {
            if (gid && gid.endsWith('@g.us') && !localDB.bannedGroups?.includes(gid)) {
                groupsSet.add(gid);
            }
        }
    }

    // 3. جلب الجروبات الإضافية المتصلة بالسوكيت مباشرة بمهلة 15 ثانية وتحديث السجل
    try {
        if (typeof conn.groupFetchAllParticipating === 'function') {
            const groupsPromise = conn.groupFetchAllParticipating();
            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 15000));
            const fetched = await Promise.race([groupsPromise, timeoutPromise]);
            if (fetched && typeof fetched === 'object') {
                let dbUpdated = false;
                for (const gid of Object.keys(fetched)) {
                    if (gid && gid.endsWith('@g.us') && !localDB.bannedGroups?.includes(gid)) {
                        groupsSet.add(gid);
                        if (!conn.isSubBot) {
                            if (localDB) {
                                if (!localDB.knownGroups) localDB.knownGroups = [];
                                if (!localDB.knownGroups.includes(gid)) {
                                    localDB.knownGroups.push(gid);
                                    dbUpdated = true;
                                }
                            }
                        } else if (conn.subBotConfig) {
                            if (!conn.subBotConfig.knownGroups) conn.subBotConfig.knownGroups = [];
                            if (!conn.subBotConfig.knownGroups.includes(gid)) {
                                conn.subBotConfig.knownGroups.push(gid);
                            }
                        }
                    }
                }
                if (dbUpdated && localDB) saveLocalDB(localDB);
            }
        }
    } catch (_) {}

    return Array.from(groupsSet);
}

async function sendRemindersWithDelay(conn, groupIds, messageToSend, localDB, sentGids = new Set()) {
    for (let gid of groupIds) {
        if (!gid || !gid.endsWith('@g.us') || localDB.bannedGroups?.includes(gid)) continue;
        if (sentGids.has(gid)) continue;

        if (!conn || !conn.user?.id) break;

        try {
            sentGids.add(gid);

            let participants = [];
            try {
                const meta = await getCachedGroupMetadata(conn, gid);
                if (meta?.participants) participants = meta.participants;
                else {
                    const metaPromise = conn.groupMetadata(gid);
                    const metaTimeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
                    const fetchedMeta = await Promise.race([metaPromise, metaTimeout]);
                    if (fetchedMeta?.participants) participants = fetchedMeta.participants;
                }
            } catch (_) {}

            if (participants && participants.length > 0) {
                const mentions = participants.map(p => p.id).filter(Boolean);
                const tagList = participants.map(mem => `@${mem.id.split('@')[0].split(':')[0]}`).join(' ');
                const finalTaggedMessage = `${messageToSend}\n\n🔔 تذكير لجميع الأعضاء:\n${tagList}`;
                await conn.sendMessage(gid, { text: finalTaggedMessage, mentions: mentions }).catch(() => {});
            } else {
                await conn.sendMessage(gid, { text: messageToSend }).catch(() => {});
            }
        } catch (_) {}
        await delay(5000); // ⏱️ تأخير 5 ثوانٍ كاملة بين كل جروب وجروب لحماية الرقم من الحظر ومنع اسبام الرسائل
    }
}

async function broadcastReminders(messageGeneratorOrText, localDB) {
    const sentGids = new Set();
    const mainConn = activeRemindersConn;

    if (mainConn && mainConn.user?.id) {
        const mainGroups = await getParticipatingGroupIds(mainConn, localDB);
        const mainMsg = typeof messageGeneratorOrText === 'function' ? messageGeneratorOrText(mainConn) : messageGeneratorOrText;
        if (mainGroups.length > 0) {
            await sendRemindersWithDelay(mainConn, mainGroups, mainMsg, localDB, sentGids);
        }
    }

    // دعم بث الأذكار في جروبات البوتات الفرعية النشطة أيضاً بدون تكرار في نفس الروم
    try {
        if (activeSubBots && activeSubBots.size > 0) {
            for (const [subPhone, subData] of activeSubBots.entries()) {
                const subSock = subData?.sock;
                if (!subSock || !subSock.user?.id) continue;
                const subGroups = await getParticipatingGroupIds(subSock, localDB);
                const uniqueSubGroups = subGroups.filter(g => !sentGids.has(g));
                const subMsg = typeof messageGeneratorOrText === 'function' ? messageGeneratorOrText(subSock) : messageGeneratorOrText;
                if (uniqueSubGroups.length > 0) {
                    await sendRemindersWithDelay(subSock, uniqueSubGroups, subMsg, localDB, sentGids);
                }
            }
        }
    } catch (_) {}
}

let activeRemindersConn = null;
let isRemindingInProgress = false;

export async function startAutoReminders(currentConn) {
    if (currentConn && currentConn.user?.id) {
        activeRemindersConn = currentConn;
    }
    if (cronStarted) return;
    cronStarted = true;

    // جلب مواعيد الصلاة فوراً في الخلفية
    fetchEgyptPrayerTimes().catch(() => {});

    let lastExecutedMinute = '';

    setInterval(async () => {
        try {
            const conn = activeRemindersConn;
            if (!conn || !conn.user?.id) return;

            if (isRemindingInProgress) return;

            const { hours, minutes, currentTimeStr, todayDateStr, hourNum, minNum } = getCairoTimeParts();

            let localDB = loadLocalDB();

            // فحص اليوم الجديد لتجديد قائمة الصلوات والأذكار
            if (!localDB.sentRemindersLog || localDB.sentRemindersLog.date !== todayDateStr) {
                localDB.sentRemindersLog = { date: todayDateStr, list: [] };
                saveLocalDB(localDB);
                fetchEgyptPrayerTimes().catch(() => {});
            }

            // 1. أذكار ومواقيت الصلاة
            if (dynamicPrayers[currentTimeStr]) {
                const prayerName = dynamicPrayers[currentTimeStr];
                const prayerLogKey = `prayer_${todayDateStr}_${prayerName}`;

                if (!localDB.sentRemindersLog.list.includes(prayerLogKey)) {
                    isRemindingInProgress = true;
                    try {
                        let messageGenerator = (sock) => {
                            const bName = sock.subBotConfig?.botName || sock.botName || (sock.isSubBot ? 'بوت فرعي' : 'شادو');
                            return `🕌 *حان الآن موعد أذان ${prayerName} حسب توقيت مصر المحلي* 🕌\nصلاتك حياتك يا غالي، لا تؤخرها.. اذكر الله وصَلِّ على النبي محمد ﷺ ❤️\n\n🤖 *${bName}*`;
                        };
                        await broadcastReminders(messageGenerator, localDB);
                        localDB.sentRemindersLog.list.push(prayerLogKey);
                        saveLocalDB(localDB);
                    } finally {
                        isRemindingInProgress = false;
                    }
                }
            }

            // 2. تذكير الصلاة على النبي ﷺ التلقائي في جميع الجروبات كل 3 ساعات
            const now = Date.now();
            const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
            const lastSalawat = Number(localDB.lastSalawatBroadcastTime) || 0;
            const salawatLogKey = `salawat_${todayDateStr}_${hours}`;

            // فحص إرسال الصلاة على النبي كل 3 ساعات (في الساعات 0, 3, 6, 9, 12, 15, 18, 21 أو عند انقضاء 3 ساعات كاملة)
            const isThreeHourSlot = (hourNum % 3 === 0 && minNum <= 3 && !localDB.sentRemindersLog.list.includes(salawatLogKey));
            const isElapsedThreeHours = (lastSalawat > 0 && (now - lastSalawat >= THREE_HOURS_MS));

            if (isThreeHourSlot || isElapsedThreeHours) {
                // تجنب التكرار السريع إذا أُرسل مؤخراً (خلال آخر ساعتين ونصف مثلاً)
                if (lastSalawat === 0 || (now - lastSalawat >= 2.5 * 60 * 60 * 1000)) {
                    isRemindingInProgress = true;
                    try {
                        const salawatMessages = [
                            `✨ *اللهم صلِّ وسلِّم وبارك على نبينا وحبيبنا محمد وعلى آله وصحبه أجمعين* ﷺ ❤️\n\nأكثروا من الصلاة والسلام على خير الأنام تُفرَج همومكم وتُغفَر ذنوبكم 🤲🤍`,
                            `🌸 *صلوا على الحبيب المصطفى* ﷺ 🌸\n\n«إنَّ أوْلى النَّاسِ بي يَومَ القيامةِ أَكْثَرُهُم عليَّ صَلاةً» 🌿\nاللهم صلِّ وسلم وبارك على محمد وآله وصحبه أجمعين ❤️`,
                            `🕊️ *تذكير بالصلاة على النبي محمد ﷺ* 🕊️\n\nاللهم صلّ على محمد وعلى آل محمد كما صليت على إبراهيم وعلى آل إبراهيم إنك حميد مجيد ✨\nلا تنس ذكر الله يا غالي 🤍`,
                            `🌟 *صلِّ على النبي وتبسم* ﷺ 🌟\n\n«من صلّى عليّ صلاة صلّى الله عليه بها عشراً» 🌿\nرطب لسانك وقلبك بالصلاة والسلام على رسول الله ﷺ 🤍`
                        ];
                        const randomSalawat = salawatMessages[Math.floor(Math.random() * salawatMessages.length)];
                        const salawatGenerator = (sock) => {
                            const bName = sock.subBotConfig?.botName || sock.botName || (sock.isSubBot ? 'بوت فرعي' : 'شادو');
                            return `${randomSalawat}\n\n🤖 *${bName}*`;
                        };
                        await broadcastReminders(salawatGenerator, localDB);
                        localDB.lastSalawatBroadcastTime = now;
                        if (!localDB.sentRemindersLog.list.includes(salawatLogKey)) {
                            localDB.sentRemindersLog.list.push(salawatLogKey);
                        }
                        saveLocalDB(localDB);
                    } finally {
                        isRemindingInProgress = false;
                    }
                }
            }

            // 3. القفل والفتح المجدول للجروبات (Timed Group Controls)
            if (lastExecutedMinute !== currentTimeStr) {
                lastExecutedMinute = currentTimeStr;

                if (localDB.timedGroupControls && typeof localDB.timedGroupControls === 'object') {
                    for (const [gid, sched] of Object.entries(localDB.timedGroupControls)) {
                        if (!gid || !sched || localDB.bannedGroups?.includes(gid)) continue;

                        // وقت القفل
                        if (sched.closeTime && sched.closeTime === currentTimeStr) {
                            try {
                                await conn.groupSettingUpdate(gid, 'announcement');
                                await conn.sendMessage(gid, {
                                    text: `🔒 *حان موعد قفل المجموعة التلقائي المجدول (${currentTimeStr})!* ⏱️\nتم قفل الشات الآن بواسطة شادو بوت للمشرفين فقط. تصبحون على خير 🌙✨`
                                }).catch(() => {});
                                console.log(`🔒 [Scheduled Lock] Closed group: ${gid} at ${currentTimeStr}`);
                            } catch (err) {
                                console.error(`Error closing group ${gid}:`, err?.message || err);
                            }
                        }

                        // وقت الفتح
                        if (sched.openTime && sched.openTime === currentTimeStr) {
                            try {
                                await conn.groupSettingUpdate(gid, 'not_announcement');
                                await conn.sendMessage(gid, {
                                    text: `🔓 *حان موعد فتح المجموعة التلقائي المجدول (${currentTimeStr})!* ⏱️\nتم فتح الشات الآن لجميع الأعضاء بواسطة شادو بوت. صباح الخير ويوم سعيد لكم جميعاً ☀️🎉`
                                }).catch(() => {});
                                console.log(`🔓 [Scheduled Open] Opened group: ${gid} at ${currentTimeStr}`);
                            } catch (err) {
                                console.error(`Error opening group ${gid}:`, err?.message || err);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Error in startAutoReminders loop:", e?.message || e);
            isRemindingInProgress = false;
        }
    }, 15000);
}

const datelsHandler = {
    participantsUpdate: async function (update, currentConn) {
        const { id, participants, action } = update;
        if (id && id.endsWith('@g.us')) {
            try {
                let localDB = loadLocalDB();
                if (!localDB.knownGroups) localDB.knownGroups = [];
                if (!localDB.knownGroups.includes(id)) {
                    localDB.knownGroups.push(id);
                    saveLocalDB(localDB);
                }
                if (currentConn?.subBotConfig) {
                    if (!currentConn.subBotConfig.knownGroups) currentConn.subBotConfig.knownGroups = [];
                    if (!currentConn.subBotConfig.knownGroups.includes(id)) {
                        currentConn.subBotConfig.knownGroups.push(id);
                    }
                }
            } catch (_) {}
        }
        if (action === 'add' && id.endsWith('@g.us')) {
            let localDB = loadLocalDB();
            if (localDB.bannedGroups?.includes(id) || localDB.disabledWelcomes?.includes(id)) return;

            for (let participant of participants) {
                let newUser = typeof participant === 'string' ? participant : (participant.id || '');
                if (!newUser) continue;

                const welcomeKey = `${id}_${getCleanNumber(newUser)}`;
                if (recentWelcomes.has(welcomeKey)) continue;

                recentWelcomes.add(welcomeKey);
                setTimeout(() => recentWelcomes.delete(welcomeKey), 10000);

                await delay(DELAYS.welcomeDelay);
                let welcomeText = getWelcomeMessage(newUser);
                await currentConn.sendMessage(id, { text: welcomeText, mentions: [newUser] }).catch(() => {});
            }
        }
    },

    before: async function (mek, currentConn) {
        try {
            const from = mek.key?.remoteJid;
            if (!from) return false;

            if (from.endsWith('@g.us')) {
                try {
                    let localDB = loadLocalDB();
                    if (!localDB.knownGroups) localDB.knownGroups = [];
                    if (!localDB.knownGroups.includes(from)) {
                        localDB.knownGroups.push(from);
                        saveLocalDB(localDB);
                    }
                    if (currentConn?.subBotConfig) {
                        if (!currentConn.subBotConfig.knownGroups) currentConn.subBotConfig.knownGroups = [];
                        if (!currentConn.subBotConfig.knownGroups.includes(from)) {
                            currentConn.subBotConfig.knownGroups.push(from);
                        }
                    }
                } catch (_) {}
            }

            const isGroup = from.endsWith('@g.us');
            let sender = isGroup ? (mek.key.participant || mek.participant || '') : from;
            if (!sender && mek.key?.fromMe) sender = currentConn.user?.id || '';
            if (!sender) return false;

            const cleanSenderNum = getCleanNumber(sender);

            // 👑 اسم ومعرفات البوت الحالية
            const botName = mek.botName || currentConn.botName || 'شادو';
            const botLower = (botName || 'شادو').toLowerCase().trim();
            const normalizedBotName = normalizeArabic(botLower);
            const myId = currentConn.user?.id || '';
            const myBotNum = myId.split(':')[0]?.replace(/[^0-9]/g, '');

            // 👑 التحقق من المطور الرئيسي والحجاج
            const ownerPhone = '201129249396';
            const ownerLid = '194961618301016';
            const ownerAltPhone = '201229409956';
            const ownerFullJid = `${ownerPhone}@s.whatsapp.net`;

            let localDB = loadLocalDB();

            const isAbsoluteOwner = (
                cleanSenderNum === ownerPhone ||
                cleanSenderNum === ownerLid ||
                cleanSenderNum === ownerAltPhone ||
                localDB.lidMap?.[cleanSenderNum] === ownerPhone ||
                localDB.lidMap?.[cleanSenderNum] === ownerLid ||
                mek.key.fromMe
            );

            // 👑 فحص صاحب البوت (سواء شادو الأصلي للبوت الرئيسي أو الحج صاحب البوت الفرعي)
            const isSubBot = Boolean(currentConn.isSubBot || currentConn.subBotConfig);
            const subCfg = currentConn.subBotConfig || {};
            const subAdminPhone = cleanPhoneNumber(subCfg.adminPhone) || subCfg.adminPhone || '';
            const subAdminLid = subCfg.adminLid ? String(subCfg.adminLid).replace(/[^0-9]/g, '') : '';
            const subAdminNumbers = Array.isArray(subCfg.adminNumbers) ? subCfg.adminNumbers : [];
            const mappedSender = localDB.lidMap?.[cleanSenderNum] || '';
            const senderCleanPhone = cleanPhoneNumber(cleanSenderNum);

            const isSubBotOwner = isSubBot && (
                (subAdminPhone && (cleanSenderNum === subAdminPhone || senderCleanPhone === subAdminPhone)) ||
                (subAdminLid && (cleanSenderNum === subAdminLid || sender.includes(subAdminLid))) ||
                (mappedSender && (mappedSender === subAdminPhone || mappedSender === subAdminLid || cleanPhoneNumber(mappedSender) === subAdminPhone)) ||
                subAdminNumbers.includes(cleanSenderNum) ||
                subAdminNumbers.includes(senderCleanPhone) ||
                subAdminNumbers.includes(sender) ||
                (subCfg.adminJid && (sender === subCfg.adminJid || cleanSenderNum === getCleanNumber(subCfg.adminJid))) ||
                mek.isSubBotAdmin ||
                mek.isSubBotMainOwner
            );

            const isSubBotAdmin = isSubBotOwner || Boolean(mek.isSubBotAdmin);
            const isMainHajj = isAbsoluteOwner || isUserInList(sender, localDB.mainHajjUsers);
            const isHajj = isMainHajj || isUserInList(sender, localDB.hajjUsers) || mek.isSuperAdmin;

            // تحديد المالك (الحج شادو للبوت الرئيسي، أو صاحب البوت الفرعي للبوت الفرعي)
            const isBotOwner = isAbsoluteOwner || isSubBotOwner || isSubBotAdmin || Boolean(mek.isBotOwner) || isMainHajj;

            // استخراج النص من الرسالة
            const body = extractMessageBody(mek);
            if (!body) return false;

            const textLower = body.toLowerCase().trim();
            const normalizedBody = normalizeArabic(textLower);

            // دالة التفاعل والمزامنة
            async function handleCommandTiming(emoji = '🕵️‍♂️') {
                await delay(DELAYS.commandReact);
                try {
                    await currentConn.sendMessage(from, { react: { text: emoji, key: mek.key } });
                } catch (e) {}
                await delay(DELAYS.textReply);
            }

            // فحص حظر المستخدم
            if (isUserBanned(sender, localDB) && !isAbsoluteOwner) return true;

            // جلب معلومات الجروب والمشرفين
            let groupMetadata = isGroup ? await getCachedGroupMetadata(currentConn, from) : null;
            let participants = groupMetadata?.participants || [];

            // مزامنة وتعلم معرّفات الـ LID والأرقام تلقائياً
            if (participants && Array.isArray(participants) && participants.length > 0) {
                if (!localDB.lidMap) localDB.lidMap = {};
                let changed = false;
                for (const p of participants) {
                    let phone = '';
                    let lid = '';
                    if (p.id?.endsWith('@s.whatsapp.net')) phone = getCleanNumber(p.id);
                    else if (p.id?.endsWith('@lid')) lid = getCleanNumber(p.id);
                    if (p.lid?.endsWith('@lid')) lid = getCleanNumber(p.lid);
                    else if (p.lid?.endsWith('@s.whatsapp.net')) phone = getCleanNumber(p.lid);

                    if (phone && lid) {
                        if (localDB.lidMap[phone] !== lid || localDB.lidMap[lid] !== phone) {
                            localDB.lidMap[phone] = lid;
                            localDB.lidMap[lid] = phone;
                            changed = true;
                        }
                    }
                }
                if (changed) saveLocalDB(localDB);
            }

            const groupAdminsSet = new Set();
            for (const p of participants) {
                if (p.admin === 'admin' || p.admin === 'superadmin') {
                    const c1 = getCleanNumber(p.id);
                    const c2 = getCleanNumber(p.lid);
                    const c3 = getCleanNumber(p.phoneNumber || p.phone_number);
                    if (c1) groupAdminsSet.add(c1);
                    if (c2) groupAdminsSet.add(c2);
                    if (c3) groupAdminsSet.add(c3);
                    if (c1 && localDB.lidMap?.[c1]) groupAdminsSet.add(localDB.lidMap[c1]);
                    if (c2 && localDB.lidMap?.[c2]) groupAdminsSet.add(localDB.lidMap[c2]);
                    if (c3 && localDB.lidMap?.[c3]) groupAdminsSet.add(localDB.lidMap[c3]);
                }
            }
            const groupAdmins = Array.from(groupAdminsSet);

            let isSenderAdmin = groupAdmins.includes(cleanSenderNum) || 
                                (localDB.lidMap?.[cleanSenderNum] && groupAdmins.includes(localDB.lidMap[cleanSenderNum])) ||
                                (senderCleanPhone && groupAdmins.includes(senderCleanPhone));
            let creatorMember = participants.find(p => p.admin === 'superadmin');
            let groupCreatorRaw = creatorMember ? getCleanNumber(creatorMember.id) : '';

            // أوامر الإشراف للمشرفين، مالك البوت، والحج الأساسي
            const isActualRoomAdminOrOwner = isAbsoluteOwner || isMainHajj || isBotOwner || (cleanSenderNum === groupCreatorRaw) || isSenderAdmin;

            // فحص أدمن التنبيه المعين في هذا الجروب
            const groupWarnGivers = localDB.warnGivers?.[from] || {};
            const isWarnAdmin = isActualRoomAdminOrOwner || isBotOwner || Object.keys(groupWarnGivers).some(k => {
                let cleanK = getCleanNumber(k);
                return cleanK === cleanSenderNum || (localDB.lidMap?.[cleanSenderNum] && cleanK === localDB.lidMap[cleanSenderNum]);
            });

            // 🔇 0️⃣ [حذف رسائل الأعضاء المكتومين بالجروب فوراً]
            if (isGroup && isUserMuted(sender, from, localDB)) {
                try {
                    await currentConn.sendMessage(from, { delete: mek.key });
                } catch (_) {}
                return true;
            }

            // 🛡️ [مكافحة نصوص الكراش والفيروسات الضخمة لحماية الجروب من التبنيد]
            if (isGroup && localDB.groupProtection?.[from] && !isActualRoomAdminOrOwner) {
                const rawLen = (body || '').length;
                const hasCrash = rawLen > 7000 || /[\u200B-\u200D\uFEFF]{20,}/.test(body) || /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]{1000,}/.test(body);
                if (hasCrash) {
                    try {
                        await currentConn.sendMessage(from, { delete: mek.key });
                        await currentConn.groupParticipantsUpdate(from, [sender], 'remove');
                        await currentConn.sendMessage(from, {
                            text: `🚨 *تحذير أمني ضد التبنيد:* تم طرد @${cleanSenderNum} وحذف رسالته فوراً لإرساله نصوص فيروسات / كراش تهدد الجروب بالحظر! 🛡️`,
                            mentions: [sender]
                        });
                    } catch (_) {}
                    return true;
                }
            }

            // أوامر الإغلاق الكامل للسيرفر للمطور الأصلي فقط
            const shutdownCommands = ['قفل البوت', 'ايقاف البوت', 'طفي البوت', 'اطفاء البوت'];

            if (shutdownCommands.includes(normalizedBody)) {
                if (!isAbsoluteOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي صاحب البوت! 👑🚫' }, { quoted: mek });
                    return true;
                }
                await handleCommandTiming('🛑');
                await currentConn.sendMessage(from, { text: '🛑 *بأمر من الحج شادو الأصلي.. جاري إيقاف البوت تماماً الآن! في رعاية الله.* 😴' }, { quoted: mek });
                setTimeout(() => process.exit(0), 2000);
                return true;
            }

            // 🕌 أوامر مواقيت الصلاة والأذان
            if (['مواقيت الصلاة', 'مواعيد الصلاة', 'مواقيت الصلاه', 'مواعيد الصلاه', 'الاذان', 'الأذان', 'الصلوات'].includes(normalizedBody)) {
                await handleCommandTiming('🕌');
                const { todayDateStr } = getCairoTimeParts();
                let prayerList = '';
                for (const [time, name] of Object.entries(dynamicPrayers)) {
                    prayerList += `• ${name}: *${time}*\n`;
                }
                const msg = 
                    `╭━━━〔 🕌 *مواقيت الصلاة في مصر* 〕━━━╮\n` +
                    `📅 التاريخ: ${todayDateStr}\n\n` +
                    (prayerList || '• جاري تحديث المواعيد...\n') +
                    `\n📢 *تنبيه:* يقوم البوت بالتنبيه تلقائياً في جميع الرومات عند حلول موعد كل صلاة.\n` +
                    `🤍 *صلاتك حياتك فلا تؤخرها.. صَلِّ على النبي ﷺ*` +
                    `\n╰━━━━━━━━━━━━━━━━━━━━╯`;
                await currentConn.sendMessage(from, { text: msg }, { quoted: mek });
                return true;
            }

            // 🌸 أمر الصلاة على النبي
            if (['صلي علي النبي', 'صلي على النبي', 'صلوا على النبي', 'الصلاة على النبي', 'الصلاه علي النبي'].includes(normalizedBody)) {
                await handleCommandTiming('🌸');
                const salawatList = [
                    `✨ *اللهم صلِّ وسلِّم وبارك على نبينا وحبيبنا محمد وعلى آله وصحبه أجمعين* ﷺ ❤️\n\nأكثروا من الصلاة والسلام على خير الأنام تُفرَج همومكم وتُغفَر ذنوبكم 🤲🤍`,
                    `🌸 *صلوا على الحبيب المصطفى* ﷺ 🌸\n\n«إنَّ أوْلى النَّاسِ بي يَومَ القيامةِ أَكْثَرُهُم عليَّ صَلاةً» 🌿\nاللهم صلِّ وسلم وبارك على محمد وآله وصحبه أجمعين ❤️`,
                    `🕊️ *اللهم صلّ على محمد وعلى آل محمد كما صليت على إبراهيم وعلى آل إبراهيم إنك حميد مجيد* ✨\nرطب لسانك وقلبك بذكر الحبيب ﷺ 🤍`
                ];
                const chosen = salawatList[Math.floor(Math.random() * salawatList.length)];
                await currentConn.sendMessage(from, { text: chosen }, { quoted: mek });
                return true;
            }

            // 🧪 أوامر تجربة الأذان والصلاة على النبي فوراً لجميع الجروبات
            if (['ارسل الاذان', 'أرسل الأذان', 'تست الاذان', 'تجربة الاذان', 'تجربه الاذان', 'تذكير الصلاة الان', 'تذكير الصلاه الان'].includes(normalizedBody)) {
                if (!isHajj && !isBotOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص للحجاج فقط لاختبار نظام الأذان والتذكيرات!' }, { quoted: mek });
                    return true;
                }
                await handleCommandTiming('🕌');
                const testAdhan = `🕌 *حان الآن موعد أذان العصر حسب توقيت مصر المحلي* 🕌\nصلاتك حياتك يا غالي، لا تؤخرها.. اذكر الله وصَلِّ على النبي محمد ﷺ ❤️`;
                await broadcastReminders(testAdhan, localDB);
                await currentConn.sendMessage(from, { text: '✅ تم إرسال تذكير الأذان الآن لجميع الرومات بنجاح وبسرعة فائقة! 🚀' }, { quoted: mek });
                return true;
            }

            if (['ارسل الصلاة على النبي', 'ارسل الصلاه علي النبي', 'تذكير الصلاة على النبي الان'].includes(normalizedBody)) {
                if (!isHajj && !isBotOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص للحجاج فقط!' }, { quoted: mek });
                    return true;
                }
                await handleCommandTiming('🌸');
                const testSalawat = `✨ *اللهم صلِّ وسلِّم وبارك على نبينا وحبيبنا محمد وعلى آله وصحبه أجمعين* ﷺ ❤️\n\nأكثروا من الصلاة والسلام على خير الأنام تُفرَج همومكم وتُغفَر ذنوبكم 🤲🤍`;
                await broadcastReminders(testSalawat, localDB);
                await currentConn.sendMessage(from, { text: '✅ تم إرسال تذكير الصلاة على النبي الآن لجميع الرومات بنجاح! 🌸' }, { quoted: mek });
                return true;
            }

            const waGroupRegex = /(?:https?:\/\/)?chat\.whatsapp\.com\/([a-zA-Z0-9]{20,26})/i;

            // تحديد جهة إرسال طلب الموافقة على الدخول (مالك البوت الفرعي للبوت الفرعي، أو الحج شادو للبوت الرئيسي)
            let approvalTargetJid = ownerFullJid;
            if (isSubBot && subAdminPhone) {
                approvalTargetJid = `${subAdminPhone}@s.whatsapp.net`;
            } else if (isSubBot && subCfg.adminJid) {
                approvalTargetJid = subCfg.adminJid;
            } else if (isSubBot && subAdminLid) {
                approvalTargetJid = `${subAdminLid}@lid`;
            }

            // =========================================================================
            // 📥 1️⃣ [أمر ادخل جروب / انضمام للحج الأساسي حصرياً]
            // =========================================================================
            const isJoinCommand = normalizedBody.startsWith('ادخل جروب') ||
                                  normalizedBody.startsWith('ادخل') ||
                                  normalizedBody.startsWith('انضم جروب') ||
                                  normalizedBody.startsWith('انضمام') ||
                                  normalizedBody.startsWith('انضم');

            if (isJoinCommand) {
                let codeMatch = body.match(waGroupRegex);
                if (codeMatch && codeMatch[1]) {
                    if (!isBotOwner) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: `❌ هذا الأمر مخصص لمالك البوت (${botName || 'الرئيسي'}) فقط! 👑🚫` }, { quoted: mek });
                        return true;
                    }

                    let inviteCode = codeMatch[1];
                    await handleCommandTiming('🚀');
                    try {
                        let res = await currentConn.groupAcceptInvite(inviteCode);
                        await currentConn.sendMessage(from, { text: `✅ *أبشر يا حج.. تم دخول الجروب بنجاح وبأمان كامل!* 🎉\n📌 ID الجروب: ${res}` }, { quoted: mek });
                    } catch (e) {
                        try {
                            await currentConn.groupRequestJoinCode(inviteCode);
                            await currentConn.sendMessage(from, { text: `📩 *الجروب يتطلب موافقة الأدمن!* \nتم إرسال طلب انضمام بنجاح وفي انتظار القبول.` }, { quoted: mek });
                        } catch (err) {
                            await currentConn.sendMessage(from, { text: `❌ تعذر الانضمام للجروب: ${err.message || 'تأكد من صلاحية الرابط'}` }, { quoted: mek });
                        }
                    }
                    return true;
                } else if (!isGroup && isBotOwner) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '❌ يرجى إرسال الأمر متبوعاً برابط الجروب، مثال:\n(ادخل جروب https://chat.whatsapp.com/...)' }, { quoted: mek });
                    return true;
                }
            }

            // إرسال رابط فقط في الشات الخاص بدون كلمة أمر
            if (!isGroup && waGroupRegex.test(body)) {
                let matched = body.match(waGroupRegex);
                let inviteCode = matched[1];
                let fullLink = `https://chat.whatsapp.com/${inviteCode}`;

                await handleCommandTiming('⏳');

                if (isBotOwner) {
                    try {
                        let res = await currentConn.groupAcceptInvite(inviteCode);
                        await currentConn.sendMessage(from, { text: `✅ *أبشر يا حج.. تم دخول الجروب بنجاح!* 🎉\n📌 ID الجروب: ${res}` }, { quoted: mek });
                    } catch (e) {
                        try {
                            await currentConn.groupRequestJoinCode(inviteCode);
                            await currentConn.sendMessage(from, { text: `📩 *الجروب يتطلب موافقة الأدمن!* \nتم إرسال طلب انضمام وفي انتظار القبول.` }, { quoted: mek });
                        } catch (err) {
                            await currentConn.sendMessage(from, { text: `❌ تعذر الانضمام للجروب!` }, { quoted: mek });
                        }
                    }
                } else {
                    const ownerNameDisplay = (isSubBot && subAdminPhone) ? `الحج المالك (+${subAdminPhone})` : 'الحج شادو';
                    await currentConn.sendMessage(from, { text: `⏳ *لحظة يا غالي..* \nأستأذن *${ownerNameDisplay}* 👑 الأول أدخل ولا لأ!` }, { quoted: mek });
                    pendingGroupRequests[cleanSenderNum] = { sender: sender, link: fullLink, subBotPhone: currentConn.subBotPhone };

                    let textToOwner = `📩 *طلب انضمام لجروب جديد وصل لبوتك (${botName})!* 🤖\n\n` +
                                     `👤 *من العضو:* @${cleanSenderNum}\n` +
                                     `🔗 *رابط الجروب:* ${fullLink}\n\n` +
                                     `👇 *للموافقة أرسل:* \n` +
                                     `ادخل ${fullLink}\n\n` +
                                     `👇 *للرفض أرسل:* \n` +
                                     `رفض ${cleanSenderNum}`;

                    await currentConn.sendMessage(approvalTargetJid, { text: textToOwner, mentions: [sender] }).catch(() => {});
                }
                return true;
            }

            // أمر رفض طلب الانضمام لمالك البوت
            if (normalizedBody.startsWith('رفض ') || normalizedBody.startsWith('ارفض ')) {
                if (isBotOwner) {
                    const targetUser = body.replace(/^(رفض|ارفض)\s*/i, '').replace(/[^0-9]/g, '');
                    if (targetUser && pendingGroupRequests[targetUser]) {
                        const req = pendingGroupRequests[targetUser];
                        delete pendingGroupRequests[targetUser];
                        await handleCommandTiming('🚫');
                        await currentConn.sendMessage(from, { text: `🚫 تم رفض طلب الانضمام للرقم (+${targetUser}) بنجاح.` }, { quoted: mek });
                        if (req.sender) {
                            await currentConn.sendMessage(req.sender, { text: `❌ اعتذر الحج المالك عن انضمام البوت لهذا الجروب حالياً يا غالي.` }).catch(() => {});
                        }
                        return true;
                    }
                }
            }



            // =========================================================================
            // 🛡️ 2️⃣ [مسح الروابط بالجروبات ومكافحة السبام]
            // =========================================================================
            if (isGroup && !isSenderAdmin && !isMainHajj && !isAbsoluteOwner) {
                const linkRegex = /(?:https?:\/\/)?chat\.whatsapp\.com\/[a-zA-Z0-9]{20,26}|(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,256}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;
                if (linkRegex.test(body) && !/sarhne\.com/i.test(body)) {
                    if (!linkSpamCounter[from]) linkSpamCounter[from] = {};
                    if (!linkSpamCounter[from][cleanSenderNum]) linkSpamCounter[from][cleanSenderNum] = 0;
                    linkSpamCounter[from][cleanSenderNum]++;

                    await handleCommandTiming('⚠️');
                    try {
                        await currentConn.sendMessage(from, { delete: mek.key });
                    } catch (e) {}

                    if (linkSpamCounter[from][cleanSenderNum] >= 10) {
                        delete linkSpamCounter[from][cleanSenderNum];
                        try {
                            await currentConn.groupParticipantsUpdate(from, [sender], 'remove');
                            await currentConn.sendMessage(from, { text: `🚨 تم طرد @${cleanSenderNum} تلقائياً لإرسال الروابط المتكررة (10 مرات)!`, mentions: [sender] });
                        } catch (e) {}
                    } else {
                        await currentConn.sendMessage(from, { text: `⚠️ ممنوع إرسال اللينكات بالجروب يا حب 🐤❤️ @${cleanSenderNum}`, mentions: [sender] });
                    }
                    return true;
                }
            }

            // =========================================================================
            // 🗣️ 3️⃣ [أمر قول - جعل البوت يتحدث مع فلترة الألفاظ والرد]
            // =========================================================================
            if (normalizedBody.startsWith('قول ') || normalizedBody === 'قول') {
                let textToSay = body.replace(/^قول\s*/i, '').trim();
                if (!textToSay) {
                    await handleCommandTiming('💬');
                    await currentConn.sendMessage(from, { text: '⚠️ اكتب الكلام اللي عايزني أقوله، مثال:\n(قول مرحباً بكم جميعاً)' }, { quoted: mek });
                    return true;
                }

                const isBadPersonality = (currentConn.personality === 'bad' || currentConn.subBotConfig?.personality === 'bad');
                if (!isBadPersonality && containsBadWords(textToSay)) {
                    await handleCommandTiming('🐤');
                    await currentConn.sendMessage(from, { text: '❌ لا مقدرش اقول الكلام ده 🐤🚫' }, { quoted: mek });
                    return true;
                }

                await handleCommandTiming('🗣️');
                const ctxInfo = mek.message?.extendedTextMessage?.contextInfo;
                if (ctxInfo && ctxInfo.stanzaId && ctxInfo.quotedMessage) {
                    const targetQuotedMek = {
                        key: {
                            remoteJid: from,
                            id: ctxInfo.stanzaId,
                            participant: ctxInfo.participant,
                            fromMe: ctxInfo.participant ? (getCleanNumber(ctxInfo.participant) === getCleanNumber(currentConn.user?.id)) : false
                        },
                        message: ctxInfo.quotedMessage
                    };
                    let mentions = ctxInfo.participant ? [ctxInfo.participant] : [];
                    await currentConn.sendMessage(from, { text: textToSay, mentions: mentions }, { quoted: targetQuotedMek });
                } else {
                    await currentConn.sendMessage(from, { text: textToSay });
                }
                return true;
            }

            // =========================================================================
            // 🎙️ [أمر انطق - تحويل النص إلى فويس ذكاء اصطناعي PTT]
            // =========================================================================
            if (normalizedBody.startsWith('انطق ') || normalizedBody === 'انطق' || normalizedBody.startsWith('فويس ') || normalizedBody === 'فويس') {
                let textToSpeak = body.replace(/^(انطق|فويس)\s*/i, '').trim();
                if (!textToSpeak) {
                    const ctx = mek.message?.extendedTextMessage?.contextInfo;
                    textToSpeak = ctx?.quotedMessage?.conversation ||
                                  ctx?.quotedMessage?.extendedTextMessage?.text ||
                                  ctx?.quotedMessage?.imageMessage?.caption ||
                                  ctx?.quotedMessage?.videoMessage?.caption || '';
                }

                if (!textToSpeak) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '⚠️ اكتب الكلام اللي عايزني أنطقه، مثال:\n(انطق مرحباً بكم في شادو بوت)\nأو اعمل ريبلاي على أي رسالة واكتب (انطق)!' }, { quoted: mek });
                    return true;
                }

                const isBadPersonality = (currentConn.personality === 'bad' || currentConn.subBotConfig?.personality === 'bad');
                if (!isBadPersonality && containsBadWords(textToSpeak)) {
                    await handleCommandTiming('🐤');
                    await currentConn.sendMessage(from, { text: '❌ لا مقدرش أنطق الكلام ده عيب يا حب 🐤🚫' }, { quoted: mek });
                    return true;
                }

                await handleCommandTiming('🎙️');
                try {
                    const audioBuffer = await generateTTSBuffer(textToSpeak);
                    if (audioBuffer && audioBuffer.length > 0) {
                        const opusBuffer = await convertMp3ToOpus(audioBuffer);
                        if (opusBuffer && opusBuffer.length > 0) {
                            await currentConn.sendMessage(from, {
                                audio: opusBuffer,
                                mimetype: 'audio/ogg; codecs=opus',
                                ptt: true
                            }, { quoted: mek });
                        } else {
                            await currentConn.sendMessage(from, {
                                audio: audioBuffer,
                                mimetype: 'audio/mpeg'
                            }, { quoted: mek });
                        }
                    } else {
                        await currentConn.sendMessage(from, { text: '❌ تعذر تحويل النص إلى صوت حالياً، جرب مرة أخرى.' }, { quoted: mek });
                    }
                } catch (err) {
                    console.error("Error in TTS command:", err);
                    await currentConn.sendMessage(from, { text: '❌ حدث خطأ أثناء إنشاء الفويس، حاول لاحقاً.' }, { quoted: mek });
                }
                return true;
            }

            // =========================================================================
            // 📸 [أمر الاستيكر والملصقات - تحويل الصور والريبلاي لستيكر بحقوق شادو بوت]
            // =========================================================================
            const isStickerHandled = await handleStickerCommand(mek, currentConn, body);
            if (isStickerHandled) return true;

            // =========================================================================
            // 🖼️ [أمر الصور الشامل والذكاء الاصطناعي - جلب ورسم أي صورة مع توقيع البوت]
            // =========================================================================
            const isImageHandled = await handleImageCommand(mek, currentConn, body);
            if (isImageHandled) return true;

            // =========================================================================
            // 👤 [أمر بروف / صورة البروفايل لأي شخص بجودة عالية]
            // =========================================================================
            const isPfpCommand = /^(?:\.|\/|!)?(?:بروف|البروف|بروفايل|البروفايل|صوره بروفايل|صورة بروفايل|صوره البروفايل|صورة البروفايل|صورة الشخص|صوره الشخص)(?:\s|$)/i.test(normalizedBody);
            if (isPfpCommand) {
                await handleCommandTiming('👤');
                let target = extractTarget(mek, body);
                if (!target) {
                    target = sender;
                }

                let cleanTarget = getCleanNumber(target);
                let candidates = [];

                // 1. فحص وجود رقم هاتف حقيقي مطابق في lidMap
                const mappedNum = localDB.lidMap?.[cleanTarget];
                if (mappedNum) {
                    if (mappedNum.length <= 13) candidates.push(`${mappedNum}@s.whatsapp.net`);
                    else candidates.push(`${mappedNum}@lid`);
                }

                // 2. إذا كان المعرف الأصلي به رقم هاتف عادي
                if (target.endsWith('@s.whatsapp.net') || cleanTarget.length <= 13) {
                    candidates.push(`${cleanTarget}@s.whatsapp.net`);
                }

                // 3. كـ LID
                if (target.endsWith('@lid') || cleanTarget.length > 13) {
                    candidates.push(`${cleanTarget}@lid`);
                }

                // 4. المعرف الأصلي منقى من أي معرف أجهزة
                const rawJidClean = target.split('@')[0].split(':')[0] + (target.endsWith('@lid') ? '@lid' : '@s.whatsapp.net');
                if (!candidates.includes(rawJidClean)) candidates.push(rawJidClean);

                let pfpUrl = null;
                for (const cand of candidates) {
                    try {
                        pfpUrl = await currentConn.profilePictureUrl(cand, 'image');
                        if (pfpUrl) break;
                    } catch (_) {}
                    try {
                        pfpUrl = await currentConn.profilePictureUrl(cand, 'preview');
                        if (pfpUrl) break;
                    } catch (_) {}
                    try {
                        pfpUrl = await currentConn.profilePictureUrl(cand);
                        if (pfpUrl) break;
                    } catch (_) {}
                }

                if (pfpUrl) {
                    const mentionJid = candidates.find(c => c.endsWith('@s.whatsapp.net')) || target;
                    await currentConn.sendMessage(from, {
                        image: { url: pfpUrl },
                        caption: `👤 *صورة البروفايل للغالي:* @${cleanTarget}\n🤖 *بواسطة:* ${botName}`,
                        mentions: [mentionJid]
                    }, { quoted: mek });
                    return true;
                } else {
                    await currentConn.sendMessage(from, {
                        text: `❌ *تعذر جلب صورة البروفايل لـ @${cleanTarget}!* 👤\n(إما أنه مش حاطط صورة بروفايل، أو إعدادات خصوصيته في الواتساب مخصصة لجهات الاتصال فقط).`,
                        mentions: [target]
                    }, { quoted: mek });
                    return true;
                }
            }

            // =========================================================================
            // 📢 [أمر قناة المطور الرسمية]
            // =========================================================================
            const isChannelCommand = /^(?:\.|\/)?(قناة المطور|قناه المطور|قناة شادو|قناه شادو|قناة|قناه|القناة|القناه|قناة الواتس|قناة البوت)(?:\s|$)/i.test(normalizedBody);
            if (isChannelCommand) {
                await handleCommandTiming('📢');
                const channelMsg = 
                    `📢 *قناة المطور الرسمية (الحج شادو)* 📢\n\n` +
                    `تابع كافة التحديثات، الإعلانات، والمميزات الجديدة والشروحات الحصرية عبر قناة الواتساب الرسمية:\n\n` +
                    `🔗 *رابط القناة للانضمام:*\nhttps://whatsapp.com/channel/0029VbDsDKlKgsNryj6w0A1F\n\n` +
                    `✨ شرفنا بانضمامك يا غالي! ❤️`;
                await currentConn.sendMessage(from, { text: channelMsg }, { quoted: mek });
                return true;
            }

            // =========================================================================
            // 🎵 [أمر الأغاني - بحث وعرض أي أغنية مع البوستر ورابط اليوتيوب]
            // =========================================================================
            const isSongCommand = normalizedBody.startsWith('اغنيه ') ||
                                  normalizedBody === 'اغنيه' ||
                                  normalizedBody.startsWith('اغنية ') ||
                                  normalizedBody === 'اغنية' ||
                                  normalizedBody.startsWith('أغنية ') ||
                                  normalizedBody === 'أغنية' ||
                                  normalizedBody.startsWith('أغنيه ') ||
                                  normalizedBody === 'أغنيه' ||
                                  normalizedBody.startsWith('شغل ') ||
                                  normalizedBody.startsWith('song ');

            if (isSongCommand) {
                let songName = body.replace(/^(اغنيه|اغنية|أغنية|أغنيه|شغل|song)\s*/i, '').trim();
                if (!songName) {
                    const ctx = mek.message?.extendedTextMessage?.contextInfo;
                    songName = ctx?.quotedMessage?.conversation ||
                               ctx?.quotedMessage?.extendedTextMessage?.text || '';
                }

                if (!songName) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '🎵 *ابحث عن أي أغنية تريدها بسهولة!*\n\nاكتب اسم الأغنية بعد الأمر، مثل:\n*اغنية ويجز البخت*\n*اغنية عمرو دياب تملي معاك*\n*song Shape of you*' }, { quoted: mek });
                    return true;
                }

                await handleCommandTiming('🎧');
                try {
                    const songData = await searchYouTubeSong(songName);
                    if (songData && songData.url) {
                        const activeBotTitle = botName || currentConn.botName || 'شادو';
                        const isUnder10Min = songData.durationSec > 0 && songData.durationSec <= 600;

                        const caption = `🎶 *تم العثور على الأغنية:* ✨\n\n📌 *العنوان:* ${songData.title}\n🎙️ *الفنان / القناة:* ${songData.channel}\n⏱️ *المدة:* ${songData.duration}\n\n🔗 *رابط الأغنية على يوتيوب:*\n${songData.url}\n\n🎧 _استماع ممتع مع ${activeBotTitle}!_ 🐥💫`;

                        // إرسال البوستر مع معلومات الأغنية
                        await currentConn.sendMessage(from, {
                            image: { url: songData.thumbnail },
                            caption: caption
                        }, { quoted: mek });

                        // إذا كانت مدة الأغنية 10 دقائق أو أقل، يتم إرسال فويس للأغنية
                        if (isUnder10Min) {
                            try {
                                const songAudioBuffer = await fetchAudioBufferForSong(songData.title);
                                if (songAudioBuffer && songAudioBuffer.length > 0) {
                                    const opusSongBuffer = await convertMp3ToOpus(songAudioBuffer);
                                    if (opusSongBuffer && opusSongBuffer.length > 0) {
                                        await currentConn.sendMessage(from, {
                                            audio: opusSongBuffer,
                                            mimetype: 'audio/ogg; codecs=opus',
                                            ptt: true
                                        }, { quoted: mek });
                                    } else {
                                        await currentConn.sendMessage(from, {
                                            audio: songAudioBuffer,
                                            mimetype: 'audio/mpeg'
                                        }, { quoted: mek });
                                    }
                                }
                            } catch (audioErr) {
                                console.error('Audio stream fetch error:', audioErr?.message || audioErr);
                            }
                        }
                    } else {
                        await currentConn.sendMessage(from, { text: `❌ لم يتم العثور على نتائج للأغنية: *${songName}*، تأكد من كتابة الاسم بشكل صحيح.` }, { quoted: mek });
                    }
                } catch (err) {
                    console.error("Error in song command:", err);
                    await currentConn.sendMessage(from, { text: '❌ حدث خطأ أثناء جلب الأغنية، جرب مرة ثانية.' }, { quoted: mek });
                }
                return true;
            }



            // =========================================================================
            // 🚪 4️⃣ [مغادرة الجروب - لمالك البوت أو الحج شادو الأصلي]
            // =========================================================================
            const callName = currentConn.callName || currentConn.subBotConfig?.callName || '';
            const normalizedCallName = normalizeArabic((callName || '').toLowerCase().trim());

            let specifiedName = '';
            let isLeaveMatch = false;

            if (isGroup) {
                const leaveRegex1 = /^(?:اخرج|غادر|خروج)(?:\s+(?:يا\s+)?(.+))?$/i;
                const leaveRegex2 = /^(?:يا\s+)?(.+?)\s+(?:اخرج|غادر|خروج)$/i;

                let matchL1 = normalizedBody.match(leaveRegex1);
                let matchL2 = normalizedBody.match(leaveRegex2);

                if (matchL1) {
                    isLeaveMatch = true;
                    if (matchL1[1]) specifiedName = normalizeArabic(matchL1[1].replace(/^يا\s+/, '').trim().toLowerCase());
                } else if (matchL2) {
                    isLeaveMatch = true;
                    if (matchL2[1]) specifiedName = normalizeArabic(matchL2[1].replace(/^يا\s+/, '').trim().toLowerCase());
                }
            }

            if (isLeaveMatch) {
                // إذا كتب الأمر شخص ليس مالك هذا البوت وليس الحج شادو: صمت تام لتفادي السبام
                if (!isBotOwner) {
                    return true;
                }

                const matchesThisBot = (
                    specifiedName === normalizedBotName || 
                    (normalizedCallName && specifiedName === normalizedCallName) || 
                    specifiedName === 'الكل' ||
                    (!currentConn.isSubBot && (specifiedName === 'شادو' || specifiedName === 'الرئيسي'))
                );

                // لو المُرسل هو مالك البوت الفرعي (isSubBotAdmin وليس شادو):
                if (isSubBotAdmin && !isAbsoluteOwner) {
                    // مالك البوت الفرعي يتحكم فقط ببوته الخاص
                    if (specifiedName && !matchesThisBot) {
                        return true;
                    }
                    await handleCommandTiming('👋');
                    await currentConn.sendMessage(from, { text: `👋 *بأمر من الحج المالك.. جاري مغادرة بوت (${botName}) للمجموعة الآن! في رعاية الله.* 🤖✨` }, { quoted: mek });
                    setTimeout(async () => {
                        try { await currentConn.groupLeave(from); } catch (e) {}
                    }, DELAYS.actionExecute);
                    return true;
                }

                // لو المُرسل هو الحج الأصلي شادو (isAbsoluteOwner):
                if (isAbsoluteOwner) {
                    if (specifiedName) {
                        // شادو حدد اسم بوت معين (مثلاً: اخرج شادو أو اخرج زيزو أو اخرج يا زيزو)
                        if (!matchesThisBot) {
                            // هذا البوت ليس هو المطلوب، يصمت تماماً
                            return true;
                        }
                        await handleCommandTiming('👋');
                        await currentConn.sendMessage(from, { text: `👋 *أمرك يا حج شادو.. جاري مغادرة بوت (${botName}) للمجموعة فوراً! في رعاية الله.* 🤖✨` }, { quoted: mek });
                        setTimeout(async () => {
                            try { await currentConn.groupLeave(from); } catch (e) {}
                        }, DELAYS.actionExecute);
                        return true;
                    } else {
                        // شادو كتب "اخرج" بدون تحديد اسم
                        // فحص البوتات النشطة في الجروب
                        let botsInRoom = [];
                        try {
                            if (groupMetadata && groupMetadata.participants) {
                                const partNums = groupMetadata.participants.map(p => p.id.split('@')[0].split(':')[0]);
                                const mainPhone = '201129249396';
                                if (partNums.includes(mainPhone) || partNums.includes(myBotNum)) {
                                    botsInRoom.push({ name: 'شادو (البوت الرئيسي)', call: 'شادو', num: mainPhone });
                                }
                                const registry = loadSubBotsRegistry();
                                for (let p in registry) {
                                    if (partNums.includes(p)) {
                                        botsInRoom.push({ 
                                            name: registry[p].botName || 'بوت فرعي', 
                                            call: registry[p].callName || registry[p].botName || p, 
                                            num: p 
                                        });
                                    }
                                }
                            }
                        } catch (_) {}

                        // لو هناك أكثر من بوت في الجروب: يسأل شادو أي بوت يريد إخراجه
                        const isPrimaryResponder = !currentConn.isSubBot || myBotNum === '201129249396';
                        if (botsInRoom.length > 1) {
                            if (isPrimaryResponder) {
                                await handleCommandTiming('❓');
                                let listBots = botsInRoom.map((b, i) => `${i + 1}️⃣ *${b.name}* (اسم النداء: ${b.call})`).join('\n');
                                const askMsg = 
                                    `❓ *عايز تخرج أنهو بوت يا حج شادو؟* 🤖🚪\n\n` +
                                    `📍 *البوتات الموجودة في الروم:* \n${listBots}\n\n` +
                                    `💡 *لتحديد البوت المطلوب، اكتب:*\n*(اخرج [اسم البوت])* مثال:\n` +
                                    `• \`اخرج شادو\`\n` +
                                    `• \`اخرج [اسم النداء]\``;
                                await currentConn.sendMessage(from, { text: askMsg }, { quoted: mek });
                            }
                            return true;
                        }

                        // إذا كان بوت واحد فقط في الروم: يخرج فوراً
                        await handleCommandTiming('👋');
                        await currentConn.sendMessage(from, { text: `👋 *أمرك يا حج شادو.. جاري مغادرة بوت (${botName}) للمجموعة الآن! في رعاية الله.* 🤖✨` }, { quoted: mek });
                        setTimeout(async () => {
                            try { await currentConn.groupLeave(from); } catch (e) {}
                        }, DELAYS.actionExecute);
                        return true;
                    }
                }
            }

            // =========================================================================
            // 🛡️ 5️⃣ [أوامر إشراف الجروب - للمشرفين والحجاج]
            // =========================================================================
            if (isGroup) {
                // قفل الجروب
                if (isActualRoomAdminOrOwner && /^(قفل|اقفل|غلق|قفل الجروب|اقفل الجروب|قفل الروم|اقفل الروم|غلق الجروب|غلق الروم)$/i.test(normalizedBody)) {
                    if (groupMetadata?.announce) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ المجموعة مقفولة بالفعل للمشرفين فقط يا فنان! 🔒' }, { quoted: mek });
                        return true;
                    }
                    await handleCommandTiming('🔒');
                    try {
                        await currentConn.groupSettingUpdate(from, 'announcement');
                        groupMetaCache.delete(from);
                        await currentConn.sendMessage(from, { text: '🔒 *تم قفل المجموعة بنجاح!* \nالمشرفين فقط هم من يمكنهم إرسال الرسائل الآن.' }, { quoted: mek });
                    } catch (e) {
                        await currentConn.sendMessage(from, { text: '❌ تأكد أن البوت مشرف بالجروب لتنفيذ الأمر!' }, { quoted: mek });
                    }
                    return true;
                }

                // فتح الجروب
                if (isActualRoomAdminOrOwner && /^(فتح|افتح|فتح الجروب|افتح الجروب|فتح الروم|افتح الروم)$/i.test(normalizedBody)) {
                    if (groupMetadata && !groupMetadata.announce) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ المجموعة مفتوحة بالفعل لجميع الأعضاء يا فنان! 🔓' }, { quoted: mek });
                        return true;
                    }
                    await handleCommandTiming('🔓');
                    try {
                        await currentConn.groupSettingUpdate(from, 'not_announcement');
                        groupMetaCache.delete(from);
                        await currentConn.sendMessage(from, { text: '🔓 *تم فتح المجموعة بنجاح!* \nيمكن لجميع الأعضاء إرسال الرسائل الآن.' }, { quoted: mek });
                    } catch (e) {
                        await currentConn.sendMessage(from, { text: '❌ تأكد أن البوت مشرف بالجروب لتنفيذ الأمر!' }, { quoted: mek });
                    }
                    return true;
                }

                // تفعيل الترحيب
                if (isActualRoomAdminOrOwner && (normalizedBody === 'تفعيل الترحيب' || normalizedBody === 'تشغيل الترحيب')) {
                    if (!localDB.disabledWelcomes?.includes(from)) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ رسائل الترحيب مفعلة وشغالة بالفعل في هذا الجروب! ✅' }, { quoted: mek });
                        return true;
                    }
                    localDB.disabledWelcomes = localDB.disabledWelcomes.filter(g => g !== from);
                    saveLocalDB(localDB);
                    await handleCommandTiming('👋');
                    await currentConn.sendMessage(from, { text: '✅ *تم تفعيل رسائل الترحيب التلقائية بالأعضاء الجدد بنجاح!* 🎉' }, { quoted: mek });
                    return true;
                }

                // إلغاء الترحيب
                if (isActualRoomAdminOrOwner && (normalizedBody === 'الغاء الترحيب' || normalizedBody === 'القاء الترحيب' || normalizedBody === 'ايقاف الترحيب')) {
                    if (localDB.disabledWelcomes?.includes(from)) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ رسائل الترحيب معطلة بالفعل في هذا الجروب! ❌' }, { quoted: mek });
                        return true;
                    }
                    if (!localDB.disabledWelcomes) localDB.disabledWelcomes = [];
                    localDB.disabledWelcomes.push(from);
                    saveLocalDB(localDB);
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ *تم إيقاف وتعطيل رسائل الترحيب التلقائية بالجروب بنجاح!*' }, { quoted: mek });
                    return true;
                }

                // قفل وقتي وفتح وقتي
                if (isActualRoomAdminOrOwner && (normalizedBody.startsWith('قفل وقتي') || normalizedBody.startsWith('فتح وقتي'))) {
                    let cleanBody = convertArabicNumbers(body);
                    const timeMatch = cleanBody.match(/([0-2]?[0-9]):[0-5][0-9]/);
                    if (!timeMatch) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '❌ اكتب الوقت بصيغة 24 ساعة صحيحة (مثال: قفل وقتي 23:00 أو فتح وقتي 07:30)' }, { quoted: mek });
                        return true;
                    }
                    let parts = timeMatch[0].split(':');
                    let hoursPart = parts[0].padStart(2, '0');
                    let minutesPart = parts[1].padStart(2, '0');
                    if (hoursPart === '24') hoursPart = '00';
                    const inputtedTime = `${hoursPart}:${minutesPart}`;

                    if (!localDB.timedGroupControls) localDB.timedGroupControls = {};
                    if (!localDB.timedGroupControls[from]) localDB.timedGroupControls[from] = { closeTime: null, openTime: null };

                    await handleCommandTiming('⏱️');
                    if (normalizedBody.startsWith('قفل وقتي')) {
                        localDB.timedGroupControls[from].closeTime = inputtedTime;
                        saveLocalDB(localDB);
                        await currentConn.sendMessage(from, { text: `⏱️ *تمت الجدولة بنجاح!* \n🔒 شادو هيقفل الجروب تلقائياً الساعة *${inputtedTime === '00:00' ? '12:00 منتصف الليل' : inputtedTime}* بتوقيت مصر.` }, { quoted: mek });
                    } else {
                        localDB.timedGroupControls[from].openTime = inputtedTime;
                        saveLocalDB(localDB);
                        await currentConn.sendMessage(from, { text: `⏱️ *تمت الجدولة بنجاح!* \n🔓 شادو هيفتح الجروب تلقائياً الساعة *${inputtedTime === '00:00' ? '12:00 منتصف الليل' : inputtedTime}* بتوقيت مصر.` }, { quoted: mek });
                    }
                    return true;
                }

                // المواعيد الوقتية
                if (normalizedBody === 'المواعيد الوقتية' || normalizedBody === 'المواعيد الوقتيه') {
                    const config = localDB.timedGroupControls?.[from];
                    await handleCommandTiming('📋');
                    if (!config || (!config.closeTime && !config.openTime)) {
                        await currentConn.sendMessage(from, { text: '📋 مفيش أي مواعيد مجدولة لقفل أو فتح هذا الجروب حالياً.' }, { quoted: mek });
                    } else {
                        let scheduleMsg = `📋 *مواعيد التحكم التلقائي بالجروب:* \n\n`;
                        scheduleMsg += config.closeTime ? `🔒 *ميعاد القفل اليومي:* ${config.closeTime}\n` : `🔒 *ميعاد القفل:* غير محدد\n`;
                        scheduleMsg += config.openTime ? `🔓 *ميعاد الفتح اليومي:* ${config.openTime}\n` : `🔓 *ميعاد الفتح:* غير محدد\n`;
                        scheduleMsg += `\n⏰ التوقيت المعتمد هو توقيت مصر المحلي الحالي.`;
                        await currentConn.sendMessage(from, { text: scheduleMsg }, { quoted: mek });
                    }
                    return true;
                }

                // إلغاء المواعيد الوقتية
                if (isActualRoomAdminOrOwner && (normalizedBody === 'الغاء المواعيد الوقتية' || normalizedBody === 'الغاء المواعيد الوقتيه')) {
                    await handleCommandTiming('🗑️');
                    if (localDB.timedGroupControls && localDB.timedGroupControls[from]) {
                        delete localDB.timedGroupControls[from];
                        saveLocalDB(localDB);
                    }
                    await currentConn.sendMessage(from, { text: '🗑️ تم إلغاء وحذف كافة مواعيد القفل والفتح التلقائي للروم بنجاح!' }, { quoted: mek });
                    return true;
                }

                // رفع أدمن
                if (isActualRoomAdminOrOwner && (normalizedBody.startsWith('رفع ادمن') || normalizedBody.startsWith('رفع مشرف') || normalizedBody.startsWith('ترقيه') || normalizedBody.startsWith('ترقية'))) {
                    let target = extractTarget(mek, body);
                    if (!target) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ منشن العضو أو رد على رسالته لترقيته مشرفاً!' }, { quoted: mek });
                        return true;
                    }
                    let targetNum = getCleanNumber(target);
                    if (groupAdmins.includes(targetNum) || (localDB.lidMap?.[targetNum] && groupAdmins.includes(localDB.lidMap[targetNum]))) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: `⚠️ العضو @${targetNum} مشرف بالفعل في المجموعة! 🛡️`, mentions: [target] }, { quoted: mek });
                        return true;
                    }
                    await handleCommandTiming('👑');
                    try {
                        await currentConn.groupParticipantsUpdate(from, [target], 'promote');
                        groupMetaCache.delete(from);
                        await currentConn.sendMessage(from, { text: `👑 *تمت الترقية بنجاح!* \nتم رفع @${targetNum} مشرفاً في المجموعة. 🛡️`, mentions: [target] }, { quoted: mek });
                    } catch (e) {
                        await currentConn.sendMessage(from, { text: '❌ تعذر رفع المشرف. تأكد أن البوت مشرف ولديه الصلاحيات الكافية!' }, { quoted: mek });
                    }
                    return true;
                }

                // تنزيل أدمن
                if (isActualRoomAdminOrOwner && (normalizedBody.startsWith('نزل ادمن') || normalizedBody.startsWith('نزل مشرف') || normalizedBody.startsWith('تنزيل ادمن') || normalizedBody.startsWith('تنزيل مشرف') || normalizedBody.startsWith('تنزيل') || normalizedBody.startsWith('سحب الاشراف'))) {
                    let target = extractTarget(mek, body);
                    if (!target) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ منشن المشرف أو رد على رسالته لتنزيله!' }, { quoted: mek });
                        return true;
                    }
                    let targetNum = getCleanNumber(target);
                    if (targetNum === ownerPhone || targetNum === ownerLid || targetNum === ownerAltPhone || localDB.lidMap?.[targetNum] === ownerPhone) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: '❌ لا يمكنك تنزيل الحج شادو الأصلي صاحب البوت! 👑🛡️' }, { quoted: mek });
                        return true;
                    }
                    if (targetNum === groupCreatorRaw) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: '❌ لا يمكنك تنزيل منشئ المجموعة!' }, { quoted: mek });
                        return true;
                    }
                    if (!groupAdmins.includes(targetNum) && (!localDB.lidMap?.[targetNum] || !groupAdmins.includes(localDB.lidMap[targetNum]))) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: `⚠️ العضو @${targetNum} ليس مشرفاً بالفعل في المجموعة! 📉`, mentions: [target] }, { quoted: mek });
                        return true;
                    }
                    await handleCommandTiming('📉');
                    try {
                        await currentConn.groupParticipantsUpdate(from, [target], 'demote');
                        groupMetaCache.delete(from);
                        await currentConn.sendMessage(from, { text: `📉 *تم تنزيل الرتبة بنجاح!* \nتم سحب الإشراف من @${targetNum}.`, mentions: [target] }, { quoted: mek });
                    } catch (e) {
                        await currentConn.sendMessage(from, { text: '❌ تعذر تنزيل المشرف. تأكد من صلاحيات البوت!' }, { quoted: mek });
                    }
                    return true;
                }

                // طرد عضو
                if (isActualRoomAdminOrOwner && (normalizedBody.startsWith('طرد') || normalizedBody.startsWith('اطرد') || normalizedBody.startsWith('كيك'))) {
                    let target = extractTarget(mek, body);
                    if (!target) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ منشن العضو أو رد على رسالته لطرده من الجروب!' }, { quoted: mek });
                        return true;
                    }
                    let targetNum = getCleanNumber(target);
                    if (targetNum === ownerPhone || targetNum === ownerLid || targetNum === groupCreatorRaw || isUserInList(target, localDB.mainHajjUsers)) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: '❌ لا يمكن طرد الحج شادو أو منشئ المجموعة أو الحجاج المعتمدين!' }, { quoted: mek });
                        return true;
                    }
                    await handleCommandTiming('👋');
                    try {
                        await currentConn.groupParticipantsUpdate(from, [target], 'remove');
                        groupMetaCache.delete(from);
                        await currentConn.sendMessage(from, { text: `👋 *تم الطرد بنجاح!* \nمع السلامة يا @${targetNum}، الجروب أنظف من غيرك. 🚪`, mentions: [target] }, { quoted: mek });
                    } catch (e) {
                        await currentConn.sendMessage(from, { text: '❌ تعذر طرد العضو. تأكد أن البوت مشرف بالجروب!' }, { quoted: mek });
                    }
                    return true;
                }

                // حذف رسالة
                if (isActualRoomAdminOrOwner && ['حذف', 'احذف', 'مسح', 'امسح', 'ديليت', 'delete'].includes(normalizedBody)) {
                    const ctxInfo = mek.message?.extendedTextMessage?.contextInfo;
                    if (!ctxInfo || !ctxInfo.stanzaId) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ رد على الرسالة التي تريد حذفها بكلمة (حذف)!' }, { quoted: mek });
                        return true;
                    }
                    try {
                        // 1. حذف الرسالة المقصودة (المشار إليها بالريبلاي)
                        await currentConn.sendMessage(from, {
                            delete: {
                                remoteJid: from,
                                fromMe: ctxInfo.participant ? (getCleanNumber(ctxInfo.participant) === getCleanNumber(currentConn.user?.id)) : false,
                                id: ctxInfo.stanzaId,
                                participant: ctxInfo.participant
                            }
                        });

                        // 2. حذف رسالة العضو التي تحتوي على كلمة (حذف / احذف) ليبقى الشات نظيفاً تماماً
                        await delay(300);
                        await currentConn.sendMessage(from, {
                            delete: {
                                remoteJid: from,
                                fromMe: Boolean(mek.key?.fromMe),
                                id: mek.key?.id,
                                participant: mek.key?.participant || sender
                            }
                        }).catch(() => {});
                    } catch (e) {
                        await currentConn.sendMessage(from, { text: '❌ تعذر حذف الرسالة. تأكد أن البوت مشرف بالجروب!' }, { quoted: mek });
                    }
                    return true;
                }

                // كتم عضو (حذف كل رسائله بالجروب فوراً وتلقائياً)
                const isMuteCmd = /^(?:\.|\/|!)?(?:كتم|اكتم|اسكت)(?:\s|$)/i.test(normalizedBody);
                if (isMuteCmd) {
                    if (!isActualRoomAdminOrOwner) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: '❌ عذراً يا غالي.. أمر الكتم مخصص لمشرفين الجروب والحج شادو فقط! 🛡️' }, { quoted: mek });
                        return true;
                    }

                    let target = extractTarget(mek, body);
                    if (!target) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ رد على رسالة العضو بكلمة (كتم) أو اعمله منشن لكتمه ومنعه من التحدث بالجروب!\n(مثال: كتم @العضو أو ريبلاي على رسالته)' }, { quoted: mek });
                        return true;
                    }

                    const targetNum = getCleanNumber(target);
                    if (targetNum === '201129249396' || target.includes('194961618301016') || isUserInList(target, localDB.mainHajjUsers) || isUserInList(target, localDB.hajjUsers)) {
                        await handleCommandTiming('👑');
                        await currentConn.sendMessage(from, { text: '❌ عيب يا فنان.. لا يمكن كتم الحج شادو أو الحجاج المعتمدين!' }, { quoted: mek });
                        return true;
                    }

                    if (targetNum === myBotNum || target.includes(myBotNum)) {
                        await handleCommandTiming('🤖');
                        await currentConn.sendMessage(from, { text: '❌ ما ينفعش تكتم البوت يا فنان!' }, { quoted: mek });
                        return true;
                    }

                    if (targetNum === groupCreatorRaw) {
                        await handleCommandTiming('👑');
                        await currentConn.sendMessage(from, { text: '❌ لا يمكن كتم منشئ الجروب!' }, { quoted: mek });
                        return true;
                    }

                    if (!localDB.mutedUsers) localDB.mutedUsers = {};
                    if (!localDB.mutedUsers[from]) localDB.mutedUsers[from] = [];

                    const mappedTarget = localDB.lidMap?.[targetNum] || '';
                    const alreadyMuted = localDB.mutedUsers[from].some(u => {
                        const cu = getCleanNumber(u);
                        return cu === targetNum || (mappedTarget && cu === mappedTarget) || u === target;
                    });

                    if (alreadyMuted) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: `⚠️ العضو @${targetNum} مكتوم بالفعل في هذا الجروب!`, mentions: [target] }, { quoted: mek });
                        return true;
                    }

                    localDB.mutedUsers[from].push(targetNum);
                    if (mappedTarget && !localDB.mutedUsers[from].includes(mappedTarget)) {
                        localDB.mutedUsers[from].push(mappedTarget);
                    }
                    if (!localDB.mutedUsers[from].includes(target)) {
                        localDB.mutedUsers[from].push(target);
                    }
                    saveLocalDB(localDB);

                    await handleCommandTiming('🔇');
                    await currentConn.sendMessage(from, {
                        text: `🔇 *تم كتم العضو @${targetNum} بنجاح!* 🛑\n\nلن يستطيع التحدث في المجموعة، وأي رسالة سيرسلها هنا سيقوم البوت بحذفها فوراً وتلقائياً.`,
                        mentions: [target]
                    }, { quoted: mek });
                    return true;
                }

                // فك كتم عضو
                const isUnmuteCmd = /^(?:\.|\/|!)?(?:فك\s*كتم|فك\s*الكتم|الغاء\s*كتم|إلغاء\s*كتم|تكلم)(?:\s|$)/i.test(normalizedBody);
                if (isUnmuteCmd) {
                    if (!isActualRoomAdminOrOwner) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: '❌ عذراً يا غالي.. هذا الأمر مخصص لمشرفين الجروب والحج شادو فقط! 🛡️' }, { quoted: mek });
                        return true;
                    }

                    let target = extractTarget(mek, body);
                    if (!target) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ رد على رسالة العضو بكلمة (فك كتم) أو اعمله منشن لفك الكتم عنه!' }, { quoted: mek });
                        return true;
                    }

                    const targetNum = getCleanNumber(target);
                    const mappedTarget = localDB.lidMap?.[targetNum] || '';

                    if (!localDB.mutedUsers || !localDB.mutedUsers[from]) {
                        await handleCommandTiming('ℹ️');
                        await currentConn.sendMessage(from, { text: `ℹ️ العضو @${targetNum} ليس مكتوماً في هذا الجروب!`, mentions: [target] }, { quoted: mek });
                        return true;
                    }

                    const isMutedNow = localDB.mutedUsers[from].some(u => {
                        const cu = getCleanNumber(u);
                        return cu === targetNum || (mappedTarget && cu === mappedTarget) || u === target;
                    });

                    if (!isMutedNow) {
                        await handleCommandTiming('ℹ️');
                        await currentConn.sendMessage(from, { text: `ℹ️ العضو @${targetNum} ليس مكتوماً في هذا الجروب!`, mentions: [target] }, { quoted: mek });
                        return true;
                    }

                    localDB.mutedUsers[from] = localDB.mutedUsers[from].filter(u => {
                        const cu = getCleanNumber(u);
                        return cu !== targetNum && cu !== mappedTarget && u !== target;
                    });
                    saveLocalDB(localDB);

                    await handleCommandTiming('🔊');
                    await currentConn.sendMessage(from, {
                        text: `🔊 *تم فك الكتم عن @${targetNum} بنجاح!* ✨\nأصبح بإمكانه المشاركة وإرسال الرسائل في المجموعة الآن.`,
                        mentions: [target]
                    }, { quoted: mek });
                    return true;
                }

                // عرض قائمة المكتومين
                if (isActualRoomAdminOrOwner && (normalizedBody === 'المكتومين' || normalizedBody === 'قائمة المكتومين')) {
                    await handleCommandTiming('📋');
                    const mutedList = localDB.mutedUsers?.[from] || [];
                    if (mutedList.length === 0) {
                        await currentConn.sendMessage(from, { text: '✨ لا يوجد أي أعضاء مكتومين حالياً في هذا الجروب.' }, { quoted: mek });
                        return true;
                    }
                    let listText = `🔇 *قائمة الأعضاء المكتومين في الجروب (${mutedList.length}):*\n\n`;
                    for (let i = 0; i < mutedList.length; i++) {
                        listText += `${i + 1}️⃣ @${getCleanNumber(mutedList[i])}\n`;
                    }
                    listText += `\n💡 لفك كتم أي عضو اكتب: *(فك كتم @العضو)*`;
                    await currentConn.sendMessage(from, { text: listText, mentions: mutedList }, { quoted: mek });
                    return true;
                }

                // حماية الجروب ضد التبنيد والتخريب
                if (isActualRoomAdminOrOwner && (normalizedBody.startsWith('حماية الجروب') || normalizedBody.startsWith('حمايه الجروب') || normalizedBody.startsWith('ضد التبنيد') || normalizedBody.startsWith('حماية الروم') || normalizedBody.startsWith('حمايه الروم'))) {
                    if (!localDB.groupProtection) localDB.groupProtection = {};

                    if (normalizedBody.includes('تشغيل') || normalizedBody.includes('تفعيل') || normalizedBody.includes('فتح')) {
                        localDB.groupProtection[from] = true;
                        saveLocalDB(localDB);

                        // قفل تعديل معلومات الجروب للمشرفين فقط لمنع تغيير الاسم لألفاظ محظورة
                        try {
                            await currentConn.groupSettingUpdate(from, 'locked');
                        } catch (_) {}

                        await handleCommandTiming('🛡️');
                        const shieldMsg = 
                            `🛡️ *تم تفعيل درع حماية الجروب ضد التبنيد والتخريب بنجاح!* 🔒\n\n` +
                            `✅ *الإجراءات الأمنية المفعلة الآن:*\n` +
                            `• 🔒 *قفل معلومات الجروب:* تم قفل تعديل الاسم والوصف والصورة للمشرفين فقط لمنع أي مخرب من تغيير الاسم لكلمات محظورة تسبب حظر الجروب.\n` +
                            `• 💣 *مكافحة الفيروسات والكراش:* الحذف الفوري لأي رسائل كراش أو فيروسات هبوط (Virtex/Crash Text) قد تتسبب في تبنيد الروم.\n` +
                            `• 🚫 *حماية مشددة ضد الروابط:* منع اللينكات وحذفها تلقائياً.\n` +
                            `• 👤 *مراقبة التخريب:* حماية الروم من الطرد العشوائي.\n\n` +
                            `✨ *الجروب الآن في أمان تام وتحت حماية بوت ${botName}!* 🛡️`;
                        await currentConn.sendMessage(from, { text: shieldMsg }, { quoted: mek });
                        return true;
                    }

                    if (normalizedBody.includes('ايقاف') || normalizedBody.includes('إيقاف') || normalizedBody.includes('تعطيل') || normalizedBody.includes('قفل')) {
                        localDB.groupProtection[from] = false;
                        saveLocalDB(localDB);

                        await handleCommandTiming('🔓');
                        await currentConn.sendMessage(from, { text: '🔓 *تم إيقاف وضع حماية الجروب ضد التبنيد.*' }, { quoted: mek });
                        return true;
                    }

                    // عرض الحالة
                    const isProtected = Boolean(localDB.groupProtection[from]);
                    await handleCommandTiming('🛡️');
                    const statusMsg = 
                        `🛡️ *نظام حماية الجروبات ضد التبنيد والتخريب* 🛡️\n\n` +
                        `📊 *الحالة الحالية في هذا الجروب:* ${isProtected ? 'مفعل ومحمي ✅' : 'معطل ❌'}\n\n` +
                        `📌 *للتحكم في الحماية:*\n` +
                        `• لتشغيل الحماية: *(حماية الجروب تشغيل)* 🛡️\n` +
                        `• لإيقاف الحماية: *(حماية الجروب ايقاف)* 🔓`;
                    await currentConn.sendMessage(from, { text: statusMsg }, { quoted: mek });
                    return true;
                }
                if (isActualRoomAdminOrOwner && /^(لينك|اللينك|رابط|الرابط|لينك الجروب|اللينك الجروب|رابط الجروب|الرابط الجروب|لينك الروم|رابط الروم)$/i.test(normalizedBody)) {
                    await handleCommandTiming('🔗');
                    try {
                        let code = await currentConn.groupInviteCode(from);
                        await currentConn.sendMessage(from, { text: `🔗 *رابط دعوة الجروب:* \nhttps://chat.whatsapp.com/${code}` }, { quoted: mek });
                    } catch (e) {
                        await currentConn.sendMessage(from, { text: '❌ تعذر استخراج الرابط. تأكد أن البوت مشرف بالجروب!' }, { quoted: mek });
                    }
                    return true;
                }

                // معلومات الجروب
                if (['معلومات الجروب', 'تفاصيل الجروب', 'معلومات الروم', 'تفاصيل الروم'].includes(normalizedBody)) {
                    await handleCommandTiming('📋');
                    let subject = groupMetadata?.subject || 'بدون اسم';
                    let desc = groupMetadata?.desc || 'لا يوجد وصف حالياً';
                    let membersCount = participants.length;
                    let actualAdminsList = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
                    let adminsCount = actualAdminsList.length;
                    let isLocked = !!groupMetadata?.announce;
                    let isWelcome = !localDB.disabledWelcomes?.includes(from);
                    let infoText = `╭━━━〔 📋 *معلومات الجروب* 〕━━━╮\n\n` +
                                   `🏷️ *اسم الجروب:* ${subject}\n` +
                                   `👥 *عدد الأعضاء:* ${membersCount} عضو\n` +
                                   `🛡️ *عدد المشرفين:* ${adminsCount} مشرف\n` +
                                   `🔒 *حالة الإرسال:* ${isLocked ? 'مقفول للمشرفين فقط 🔒' : 'مفتوح للجميع 🔓'}\n` +
                                   `👋 *الترحيب التلقائي:* ${isWelcome ? 'مفعل ✅' : 'معطل ❌'}\n\n` +
                                   `📝 *الوصف:* \n${desc}\n` +
                                   `╰━━━━━━━━━━━━━━━━━━━━╯`;
                    await currentConn.sendMessage(from, { text: infoText }, { quoted: mek });
                    return true;
                }

                // عدد الناس
                if (normalizedBody === 'عدد الناس' || normalizedBody === 'العدد' || normalizedBody === 'عدد الاعضاء') {
                    await handleCommandTiming('📊');
                    let count = participants.length;
                    await currentConn.sendMessage(from, { text: `📊 *عدد الناس المتواجدين في الروم حالياً هو:* ${count} عضو ✨` }, { quoted: mek });
                    return true;
                }

                // منشن مخفي (تنبيه جميع الأعضاء دون إظهار أرقامهم في الرسالة)
                if (isActualRoomAdminOrOwner && (normalizedBody.startsWith('منشن مخفي') || normalizedBody.startsWith('تاغ مخفي') || normalizedBody.startsWith('تاج مخفي') || normalizedBody.startsWith('مخفي') || normalizedBody.startsWith('تنبيه مخفي'))) {
                    await handleCommandTiming('👻');
                    let customMsg = body.replace(/^(منشن\s*مخفي|تاغ\s*مخفي|تاج\s*مخفي|مخفي|تنبيه\s*مخفي)\s*/i, '').trim();
                    let mentionsList = participants.map(p => p.id).filter(Boolean);
                    let ghostText = customMsg 
                        ? `👻 *[ تنبيه مخفي للجميع ]* 🔔\n\n${customMsg}`
                        : `👻 *[ تنبيه لجميع أعضاء الروم ]* 🔔`;

                    await currentConn.sendMessage(from, { text: ghostText, mentions: mentionsList }, { quoted: mek });
                    return true;
                }

                // منشن جماعي ظاهر
                if (isActualRoomAdminOrOwner && (normalizedBody.startsWith('منشن') || normalizedBody.startsWith('تاغ') || normalizedBody.startsWith('تاج'))) {
                    await handleCommandTiming('📢');
                    let customMsg = body.replace(/^(منشن|تاغ|تاج)\s*/i, '').trim();
                    let mentionsList = participants.map(p => p.id).filter(Boolean);
                    let tagText = `📢 *منشن جماعي لجميع الأعضاء:* 📢\n`;
                    if (customMsg) tagText += `\n💬 *الرسالة:* ${customMsg}\n`;
                    tagText += `\n` + participants.map(p => `@${getCleanNumber(p.id)}`).join(' ');

                    await currentConn.sendMessage(from, { text: tagText, mentions: mentionsList }, { quoted: mek });
                    return true;
                }

                // قبول طلبات الانضمام لأرقام مصرية فقط (+20)
                const isEgyptianJoinCmd = /^(?:\.|\/)?(اقبل|قبول)\s*(?:الطلبات|طلبات)\s*(?:مصري[هةين]*|مصر)(?:\s|$|\d)/i.test(normalizedBody);

                if (isActualRoomAdminOrOwner && isEgyptianJoinCmd) {
                    let countMatch = normalizedBody.match(/\d+/);
                    let countArg = countMatch ? parseInt(countMatch[0], 10) : 50;
                    stopRequestsControl[from] = false;
                    await handleCommandTiming('🇪🇬');

                    try {
                        let requests = await currentConn.groupRequestParticipantsList(from);
                        if (!requests || requests.length === 0) {
                            await currentConn.sendMessage(from, { text: '📋 لا توجد أي طلبات انضمام معلقة في الجروب حالياً.' }, { quoted: mek });
                            return true;
                        }

                        // تصفية أرقام مصر (+20) سواء بالأرقام المباشرة أو بمعرفات الـ LID
                        let egyptianRequests = [];
                        for (let req of requests) {
                            const isEg = await isEgyptianParticipant(req, currentConn);
                            if (isEg) {
                                egyptianRequests.push(req);
                            }
                        }

                        if (egyptianRequests.length === 0) {
                            await currentConn.sendMessage(from, { 
                                text: `📋 تم فحص [ ${requests.length} ] طلب انضمام معلق، ولكن لم يتم العثور على أي أرقام مصرية (+20) بين الطلبات المعلقة! 🇪🇬` 
                            }, { quoted: mek });
                            return true;
                        }

                        let toAccept = egyptianRequests.slice(0, countArg);
                        await currentConn.sendMessage(from, { 
                            text: `🇪🇬 *جاري قبول [ ${toAccept.length} ] طلب انضمام مصري (+20)* من أصل [ ${egyptianRequests.length} ] طلب مصري معلق..\n\n` +
                                  `🛑 اكتب *(وقف طلبات)* للإلغاء في أي وقت.` 
                        }, { quoted: mek });

                        let acceptedCount = 0;
                        for (let req of toAccept) {
                            if (stopRequestsControl[from]) break;
                            try {
                                await currentConn.groupRequestParticipantsUpdate(from, [req.jid], 'approve');
                                acceptedCount++;
                                await delay(1500);
                            } catch (e) {}
                        }

                        await currentConn.sendMessage(from, { 
                            text: `✅ *تم قبول [ ${acceptedCount} ] عضو بأرقام مصرية (+20) بنجاح في الجروب!* 🇪🇬🎉` 
                        }, { quoted: mek });
                    } catch (e) {
                        const errMsg = e?.message || '';
                        if (errMsg.includes('forbidden') || e?.output?.statusCode === 403) {
                            await currentConn.sendMessage(from, { 
                                text: `❌ *تعذر قبول الطلبات (Forbidden 403):*\n\n` +
                                      `1️⃣ تأكد من ترقية البوت لمشرف (Admin) في الجروب.\n` +
                                      `2️⃣ تأكد من تفعيل خيار *(الموافقة على الأعضاء الجدد / Approve new participants)* في إعدادات الجروب على واتساب.` 
                            }, { quoted: mek });
                        } else {
                            await currentConn.sendMessage(from, { 
                                text: `❌ حدث خطأ في معالجة طلبات الانضمام: ${errMsg || 'تأكد من صلاحيات البوت'}` 
                            }, { quoted: mek });
                        }
                    }
                    return true;
                }

                // قبول طلبات الانضمام العامة
                if (isActualRoomAdminOrOwner && !isEgyptianJoinCmd && normalizedBody.startsWith('اقبل طلبات')) {
                    let countArg = parseInt(normalizedBody.replace(/[^0-9]/g, '')) || 50;
                    stopRequestsControl[from] = false;
                    await handleCommandTiming('⏳');

                    try {
                        let requests = await currentConn.groupRequestParticipantsList(from);
                        if (!requests || requests.length === 0) {
                            await currentConn.sendMessage(from, { text: '📋 لا توجد أي طلبات انضمام معلقة في الجروب حالياً.' }, { quoted: mek });
                            return true;
                        }

                        let toAccept = requests.slice(0, countArg);
                        await currentConn.sendMessage(from, { text: `⏳ جاري قبول [ ${toAccept.length} ] طلب انضمام.. اكتب (وقف طلبات) للإلغاء في أي وقت.` }, { quoted: mek });

                        let acceptedCount = 0;
                        for (let req of toAccept) {
                            if (stopRequestsControl[from]) break;
                            try {
                                await currentConn.groupRequestParticipantsUpdate(from, [req.jid], 'approve');
                                acceptedCount++;
                                await delay(1500);
                            } catch (e) {}
                        }

                        await currentConn.sendMessage(from, { text: `✅ تم قبول [ ${acceptedCount} ] عضو بنجاح في الجروب! 🎉` }, { quoted: mek });
                    } catch (e) {
                        const errMsg = e?.message || '';
                        if (errMsg.includes('forbidden') || e?.output?.statusCode === 403) {
                            await currentConn.sendMessage(from, { 
                                text: `❌ *تعذر قبول الطلبات (Forbidden 403):*\n\n` +
                                      `1️⃣ تأكد من ترقية البوت لمشرف (Admin) في الجروب.\n` +
                                      `2️⃣ تأكد من تفعيل خيار *(الموافقة على الأعضاء الجدد / Approve new participants)* في إعدادات الجروب.` 
                            }, { quoted: mek });
                        } else {
                            await currentConn.sendMessage(from, { text: `❌ حدث خطأ في معالجة طلبات الانضمام: ${errMsg || 'تأكد من صلاحيات البوت'}` }, { quoted: mek });
                        }
                    }
                    return true;
                }

                // إيقاف قبول الطلبات
                if (isActualRoomAdminOrOwner && (normalizedBody === 'وقف طلبات' || normalizedBody === 'وقف الطلبات')) {
                    stopRequestsControl[from] = true;
                    await handleCommandTiming('🛑');
                    await currentConn.sendMessage(from, { text: '🛑 تم إيقاف عملية قبول الطلبات الجارية بنجاح!' }, { quoted: mek });
                    return true;
                }

                // =========================================================================
                // ⚠️ 6️⃣ [نظام التنبيهات والأدمن المعين]
                // =========================================================================
                // فحص تنبيهاتي الشخصية (لكل الأعضاء)
                if (['تنبيهاتي', 'انذاراتي', 'تحذيراتي', 'كم تنبيهاتي', 'كم انذاراتي'].includes(normalizedBody)) {
                    await handleCommandTiming('📊');
                    let myWarns = localDB.warns?.[from]?.[cleanSenderNum] || 0;
                    let msgWarns = `📊 *سجل تنبيهاتك في هذا الجروب:* \n\n` +
                                   `👤 الحساب: @${cleanSenderNum}\n` +
                                   `⚠️ عدد التنبيهات: [ ${myWarns}/4 ]\n\n` +
                                   (myWarns === 0 ? `✨ عاش يا نجم! سجلك نظيف 100% ومفيش أي مخالفات.` : `⚠️ احترس يا غالي، عند وصولك لـ 4 تنبيهات بيتم طردك تلقائياً! 🚪`);
                    await currentConn.sendMessage(from, { text: msgWarns, mentions: [sender] }, { quoted: mek });
                    return true;
                }

                // إعطاء تنبيه
                if (isWarnAdmin && (normalizedBody.startsWith('تنبيه') || normalizedBody.startsWith('انذار') || normalizedBody.startsWith('إنذار') || normalizedBody.startsWith('تحذير'))) {
                    let target = extractTarget(mek, body);
                    if (!target) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ منشن العضو أو رد على رسالته لإعطائه تنبيهاً!' }, { quoted: mek });
                        return true;
                    }
                    let targetNum = getCleanNumber(target);
                    if (targetNum === ownerPhone || targetNum === ownerLid || targetNum === ownerAltPhone) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: '❌ هوب هوب يا فنان! ده الحج شادو الأصلي صاحب البوت ومحدش يقدر يديله أي تنبيه نهائياً! 👑🛡️' }, { quoted: mek });
                        return true;
                    }
                    if (targetNum === groupCreatorRaw || isUserInList(target, localDB.mainHajjUsers) || isUserInList(target, localDB.hajjUsers)) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: '❌ لا يمكن توجيه تنبيه للحجاج أو المشرفين!' }, { quoted: mek });
                        return true;
                    }

                    if (!localDB.warns) localDB.warns = {};
                    if (!localDB.warns[from]) localDB.warns[from] = {};
                    let currentWarns = (localDB.warns[from][targetNum] || 0) + 1;
                    localDB.warns[from][targetNum] = currentWarns;
                    saveLocalDB(localDB);

                    await handleCommandTiming('⚠️');
                    if (currentWarns >= 4) {
                        delete localDB.warns[from][targetNum];
                        saveLocalDB(localDB);
                        try {
                            await currentConn.groupParticipantsUpdate(from, [target], 'remove');
                            groupMetaCache.delete(from);
                            await currentConn.sendMessage(from, {
                                text: `🚨 *وصلت 4 تنبيهات!* \nتم طرد @${targetNum} تلقائياً لمخالفة قوانين المجموعة! 🚪`,
                                mentions: [target]
                            }, { quoted: mek });
                        } catch (e) {
                            await currentConn.sendMessage(from, {
                                text: `🚨 العضو @${targetNum} وصل 4 تنبيهات وتوجب طرده، يرجى من المشرفين طرده!`,
                                mentions: [target]
                            }, { quoted: mek });
                        }
                    } else {
                        await currentConn.sendMessage(from, {
                            text: `⚠️ *تنبيه رسمي للمخالفة!* \n👤 العضو: @${targetNum}\n📊 عدد التنبيهات: [ ${currentWarns}/4 ]\n💡 عند الوصول إلى 4 تنبيهات سيتم طردك تلقائياً!`,
                            mentions: [target]
                        }, { quoted: mek });
                    }
                    return true;
                }

                // تصفير وإلغاء التنبيهات
                if (isWarnAdmin && (normalizedBody.startsWith('الغي التنبيهات') || normalizedBody.startsWith('الغاء التنبيهات') || normalizedBody.startsWith('صفر التنبيهات') || normalizedBody.startsWith('تصفير التنبيهات') || normalizedBody.startsWith('حذف التنبيهات') || normalizedBody.startsWith('مسح التنبيهات') || normalizedBody.startsWith('الغي الانذارات') || normalizedBody.startsWith('صفر الانذارات') || normalizedBody.startsWith('حذف الانذارات'))) {
                    let target = extractTarget(mek, body);
                    if (!target) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: '⚠️ منشن العضو أو رد على رسالته لتصفير تنبيهاته!' }, { quoted: mek });
                        return true;
                    }
                    let targetNum = getCleanNumber(target);
                    if (!localDB.warns?.[from]?.[targetNum]) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: `⚠️ العضو @${targetNum} ليس لديه أي تنبيهات بالفعل! عداده (0/4).`, mentions: [target] }, { quoted: mek });
                        return true;
                    }
                    delete localDB.warns[from][targetNum];
                    saveLocalDB(localDB);
                    await handleCommandTiming('✅');
                    await currentConn.sendMessage(from, { text: `✅ تم تصفير جميع تنبيهات العضو @${targetNum} بنجاح! عدادك الآن (0/4).`, mentions: [target] }, { quoted: mek });
                    return true;
                }
            }

            // =========================================================================
            // 👑 7️⃣ [أوامر الحج الأصلي والإدارة العليا - للحج شادو الأصلي فقط]
            // =========================================================================
            // رفع أدمن تنبيه
            if (normalizedBody.startsWith('رفع تنبيه') || normalizedBody.startsWith('ترقية تنبيه')) {
                if (!isAbsoluteOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي صاحب البوت! 👑🚫' }, { quoted: mek });
                    return true;
                }
                let target = extractTarget(mek, body);
                if (!target) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '⚠️ منشن العضو أو رد على رسالته لترقيته أدمن تنبيه!' }, { quoted: mek });
                    return true;
                }
                let targetNum = getCleanNumber(target);
                if (localDB.warnGivers?.[from]?.[targetNum]) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: `⚠️ العضو @${targetNum} أدمن تنبيه بالفعل في هذا الجروب! 🛡️`, mentions: [target] }, { quoted: mek });
                    return true;
                }
                if (!localDB.warnGivers) localDB.warnGivers = {};
                if (!localDB.warnGivers[from]) localDB.warnGivers[from] = {};
                localDB.warnGivers[from][targetNum] = cleanSenderNum;
                saveLocalDB(localDB);

                await handleCommandTiming('🛡️');
                await currentConn.sendMessage(from, { text: `🛡️ *أمر ملكي من الحج الأصلي:* \nتم ترقية @${targetNum} إلى رتبة [ أدمن تنبيه ] في هذا الجروب! ⚔️`, mentions: [target] }, { quoted: mek });
                return true;
            }

            // تنزيل أدمن تنبيه
            if (normalizedBody.startsWith('نزل تنبيه') || normalizedBody.startsWith('تنزيل تنبيه')) {
                if (!isAbsoluteOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي صاحب البوت! 👑🚫' }, { quoted: mek });
                    return true;
                }
                let target = extractTarget(mek, body);
                if (!target) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '⚠️ منشن العضو أو رد على رسالته لسحب رتبة أدمن التنبيه!' }, { quoted: mek });
                    return true;
                }
                let targetNum = getCleanNumber(target);
                if (!localDB.warnGivers?.[from]?.[targetNum]) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: `⚠️ العضو @${targetNum} ليس أدمن تنبيه في هذا الجروب بالفعل! 📉`, mentions: [target] }, { quoted: mek });
                    return true;
                }
                delete localDB.warnGivers[from][targetNum];
                saveLocalDB(localDB);
                await handleCommandTiming('📉');
                await currentConn.sendMessage(from, { text: `📉 تم سحب رتبة أدمن التنبيه من @${targetNum} بنجاح!`, mentions: [target] }, { quoted: mek });
                return true;
            }

            // رفع حج مساعد
            if (normalizedBody.startsWith('رفع حج') && !normalizedBody.includes('اساسي')) {
                if (!isAbsoluteOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي صاحب البوت! 👑🚫' }, { quoted: mek });
                    return true;
                }
                let target = extractTarget(mek, body);
                if (!target) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '⚠️ منشن الشخص أو رد على رسالته لترقيته حج مساعد!' }, { quoted: mek });
                    return true;
                }
                let targetNum = getCleanNumber(target);
                if (isUserInList(target, localDB.hajjUsers) || isUserInList(target, localDB.mainHajjUsers)) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: `⚠️ الشخص @${targetNum} مرفوع كحج بالفعل بالسستم! 🕋`, mentions: [target] }, { quoted: mek });
                    return true;
                }
                let cleanTargetJid = cleanUserJid(target);
                if (!localDB.hajjUsers) localDB.hajjUsers = [];
                localDB.hajjUsers.push(cleanTargetJid);
                if (!localDB.users[cleanTargetJid]) {
                    localDB.users[cleanTargetJid] = { name: 'حج مساعد', age: 'غير مسجل', status: 'غير مسجل', bio: 'حج مساعد في شادو بوت', points: 1000000, level: 500, joinedAt: 'مسجل كحج', hasRegistered: true, isInfinite: false };
                } else {
                    localDB.users[cleanTargetJid].points = Math.max(localDB.users[cleanTargetJid].points || 0, 1000000);
                    localDB.users[cleanTargetJid].level = Math.max(localDB.users[cleanTargetJid].level || 1, 500);
                }
                saveLocalDB(localDB);

                await handleCommandTiming('👑');
                await currentConn.sendMessage(from, { text: `🕋👑 *أمر ملكي سامي من الحج الأصلي:* \nتم رفع @${targetNum} إلى رتبة [ حج مساعد ] في البوت بكامل الصلاحيات! 🎉✨`, mentions: [target] }, { quoted: mek });
                return true;
            }

            // رفع حج أساسي
            if (normalizedBody.startsWith('رفع حج اساسي') || normalizedBody.startsWith('رفع حج أساسي')) {
                const isSubBotOwner = currentConn.isSubBot && (mek.isSubBotMainOwner || mek.isSubBotAdmin);
                if (!isAbsoluteOwner && !isSubBotOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي أو مالك البوت الفرعي! 👑🚫' }, { quoted: mek });
                    return true;
                }
                let target = extractTarget(mek, body);
                if (!target) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '⚠️ منشن الشخص أو رد على رسالته لترقيته حج أساسي!' }, { quoted: mek });
                    return true;
                }
                let targetNum = getCleanNumber(target);

                // إذا كان مالك البوت الفرعي هو الذي يرفع
                if (isSubBotOwner && !isAbsoluteOwner) {
                    const subCfg = currentConn.subBotConfig || {};
                    const currentSubHajjs = subCfg.subHajjUsers || [];
                    if (currentSubHajjs.includes(targetNum) || (subCfg.adminNumbers && subCfg.adminNumbers.includes(targetNum))) {
                        await handleCommandTiming('⚠️');
                        await currentConn.sendMessage(from, { text: `⚠️ الشخص @${targetNum} مرفوع حج أساسي بالفعل في هذا البوت الفرعي! 👑`, mentions: [target] }, { quoted: mek });
                        return true;
                    }
                    updateSubBotHajj(myBotNum, targetNum, 'add');
                    await handleCommandTiming('👑');
                    await currentConn.sendMessage(from, { text: `👑🕋 *أمر ملكي من صاحب البوت الفرعي:* \nتم ترقية @${targetNum} لرتبة [ حج أساسي ] في هذا البوت بنجاح! 👑⚡\nالآن يقدر ينيم ويصحي البوت ويأمره بأي أمر بكامل الصلاحيات!`, mentions: [target] }, { quoted: mek });
                    return true;
                }

                // إذا كان الحج شادو الأصلي
                if (isUserInList(target, localDB.mainHajjUsers)) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: `⚠️ الشخص @${targetNum} مرفوع حج أساسي بالفعل بالسستم! 👑`, mentions: [target] }, { quoted: mek });
                    return true;
                }
                let cleanTargetJid = cleanUserJid(target);
                if (!localDB.mainHajjUsers) localDB.mainHajjUsers = [];
                localDB.mainHajjUsers.push(cleanTargetJid);
                if (!localDB.hajjUsers) localDB.hajjUsers = [];
                if (!isUserInList(target, localDB.hajjUsers)) localDB.hajjUsers.push(cleanTargetJid);

                if (!localDB.users[cleanTargetJid]) {
                    localDB.users[cleanTargetJid] = { name: 'حج أساسي', age: 'غير مسجل', status: 'غير مسجل', bio: 'حج أساسي في شادو بوت', points: 999999999999, level: 999, joinedAt: 'مسجل كحج أساسي', hasRegistered: true, isInfinite: true };
                } else {
                    localDB.users[cleanTargetJid].isInfinite = true;
                    localDB.users[cleanTargetJid].points = 999999999999;
                    localDB.users[cleanTargetJid].level = 999;
                }
                saveLocalDB(localDB);
                if (currentConn.isSubBot) {
                    updateSubBotHajj(myBotNum, targetNum, 'add');
                }

                await handleCommandTiming('👑');
                await currentConn.sendMessage(from, { text: `👑🕋 *أمر ملكي مطلق من الحج الأصلي:* \nتم ترقية @${targetNum} مباشرة لرتبة [ حج أساسي ] بالسستم! 👑❤️`, mentions: [target] }, { quoted: mek });
                return true;
            }

            // تنزيل حج
            if (normalizedBody.startsWith('نزل حج') || normalizedBody.startsWith('تنزيل حج')) {
                const isSubBotOwner = currentConn.isSubBot && (mek.isSubBotMainOwner || mek.isSubBotAdmin);
                if (!isAbsoluteOwner && !isSubBotOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي أو مالك البوت الفرعي! 👑🚫' }, { quoted: mek });
                    return true;
                }
                let target = extractTarget(mek, body);
                if (!target) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '⚠️ منشن الشخص أو رد على رسالته لتنزيله من رتبة الحج!' }, { quoted: mek });
                    return true;
                }
                let targetNum = getCleanNumber(target);
                if (targetNum === ownerPhone || targetNum === ownerLid || targetNum === ownerAltPhone || localDB.lidMap?.[targetNum] === ownerPhone) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هوب هوب يا فنان! ده الحج شادو الأصلي صاحب البوت ومحدش يقدر ينزله من رتبته نهائياً! 👑🛡️' }, { quoted: mek });
                    return true;
                }

                // إذا كان صاحب البوت الفرعي
                if (isSubBotOwner && !isAbsoluteOwner) {
                    const subCfg = currentConn.subBotConfig || {};
                    if (targetNum === subCfg.adminPhone || targetNum === subCfg.adminLid) {
                        await handleCommandTiming('❌');
                        await currentConn.sendMessage(from, { text: '❌ لا يمكنك تنزيل صاحب البوت الأساسي! 👑🚫' }, { quoted: mek });
                        return true;
                    }
                    updateSubBotHajj(myBotNum, targetNum, 'remove');
                    await handleCommandTiming('📉');
                    await currentConn.sendMessage(from, { text: `📉 تم تنزيل @${targetNum} من رتبة الحج في هذا البوت بنجاح!`, mentions: [target] }, { quoted: mek });
                    return true;
                }

                // إذا كان الحج شادو الأصلي
                if (!isUserInList(target, localDB.hajjUsers) && !isUserInList(target, localDB.mainHajjUsers)) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: `⚠️ الشخص @${targetNum} ليس مسجلاً كحج بالفعل بالسستم! 📉`, mentions: [target] }, { quoted: mek });
                    return true;
                }
                let mapped = localDB.lidMap?.[targetNum];
                localDB.hajjUsers = (localDB.hajjUsers || []).filter(u => {
                    let clean = getCleanNumber(u);
                    return clean !== targetNum && (!mapped || clean !== mapped);
                });
                localDB.mainHajjUsers = (localDB.mainHajjUsers || []).filter(u => {
                    let clean = getCleanNumber(u);
                    return clean !== targetNum && (!mapped || clean !== mapped);
                });
                saveLocalDB(localDB);
                if (currentConn.isSubBot) {
                    updateSubBotHajj(myBotNum, targetNum, 'remove');
                }

                await handleCommandTiming('📉');
                await currentConn.sendMessage(from, { text: `📉 تم تنزيل @${targetNum} من رتبة الحج وسحب صلاحياته بنجاح!`, mentions: [target] }, { quoted: mek });
                return true;
            }

            // حظر مستخدم
            if (normalizedBody.startsWith('حظر مستخدم') || normalizedBody.startsWith('حظر عضو')) {
                if (!isAbsoluteOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي صاحب البوت! 👑🚫' }, { quoted: mek });
                    return true;
                }
                let target = extractTarget(mek, body);
                if (!target) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '⚠️ منشن المستخدم أو رد على رسالته لحظره نهائياً!' }, { quoted: mek });
                    return true;
                }
                let targetNum = getCleanNumber(target);
                if (targetNum === ownerPhone || targetNum === ownerLid || targetNum === ownerAltPhone || localDB.lidMap?.[targetNum] === ownerPhone) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هوب هوب يا فنان! ده الحج شادو الأصلي صاحب البوت ومحدش يقدر يحظره نهائياً! 👑🛡️' }, { quoted: mek });
                    return true;
                }
                if (isUserBanned(target, localDB)) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: `⚠️ المستخدم @${targetNum} محظور بالفعل من استخدام البوت يا فنان! 🚫`, mentions: [target] }, { quoted: mek });
                    return true;
                }
                let cleanTargetJid = cleanUserJid(target);
                if (!localDB.bannedUsers) localDB.bannedUsers = [];
                localDB.bannedUsers.push(cleanTargetJid);
                let mapped = localDB.lidMap?.[targetNum];
                if (mapped) {
                    localDB.bannedUsers.push(`${mapped}@s.whatsapp.net`);
                    localDB.bannedUsers.push(`${mapped}@lid`);
                }
                saveLocalDB(localDB);

                await handleCommandTiming('🚫');
                await currentConn.sendMessage(from, { text: `🚫 تم حظر المستخدم @${targetNum} من استخدام البوت نهائياً!`, mentions: [target] }, { quoted: mek });
                return true;
            }

            // فك حظر مستخدم
            if (normalizedBody.startsWith('فك حظر مستخدم') || normalizedBody.startsWith('فك حظر عضو')) {
                if (!isAbsoluteOwner) {
                    await handleCommandTiming('❌');
                    await currentConn.sendMessage(from, { text: '❌ هذا الأمر مخصص حصرياً للحج شادو الأصلي صاحب البوت! 👑🚫' }, { quoted: mek });
                    return true;
                }
                let target = extractTarget(mek, body);
                if (!target) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: '⚠️ منشن المستخدم أو رد على رسالته لفك حظره!' }, { quoted: mek });
                    return true;
                }
                let targetNum = getCleanNumber(target);
                if (!isUserBanned(target, localDB)) {
                    await handleCommandTiming('⚠️');
                    await currentConn.sendMessage(from, { text: `⚠️ المستخدم @${targetNum} غير محظور بالفعل يا فنان! هو يقدر يستخدم البوت عادي. ✅`, mentions: [target] }, { quoted: mek });
                    return true;
                }
                let mapped = localDB.lidMap?.[targetNum];
                localDB.bannedUsers = (localDB.bannedUsers || []).filter(u => {
                    let clean = getCleanNumber(u);
                    return clean !== targetNum && (!mapped || clean !== mapped);
                });
                saveLocalDB(localDB);

                await handleCommandTiming('✅');
                await currentConn.sendMessage(from, { text: `✅ تم فك حظر المستخدم @${targetNum} وعاد لاستخدام البوت بنجاح!`, mentions: [target] }, { quoted: mek });
                return true;
            }

            return false;
        } catch (err) {
            console.error("Error in datels handler before:", err);
            return false;
        }
    }
};

// =========================================================================
// 📚 [دليل وشرح جميع أوامر ومميزات البوت بذكاء فوري ودقيق]
// =========================================================================
export function getBotCommandExplanation(query, botName = 'شادو') {
    if (!query) return null;
    const q = normalizeArabic(query.toLowerCase().trim());

    // 1. لعبة بكاسة
    if (/بكاس[هة]|حرامي|مواطن|بكس[هة]/.test(q)) {
        return `🕵️‍♂️ *شرح لعبة بكاسة (الحرامي والمواطنين):* 🎭\n\n` +
               `📌 *فكرة اللعبة:* لعبة ذكاء وغموض وخداع بين المواطنين وحرامي متخفي بينهم!\n\n` +
               `🔹 *طريقة اللعب بالتفصيل:*\n` +
               `1️⃣ اكتب أمر (*بكاسة*) في الجروب.\n` +
               `2️⃣ هيظهرلك قائمة الأقسام (أفلام، أكلات، حيوانات، دول، مسلسلات..)، اختار رقم القسم أو اسمه.\n` +
               `3️⃣ يطلب البوت انضمام 3 لاعبين على الأقل (كل لاعب يرسل نقطة . أو كلمة انضمام).\n` +
               `4️⃣ البوت هيبعت الكلمة السرية لكل المواطنين في الخاص، ما عدا الحرامي مش هيعرفها!\n` +
               `5️⃣ يبدأ النقاش والأسئلة بالدور، ولما تخلصوا الحرامي بيكتب (*بكاسة خلصت*).\n` +
               `6️⃣ يبدأ التصويت على مين الحرامي برقم اللاعب أو منشن عليه.\n` +
               `7️⃣ يُعرض على الحرامي اختيارات لتخمين الكلمة.\n\n` +
               `🪙 *نظام النقاط:* المصوت الصح يكسب 100 نقطة، الغلط يتخصم منه 50، وتخمين الحرامي الصح يديله 50 نقطة!`;
    }

    // 2. نظام التنصيب والبوتات الفرعية
    if (/تنصيب|بوت فرعي|كود اقتران|كود ربط|jadibot|تعديل اسم/.test(q)) {
        return `🤖 *شرح نظام التنصيب للبوتات الفرعية (Sub-Bot):* 🚀\n\n` +
               `📌 *يعني ايه تنصيب؟*\n` +
               `تقدر تعمل نسخة بوت كاملة برقمك الخاص وباسم من اختيارك مجاناً وبدون أي سيرفر!\n\n` +
               `🔹 *خطوات التنصيب:*\n` +
               `1️⃣ ادخل على شات البوت في *الخاص* (مش في الجروب).\n` +
               `2️⃣ اكتب أمر: *تنصيب*.\n` +
               `3️⃣ البوت هيسألك عن الاسم اللي تحبه للبوت بتاعك.\n` +
               `4️⃣ بعد كدة ابعت رقم الواتساب اللي هتربط عليه البوت.\n` +
               `5️⃣ هيوصلك كود ربط (Pairing Code) مكون من 8 خانات.\n` +
               `6️⃣ ادخل على واتساب عندك: الإعدادات ➔ الأجهزة المرتبطة ➔ ربط برقم الهاتف، وحط الكود!\n\n` +
               `👑 *مميزات مالك البوت الفرعي:*\n` +
               `• تتحكم فيه بالكامل: *نام* و *اصحي*.\n` +
               `• تغير اسمه في أي وقت: *تعديل [الاسم الجديد]*.\n` +
               `• تلغيه فوراً وقت ما تحب: *الغاء تنصيب*.\n` +
               `• تدخله أي جروب مباشرة: *ادخل [رابط الجروب]* بدون استئذان!`;
    }

    // 3. المواعيد الوقتية والجدولة
    if (/قفل وقتي|فتح وقتي|مواعيد وقتي[هة]|جدول[هة]|تلقائي|يقفل بالليل|يفتح الصبح/.test(q)) {
        return `⏱️ *شرح ميزة المواعيد الوقتية والجدولة التلقائية للجروب:* 🛡️\n\n` +
               `📌 *الفكرة:* قفل وفتح الجروب تلقائياً كل يوم في ساعات محددة دون تدخل بشري!\n\n` +
               `🔹 *طريقة الاستخدام (للأدمن والمشرفين):*\n` +
               `• *قفل وقتي 23:00* ➔ لقفل الجروب تلقائياً يومياً الساعة 11 مساءً.\n` +
               `• *فتح وقتي 07:30* ➔ لفتح الجروب تلقائياً يومياً الساعة 7:30 صباحاً.\n` +
               `• *المواعيد الوقتية* ➔ لعرض المواعيد المجدولة الحالية للجروب.\n` +
               `• *الغاء المواعيد الوقتية* ➔ لإلغاء وحذف الجدولة التلقائية بالكامل.`;
    }

    // 4. نظام التنبيهات والإنذارات
    if (/تنبيه|انذار|طرد تلقائي|انذارات/.test(q)) {
        return `⚠️ *شرح نظام التنبيهات والإنذارات:* 🚨\n\n` +
               `📌 *الفكرة:* معاقبة الأعضاء المخالفين تدريجياً وبنظام عادل:\n\n` +
               `🔹 *الأوامر:*\n` +
               `• *تنبيه [منشن أو ريبلاي]* ➔ إعطاء إنذار للعضو.\n` +
               `• *4 إنذارات* ➔ عند وصول العضو للإنذار الرابع، يطرده البوت تلقائياً من الجروب!\n` +
               `• *الغي التنبيهات / صفر التنبيهات* ➔ تصفير عداد إنذارات الشخص إلى 0.\n` +
               `• *رفع تنبيه / نزل تنبيه* ➔ لتعيين أو سحب رتبة أدمن التنبيه المعين.`;
    }

    // 5. الأغاني والصوتيات
    if (/اغان[يى]|اغني[هة]|شغل|يوتيوب|ميوزك|music|song/.test(q)) {
        return `🎵 *شرح أمر تشغيل الأغاني:* 🎧\n\n` +
               `📌 *طريقة الاستخدام:*\n` +
               `• اكتب: *اغنية [اسم الأغنية]* أو *شغل [اسم الأغنية]*\n` +
               `مثال: *اغنية عمرو دياب تملي معاك* أو *شغل ويجز البخت*\n\n` +
               `✨ *المميزات:*\n` +
               `1. البوت بيجيب بوستر الأغنية الأصلي، واسم الفنان، ومدتها، ورابط يوتيوب.\n` +
               `2. لو مدة الأغنية *10 دقائق أو أقل*، البوت هيبعتلك *فويس صوتي فوري* للأغنية عشان تسمعها مباشرة في الشات!`;
    }

    // 6. أمر انطق (تحويل النص إلى صوت)
    if (/انطق|فويس ذكاء|تحويل نص|صوت الذكاء/.test(q)) {
        return `🎙️ *شرح أمر انطق (Text To Speech):* 🗣️\n\n` +
               `📌 *طريقة الاستخدام:*\n` +
               `• اكتب: *انطق [الكلام اللي عايزه]*\n` +
               `مثال: *انطق مرحباً بكم في شادو بوت*\n` +
               `• أو اعمل ريبلاي على أي رسالة واكتب *انطق* فقط!\n\n` +
               `✨ البوت بيحول النص فوراً إلى فويس صوتي PTT بشري ويتبعت في الشات.`;
    }

    // 7. أمر الاستيكر والملصقات
    if (/استيكر|ستيكر|ملصق|حقوق الاستيكر|حقوق الستيكر|sticker/.test(q)) {
        return `📸 *شرح أمر الاستيكر والملصقات:* ✨\n\n` +
               `📌 *طريقة الاستخدام:*\n` +
               `1️⃣ ابعت صورة واكتب في الكابشن: *استيكر* 🖼️\n` +
               `2️⃣ أو اعمل ريبلاي (رد) على أي صورة أو ستيكر واكتب: *استيكر* 💬\n\n` +
               `🏷️ *عايز تكتب اسمك في الحقوق تحت شادو بوت؟*\n` +
               `• اكتب: *استيكر حقوق [اسمك]*\n` +
               `مثال: *استيكر حقوق أحمد* أو *ستيكر حقوق شادو*\n\n` +
               `🕵️‍♂️ *تعديل وسرقة حقوق أي ستيكر:* اعمل ريبلاي على أي ستيكر واكتب *استيكر حقوق [اسمك]* وهيغير حقوقه لاسمك فوراً!`;
    }

    // أمر الصور والذكاء الاصطناعي
    if (/صوره|صورة|صور|photo|image|pic/.test(q)) {
        return `🖼️ *شرح أمر الصور الشامل والذكاء الاصطناعي:* 🎨\n\n` +
               `1️⃣ *طلب أي صورة في العالم:* \n` +
               `• اكتب: *صوره [اسم أي شخص أو حاجة]*\n` +
               `مثال: *صوره ميسي* | *صوره خلفيات انمي فخمة* | *صوره سيارات بورش*\n\n` +
               `2️⃣ *توليد صورة بالذكاء الاصطناعي (AI):* \n` +
               `• اكتب: *صوره ai [وصف الصورة اللي في خيالك]*\n` +
               `مثال: *صوره ai قطة في الفضاء بنظارة شمس*\n` +
               `مثال: *صوره تخيل قلعة عائمة في السحاب*\n\n` +
               `✨ كل صورة بتنزل بأعلى جودة مع توقيع البوت الرسمي في الزاوية اليمنى بالأسفل! 👑`;
    }

    // 7. أوامر إدارة الجروب والمشرفين
    if (/اوامر (ال)?جروب|اوامر (ال)?مشرف|قفل (ال)?جروب|فتح (ال)?جروب|طرد|حذف/.test(q)) {
        return `🛡️ *أهم أوامر إدارة الجروب والمشرفين:* 👑\n\n` +
               `• *قفل / فتح* ➔ قفل الشات للمشرفين فقط أو فتحه للجميع.\n` +
               `• *تفعيل الترحيب / الغاء الترحيب* ➔ تشغيل أو إيقاف رسائل الترحيب التلقائية بالأعضاء الجدد.\n` +
               `• *طرد [منشن/ريبلاي]* ➔ طرد عضو مخالف فوراً.\n` +
               `• *حذف / احذف [ريبلاي]* ➔ مسح رسالة عضو مسيئة.\n` +
               `• *رفع ادمن / نزل ادمن* ➔ ترقية أو تنزيل المشرفين.\n` +
               `• *لينك / رابط* ➔ استخراج رابط دعوة الجروب.\n` +
               `• *عدد الناس* ➔ إجمالي عدد الأعضاء بالجروب.\n` +
               `• *منشن [الرسالة]* ➔ منشن جماعي صاخب لكل الأعضاء.\n` +
               `• *اقبل طلبات [العدد]* ➔ قبول طلبات الانضمام المعلقة تلقائياً.\n` +
               `• *اقبل طلبات مصري [العدد]* ➔ قبول طلبات الانضمام المعلقة للأرقام المصرية (+20) فقط.\n` +
               `• *وقف طلبات* ➔ لإيقاف عملية قبول الطلبات المعلقة في أي وقت.\n` +
               `• حماية الروابط: البوت بيمسح أي روابط جروبات مخالفة تلقائياً!`;
    }

    // 8. البروفايل والنقاط
    if (/بروفايل|بطاقت?ي|نظام النقا?ط|ازاي اسجل|امر سجل|نقاط/.test(q)) {
        return `🪪 *شرح البروفايل ونظام النقاط:* 🪙\n\n` +
               `• *سجل الاسم | السن | الحالة | البايو* ➔ لتسجيل وتعديل بيانات بطاقتك الشخصية.\n` +
               `مثال: *سجل أحمد | 22 | أعزب | مبرمج*\n` +
               `• *بروفايل* أو *بطاقتي* ➔ لعرض بطاقة هويتك ونقاطك ورتبتك ومستواك.\n` +
               `• النقاط بتزيد تلقائياً لما تفوز في الألعاب (بكاسة، بازل، كورة، احزر، رتب)!`;
    }

    // 9. أوامر النوم والاستيقاظ
    if (/انيم|نوم|نام|اصح[يى]|استيق[ظض]|خمول/.test(q)) {
        return `💤 *شرح أوامر وضع الخمول والاستيقاظ:* 🌙\n\n` +
               `• *نام* أو *نام ${botName}* ➔ تفعيل وضع الخمول للبوت؛ يصبح صامتاً تماماً ولا يرد على أي شخص إلا مالكه!\n` +
               `• *اصحي* أو *اصحي ${botName}* ➔ استيقاظ البوت وعودته للعمل بكامل طاقته للجميع.\n` +
               `⚠️ هذا الأمر مخصص حصرياً لمالك البوت (الحج الأساسي).`;
    }

    // 10. باقي الألعاب
    if (/بازل|كوره|كورة|احزر|رتب|صراح[هة]|اكس او|xo/.test(q)) {
        return `🎮 *دليل باقي ألعاب البوت:* 🕹️\n\n` +
               `• *بازل* ➔ لعبة تحريك المربعات والأرقام بالأوامر (فوق، تحت، يمين، شمال، استسلام).\n` +
               `• *كوره* ➔ تخمين اسم لاعب كرة القدم من أنديته ومسيرته (مساعدتها: كيف لعب كوره).\n` +
               `• *احزر* ➔ تخمين الشخصيات الكرتونية والمشاهير من الصور المشوشة (مساعدتها: كيف لعب احزر).\n` +
               `• *رتب* ➔ ترتيب الحروف المبعثرة لكلمة عربية (مساعدتها: كيف لعب رتب).\n` +
               `• *صراحة* ➔ أسئلة صراحة وجرأة قوية وممتعة.\n` +
               `• *اكس او* ➔ لعبة التحدي إكس أو (XO) ضد أصدقائك أو البوت.`;
    }

    return null;
}

// =========================================================================
// 💬 [تم إلغاء ميزة الـ AI بالكامل بناءً على طلب المستخدم]
// =========================================================================
export async function handleAiConversation() {
    return false;
}

export default datelsHandler;
