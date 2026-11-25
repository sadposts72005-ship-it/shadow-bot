// ============================================================================
// 🌐 موديل الترجمة الفوري التفاعلي - Shadow Bot
// ============================================================================

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeArabic(text) {
    if (!text) return '';
    return text.trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}

// قائمة اللغات المدعومة والرموز
export const SUPPORTED_LANGS = {
    '1': { code: 'en', name: 'الإنجليزية 🇬🇧' },
    'انجليزي': { code: 'en', name: 'الإنجليزية 🇬🇧' },
    'انجليزيه': { code: 'en', name: 'الإنجليزية 🇬🇧' },
    'انكليزي': { code: 'en', name: 'الإنجليزية 🇬🇧' },
    'english': { code: 'en', name: 'الإنجليزية 🇬🇧' },
    'en': { code: 'en', name: 'الإنجليزية 🇬🇧' },

    '2': { code: 'ar', name: 'العربية 🇸🇦' },
    'عربي': { code: 'ar', name: 'العربية 🇸🇦' },
    'عربيه': { code: 'ar', name: 'العربية 🇸🇦' },
    'arabic': { code: 'ar', name: 'العربية 🇸🇦' },
    'ar': { code: 'ar', name: 'العربية 🇸🇦' },

    '3': { code: 'fr', name: 'الفرنسية 🇫🇷' },
    'فرنسي': { code: 'fr', name: 'الفرنسية 🇫🇷' },
    'فرنسيه': { code: 'fr', name: 'الفرنسية 🇫🇷' },
    'فرنساوي': { code: 'fr', name: 'الفرنسية 🇫🇷' },
    'french': { code: 'fr', name: 'الفرنسية 🇫🇷' },
    'fr': { code: 'fr', name: 'الفرنسية 🇫🇷' },

    '4': { code: 'es', name: 'الإسبانية 🇪🇸' },
    'اسباني': { code: 'es', name: 'الإسبانية 🇪🇸' },
    'اسبانيه': { code: 'es', name: 'الإسبانية 🇪🇸' },
    'spanish': { code: 'es', name: 'الإسبانية 🇪🇸' },
    'es': { code: 'es', name: 'الإسبانية 🇪🇸' },

    '5': { code: 'de', name: 'الألمانية 🇩🇪' },
    'الماني': { code: 'de', name: 'الألمانية 🇩🇪' },
    'المانيه': { code: 'de', name: 'الألمانية 🇩🇪' },
    'german': { code: 'de', name: 'الألمانية 🇩🇪' },
    'de': { code: 'de', name: 'الألمانية 🇩🇪' },

    '6': { code: 'tr', name: 'التركية 🇹🇷' },
    'تركي': { code: 'tr', name: 'التركية 🇹🇷' },
    'تركيه': { code: 'tr', name: 'التركية 🇹🇷' },
    'turkish': { code: 'tr', name: 'التركية 🇹🇷' },
    'tr': { code: 'tr', name: 'التركية 🇹🇷' },

    '7': { code: 'ru', name: 'الروسية 🇷🇺' },
    'روسي': { code: 'ru', name: 'الروسية 🇷🇺' },
    'روسيه': { code: 'ru', name: 'الروسية 🇷🇺' },
    'russian': { code: 'ru', name: 'الروسية 🇷🇺' },
    'ru': { code: 'ru', name: 'الروسية 🇷🇺' },

    '8': { code: 'it', name: 'الإيطالية 🇮🇹' },
    'ايطالي': { code: 'it', name: 'الإيطالية 🇮🇹' },
    'ايطاليه': { code: 'it', name: 'الإيطالية 🇮🇹' },
    'italian': { code: 'it', name: 'الإيطالية 🇮🇹' },
    'it': { code: 'it', name: 'الإيطالية 🇮🇹' },

    '9': { code: 'ja', name: 'اليابانية 🇯🇵' },
    'ياباني': { code: 'ja', name: 'اليابانية 🇯🇵' },
    'يابانيه': { code: 'ja', name: 'اليابانية 🇯🇵' },
    'japanese': { code: 'ja', name: 'اليابانية 🇯🇵' },
    'ja': { code: 'ja', name: 'اليابانية 🇯🇵' },

    '10': { code: 'ko', name: 'الكورية 🇰🇷' },
    'كوري': { code: 'ko', name: 'الكورية 🇰🇷' },
    'كوريه': { code: 'ko', name: 'الكورية 🇰🇷' },
    'korean': { code: 'ko', name: 'الكورية 🇰🇷' },
    'ko': { code: 'ko', name: 'الكورية 🇰🇷' },

    'صيني': { code: 'zh-CN', name: 'الصينية 🇨🇳' },
    'صينيه': { code: 'zh-CN', name: 'الصينية 🇨🇳' },
    'chinese': { code: 'zh-CN', name: 'الصينية 🇨🇳' },
    'zh': { code: 'zh-CN', name: 'الصينية 🇨🇳' },

    'برتغالي': { code: 'pt', name: 'البرتغالية 🇵🇹' },
    'برتغاليه': { code: 'pt', name: 'البرتغالية 🇵🇹' },
    'portuguese': { code: 'pt', name: 'البرتغالية 🇵🇹' },
    'pt': { code: 'pt', name: 'البرتغالية 🇵🇹' },

    'هندي': { code: 'hi', name: 'الهندية 🇮🇳' },
    'هنديه': { code: 'hi', name: 'الهندية 🇮🇳' },
    'hindi': { code: 'hi', name: 'الهندية 🇮🇳' },
    'hi': { code: 'hi', name: 'الهندية 🇮🇳' },

    'فارسي': { code: 'fa', name: 'الفارسية 🇮🇷' },
    'فارسيه': { code: 'fa', name: 'الفارسية 🇮🇷' },
    'persian': { code: 'fa', name: 'الفارسية 🇮🇷' },
    'fa': { code: 'fa', name: 'الفارسية 🇮🇷' },

    'اوردو': { code: 'ur', name: 'الأردية 🇵🇰' },
    'urdu': { code: 'ur', name: 'الأردية 🇵🇰' },
    'ur': { code: 'ur', name: 'الأردية 🇵🇰' }
};

// جلسات الترجمة النشطة للمستخدمين (بالريبلاي)
const translateSessions = new Map();
const translateTimers = new Map();

function clearTranslateSession(userKey) {
    if (translateTimers.has(userKey)) {
        clearTimeout(translateTimers.get(userKey));
        translateTimers.delete(userKey);
    }
    translateSessions.delete(userKey);
}

/**
 * دالة ترجمة النص عبر Google Translate مع أنظمة احتياطية فائقة السرعة
 */
export async function executeTranslation(text, targetLangCode = 'en') {
    if (!text || !text.trim()) return null;

    // 1. تجربة Google Translate مع كروت عملاء متعددة
    const clients = ['dict-chrome-ex', 'gtx'];
    for (const client of clients) {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=auto&tl=${encodeURIComponent(targetLangCode)}&dt=t&q=${encodeURIComponent(text)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data[0])) {
                    const translated = data[0].map(item => item[0]).join('');
                    if (translated && translated.trim()) return translated.trim();
                }
            }
        } catch (_) {}
    }

    // 2. بديل احتياطي: MyMemory API في حال ضغط جوجل
    try {
        const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(targetLangCode)}`;
        const res = await fetch(mmUrl, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
            const data = await res.json();
            if (data?.responseData?.translatedText) {
                return data.responseData.translatedText.trim();
            }
        }
    } catch (_) {}

    return null;
}

/**
 * معالجة أمر الترجمة عند كتابة (ترجمه / ترجمة)
 */
export async function handleTranslateCommand(mek, currentConn, rawBody, cleanSender) {
    const from = mek.key?.remoteJid || mek.chat;
    const body = rawBody || '';
    const norm = normalizeArabic(body);

    // استخراج النص المقتبس من الريبلاي
    const ctx = mek.message?.extendedTextMessage?.contextInfo ||
                mek.message?.imageMessage?.contextInfo ||
                mek.message?.videoMessage?.contextInfo ||
                mek.message?.stickerMessage?.contextInfo;

    const quotedText = ctx?.quotedMessage?.conversation ||
                       ctx?.quotedMessage?.extendedTextMessage?.text ||
                       ctx?.quotedMessage?.imageMessage?.caption ||
                       ctx?.quotedMessage?.videoMessage?.caption || '';

    // إذا لم يعمل ريبلاي على رسالة
    if (!quotedText || !quotedText.trim()) {
        const guideMsg = 
            `🌐 *طريقة استخدام مترجم شادو بوت:* ✨\n\n` +
            `1️⃣ اعمل *ريبلاي (رد)* على أي رسالة عايز تترجمها.\n` +
            `2️⃣ اكتب: *ترجمه* أو *ترجمة*.\n` +
            `3️⃣ هيسألك تختار اللغة، اختار اللغة وهيبعتلك الترجمة فوراً!\n\n` +
            `💡 *تقدر تترجم مباشرة في خطوة واحدة كدة:* ⚡\n` +
            `اعمل ريبلاي واكتب: *ترجمه انجليزي* أو *ترجمة عربي* أو *ترجمه فرنساوي*!`;

        await currentConn.sendMessage(from, { text: guideMsg }, { quoted: mek });
        return true;
    }

    const textToTranslate = quotedText.trim();

    // فحص هل حدد لغة مباشرة مع الأمر (مثال: ترجمه انجليزي / ترجمة فرنسي / ترجمه 1)
    const directLangArg = norm.replace(/^(?:ترجم[هة]|ترجم|translate)\s*/i, '').trim();
    if (directLangArg && SUPPORTED_LANGS[directLangArg]) {
        const langObj = SUPPORTED_LANGS[directLangArg];
        await delay(1000);
        await currentConn.sendMessage(from, { react: { text: '🌐', key: mek.key } }).catch(() => {});
        const result = await executeTranslation(textToTranslate, langObj.code);
        if (result) {
            const replyMsg = 
                `🌐 *[ نتيجة الترجمة إلى: ${langObj.name} ]* ✨\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `📝 *النص الأصلي:*\n` +
                `« ${textToTranslate} »\n\n` +
                `✨ *الترجمة:*\n` +
                `« ${result} »\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🤖 *Shadow Bot*`;
            await currentConn.sendMessage(from, { text: replyMsg }, { quoted: mek });
            await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
        } else {
            await currentConn.sendMessage(from, { text: '❌ تعذر إتمام الترجمة حالياً، حاول مرة ثانية.' }, { quoted: mek });
        }
        return true;
    }

    // إذا كتب (ترجمه) فقط على الريبلاي: نبدأ الجلسة التفاعلية ونعرض اللغات
    clearTranslateSession(cleanSender);

    const askLangMsg = 
        `🌐 *[ مترجم شادو بوت الذكي ]* 🌍\n\n` +
        `📝 *النص المطلوب ترجمته:*\n` +
        `« ${textToTranslate} »\n\n` +
        `👇 *اختر اللغة التي تريد الترجمة إليها بإرسال رقمها أو اسمها:*\n` +
        `1️⃣ ➔ *إنجليزي (English)* 🇬🇧\n` +
        `2️⃣ ➔ *عربي (العربية)* 🇸🇦\n` +
        `3️⃣ ➔ *فرنسي (Français)* 🇫🇷\n` +
        `4️⃣ ➔ *إسباني (Español)* 🇪🇸\n` +
        `5️⃣ ➔ *ألماني (Deutsch)* 🇩🇪\n` +
        `6️⃣ ➔ *تركي (Türkçe)* 🇹🇷\n` +
        `7️⃣ ➔ *روسي (Русский)* 🇷🇺\n` +
        `8️⃣ ➔ *إيطالي (Italiano)* 🇮🇹\n` +
        `9️⃣ ➔ *ياباني (日本語)* 🇯🇵\n` +
        `🔟 ➔ *كوري (한국어)* 🇰🇷\n\n` +
        `💡 _أو اكتب اسم أي لغة أخرى (مثال: صيني / هندي / برتغالي)_\n` +
        `❌ _للإلغاء اكتب: *(الغاء)*_`;

    await currentConn.sendMessage(from, { text: askLangMsg }, { quoted: mek });

    // حفظ الجلسة مع مؤقت دقيقتين
    const timer = setTimeout(() => {
        clearTranslateSession(cleanSender);
    }, 2 * 60 * 1000);

    translateTimers.set(cleanSender, timer);
    translateSessions.set(cleanSender, {
        text: textToTranslate,
        chat: from,
        quotedMek: mek
    });

    return true;
}

/**
 * فحص الرد لاختيار اللغة أثناء جلسة الترجمة النشطة
 */
export async function checkTranslateSession(mek, currentConn, rawBody, cleanSender, from) {
    if (!translateSessions.has(cleanSender)) return false;

    const session = translateSessions.get(cleanSender);
    if (!session || session.chat !== from) return false;

    const norm = normalizeArabic(rawBody.trim());

    // إلغاء الجلسة
    if (['الغاء', 'إلغاء', 'cancel', 'خروج', 'stop'].includes(norm)) {
        clearTranslateSession(cleanSender);
        await currentConn.sendMessage(from, { text: '❌ تم إلغاء عملية الترجمة بنجاح.' }, { quoted: mek });
        return true;
    }

    // فحص اللغة المختارة
    const langObj = SUPPORTED_LANGS[norm];
    if (!langObj) {
        await currentConn.sendMessage(from, { 
            text: `⚠️ *برجاء اختيار لغة صحيحة!* 🌐\nأرسل رقماً من *(1 إلى 10)* أو اسم اللغة (مثال: إنجليزي / فرنسي / تركي)، أو اكتب *(الغاء)*.` 
        }, { quoted: mek });
        return true;
    }

    clearTranslateSession(cleanSender);

    await delay(1000);
    await currentConn.sendMessage(from, { react: { text: '🌐', key: mek.key } }).catch(() => {});

    const result = await executeTranslation(session.text, langObj.code);

    if (result) {
        const replyMsg = 
            `🌐 *[ نتيجة الترجمة إلى: ${langObj.name} ]* ✨\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📝 *النص الأصلي:*\n` +
            `« ${session.text} »\n\n` +
            `✨ *الترجمة:*\n` +
            `« ${result} »\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🤖 *Shadow Bot*`;

        await currentConn.sendMessage(from, { text: replyMsg }, { quoted: mek });
        await currentConn.sendMessage(from, { react: { text: '✅', key: mek.key } }).catch(() => {});
    } else {
        await currentConn.sendMessage(from, { text: '❌ تعذر إتمام الترجمة حالياً، حاول مرة ثانية.' }, { quoted: mek });
    }

    return true;
}

export default {
    handleTranslateCommand,
    checkTranslateSession,
    executeTranslation
};
