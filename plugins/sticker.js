import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import webp from 'node-webpmux';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

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
export async function addExif(webpBuffer, packname = 'Shado Bot', author = 'Shado Bot') {
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
 * تنزيل ميديا من رسالة Baileys
 */
async function downloadMedia(mediaMessage, type) {
    try {
        const stream = await downloadContentFromMessage(mediaMessage, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    } catch (e) {
        console.error(`⚠️ Error downloading media (${type}):`, e.message);
        return null;
    }
}

/**
 * استخراج الميديا من الرسالة الحالية أو من الريبلاي
 */
async function extractMediaFromMessageOrQuoted(mek) {
    let msg = mek.message;
    while (msg?.ephemeralMessage || msg?.viewOnceMessage || msg?.viewOnceMessageV2 || msg?.documentWithCaptionMessage) {
        msg = msg.ephemeralMessage?.message ||
              msg.viewOnceMessage?.message ||
              msg.viewOnceMessageV2?.message ||
              msg.documentWithCaptionMessage?.message || msg;
    }

    // 1. فحص الرسالة نفسها
    if (msg?.imageMessage) {
        const buf = await downloadMedia(msg.imageMessage, 'image');
        if (buf && buf.length > 0) return { buffer: buf, type: 'image' };
    }
    if (msg?.stickerMessage) {
        const buf = await downloadMedia(msg.stickerMessage, 'sticker');
        if (buf && buf.length > 0) return { buffer: buf, type: 'sticker' };
    }
    if (msg?.videoMessage && (msg.videoMessage.seconds || 0) <= 12) {
        const buf = await downloadMedia(msg.videoMessage, 'video');
        if (buf && buf.length > 0) return { buffer: buf, type: 'video' };
    }

    // 2. فحص الريبلاي المقتبس
    let quoted = mek.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quoted) {
        while (quoted.ephemeralMessage || quoted.viewOnceMessage || quoted.viewOnceMessageV2 || quoted.documentWithCaptionMessage) {
            quoted = quoted.ephemeralMessage?.message ||
                     quoted.viewOnceMessage?.message ||
                     quoted.viewOnceMessageV2?.message ||
                     quoted.documentWithCaptionMessage?.message || quoted;
        }

        if (quoted.imageMessage) {
            const buf = await downloadMedia(quoted.imageMessage, 'image');
            if (buf && buf.length > 0) return { buffer: buf, type: 'image' };
        }
        if (quoted.stickerMessage) {
            const buf = await downloadMedia(quoted.stickerMessage, 'sticker');
            if (buf && buf.length > 0) return { buffer: buf, type: 'sticker' };
        }
        if (quoted.videoMessage && (quoted.videoMessage.seconds || 0) <= 12) {
            const buf = await downloadMedia(quoted.videoMessage, 'video');
            if (buf && buf.length > 0) return { buffer: buf, type: 'video' };
        }
    }

    return null;
}

/**
 * معالج أمر الاستيكر
 */
export async function handleStickerCommand(mek, currentConn, rawBody) {
    try {
        const body = rawBody || '';
        const normalized = normalizeArabic(body.trim().toLowerCase());

        // فحص هل النص يمثل أمر استيكر
        const isStickerCmd = /^(استيكر|ستيكر|ملصق|sticker|s)(\s|$)/i.test(normalized);
        if (!isStickerCmd) return false;

        const from = mek.key?.remoteJid || mek.chat;
        if (!from) return false;

        // استخراج حقوق مخصصة إن وُجدت
        let customAuthor = null;
        const matchRights = body.match(/^(?:استيكر|ستيكر|ملصق|sticker|s)\s+(?:حقوق|حقوقه|حقوقي|حقوقها)?\s*[:\-]?\s*(.+)$/i);
        if (matchRights && matchRights[1]) {
            const parsed = matchRights[1].trim();
            if (parsed && !/^(حقوق|حقوقه|حقوقي)$/i.test(parsed)) {
                customAuthor = parsed;
            }
        }

        const packname = 'Shado Bot';
        const author = customAuthor ? customAuthor : 'Shado Bot';

        // محاولة استخراج الميديا
        const mediaObj = await extractMediaFromMessageOrQuoted(mek);

        // إذا لم تكن هناك صورة أو استيكر
        if (!mediaObj || !mediaObj.buffer) {
            await currentConn.sendMessage(from, { react: { text: '💡', key: mek.key } }).catch(() => {});
            const guideMsg = `📸 *طريقة تحويل صورة إلى استيكر:* ✨\n\n` +
                             `1️⃣ ابعت صورة واكتب في الوصف (الكابشن): *استيكر* 🖼️\n` +
                             `2️⃣ أو اعمل ريبلاي (رد) على أي صورة أو ستيكر واكتب: *استيكر* 💬\n\n` +
                             `🏷️ *عايز تكتب اسمك في الحقوق تحت شادو بوت؟*\n` +
                             `اكتب: *استيكر حقوق [اسمك]*\n` +
                             `💡 _مثال:_ *استيكر حقوق أحمد* أو *ستيكر حقوق الملك شادو* 👑`;
            await currentConn.sendMessage(from, { text: guideMsg }, { quoted: mek });
            return true;
        }

        // تفاعل بالانتظار
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
            await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
            await currentConn.sendMessage(from, { text: '❌ فشل تحويل الصورة إلى ستيكر، تأكد من صحة الصورة وحاول مرة أخرى.' }, { quoted: mek });
            return true;
        }

        // إضافة حقوق EXIF
        const stampedSticker = await addExif(webpBuf, packname, author);

        // إرسال الستيكر
        await currentConn.sendMessage(from, { sticker: stampedSticker }, { quoted: mek });
        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});

        return true;
    } catch (err) {
        console.error('⚠️ [Error handling sticker command]:', err);
        return false;
    }
}

export default handleStickerCommand;
