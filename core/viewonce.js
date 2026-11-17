import { downloadContentFromMessage } from '@whiskeysockets/baileys';

if (!global.viewOnceCache) {
    global.viewOnceCache = new Map();
}
if (!global.viewOnceRecentByChat) {
    global.viewOnceRecentByChat = new Map();
}

/**
 * فحص الرسالة واستخراج ميديا الـ View-Once وتنزيلها وتخزينها في الكاش فوراً
 */
export async function captureViewOnceMessage(mek) {
    if (!mek?.message) return;
    try {
        let msg = mek.message;
        if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
        if (msg.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;

        let innerVo = null;
        let typeVo = null;
        let mediaVo = null;

        const voWrapper = msg.viewOnceMessage?.message ||
                          msg.viewOnceMessageV2?.message ||
                          msg.viewOnceMessageV2Extension?.message;

        if (voWrapper) {
            innerVo = voWrapper;
        } else if (msg.imageMessage?.viewOnce) {
            innerVo = msg;
        } else if (msg.videoMessage?.viewOnce) {
            innerVo = msg;
        } else if (msg.audioMessage?.viewOnce) {
            innerVo = msg;
        }

        if (innerVo) {
            mediaVo = innerVo.imageMessage || innerVo.videoMessage || innerVo.audioMessage;
            typeVo = innerVo.imageMessage ? 'image' : (innerVo.videoMessage ? 'video' : (innerVo.audioMessage ? 'audio' : null));
        }

        const voId = mek.key?.id;
        const from = mek.key?.remoteJid || mek.chat || '';

        if (mediaVo && typeVo && voId) {
            if (!global.viewOnceCache.has(voId)) {
                // حفظ فوري في الكاش حتى لو كان التنزيل قيد المعالجة
                const cacheItem = {
                    buffer: null,
                    mediaVo,
                    type: typeVo,
                    caption: mediaVo.caption || '',
                    mimetype: mediaVo.mimetype || '',
                    timestamp: Date.now()
                };
                global.viewOnceCache.set(voId, cacheItem);
                if (from) {
                    global.viewOnceRecentByChat.set(from, { id: voId, ...cacheItem });
                }

                // تنزيل الميديا فوراً في الخلفية
                try {
                    const stream = await downloadContentFromMessage(mediaVo, typeVo);
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
                    }
                } catch (dlErr) {
                    // في حال تعذر التنزيل الفوري، يبقى mediaVo محفوظاً لإعادة المحاولة عند طلب الكشف
                }

                // تنظيف الكاش تلقائياً بعد 3 ساعات لتوفير الذاكرة
                setTimeout(() => {
                    try {
                        global.viewOnceCache.delete(voId);
                        const recent = global.viewOnceRecentByChat.get(from);
                        if (recent && recent.id === voId) {
                            global.viewOnceRecentByChat.delete(from);
                        }
                    } catch (_) {}
                }, 3 * 3600 * 1000);
            }
        }
    } catch (_) {}
}

/**
 * استخراج وتحميل ميديا الـ View-Once عند طلب أمر كشف
 */
export async function resolveViewOnceMedia(quotedId, quotedMsg, from = '') {
    // 1. البحث في كاش المعرف (Stanza ID)
    if (quotedId && global.viewOnceCache?.has(quotedId)) {
        const item = global.viewOnceCache.get(quotedId);
        if (item.buffer && item.buffer.length > 0) {
            return { buffer: item.buffer, type: item.type, caption: item.caption, mimetype: item.mimetype };
        }
        if (item.mediaVo && item.type) {
            try {
                const stream = await downloadContentFromMessage(item.mediaVo, item.type);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                if (buffer && buffer.length > 0) {
                    item.buffer = buffer;
                    return { buffer, type: item.type, caption: item.caption, mimetype: item.mimetype };
                }
            } catch (_) {}
        }
    }

    // 2. البحث والتنزيل المباشر من الرسالة المقتبسة
    if (quotedMsg) {
        let targetMsg = quotedMsg;
        for (let d = 0; d < 6; d++) {
            if (!targetMsg) break;
            if (targetMsg.ephemeralMessage?.message) targetMsg = targetMsg.ephemeralMessage.message;
            else if (targetMsg.viewOnceMessage?.message) targetMsg = targetMsg.viewOnceMessage.message;
            else if (targetMsg.viewOnceMessageV2?.message) targetMsg = targetMsg.viewOnceMessageV2.message;
            else if (targetMsg.viewOnceMessageV2Extension?.message) targetMsg = targetMsg.viewOnceMessageV2Extension.message;
            else if (targetMsg.documentWithCaptionMessage?.message) targetMsg = targetMsg.documentWithCaptionMessage.message;
            else break;
        }

        const innerMedia = targetMsg?.imageMessage || targetMsg?.videoMessage || targetMsg?.audioMessage || targetMsg?.documentMessage;
        const innerType = targetMsg?.imageMessage ? 'image' : (targetMsg?.videoMessage ? 'video' : (targetMsg?.audioMessage ? 'audio' : (targetMsg?.documentMessage ? 'document' : null)));

        if (innerMedia && innerType) {
            try {
                const stream = await downloadContentFromMessage(innerMedia, innerType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                if (buffer && buffer.length > 0) {
                    return {
                        buffer,
                        type: innerType,
                        caption: innerMedia.caption || '',
                        mimetype: innerMedia.mimetype || ''
                    };
                }
            } catch (err) {
                // فشل التنزيل المباشر من الاقتباس
            }
        }
    }

    // 3. الاحتياطي: البحث في آخر ميديا view-once تم إرسالها في هذا الشات خلال آخر 15 دقيقة
    if (from && global.viewOnceRecentByChat?.has(from)) {
        const recent = global.viewOnceRecentByChat.get(from);
        if (recent && (Date.now() - (recent.timestamp || 0) < 15 * 60 * 1000)) {
            if (recent.buffer && recent.buffer.length > 0) {
                return { buffer: recent.buffer, type: recent.type, caption: recent.caption, mimetype: recent.mimetype };
            }
            if (recent.mediaVo && recent.type) {
                try {
                    const stream = await downloadContentFromMessage(recent.mediaVo, recent.type);
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

    return null;
}
