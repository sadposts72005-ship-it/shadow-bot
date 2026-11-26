// ============================================================================
// 📥 موديل التحميل والتحويل المباشر الشامل (تيك توك / إنستغرام / فيسبوك / يوتيوب / ميديا) - Shadow Bot
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
    // إزالة أي علامات ترقيم أو أقواس ملتصقة بالرابط من النهاية
    url = url.replace(/[>\]\)\}\"\'\,\.\;]+$/, '');
    return url;
}

/**
 * جلب بافر ملف من رابط مباشر بأمان وتوقيت مناسب مع حد أقصى للذاكرة
 */
async function fetchBufferFromUrl(url, customHeaders = {}) {
    if (!url) return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 25000,
            maxContentLength: 45 * 1024 * 1024, // 45MB max لحماية ذاكرة السيرفر
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...customHeaders
            }
        });
        const contentType = (res.headers['content-type'] || '').toLowerCase();
        return { buffer: Buffer.from(res.data), contentType };
    } catch (e) {
        console.error('⚠️ [Downloader Fetch Buffer Error]:', e.message);
        return null;
    }
}

/**
 * فك روابط التوجيه القصيرة (مثل vt.tiktok.com أو vm.tiktok.com أو youtu.be)
 */
async function resolveRedirectUrl(url) {
    try {
        const headRes = await axios.head(url, {
            maxRedirects: 8,
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        return headRes.request?.res?.responseUrl || url;
    } catch (_) {
        try {
            const f = await fetch(url, { method: 'HEAD', redirect: 'follow' });
            if (f.url) return f.url;
        } catch (_) {}
        return url;
    }
}

/**
 * إرسال فيديو بشكل آمن ومقاوم للأخطاء (محاولة البث المباشر ثم البافر كبديل تلقائي)
 */
async function sendVideoSafely(currentConn, from, result, caption, mek) {
    if (!result) return false;

    // 1. إذا كان البافر جاهزاً مسبقاً
    if (result.buffer) {
        try {
            await currentConn.sendMessage(from, { video: result.buffer, caption }, { quoted: mek });
            return true;
        } catch (e) {
            console.log('⚠️ [Send buffer video error]:', e.message);
        }
    }

    // 2. إذا كان الرابط المباشر متوفراً
    if (result.directUrl) {
        // محاولة إرساله كبث مباشر فوري (بدون استهلاك رام)
        try {
            await currentConn.sendMessage(from, { video: { url: result.directUrl }, caption }, { quoted: mek });
            return true;
        } catch (e) {
            console.log('⚠️ [Baileys direct url streaming failed, fetching buffer...]:', e.message);
        }

        // في حال تعذر على بايلز سحبه كـ URL، نجلبه كبافر ونرسله
        const bufRes = await fetchBufferFromUrl(result.directUrl, { 'User-Agent': 'Mozilla/5.0' });
        if (bufRes?.buffer) {
            try {
                await currentConn.sendMessage(from, { video: bufRes.buffer, caption }, { quoted: mek });
                return true;
            } catch (e) {
                console.log('⚠️ [Send fetched buffer video error]:', e.message);
            }
        }
    }

    return false;
}

/**
 * إرسال مقطع صوتي بشكل آمن ومقاوم للأخطاء
 */
async function sendAudioSafely(currentConn, from, result, mek) {
    if (!result) return false;

    if (result.buffer) {
        try {
            await currentConn.sendMessage(from, { audio: result.buffer, mimetype: 'audio/mpeg' }, { quoted: mek });
            return true;
        } catch (_) {}
    }

    if (result.directUrl) {
        try {
            await currentConn.sendMessage(from, { audio: { url: result.directUrl }, mimetype: 'audio/mpeg' }, { quoted: mek });
            return true;
        } catch (_) {}

        const bufRes = await fetchBufferFromUrl(result.directUrl);
        if (bufRes?.buffer) {
            try {
                await currentConn.sendMessage(from, { audio: bufRes.buffer, mimetype: 'audio/mpeg' }, { quoted: mek });
                return true;
            } catch (_) {}
        }
    }

    return false;
}

/**
 * 1. 🎵 تحميل تيك توك بدون علامة مائية وصوت وصور
 */
async function downloadTikTok(url) {
    const finalUrl = (url.includes('vt.tiktok.com') || url.includes('vm.tiktok.com')) ? await resolveRedirectUrl(url) : url;

    // المحاولة 1: مزود SiputzX Douyin/TikTok عالي السرعة مع فك التوكن المباشر
    try {
        const apiUrl = `https://api.siputzx.my.id/api/d/douyin?url=${encodeURIComponent(finalUrl)}`;
        const res = await axios.get(apiUrl, { timeout: 15000 });
        if (res.data?.status && res.data?.data?.downloads?.length > 0) {
            const dl = res.data.data.downloads[0].url;
            let finalVideoUrl = dl;
            if (dl.includes('token=')) {
                try {
                    const token = dl.split('token=')[1];
                    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
                    if (payload?.url) finalVideoUrl = payload.url;
                } catch (_) {}
            }
            const title = res.data.data.title || 'فيديو تيك توك';
            return { type: 'video', directUrl: finalVideoUrl, title };
        }
    } catch (e) {
        console.error('⚠️ [TikTok Douyin Provider Error]:', e.message);
    }

    // المحاولة 2: محرك TikWM المحسن بهيدرز الموبايل والكوكيز
    try {
        const form = new URLSearchParams();
        form.set('url', finalUrl);
        form.set('hd', '1');
        const res = await axios.post('https://www.tikwm.com/api/', form.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Cookie': 'current_language=en',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Mobile Safari/537.36'
            },
            timeout: 15000
        });
        const data = res.data;
        if (data && data.code === 0 && data.data) {
            const videoUrl = data.data.play || data.data.wmplay;
            const title = data.data.title || 'فيديو تيك توك';
            const musicUrl = data.data.music;
            const images = data.data.images;

            if (videoUrl) {
                return { type: 'video', directUrl: videoUrl, title, musicUrl };
            } else if (images && Array.isArray(images) && images.length > 0) {
                return { type: 'images', list: images, title };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok TikWM Error]:', e.message);
    }

    // المحاولة 3: SiputzX TikTok API
    try {
        const apiUrl = `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(finalUrl)}`;
        const res = await axios.get(apiUrl, { timeout: 15000 });
        const data = res.data;
        if (data && data.status && data.data) {
            const d = data.data;
            const dlUrl = d.hd?.source || d.sd?.source || d.hd?.url || d.sd?.url;
            if (dlUrl) {
                let finalVideoUrl = dlUrl;
                if (dlUrl.includes('token=')) {
                    try {
                        const token = dlUrl.split('token=')[1];
                        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
                        if (payload?.url) finalVideoUrl = payload.url;
                    } catch (_) {}
                }
                return { type: 'video', directUrl: finalVideoUrl, title: d.title || 'فيديو تيك توك' };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok SiputzX Error]:', e.message);
    }

    // المحاولة 4: SaveFrom الاحتياطي مع فك التوجيه المباشر
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(finalUrl)}`, { timeout: 15000 });
        const items = res.data?.data?.[0]?.data || res.data?.data;
        if (Array.isArray(items) && items.length > 0) {
            const item = items[0];
            const title = item.meta?.title || 'فيديو تيك توك';
            const dl = item.url?.[0]?.url;
            if (dl) {
                let finalDl = dl;
                try {
                    const head = await fetch(dl, { method: 'HEAD', redirect: 'follow' });
                    if (head.url && !head.url.includes('convert?')) finalDl = head.url;
                } catch (_) {}
                return { type: 'video', directUrl: finalDl, title };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok SaveFrom Fallback Error]:', e.message);
    }

    return null;
}

/**
 * 2. 📸 تحميل إنستغرام (ريلز / بوستات / صور)
 */
async function downloadInstagram(url) {
    const endpoints = [
        `https://api.siputzx.my.id/api/d/fastdl?url=${encodeURIComponent(url)}`,
        `https://api.siputzx.my.id/api/d/sssinstagram?url=${encodeURIComponent(url)}`,
        `https://api.siputzx.my.id/api/d/igram?url=${encodeURIComponent(url)}`
    ];

    for (const ep of endpoints) {
        try {
            const res = await axios.get(ep, { timeout: 15000 });
            if (res.data?.status && res.data?.data) {
                const data = res.data.data;
                const title = data.title || 'ميديا إنستغرام';
                const media = data.media;

                if (Array.isArray(media) && media.length > 0) {
                    const first = media[0];
                    const targetUrl = typeof first === 'string' ? first : (first.url || first.downloadUrl);
                    if (targetUrl) {
                        const isVideo = (typeof first === 'object' && first.type === 'video') ||
                                        targetUrl.includes('.mp4') ||
                                        targetUrl.includes('video');

                        if (isVideo) {
                            return {
                                type: 'video',
                                directUrl: targetUrl,
                                title
                            };
                        } else {
                            return {
                                type: 'image',
                                directUrl: targetUrl,
                                title
                            };
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`⚠️ [Instagram ${ep} Error]:`, e.message);
        }
    }

    // بديل SaveFrom الاحتياطي للإنستغرام
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(url)}`, { timeout: 15000 });
        const items = res.data?.data?.[0]?.data || res.data?.data;
        if (Array.isArray(items) && items.length > 0) {
            const item = items[0];
            const title = item.meta?.title || 'فيديو إنستغرام';
            const dl = item.url?.[0]?.url;
            if (dl) {
                let finalDl = dl;
                try {
                    const head = await fetch(dl, { method: 'HEAD', redirect: 'follow' });
                    if (head.url && !head.url.includes('convert?')) finalDl = head.url;
                } catch (_) {}
                return {
                    type: 'video',
                    directUrl: finalDl,
                    title
                };
            }
        }
    } catch (e) {
        console.error('⚠️ [Instagram SaveFrom Error]:', e.message);
    }

    return null;
}

/**
 * 3. 📽️ تحميل فيسبوك عالي الجودة
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

            const title = data.data.title || 'فيديو فيسبوك';
            return { type: 'video', directUrl: finalVideoUrl, title };
        }
    } catch (e) {
        console.error('⚠️ [Facebook Download Error]:', e.message);
    }

    // بديل SaveFrom الاحتياطي لفيسبوك
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(url)}`, { timeout: 15000 });
        const items = res.data?.data?.[0]?.data || res.data?.data;
        if (Array.isArray(items) && items.length > 0) {
            const item = items[0];
            const title = item.meta?.title || 'فيديو فيسبوك';
            const dl = item.url?.[0]?.url;
            if (dl) {
                let finalDl = dl;
                try {
                    const head = await fetch(dl, { method: 'HEAD', redirect: 'follow' });
                    if (head.url && !head.url.includes('convert?')) finalDl = head.url;
                } catch (_) {}
                return { type: 'video', directUrl: finalDl, title };
            }
        }
    } catch (e) {
        console.error('⚠️ [Facebook SaveFrom Error]:', e.message);
    }

    return null;
}

/**
 * 4. 🎬 تحميل يوتيوب (فيديو عالي الجودة أو صوت)
 */
async function downloadYouTube(url, preferAudio = false) {
    // المحاولة 1 (الأساسية المباشرة والسريعة): مكتبة ytdl-lite
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
        console.error('⚠️ [YouTube ytdl-lite Error]:', e.message);
    }

    // المحاولة 2: SaveFrom المباشر مع فك التوجيه للرابط النهائي السريع
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(url)}`, { timeout: 15000 });
        const firstGroup = res.data?.data?.[0];
        const item = firstGroup?.data?.[0];
        if (item) {
            const title = item.meta?.title || 'ميديا يوتيوب';
            const urls = item.url || [];

            if (preferAudio) {
                const audioObj = urls.find(u => u.type === 'mp3' || u.ext === 'mp3' || u.audio === true) || urls[0];
                if (audioObj?.url) {
                    let finalDl = audioObj.url;
                    try {
                        const h = await fetch(audioObj.url, { method: 'HEAD', redirect: 'follow' });
                        if (h.url && !h.url.includes('convert?')) finalDl = h.url;
                    } catch (_) {}
                    return { type: 'audio', directUrl: finalDl, title };
                }
            } else {
                const videoObj = urls.find(u => u.quality === '720' || u.quality === '480' || u.quality === '360') || urls[0];
                if (videoObj?.url) {
                    let finalDl = videoObj.url;
                    try {
                        const h = await fetch(videoObj.url, { method: 'HEAD', redirect: 'follow' });
                        if (h.url && !h.url.includes('convert?')) finalDl = h.url;
                    } catch (_) {}
                    return { type: 'video', directUrl: finalDl, title };
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [YouTube SaveFrom Error]:', e.message);
    }

    // المحاولة 3: 9xbuddy
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/9xbuddy?url=${encodeURIComponent(url)}`, { timeout: 15000 });
        if (res.data?.status && res.data?.data) {
            const d = res.data.data;
            const title = d.title || 'يوتيوب';
            const formats = d.formats || [];
            if (preferAudio) {
                const a = formats.find(f => f.type === 'audio' && f.url);
                if (a) {
                    const dlUrl = a.url.startsWith('//') ? 'https:' + a.url : a.url;
                    return { type: 'audio', directUrl: dlUrl, title };
                }
            } else {
                const v = formats.find(f => f.type === 'video' && f.url && !f.external);
                if (v) {
                    const dlUrl = v.url.startsWith('/') ? 'https://9xbuddy.com' + v.url : v.url;
                    return { type: 'video', directUrl: dlUrl, title };
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [YouTube 9xbuddy Error]:', e.message);
    }

    // المحاولة 4: بديل احتياطي للأغاني بالبحث الصوتي المباشر عبر Deezer
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
                        return { type: 'audio', directUrl: preview, title: songTitle };
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
            `• *إنستغرام* ➔ تحميل ريلز وبوستات وصور إنستا بدقة عالية 📸\n` +
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

        // 1. تيك توك (TikTok / Douyin)
        if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('douyin.com')) {
            const tiktokResult = await downloadTikTok(targetUrl);
            if (tiktokResult) {
                if (tiktokResult.type === 'video') {
                    const caption = `🎬 *تم تحميل فيديو تيك توك بنجاح!* ✨\n\n📌 *العنوان:* ${tiktokResult.title}\n\n🤖 *Shadow Bot*`;
                    const ok = await sendVideoSafely(currentConn, from, tiktokResult, caption, mek);
                    if (ok) {
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                } else if (tiktokResult.type === 'images' && tiktokResult.list) {
                    for (const imgUrl of tiktokResult.list.slice(0, 5)) {
                        await currentConn.sendMessage(from, { image: { url: imgUrl } }, { quoted: mek }).catch(() => {});
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            }
        }

        // 2. إنستغرام (Instagram)
        if (lowerUrl.includes('instagram.com') || lowerUrl.includes('instagr.am')) {
            const igResult = await downloadInstagram(targetUrl);
            if (igResult) {
                const caption = `📸 *تم تحميل ميديا إنستغرام بنجاح!* ✨\n\n📌 *العنوان:* ${igResult.title}\n\n🤖 *Shadow Bot*`;
                if (igResult.type === 'video') {
                    const ok = await sendVideoSafely(currentConn, from, igResult, caption, mek);
                    if (ok) {
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                } else if (igResult.type === 'image') {
                    if (igResult.buffer) {
                        await currentConn.sendMessage(from, { image: igResult.buffer, caption }, { quoted: mek });
                    } else if (igResult.directUrl) {
                        await currentConn.sendMessage(from, { image: { url: igResult.directUrl }, caption }, { quoted: mek });
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            }
        }

        // 3. فيسبوك (Facebook)
        if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch') || lowerUrl.includes('fb.com')) {
            const fbResult = await downloadFacebook(targetUrl);
            if (fbResult) {
                const caption = `📽️ *تم تحميل فيديو فيسبوك بنجاح!* ✨\n\n📌 *العنوان:* ${fbResult.title}\n\n🤖 *Shadow Bot*`;
                const ok = await sendVideoSafely(currentConn, from, fbResult, caption, mek);
                if (ok) {
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            }
        }

        // 4. يوتيوب (YouTube)
        if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
            const preferAudio = body.includes('صوت') || body.includes('اغني') || body.includes('أغني') || body.includes('mp3');
            const ytResult = await downloadYouTube(targetUrl, preferAudio);
            if (ytResult) {
                if (ytResult.type === 'video') {
                    const caption = `🎬 *تم تحميل فيديو يوتيوب بنجاح!* ✨\n\n📌 *العنوان:* ${ytResult.title}\n\n🤖 *Shadow Bot*`;
                    const ok = await sendVideoSafely(currentConn, from, ytResult, caption, mek);
                    if (ok) {
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                } else if (ytResult.type === 'audio') {
                    const ok = await sendAudioSafely(currentConn, from, ytResult, mek);
                    if (ok) {
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                }
            }
        }

        // 5. فحص روابط الميديا المباشرة (.mp4 / .mp3 / .jpg / etc.)
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
            text: `❌ *تعذر تحميل الميديا من هذا الرابط حالياً!*\n\n💡 *تأكد من الآتي:*\n1️⃣ أن المنشور أو الحساب عام (Public) وليس خاصاً (Private).\n2️⃣ أن الرابط يعمل ومفتوح للجميع.\n3️⃣ المنصات المدعومة حالياً: *تيك توك*، *إنستغرام*، *فيسبوك*، *يوتيوب*، وروابط الميديا المباشرة.` 
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
