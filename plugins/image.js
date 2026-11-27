// plugins/image.js
import axios from 'axios';

// ⏱️ دالة تأخير بسيطة
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * فحص وتأكيد صحة بافر الصورة من الهيدر الثنائي (JPEG / PNG / WebP)
 * يمنع نهائياً إرسال أي ملفات تالفة أو نصوص أخطاء HTML إلى واتساب
 */
function isValidImage(buf) {
    if (!buf || !Buffer.isBuffer(buf) || buf.length < 2500) return false;
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
 * فحص صارم لكشف أي محتوى إباحي، جنسي، أو غير لائق (عربي وإنجليزي)
 */
function isExplicitContent(text) {
    if (!text) return false;
    const clean = normalizeArabic(text);
    const compact = clean.replace(/\s+/g, ''); // لكشف الكلمات المفصولة بحروف مثل: س ك س

    // 1. كلمات إباحية وصريحة جداً (عربي ومصري) + منع طلب صور البنات والنساء
    const arabicPatterns = [
        /(?:^|\s)(?:سكس|بورن|بورنو|اباحي|اباحيه|سكسي|نيك|ينيك|منيوك|تنايك|شرموط|شرموطه|شرموطة|قحب|قحبه|قحبة)(?:\s|$)/i,
        /(?:^|\s)(?:طيز|كس|بزاز|بزازها|طياز|فخاذ|صدر\s*عاري|مؤخرة\s*عارية|مؤخره\s*عاريه|عريان|عريانه|عريانة|عاري|عارية|عاريه|ملط|مفصخ|مفصخه|مفصخة)(?:\s|$)/i,
        /(?:^|\s)(?:شيميل|خنيث|لواط|سحاق|سحاقيات|مثليين|اوضاع\s*جنسيه|اوضاع\s*جنسية|افلام\s*سكس|مقاطع\s*سكس|فيديو\s*سكس|صور\s*سكس)(?:\s|$)/i,
        /(?:^|\s)(?:بدون\s*ملابس|بلا\s*ملابس|خلع\s*ملابس|تعري|استمناء|نيكني|مص\s*قضيب)(?:\s|$)/i,
        /(?:^|\s)(?:بنات|بنت|نسوان|حريم|ستات|مزه|مزز|مزّة|فتاة|فتيات|صبايا|صدايا|نسوانجي|بنات\s*حلوه|بنات\s*حلوة|بنت\s*حلوه|بنت\s*حلوة|بنات\s*مصر|بنات\s*تيك\s*توك|موديل\s*بنات|صور\s*بنات|صورة\s*بنت|صوره\s*بنت|بنت\s*جميله|بنت\s*جميلة|بنات\s*جميلات|نساء|نسائيه|نسائية)(?:\s|$)/i
    ];

    for (const pat of arabicPatterns) {
        if (pat.test(clean)) return true;
    }

    // فحص النص المضغوط بدون مسافات للكلمات الإباحية المباشرة (مثل س ك س أو ب و ر ن)
    if (/(?:سكس|بورن|اباحي|شرموط|شيميل|عريان|منيوك)/.test(compact)) {
        return true;
    }

    // 2. كلمات إباحية وصور نساء بالإنجليزية (English NSFW / Girls / Explicit)
    const lower = text.toLowerCase();
    const englishPatterns = [
        /\b(?:porn|porno|pornography|xxx|nude|nudes|naked|nudity|nsfw|sex|sexy|erotic)\b/i,
        /\b(?:boobs|tits|pussy|vagina|penis|dick|cock|blowjob|deepthroat|dildo|anal)\b/i,
        /\b(?:hentai|milf|shemale|escort|onlyfans|stripper|rule34|cum|masturbat\w*)\b/i,
        /\b(?:topless|bottomless|undressed|naked girl|naked woman|nude photo|bikini|lingerie|cleavage|babes?)\b/i,
        /\b(?:girls?|hot\s*girls?|pretty\s*girls?|sexy\s*girls?|cute\s*girls?|wom[ae]n|female\s*photo|girl\s*photo|women\s*photo|lady|ladies)\b/i
    ];

    for (const pat of englishPatterns) {
        if (pat.test(lower)) return true;
    }

    return false;
}

/**
 * تنظيف العبارة واستخراج الكلمات المفتاحية الحقيقية والصافية للبحث
 */
function cleanImageQuery(rawText) {
    if (!rawText) return '';
    let q = rawText.trim();

    // إزالة أمر البوت في البداية (.صوره / صوره / صورة / صور / pic / img / image)
    q = q.replace(/^(\.|\/)?(صوره|صورة|صور|img|image|pic)\s*/i, '');

    // إزالة صيغ الطلب العامية
    q = q.replace(/^(عايز|عاوز|عاوزين|ابعتلي|ابعت|هات|ممكن|وريني|نزل|طلعلي|جيب|اعملي)\s+(صوره|صورة|صور|خلفيه|خلفية)?\s*/i, '');

    // إزالة أحرف الجر الزائدة في البداية
    q = q.replace(/^(لـ|عن|ل)\s+/i, '');

    // إزالة كلمات المجاملة أو النداء في النهاية
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
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (Array.isArray(res.data) && res.data[0] && res.data[0][0]) {
            return String(res.data[0][0]).trim();
        }
    } catch (_) {}

    // المحاولة 2: سيرفر Google Translate المفتوح
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url, { timeout: 4000 });
        if (Array.isArray(res.data) && res.data[0] && res.data[0][0] && res.data[0][0][0]) {
            return String(res.data[0][0][0]).trim();
        }
    } catch (_) {}

    return text;
}

/**
 * محرك 1: البحث عبر Bing Images واستخراج الروابط بالترتيب الدقيق للأعلى تطابقاً
 */
async function searchBingImages(query) {
    try {
        const bUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&FORM=HDRSC2&first=1`;
        const res = await axios.get(bUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
                'Cookie': 'SRCHHPGUSR=ADLT=STRICT; _EDGE_S=F=1'
            },
            timeout: 6000
        });

        const regex = /murl&quot;:&quot;(https?:\/\/[^&]+)&quot;/g;
        const urls = [];
        let match;
        while ((match = regex.exec(res.data)) !== null) {
            const u = match[1];
            if (u && !u.includes('.svg') && !u.includes('.ico')) {
                urls.push(u);
            }
        }
        return urls;
    } catch (_) {
        return [];
    }
}

/**
 * محرك 2: البحث عبر Yahoo Images (قوي جداً على مستوى العالم ولا يحظر السيرفرات إطلاقاً)
 */
async function searchYahooImages(query) {
    try {
        const yUrl = `https://images.search.yahoo.com/search/images?p=${encodeURIComponent(query)}&vm=r`;
        const res = await axios.get(yUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
            },
            timeout: 6000
        });

        const urls = [];
        const imgUrlRegex = /imgurl=(https?%3A%2F%2F[^&]+)/gi;
        let m;
        while ((m = imgUrlRegex.exec(res.data)) !== null) {
            try {
                const decoded = decodeURIComponent(m[1]);
                if (decoded && !decoded.includes('.svg') && !decoded.includes('.ico')) {
                    urls.push(decoded);
                }
            } catch (_) {}
        }

        const iurlRegex = /&quot;iurl&quot;:&quot;(https?:\/\/[^&"]+)&quot;/gi;
        let m2;
        while ((m2 = iurlRegex.exec(res.data)) !== null) {
            const u = m2[1];
            if (u && !u.includes('.svg') && !u.includes('.ico')) {
                urls.push(u);
            }
        }

        return urls;
    } catch (_) {
        return [];
    }
}

/**
 * محرك 3: البحث عبر DuckDuckGo Images كبديل فوري في حال غياب النتائج
 */
async function searchDuckDuckGoImages(query) {
    try {
        const tokenRes = await axios.get(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
            },
            timeout: 5000
        });
        const vqdMatch = tokenRes.data.match(/vqd=["']?([^"'&]+)/i);
        if (!vqdMatch) return [];
        const vqd = vqdMatch[1];

        const imgRes = await axios.get(`https://duckduckgo.com/i.js?l=wt-wt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,1,`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://duckduckgo.com/'
            },
            timeout: 5000
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
 * محرك 4: البحث عبر Google Images Scraping مع تجاوز صفحة الشروط والموافقة
 */
async function searchGoogleImages(query) {
    try {
        const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&safe=active&hl=ar&gl=eg`;
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
                'Cookie': 'CONSENT=YES+cb.20210720-07-p0.en+FX+410; SOCS=CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiA_LymBg'
            },
            timeout: 5000
        });

        const urls = [];
        // صور بالحجم الكامل من JSON الخاص بجوجل
        const regex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))",\s*(\d+),\s*(\d+)\]/g;
        let match;
        while ((match = regex.exec(res.data)) !== null) {
            const imgUrl = match[1];
            const w = parseInt(match[2], 10);
            const h = parseInt(match[3], 10);
            if (w > 200 && h > 200 && !imgUrl.includes('gstatic.com') && !imgUrl.includes('google.com')) {
                urls.push(imgUrl);
            }
        }

        // في حال عدم العثور، روابط معاينة gstatic الفورية التي تفتح دائماً
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
 * محرك 5: البحث عبر Yandex Images (أكبر محرك صور عالمي للشخصيات والأفلام والأنمي)
 */
async function searchYandexImages(query) {
    try {
        const url = `https://yandex.com/images/search?text=${encodeURIComponent(query)}&family=yes`;
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'ar,en;q=0.8'
            },
            timeout: 5000
        });

        const urls = [];
        const regex = /img_url=([^&"]+)/gi;
        let m;
        while ((m = regex.exec(res.data)) !== null) {
            try {
                const dec = decodeURIComponent(m[1]);
                if (dec && dec.startsWith('http') && !dec.includes('.svg')) {
                    urls.push(dec);
                }
            } catch (_) {}
        }
        return urls;
    } catch (_) {
        return [];
    }
}

/**
 * محرك 6: البحث عبر Wikimedia Commons العالمي (معالم، دول، أعلام، شخصيات تاريخية ومشاهير)
 */
async function searchWikimediaImages(query) {
    try {
        const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=10&prop=imageinfo&iiprop=url&format=json`;
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShadowBot/1.0)' },
            timeout: 4000
        });
        const pages = res.data?.query?.pages;
        if (pages) {
            const list = [];
            for (const p of Object.values(pages)) {
                const u = p.imageinfo?.[0]?.url;
                if (u && !u.endsWith('.svg') && !u.endsWith('.ogg')) list.push(u);
            }
            return list;
        }
    } catch (_) {}
    return [];
}

/**
 * تحميل بافر الصورة والتحقق من صحتها - مع تحديد سقف 3MB لحماية الذاكرة وتوفير الرام
 */
async function downloadImageBuffer(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 7000,
            maxContentLength: 3 * 1024 * 1024, // 3MB كحد أقصى لحماية الرام تماماً
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            }
        });

        if (res.status === 200 && res.data) {
            const buf = Buffer.from(res.data);
            if (isValidImage(buf) && buf.length > 2500) return buf;
        }
    } catch (_) {}
    return null;
}

/**
 * جلب روابط الصور بأعلى دقة عالمية وتطابق تام عبر كافة المحركات العالمية بالتتابع
 */
async function fetchWorldwideImageUrls(cleanQuery) {
    const englishQuery = await translateToEnglish(cleanQuery);
    const hasEnglish = englishQuery && englishQuery.toLowerCase() !== cleanQuery.toLowerCase();

    // قائمة الكلمات للبحث: العربية الأصلية، ثم الإنجليزية العالمية إن اختلفت
    const queryList = [cleanQuery];
    if (hasEnglish) queryList.push(englishQuery);

    for (const q of queryList) {
        // الخطوة 1: البحث عبر Bing و Yahoo بالتوازي (الأعلى دقة وسرعة وجودة)
        const [bingUrls, yahooUrls] = await Promise.all([
            searchBingImages(q),
            searchYahooImages(q)
        ]);
        const firstPool = [...bingUrls, ...yahooUrls];
        if (firstPool.length > 0) return firstPool;

        // الخطوة 2: البحث عبر DuckDuckGo و Google بالتوازي
        const [ddgUrls, googleUrls] = await Promise.all([
            searchDuckDuckGoImages(q),
            searchGoogleImages(q)
        ]);
        const secondPool = [...ddgUrls, ...googleUrls];
        if (secondPool.length > 0) return secondPool;

        // الخطوة 3: المحاولة الأخيرة العالمية عبر Yandex و Wikimedia
        const [yandexUrls, wikiUrls] = await Promise.all([
            searchYandexImages(q),
            searchWikimediaImages(q)
        ]);
        const thirdPool = [...yandexUrls, ...wikiUrls];
        if (thirdPool.length > 0) return thirdPool;
    }

    return [];
}

/**
 * توليد صورة بالذكاء الاصطناعي عبر Pollinations AI
 */
async function generateAiImage(rawPrompt) {
    if (isExplicitContent(rawPrompt)) {
        console.log(`🛡️ [AI Image Engine] تم حظر الطلب لمخالفته سياسة الأمان: "${rawPrompt}"`);
        return null;
    }

    const englishPrompt = await translateToEnglish(rawPrompt);
    if (isExplicitContent(englishPrompt)) {
        console.log(`🛡️ [AI Image Engine] تم حظر الطلب المترجم لمخالفته سياسة الأمان: "${englishPrompt}"`);
        return null;
    }
    console.log(`🎨 [AI Image Engine] الأصل: "${rawPrompt}" -> الإنجليزية: "${englishPrompt}"`);

    const visualEnhancers = 'highly detailed, photorealistic, cinematic lighting, masterpiece, 8k resolution, sharp focus';
    const enhancedPrompt = `${englishPrompt}, ${visualEnhancers}`;

    try {
        const seed = Math.floor(Math.random() * 1000000);
        const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?seed=${seed}`;
        const res = await axios.get(pUrl, {
            responseType: 'arraybuffer',
            timeout: 20000,
            maxContentLength: 4 * 1024 * 1024,
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

    try {
        const seed = Math.floor(Math.random() * 1000000);
        const pUrlRaw = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?seed=${seed}`;
        const resRaw = await axios.get(pUrlRaw, {
            responseType: 'arraybuffer',
            timeout: 18000,
            maxContentLength: 4 * 1024 * 1024,
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
 * معالج أمر الصور الموحد (صوره / صورة / صور)
 * نظام بحث عالمي فائق التغطية والأمان وخفيف جداً على الرام
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

        // استخراج وتنظيف نص البحث الصافي
        let query = cleanImageQuery(body);

        // 🛡️ فحص أمان صارم لمنع أي محتوى إباحي، جنسي، أو غير لائق
        if (isExplicitContent(query) || isExplicitContent(body)) {
            await delay(600);
            try { await currentConn.sendMessage(from, { react: { text: '🚫', key: mek.key } }); } catch (_) {}
            const safetyMsg = 
                `⚠️ *عذراً يا غالي، لا يمكن تنفيذ هذا الطلب!* 🚫\n\n` +
                `📌 *سياسة الأمان والآداب:* البوت يمنع تماماً البحث عن أو توليد صور البنات أو أي صور مخلة بالآداب أو غير لائقة.\n\n` +
                `👑 *Shadow Bot*`;
            await delay(600);
            await currentConn.sendMessage(from, { text: safetyMsg }, { quoted: mek });
            return true;
        }

        // إذا كتب المستخدم الأمر بدون نص، عرض الدليل الإرشادي
        if (!query) {
            const guideText = 
                `📸 *طريقة طلب الصور من البوت:* 🖼️\n\n` +
                `1️⃣ *بحث فوري عن أي صورة في العالم:* \n` +
                `• اكتب: *صوره [اسم أي شخص أو حاجة في العالم]*\n` +
                `مثال: *صوره كريستيانو رونالدو* | *صوره خلفيات انمي 4k*\n` +
                `مثال: *صوره سيارة مرسيدس سوداء* | *صوره عادل امام*\n\n` +
                `2️⃣ *توليد صورة بالذكاء الاصطناعي (AI):* \n` +
                `• اكتب: *صوره ai [وصف الصورة اللي في خيالك]*\n` +
                `مثال: *صوره ai قطة في الفضاء بتلبس نظارة شمس*\n` +
                `مثال: *صوره تخيل قلعة عائمة في السحاب وسط الغروب*\n\n` +
                `⚡ البوت يبحث عالمياً في بينج، ياهو، جوجل، ياندكس بأعلى دقة وخفة تامة! 👑`;

            await delay(1000);
            await currentConn.sendMessage(from, { text: guideText }, { quoted: mek });
            return true;
        }

        // فحص هل الطلب ذكاء اصطناعي (AI) صريح
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

            let aiBuffer = await generateAiImage(cleanPrompt);
            if (!aiBuffer || !isValidImage(aiBuffer)) {
                await currentConn.sendMessage(from, { 
                    text: `❌ عذراً! تعذر توليد الصورة بالذكاء الاصطناعي حالياً، برجاء المحاولة لاحقاً.` 
                }, { quoted: mek });
                return true;
            }

            const caption = 
                `🎨 *صورة بالذكاء الاصطناعي:* « ${cleanPrompt} »\n` +
                `✨ *الدقة:* HD\n` +
                `👤 *طلب:* @${userNumber}\n` +
                `👑 *تم الرسم بواسطة:* ${botName}`;

            await delay(1000);
            await currentConn.sendMessage(from, { 
                image: aiBuffer,
                caption: caption,
                mentions: [sender]
            }, { quoted: mek });

            aiBuffer = null;
            if (typeof global.gc === 'function') {
                try { global.gc(); } catch (_) {}
            }
            return true;
        }

        // بحث عالمي متعدد المحركات عن صورة مطابقة للطلب
        await delay(600);
        try { await currentConn.sendMessage(from, { react: { text: '🔍', key: mek.key } }); } catch (_) {}

        const urls = await fetchWorldwideImageUrls(query);

        let downloadedBuffer = null;

        if (urls && urls.length > 0) {
            // فحص وتحميل الصور بالترتيب الأصلي لأعلى نتائج تطابقاً
            for (let i = 0; i < Math.min(8, urls.length); i++) {
                downloadedBuffer = await downloadImageBuffer(urls[i]);
                if (downloadedBuffer && isValidImage(downloadedBuffer)) {
                    break;
                }
            }
        }

        // إذا تعذر العثور على صورة ويب، نستدعي الذكاء الاصطناعي فوراً كبديل ذكي لضمان جلب الصورة دائماً
        if (!downloadedBuffer || !isValidImage(downloadedBuffer)) {
            console.log(`💡 [Image Global Fallback] لم تتوفر صورة ويب صالحة لـ "${query}"، جاري التوليد بالذكاء الاصطناعي...`);
            downloadedBuffer = await generateAiImage(query);
        }

        if (!downloadedBuffer || !isValidImage(downloadedBuffer)) {
            await currentConn.sendMessage(from, { 
                text: `❌ تعذر العثور على صورة لـ « ${query} » حالياً.. يرجى التأكد من كتابة الكلمات بشكل صحيح.` 
            }, { quoted: mek });
            return true;
        }

        const caption = 
            `🖼️ *طلبك لصورة:* « ${query} »\n` +
            `👤 *طلب:* @${userNumber}\n` +
            `👑 *بواسطة:* ${botName}`;

        await delay(1000);
        await currentConn.sendMessage(from, { 
            image: downloadedBuffer,
            caption: caption,
            mentions: [sender]
        }, { quoted: mek });

        // تفريغ البافر والذاكرة فوراً لمنع أي تراكم في الرام
        downloadedBuffer = null;
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
