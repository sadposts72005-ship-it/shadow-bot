import { modifyUserPoints, getUserPoints, getCleanNumber, cleanUserJid } from '../core/points.js';

if (!global.bakasa) global.bakasa = {};

// 📦 قاعدة بيانات الكلمات (500 كلمة مقسمة على 10 أقسام)
const categories = {
    "1": { name: "ملابس وإكسسوارات", keywords: ["ملابس", "اكسسوارات", "إكسسوارات", "لبس", "هدوم"], words: ["قميص", "بنطلون", "فستان", "جاكيت", "تيشيرت", "جوارب", "حذاء", "قبعة", "وشاح", "قفازات", "حزام", "ربطة عنق", "تنورة", "عباءة", "بدلة", "معطف", "نظارة", "ساعة", "خاتم", "سوار", "قرط", "قلادة", "محفظة", "حقيبة", "مظلة", "بيجامة", "شورت", "بلوفر", "صندل", "شبشب", "كاب", "طرحة", "خمار", "بشت", "عقال", "شماغ", "كوفية", "بروش", "كبك", "مشبك", "سلسلة", "خلخال", "تاج", "محبس", "مناديل", "قميص نوم", "ملابس رياضية", "جاكيت جلد", "سترة", "بذلة رسمية"] },
    "2": { name: "سيارات ووسائل نقل", keywords: ["سيارات", "عربيات", "نقل", "مواصلات", "مركبات"], words: ["سيارة", "طيارة", "قطار", "سفينة", "دراجة", "شاحنة", "حافلة", "مترو", "قارب", "صاروخ", "مروحية", "غواصة", "دباب", "جرار", "تاكسي", "إسعاف", "إطفاء", "رافعة", "منطاد", "يخت", "موتوسيكل", "توكتوك", "عربة", "ناقلة نفط", "جرافة", "قطار سريع", "سفينة فضاء", "حافلة مدرسية", "عربة خيل", "زلاجة", "تلفريك", "عبارة", "جت سكي", "لانش", "لودر", "مكوك فضاء", "سيارة سباق", "سيارة شرطة", "مقعد متحرك", "سكوتر", "موتور", "عجلة", "مركبة", "قاطرة", "طائرة حربية", "طائرة شحن", "سفينة حربية", "عربة نقل", "دراجة نارية", "حافلة ذات طابقين"] },
    "3": { name: "أكلات ومشروبات", keywords: ["اكلات", "أكلات", "طعام", "مشروبات", "اكل", "شرب"], words: ["تفاحة", "قهوة", "شاورما", "كوشري", "بيتزا", "برجر", "ملوخية", "مانجو", "فراولة", "شاي", "عصير", "حليب", "خبز", "أرز", "مكرونة", "سمك", "دجاج", "لحم", "بطاطس", "طماطم", "خيار", "بصل", "ثوم", "جبنة", "بيض", "عسل", "مربى", "زيتون", "شوكولاتة", "كيك", "بسكويت", "آيس كريم", "فشار", "حواوشي", "فتة", "محشي", "كباب", "كفتة", "بامية", "عدس", "فول", "طعمية", "سلطة", "شوربة", "موز", "برتقال", "بطيخ", "عنب", "تمر", "مكسرات"] },
    "4": { name: "دول وعواصم", keywords: ["دول", "عواصم", "بلاد", "مدن"], words: ["مصر", "السعودية", "الإمارات", "الكويت", "قطر", "البحرين", "عمان", "العراق", "سوريا", "لبنان", "الأردن", "فلسطين", "اليمن", "ليبيا", "تونس", "الجزائر", "المغرب", "السودان", "القاهرة", "الرياض", "أبوظبي", "المنامة", "مسقط", "بغداد", "دمشق", "بيروت", "عمان العاصمة", "القدس", "صنعاء", "طرابلس", "تونس العاصمة", "الجزائر العاصمة", "الرباط", "الخرطوم", "أمريكا", "فرنسا", "بريطانيا", "ألمانيا", "إيطاليا", "إسبانيا", "روسيا", "الصين", "اليابان", "لندن", "باريس", "مدريد", "روما", "موسكو", "بكين", "طوكيو"] },
    "5": { name: "حيوانات وطيور", keywords: ["حيوانات", "طيور", "حيوان", "طير"], words: ["أسد", "نمر", "فهد", "ذئب", "ثعلب", "كلب", "قطة", "فأر", "أرنب", "غزال", "زرافة", "فيل", "قرد", "دب", "حمار", "حصان", "جمل", "بقرة", "خروف", "ماعز", "خنزير", "حوت", "دولفين", "قرش", "تمساح", "ثعبان", "سلحفاة", "ضفدع", "صقر", "نسر", "بومة", "غراب", "حمام", "عصفور", "بطة", "وزة", "دجاجة", "ديك", "طاووس", "نعامة", "ببغاء", "بطريق", "سنجاب", "حيوان الكنغر", "وحيد القرن", "سيد قشطة", "قنفذ", "خفاش", "ثور", "ضبع"] },
    "6": { name: "أدوات وأجهزة منزلية", keywords: ["ادوات", "أدوات", "اجهزة", "أجهزة", "منزلية", "منزل"], words: ["تليفون", "كمبيوتر", "تلفزيون", "ثلاجة", "غسالة", "بوتاجاز", "ميكروويف", "خلاط", "مكواة", "مكنسة", "مروحة", "تكييف", "سخان", "مصباح", "ساعة حائط", "لابتوب", "تابلت", "شاحن", "سماعة", "كاميرا", "راديو", "مكياج", "مرآة", "سرير", "دولاب", "مكتب", "كرسي", "كنبة", "طاولة", "سجادة", "ستارة", "وسادة", "لحاف", "ملاية", "باب", "شباك", "مفتاح", "قفل", "شماعة", "سلة مهملات", "مقص", "سكين", "شوكة", "ملعقة", "طبق", "كوب", "إبريق", "حلة", "طاسة", "فنجان"] },
    "7": { name: "أماكن ومباني", keywords: ["اماكن", "أماكن", "مباني", "منشآت"], words: ["مدرسة", "مستشفى", "ملعب", "بحر", "شاطئ", "حديقة", "مسجد", "كنيسة", "جامعة", "مطار", "محطة", "فندق", "مطعم", "مقهى", "مكتبة", "مسرح", "سينما", "متحف", "بنك", "مصنع", "شركة", "مكتب بريد", "مركز شرطة", "محكمة", "سجن", "قلعة", "قصر", "برج", "جسر", "نفق", "سوق", "مول", "سوبرماركت", "صيدلية", "عيادة", "مخبز", "ورشة", "جراج", "غابة", "جبل", "نهر", "بحيرة", "واحة", "صحراء", "مزرعة", "حديقة حيوان", "شقة", "فيلا", "منزل", "استاد"] },
    "8": { name: "مهن ووظائف", keywords: ["مهن", "وظائف", "شغل", "شغلانة"], words: ["مدرس", "طبيب", "مهندس", "محامي", "محاسب", "صحفي", "طيار", "ضابط", "جندي", "قاضي", "سفير", "وزير", "رئيس", "مدير", "مبرمج", "مصمم", "كاتب", "شاعر", "فنان", "ممثل", "مغني", "رسام", "مصور", "طباخ", "ندل", "حلاق", "خياط", "نجار", "سباك", "كهربائي", "بناء", "ميكانيكي", "سائق", "عامل", "فلاح", "صياد", "جزار", "خباز", "بائع", "تاجر", "حارس", "رجل إطفاء", "مسعف", "ممرض", "صيدلي", "مضيفة", "طيار مساعد", "عالم", "باحث", "فلكي"] },
    "9": { name: "رياضة وألعاب", keywords: ["رياضة", "رياضه", "العاب", "ألعاب", "كورة"], words: ["كرة القدم", "كرة السلة", "كرة الطائرة", "التنس", "السباحة", "الجري", "الملاكمة", "المصارعة", "الكاراتيه", "التايكوندو", "الجمباز", "الرماية", "الفروسية", "التجديف", "الغوص", "التزلج", "الشطرنج", "الدومينو", "الطاولة لعبة", "الكوتشينة", "البلايستيشن", "الأكس بوكس", "ببجي", "فورتنايت", "لودو", "كرة اليد", "الغولف", "البولينغ", "البلياردو", "صيد السمك", "اليوجا", "كمال الأجسام", "رفع الأثقال", "الدراجات الهوائية", "سلاح الشيش", "الركض", "سباق السيارات", "الوثب العالي", "الوثب الطويل", "رمي الرمح", "القرص", "الماراثون", "تنس الطاولة", "الريشة الطائرة", "الاسكواش", "الكركيت", "البيسبول", "الرغبي", "الهوكي", "السهم"] },
    "10": { name: "طبيعة ونباتات", keywords: ["طبيعة", "طبيعه", "نباتات", "نبات", "شجر"], words: ["شجرة", "وردة", "نخلة", "عشب", "زهرة", "غيمة", "مطر", "ثلج", "برق", "رعد", "شمس", "قمر", "نجم", "كوكب", "فضاء", "سماء", "أرض", "تراب", "رمل", "صخر", "حجر", "بركان", "زلزال", "إعصار", "موج", "فيضان", "طحالب", "مرجان", "صبار", "نعناع", "ريحان", "ياسمين", "فلة", "قرنفل", "نرجس", "زعفران", "قرفة", "زنجبيل", "كمون", "شبت", "بقدونس", "كزبرة", "جرجير", "فجل", "سبانخ", "خس", "ملفوف", "قرنبيط", "بروكلي", "فطر"] }
};

const allWords = Object.values(categories).reduce((acc, cat) => acc.concat(cat.words), []);

// توليد 5 اختيارات للحرامي من نفس القسم حصراً حتى لا تكون الكلمة واضحة
const generateCategoryOptions = (correctWord, categoryKey) => {
    let pool = [];
    if (categoryKey && categoryKey !== 'all' && categories[categoryKey]) {
        pool = categories[categoryKey].words;
    } else {
        // إذا كان الوضع عشوائي، نحدد القسم الذي تنتمي إليه الكلمة الصحيحة لجمع البدائل منه
        for (const catId of Object.keys(categories)) {
            if (categories[catId].words.includes(correctWord)) {
                pool = categories[catId].words;
                break;
            }
        }
        if (pool.length < 5) pool = allWords;
    }

    let otherWords = pool.filter(w => w !== correctWord);
    otherWords.sort(() => Math.random() - 0.5);

    let selectedOptions = [correctWord, ...otherWords.slice(0, 4)];
    return selectedOptions.sort(() => Math.random() - 0.5);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!global.pmUsers) global.pmUsers = new Set();

const before = async function (mek, currentConn) {
    let from = mek.key.remoteJid;
    if (!from.endsWith('@g.us')) {
        let sender = from;
        if (sender.includes(':')) sender = sender.split(':')[0] + '@s.whatsapp.net';
        global.pmUsers.add(sender);
    }
    return false;
};

// مطابقة القسم من النص المدخل (سواء رقم 1-10 أو اسم القسم أو الكلمة المفتاحية)
function matchCategory(input) {
    if (!input) return null;
    let clean = input.trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/^(بكاسه|بكاسة)\s*/, '')
        .replace(/^قسم\s*/, '')
        .trim();

    if (categories[clean]) return clean;
    if (clean === 'عشوائي' || clean === 'كل' || clean === 'عام') return 'all';

    for (let id of Object.keys(categories)) {
        let cat = categories[id];
        let normName = cat.name.toLowerCase()
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي');
        if (normName.includes(clean) || clean.includes(normName)) return id;
        if (cat.keywords && cat.keywords.some(k => clean.includes(k) || k.includes(clean))) return id;
    }
    return null;
}

const handler = async (mek, currentConn) => {
    let from = mek.key.remoteJid;
    let sender = from.endsWith('@g.us') ? (mek.key.participant || '') : from;
    if (sender.includes(':')) sender = sender.split(':')[0] + '@s.whatsapp.net';
    
    let bodyText = (mek.text || '').trim();
    let normalized = bodyText.toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
    let args = normalized.split(/\s+/);
    let firstWord = args[0] || '';

    if (!global.bakasa) global.bakasa = {};
    if (!global.bakasa[from]) {
        global.bakasa[from] = {
            status: 'off',
            category: 'all',
            players: [],
            playerNumbers: {},
            nextPlayers: [],
            votes: {},
            thief: '',
            lastThief: '',
            word: '',
            options: []
        };
    }
    let game = global.bakasa[from];

    // تحديد الأمر والفرع
    let isExplicitBakasa = firstWord === 'بكاسه' || firstWord === 'بكاسة';
    let subCommand = isExplicitBakasa ? (args[1] || '') : firstWord;

    // --- 0. شرح اللعبة ---
    if (subCommand === 'شرح') {
        let helpText = `🕵️‍♂️ *شرح لعبة بكاسة (مين فينا الحرامي؟)* 🕵️‍♂️\n\n` +
            `💡 *فكرة اللعبة:* \n` +
            `البوت بيختار كلمة سرية ويبعتها على الخاص لكل اللاعبين، ما عدا لاعب واحد عشوائي بيكون هو (*الحرامي*) مش بيعرف الكلمة!\n\n` +
            `⚠️ *شرط هام جداً:* \nلازم كل لاعب ينضم للعبة يبعث للبوت (*نقطة .* أو أي رسالة) على الخاص عشان البوت يقدر يبعتله الكلمة السرية في السر.\n\n` +
            `🎮 *طريقة وخطوات اللعب:* \n` +
            `1️⃣ اكتب *بكاسة* لفتح الروم وعرض الأقسام.\n` +
            `2️⃣ اكتب رقم القسم مباشرة (مثلاً: *1* أو *ملابس*).\n` +
            `3️⃣ اكتب *انضمام* أو أرسل نقطة *( . )* للمشاركة (أقل عدد 3 لاعبين).\n` +
            `4️⃣ اكتب *ابدأ* لانطلاق الدور وتوزيع الأدوار والأرقام.\n` +
            `5️⃣ اسألوا بعض بالترتيب، ولما تخلصوا نقاش اكتبوا:\n` +
            `   *تصويت [رقم اللاعب أو منشن]* (مثال: تصويت 2).\n` +
            `6️⃣ الحرامي يكتب *بكاسة خلصت* لعرض النتائج والتخمين.\n` +
            `7️⃣ الحرامي يكتب *تخمين [الرقم]* (من 5 اختيارات من نفس القسم).\n\n` +
            `🏆 *نظام النقاط:* \n` +
            `• التصويت الصحيح على الحرامي: *+100 نقطة* 🟢\n` +
            `• التصويت الخاطئ: *-50 نقطة* 🔴\n` +
            `• تخمين الحرامي للكلمة صح: *+50 نقطة* 🎯\n` +
            `💾 جميع النقاط تسجل فوراً في بروفايلك على البوت!`;
        return currentConn.sendMessage(from, { text: helpText }, { quoted: mek });
    }

    // --- 1. فتح الروم واختيار القسم ---
    if (isExplicitBakasa && (subCommand === '' || subCommand === 'فتح')) {
        if (game.status === 'playing' || game.status === 'voting' || game.status === 'guessing') {
            return currentConn.sendMessage(from, { text: '⚠️ فيه جيم شغال حالياً في المجموعة! انتظروا ينتهي أو اكتبوا *بكاسة الغاء*.' }, { quoted: mek });
        }
        if (game.status === 'waiting') {
            return currentConn.sendMessage(from, { text: `⏳ الروم مفتوح بالفعل للإنضمام بقسم (*${game.category === 'all' ? 'عشوائي' : categories[game.category]?.name}*)!\nاكتبوا *انضمام* أو أرسلوا نقطة (.)، ثم اكتبوا *ابدأ*.` }, { quoted: mek });
        }

        game.status = 'choosing_category';
        game.players = [sender];
        game.playerNumbers = { [sender]: 1 };
        game.nextPlayers = [];
        game.votes = {};
        game.category = 'all';

        let menuText = `🎮 *تم فتح روم لعبة بكاسة (مين فينا الحرامي؟)* 🕵️‍♂️\n\n` +
            `📂 *اختر قسم الكلمات بكتابة رقمه أو اسمه مباشرة:*\n\n`;
        for (let id in categories) {
            menuText += `*${id}* ➔ ${categories[id].name}\n`;
        }
        menuText += `\n🎲 أو اكتب *عشوائي* لاختيار كلمات من جميع الأقسام.\n\n` +
            `💡 _تقدر تكتب الرقم على طول (مثلاً: 1) أو اسم القسم (مثلاً: ملابس)_`;
        return currentConn.sendMessage(from, { text: menuText }, { quoted: mek });
    }

    // اختيار القسم أثناء مرحلة choosing_category (أو تغيير القسم)
    if (game.status === 'choosing_category' || (game.status === 'waiting' && isExplicitBakasa && args[1])) {
        let catQuery = isExplicitBakasa ? args.slice(1).join(' ') : bodyText;
        let matched = matchCategory(catQuery);
        if (matched) {
            game.category = matched;
            game.status = 'waiting';
            let catDisplayName = matched === 'all' ? 'عشوائي من كل الأقسام 🎲' : categories[matched].name;
            let joinMsg = `📂 *تم اختيار قسم:* [ ${catDisplayName} ] بنجاح! ✅\n\n` +
                `👥 *مرحلة الانضمام مفتوحة الآن:*\n` +
                `• اكتب *انضمام* أو أرسل نقطة *( . )* للمشاركة.\n` +
                `• عدد المشتركين الحالي: *${game.players.length}* (أقل عدد للبدء: 3 لاعبين).\n\n` +
                `⚠️ *تنبيه ضروري:* لازم كل لاعب ينضم يبعت نقطة (.) للبوت على الخاص عشان يقدر يبعتله الكلمة السرية في السر!\n\n` +
                `🚀 بعد اكتمال اللاعبين اكتبوا: *ابدأ*`;
            return currentConn.sendMessage(from, { text: joinMsg }, { quoted: mek });
        }
    }

    // --- 2. الانضمام للعبة ---
    if (subCommand === 'انضمام' || bodyText === '.' || (isExplicitBakasa && subCommand === 'انضم')) {
        if (game.status === 'playing' || game.status === 'voting' || game.status === 'guessing') {
            if (game.players.includes(sender)) return currentConn.sendMessage(from, { text: '🙋‍♂️ إنت بتلعب في الدور الحالي بالفعل!' }, { quoted: mek });
            if (game.nextPlayers.includes(sender)) return currentConn.sendMessage(from, { text: '⏳ إنت مسجل في قائمة الانتظار بالفعل وهتدخل الدور الجاي!' }, { quoted: mek });
            game.nextPlayers.push(sender);
            return currentConn.sendMessage(from, { text: '⏳ الجيم شغال حالياً! تم تسجيلك في قائمة الانتظار وهتدخل الجيم الجاي لما يكتبوا *بكاسة كمل*.' }, { quoted: mek });
        }

        if (game.status === 'waiting' || game.status === 'choosing_category') {
            if (game.status === 'choosing_category') {
                game.status = 'waiting';
            }
            if (game.players.includes(sender)) return currentConn.sendMessage(from, { text: '🙋‍♂️ إنت منضم بالفعل للعبة!' }, { quoted: mek });
            game.players.push(sender);
            return currentConn.sendMessage(from, { text: `✅ انضميت للعبة بنجاح! عدد اللاعبين الحالي: *${game.players.length}* 👥\n\n📩 *تنبيه:* ابعت للبوت نقطة (.) في الخاص دلوقتي لو ممراسلتوش قبل كده عشان يعرف يبعتلك دورك!` }, { quoted: mek });
        }
    }

    // --- 3. خروج لاعب من الروم ---
    if (subCommand === 'خروج') {
        if (!game.players.includes(sender) && !game.nextPlayers.includes(sender)) {
            return currentConn.sendMessage(from, { text: '❌ إنت مش منضم للجيم ده عشان تخرج منه.' }, { quoted: mek });
        }
        
        if (game.nextPlayers.includes(sender)) {
            game.nextPlayers = game.nextPlayers.filter(p => p !== sender);
            return currentConn.sendMessage(from, { text: '👋 تم إزالتك من قائمة الانتظار.' }, { quoted: mek });
        }

        game.players = game.players.filter(p => p !== sender);
        delete game.playerNumbers[sender];
        delete game.votes[sender];
        await currentConn.sendMessage(from, { text: '👋 تم خروجك من اللعبة بنجاح.' }, { quoted: mek });

        if (game.players.length < 3 && (game.status === 'playing' || game.status === 'voting' || game.status === 'guessing')) {
            game.status = 'off';
            game.players = [];
            game.playerNumbers = {};
            game.nextPlayers = [];
            game.votes = {};
            await currentConn.sendMessage(from, { text: '📉 عدد اللاعبين قل عن 3.. تم إنهاء الجيم تلقائياً.' }, { quoted: mek });
        }
        return;
    }

    // --- 4. بدء الجيم (أقل عدد 3 لاعبين مع التحقق من الخاص) ---
    if (subCommand === 'ابدأ' || subCommand === 'ابدا' || subCommand === 'بدا') {
        if (game.status !== 'waiting' && game.status !== 'choosing_category') {
            return currentConn.sendMessage(from, { text: '❌ مفيش جيم مستني البدء حالياً. اكتب *بكاسة* لفتح روم جديد.' }, { quoted: mek });
        }
        if (!game.players.includes(sender)) {
            return currentConn.sendMessage(from, { text: '❌ لازم تكون منضم للجيم عشان تقدر تبدأه!' }, { quoted: mek });
        }
        if (game.players.length < 3) {
            return currentConn.sendMessage(from, { text: `❌ لا يمكن بدء اللعبة بأقل من 3 أفراد! عدد اللاعبين الحالي *${game.players.length}* والحد الأدنى هو 3 لاعبين.` }, { quoted: mek });
        }

        // 🔍 التحقق من أن كل اللاعبين راسلوا البوت بالخاص (شرط النقطة)
        let missingPM = game.players.filter(p => !global.pmUsers.has(p));
        if (missingPM.length > 0) {
            let mentions = missingPM.map(p => `@${p.split('@')[0]}`).join(' ');
            let missingText = `⚠️ *مش هنقدر نبدأ اللعبة دلوقتي!* \n\nاللاعبين دول مبعتوش نقطة للبوت على الخاص:\n${mentions}\n\n👉 ادخلوا ابعتوا للبوت أي رسالة أو نقطة ( . ) على الخاص الأول، وبعدها اكتبوا *ابدأ* تاني!`;
            return currentConn.sendMessage(from, { text: missingText, mentions: missingPM }, { quoted: mek });
        }

        // ترتيب اللاعبين وتعيين أرقام الأدوار الثابتة
        game.playerNumbers = {};
        game.players.forEach((p, idx) => {
            game.playerNumbers[p] = idx + 1;
        });

        let pool = game.category === 'all' ? allWords : categories[game.category].words;
        game.word = pool[Math.floor(Math.random() * pool.length)];

        let availableThiefs = game.players.filter(p => p !== game.lastThief);
        if (availableThiefs.length === 0) availableThiefs = game.players;

        game.thief = availableThiefs[Math.floor(Math.random() * availableThiefs.length)];
        game.lastThief = game.thief;

        // توليد 5 اختيارات من نفس القسم للحرامي
        game.options = generateCategoryOptions(game.word, game.category);
        game.votes = {};
        game.status = 'playing';

        let currentCatName = game.category === 'all' ? "عشوائي من كل الأقسام 🎲" : categories[game.category].name;

        // إعلان الأدوار وترتيب الأسئلة في الجروب
        let orderText = `🕵️‍♂️ *بدأت لعبة بكاسة (مين فينا الحرامي؟)!* 🎮\n` +
            `📂 القسم المختار: *${currentCatName}*\n\n` +
            `👥 *ترتيب اللاعبين وأرقام الأدوار:* \n`;

        game.players.forEach((p, idx) => {
            let numEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][idx] || `[${idx + 1}]`;
            orderText += `${numEmoji} @${getCleanNumber(p)} (اللاعب رقم ${idx + 1})\n`;
        });

        orderText += `\n💬 *طريقة سير الأسئلة:* \n` +
            `• اللاعب رقم 1 يسأل اللاعب رقم 2.\n` +
            `• اللاعب رقم 2 يسأل اللاعب رقم 3.\n` +
            `• وهكذا حتى يسأل اللاعب الأخير اللاعب رقم 1.\n\n` +
            `📩 *تم إرسال الكلمات السرية على الخاص لجميع اللاعبين ما عدا الحرامي!*\n` +
            `اسألوا بعض بذكاء وبدون ما تفضحوا الكلمة للحرامي!\n\n` +
            `🗳️ *بعد انتهاء الأسئلة والنقاش:*\n` +
            `• صوتوا على الحرامي بكتابة:\n` +
            `  *تصويت [رقم اللاعب]* (مثال: تصويت 2)\n` +
            `  أو *تصويت [@منشن]*\n` +
            `• الحرامي لما يخلص يكتب: *بكاسة خلصت*`;

        await currentConn.sendMessage(from, { text: orderText, mentions: game.players }, { quoted: mek });

        // إرسال الكلمات السرية في الخاص
        for (let playerJID of game.players) {
            try {
                if (playerJID === game.thief) {
                    await currentConn.sendMessage(playerJID, {
                        text: `🤫 *إنت الحرامي في الجيم ده!* \n📂 القسم المختار هو: (*${currentCatName}*).\n\nأنت لا تعرف الكلمة السرية! اسمع أسئلة وإجابات اللاعبين وحاول متتفقسش في دورك، واعرف الكلمة منهم!`
                    });
                } else {
                    await currentConn.sendMessage(playerJID, {
                        text: `📦 *الكلمة السرية للجيم ده هي:* ➔ *${game.word}*\n📂 القسم: (*${currentCatName}*).\n\nالحرامي ميعرفش الكلمة! اسألوا بعض بذكاء عشان تكشفوه وتكسبوا 100 نقطة!`
                    });
                }
            } catch (e) {
                console.log(`❌ فشل الإرسال على الخاص للاعب ${playerJID}`);
            }
            await delay(1500);
        }
        return;
    }

    // --- 5. التصويت على الحرامي (برقم اللاعب أو بالمنشن) ---
    let isVoteCmd = subCommand === 'تصويت' || (isExplicitBakasa && args[1] === 'تصويت') || normalized.startsWith('تصويت ');
    if (isVoteCmd) {
        if (game.status !== 'playing' && game.status !== 'voting') {
            return currentConn.sendMessage(from, { text: '❌ مفيش دور شغال حالياً للتصويت!' }, { quoted: mek });
        }
        if (!game.players.includes(sender)) {
            return currentConn.sendMessage(from, { text: '❌ لازم تكون من اللاعبين المشاركين في الجيم عشان تصوت!' }, { quoted: mek });
        }

        // استخراج الهدف المصوت عليه (رقم أو منشن أو ريبلاي)
        let voteTarget = null;
        let voteArg = isExplicitBakasa ? args[2] : (args[0] === 'تصويت' ? args[1] : args[2]);

        // 1. فحص المنشن أو الريبلاي
        let mentioned = mek.mentionedJid?.[0] || (mek.message?.extendedTextMessage?.contextInfo?.participant);
        if (mentioned && game.players.includes(mentioned)) {
            voteTarget = mentioned;
        }

        // 2. فحص رقم اللاعب (1, 2, 3...)
        if (!voteTarget && voteArg && !isNaN(parseInt(voteArg))) {
            let targetNum = parseInt(voteArg);
            for (let p of game.players) {
                if (game.playerNumbers[p] === targetNum) {
                    voteTarget = p;
                    break;
                }
            }
        }

        if (!voteTarget) {
            let listText = `📌 *اكتب رقم اللاعب أو اعمل له منشن بعد أمر التصويت:*\n*(مثال: تصويت 2 أو تصويت @منشن)*\n\nقائمة اللاعبين وأرقامهم:\n`;
            game.players.forEach(p => {
                listText += `• اللاعب رقم *${game.playerNumbers[p]}* ➔ @${getCleanNumber(p)}\n`;
            });
            return currentConn.sendMessage(from, { text: listText, mentions: game.players }, { quoted: mek });
        }

        if (voteTarget === sender) {
            return currentConn.sendMessage(from, { text: '🤦‍♂️ مينفعش تصوت على نفسك يا فنان! صوت على الحرامي المشكوك فيه.' }, { quoted: mek });
        }

        game.votes[sender] = voteTarget;
        let totalVotes = Object.keys(game.votes).length;
        let senderNum = game.playerNumbers[sender] || '?';
        let targetNum = game.playerNumbers[voteTarget] || '?';

        let voteMsg = `🗳️ اللاعب رقم [ ${senderNum} ] سجل صوته ضد ➔ *اللاعب رقم [ ${targetNum} ]* (@${getCleanNumber(voteTarget)})!\n` +
            `الأصوات المسجلة: *${totalVotes}/${game.players.length}* 📥`;

        if (totalVotes === game.players.length) {
            voteMsg += `\n\n🎉 *اكتملت أصوات جميع اللاعبين!* \nدلوقتي الحرامي يكتب أمر *بكاسة خلصت* عشان يكشف هويته ويخمن الكلمة السرية!`;
        }

        return currentConn.sendMessage(from, { text: voteMsg, mentions: [voteTarget] }, { quoted: mek });
    }

    // --- 6. إنهاء النقاش والتصويت بواسطة الحرامي (بكاسة خلصت) ---
    if (subCommand === 'خلصت' || (isExplicitBakasa && args[1] === 'خلصت')) {
        if (game.status !== 'playing' && game.status !== 'voting') {
            return currentConn.sendMessage(from, { text: '❌ مفيش جيم شغال حالياً.' }, { quoted: mek });
        }
        if (sender !== game.thief) {
            return currentConn.sendMessage(from, { text: '❌ أمر *بكاسة خلصت* يكتبه الحرامي فقط لما تخلصوا نقاش وتصويت!' }, { quoted: mek });
        }

        game.status = 'guessing';

        let thiefNumber = game.playerNumbers[game.thief] || 1;
        let thiefClean = getCleanNumber(game.thief);

        // حساب نقاط التصويت: من صوت صح يأخذ 100 نقطة، ومن صوت خطأ يخصم 50 نقطة
        let voteSummary = `📢 *انتهى وقت النقاش والتصويت!* 🗳️\n\n` +
            `🕵️‍♂️ *الحرامي الحقيقي في هذا الدور هو:* \n` +
            `➔ اللاعب رقم [ ${thiefNumber} ] : @${thiefClean} 🤫\n\n` +
            `📊 *نتائج تصويت اللاعبين وتوزيع النقاط:* \n`;

        let pointsSummaryList = [];

        for (let p of game.players) {
            if (p === game.thief) continue; // الحرامي لا يصوت على نفسه
            let playerNum = game.playerNumbers[p] || '?';
            let playerClean = getCleanNumber(p);
            let votedFor = game.votes[p];

            if (votedFor === game.thief) {
                // صوت صح ➔ +100 نقطة
                let res = modifyUserPoints(p, 100, mek.pushName);
                voteSummary += `• [اللاعب ${playerNum}] @${playerClean} ➔ صوت للحرامي صح 🟢 (*+100 نقطة*)\n`;
                pointsSummaryList.push({ jid: p, num: playerNum, clean: playerClean, change: '+100', total: res.total });
            } else {
                // صوت غلط أو مصوتش ➔ -50 نقطة
                let res = modifyUserPoints(p, -50, mek.pushName);
                let targetVotedNum = votedFor ? (game.playerNumbers[votedFor] || '?') : 'ممصوتش';
                voteSummary += `• [اللاعب ${playerNum}] @${playerClean} ➔ صوت خطأ (${targetVotedNum}) 🔴 (*-50 نقطة*)\n`;
                pointsSummaryList.push({ jid: p, num: playerNum, clean: playerClean, change: '-50', total: res.total });
            }
        }

        // عرض 5 اختيارات من نفس القسم للحرامي
        let optionsText = game.options.map((w, i) => `*${i + 1}* ➔ ${w}`).join('\n');

        voteSummary += `\n━━━━━━━━━━━━━━━━━━━━\n` +
            `🧐 *والآن دور الحرامي لتخمين الكلمة السرية!* \n` +
            `قدامك 5 اختيارات من نفس القسم:\n\n${optionsText}\n\n` +
            `✍️ يا حرامي (@${thiefClean}) اكتب رقم الاختيار الصح:\n` +
            `*تخمين [الرقم]* (مثال: تخمين 3 أو اكتب الرقم مباشرة)\n` +
            `🎯 لو خمنت الكلمة صح هتكسب *50 نقطة*!`;

        game.roundPointsSummary = pointsSummaryList;

        return currentConn.sendMessage(from, { text: voteSummary, mentions: game.players }, { quoted: mek });
    }

    // --- 7. تخمين الحرامي للكلمة السرية ---
    let isGuessCmd = subCommand === 'تخمين' || (isExplicitBakasa && args[1] === 'تخمين') || (game.status === 'guessing' && /^[1-5]$/.test(bodyText));
    if (isGuessCmd) {
        if (game.status !== 'guessing') return;
        if (sender !== game.thief) {
            return currentConn.sendMessage(from, { text: '❌ أمر التخمين مخصص للحرامي فقط!' }, { quoted: mek });
        }

        let guessArg = /^[1-5]$/.test(bodyText) ? bodyText : (args[0] === 'تخمين' ? args[1] : args[2]);
        let choiceIndex = parseInt(guessArg) - 1;

        if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= game.options.length) {
            return currentConn.sendMessage(from, { text: '❌ اكتب رقم الاختيار المظبوط يا حرامي من 1 إلى 5! (مثال: تخمين 2)' }, { quoted: mek });
        }

        let selectedWord = game.options[choiceIndex];
        let thiefClean = getCleanNumber(game.thief);
        let thiefPointsChange = 0;
        let thiefResultText = '';

        if (selectedWord === game.word) {
            // تخمين صحيح ➔ +50 نقطة للحرامي
            let res = modifyUserPoints(game.thief, 50, mek.pushName);
            thiefPointsChange = 50;
            thiefResultText = `🔥 *عاش يا حرامي! طلعت صايع وخمنت الكلمة السرية صح!* 👏\n` +
                `الكلمة كانت: *${game.word}*\n` +
                `🎉 حصلت على *+50 نقطة*!`;
        } else {
            // تخمين خاطئ
            thiefResultText = `💀 *للأسف خمنت غلط يا حرامي!* \n` +
                `الكلمة السرية الصحيحة كانت: *${game.word}*!`;
        }

        let thiefTotal = getUserPoints(game.thief);
        game.status = 'finished';

        // عرض لوحة نتائج ونقاط الجولة الكاملة لجميع اللاعبين
        let finalBoard = `${thiefResultText}\n\n` +
            `🏆 *لوحة نتائج ونقاط الجولة:* 📊\n` +
            `━━━━━━━━━━━━━━━━━━━━\n`;

        if (game.roundPointsSummary && game.roundPointsSummary.length > 0) {
            for (let item of game.roundPointsSummary) {
                finalBoard += `• [اللاعب ${item.num}] @${item.clean} : ${item.change} ↜ الإجمالي: [ ${item.total.toLocaleString('ar-EG')} ] نقطة 🪙\n`;
            }
        }

        let thiefNum = game.playerNumbers[game.thief] || '?';
        finalBoard += `• [اللاعب ${thiefNum} - الحرامي] @${thiefClean} : ${thiefPointsChange > 0 ? '+50' : '0'} ↜ الإجمالي: [ ${thiefTotal.toLocaleString('ar-EG')} ] نقطة 🪙\n`;
        finalBoard += `━━━━━━━━━━━━━━━━━━━━\n` +
            `💾 جميع النقاط تم تحديثها وحفظها في بروفايل كل لاعب على البوت!\n\n` +
            `🔄 عشان تكملوا دور جديد بنفس اللاعبين: *بكاسة كمل*\n` +
            `🛑 لإنهاء اللعبة وتصفير الروم: *بكاسة الغاء*`;

        return currentConn.sendMessage(from, { text: finalBoard, mentions: game.players }, { quoted: mek });
    }

    // --- 8. إكمال دور جديد بنفس اللاعبين ---
    if (subCommand === 'كمل' || (isExplicitBakasa && args[1] === 'كمل')) {
        if (game.status !== 'finished') {
            return currentConn.sendMessage(from, { text: '❌ الجيم لسه مخلصش عشان تكملوا دور جديد!' }, { quoted: mek });
        }
        if (!game.players.includes(sender)) {
            return currentConn.sendMessage(from, { text: '❌ اللاعبين المشاركين فقط هم من يمكنهم إكمال الدور.' }, { quoted: mek });
        }

        game.players = [...game.players, ...game.nextPlayers];
        game.nextPlayers = [];
        game.votes = {};
        game.status = 'waiting';

        let currentCatName = game.category === 'all' ? "عشوائي من كل الأقسام 🎲" : categories[game.category]?.name;

        return currentConn.sendMessage(from, {
            text: `🔄 *تم تجهيز الدور الجديد بنجاح!* \n` +
                `👥 اللاعبين الحاليين: *${game.players.length}*\n` +
                `📂 القسم الحالي: *${currentCatName}*\n\n` +
                `🚀 اكتبوا *ابدأ* للانطلاق!`
        }, { quoted: mek });
    }

    // --- 9. إلغاء وتصفير الروم ---
    if (subCommand === 'إلغاء' || subCommand === 'الغاء' || (isExplicitBakasa && (args[1] === 'الغاء' || args[1] === 'إلغاء'))) {
        game.status = 'off';
        game.players = [];
        game.playerNumbers = {};
        game.nextPlayers = [];
        game.votes = {};
        game.category = 'all';
        return currentConn.sendMessage(from, { text: '🛑 تم إلغاء لعبة بكاسة وتصفير الروم بنجاح.' }, { quoted: mek });
    }
};

export default {
    before,
    after: handler
};
