// ============================================================================
// ✍️ موديل زخرفة النصوص وخطوط المجال (20 شكلاً مختلفاً) - Shadow Bot
// ============================================================================

/**
 * خريطة زخرفة الحروف العربية بنمط خط المجال الكلاسيكي (تزيين هـ)
 */
function arabicDecorH(str) {
    const map = {
        'ا': 'آ', 'أ': 'آ', 'إ': 'آ', 'آ': 'آ', 'ء': 'ء',
        'ب': 'بہ', 'ت': 'تہ', 'ث': 'ثہ',
        'ج': 'جہ', 'ح': 'حہ', 'خ': 'خہ',
        'د': 'د', 'ذ': 'ذ', 'ر': 'ر', 'ز': 'زه',
        'س': 'سہ', 'ش': 'شہ', 'ص': 'صه', 'ض': 'ضه',
        'ط': 'طه', 'ظ': 'ظه', 'ع': 'عہ', 'غ': 'غه',
        'ف': 'فه', 'ق': 'قه', 'ك': 'كه', 'ل': 'له',
        'م': 'مہ', 'ن': 'نہ', 'ه': 'هه', 'و': 'وو',
        'ي': 'يہ', 'ى': 'ى', 'ة': 'ة'
    };
    return str.split('').map(c => map[c] || c).join('');
}

/**
 * خريطة زخرفة الحروف العربية بنمط أساطير المجال (تزيين النجمة والرموز)
 */
function arabicDecorField(str) {
    const map = {
        'ا': 'آحہۣۗ', 'أ': 'أحہۣۗ', 'إ': 'إحہۣۗ', 'آ': 'آحہۣۗ',
        'ب': 'بہۣۗ', 'ت': 'تہۣۗ', 'ث': 'ثہۣۗ',
        'ج': 'جہۣۗ', 'ح': 'حہۣۗ', 'خ': 'خہۣۗ',
        'د': 'دۣۗ', 'ذ': 'ذۣۗ', 'ر': 'رۣۗ', 'ز': 'زۣۗ',
        'س': 'سہۣۗ', 'ش': 'شہۣۗ', 'ص': 'صهۣۗ', 'ض': 'ضهۣۗ',
        'ط': 'طهۣۗ', 'ظ': 'ظهۣۗ', 'ع': 'عہۣۗ', 'غ': 'غهۣۗ',
        'ف': 'فهۣۗ', 'ق': 'قهۣۗ', 'ك': 'كهۣۗ', 'ل': 'لهۣۗ',
        'م': 'مہۣۗ', 'ن': 'نہۣۗ', 'ه': 'ههۣۗ', 'و': 'وۣۗ',
        'ي': 'يہۣۗ', 'ى': 'ىۣۗ', 'ة': 'ةۣۗ'
    };
    return str.split('').map(c => map[c] || (c + 'ۣۗ')).join('');
}

/**
 * خريطة زخرفة الحروف العربية بنمط الحروف المميزة والفصحى
 */
function arabicDecorUnique(str) {
    const map = {
        'ا': 'ٲ', 'أ': 'ٲ', 'إ': 'إ', 'آ': 'ﺂ',
        'ب': 'ٻ', 'ت': 'ٺ', 'ث': 'ٹ',
        'ج': 'چ', 'ح': 'ﺡ', 'خ': 'ﺥ',
        'د': 'دِ', 'ذ': 'ذِ', 'ر': 'ڒ', 'ز': 'ژ',
        'س': 'ښ', 'ش': 'ڜ', 'ص': 'ڝ', 'ض': 'ڞ',
        'ط': 'ٹ', 'ظ': 'ظ', 'ع': '؏', 'غ': 'ﻍ',
        'ف': 'ڢ', 'ق': 'ڦ', 'ك': 'ګ', 'ل': 'ڵ',
        'م': 'مۘ', 'ن': 'ڹ', 'ه': 'ﮪ', 'و': 'ۈ',
        'ي': 'يۧ', 'ى': 'ێ', 'ة': 'ه'
    };
    return str.split('').map(c => map[c] || c).join('');
}

/**
 * تشكيل عربي أنيق ومحسوب
 */
function arabicDecorTashkeel(str) {
    const marks = ['َ', 'ْ', 'ُ', 'ِ', 'ّ', 'ً', 'ٌ', 'ٍ'];
    return str.split('').map((c, i) => {
        if (/[\s_\-]/.test(c)) return c;
        return c + marks[i % marks.length];
    }).join('');
}

/**
 * مد الحروف بالكشيدة (تطويل)
 */
function decorKashida(str, length = 1) {
    const dash = 'ـ'.repeat(length);
    return str.split('').join(dash);
}

/**
 * تباعد الحروف
 */
function decorSpaced(str) {
    return str.split('').join(' ');
}

/**
 * فواصل نقاط أنيقة
 */
function decorDots(str) {
    return str.split('').join('・');
}

/**
 * خطوط إنجليزية
 */
function toSmallCaps(str) {
    const map = {
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ꜰ',
        'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ',
        'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ',
        's': 's', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x',
        'y': 'ʏ', 'z': 'ᴢ'
    };
    return str.toLowerCase().split('').map(c => map[c] || c).join('');
}

function toBoldSans(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D5D4 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D5EE + (code - 97));
        return c;
    }).join('');
}

function toBoldSerif(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D400 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D41A + (code - 97));
        return c;
    }).join('');
}

function toFraktur(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D56C + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D586 + (code - 97));
        return c;
    }).join('');
}

function toBoldFraktur(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D5A0 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D5BA + (code - 97));
        return c;
    }).join('');
}

function toBoldScript(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D4D0 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D4EA + (code - 97));
        return c;
    }).join('');
}

function toMonospace(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D670 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D68A + (code - 97));
        return c;
    }).join('');
}

function toCircled(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x24B6 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x24D0 + (code - 97));
        return c;
    }).join('');
}

function toDoubleStruck(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D538 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D552 + (code - 97));
        return c;
    }).join('');
}

function toItalic(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D434 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D44E + (code - 97));
        return c;
    }).join('');
}

function toGreekStylized(str) {
    const map = {
        'a': 'α', 'b': 'в', 'c': 'c', 'd': '∂', 'e': 'ε', 'f': 'ғ',
        'g': 'g', 'h': 'н', 'i': 'ι', 'j': 'נ', 'k': 'к', 'l': 'ℓ',
        'm': 'м', 'n': 'η', 'o': 'σ', 'p': 'ρ', 'q': 'q', 'r': 'я',
        's': 's', 't': 'т', 'u': 'υ', 'v': 'v', 'w': 'ω', 'x': 'x',
        'y': 'ү', 'z': 'z'
    };
    return str.toLowerCase().split('').map(c => map[c] || c).join('');
}

function toSuperscript(str) {
    const map = {
        'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ',
        'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ',
        'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ',
        't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
        'A': 'ᴬ', 'B': 'ᴮ', 'D': 'ᴰ', 'E': 'ᴱ', 'G': 'ᴳ', 'H': 'ᴴ',
        'I': 'ᴵ', 'J': 'ᶻ', 'K': 'ᴷ', 'L': 'ᴸ', 'M': 'ᴹ', 'N': 'ᴺ',
        'O': 'ᴼ', 'P': 'ᴾ', 'R': 'ᴿ', 'T': 'ᵀ', 'U': 'ᵁ', 'W': 'ᵂ'
    };
    return str.split('').map(c => map[c] || c).join('');
}

function toSquared(str) {
    return str.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1F130 + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1F130 + (code - 97));
        return c;
    }).join('');
}

/**
 * توليد 20 شكلاً زخرفياً احترافياً متقناً
 */
export function generate20Fonts(inputName) {
    const raw = (inputName || '').trim();
    if (!raw) return [];

    const isEng = /^[a-zA-Z0-9\s_\-.,!?]+$/.test(raw);

    // تجهيز التحويلات المختلفة للنص
    const hStyle = isEng ? toBoldSans(raw) : arabicDecorH(raw);
    const fieldStyle = isEng ? toBoldFraktur(raw) : arabicDecorField(raw);
    const uniqueStyle = isEng ? toSmallCaps(raw) : arabicDecorUnique(raw);
    const tashkeelStyle = isEng ? toBoldScript(raw) : arabicDecorTashkeel(raw);
    const kashidaStyle = isEng ? toMonospace(raw) : decorKashida(raw, 1);
    const kashidaLongStyle = isEng ? toCircled(raw) : decorKashida(raw, 2);
    const spacedStyle = decorSpaced(raw);
    const dotsStyle = decorDots(raw);

    // بدائل إضافية للإنجليزي
    const engSmallCaps = isEng ? toSmallCaps(raw) : null;
    const engFraktur = isEng ? toFraktur(raw) : null;
    const engItalic = isEng ? toItalic(raw) : null;
    const engGreek = isEng ? toGreekStylized(raw) : null;
    const engSuper = isEng ? toSuperscript(raw) : null;
    const engSquared = isEng ? toSquared(raw) : null;
    const engDouble = isEng ? toDoubleStruck(raw) : null;
    const engSerif = isEng ? toBoldSerif(raw) : null;

    return [
        `👑 亗 『 ${hStyle} 』 亗 👑`,
        `꧁༺ ☬ ${tashkeelStyle} ☬ ༻꧂`,
        `彡 𖤍 ${fieldStyle} 𖤍 彡`,
        `⚔️ ⫷ ${uniqueStyle} ⫸ ⚔️`,
        `々 么 ${isEng ? engFraktur : hStyle} 么 々`,
        `✦•┈๑ ${isEng ? engSmallCaps : tashkeelStyle} ๑┈•✦`,
        `⚡ 𖠂 ${dotsStyle} 𖠂 ⚡`,
        `☠️ 〖 ${isEng ? engDouble : kashidaStyle} 〗 ☠️`,
        `🦁 王 ${isEng ? engGreek : fieldStyle} 王 🦁`,
        `〆 ☬ ${isEng ? engSerif : hStyle} ☬ 〆`,
        `★彡 『 ${spacedStyle} 』 彡★`,
        `⚜️ ◈ ${isEng ? engItalic : kashidaLongStyle} ◈ ⚜️`,
        `💠 ⦅ ${isEng ? toBoldSans(spacedStyle) : hStyle} ⦆ 💠`,
        `🤍 ❀ ${isEng ? toBoldScript(raw) : tashkeelStyle} ❀ 🤍`,
        `🖤 亗 ${isEng ? toBoldFraktur(spacedStyle) : uniqueStyle} 亗 🖤`,
        `«« ☬ ${isEng ? engSuper : fieldStyle} ☬ »»`,
        `✧ ─ 𖤍 ${isEng ? dotsStyle : hStyle} 𖤍 ─ ✧`,
        `•| 𖠂 ${isEng ? engSquared : kashidaStyle} 𖠂 |•`,
        `🔥 〖 亗 ${isEng ? toBoldSans(raw) : tashkeelStyle} 亗 〗 🔥`,
        `👑 ꧁ ${isEng ? engSmallCaps : hStyle} ꧂ 👑`
    ];
}

/**
 * معالج الأمر المباشر (خط)
 */
export async function handleFontsCommand(mek, currentConn, query) {
    const from = mek.key.remoteJid;
    const targetName = (query || '').trim();

    if (!targetName) {
        const helpText = 
            `✍️ *أمر الزخرفة وخطوط المجال (20 شكلاً فخماً):* ✨\n\n` +
            `يرجى كتابة الاسم الذي تريد زخرفته بعد الأمر مباشرة!\n\n` +
            `💡 *أمثلة للاستخدام:*\n` +
            `• *خط احمد*\n` +
            `• *خط شادو*\n` +
            `• *خط Shadow*\n` +
            `• *خط سيلفر*\n\n` +
            `👑 _سيقوم البوت بتوليد 20 شكلاً فخماً بخطوط وزخارف المجال لتختار منها ما يناسبك!_`;

        await currentConn.sendMessage(from, { text: helpText }, { quoted: mek });
        return;
    }

    const fonts = generate20Fonts(targetName);

    const arabicNumbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', 
                           '1️⃣1️⃣', '1️⃣2️⃣', '1️⃣3️⃣', '1️⃣4️⃣', '1️⃣5️⃣', '1️⃣6️⃣', '1️⃣7️⃣', '1️⃣8️⃣', '1️⃣9️⃣', '2️⃣0️⃣'];

    let responseText = 
        `✍️ *[ زخرفة وخطوط المجال لاسم: « ${targetName} » ]* ✨\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n`;

    fonts.forEach((font, idx) => {
        const num = arabicNumbers[idx] || `${idx + 1}️⃣`;
        responseText += `${num}  ${font}\n`;
    });

    responseText += 
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 _انسخ الشكل الذي يعجبك واستخدمه كاسم لبروفايلك أو في بايو حسابك!_ 🌟\n` +
        `👑 *Shadow Bot - بابا المجال*`;

    await currentConn.sendMessage(from, { text: responseText }, { quoted: mek });
}

export default {
    generate20Fonts,
    handleFontsCommand
};
