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
    if (!buf || !Buffer.isBuffer(buf) || buf.length < 3000) return false;
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
 * قاموس ذكي لتصحيح وتوجيه أشهر الشخصيات والكيانات لضمان دقة البحث بنسبة 100%
 */
const SMART_ENTITIES = {
    // أنمي
    'لوفي': 'Luffy One Piece',
    'زورو': 'Roronoa Zoro One Piece',
    'سانجي': 'Sanji One Piece',
    'ايس': 'Portgas D. Ace One Piece',
    'شانكس': 'Shanks One Piece',
    'غوكو': 'Son Goku Dragon Ball',
    'جوكو': 'Son Goku Dragon Ball',
    'فيجيتا': 'Vegeta Dragon Ball',
    'ناروتو': 'Naruto Uzumaki',
    'ساسكي': 'Sasuke Uchiha',
    'ايتاشي': 'Itachi Uchiha',
    'مادارا': 'Madara Uchiha',
    'كاكاشي': 'Kakashi Hatake',
    'ليفاي': 'Levi Ackerman Attack on Titan',
    'ايرين': 'Eren Yeager Attack on Titan',
    'ميكاسا': 'Mikasa Ackerman Attack on Titan',
    'غوجو': 'Gojo Satoru Jujutsu Kaisen',
    'جوجو': 'Gojo Satoru Jujutsu Kaisen',
    'سوكونا': 'Ryomen Sukuna Jujutsu Kaisen',
    'ميغومي': 'Megumi Fushiguro Jujutsu Kaisen',
    'ايانوكوجي': 'Kiyotaka Ayanokoji Classroom of the Elite',
    'سايتاما': 'Saitama One Punch Man',
    'غاروو': 'Garou One Punch Man',
    'تانجيرو': 'Tanjiro Kamado Demon Slayer',
    'نيزوكو': 'Nezuko Kamado Demon Slayer',
    'استا': 'Asta Black Clover',
    'يونو': 'Yuno Black Clover',
    'يامي': 'Yami Sukehiro Black Clover',
    'كانيكي': 'Ken Kaneki Tokyo Ghoul',

    // كرة قدم ومشاهير رياضيون
    'ميسي': 'Lionel Messi HD',
    'ليونيل ميسي': 'Lionel Messi HD',
    'كريستيانو': 'Cristiano Ronaldo HD',
    'رونالدو': 'Cristiano Ronaldo HD',
    'الدون': 'Cristiano Ronaldo HD',
    'صلاح': 'Mohamed Salah HD',
    'محمد صلاح': 'Mohamed Salah HD',
    'فخر العرب': 'Mohamed Salah Liverpool',
    'هالاند': 'Erling Haaland',
    'مبابي': 'Kylian Mbappe',
    'نيمار': 'Neymar Jr',
    'بيلينجهام': 'Jude Bellingham Real Madrid',
    'فينيسيوس': 'Vinicius Junior Real Madrid',
    'مودريتش': 'Luka Modric',
    'بنزيما': 'Karim Benzema',
    'شيكابالا': 'محمود شيكابالا الزمالك',
    'زيزو': 'أحمد سيد زيزو',
    'افشه': 'محمد مجدي قفشة الأهلي',
    'الشناوي': 'محمد الشناوي الأهلي',
    'الاهلي': 'النادي الاهلي المصري شعار خلفيات',
    'الزمالك': 'نادي الزمالك شعار خلفيات',
    'ريال مدريد': 'Real Madrid wallpaper HD',
    'برشلونة': 'FC Barcelona wallpaper HD',

    // مشاهير مصريون وعرب
    'عادل امام': 'عادل إمام الزعيم',
    'احمد زكي': 'أحمد زكي فنان',
    'محمود عبد العزيز': 'محمود عبد العزيز فنان',
    'عمرو دياب': 'عمرو دياب الهضبة',
    'تامر حسني': 'تامر حسني',
    'محمد منير': 'محمد منير الكينج',

    // أماكن مقدسة ومعالم
    'الكعبة': 'الكعبة المشرفة مكة المكرمة HD',
    'الكعبه': 'الكعبة المشرفة مكة المكرمة HD',
    'الحرم': 'المسجد الحرام مكة HD',
    'المسجد النبوي': 'المسجد النبوي الشريف المدينة HD',
    'القدس': 'المسجد الأقصى قبة الصخرة HD',
    'الاقصى': 'المسجد الأقصى المبارك HD',
    'الاهرامات': 'أهرامات الجيزة مصر HD',

    // سيارات
    'مرسيدس': 'Mercedes-Benz AMG wallpaper 4k',
    'بي ام دبليو': 'BMW M Power wallpaper 4k',
    'بورش': 'Porsche 911 GT3 wallpaper 4k',
    'لامبورجيني': 'Lamborghini Aventador 4k',
    'فيراري': 'Ferrari supercar 4k'
};

/**
 * تنظيف العبارة واستخراج الكلمات المفتاحية الحقيقية للبحث
 */
function cleanImageQuery(rawText) {
    if (!rawText) return '';
    let q = rawText.trim();

    // إزالة بادئات الأوامر
    q = q.replace(/^(\.|\/)?(صوره|صورة|صور|img|image|pic)\s*/i, '');

    // إزالة كلمات الطلب العامية المصرية والعربية
    q = q.replace(/^(عايز|عاوز|عاوزين|ابعتلي|ابعت|هات|ممكن|وريني|نزل|طلعلي|جيب|اعملي)\s+(صوره|صورة|صور|خلفيه|خلفية|صوره لـ|صورة لـ|صور لـ)?\s*/i, '');
    q = q.replace(/^(صوره\s+لـ|صورة\s+لـ|صور\s+لـ|صوره\s+عن|صورة\s+عن|صور\s+عن|لـ)\s*/i, '');

    // إزالة كلمات التحية أو المجاملة في النهاية
    q = q.replace(/\s+(لو\s+سمحت|بالله\s+عليك|من\s+فضلك|سريعا|يا\s+شادو|يا\s+بوت|يا\s+عم)\s*$/i, '');

    return q.trim();
}

/**
 * ترجمة النص العربي إلى الإنجليزية بدقة فائقة عبر سيرفرات جوجل المفتوحة
 */
async function translateToEnglish(text) {
    if (!text || !/[\u0600-\u06FF]/.test(text)) return text;
    
    // المحاولة 1: سيرفر Google Chrome Dict API
    try {
        const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=en&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url, { 
            timeout: 6000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (Array.isArray(res.data) && res.data[0] && res.data[0][0]) {
            return String(res.data[0][0]).trim();
        }
    } catch (_) {}

    // المحاولة 2: سيرفر Google Translate المفتوح
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url, { timeout: 5000 });
        if (Array.isArray(res.data) && res.data[0] && res.data[0][0] && res.data[0][0][0]) {
            return String(res.data[0][0][0]).trim();
        }
    } catch (_) {}

    return text;
}

/**
 * محرك 1: البحث عبر Bing Images بدقة عالية
 */
async function searchBingImages(query) {
    try {
        const bUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&FORM=HDRSC2&first=1`;
        const res = await axios.get(bUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            },
            timeout: 7000
        });

        const mRegex = /murl&quot;:&quot;(https?:\/\/[^&]+)&quot;/g;
        const matches = [...res.data.matchAll(mRegex)].map(m => m[1]);

        return matches.filter(url => {
            if (!url.startsWith('http')) return false;
            if (url.includes('.svg') || url.includes('.ico')) return false;
            return true;
        });
    } catch (_) {
        return [];
    }
}

/**
 * محرك 2: البحث عبر DuckDuckGo Images
 */
async function searchDuckDuckGoImages(query) {
    try {
        const tokenRes = await axios.get(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'ar,en-US;q=0.8,en;q=0.6'
            },
            timeout: 6000
        });
        const vqdMatch = tokenRes.data.match(/vqd=["']?([^"'&]+)/i);
        if (!vqdMatch) return [];
        const vqd = vqdMatch[1];

        const imgRes = await axios.get(`https://duckduckgo.com/i.js?l=wt-wt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://duckduckgo.com/'
            },
            timeout: 7000
        });

        if (imgRes.data?.results && Array.isArray(imgRes.data.results)) {
            return imgRes.data.results
                .map(r => r.image)
                .filter(u => u && u.startsWith('http') && !u.endsWith('.svg'));
        }
    } catch (_) {}
    return [];
}

/**
 * محرك 3: البحث عبر Google Images Scraping
 */
async function searchGoogleImages(query) {
    try {
        const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&hl=ar&gl=eg`;
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'ar,en-US;q=0.8,en;q=0.6'
            },
            timeout: 6000
        });

        const urls = [];
        const regex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))",\s*(\d+),\s*(\d+)\]/g;
        let match;
        while ((match = regex.exec(res.data)) !== null) {
            const imgUrl = match[1];
            const w = parseInt(match[2], 10);
            const h = parseInt(match[3], 10);
            if (w > 250 && h > 250 && !imgUrl.includes('gstatic.com') && !imgUrl.includes('google.com')) {
                urls.push(imgUrl);
            }
        }

        if (urls.length === 0) {
            const thumbRegex = /"(https?:\/\/encrypted-tbn0\.gstatic\.com\/images\?q=[^"]+)"/g;
            let thumbMatch;
            while ((thumbMatch = thumbRegex.exec(res.data)) !== null) {
                urls.push(thumbMatch[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'));
            }
        }

        return urls;
    } catch (_) {}
    return [];
}

/**
 * محرك 4: البحث عبر Unsplash للمناظر الطبيعية والسيارات والخلفيات
 */
async function searchUnsplashImages(query) {
    try {
        const url = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(query)}&per_page=12`;
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000
        });
        if (res.data?.results && Array.isArray(res.data.results)) {
            return res.data.results.map(r => r.urls?.regular || r.urls?.full).filter(Boolean);
        }
    } catch (_) {}
    return [];
}

/**
 * تحميل بافر الصورة والتحقق من صحتها وحجمها
 */
async function downloadImageBuffer(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000,
            maxContentLength: 15 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': 'https://www.google.com/'
            }
        });

        if (res.status === 200 && res.data) {
            const buf = Buffer.from(res.data);
            if (isValidImage(buf) && buf.length > 5000) return buf;
        }
    } catch (_) {}
    return null;
}

/**
 * محرك البحث الموحد والذكي: يبحث باللغة العربية والإنجليزية عبر جميع المحركات ويجمع النتائج
 */
async function smartSearchImages(cleanQueryText) {
    const norm = normalizeArabic(cleanQueryText);
    
    // 1. فحص الكيانات المشهورة أولاً
    let entityMatch = null;
    for (const [key, val] of Object.entries(SMART_ENTITIES)) {
        if (norm === key || norm.includes(key)) {
            entityMatch = val;
            break;
        }
    }

    const queriesToRun = [];

    // عبارة البحث الأصلية
    queriesToRun.push(cleanQueryText);

    // إن وجد تطابق كيان مشهور
    if (entityMatch) {
        queriesToRun.push(entityMatch);
    }

    // ترجمة إلى الإنجليزية للبحث العالمي
    const englishQuery = await translateToEnglish(cleanQueryText);
    if (englishQuery && englishQuery.toLowerCase() !== cleanQueryText.toLowerCase()) {
        queriesToRun.push(englishQuery);
        if (/wallpaper|car|anime|nature|cat|dog|galaxy|city/i.test(englishQuery)) {
            queriesToRun.push(`${englishQuery} 4k hd`);
        }
    }

    // تجميع الروابط من كل المحركات بالتوازي
    const urlSet = new Set();
    for (const q of queriesToRun) {
        const [bingUrls, ddgUrls, googleUrls, unsplashUrls] = await Promise.all([
            searchBingImages(q),
            searchDuckDuckGoImages(q),
            searchGoogleImages(q),
            searchUnsplashImages(q)
        ]);

        for (const u of [...bingUrls, ...ddgUrls, ...googleUrls, ...unsplashUrls]) {
            if (u && !urlSet.has(u)) urlSet.add(u);
        }

        if (urlSet.size >= 25) break;
    }

    return Array.from(urlSet);
}

/**
 * توليد صورة بالذكاء الاصطناعي عبر Pollinations AI مع ترجمة فورية وبديل رقمي
 */
async function generateAiImage(rawPrompt) {
    const englishPrompt = await translateToEnglish(rawPrompt);
    console.log(`🎨 [AI Image Engine] الأصل: "${rawPrompt}" -> الإنجليزية: "${englishPrompt}"`);

    const visualEnhancers = 'highly detailed, photorealistic, cinematic lighting, masterpiece, 8k resolution, sharp focus';
    const enhancedPrompt = `${englishPrompt}, ${visualEnhancers}`;

    // 1. المحاولة الأساسية عبر سيرفرات الرسم المجاني بالوصف المعزز
    try {
        const seed = Math.floor(Math.random() * 1000000);
        const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?seed=${seed}`;
        const res = await axios.get(pUrl, {
            responseType: 'arraybuffer',
            timeout: 25000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (res.status === 200 && res.data) {
            const buf = Buffer.from(res.data);
            if (isValidImage(buf)) return buf;
        }
    } catch (e) {
        console.log('⚠️ [Primary AI Engine Error]:', e?.message || e);
    }

    // 2. محاولة احتياطية بالوصف الإنجليزي الخام
    try {
        const seed = Math.floor(Math.random() * 1000000);
        const pUrlRaw = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?seed=${seed}`;
        const resRaw = await axios.get(pUrlRaw, {
            responseType: 'arraybuffer',
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (resRaw.status === 200 && resRaw.data) {
            const buf = Buffer.from(resRaw.data);
            if (isValidImage(buf)) return buf;
        }
    } catch (_) {}

    return null;
}

/**
 * وضع علامة مائية (Watermark) باسم البوت في الزاوية السفلية اليمنى عبر FFmpeg
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
            try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
            try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
            resolve(imgBuffer);
        }
    });
}

/**
 * معالج أمر الصور الموحد (صوره / صورة / صور)
 */
export async function handleImageCommand(mek, currentConn, rawBody) {
    try {
        const body = (rawBody || '').trim();
        const normalized = normalizeArabic(body.toLowerCase());

        // التحقق من أن الرسالة تبدأ بأمر صوره / صورة / صور
        const isImageCmd = /^(\.|\/)?(صوره|صورة|صور|img|image|pic)(\s|$)/i.test(normalized);
        if (!isImageCmd) return false;

        const from = mek.key?.remoteJid || mek.chat;
        if (!from) return false;

        const sender = mek.key?.participant || from;
        const userNumber = sender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

        const botName = mek.botName || currentConn.botName || 'شادو بوت';

        // تنظيف نص البحث
        let query = cleanImageQuery(body);

        // إذا كتب المستخدم الأمر بدون نص، عرض الدليل الإرشادي
        if (!query) {
            const guideText = 
                `📸 *طريقة طلب الصور من البوت:* 🖼️\n\n` +
                `1️⃣ *بحث فوري عن أي صورة:* \n` +
                `• اكتب: *صوره [اسم الشخص أو الحاجة]*\n` +
                `مثال: *صوره كريستيانو رونالدو* | *صوره خلفيات انمي 4k*\n` +
                `مثال: *صوره سيارة مرسيدس سوداء* | *صوره عادل امام*\n\n` +
                `2️⃣ *توليد صورة بالذكاء الاصطناعي (AI):* \n` +
                `• اكتب: *صوره ai [وصف الصورة اللي في خيالك]*\n` +
                `مثال: *صوره ai قطة في الفضاء بتلبس نظارة شمس*\n` +
                `مثال: *صوره تخيل قلعة عائمة في السحاب وسط الغروب*\n\n` +
                `⚡ البوت يبحث في جوجل وبينج وبأعلى دقة مع توقيع البوت الرسمي! 👑`;

            await delay(1000);
            await currentConn.sendMessage(from, { text: guideText }, { quoted: mek });
            return true;
        }

        // فحص هل الطلب ذكاء اصطناعي (AI)
        const isAi = /^(ai|اي|ذكاء|تخيل|ارسم|رسم)\b/i.test(query) || 
                     /\b(ai|ذكاء اصطناعي|بالذكاء الاصطناعي)\b/i.test(query);

        if (isAi) {
            let cleanPrompt = query
                .replace(/^(ai|اي|ذكاء اصطناعي|بالذكاء الاصطناعي|تخيل|ارسم|رسم)\s*/i, '')
                .replace(/\b(ai|ذكاء اصطناعي|بالذكاء الاصطناعي)\b/gi, '')
                .trim();

            if (!cleanPrompt) cleanPrompt = query;

            await delay(600);
            try { await currentConn.sendMessage(from, { react: { text: '🎨', key: mek.key } }); } catch (_) {}

            const aiBuffer = await generateAiImage(cleanPrompt);
            if (!aiBuffer || !isValidImage(aiBuffer)) {
                await currentConn.sendMessage(from, { 
                    text: `❌ عذراً! تعذر توليد الصورة بالذكاء الاصطناعي حالياً، برجاء المحاولة لاحقاً.` 
                }, { quoted: mek });
                return true;
            }

            const finalImage = await applyWatermark(aiBuffer, true);
            const imageToSend = isValidImage(finalImage) ? finalImage : aiBuffer;

            const caption = 
                `🎨 *صورة بالذكاء الاصطناعي:* « ${cleanPrompt} »\n` +
                `✨ *الدقة:* HD\n` +
                `👤 *طلب:* @${userNumber}\n` +
                `👑 *تم الرسم بواسطة:* ${botName}`;

            await delay(1000);
            await currentConn.sendMessage(from, { 
                image: imageToSend,
                caption: caption,
                mentions: [sender]
            }, { quoted: mek });

            // تحرير الذاكرة
            if (typeof global.gc === 'function') {
                try { global.gc(); } catch (_) {}
            }
            return true;
        }

        // بحث عن صورة عادية عبر محرك البحث الذكي متعدد المصادر
        await delay(600);
        try { await currentConn.sendMessage(from, { react: { text: '🔍', key: mek.key } }); } catch (_) {}

        const urls = await smartSearchImages(query);

        let downloadedBuffer = null;

        if (urls && urls.length > 0) {
            // اختيار عشوائي من بين أفضل النتائج لضمان التنوع عند تكرار البحث
            const topPool = urls.slice(0, Math.min(10, urls.length));
            for (let i = topPool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [topPool[i], topPool[j]] = [topPool[j], topPool[i]];
            }

            for (const u of topPool) {
                downloadedBuffer = await downloadImageBuffer(u);
                if (downloadedBuffer && isValidImage(downloadedBuffer)) break;
            }
        }

        // إذا تعذر العثور على صورة من الويب، نولدها له بالذكاء الاصطناعي كبديل ذكي تلقائي
        if (!downloadedBuffer || !isValidImage(downloadedBuffer)) {
            console.log(`💡 [Image Fallback] لم يتم العثور على صورة ويب صالحة لـ "${query}"، جاري التوليد بالذكاء الاصطناعي...`);
            downloadedBuffer = await generateAiImage(query);
        }

        if (!downloadedBuffer || !isValidImage(downloadedBuffer)) {
            await currentConn.sendMessage(from, { 
                text: `❌ تعذر العثور على صورة لـ « ${query} » حالياً.. يرجى تجربة كلمات بحث أخرى أو وصف أدق.` 
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

        await delay(1000);
        await currentConn.sendMessage(from, { 
            image: imageToSend,
            caption: caption,
            mentions: [sender]
        }, { quoted: mek });

        // تحرير الذاكرة وتفريغ الرام
        if (typeof global.gc === 'function') {
            try { global.gc(); } catch (_) {}
        }

        return true;

    } catch (err) {
        console.error('⚠️ [Error in handleImageCommand]:', err);
        return false;
    }
}

export default handleImageCommand;
