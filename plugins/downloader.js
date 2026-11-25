// ============================================================================
// 📥 موديل التحميل والتحويل المباشر (فيديو / صورة / أغنية) - Shadow Bot
// ============================================================================

import axios from 'axios';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeArabic(text) {
    if (!text) return '';
    return text.trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}

/**
 * تنزيل ميديا من رابط مباشر
 */
async function fetchBufferFromUrl(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 25000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const contentType = res.headers['content-type'] || '';
        return { buffer: Buffer.from(res.data), contentType };
    } catch (e) {
        console.error('⚠️ [Downloader Fetch Buffer Error]:', e.message);
        return null;
    }
}

/**
 * تحميل تيك توك بدون علامة مائية
 */
async function downloadTikTok(url) {
    try {
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
        const res = await axios.get(apiUrl, { timeout: 15000 });
        const data = res.data;
        if (data && data.code === 0 && data.data) {
            const videoUrl = data.data.play || data.data.wmplay;
            const title = data.data.title || 'فيديو تيك توك';
            const musicUrl = data.data.music;
            const images = data.data.images;

            if (videoUrl) {
                const vidData = await fetchBufferFromUrl(videoUrl);
                if (vidData && vidData.buffer) {
                    return { type: 'video', buffer: vidData.buffer, title, musicUrl };
                }
            } else if (images && Array.isArray(images) && images.length > 0) {
                return { type: 'images', list: images, title };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok Download Error]:', e.message);
    }
    return null;
}

/**
 * معالج أمر التحويل والتحميل
 */
export async function handleConvertCommand(mek, currentConn, rawBody) {
    const from = mek.key?.remoteJid || mek.chat;
    const body = rawBody || '';

    // 1. استخراج الرابط من نص الرسالة أو من الرسالة المقتبسة (الريبلاي)
    const ctx = mek.message?.extendedTextMessage?.contextInfo ||
                mek.message?.imageMessage?.contextInfo ||
                mek.message?.videoMessage?.contextInfo ||
                mek.message?.stickerMessage?.contextInfo;

    const quotedText = ctx?.quotedMessage?.conversation ||
                       ctx?.quotedMessage?.extendedTextMessage?.text ||
                       ctx?.quotedMessage?.imageMessage?.caption ||
                       ctx?.quotedMessage?.videoMessage?.caption || '';

    const textToSearch = `${body} ${quotedText}`;
    const urlRegex = /(https?:\/\/[^\s]+)/i;
    const urlMatch = textToSearch.match(urlRegex);
    const targetUrl = urlMatch ? urlMatch[0].trim() : null;

    // إذا لم يتوفر رابط في الرسالة ولا في الريبلاي
    if (!targetUrl) {
        // فحص هل عمل ريبلاي على ميديا (فيديو لتحويله لصوت)
        if (ctx?.quotedMessage?.videoMessage) {
            await delay(1000);
            await currentConn.sendMessage(from, { react: { text: '⏳', key: mek.key } }).catch(() => {});
            try {
                const stream = await downloadContentFromMessage(ctx.quotedMessage.videoMessage, 'video');
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                const videoBuf = Buffer.concat(chunks);
                if (videoBuf && videoBuf.length > 0) {
                    await currentConn.sendMessage(from, {
                        audio: videoBuf,
                        mimetype: 'audio/mp4',
                        ptt: false
                    }, { quoted: mek });
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            } catch (_) {}
        }

        const guideMsg = 
            `📥 *أمر التحويل والتحميل المباشر:* ✨\n\n` +
            `ابعت رابط الفيديو أو الصورة أو الأغنية بعد الأمر، أو اعمل ريبلاي على الرابط واكتب: *تحويل*!\n\n` +
            `💡 *أمثلة للاستخدام:*\n` +
            `• *تحويل https://vm.tiktok.com/...* ➔ تحميل فيديو تيك توك بدون علامة مائية 🎬\n` +
            `• *تحويل https://www.instagram.com/reel/...* ➔ تحميل ريلز إنستجرام 📸\n` +
            `• *تحويل https://youtu.be/...* ➔ تحميل فيديو أو صوت يوتيوب 🎵\n` +
            `• *تحويل https://www.facebook.com/...* ➔ تحميل فيديو فيسبوك 📽️\n` +
            `• *تحويل [رابط مباشر]* ➔ تحميل ملفات الميديا المباشرة (.mp4 / .mp3 / .jpg) فوراً ⚡\n\n` +
            `👑 *Shadow Bot - بابا المجال*`;

        await currentConn.sendMessage(from, { text: guideMsg }, { quoted: mek });
        return true;
    }

    // تفاعل بالانتظار
    await delay(1000);
    await currentConn.sendMessage(from, { react: { text: '⏳', key: mek.key } }).catch(() => {});

    try {
        const lowerUrl = targetUrl.toLowerCase();

        // 1. تيك توك (TikTok)
        if (lowerUrl.includes('tiktok.com')) {
            const tiktokResult = await downloadTikTok(targetUrl);
            if (tiktokResult) {
                if (tiktokResult.type === 'video' && tiktokResult.buffer) {
                    const caption = `🎬 *تم تحميل فيديو تيك توك بنجاح!* ✨\n\n📌 *العنوان:* ${tiktokResult.title}\n\n🤖 *Shadow Bot*`;
                    await currentConn.sendMessage(from, {
                        video: tiktokResult.buffer,
                        caption: caption
                    }, { quoted: mek });
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                } else if (tiktokResult.type === 'images' && tiktokResult.list) {
                    for (const imgUrl of tiktokResult.list.slice(0, 5)) {
                        const imgData = await fetchBufferFromUrl(imgUrl);
                        if (imgData && imgData.buffer) {
                            await currentConn.sendMessage(from, { image: imgData.buffer }, { quoted: mek });
                        }
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            }
        }

        // 2. روابط الميديا المباشرة
        const directMedia = await fetchBufferFromUrl(targetUrl);
        if (directMedia && directMedia.buffer && directMedia.buffer.length > 0) {
            const cType = directMedia.contentType.toLowerCase();
            const isVideo = cType.includes('video') || lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.mkv') || lowerUrl.endsWith('.webm');
            const isAudio = cType.includes('audio') || lowerUrl.endsWith('.mp3') || lowerUrl.endsWith('.m4a') || lowerUrl.endsWith('.wav') || lowerUrl.endsWith('.ogg');
            const isImage = cType.includes('image') || lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg') || lowerUrl.endsWith('.png') || lowerUrl.endsWith('.webp');

            if (isVideo) {
                await currentConn.sendMessage(from, {
                    video: directMedia.buffer,
                    caption: `🎬 *تم تحميل الفيديو بنجاح!* ✨\n\n🤖 *Shadow Bot*`
                }, { quoted: mek });
                await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                return true;
            } else if (isAudio) {
                await currentConn.sendMessage(from, {
                    audio: directMedia.buffer,
                    mimetype: 'audio/mpeg'
                }, { quoted: mek });
                await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                return true;
            } else if (isImage) {
                await currentConn.sendMessage(from, {
                    image: directMedia.buffer,
                    caption: `🖼️ *تم تحميل الصورة بنجاح!* ✨\n\n🤖 *Shadow Bot*`
                }, { quoted: mek });
                await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                return true;
            }
        }

        // 3. يوتيوب / إنستجرام / فيسبوك عبر محركات التحميل المساعدة
        const universalEndpoints = [
            `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(targetUrl)}`,
            `https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(targetUrl)}`
        ];

        for (const ep of universalEndpoints) {
            try {
                const res = await axios.get(ep, { timeout: 12000 });
                const d = res.data?.data;
                const downloadUrl = d?.video || d?.url || d?.play || (Array.isArray(d) ? d[0]?.url : null);
                if (downloadUrl) {
                    const dlBuf = await fetchBufferFromUrl(downloadUrl);
                    if (dlBuf && dlBuf.buffer) {
                        await currentConn.sendMessage(from, {
                            video: dlBuf.buffer,
                            caption: `🎬 *تم التحميل بنجاح!* ✨\n\n🤖 *Shadow Bot*`
                        }, { quoted: mek });
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                }
            } catch (_) {}
        }

        await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
        await currentConn.sendMessage(from, { 
            text: `❌ تعذر تحميل الميديا من هذا الرابط حالياً. تأكد من أن الحساب أو المنشور عام وليس خاصاً وحاول مجدداً!` 
        }, { quoted: mek });

    } catch (err) {
        console.error('⚠️ [Downloader General Error]:', err.message);
        await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
        await currentConn.sendMessage(from, { text: '❌ حدث خطأ أثناء محاولة تنزيل الرابط، يرجى المحاولة لاحقاً.' }, { quoted: mek });
    }

    return true;
}

export default {
    handleConvertCommand
};
