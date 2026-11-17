import { downloadContentFromMessage, downloadMediaMessage } from '@whiskeysockets/baileys';
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

/**
 * فك تغليف الرسالة بدقة متناهية عبر كل الطبقات الممكنة
 * (viewOnce, ephemeral, documentWithCaption, deviceSent, edited, etc.)
 */
export function extractMediaFromMessage(rawMessage) {
    if (!rawMessage) return null;
    let msg = rawMessage.message || rawMessage;

    for (let i = 0; i < 8; i++) {
        if (!msg || typeof msg !== 'object') break;
        if (msg.message) {
            msg = msg.message;
            continue;
        }
        if (msg.ephemeralMessage?.message) {
            msg = msg.ephemeralMessage.message;
            continue;
        }
        if (msg.viewOnceMessage?.message) {
            msg = msg.viewOnceMessage.message;
            continue;
        }
        if (msg.viewOnceMessageV2?.message) {
            msg = msg.viewOnceMessageV2.message;
            continue;
        }
        if (msg.viewOnceMessageV2Extension?.message) {
            msg = msg.viewOnceMessageV2Extension.message;
            continue;
        }
        if (msg.documentWithCaptionMessage?.message) {
            msg = msg.documentWithCaptionMessage.message;
            continue;
        }
        if (msg.deviceSentMessage?.message) {
            msg = msg.deviceSentMessage.message;
            continue;
        }
        if (msg.editedMessage?.message) {
            msg = msg.editedMessage.message;
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
    } else if (msg.videoMessage) {
        mediaObj = msg.videoMessage;
        type = 'video';
    } else if (msg.ptvMessage) {
        mediaObj = msg.ptvMessage;
        type = 'video';
    } else if (msg.audioMessage) {
        mediaObj = msg.audioMessage;
        type = 'audio';
    } else if (msg.documentMessage) {
        mediaObj = msg.documentMessage;
        type = 'document';
    } else if (msg.stickerMessage) {
        mediaObj = msg.stickerMessage;
        type = 'sticker';
    }

    if (!mediaObj) return null;

    const isViewOnce = Boolean(
        mediaObj.viewOnce ||
        rawMessage.viewOnceMessage ||
        rawMessage.viewOnceMessageV2 ||
        rawMessage.viewOnceMessageV2Extension ||
        rawMessage.message?.viewOnceMessage ||
        rawMessage.message?.viewOnceMessageV2 ||
        rawMessage.message?.viewOnceMessageV2Extension
    );

    return {
        mediaObj,
        type,
        caption: mediaObj.caption || '',
        mimetype: mediaObj.mimetype || '',
        isViewOnce
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
 * فحص الرسالة واستخراج ميديا الـ View-Once والميديا العامة فور استلامها وتنزيلها وتخزينها في الكاش وعلى القرص فوراً
 */
export async function captureViewOnceMessage(mek) {
    if (!mek?.message) return;
    try {
        const extracted = extractMediaFromMessage(mek.message);
        if (!extracted || !extracted.mediaObj || !extracted.type) return;

        const voId = mek.key?.id;
        const from = mek.key?.remoteJid || mek.chat || '';
        if (!voId) return;

        // إذا كان موجوداً بالفعل ومخزناً بالكامل، نتخطى التكرار
        if (global.viewOnceCache.has(voId)) {
            const existing = global.viewOnceCache.get(voId);
            if (existing && existing.buffer && existing.buffer.length > 0) return;
        }

        const cacheItem = {
            buffer: null,
            mediaObj: extracted.mediaObj,
            type: extracted.type,
            caption: extracted.caption || '',
            mimetype: extracted.mimetype || '',
            isViewOnce: extracted.isViewOnce,
            from,
            timestamp: Date.now()
        };

        global.viewOnceCache.set(voId, cacheItem);
        if (from) {
            global.viewOnceRecentByChat.set(from, { id: voId, ...cacheItem });
        }

        // تنزيل الميديا فوراً في الخلفية
        try {
            const stream = await downloadContentFromMessage(extracted.mediaObj, extracted.type);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            if (buffer && buffer.length > 0) {
                cacheItem.buffer = buffer;
                global.viewOnceCache.set(voId, cacheItem);
                if (from) {
                    global.viewOnceRecentByChat.set(from, { id: voId, ...cacheItem });
                }

                // حفظ نسخة احتياطية دائمة على القرص لضمان عدم ضياعها عند إعادة التشغيل
                try {
                    const filePath = path.join(CACHE_DIR, `${voId}.bin`);
                    const metaPath = path.join(CACHE_DIR, `${voId}.json`);
                    fs.writeFileSync(filePath, buffer);
                    fs.writeFileSync(metaPath, JSON.stringify({
                        type: extracted.type,
                        caption: extracted.caption || '',
                        mimetype: extracted.mimetype || '',
                        from,
                        timestamp: cacheItem.timestamp
                    }));
                } catch (_) {}
            }
        } catch (_) {
            // في حال تعذر التنزيل الفوري، يبقى mediaObj محفوظاً لإعادة المحاولة عند طلب الكشف
        }

        cleanOldCacheFiles();
    } catch (_) {}
}

/**
 * استخراج وتحميل ميديا الـ View-Once أو أي ميديا عند طلب أمر كشف
 */
export async function resolveViewOnceMedia(quotedId, quotedMsg, from = '', directMsg = null, conn = null) {
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

    // 1. البحث في كاش الذاكرة اللحظي بمعرف الرسالة (Stanza ID)
    if (quotedId && global.viewOnceCache?.has(quotedId)) {
        const item = global.viewOnceCache.get(quotedId);
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
        }
    }

    // 2. البحث في كاش القرص الدائم بمعرف الرسالة
    if (quotedId) {
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
        } catch (_) {}
    }

    // 3. محاولة التنزيل المباشر من الرسالة المقتبسة (للميديا العادية أو الرسائل ذات المفاتيح)
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

        // محاولة تنزيل متقدمة عبر Baileys downloadMediaMessage
        try {
            const buffer = await downloadMediaMessage(
                { message: quotedMsg },
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

    // 4. الاحتياطي: البحث في آخر ميديا تم إرسالها في هذا الشات خلال آخر ساعة (ذاكرة وقرص)
    if (from && global.viewOnceRecentByChat?.has(from)) {
        const recent = global.viewOnceRecentByChat.get(from);
        if (recent && (Date.now() - (recent.timestamp || 0) < 60 * 60 * 1000)) {
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

    // 5. البحث في أحدث ملف مسجل على القرص ينتمي لهذا الشات
    if (from) {
        try {
            const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
            let bestFile = null;
            let bestTime = 0;
            for (const f of files) {
                try {
                    const fullP = path.join(CACHE_DIR, f);
                    const meta = JSON.parse(fs.readFileSync(fullP, 'utf8'));
                    if (meta.from === from && meta.timestamp > bestTime && (Date.now() - meta.timestamp < 60 * 60 * 1000)) {
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
