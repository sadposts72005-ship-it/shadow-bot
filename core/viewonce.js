import { downloadContentFromMessage, downloadMediaMessage, normalizeMessageContent } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'sessions', 'viewonce_cache');

// إنشاء مجلد الكاش على القرص تلقائياً إذا لم يكن موجوداً
try {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
} catch (_) {}

if (!global.viewOnceCache) {
    global.viewOnceCache = new Map();
}
if (!global.viewOnceRecentByChat) {
    global.viewOnceRecentByChat = new Map();
}

function cleanNumber(str) {
    if (!str) return '';
    return String(str).replace(/[^0-9]/g, '');
}

/**
 * فك تغليف الرسالة بدقة متناهية عبر كل الطبقات الممكنة
 * (viewOnce, ephemeral, documentWithCaption, deviceSent, edited, etc.)
 * للتعرف بدقة على رسائل العرض لمرة واحدة في واتساب العادي وواتساب أعمال (WhatsApp Business)
 */
export function extractMediaFromMessage(rawMessage, parentMek = null) {
    if (!rawMessage) return null;
    let msg = rawMessage.message || rawMessage;

    // محاولة فك التغليف المبدئي عبر Baileys normalizeMessageContent إن وُجد
    try {
        if (typeof normalizeMessageContent === 'function') {
            const normalized = normalizeMessageContent(msg);
            if (normalized) msg = normalized;
        }
    } catch (_) {}

    let isViewOnce = Boolean(
        rawMessage.viewOnceMessage ||
        rawMessage.viewOnceMessageV2 ||
        rawMessage.viewOnceMessageV2Extension ||
        rawMessage.message?.viewOnceMessage ||
        rawMessage.message?.viewOnceMessageV2 ||
        rawMessage.message?.viewOnceMessageV2Extension ||
        rawMessage.key?.isViewOnce ||
        parentMek?.key?.isViewOnce ||
        parentMek?.isViewOnce ||
        msg?.viewOnceMessage ||
        msg?.viewOnceMessageV2 ||
        msg?.viewOnceMessageV2Extension
    );

    // فك التغليف التكراري الشامل للطبقات المتداخلة
    for (let i = 0; i < 12; i++) {
        if (!msg || typeof msg !== 'object') break;
        if (msg.message) {
            msg = msg.message;
            continue;
        }
        if (msg.ephemeralMessage) {
            msg = msg.ephemeralMessage.message || msg.ephemeralMessage;
            continue;
        }
        if (msg.viewOnceMessage) {
            isViewOnce = true;
            msg = msg.viewOnceMessage.message || msg.viewOnceMessage;
            continue;
        }
        if (msg.viewOnceMessageV2) {
            isViewOnce = true;
            msg = msg.viewOnceMessageV2.message || msg.viewOnceMessageV2;
            continue;
        }
        if (msg.viewOnceMessageV2Extension) {
            isViewOnce = true;
            msg = msg.viewOnceMessageV2Extension.message || msg.viewOnceMessageV2Extension;
            continue;
        }
        if (msg.documentWithCaptionMessage) {
            msg = msg.documentWithCaptionMessage.message || msg.documentWithCaptionMessage;
            continue;
        }
        if (msg.deviceSentMessage) {
            msg = msg.deviceSentMessage.message || msg.deviceSentMessage;
            continue;
        }
        if (msg.editedMessage) {
            msg = msg.editedMessage.message || msg.editedMessage;
            continue;
        }
        if (msg.associatedChildMessage) {
            msg = msg.associatedChildMessage.message || msg.associatedChildMessage;
            continue;
        }
        if (msg.botForwardedMessage) {
            msg = msg.botForwardedMessage.message || msg.botForwardedMessage;
            continue;
        }
        break;
    }

    if (!msg || typeof msg !== 'object') return null;

    let mediaObj = null;
    let type = null;

    if (msg.imageMessage) {
        mediaObj = msg.imageMessage;
        type = 'image';
        if (mediaObj.viewOnce) isViewOnce = true;
    } else if (msg.videoMessage) {
        mediaObj = msg.videoMessage;
        type = 'video';
        if (mediaObj.viewOnce) isViewOnce = true;
    } else if (msg.ptvMessage) {
        mediaObj = msg.ptvMessage;
        type = 'video';
        if (mediaObj.viewOnce) isViewOnce = true;
    } else if (msg.audioMessage) {
        mediaObj = msg.audioMessage;
        type = 'audio';
        if (mediaObj.viewOnce) isViewOnce = true;
    } else if (msg.documentMessage) {
        mediaObj = msg.documentMessage;
        type = 'document';
        if (mediaObj.viewOnce) isViewOnce = true;
    } else if (msg.stickerMessage) {
        mediaObj = msg.stickerMessage;
        type = 'sticker';
    }

    if (!mediaObj) return null;

    return {
        mediaObj,
        type,
        caption: mediaObj.caption || '',
        mimetype: mediaObj.mimetype || '',
        isViewOnce,
        unwrappedMsg: msg
    };
}

let lastCleanTime = 0;
function cleanOldCacheFiles() {
    const now = Date.now();
    if (now - lastCleanTime < 10 * 60 * 1000) return;
    lastCleanTime = now;

    try {
        if (!fs.existsSync(CACHE_DIR)) return;
        const files = fs.readdirSync(CACHE_DIR);
        const maxAge = 24 * 60 * 60 * 1000; // 24 ساعة
        for (const f of files) {
            try {
                const fullPath = path.join(CACHE_DIR, f);
                const stat = fs.statSync(fullPath);
                if (now - stat.mtimeMs > maxAge) {
                    fs.unlinkSync(fullPath);
                }
            } catch (_) {}
        }
    } catch (_) {}
}

/**
 * فحص الرسالة واستخراج ميديا الـ View-Once فور استلامها وتنزيلها وتخزينها في الكاش وعلى القرص فوراً
 * متوافقة 100% مع: واتساب العادي، واتساب أعمال (WhatsApp Business)، والأجهزة المرتبطة، والتجربة من هاتف البوت
 */
export async function captureViewOnceMessage(mek, conn = null) {
    if (!mek?.message) return;

    // 🛑 نتجاهل فقط الرسائل الصادرة برمجياً من كود البوت لتفادي تكرار إرسال المنيو والردود كصور
    // لكن نسمح بحفظ أي رسالة يرسلها المستخدم يدوياً حتى لو كانت من هاتف البوت نفسه (fromMe)
    if (mek.key?.id && (global.botSentMsgIds?.has(mek.key.id) || global.subBotSentMsgIds?.has(mek.key.id))) {
        return;
    }

    try {
        const extracted = extractMediaFromMessage(mek.message, mek);
        if (!extracted || !extracted.mediaObj || !extracted.type) return;

        const voId = mek.key?.id;
        const from = mek.key?.remoteJid || mek.chat || '';
        const sender = mek.key?.participant || mek.participant || (from.endsWith('@g.us') ? '' : from) || '';
        if (!voId) return;

        // إذا كان موجوداً بالفعل ومخزناً بالكامل في الذاكرة، نتخطى إعادة التنزيل
        if (global.viewOnceCache.has(voId)) {
            const existing = global.viewOnceCache.get(voId);
            if (existing && existing.buffer && existing.buffer.length > 0) return;
        }

        const cacheItem = {
            id: voId,
            buffer: null,
            mediaObj: extracted.mediaObj,
            unwrappedMsg: extracted.unwrappedMsg,
            type: extracted.type,
            caption: extracted.caption || '',
            mimetype: extracted.mimetype || '',
            isViewOnce: Boolean(extracted.isViewOnce),
            from,
            sender,
            timestamp: Date.now()
        };

        // فهرسة الكاش بعدة مفاتيح لضمان العثور عليه بدقة عبر الـ StanzaId
        global.viewOnceCache.set(voId, cacheItem);
        global.viewOnceCache.set(voId.toLowerCase(), cacheItem);
        if (from) {
            global.viewOnceCache.set(`${from}_${voId}`, cacheItem);
            global.viewOnceCache.set(`${from}_${voId.toLowerCase()}`, cacheItem);
            global.viewOnceRecentByChat.set(from, cacheItem);
        }

        // محاولة تنزيل الميديا فوراً في الخلفية وحفظها في الذاكرة وعلى القرص
        let downloadedBuffer = null;

        // 1. التنزيل المباشر عبر downloadContentFromMessage
        try {
            const stream = await downloadContentFromMessage(extracted.mediaObj, extracted.type);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            if (buffer && buffer.length > 0) {
                downloadedBuffer = buffer;
            }
        } catch (_) {}

        // 2. إذا فشلت الطريقة الأولى (مثلاً في بعض نسخ واتساب أعمال عند انتهاء صلاحية الرابط المباشر)، نحاول التنزيل عبر downloadMediaMessage وسوكيت الاتصال
        if (!downloadedBuffer && conn) {
            try {
                const targetMsg = extracted.unwrappedMsg || mek.message;
                const buffer = await downloadMediaMessage(
                    { key: mek.key, message: targetMsg },
                    'buffer',
                    {},
                    { reuploadRequest: conn.updateMediaMessage }
                );
                if (buffer && buffer.length > 0) {
                    downloadedBuffer = buffer;
                }
            } catch (_) {}
        }

        if (downloadedBuffer && downloadedBuffer.length > 0) {
            cacheItem.buffer = downloadedBuffer;
            global.viewOnceCache.set(voId, cacheItem);
            global.viewOnceCache.set(voId.toLowerCase(), cacheItem);
            if (from) {
                global.viewOnceCache.set(`${from}_${voId}`, cacheItem);
                global.viewOnceRecentByChat.set(from, cacheItem);
            }

            // حفظ نسخة احتياطية دائمة على القرص
            try {
                const filePath = path.join(CACHE_DIR, `${voId}.bin`);
                const metaPath = path.join(CACHE_DIR, `${voId}.json`);
                fs.writeFileSync(filePath, downloadedBuffer);
                fs.writeFileSync(metaPath, JSON.stringify({
                    id: voId,
                    type: extracted.type,
                    caption: extracted.caption || '',
                    mimetype: extracted.mimetype || '',
                    isViewOnce: cacheItem.isViewOnce,
                    from,
                    sender,
                    timestamp: cacheItem.timestamp
                }));
            } catch (_) {}
        }

        cleanOldCacheFiles();
    } catch (_) {}
}

/**
 * استخراج وتحميل ميديا الـ View-Once عند طلب أمر كشف
 * 🎯 قاعدة ذهبية:
 * - إذا حدد المستخدم رسالة معينة بريبلاي (quotedId)، نكشف حصرياً تلك الرسالة المحددة فقط.
 * - إذا كتب (كشف) بدون ريبلاي، نجلب أحدث ميديا تم إرسالها في هذا الشات.
 */
export async function resolveViewOnceMedia(quotedId, quotedMsg, from = '', directMsg = null, conn = null, quotedParticipant = null) {
    // 0. فحص ما إذا كانت الرسالة الحالية نفسها تحتوي على ميديا مباشرة (إرسال صورة مع كلمة كشف)
    if (directMsg) {
        const directExt = extractMediaFromMessage(directMsg);
        if (directExt && directExt.mediaObj && directExt.type) {
            try {
                const stream = await downloadContentFromMessage(directExt.mediaObj, directExt.type);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                if (buffer && buffer.length > 0) {
                    return { buffer, type: directExt.type, caption: directExt.caption, mimetype: directExt.mimetype };
                }
            } catch (_) {}
        }
    }

    // =========================================================================
    // 🔍 المسار أ: المستخدم قام بعمل ريبلاي على رسالة محددة (quotedId أو quotedMsg)
    // =========================================================================
    if (quotedId) {
        // 1. البحث في كاش الذاكرة اللحظي بمعرف الرسالة المقتبسة بالضبط
        const searchKeys = [
            quotedId,
            quotedId.toLowerCase(),
            `${from}_${quotedId}`,
            `${from}_${quotedId.toLowerCase()}`
        ];

        for (const k of searchKeys) {
            if (global.viewOnceCache?.has(k)) {
                const item = global.viewOnceCache.get(k);
                if (item.buffer && item.buffer.length > 0) {
                    return { buffer: item.buffer, type: item.type, caption: item.caption, mimetype: item.mimetype };
                }
                if (item.mediaObj && item.type) {
                    try {
                        const stream = await downloadContentFromMessage(item.mediaObj, item.type);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        if (buffer && buffer.length > 0) {
                            item.buffer = buffer;
                            return { buffer, type: item.type, caption: item.caption, mimetype: item.mimetype };
                        }
                    } catch (_) {}

                    if (conn && item.unwrappedMsg) {
                        try {
                            const buffer = await downloadMediaMessage(
                                { message: item.unwrappedMsg },
                                'buffer',
                                {},
                                { reuploadRequest: conn.updateMediaMessage }
                            );
                            if (buffer && buffer.length > 0) {
                                item.buffer = buffer;
                                return { buffer, type: item.type, caption: item.caption, mimetype: item.mimetype };
                            }
                        } catch (_) {}
                    }
                }
            }
        }

        // 2. البحث في كاش القرص الدائم بمعرف الرسالة المقتبسة
        try {
            const binPath = path.join(CACHE_DIR, `${quotedId}.bin`);
            const metaPath = path.join(CACHE_DIR, `${quotedId}.json`);
            if (fs.existsSync(binPath)) {
                const buffer = fs.readFileSync(binPath);
                let meta = { type: 'image', caption: '', mimetype: '' };
                if (fs.existsSync(metaPath)) {
                    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
                }
                return { buffer, type: meta.type || 'image', caption: meta.caption || '', mimetype: meta.mimetype || '' };
            }

            const qLower = quotedId.toLowerCase();
            const diskFiles = fs.readdirSync(CACHE_DIR);
            const matchedBin = diskFiles.find(f => f.toLowerCase() === `${qLower}.bin`);
            if (matchedBin) {
                const buffer = fs.readFileSync(path.join(CACHE_DIR, matchedBin));
                const metaFile = matchedBin.replace(/\.bin$/i, '.json');
                let meta = { type: 'image', caption: '', mimetype: '' };
                if (fs.existsSync(path.join(CACHE_DIR, metaFile))) {
                    try { meta = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, metaFile), 'utf8')); } catch (_) {}
                }
                return { buffer, type: meta.type || 'image', caption: meta.caption || '', mimetype: meta.mimetype || '' };
            }
        } catch (_) {}

        // 3. محاولة التنزيل المباشر من الرسالة المقتبسة ذاتها
        if (quotedMsg) {
            const quotedExt = extractMediaFromMessage(quotedMsg);
            if (quotedExt && quotedExt.mediaObj && quotedExt.type) {
                try {
                    const stream = await downloadContentFromMessage(quotedExt.mediaObj, quotedExt.type);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    if (buffer && buffer.length > 0) {
                        return { buffer, type: quotedExt.type, caption: quotedExt.caption, mimetype: quotedExt.mimetype };
                    }
                } catch (_) {}
            }

            try {
                const targetMsgToDownload = quotedExt?.unwrappedMsg || quotedMsg;
                const buffer = await downloadMediaMessage(
                    { message: targetMsgToDownload },
                    'buffer',
                    {},
                    conn ? { reuploadRequest: conn.updateMediaMessage } : undefined
                );
                if (buffer && buffer.length > 0) {
                    const innerType = quotedExt?.type || 'image';
                    return { buffer, type: innerType, caption: quotedExt?.caption || '', mimetype: quotedExt?.mimetype || '' };
                }
            } catch (_) {}
        }

        // 🛑 إذا تم تحديد رسالة معينة بريبلاي ولم نجدها، نرجع null لمنع جلب أي صورة قديمة أخرى
        return null;
    }

    // =========================================================================
    // 🔍 المسار ب: المستخدم كتب كلمة (كشف) بدون ريبلاي
    // =========================================================================
    if (from && global.viewOnceRecentByChat?.has(from)) {
        const recent = global.viewOnceRecentByChat.get(from);
        if (recent && (Date.now() - (recent.timestamp || 0) < 2 * 60 * 60 * 1000)) {
            if (recent.buffer && recent.buffer.length > 0) {
                return { buffer: recent.buffer, type: recent.type, caption: recent.caption, mimetype: recent.mimetype };
            }
            if (recent.mediaObj && recent.type) {
                try {
                    const stream = await downloadContentFromMessage(recent.mediaObj, recent.type);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    if (buffer && buffer.length > 0) {
                        recent.buffer = buffer;
                        return { buffer, type: recent.type, caption: recent.caption, mimetype: recent.mimetype };
                    }
                } catch (_) {}
            }
        }
    }

    // فحص القرص لأحدث ملف في هذا الشات
    if (from) {
        try {
            const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
            let bestFile = null;
            let bestTime = 0;
            for (const f of files) {
                try {
                    const fullP = path.join(CACHE_DIR, f);
                    const meta = JSON.parse(fs.readFileSync(fullP, 'utf8'));
                    if (meta.from === from && meta.timestamp > bestTime && (Date.now() - meta.timestamp < 2 * 60 * 60 * 1000)) {
                        bestTime = meta.timestamp;
                        bestFile = f.replace('.json', '');
                    }
                } catch (_) {}
            }
            if (bestFile) {
                const binP = path.join(CACHE_DIR, `${bestFile}.bin`);
                const metaP = path.join(CACHE_DIR, `${bestFile}.json`);
                if (fs.existsSync(binP)) {
                    const buffer = fs.readFileSync(binP);
                    let meta = { type: 'image', caption: '', mimetype: '' };
                    try { meta = JSON.parse(fs.readFileSync(metaP, 'utf8')); } catch (_) {}
                    return { buffer, type: meta.type || 'image', caption: meta.caption || '', mimetype: meta.mimetype || '' };
                }
            }
        } catch (_) {}
    }

    return null;
}
