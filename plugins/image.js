// plugins/image.js
import axios from 'axios';
import sharp from 'sharp';

// ⏱️ دالة تأخير بسيطة
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

        // تصفية وتجهيز الروابط الصالحة
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
 * تحميل بافر الصورة من الرابط مع محاولات متعددة
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

        if (res.status === 200 && res.data && res.data.length > 3000) {
            return Buffer.from(res.data);
        }
    } catch (_) {}
    return null;
}

/**
 * توليد صورة بالذكاء الاصطناعي عبر Pollinations AI
 */
async function generateAiImage(prompt) {
    try {
        const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
        const res = await axios.get(pUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (res.status === 200 && res.data && res.data.length > 5000) {
            return Buffer.from(res.data);
        }
    } catch (e) {
        console.error('⚠️ [Pollinations AI Error]:', e?.message || e);
    }
    return null;
}

/**
 * وضع علامة مائية (Watermark) باسم البوت في الزاوية السفلية اليمنى
 */
async function applyWatermark(imgBuffer, botName = 'شادو بوت', isAi = false) {
    try {
        const meta = await sharp(imgBuffer).metadata();
        const width = meta.width || 800;
        const height = meta.height || 800;

        // حساب أبعاد البادج ديناميكياً بناءً على حجم الصورة
        const minDim = Math.min(width, height);
        const badgeW = Math.round(Math.min(Math.max(minDim * 0.28, 150), 320));
        const badgeH = Math.round(badgeW * 0.22);
        const fontSize = Math.round(badgeH * 0.44);
        const textY = Math.round(badgeH * 0.65);
        const rx = Math.round(badgeH * 0.25);
        const margin = Math.round(Math.max(minDim * 0.02, 12));

        const icon = isAi ? '🎨' : '👑';
        const tag = isAi ? `${botName} • AI` : botName;
        const strokeColor = isAi ? 'rgba(255, 215, 0, 0.5)' : 'rgba(255, 255, 255, 0.35)';

        const svgBadge = Buffer.from(`
            <svg width="${badgeW}" height="${badgeH}" xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="${badgeW}" height="${badgeH}" rx="${rx}" ry="${rx}" fill="rgba(8, 10, 16, 0.8)" stroke="${strokeColor}" stroke-width="1.5" />
                <text x="${badgeW / 2}" y="${textY}" font-size="${fontSize}" font-family="Arial, Segoe UI, Tahoma, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">${icon} ${tag}</text>
            </svg>
        `);

        const top = Math.max(0, height - badgeH - margin);
        const left = Math.max(0, width - badgeW - margin);

        const composited = await sharp(imgBuffer)
            .composite([{
                input: svgBadge,
                top: top,
                left: left
            }])
            .jpeg({ quality: 92 })
            .toBuffer();

        return composited;
    } catch (err) {
        console.error('⚠️ [Watermark Error, returning original]:', err?.message || err);
        return imgBuffer;
    }
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
            if (!aiBuffer) {
                await currentConn.sendMessage(from, { 
                    text: `❌ عذراً! تعذر توليد الصورة بالذكاء الاصطناعي حالياً، برجاء المحاولة لاحقاً.` 
                }, { quoted: mek });
                return true;
            }

            // تطبيق توقيع وعلامة البوت المائية في الأسفل يمين
            const finalImage = await applyWatermark(aiBuffer, botName, true);

            const caption = 
                `🎨 *صورة بالذكاء الاصطناعي:* « ${cleanPrompt} »\n` +
                `✨ *الدقة:* 1024x1024 Ultra HD\n` +
                `👤 *طلب:* @${userNumber}\n` +
                `👑 *تم الرسم بواسطة:* ${botName}`;

            await delay(1200);
            await currentConn.sendMessage(from, { 
                image: finalImage,
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
        // خلط النتائج
        for (let i = topPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [topPool[i], topPool[j]] = [topPool[j], topPool[i]];
        }

        let downloadedBuffer = null;
        for (const u of topPool) {
            downloadedBuffer = await downloadImageBuffer(u);
            if (downloadedBuffer) break;
        }

        if (!downloadedBuffer) {
            await currentConn.sendMessage(from, { 
                text: `❌ تعذر تحميل صورة صالحة لـ « ${query} ».. يرجى المحاولة بكلمات بحث أخرى.` 
            }, { quoted: mek });
            return true;
        }

        // تطبيق توقيع وعلامة البوت المائية في الأسفل يمين
        const finalImage = await applyWatermark(downloadedBuffer, botName, false);

        const caption = 
            `🖼️ *طلبك لصورة:* « ${query} »\n` +
            `👤 *طلب:* @${userNumber}\n` +
            `👑 *بواسطة:* ${botName}`;

        await delay(1200);
        await currentConn.sendMessage(from, { 
            image: finalImage,
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
