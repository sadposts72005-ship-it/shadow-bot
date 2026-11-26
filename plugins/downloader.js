// ============================================================================
// 📥 موديل التحميل والتحويل المباشر الشامل (تيك توك / إنستغرام / فيسبوك / يوتيوب / ميديا) - Shadow Bot
// ============================================================================

import axios from 'axios';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { ytmp4, ytmp3 } from 'ytdl-lite';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// إدارة جلسات اختيار الصيغة التفاعلية (فيديو MP4 أو صوت MP3)
const convertSessions = new Map();
const convertTimers = new Map();

/**
 * تنظيف جلسة التحويل
 */
function clearConvertSession(cleanSender) {
    if (convertTimers.has(cleanSender)) {
        clearTimeout(convertTimers.get(cleanSender));
        convertTimers.delete(cleanSender);
    }
    convertSessions.delete(cleanSender);
}

/**
 * توحيد ومعالجة النصوص العربية
 */
function normalizeArabic(text) {
    if (!text) return '';
    return text
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[\u064B-\u065F]/g, '') // إزالة التشكيل
        .trim();
}

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
            timeout: 35000,
            maxContentLength: 45 * 1024 * 1024, // 45MB max لحماية ذاكرة السيرفر (180MB RAM)
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
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
        const bufRes = await fetchBufferFromUrl(result.directUrl, { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
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
 * إرسال مقطع صوتي بشكل آمن ومقاوم للأخطاء (بصيغة ملف صوتي MP3 وليس رسالة صوتية)
 */
async function sendAudioSafely(currentConn, from, result, mek) {
    if (!result) return false;

    if (result.buffer) {
        try {
            await currentConn.sendMessage(from, { audio: result.buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: mek });
            return true;
        } catch (_) {}
    }

    if (result.directUrl) {
        try {
            await currentConn.sendMessage(from, { audio: { url: result.directUrl }, mimetype: 'audio/mpeg', ptt: false }, { quoted: mek });
            return true;
        } catch (_) {}

        const bufRes = await fetchBufferFromUrl(result.directUrl);
        if (bufRes?.buffer) {
            try {
                const mime = (bufRes.contentType && bufRes.contentType.includes('audio')) ? bufRes.contentType : 'audio/mpeg';
                await currentConn.sendMessage(from, { audio: bufRes.buffer, mimetype: mime, ptt: false }, { quoted: mek });
                return true;
            } catch (_) {}
        }
    }

    return false;
}

/**
 * 1. 🎵 تحميل تيك توك بدون علامة مائية (فيديو MP4 أو صوت MP3 أو صور)
 */
async function downloadTikTok(url, format = 'video') {
    const finalUrl = (url.includes('vt.tiktok.com') || url.includes('vm.tiktok.com')) ? await resolveRedirectUrl(url) : url;
    const wantAudio = (format === 'audio');

    // المحاولة 1: TikWM GET مع هيدرز المتصفح الكاملة المانعة لحظر Cloudflare 403
    try {
        const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(finalUrl)}&hd=1`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Referer': 'https://www.tikwm.com/',
                'Origin': 'https://www.tikwm.com',
                'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            },
            timeout: 35000
        });

        const data = res.data;
        if (data && data.code === 0 && data.data) {
            const title = data.data.title || 'تيك توك';
            const musicUrl = data.data.music || data.data.music_info?.play;
            const videoUrl = data.data.play || data.data.wmplay;
            const images = data.data.images;

            if (wantAudio && musicUrl) {
                return { type: 'audio', directUrl: musicUrl, title };
            }

            if (videoUrl) {
                return { type: 'video', directUrl: videoUrl, title, musicUrl };
            } else if (images && Array.isArray(images) && images.length > 0) {
                return { type: 'images', list: images, title };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok TikWM GET Error]:', e.message);
    }

    // المحاولة 2: محرك TikWM عبر POST
    try {
        const form = new URLSearchParams();
        form.set('url', finalUrl);
        form.set('hd', '1');
        const res = await axios.post('https://www.tikwm.com/api/', form.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Cookie': 'current_language=en',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
                'Referer': 'https://www.tikwm.com/',
                'Origin': 'https://www.tikwm.com'
            },
            timeout: 35000
        });
        const data = res.data;
        if (data && data.code === 0 && data.data) {
            const title = data.data.title || 'تيك توك';
            const musicUrl = data.data.music || data.data.music_info?.play;
            const videoUrl = data.data.play || data.data.wmplay;
            const images = data.data.images;

            if (wantAudio && musicUrl) {
                return { type: 'audio', directUrl: musicUrl, title };
            }
            if (videoUrl) {
                return { type: 'video', directUrl: videoUrl, title, musicUrl };
            } else if (images && Array.isArray(images) && images.length > 0) {
                return { type: 'images', list: images, title };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok TikWM POST Error]:', e.message);
    }

    // المحاولة 3: مزود Tiklydown السريع
    try {
        const res = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(finalUrl)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });
        if (res.data) {
            const d = res.data;
            const title = d.title || 'تيك توك';
            const musicUrl = d.music?.play_url;
            const videoUrl = d.videoUrl || d.video?.noWatermark;

            if (wantAudio && musicUrl) {
                return { type: 'audio', directUrl: musicUrl, title };
            }
            if (videoUrl) {
                return { type: 'video', directUrl: videoUrl, title, musicUrl };
            }
            if (d.images && Array.isArray(d.images) && d.images.length > 0) {
                return { type: 'images', list: d.images.map(img => img.url || img), title };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok Tiklydown Error]:', e.message);
    }

    // المحاولة 4: مزود SiputzX Douyin عالي السرعة مع فك التوكن المباشر ومهلة 35 ثانية
    try {
        const apiUrl = `https://api.siputzx.my.id/api/d/douyin?url=${encodeURIComponent(finalUrl)}`;
        const res = await axios.get(apiUrl, { timeout: 35000 });
        if (res.data?.status && res.data?.data) {
            const data = res.data.data;
            const title = data.title || 'تيك توك';
            const musicUrl = data.music || data.audio;

            if (wantAudio && musicUrl) {
                return { type: 'audio', directUrl: musicUrl, title };
            }

            if (data.downloads?.length > 0) {
                const dl = data.downloads[0].url;
                let finalVideoUrl = dl;
                if (dl.includes('token=')) {
                    try {
                        const token = dl.split('token=')[1];
                        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
                        if (payload?.url) finalVideoUrl = payload.url;
                    } catch (_) {}
                }
                return { type: 'video', directUrl: finalVideoUrl, title, musicUrl };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok Douyin Provider Error]:', e.message);
    }

    // المحاولة 5: SiputzX TikTok API مع مهلة 35 ثانية
    try {
        const apiUrl = `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(finalUrl)}`;
        const res = await axios.get(apiUrl, { timeout: 35000 });
        const data = res.data;
        if (data && data.status && data.data) {
            const d = data.data;
            const title = d.title || 'تيك توك';
            const musicUrl = d.music || d.audio;

            if (wantAudio && musicUrl) {
                return { type: 'audio', directUrl: musicUrl, title };
            }

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
                return { type: 'video', directUrl: finalVideoUrl, title, musicUrl };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok SiputzX Error]:', e.message);
    }

    // المحاولة 6: SaveFrom الاحتياطي مع فك التوجيه المباشر ومهلة 35 ثانية
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(finalUrl)}`, { timeout: 35000 });
        const items = res.data?.data?.[0]?.data || res.data?.data;
        if (Array.isArray(items) && items.length > 0) {
            const item = items[0];
            const title = item.meta?.title || 'تيك توك';
            const urls = item.url || [];

            if (wantAudio) {
                const a = urls.find(u => u.type === 'mp3' || u.ext === 'mp3' || u.audio === true);
                if (a?.url) {
                    let finalDl = a.url;
                    try {
                        const head = await fetch(a.url, { method: 'HEAD', redirect: 'follow' });
                        if (head.url && !head.url.includes('convert?')) finalDl = head.url;
                    } catch (_) {}
                    return { type: 'audio', directUrl: finalDl, title };
                }
            }

            const dl = urls[0]?.url;
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
            const res = await axios.get(ep, { timeout: 35000 });
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
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(url)}`, { timeout: 35000 });
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
        const res = await axios.get(apiUrl, { timeout: 35000 });
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
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(url)}`, { timeout: 35000 });
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
 * 4. 🎬 تحميل يوتيوب (فيديو عالي الجودة أو صوت MP3)
 */
async function downloadYouTube(url, preferAudio = false) {
    // 🎵 إذا كان المطلوب صوت MP3، نبدأ بأقوى مزود مفتوح (Deezer oEmbed) لأنه لا يُحظر في السيرفرات إطلاقاً!
    if (preferAudio) {
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const oRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
            if (oRes.ok) {
                const oData = await oRes.json();
                const songTitle = oData.title || '';
                if (songTitle) {
                    const cleanQuery = songTitle
                        .replace(/\(.*?\)|\[.*?\]/g, '')
                        .replace(/(official\s*(music\s*)?video|video|clip|lyrics|audio|4k|hd)/gi, '')
                        .trim();
                    const dRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(cleanQuery)}`, {
                        signal: AbortSignal.timeout(8000)
                    });
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
            console.error('⚠️ [YouTube Deezer Fallback Error]:', e.message);
        }
    }

    // المحاولة 2: SaveFrom المباشر مع مهلة 35 ثانية وفك التوجيه السريع
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(url)}`, { timeout: 35000 });
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

    // المحاولة 3: 9xbuddy مع مهلة 35 ثانية
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/9xbuddy?url=${encodeURIComponent(url)}`, { timeout: 35000 });
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

    // المحاولة 4: مكتبة ytdl-lite
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

    // المحاولة 5: SiputzX YouTube API مع مهلة 35 ثانية
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/youtube?url=${encodeURIComponent(url)}`, { timeout: 35000 });
        if (res.data?.status && res.data?.data) {
            const d = res.data.data;
            const title = d.title || 'يوتيوب';
            if (preferAudio && d.audio) {
                return { type: 'audio', directUrl: d.audio, title };
            }
            if (d.video || d.url) {
                return { type: 'video', directUrl: d.video || d.url, title };
            }
        }
    } catch (e) {
        console.error('⚠️ [YouTube SiputzX Error]:', e.message);
    }

    return null;
}

/**
 * تنفيذ عملية التحميل الفعلية للميديا وإرسالها للمستخدم بحسب الصيغة المختارة
 */
async function executeDownloadProcess(mek, currentConn, targetUrl, chosenFormat, quotedMek) {
    const from = mek.key?.remoteJid || mek.chat;
    const formatName = (chosenFormat === 'audio') ? 'صوت MP3 🎵' : 'فيديو MP4 🎬';

    await delay(500);
    await currentConn.sendMessage(from, { react: { text: '⏳', key: mek.key } }).catch(() => {});
    await currentConn.sendMessage(from, {
        text: `⏳ *جاري جلب ومعالجة الميديا بصيغة (${formatName})، ثواني يا غالي...*`
    }, { quoted: quotedMek || mek }).catch(() => {});

    try {
        const lowerUrl = targetUrl.toLowerCase();

        // 1. تيك توك (TikTok / Douyin)
        if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('douyin.com')) {
            const tiktokResult = await downloadTikTok(targetUrl, chosenFormat);
            if (tiktokResult) {
                if (chosenFormat === 'audio') {
                    // إذا رجع صوت مباشر
                    if (tiktokResult.type === 'audio') {
                        const ok = await sendAudioSafely(currentConn, from, tiktokResult, quotedMek || mek);
                        if (ok) {
                            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                            return true;
                        }
                    }
                    // إذا رجع فيديو وأردنا تحويله لصوت
                    if (tiktokResult.type === 'video') {
                        const bufRes = tiktokResult.buffer ? { buffer: tiktokResult.buffer } : await fetchBufferFromUrl(tiktokResult.directUrl);
                        if (bufRes?.buffer) {
                            await currentConn.sendMessage(from, {
                                audio: bufRes.buffer,
                                mimetype: 'audio/mp4',
                                ptt: false
                            }, { quoted: quotedMek || mek });
                            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                            return true;
                        }
                    }
                } else {
                    // تحميل كفيديو
                    if (tiktokResult.type === 'video') {
                        const caption = `🎬 *تم تحميل فيديو تيك توك بنجاح!* ✨\n\n📌 *العنوان:* ${tiktokResult.title}\n\n🤖 *Shadow Bot*`;
                        const ok = await sendVideoSafely(currentConn, from, tiktokResult, caption, quotedMek || mek);
                        if (ok) {
                            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                            return true;
                        }
                    } else if (tiktokResult.type === 'images' && tiktokResult.list) {
                        for (const imgUrl of tiktokResult.list.slice(0, 5)) {
                            await currentConn.sendMessage(from, { image: { url: imgUrl } }, { quoted: quotedMek || mek }).catch(() => {});
                        }
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                }
            }
        }

        // 2. يوتيوب (YouTube)
        if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
            const ytResult = await downloadYouTube(targetUrl, chosenFormat === 'audio');
            if (ytResult) {
                if (chosenFormat === 'audio') {
                    if (ytResult.type === 'audio') {
                        const ok = await sendAudioSafely(currentConn, from, ytResult, quotedMek || mek);
                        if (ok) {
                            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                            return true;
                        }
                    }
                    // إذا عاد فيديو ونريده كصوت
                    if (ytResult.type === 'video') {
                        const bufRes = ytResult.buffer ? { buffer: ytResult.buffer } : await fetchBufferFromUrl(ytResult.directUrl);
                        if (bufRes?.buffer) {
                            await currentConn.sendMessage(from, {
                                audio: bufRes.buffer,
                                mimetype: 'audio/mp4',
                                ptt: false
                            }, { quoted: quotedMek || mek });
                            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                            return true;
                        }
                    }
                } else {
                    // فيديو MP4
                    if (ytResult.type === 'video') {
                        const caption = `🎬 *تم تحميل فيديو يوتيوب بنجاح!* ✨\n\n📌 *العنوان:* ${ytResult.title}\n\n🤖 *Shadow Bot*`;
                        const ok = await sendVideoSafely(currentConn, from, ytResult, caption, quotedMek || mek);
                        if (ok) {
                            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                            return true;
                        }
                    }
                }
            }
        }

        // 3. إنستغرام (Instagram)
        if (lowerUrl.includes('instagram.com') || lowerUrl.includes('instagr.am')) {
            const igResult = await downloadInstagram(targetUrl);
            if (igResult) {
                if (chosenFormat === 'audio') {
                    const bufRes = igResult.buffer ? { buffer: igResult.buffer } : await fetchBufferFromUrl(igResult.directUrl);
                    if (bufRes?.buffer) {
                        await currentConn.sendMessage(from, {
                            audio: bufRes.buffer,
                            mimetype: 'audio/mp4',
                            ptt: false
                        }, { quoted: quotedMek || mek });
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                } else {
                    const caption = `📸 *تم تحميل ميديا إنستغرام بنجاح!* ✨\n\n📌 *العنوان:* ${igResult.title}\n\n🤖 *Shadow Bot*`;
                    if (igResult.type === 'video') {
                        const ok = await sendVideoSafely(currentConn, from, igResult, caption, quotedMek || mek);
                        if (ok) {
                            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                            return true;
                        }
                    } else if (igResult.type === 'image') {
                        if (igResult.buffer) {
                            await currentConn.sendMessage(from, { image: igResult.buffer, caption }, { quoted: quotedMek || mek });
                        } else if (igResult.directUrl) {
                            await currentConn.sendMessage(from, { image: { url: igResult.directUrl }, caption }, { quoted: quotedMek || mek });
                        }
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                }
            }
        }

        // 4. فيسبوك (Facebook)
        if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch') || lowerUrl.includes('fb.com')) {
            const fbResult = await downloadFacebook(targetUrl);
            if (fbResult) {
                if (chosenFormat === 'audio') {
                    const bufRes = fbResult.buffer ? { buffer: fbResult.buffer } : await fetchBufferFromUrl(fbResult.directUrl);
                    if (bufRes?.buffer) {
                        await currentConn.sendMessage(from, {
                            audio: bufRes.buffer,
                            mimetype: 'audio/mp4',
                            ptt: false
                        }, { quoted: quotedMek || mek });
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                } else {
                    const caption = `📽️ *تم تحميل فيديو فيسبوك بنجاح!* ✨\n\n📌 *العنوان:* ${fbResult.title}\n\n🤖 *Shadow Bot*`;
                    const ok = await sendVideoSafely(currentConn, from, fbResult, caption, quotedMek || mek);
                    if (ok) {
                        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                        return true;
                    }
                }
            }
        }

        // 5. روابط الميديا المباشرة (.mp4 / .mp3 / .jpg / etc.)
        const isDirectExt = lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.mkv') || lowerUrl.endsWith('.webm') ||
                            lowerUrl.endsWith('.mp3') || lowerUrl.endsWith('.m4a') || lowerUrl.endsWith('.wav') ||
                            lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg') || lowerUrl.endsWith('.png') || lowerUrl.endsWith('.webp');

        if (isDirectExt) {
            const directMedia = await fetchBufferFromUrl(targetUrl);
            if (directMedia && directMedia.buffer && directMedia.buffer.length > 0) {
                if (chosenFormat === 'audio') {
                    await currentConn.sendMessage(from, {
                        audio: directMedia.buffer,
                        mimetype: 'audio/mpeg',
                        ptt: false
                    }, { quoted: quotedMek || mek });
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                } else {
                    const cType = directMedia.contentType.toLowerCase();
                    const isVideo = cType.includes('video') || lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.mkv') || lowerUrl.endsWith('.webm');
                    if (isVideo) {
                        await currentConn.sendMessage(from, {
                            video: directMedia.buffer,
                            caption: `🎬 *تم تحميل الفيديو بنجاح!* ✨\n\n🤖 *Shadow Bot*`
                        }, { quoted: quotedMek || mek });
                    } else {
                        await currentConn.sendMessage(from, {
                            image: directMedia.buffer,
                            caption: `🖼️ *تم تحميل الصورة بنجاح!* ✨\n\n🤖 *Shadow Bot*`
                        }, { quoted: quotedMek || mek });
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                }
            }
        }

        // إذا تعذر الوصول لملف الميديا
        await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
        await currentConn.sendMessage(from, { 
            text: `❌ *تعذر تحميل الميديا من هذا الرابط حالياً!*\n\n💡 *تأكد من الآتي:*\n1️⃣ أن المنشور أو الحساب عام (Public) وليس خاصاً (Private).\n2️⃣ أن الرابط يعمل ومفتوح للجميع.\n3️⃣ المنصات المدعومة حالياً: *تيك توك*، *يوتيوب*، *إنستغرام*، *فيسبوك*، وروابط الميديا المباشرة.` 
        }, { quoted: quotedMek || mek });

    } catch (err) {
        console.error('⚠️ [Downloader General Error]:', err.message);
        await currentConn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
        await currentConn.sendMessage(from, { text: '❌ حدث خطأ أثناء محاولة تنزيل الرابط، يرجى التأكد من الرابط والمحاولة مجدداً.' }, { quoted: quotedMek || mek });
    }

    return true;
}

/**
 * فحص الرد لاختيار صيغة التحويل أثناء الجلسة التفاعلية النشطة
 */
export async function checkConvertSession(mek, currentConn, rawBody, cleanSender, from) {
    if (!cleanSender || !convertSessions.has(cleanSender)) return false;

    const session = convertSessions.get(cleanSender);
    if (!session || session.chat !== from) return false;

    const text = (rawBody || '').trim().toLowerCase();
    const norm = normalizeArabic(text);

    // 1. الإلغاء
    if (['الغاء', 'إلغاء', 'cancel', 'خروج', 'stop', 'لا'].includes(norm)) {
        clearConvertSession(cleanSender);
        await currentConn.sendMessage(from, { text: '❌ تم إلغاء عملية التحويل بنجاح.' }, { quoted: mek });
        return true;
    }

    // 2. فحص اختيار الصيغة: فيديو MP4 أو صوت MP3
    let chosenFormat = null;
    if (['1', '١', 'فيديو', 'فديو', 'mp4', 'video', 'vid'].includes(norm)) {
        chosenFormat = 'video';
    } else if (['2', '٢', 'صوت', 'اغنية', 'اغنيه', 'أغنية', 'أغنيه', 'mp3', 'audio', 'sound'].includes(norm)) {
        chosenFormat = 'audio';
    }

    if (!chosenFormat) {
        await currentConn.sendMessage(from, {
            text: `⚠️ *برجاء اختيار صيغة صحيحة!* 📥\n\n1️⃣ - أرسل *(1)* أو *(فيديو)* للتحميل بصيغة MP4 🎬\n2️⃣ - أرسل *(2)* أو *(صوت)* للتحميل بصيغة MP3 🎵\n❌ - أو اكتب *(الغاء)* لإلغاء الطلب.`
        }, { quoted: mek });
        return true;
    }

    // تم الاختيار، تنظيف الجلسة والبدء الفوري بالتحميل
    const targetUrl = session.url;
    const quotedMek = session.quotedMek;
    clearConvertSession(cleanSender);

    await executeDownloadProcess(mek, currentConn, targetUrl, chosenFormat, quotedMek);
    return true;
}

/**
 * معالج أمر التحويل والتحميل المباشر
 */
export async function handleConvertCommand(mek, currentConn, rawBody, customSender) {
    const from = mek.key?.remoteJid || mek.chat;
    const body = rawBody || '';
    const sender = customSender || mek.key?.participant || mek.key?.remoteJid || mek.participant || '';
    const cleanSender = String(sender).split('@')[0].split(':')[0];

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
            await delay(500);
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
            `• *يوتيوب* ➔ تحميل فيديوهات وأغاني يوتيوب المباشرة 🎵\n` +
            `• *إنستغرام* ➔ تحميل ريلز وبوستات وصور إنستا بدقة عالية 📸\n` +
            `• *فيسبوك* ➔ تحميل ريلز وفيديوهات بدقة HD عالية 📽️\n` +
            `• *روابط الميديا المباشرة* (.mp4 / .mp3 / .jpg / .png) فوراً ⚡\n` +
            `• *تحويل الفيديو لصوت* ➔ اعمل ريبلاي على أي فيديو واكتب *تحويل* 🎙️\n\n` +
            `👑 *Shadow Bot*`;

        await currentConn.sendMessage(from, { text: guideMsg }, { quoted: mek });
        return true;
    }

    // فحص هل حدد المستخدم الصيغة مسبقاً في نفس الرسالة (صوت / فيديو)
    const lowerBody = body.toLowerCase();
    let explicitFormat = null;
    if (lowerBody.includes('صوت') || lowerBody.includes('اغني') || lowerBody.includes('أغني') || lowerBody.includes('mp3') || lowerBody.includes('audio')) {
        explicitFormat = 'audio';
    } else if (lowerBody.includes('فيديو') || lowerBody.includes('فديو') || lowerBody.includes('mp4') || lowerBody.includes('video')) {
        explicitFormat = 'video';
    }

    // إذا حدد الصيغة مباشرة في الأمر، نبدأ التنزيل فوراً
    if (explicitFormat) {
        await executeDownloadProcess(mek, currentConn, targetUrl, explicitFormat, mek);
        return true;
    }

    // إذا لم يحدد، نسأله تفاعلياً هل يريدها فيديو MP4 أو صوت MP3
    clearConvertSession(cleanSender);
    convertSessions.set(cleanSender, {
        url: targetUrl,
        chat: from,
        quotedMek: mek,
        timestamp: Date.now()
    });

    // مهلة دقيقتين لانتهاء الجلسة
    const timer = setTimeout(() => {
        clearConvertSession(cleanSender);
    }, 120000);
    convertTimers.set(cleanSender, timer);

    const promptMsg = 
        `🎬 *اختر صيغة التحميل المطلوبة:* 📥\n\n` +
        `1️⃣ - *فيديو (MP4)* 🎬\n` +
        `2️⃣ - *صوت (MP3)* 🎵\n\n` +
        `💡 *أرسل رقم (1) أو كلمة (فيديو) للتحميل كفيديو.*\n` +
        `💡 *أرسل رقم (2) أو كلمة (صوت) للتحميل كصوت.*\n` +
        `❌ *أو أرسل (الغاء) لإلغاء العملية.*\n\n` +
        `👑 *Shadow Bot*`;

    await currentConn.sendMessage(from, { text: promptMsg }, { quoted: mek });
    return true;
}

export default {
    handleConvertCommand,
    checkConvertSession
};
