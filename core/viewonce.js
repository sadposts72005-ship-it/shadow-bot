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
 * (viewOnce, ephemeral, documentWithCaption, deviceSent, interactiveMessage, etc.)
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
    for (let i = 0; i < 15; i++) {
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
        if (msg.interactiveMessage?.header) {
            msg = msg.interactiveMessage.header;
            continue;
        }
        if (msg.interactiveResponseMessage) {
            msg = msg.interactiveResponseMessage;
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
 */
export async function captureViewOnceMessage(mek, conn = null) {
    if (!mek) return;
    const voId = mek.key?.id;

    if (!mek.message) {
        if (mek.key?.isViewOnce && voId) {
            console.log(`ℹ️ [ViewOnce] استلام إشعار view_once فارغ من خوادم واتساب: ID=${voId}`);
        }
        return;
    }

    if (voId && (global.botSentMsgIds?.has(voId) || global.subBotSentMsgIds?.has(voId))) {
        return;
    }

    try {
        const extracted = extractMediaFromMessage(mek.message, mek);
        if (!extracted || !extracted.mediaObj || !extracted.type) return;

        const from = mek.key?.remoteJid || mek.chat || '';
        const sender = mek.key?.participant || mek.participant || (from.endsWith('@g.us') ? '' : from) || '';
        if (!voId) return;

        console.log(`📸 [ViewOnce] التقاط رسالة وسائط: ID=${voId}, Type=${extracted.type}, ViewOnce=${extracted.isViewOnce}, From=${from}`);

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

        // 🌟 حفظ thumbnail كـ buffer فوري مبدئي لضمان وجود الصورة حتى لو تأخر أو تعطل التنزيل الشبكي
        if (extracted.mediaObj.jpegThumbnail && (Buffer.isBuffer(extracted.mediaObj.jpegThumbnail) || extracted.mediaObj.jpegThumbnail instanceof Uint8Array)) {
            const thumbBuf = Buffer.from(extracted.mediaObj.jpegThumbnail);
            if (thumbBuf.length > 300) {
                cacheItem.buffer = thumbBuf;
            }
        }

        // فهرسة الكاش بكل الصيغ الممكنة للبحث السريع
        global.viewOnceCache.set(voId, cacheItem);
        global.viewOnceCache.set(voId.toLowerCase(), cacheItem);
        global.viewOnceCache.set(voId.toUpperCase(), cacheItem);
        if (from) {
            global.viewOnceCache.set(`${from}_${voId}`, cacheItem);
            global.viewOnceCache.set(`${from}_${voId.toLowerCase()}`, cacheItem);
            global.viewOnceCache.set(`${from}_${voId.toUpperCase()}`, cacheItem);
            global.viewOnceRecentByChat.set(from, cacheItem);
        }

        // محاولة تنزيل الميديا كاملة الدقة في الخلفية
        let downloadedBuffer = null;

        // 1. التنزيل المباشر عبر downloadContentFromMessage
        try {
            const stream = await downloadContentFromMessage(extracted.mediaObj, extracted.type);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            if (buffer && buffer.length > 0) {
                downloadedBuffer = buffer;
            }
        } catch (e1) {
            // فشل التنزيل المباشر
        }

        // 2. محاولة updateMediaMessage رسمياً عبر السوكيت إن لم ينجح التنزيل المباشر
        if (!downloadedBuffer && conn && conn.updateMediaMessage) {
            try {
                const targetMsg = extracted.unwrappedMsg || mek.message;
                const reuploaded = await conn.updateMediaMessage({
                    key: mek.key,
                    message: targetMsg
                });
                if (reuploaded?.message) {
                    const rExt = extractMediaFromMessage(reuploaded.message, mek);
                    if (rExt?.mediaObj && rExt?.type) {
                        const stream = await downloadContentFromMessage(rExt.mediaObj, rExt.type);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        if (buffer && buffer.length > 0) {
                            downloadedBuffer = buffer;
                            cacheItem.mediaObj = rExt.mediaObj;
                        }
                    }
                }
            } catch (_) {}
        }

        // 3. محاولة downloadMediaMessage
        if (!downloadedBuffer && conn) {
            try {
                const targetMsg = extracted.unwrappedMsg || mek.message;
                const buffer = await downloadMediaMessage(
                    { key: mek.key, message: targetMsg },
                    'buffer',
                    {},
                    {
                        logger: conn.logger,
                        reuploadRequest: conn.updateMediaMessage ? conn.updateMediaMessage.bind(conn) : undefined
                    }
                );
                if (buffer && buffer.length > 0) {
                    downloadedBuffer = buffer;
                }
            } catch (_) {}
        }

        if (downloadedBuffer && downloadedBuffer.length > 0) {
            cacheItem.buffer = downloadedBuffer;
            console.log(`✅ [ViewOnce] تم حفظ ميديا كاملة الدقة للرسالة ${voId} بنجاح (الحجم: ${downloadedBuffer.length} بايت)`);
        }

        // حفظ نسخة دائمة على القرص إن توفر البفر
        if (cacheItem.buffer && cacheItem.buffer.length > 0) {
            try {
                const filePath = path.join(CACHE_DIR, `${voId}.bin`);
                const metaPath = path.join(CACHE_DIR, `${voId}.json`);
                fs.writeFileSync(filePath, cacheItem.buffer);
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
    } catch (err) {
        console.error(`❌ [ViewOnce] خطأ في captureViewOnceMessage: ${err?.message || err}`);
    }
}

/**
 * استخراج وتحميل ميديا الـ View-Once عند طلب أمر كشف
 * 🎯 قاعدة ذهبية صارمة:
 * - إذا قام المستخدم بعمل ريبلاي على رسالة (quotedId): نكشف حصرياً تلك الرسالة فقط ولا نرسل أي صورة أخرى غيرها مطلقاً!
 * - إذا كتب (كشف) بدون ريبلاي: نكشف أحدث ميديا أُرسلت في هذا الشات.
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
            quotedId.toUpperCase(),
            `${from}_${quotedId}`,
            `${from}_${quotedId.toLowerCase()}`,
            `${from}_${quotedId.toUpperCase()}`
        ];

        for (const k of searchKeys) {
            if (global.viewOnceCache?.has(k)) {
                const item = global.viewOnceCache.get(k);
                if (item.buffer && item.buffer.length > 0) {
                    console.log(`✅ [ViewOnce] تم العثور على الرسالة ${quotedId} في كاش الذاكرة`);
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
                console.log(`✅ [ViewOnce] تم العثور على الرسالة ${quotedId} في كاش القرص الدائم`);
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
                console.log(`✅ [ViewOnce] تم العثور على الرسالة ${quotedId} في كاش القرص عبر case-insensitive`);
                return { buffer, type: meta.type || 'image', caption: meta.caption || '', mimetype: meta.mimetype || '' };
            }
        } catch (_) {}

        // 3. فك واستخراج الوسائط مباشرة من سياق الرسالة المقتبسة (quotedMsg)
        if (quotedMsg) {
            const quotedExt = extractMediaFromMessage(quotedMsg);
            const fullQuotedMek = {
                key: {
                    id: quotedId,
                    remoteJid: from,
                    participant: quotedParticipant || (from.endsWith('@g.us') ? undefined : from),
                    fromMe: false
                },
                message: quotedExt?.unwrappedMsg || quotedMsg
            };

            // أ) التنزيل المباشر إن كانت المفاتيح كاملة
            if (quotedExt && quotedExt.mediaObj && quotedExt.type) {
                try {
                    const stream = await downloadContentFromMessage(quotedExt.mediaObj, quotedExt.type);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    if (buffer && buffer.length > 0) {
                        console.log(`✅ [ViewOnce] تم التنزيل المباشر للرسالة المقتبسة ${quotedId}`);
                        return { buffer, type: quotedExt.type, caption: quotedExt.caption, mimetype: quotedExt.mimetype };
                    }
                } catch (e1) {
                    console.warn(`⚠️ [ViewOnce] فشل التنزيل المباشر من quotedMsg للرسالة ${quotedId}: ${e1?.message || e1}`);
                }
            }

            // ب) طلب إعادة الرفع من سيرفرات واتساب عبر updateMediaMessage
            if (conn && conn.updateMediaMessage) {
                try {
                    console.log(`🔄 [ViewOnce] محاولة updateMediaMessage للرسالة ${quotedId}...`);
                    const reuploaded = await conn.updateMediaMessage(fullQuotedMek);
                    if (reuploaded?.message) {
                        const rExt = extractMediaFromMessage(reuploaded.message);
                        if (rExt?.mediaObj && rExt?.type) {
                            const stream = await downloadContentFromMessage(rExt.mediaObj, rExt.type);
                            let buffer = Buffer.from([]);
                            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                            if (buffer && buffer.length > 0) {
                                console.log(`✅ [ViewOnce] نجح جلب وسائط ${quotedId} عبر updateMediaMessage!`);
                                return { buffer, type: rExt.type, caption: rExt.caption, mimetype: rExt.mimetype };
                            }
                        }
                    }
                } catch (e2) {
                    console.warn(`⚠️ [ViewOnce] فشل updateMediaMessage للرسالة ${quotedId}: ${e2?.message || e2}`);
                }
            }

            // ج) استخدام صورة المعاينة المصغرة (jpegThumbnail) المدمجة بالرسالة المقتبسة نفسها كحل مضمون 100%
            if (quotedExt?.mediaObj?.jpegThumbnail && (Buffer.isBuffer(quotedExt.mediaObj.jpegThumbnail) || quotedExt.mediaObj.jpegThumbnail instanceof Uint8Array)) {
                const thumbBuf = Buffer.from(quotedExt.mediaObj.jpegThumbnail);
                if (thumbBuf.length > 300) {
                    console.log(`✅ [ViewOnce] تم كشف الصورة المقتبسة عبر jpegThumbnail المدمج بالرسالة (${quotedId}) بنجاح!`);
                    return {
                        buffer: thumbBuf,
                        type: 'image',
                        caption: quotedExt.caption || '',
                        mimetype: 'image/jpeg'
                    };
                }
            }
        }

        // 🛑 إذا تم تحديد رسالة معينة بريبلاي ولم نتمكن من كشفها، نرجع null لمنع جلب أي صورة قديمة أخرى
        console.warn(`⚠️ [ViewOnce] resolveViewOnceMedia: لم يُعثر على الرسالة ${quotedId} في الكاش أو القرص`);
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
        }
    }

    return null;
}
