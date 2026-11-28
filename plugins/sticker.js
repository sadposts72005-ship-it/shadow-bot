import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import webp from 'node-webpmux';
import { 
    downloadContentFromMessage, 
    downloadMediaMessage, 
    prepareWAMessageMedia, 
    generateWAMessageFromContent, 
    proto 
} from '@whiskeysockets/baileys';

// 🔊 تفعيل تشفير ملصقات الصوت الرسمية (Sound Stickers) في بروتوكول بايلز
if (proto?.Message?.StickerMessage && !proto.Message.StickerMessage._audioPatched) {
    const origStickerEncode = proto.Message.StickerMessage.encode;
    proto.Message.StickerMessage.encode = function encode(m, w) {
        w = origStickerEncode.call(this, m, w);
        if (m.audioMessage != null) {
            proto.Message.AudioMessage.encode(m.audioMessage, w.uint32(210).fork()).ldelim();
        }
        return w;
    };
    proto.Message.StickerMessage._audioPatched = true;
}

if (proto?.Message && !proto.Message._audioStickerPatched) {
    const origMessageEncode = proto.Message.encode;
    proto.Message.encode = function encode(m, w) {
        w = origMessageEncode.call(this, m, w);
        if (m.audioStickerMessage != null) {
            proto.Message.FutureProofMessage.encode(m.audioStickerMessage, w.uint32(1074).fork()).ldelim();
        }
        return w;
    };
    proto.Message._audioStickerPatched = true;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * دالة تنظيف النص العربي
 */
function normalizeArabic(text) {
    if (!text) return '';
    return text.trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}

/**
 * إضافة حقوق الستيكر (Pack Name & Author) عبر EXIF WebP
 */
export async function addExif(webpBuffer, packname = 'Shadow Bot', author = 'Shadow Bot') {
    try {
        const json = {
            'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
            'sticker-pack-name': packname,
            'sticker-pack-publisher': author,
            'emojis': ['❤️', '🔥', '✨']
        };

        const exifAttr = Buffer.from([
            0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
            0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00,
            0x00, 0x00
        ]);

        const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
        const exif = Buffer.concat([exifAttr, jsonBuffer]);
        exif.writeUIntLE(jsonBuffer.length, 14, 4);

        const img = new webp.Image();
        await img.load(webpBuffer);
        img.exif = exif;
        return await img.save(null);
    } catch (e) {
        console.error('⚠️ [Sticker EXIF Error]:', e.message);
        return webpBuffer;
    }
}

/**
 * تحويل الصورة (JPG/PNG) إلى WebP بدقة 512x512 مع شفافية
 */
export function convertImageToWebp(imgBuffer) {
    return new Promise((resolve) => {
        const randId = Math.random().toString(36).substring(2, 8);
        const tmpInput = path.join(os.tmpdir(), `stk_img_in_${Date.now()}_${randId}.img`);
        const tmpOutput = path.join(os.tmpdir(), `stk_img_out_${Date.now()}_${randId}.webp`);

        try {
            fs.writeFileSync(tmpInput, imgBuffer);
            const ff = spawn('ffmpeg', [
                '-y',
                '-threads', '1',
                '-i', tmpInput,
                '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
                '-c:v', 'libwebp',
                '-preset', 'default',
                '-loop', '0',
                '-an',
                '-vsync', '0',
                '-s', '512:512',
                tmpOutput
            ]);

            ff.on('close', (code) => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                if (code === 0 && fs.existsSync(tmpOutput)) {
                    try {
                        const outBuf = fs.readFileSync(tmpOutput);
                        try { fs.unlinkSync(tmpOutput); } catch (_) {}
                        if (outBuf && outBuf.length > 0) return resolve(outBuf);
                    } catch (_) {}
                }
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                resolve(null);
            });

            ff.on('error', (err) => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                console.error('⚠️ FFmpeg error during image-to-webp:', err.message);
                resolve(null);
            });
        } catch (e) {
            try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
            try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
            console.error('⚠️ Exception during image-to-webp conversion:', e.message);
            resolve(null);
        }
    });
}

/**
 * تحويل فيديو أو GIF قصير إلى ستيكر متحرك WebP
 */
export function convertVideoToWebp(vidBuffer) {
    return new Promise((resolve) => {
        const randId = Math.random().toString(36).substring(2, 8);
        const tmpInput = path.join(os.tmpdir(), `stk_vid_in_${Date.now()}_${randId}.mp4`);
        const tmpOutput = path.join(os.tmpdir(), `stk_vid_out_${Date.now()}_${randId}.webp`);

        try {
            fs.writeFileSync(tmpInput, vidBuffer);
            const ff = spawn('ffmpeg', [
                '-y',
                '-threads', '1',
                '-i', tmpInput,
                '-t', '10',
                '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
                '-c:v', 'libwebp',
                '-lossless', '0',
                '-compression_level', '4',
                '-q:v', '70',
                '-loop', '0',
                '-an',
                '-vsync', '0',
                '-s', '512:512',
                tmpOutput
            ]);

            ff.on('close', (code) => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                if (code === 0 && fs.existsSync(tmpOutput)) {
                    try {
                        const outBuf = fs.readFileSync(tmpOutput);
                        try { fs.unlinkSync(tmpOutput); } catch (_) {}
                        if (outBuf && outBuf.length > 0) return resolve(outBuf);
                    } catch (_) {}
                }
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                resolve(null);
            });

            ff.on('error', (err) => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                console.error('⚠️ FFmpeg error during video-to-webp:', err.message);
                resolve(null);
            });
        } catch (e) {
            try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
            try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
            console.error('⚠️ Exception during video-to-webp conversion:', e.message);
            resolve(null);
        }
    });
}

/**
 * استخراج الصوت الأصلي من الفيديو بصيغة Ogg Opus (متوافقة مع البصمات الصوتية لواتساب)
 */
export function convertVideoToAudio(vidBuffer) {
    return new Promise((resolve) => {
        const randId = Math.random().toString(36).substring(2, 8);
        const tmpInput = path.join(os.tmpdir(), `stk_aud_in_${Date.now()}_${randId}.mp4`);
        const tmpOutput = path.join(os.tmpdir(), `stk_aud_out_${Date.now()}_${randId}.ogg`);

        try {
            fs.writeFileSync(tmpInput, vidBuffer);
            const ff = spawn('ffmpeg', [
                '-y',
                '-threads', '1',
                '-i', tmpInput,
                '-t', '10',
                '-vn',
                '-c:a', 'libopus',
                '-b:a', '48k',
                '-ac', '1',
                '-avoid_negative_ts', 'make_zero',
                tmpOutput
            ]);

            ff.on('close', (code) => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                if (code === 0 && fs.existsSync(tmpOutput)) {
                    try {
                        const outBuf = fs.readFileSync(tmpOutput);
                        try { fs.unlinkSync(tmpOutput); } catch (_) {}
                        if (outBuf && outBuf.length > 0) return resolve(outBuf);
                    } catch (_) {}
                }
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                resolve(null);
            });

            ff.on('error', (err) => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                console.error('⚠️ FFmpeg error during video-to-audio:', err.message);
                resolve(null);
            });
        } catch (e) {
            try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
            try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
            console.error('⚠️ Exception during video-to-audio conversion:', e.message);
            resolve(null);
        }
    });
}

/**
 * تنزيل ميديا من رسالة Baileys
 */
async function downloadMedia(mediaMessage, type, targetMek = null, currentConn = null) {
    if (targetMek && currentConn && typeof downloadMediaMessage === 'function') {
        try {
            const buf = await downloadMediaMessage(
                targetMek,
                'buffer',
                {},
                { reuploadRequest: currentConn.updateMediaMessage }
            );
            if (buf && buf.length > 0) return buf;
        } catch (_) {}
    }
    try {
        const stream = await downloadContentFromMessage(mediaMessage, type);
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    } catch (e) {
        console.error(`⚠️ Error downloading media (${type}):`, e.message);
        return null;
    }
}

/**
 * استخراج الميديا من الرسالة الحالية أو من الريبلاي
 */
async function extractMediaFromMessageOrQuoted(mek, currentConn = null) {
    let msg = mek.message;
    while (msg?.ephemeralMessage || msg?.viewOnceMessage || msg?.viewOnceMessageV2 || msg?.documentWithCaptionMessage) {
        msg = msg.ephemeralMessage?.message ||
              msg.viewOnceMessage?.message ||
              msg.viewOnceMessageV2?.message ||
              msg.documentWithCaptionMessage?.message || msg;
    }

    // 1. فحص الرسالة نفسها
    if (msg?.imageMessage) {
        const buf = await downloadMedia(msg.imageMessage, 'image', mek, currentConn);
        if (buf && buf.length > 0) return { buffer: buf, type: 'image' };
    }
    if (msg?.stickerMessage) {
        const buf = await downloadMedia(msg.stickerMessage, 'sticker', mek, currentConn);
        if (buf && buf.length > 0) return { buffer: buf, type: 'sticker' };
    }
    if (msg?.videoMessage && (!msg.videoMessage.seconds || msg.videoMessage.seconds <= 60)) {
        const buf = await downloadMedia(msg.videoMessage, 'video', mek, currentConn);
        if (buf && buf.length > 0) return { buffer: buf, type: 'video' };
    }

    // 2. فحص الريبلاي المقتبس
    const ctxInfo = msg?.extendedTextMessage?.contextInfo ||
                    mek.message?.extendedTextMessage?.contextInfo ||
                    msg?.imageMessage?.contextInfo ||
                    msg?.videoMessage?.contextInfo ||
                    msg?.stickerMessage?.contextInfo;
    let quoted = ctxInfo?.quotedMessage;
    if (quoted) {
        while (quoted.ephemeralMessage || quoted.viewOnceMessage || quoted.viewOnceMessageV2 || quoted.documentWithCaptionMessage) {
            quoted = quoted.ephemeralMessage?.message ||
                     quoted.viewOnceMessage?.message ||
                     quoted.viewOnceMessageV2?.message ||
                     quoted.documentWithCaptionMessage?.message || quoted;
        }

        const quotedMek = {
            key: {
                remoteJid: mek.key?.remoteJid || mek.chat,
                id: ctxInfo?.stanzaId,
                participant: ctxInfo?.participant
            },
            message: quoted
        };

        if (quoted.imageMessage) {
            const buf = await downloadMedia(quoted.imageMessage, 'image', quotedMek, currentConn);
            if (buf && buf.length > 0) return { buffer: buf, type: 'image' };
        }
        if (quoted.stickerMessage) {
            const buf = await downloadMedia(quoted.stickerMessage, 'sticker', quotedMek, currentConn);
            if (buf && buf.length > 0) return { buffer: buf, type: 'sticker' };
        }
        if (quoted.videoMessage && (!quoted.videoMessage.seconds || quoted.videoMessage.seconds <= 60)) {
            const buf = await downloadMedia(quoted.videoMessage, 'video', quotedMek, currentConn);
            if (buf && buf.length > 0) return { buffer: buf, type: 'video' };
        }
    }

    return null;
}

/**
 * معالج أمر الاستيكر (العادي والاستيكر بالصوت)
 */
export async function handleStickerCommand(mek, currentConn, rawBody) {
    try {
        const body = rawBody || '';
        const normalized = normalizeArabic(body.trim().toLowerCase());

        // فحص هل النص يمثل أمر استيكر صوت (الجديد)
        const isSoundStickerCmd = /^(?:استيكر\s*صوت|استيكر\s*بالصوت|ستيكر\s*صوت|ستيكر\s*بالصوت|ملصق\s*صوت|ملصق\s*بالصوت|sound\s*sticker|sticker\s*sound)(\s|$)/i.test(normalized);

        // فحص هل النص يمثل أمر استيكر عادي أو سرقة وتعديل حقوق
        const isStickerCmd = /^(?:استيكر|ستيكر|ملصق|sticker|s|سرق[هة]|اسرق|تعديل\s*(?:حقوق|حقيق)(?:\s*استيكر)?|استيكر\s*(?:حقوق|حقيق)|ستيكر\s*(?:حقوق|حقيق)|سرقة\s*استيكر|سرقة\s*الاستيكر|سرقه\s*استيكر|سرقه\s*الاستيكر)(\s|$)/i.test(normalized);

        if (!isSoundStickerCmd && !isStickerCmd) return false;

        const from = mek.key?.remoteJid || mek.chat;
        if (!from) return false;

        // ══════════════════════════════════════════════════════════════════
        // 🔊 [مسار أمر استيكر صوت - تحويل الفيديو إلى استيكر متحرك مع الصوت الأصلي]
        // ══════════════════════════════════════════════════════════════════
        if (isSoundStickerCmd) {
            let customAuthor = null;
            const matchSoundRights = body.match(/^(?:استيكر|ستيكر|ملصق)\s*(?:صوت|بالصوت)\s*(?:حقوق|حقيق|حقوقه|حقوقي|حقوقها)?\s*[:\-]?\s*(.+)$/i);
            if (matchSoundRights && matchSoundRights[1]) {
                const parsed = matchSoundRights[1].trim();
                if (parsed && !/^(حقوق|حقوقه|حقوقي|صوت|بالصوت)$/i.test(parsed)) {
                    customAuthor = parsed;
                }
            }
            if (!customAuthor && normalized.includes('شادو')) {
                customAuthor = 'شادو';
            }

            const packname = 'Shadow Bot';
            const author = customAuthor ? customAuthor : 'Shadow Bot';

            const mediaObj = await extractMediaFromMessageOrQuoted(mek, currentConn);

            if (!mediaObj || !mediaObj.buffer) {
                await delay(1500);
                await currentConn.sendMessage(from, { react: { text: '💡', key: mek.key } }).catch(() => {});
                await delay(1500);
                const soundGuideMsg = `🔊 *طريقة عمل استيكر بصوت:* ✨\n\n` +
                                     `1️⃣ ابعت مقطع فيديو قصير واكتب في الكابشن: *استيكر صوت* 🎥\n` +
                                     `2️⃣ أو اعمل ريبلاي (رد) على أي فيديو واكتب: *استيكر صوت* 💬\n\n` +
                                     `🏷️ *عايز تكتب اسمك في الحقوق تحت شادو بوت؟*\n` +
                                     `اكتب: *استيكر صوت حقوق [اسمك]*\n` +
                                     `💡 _مثال:_ *استيكر صوت حقوق شادو* 👑`;
                await currentConn.sendMessage(from, { text: soundGuideMsg }, { quoted: mek });
                return true;
            }

            if (mediaObj.type !== 'video') {
                await delay(1000);
                await currentConn.sendMessage(from, { react: { text: '⚠️', key: mek.key } }).catch(() => {});
                await currentConn.sendMessage(from, { 
                    text: `⚠️ *أمر استيكر صوت مخصص للفيديوهات فقط* لاستخراج الصوت منها.\n` +
                          `💡 لتحويل الصورة أو الاستيكر العادي اكتب: *استيكر* 🖼️` 
                }, { quoted: mek });
                return true;
            }

            await delay(1500);
            await currentConn.sendMessage(from, { react: { text: '⏳', key: mek.key } }).catch(() => {});

            // تحويل الفيديو إلى استيكر متحرك واستخراج الصوت بالتوازي
            const [webpBuf, audioBuf] = await Promise.all([
                convertVideoToWebp(mediaObj.buffer),
                convertVideoToAudio(mediaObj.buffer)
            ]);

            if (!webpBuf) {
                await delay(1000);
                await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
                await currentConn.sendMessage(from, { text: '❌ فشل تحويل الفيديو إلى استيكر، تأكد من صحة الفيديو وحاول مرة أخرى.' }, { quoted: mek });
                return true;
            }

            const stampedSticker = await addExif(webpBuf, packname, author);

            await delay(1500);

            // إرسال الاستيكر نفسه مدمجاً به الصوت الأصلي (Official WhatsApp Sound Sticker - ملصق بصوت مدمج بدون فويس منفصل)
            let sentSuccessfully = false;
            if (audioBuf && audioBuf.length > 0 && typeof currentConn.waUploadToServer === 'function' && typeof currentConn.relayMessage === 'function') {
                try {
                    const [resStk, resAud] = await Promise.all([
                        prepareWAMessageMedia({ sticker: stampedSticker }, { upload: currentConn.waUploadToServer }),
                        prepareWAMessageMedia({ audio: audioBuf, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { upload: currentConn.waUploadToServer })
                    ]);

                    if (resStk?.stickerMessage && resAud?.audioMessage) {
                        const stickerMsg = {
                            ...resStk.stickerMessage,
                            isAnimated: true,
                            audioMessage: resAud.audioMessage
                        };

                        const soundStickerContent = {
                            stickerMessage: stickerMsg,
                            audioStickerMessage: {
                                message: {
                                    stickerMessage: stickerMsg
                                }
                            }
                        };

                        const waMsg = generateWAMessageFromContent(from, soundStickerContent, {
                            quoted: mek,
                            userJid: currentConn.user?.id
                        });

                        await currentConn.relayMessage(from, waMsg.message, { messageId: waMsg.key.id });
                        sentSuccessfully = true;
                    }
                } catch (relayErr) {
                    console.error('⚠️ [Sound Sticker native packaging error]:', relayErr.message);
                }
            }

            // في حال عدم توفر الصوت أو فشل التغليف المركب، يتم إرسال الاستيكر بشكل اعتيادي
            if (!sentSuccessfully) {
                await currentConn.sendMessage(from, { sticker: stampedSticker }, { quoted: mek });
            }

            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});

            if (mediaObj) mediaObj.buffer = null;
            if (typeof global.gc === 'function') {
                try { global.gc(); } catch (_) {}
            }

            return true;
        }

        // ══════════════════════════════════════════════════════════════════
        // 📸 [مسار أمر الاستيكر العادي وتعديل وسرقة الحقوق]
        // ══════════════════════════════════════════════════════════════════
        // استخراج حقوق مخصصة إن وُجدت
        let customAuthor = null;
        const matchRights = body.match(/^(?:استيكر|ستيكر|ملصق|sticker|s|سرق[هة]|اسرق|تعديل\s*(?:حقوق|حقيق)(?:\s*استيكر)?|سرقة\s*استيكر|سرقة\s*الاستيكر|سرقه\s*استيكر|سرقه\s*الاستيكر)\s*(?:حقوق|حقيق|حقوقه|حقوقي|حقوقها)?\s*[:\-]?\s*(.+)$/i);
        if (matchRights && matchRights[1]) {
            const parsed = matchRights[1].trim();
            if (parsed && !/^(حقوق|حقوقه|حقوقي)$/i.test(parsed)) {
                customAuthor = parsed;
            }
        }
        if (!customAuthor && normalized.includes('شادو')) {
            customAuthor = 'شادو';
        }

        const packname = 'Shadow Bot';
        const author = customAuthor ? customAuthor : 'Shadow Bot';

        // محاولة استخراج الميديا
        const mediaObj = await extractMediaFromMessageOrQuoted(mek, currentConn);

        // إذا لم تكن هناك صورة أو استيكر
        if (!mediaObj || !mediaObj.buffer) {
            await delay(1500);
            await currentConn.sendMessage(from, { react: { text: '💡', key: mek.key } }).catch(() => {});
            await delay(1500);
            const guideMsg = `📸 *طريقة تحويل صورة إلى استيكر:* ✨\n\n` +
                             `1️⃣ ابعت صورة واكتب في الوصف (الكابشن): *استيكر* 🖼️\n` +
                             `2️⃣ أو اعمل ريبلاي (رد) على أي صورة أو ستيكر واكتب: *استيكر* 💬\n\n` +
                             `🔊 *عايز استيكر بالصوت من فيديو؟*\n` +
                             `ابعت فيديو واكتب: *استيكر صوت* 🎥\n\n` +
                             `🏷️ *عايز تكتب اسمك في الحقوق تحت شادو بوت؟*\n` +
                             `اكتب: *استيكر حقوق [اسمك]*\n` +
                             `💡 _مثال:_ *استيكر حقوق أحمد* أو *ستيكر حقوق الملك شادو* 👑`;
            await currentConn.sendMessage(from, { text: guideMsg }, { quoted: mek });
            return true;
        }

        // تأخير طبيعي مثل باقي أوامر البوت والتفاعل بالانتظار
        await delay(1500);
        await currentConn.sendMessage(from, { react: { text: '⏳', key: mek.key } }).catch(() => {});

        let webpBuf = null;
        if (mediaObj.type === 'sticker') {
            // ستيكر أصلي، نستخدم الـ buffer مباشرة لإعادة وضع الحقوق
            webpBuf = mediaObj.buffer;
        } else if (mediaObj.type === 'image') {
            webpBuf = await convertImageToWebp(mediaObj.buffer);
        } else if (mediaObj.type === 'video') {
            webpBuf = await convertVideoToWebp(mediaObj.buffer);
        }

        if (!webpBuf) {
            await delay(1000);
            await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
            await currentConn.sendMessage(from, { text: '❌ فشل تحويل الصورة إلى ستيكر، تأكد من صحة الصورة وحاول مرة أخرى.' }, { quoted: mek });
            return true;
        }

        // إضافة حقوق EXIF
        const stampedSticker = await addExif(webpBuf, packname, author);

        // تأخير واقعي وطبيعي قبل الإرسال لمحاكاة المعالجة الطبيعية وتجنب السرعة الزائدة
        await delay(2000);

        // إرسال الستيكر
        await currentConn.sendMessage(from, { sticker: stampedSticker }, { quoted: mek });
        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});

        // 🧹 تحرير وتفريغ الذاكرة فوراً لمنع تراكم الرام
        webpBuf = null;
        if (mediaObj) mediaObj.buffer = null;
        if (typeof global.gc === 'function') {
            try { global.gc(); } catch (_) {}
        }

        return true;
    } catch (err) {
        console.error('⚠️ [Error handling sticker command]:', err);
        return false;
    }
}

export default handleStickerCommand;
