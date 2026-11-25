// ============================================================================
// 📥 موديل التحميل والتحويل المباشر (فيديو / صورة / أغنية) - Shadow Bot
// ============================================================================

import axios from 'axios';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { ytmp4, ytmp3 } from 'ytdl-lite';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * تنظيف واستخراج الرابط من نص الرسالة أو الريبلاي
 */
function extractAndCleanUrl(text) {
    if (!text) return null;
    const match = text.match(/(https?:\/\/[^\s]+)/i);
    if (!match) return null;
    let url = match[0].trim();
    // إزالة علامات الترقيم أو الأقواس من النهاية
    url = url.replace(/[>\]\)\}\"\'\,\.\;]+$/, '');
    return url;
}

/**
 * جلب بافر ملف من رابط مباشر بأمان وتوقيت مناسب
 */
async function fetchBufferFromUrl(url, customHeaders = {}) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 25000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...customHeaders
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
 * 1. 🎵 تحميل تيك توك بدون علامة مائية وصوت وصور
 */
async function downloadTikTok(url) {
    try {
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
        const res = await axios.get(apiUrl, { timeout: 12000 });
        const data = res.data;
        if (data && data.code === 0 && data.data) {
            const videoUrl = data.data.play || data.data.wmplay;
            const title = data.data.title || 'فيديو تيك توك';
            const musicUrl = data.data.music;
            const images = data.data.images;

            if (videoUrl) {
                // تيك توك يحتاج رأس Referer لتحميل بافر الفيديو بدون تعليق
                const vRes = await fetch(videoUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://www.tiktok.com/'
                    },
                    signal: AbortSignal.timeout(25000)
                });
                if (vRes.ok) {
                    const buf = Buffer.from(await vRes.arrayBuffer());
                    return { type: 'video', buffer: buf, title, musicUrl, directUrl: videoUrl };
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
 * 2. 📽️ تحميل فيسبوك عالي الجودة
 */
async function downloadFacebook(url) {
    try {
        const apiUrl = `https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(url)}`;
        const res = await axios.get(apiUrl, { timeout: 15000 });
        const data = res.data;
        if (data && data.status && data.data?.downloads?.length > 0) {
            const dlUrl = data.data.downloads[0].url;
            let finalVideoUrl = dlUrl;

            // فك توكن الـ JWT للحصول على رابط fbcdn المباشر السريع جداً
            if (dlUrl.includes('token=')) {
                try {
                    const token = dlUrl.split('token=')[1];
                    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
                    if (payload && payload.url) {
                        finalVideoUrl = payload.url;
                    }
                } catch (_) {}
            }

            const vRes = await fetch(finalVideoUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                signal: AbortSignal.timeout(25000)
            });

            if (vRes.ok) {
                const buf = Buffer.from(await vRes.arrayBuffer());
                const title = data.data.title || 'فيديو فيسبوك';
                return { type: 'video', buffer: buf, title, directUrl: finalVideoUrl };
            }
        }
    } catch (e) {
        console.error('⚠️ [Facebook Download Error]:', e.message);
    }
    return null;
}

/**
 * 3. 🎬 تحميل يوتيوب (فيديو أو صوت)
 */
async function downloadYouTube(url, preferAudio = false) {
    try {
        if (preferAudio) {
            const res = await ytmp3(url);
            if (res && res.status && res.url) {
                return { type: 'audio', directUrl: res.url, title: res.title || 'صوت يوتيوب' };
            }
        } else {
            const res = await ytmp4(url, '360');
            if (res && res.status && res.url) {
                return { type: 'video', directUrl: res.url, title: res.title || 'فيديو يوتيوب' };
            }
        }
    } catch (e) {
        console.error('⚠️ [YouTube ytdl Error]:', e.message);
    }

    // بديل احتياطي للأغاني: جلب معلومات اليوتيوب والبحث الصوتي المباشر عبر Deezer
    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const oRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(6000) });
        if (oRes.ok) {
            const oData = await oRes.json();
            const songTitle = oData.title || '';
            if (songTitle) {
                const cleanQuery = songTitle.replace(/\(.*?\)|\[.*?\]/g, '').trim();
                const dRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(cleanQuery)}`);
                if (dRes.ok) {
                    const dData = await dRes.json();
                    const preview = dData.data?.[0]?.preview;
                    if (preview) {
                        const aRes = await fetch(preview);
                        if (aRes.ok) {
                            const buf = Buffer.from(await aRes.arrayBuffer());
                            return { type: 'audio', buffer: buf, title: songTitle };
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [YouTube Fallback Error]:', e.message);
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
    const targetUrl = extractAndCleanUrl(textToSearch);

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
            `💡 *المنصات المدعومة:* \n` +
            `• *تيك توك* ➔ تحميل فيديوهات بدون علامة مائية + صور وأغاني 🎬\n` +
            `• *فيسبوك* ➔ تحميل ريلز وفيديوهات بدقة HD عالية 📽️\n` +
            `• *يوتيوب* ➔ تحميل فيديوهات وأغاني يوتيوب المباشرة 🎵\n` +
            `• *روابط الميديا المباشرة* (.mp4 / .mp3 / .jpg / .png) فوراً ⚡\n` +
            `• *تحويل الفيديو لصوت* ➔ اعمل ريبلاي على أي فيديو واكتب *تحويل* 🎙️\n\n` +
            `👑 *Shadow Bot*`;

        await currentConn.sendMessage(from, { text: guideMsg }, { quoted: mek });
        return true;
    }

    // تفاعل بالانتظار وإشعار سريع
    await delay(1000);
    await currentConn.sendMessage(from, { react: { text: '⏳', key: mek.key } }).catch(() => {});
    await currentConn.sendMessage(from, { text: '⏳ *جاري جلب ومعالجة الميديا، ثواني يا غالي...*' }, { quoted: mek }).catch(() => {});

    try {
        const lowerUrl = targetUrl.toLowerCase();

        // 1. تيك توك (TikTok)
        if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('douyin.com')) {
            const tiktokResult = await downloadTikTok(targetUrl);
            if (tiktokResult) {
                if (tiktokResult.type === 'video') {
                    const caption = `🎬 *تم تحميل فيديو تيك توك بنجاح!* ✨\n\n📌 *العنوان:* ${tiktokResult.title}\n\n🤖 *Shadow Bot*`;
                    if (tiktokResult.buffer) {
                        await currentConn.sendMessage(from, {
                            video: tiktokResult.buffer,
                            caption: caption
                        }, { quoted: mek });
                    } else if (tiktokResult.directUrl) {
                        await currentConn.sendMessage(from, {
                            video: { url: tiktokResult.directUrl },
                            caption: caption
                        }, { quoted: mek });
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                } else if (tiktokResult.type === 'images' && tiktokResult.list) {
                    for (const imgUrl of tiktokResult.list.slice(0, 5)) {
                        await currentConn.sendMessage(from, { image: { url: imgUrl } }, { quoted: mek });
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            }
        }

        // 2. فيسبوك (Facebook)
        if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch') || lowerUrl.includes('fb.com')) {
            const fbResult = await downloadFacebook(targetUrl);
            if (fbResult) {
                const caption = `📽️ *تم تحميل فيديو فيسبوك بنجاح!* ✨\n\n📌 *العنوان:* ${fbResult.title}\n\n🤖 *Shadow Bot*`;
                if (fbResult.buffer) {
                    await currentConn.sendMessage(from, {
                        video: fbResult.buffer,
                        caption: caption
                    }, { quoted: mek });
                } else if (fbResult.directUrl) {
                    await currentConn.sendMessage(from, {
                        video: { url: fbResult.directUrl },
                        caption: caption
                    }, { quoted: mek });
                }
                await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                return true;
            }
        }

        // 3. يوتيوب (YouTube)
        if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
            const preferAudio = body.includes('صوت') || body.includes('اغني') || body.includes('أغني') || body.includes('mp3');
            const ytResult = await downloadYouTube(targetUrl, preferAudio);
            if (ytResult) {
                if (ytResult.type === 'video') {
                    const caption = `🎬 *تم تحميل فيديو يوتيوب بنجاح!* ✨\n\n📌 *العنوان:* ${ytResult.title}\n\n🤖 *Shadow Bot*`;
                    if (ytResult.buffer) {
                        await currentConn.sendMessage(from, {
                            video: ytResult.buffer,
                            caption: caption
                        }, { quoted: mek });
                    } else if (ytResult.directUrl) {
                        await currentConn.sendMessage(from, {
                            video: { url: ytResult.directUrl },
                            caption: caption
                        }, { quoted: mek });
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                } else if (ytResult.type === 'audio') {
                    if (ytResult.buffer) {
                        await currentConn.sendMessage(from, {
                            audio: ytResult.buffer,
                            mimetype: 'audio/mpeg'
                        }, { quoted: mek });
                    } else if (ytResult.directUrl) {
                        await currentConn.sendMessage(from, {
                            audio: { url: ytResult.directUrl },
                            mimetype: 'audio/mpeg'
                        }, { quoted: mek });
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            }
        }

        // 4. فحص روابط الميديا المباشرة (.mp4 / .mp3 / .jpg / etc.)
        const isDirectExt = lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.mkv') || lowerUrl.endsWith('.webm') ||
                            lowerUrl.endsWith('.mp3') || lowerUrl.endsWith('.m4a') || lowerUrl.endsWith('.wav') ||
                            lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg') || lowerUrl.endsWith('.png') || lowerUrl.endsWith('.webp');

        if (isDirectExt) {
            const directMedia = await fetchBufferFromUrl(targetUrl);
            if (directMedia && directMedia.buffer && directMedia.buffer.length > 0) {
                const cType = directMedia.contentType.toLowerCase();
                const isVideo = cType.includes('video') || lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.mkv') || lowerUrl.endsWith('.webm');
                const isAudio = cType.includes('audio') || lowerUrl.endsWith('.mp3') || lowerUrl.endsWith('.m4a') || lowerUrl.endsWith('.wav');

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
                } else {
                    await currentConn.sendMessage(from, {
                        image: directMedia.buffer,
                        caption: `🖼️ *تم تحميل الصورة بنجاح!* ✨\n\n🤖 *Shadow Bot*`
                    }, { quoted: mek });
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            }
        }

        // إذا تعذر الوصول لملف الميديا
        await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
        await currentConn.sendMessage(from, { 
            text: `❌ *تعذر تحميل الميديا من هذا الرابط حالياً!*\n\n💡 *تأكد من الآتي:*\n1️⃣ أن المنشور أو الحساب عام (Public) وليس خاصاً (Private).\n2️⃣ أن الرابط يعمل ومفتوح للجميع.\n3️⃣ المنصات المدعومة حالياً: *تيك توك*، *فيسبوك*، *يوتيوب*، وروابط الميديا المباشرة.` 
        }, { quoted: mek });

    } catch (err) {
        console.error('⚠️ [Downloader General Error]:', err.message);
        await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
        await currentConn.sendMessage(from, { text: '❌ حدث خطأ أثناء محاولة تنزيل الرابط، يرجى التأكد من الرابط والمحاولة مجدداً.' }, { quoted: mek });
    }

    return true;
}

export default {
    handleConvertCommand
};
