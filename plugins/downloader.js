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
            maxRedirects: 5,
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        return headRes.request?.res?.responseUrl || url;
    } catch (_) {
        return url;
    }
}

/**
 * 1. 🎵 تحميل تيك توك بدون علامة مائية وصوت وصور
 */
async function downloadTikTok(url) {
    const finalUrl = (url.includes('vt.tiktok.com') || url.includes('vm.tiktok.com')) ? await resolveRedirectUrl(url) : url;

    // المحاولة 1: TikWM API الأساسي
    try {
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(finalUrl)}`;
        const res = await axios.get(apiUrl, { timeout: 12000 });
        const data = res.data;
        if (data && data.code === 0 && data.data) {
            const videoUrl = data.data.play || data.data.wmplay;
            const title = data.data.title || 'فيديو تيك توك';
            const musicUrl = data.data.music;
            const images = data.data.images;

            if (videoUrl) {
                const bufRes = await fetchBufferFromUrl(videoUrl, { 'Referer': 'https://www.tiktok.com/' });
                if (bufRes?.buffer) {
                    return { type: 'video', buffer: bufRes.buffer, title, musicUrl, directUrl: videoUrl };
                }
                return { type: 'video', directUrl: videoUrl, title, musicUrl };
            } else if (images && Array.isArray(images) && images.length > 0) {
                return { type: 'images', list: images, title };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok TikWM Error]:', e.message);
    }

    // المحاولة 2: SiputzX TikTok API المباشر مع فك التوكن
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
                const bufRes = await fetchBufferFromUrl(finalVideoUrl);
                if (bufRes?.buffer) {
                    return { type: 'video', buffer: bufRes.buffer, title: d.title || 'فيديو تيك توك', directUrl: finalVideoUrl };
                }
                return { type: 'video', directUrl: finalVideoUrl, title: d.title || 'فيديو تيك توك' };
            }
        }
    } catch (e) {
        console.error('⚠️ [TikTok SiputzX Error]:', e.message);
    }

    // المحاولة 3: SaveFrom الاحتياطي
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(finalUrl)}`, { timeout: 15000 });
        const items = res.data?.data?.[0]?.data || res.data?.data;
        if (Array.isArray(items) && items.length > 0) {
            const item = items[0];
            const title = item.meta?.title || 'فيديو تيك توك';
            const dl = item.url?.[0]?.url;
            if (dl) {
                const bufRes = await fetchBufferFromUrl(dl);
                if (bufRes?.buffer) {
                    return { type: 'video', buffer: bufRes.buffer, title, directUrl: dl };
                }
                return { type: 'video', directUrl: dl, title };
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
                        const bufRes = await fetchBufferFromUrl(targetUrl);
                        const isVideo = (typeof first === 'object' && first.type === 'video') ||
                                        targetUrl.includes('.mp4') ||
                                        bufRes?.contentType?.includes('video');

                        if (isVideo) {
                            return {
                                type: 'video',
                                buffer: bufRes?.buffer,
                                directUrl: targetUrl,
                                title
                            };
                        } else {
                            return {
                                type: 'image',
                                buffer: bufRes?.buffer,
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
                const bufRes = await fetchBufferFromUrl(dl);
                return {
                    type: 'video',
                    buffer: bufRes?.buffer,
                    directUrl: dl,
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

            const bufRes = await fetchBufferFromUrl(finalVideoUrl);
            const title = data.data.title || 'فيديو فيسبوك';
            if (bufRes?.buffer) {
                return { type: 'video', buffer: bufRes.buffer, title, directUrl: finalVideoUrl };
            }
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
                const bufRes = await fetchBufferFromUrl(dl);
                return { type: 'video', buffer: bufRes?.buffer, directUrl: dl, title };
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
    // المحاولة 1: SaveFrom المباشر السريع وعالي الجودة
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
                    const bufRes = await fetchBufferFromUrl(audioObj.url);
                    return { type: 'audio', buffer: bufRes?.buffer, directUrl: audioObj.url, title };
                }
            } else {
                const videoObj = urls.find(u => u.quality === '720' || u.quality === '480' || u.quality === '360') || urls[0];
                if (videoObj?.url) {
                    const bufRes = await fetchBufferFromUrl(videoObj.url);
                    return { type: 'video', buffer: bufRes?.buffer, directUrl: videoObj.url, title };
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [YouTube SaveFrom Error]:', e.message);
    }

    // المحاولة 2: مكتبة ytdl-lite
    try {
        if (preferAudio) {
            const res = await ytmp3(url);
            if (res && res.status && res.url) {
                const bufRes = await fetchBufferFromUrl(res.url);
                return { type: 'audio', buffer: bufRes?.buffer, directUrl: res.url, title: res.title || 'صوت يوتيوب' };
            }
        } else {
            const res = await ytmp4(url, '360');
            if (res && res.status && res.url) {
                const bufRes = await fetchBufferFromUrl(res.url);
                return { type: 'video', buffer: bufRes?.buffer, directUrl: res.url, title: res.title || 'فيديو يوتيوب' };
            }
        }
    } catch (e) {
        console.error('⚠️ [YouTube ytdl Error]:', e.message);
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
                    const bufRes = await fetchBufferFromUrl(dlUrl);
                    return { type: 'audio', buffer: bufRes?.buffer, directUrl: dlUrl, title };
                }
            } else {
                const v = formats.find(f => f.type === 'video' && f.url && !f.external);
                if (v) {
                    const dlUrl = v.url.startsWith('/') ? 'https://9xbuddy.com' + v.url : v.url;
                    const bufRes = await fetchBufferFromUrl(dlUrl);
                    return { type: 'video', buffer: bufRes?.buffer, directUrl: dlUrl, title };
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
                        const bufRes = await fetchBufferFromUrl(preview);
                        if (bufRes?.buffer) {
                            return { type: 'audio', buffer: bufRes.buffer, title: songTitle };
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

        // 2. إنستغرام (Instagram)
        if (lowerUrl.includes('instagram.com') || lowerUrl.includes('instagr.am')) {
            const igResult = await downloadInstagram(targetUrl);
            if (igResult) {
                const caption = `📸 *تم تحميل ميديا إنستغرام بنجاح!* ✨\n\n📌 *العنوان:* ${igResult.title}\n\n🤖 *Shadow Bot*`;
                if (igResult.type === 'video') {
                    if (igResult.buffer) {
                        await currentConn.sendMessage(from, {
                            video: igResult.buffer,
                            caption: caption
                        }, { quoted: mek });
                    } else if (igResult.directUrl) {
                        await currentConn.sendMessage(from, {
                            video: { url: igResult.directUrl },
                            caption: caption
                        }, { quoted: mek });
                    }
                    await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
                    return true;
                } else if (igResult.type === 'image') {
                    if (igResult.buffer) {
                        await currentConn.sendMessage(from, {
                            image: igResult.buffer,
                            caption: caption
                        }, { quoted: mek });
                    } else if (igResult.directUrl) {
                        await currentConn.sendMessage(from, {
                            image: { url: igResult.directUrl },
                            caption: caption
                        }, { quoted: mek });
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

        // 4. يوتيوب (YouTube)
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
