// plugins/image.js
import axios from 'axios';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ⏱️ دالة تأخير بسيطة
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let cachedFfmpegBin = null;

async function getFfmpegBin() {
    if (cachedFfmpegBin) return cachedFfmpegBin;
    try {
        const ffStatic = (await import('ffmpeg-static')).default;
        if (ffStatic && fs.existsSync(ffStatic)) {
            cachedFfmpegBin = ffStatic;
            return cachedFfmpegBin;
        }
    } catch (_) {}
    cachedFfmpegBin = 'ffmpeg';
    return cachedFfmpegBin;
}

/**
 * فحص وتأكيد صحة بافر الصورة من الهيدر الثنائي (JPEG / PNG / WebP)
 * يمنع نهائياً إرسال أي ملفات تالفة أو نصوص أخطاء HTML إلى واتساب
 */
function isValidImage(buf) {
    if (!buf || !Buffer.isBuffer(buf) || buf.length < 1000) return false;
    // JPEG magic bytes: FF D8
    if (buf[0] === 0xFF && buf[1] === 0xD8) return true;
    // PNG magic bytes: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
    // WebP magic bytes: RIFF .... WEBP
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
    return false;
}

/**
 * تنظيف وتوحيد الحروف العربية
 */
function normalizeArabic(text) {
    if (!text) return '';
    return text
        .trim()
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+/g, ' ');
}

/**
 * ترجمة النص العربي إلى الإنجليزية لضمان فهم محرك الذكاء الاصطناعي وتجنب أخطاء 402/503
 */
async function translateToEnglish(text) {
    if (!text || !/[\u0600-\u06FF]/.test(text)) return text;
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ar|en`;
        const res = await axios.get(url, { timeout: 6000 });
        if (res.data?.responseData?.translatedText) {
            return res.data.responseData.translatedText;
        }
    } catch (_) {}
    return text;
}

/**
 * البحث عن صور حقيقية عالية الدقة عبر محرك بينج
 */
async function searchBingImages(query) {
    try {
        const bUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&FORM=HDRSC2&first=1`;
        const res = await axios.get(bUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 9000
        });

        const mRegex = /murl&quot;:&quot;(https?:\/\/[^&]+)&quot;/g;
        const matches = [...res.data.matchAll(mRegex)].map(m => m[1]);

        const validUrls = matches.filter(url => {
            if (!url.startsWith('http')) return false;
            if (url.includes('.svg') || url.includes('.ico')) return false;
            return true;
        });

        return validUrls;
    } catch (e) {
        console.error('⚠️ [Image Search Error]:', e?.message || e);
        return [];
    }
}

/**
 * تحميل بافر الصورة من الرابط والتأكد من أنها صورة صالحة 100%
 */
async function downloadImageBuffer(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });

        if (res.status === 200 && res.data) {
            const buf = Buffer.from(res.data);
            if (isValidImage(buf)) return buf;
        }
    } catch (_) {}
    return null;
}

/**
 * توليد صورة بالذكاء الاصطناعي عبر Pollinations AI مع ترجمة فورية وبديل رقمي
 */
async function generateAiImage(rawPrompt) {
    const englishPrompt = await translateToEnglish(rawPrompt);

    // 1. المحاولة الأساسية عبر سيرفرات الرسم المجاني
    try {
        const seed = Math.floor(Math.random() * 100000);
        const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?seed=${seed}`;
        const res = await axios.get(pUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (res.status === 200 && res.data) {
            const buf = Buffer.from(res.data);
            if (isValidImage(buf)) return buf;
        }
    } catch (e) {
        console.log('⚠️ [Primary AI Engine Error]:', e?.message || e);
    }

    // 2. المحاولة البديلة عبر رسم المفاهيم الفنية العالية (Digital Concept Art)
    try {
        const bUrl = `https://www.bing.com/images/search?q=${encodeURIComponent('digital art ' + englishPrompt)}&FORM=HDRSC2&first=1`;
        const bRes = await axios.get(bUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 8000
        });
        const mRegex = /murl&quot;:&quot;(https?:\/\/[^&]+)&quot;/g;
        const matches = [...bRes.data.matchAll(mRegex)].map(m => m[1]);
        for (const u of matches.slice(0, 5)) {
            const dlBuf = await downloadImageBuffer(u);
            if (dlBuf && isValidImage(dlBuf)) return dlBuf;
        }
    } catch (e) {
        console.log('⚠️ [Fallback Art Engine Error]:', e?.message || e);
    }

    return null;
}

/**
 * وضع علامة مائية (Watermark) باسم البوت في الزاوية السفلية اليمنى عبر FFmpeg
 * مع إضافة معيار -strict -1 لضمان خروج JPEG قياسي متوافق 100% مع واتساب
 */
async function applyWatermark(imgBuffer, isAi = false) {
    if (!isValidImage(imgBuffer)) return imgBuffer;

    return new Promise(async (resolve) => {
        const randId = Math.random().toString(36).substring(2, 8);
        const tmpInput = path.join(os.tmpdir(), `wm_in_${Date.now()}_${randId}.jpg`);
        const tmpOutput = path.join(os.tmpdir(), `wm_out_${Date.now()}_${randId}.jpg`);
        const wmPath = path.join(process.cwd(), 'assets', isAi ? 'watermark_ai.png' : 'watermark.png');

        if (!fs.existsSync(wmPath)) return resolve(imgBuffer);

        try {
            fs.writeFileSync(tmpInput, imgBuffer);
            const ffmpegBin = await getFfmpegBin();

            const ff = spawn(ffmpegBin, [
                '-y',
                '-i', tmpInput,
                '-i', wmPath,
                '-filter_complex', '[0:v][1:v]overlay=W-w-18:H-h-18',
                '-strict', '-1',
                '-q:v', '2',
                tmpOutput
            ]);

            ff.on('close', (code) => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                if (code === 0 && fs.existsSync(tmpOutput)) {
                    try {
                        const outBuf = fs.readFileSync(tmpOutput);
                        try { fs.unlinkSync(tmpOutput); } catch (_) {}
                        if (isValidImage(outBuf)) {
                            return resolve(outBuf);
                        }
                    } catch (_) {}
                }
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                resolve(imgBuffer);
            });

            ff.on('error', () => {
                try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
                resolve(imgBuffer);
            });
        } catch (_) {
            resolve(imgBuffer);
        }
    });
}

/**
 * معالج أمر الصور الموحد (صوره)
 */
export async function handleImageCommand(mek, currentConn, rawBody) {
    try {
        const body = (rawBody || '').trim();
        const normalized = normalizeArabic(body.toLowerCase());

        // التحقق من أن الرسالة تبدأ بأمر صوره / صورة
        const isImageCmd = /^(\.|\/)?(صوره|صورة|img|image|pic)(\s|$)/i.test(normalized);
        if (!isImageCmd) return false;

        const from = mek.key?.remoteJid || mek.chat;
        if (!from) return false;

        const sender = mek.key?.participant || from;
        const userNumber = sender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

        const botName = mek.botName || currentConn.botName || 'شادو بوت';

        // استخراج نص البحث أو الوصف
        let query = body.replace(/^(\.|\/)?(صوره|صورة|img|image|pic)\s*/i, '').trim();

        // إذا كتب المستخدم الأمر بدون نص
        if (!query) {
            const guideText = 
                `📸 *طريقة طلب الصور من البوت:* 🖼️\n\n` +
                `1️⃣ *بحث عن أي صورة في العالم:* \n` +
                `• اكتب: *صوره [اسم أي شخص أو حاجة]*\n` +
                `مثال: *صوره كريستيانو رونالدو* | *صوره خلفيات انمي 4k*\n` +
                `مثال: *صوره سيارات بورش سوداء*\n\n` +
                `2️⃣ *توليد صورة بالذكاء الاصطناعي (AI):* \n` +
                `• اكتب: *صوره ai [وصف الصورة اللي في خيالك]*\n` +
                `مثال: *صوره ai قطة في الفضاء بتلبس نظارة شمس*\n` +
                `مثال: *صوره تخيل قلعة عائمة في السحاب وسط الغروب*\n\n` +
                `⚡ كل الصور بتجيلك بجودة عالية مع توقيع البوت الرسمي في الأسفل! 👑`;

            await delay(1200);
            await currentConn.sendMessage(from, { text: guideText }, { quoted: mek });
            return true;
        }

        // فحص هل الطلب ذكاء اصطناعي (AI)
        const isAi = /^(ai|اي|ذكاء|تخيل|ارسم|رسم)\b/i.test(query) || 
                     /\b(ai|ذكاء اصطناعي|بالذكاء الاصطناعي)\b/i.test(query);

        if (isAi) {
            // تنظيف وصف الصورة لإرساله لمحرك الرسم
            let cleanPrompt = query
                .replace(/^(ai|اي|ذكاء اصطناعي|بالذكاء الاصطناعي|تخيل|ارسم|رسم)\s*/i, '')
                .replace(/\b(ai|ذكاء اصطناعي|بالذكاء الاصطناعي)\b/gi, '')
                .trim();

            if (!cleanPrompt) cleanPrompt = query;

            // تفاعل مع الرسالة
            await delay(800);
            try { await currentConn.sendMessage(from, { react: { text: '🎨', key: mek.key } }); } catch (_) {}

            const aiBuffer = await generateAiImage(cleanPrompt);
            if (!aiBuffer || !isValidImage(aiBuffer)) {
                await currentConn.sendMessage(from, { 
                    text: `❌ عذراً! تعذر توليد الصورة بالذكاء الاصطناعي حالياً، برجاء المحاولة لاحقاً.` 
                }, { quoted: mek });
                return true;
            }

            // تطبيق توقيع وعلامة البوت المائية في الأسفل يمين عبر FFmpeg
            const finalImage = await applyWatermark(aiBuffer, true);
            const imageToSend = isValidImage(finalImage) ? finalImage : aiBuffer;

            const caption = 
                `🎨 *صورة بالذكاء الاصطناعي:* « ${cleanPrompt} »\n` +
                `✨ *الدقة:* HD\n` +
                `👤 *طلب:* @${userNumber}\n` +
                `👑 *تم الرسم بواسطة:* ${botName}`;

            await delay(1200);
            await currentConn.sendMessage(from, { 
                image: imageToSend,
                caption: caption,
                mentions: [sender]
            }, { quoted: mek });

            return true;
        }

        // بحث عن صورة عادية
        await delay(800);
        try { await currentConn.sendMessage(from, { react: { text: '🔍', key: mek.key } }); } catch (_) {}

        const urls = await searchBingImages(query);
        if (!urls || urls.length === 0) {
            await currentConn.sendMessage(from, { 
                text: `❌ تعذر العثور على صورة لـ « ${query} » حالياً.\n💡 يمكنك تجربة رسمها بالذكاء الاصطناعي عبر:\n*(صوره ai ${query})*` 
            }, { quoted: mek });
            return true;
        }

        // اختيار عشوائي من بين أفضل النتائج لضمان التنوع عند تكرار البحث
        const topPool = urls.slice(0, Math.min(8, urls.length));
        for (let i = topPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [topPool[i], topPool[j]] = [topPool[j], topPool[i]];
        }

        let downloadedBuffer = null;
        for (const u of topPool) {
            downloadedBuffer = await downloadImageBuffer(u);
            if (downloadedBuffer && isValidImage(downloadedBuffer)) break;
        }

        if (!downloadedBuffer || !isValidImage(downloadedBuffer)) {
            await currentConn.sendMessage(from, { 
                text: `❌ تعذر تحميل صورة صالحة لـ « ${query} ».. يرجى المحاولة بكلمات بحث أخرى.` 
            }, { quoted: mek });
            return true;
        }

        // تطبيق توقيع وعلامة البوت المائية في الأسفل يمين عبر FFmpeg
        const finalImage = await applyWatermark(downloadedBuffer, false);
        const imageToSend = isValidImage(finalImage) ? finalImage : downloadedBuffer;

        const caption = 
            `🖼️ *طلبك لصورة:* « ${query} »\n` +
            `👤 *طلب:* @${userNumber}\n` +
            `👑 *بواسطة:* ${botName}`;

        await delay(1200);
        await currentConn.sendMessage(from, { 
            image: imageToSend,
            caption: caption,
            mentions: [sender]
        }, { quoted: mek });

        return true;

    } catch (err) {
        console.error('⚠️ [Error in handleImageCommand]:', err);
        return false;
    }
}

export default handleImageCommand;
