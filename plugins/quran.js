import axios from 'axios';

// 📖 قائمة بيانات ومعلومات جميع سور القرآن الكريم الـ 114
export const QURAN_SURAHS = [
  { num: 1, name: 'الفاتحة', ayas: 7, type: 'مكية 🕋', aliases: ['فاتحة', 'ام الكتاب', 'السبع المثاني', 'الحمد'] },
  { num: 2, name: 'البقرة', ayas: 286, type: 'مدنية 🕌', aliases: ['بقرة', 'سنام القران', 'اية الكرسي'] },
  { num: 3, name: 'آل عمران', ayas: 200, type: 'مدنية 🕌', aliases: ['ال عمران', 'عمران'] },
  { num: 4, name: 'النساء', ayas: 176, type: 'مدنية 🕌', aliases: ['نساء'] },
  { num: 5, name: 'المائدة', ayas: 120, type: 'مدنية 🕌', aliases: ['مائدة', 'المائده', 'مائده'] },
  { num: 6, name: 'الأنعام', ayas: 165, type: 'مكية 🕋', aliases: ['الانعام', 'انعام'] },
  { num: 7, name: 'الأعراف', ayas: 206, type: 'مكية 🕋', aliases: ['الاعراف', 'اعراف'] },
  { num: 8, name: 'الأنفال', ayas: 75, type: 'مدنية 🕌', aliases: ['الانفال', 'انفال'] },
  { num: 9, name: 'التوبة', ayas: 129, type: 'مدنية 🕌', aliases: ['توبة', 'التوبه', 'توبه', 'براءة', 'براءه'] },
  { num: 10, name: 'يونس', ayas: 109, type: 'مكية 🕋', aliases: [] },
  { num: 11, name: 'هود', ayas: 123, type: 'مكية 🕋', aliases: [] },
  { num: 12, name: 'يوسف', ayas: 111, type: 'مكية 🕋', aliases: [] },
  { num: 13, name: 'الرعد', ayas: 43, type: 'مدنية 🕌', aliases: ['رعد'] },
  { num: 14, name: 'إبراهيم', ayas: 52, type: 'مكية 🕋', aliases: ['ابراهيم'] },
  { num: 15, name: 'الحجر', ayas: 99, type: 'مكية 🕋', aliases: ['حجر'] },
  { num: 16, name: 'النحل', ayas: 128, type: 'مكية 🕋', aliases: ['نحل', 'النعم'] },
  { num: 17, name: 'الإسراء', ayas: 111, type: 'مكية 🕋', aliases: ['الاسراء', 'اسراء', 'بني اسرائيل', 'سبحان'] },
  { num: 18, name: 'الكهف', ayas: 110, type: 'مكية 🕋', aliases: ['كهف', 'اهل الكهف'] },
  { num: 19, name: 'مريم', ayas: 98, type: 'مكية 🕋', aliases: [] },
  { num: 20, name: 'طه', ayas: 135, type: 'مكية 🕋', aliases: ['طاها'] },
  { num: 21, name: 'الأنبياء', ayas: 112, type: 'مكية 🕋', aliases: ['الانبياء', 'انبياء'] },
  { num: 22, name: 'الحج', ayas: 78, type: 'مدنية 🕌', aliases: ['حج'] },
  { num: 23, name: 'المؤمنون', ayas: 118, type: 'مكية 🕋', aliases: ['مؤمنون', 'المؤمنين'] },
  { num: 24, name: 'النور', ayas: 64, type: 'مدنية 🕌', aliases: ['نور'] },
  { num: 25, name: 'الفرقان', ayas: 77, type: 'مكية 🕋', aliases: ['فرقان'] },
  { num: 26, name: 'الشعراء', ayas: 227, type: 'مكية 🕋', aliases: ['شعراء'] },
  { num: 27, name: 'النمل', ayas: 93, type: 'مكية 🕋', aliases: ['نمل'] },
  { num: 28, name: 'القصص', ayas: 88, type: 'مكية 🕋', aliases: ['قصص'] },
  { num: 29, name: 'العنكبوت', ayas: 69, type: 'مكية 🕋', aliases: ['عنكبوت'] },
  { num: 30, name: 'الروم', ayas: 60, type: 'مكية 🕋', aliases: ['روم'] },
  { num: 31, name: 'لقمان', ayas: 34, type: 'مكية 🕋', aliases: [] },
  { num: 32, name: 'السجدة', ayas: 30, type: 'مكية 🕋', aliases: ['سجدة', 'السجده', 'سجده', 'الم تنزيل'] },
  { num: 33, name: 'الأحزاب', ayas: 73, type: 'مدنية 🕌', aliases: ['الاحزاب', 'احزاب'] },
  { num: 34, name: 'سبأ', ayas: 54, type: 'مكية 🕋', aliases: ['سبا'] },
  { num: 35, name: 'فاطر', ayas: 45, type: 'مكية 🕋', aliases: ['الملائكة', 'ملائكة'] },
  { num: 36, name: 'يس', ayas: 83, type: 'مكية 🕋', aliases: ['ياسين', 'قلب القران'] },
  { num: 37, name: 'الصافات', ayas: 182, type: 'مكية 🕋', aliases: ['صافات'] },
  { num: 38, name: 'ص', ayas: 88, type: 'مكية 🕋', aliases: ['صاد'] },
  { num: 39, name: 'الزمر', ayas: 75, type: 'مكية 🕋', aliases: ['زمر'] },
  { num: 40, name: 'غافر', ayas: 85, type: 'مكية 🕋', aliases: ['المؤمن', 'مؤمن'] },
  { num: 41, name: 'فصلت', ayas: 54, type: 'مكية 🕋', aliases: ['حم السجدة'] },
  { num: 42, name: 'الشورى', ayas: 53, type: 'مكية 🕋', aliases: ['شوري', 'شورى', 'حم عسق'] },
  { num: 43, name: 'الزخرف', ayas: 89, type: 'مكية 🕋', aliases: ['زخرف'] },
  { num: 44, name: 'الدخان', ayas: 59, type: 'مكية 🕋', aliases: ['دخان'] },
  { num: 45, name: 'الجاثية', ayas: 37, type: 'مكية 🕋', aliases: ['جاثية', 'الجاثيه', 'جاثيه'] },
  { num: 46, name: 'الأحقاف', ayas: 35, type: 'مكية 🕋', aliases: ['الاحقاف', 'احقاف'] },
  { num: 47, name: 'محمد', ayas: 38, type: 'مدنية 🕌', aliases: ['القتال'] },
  { num: 48, name: 'الفتح', ayas: 29, type: 'مدنية 🕌', aliases: ['فتح', 'إنا فتحنا', 'انا فتحنا'] },
  { num: 49, name: 'الحجرات', ayas: 18, type: 'مدنية 🕌', aliases: ['حجرات'] },
  { num: 50, name: 'ق', ayas: 45, type: 'مكية 🕋', aliases: ['قاف'] },
  { num: 51, name: 'الذاريات', ayas: 60, type: 'مكية 🕋', aliases: ['ذاريات'] },
  { num: 52, name: 'الطور', ayas: 49, type: 'مكية 🕋', aliases: ['طور'] },
  { num: 53, name: 'النجم', ayas: 62, type: 'مكية 🕋', aliases: ['نجم'] },
  { num: 54, name: 'القمر', ayas: 55, type: 'مكية 🕋', aliases: ['قمر', 'اقتربت الساعة'] },
  { num: 55, name: 'الرحمن', ayas: 78, type: 'مدنية 🕌', aliases: ['رحمن', 'عروس القران'] },
  { num: 56, name: 'الواقعة', ayas: 96, type: 'مكية 🕋', aliases: ['واقعة', 'الواقعه', 'واقعه'] },
  { num: 57, name: 'الحديد', ayas: 29, type: 'مدنية 🕌', aliases: ['حديد'] },
  { num: 58, name: 'المجادلة', ayas: 22, type: 'مدنية 🕌', aliases: ['مجادلة', 'المجادله', 'مجادله', 'قد سمع'] },
  { num: 59, name: 'الحشر', ayas: 24, type: 'مدنية 🕌', aliases: ['حشر'] },
  { num: 60, name: 'الممتحنة', ayas: 13, type: 'مدنية 🕌', aliases: ['ممتحنة', 'الممتحنه', 'ممتحنه'] },
  { num: 61, name: 'الصف', ayas: 14, type: 'مدنية 🕌', aliases: ['صف', 'الحواريين'] },
  { num: 62, name: 'الجمعة', ayas: 11, type: 'مدنية 🕌', aliases: ['جمعة', 'الجمعه', 'جمعه'] },
  { num: 63, name: 'المنافقون', ayas: 11, type: 'مدنية 🕌', aliases: ['منافقون', 'المنافقين'] },
  { num: 64, name: 'التغابن', ayas: 18, type: 'مدنية 🕌', aliases: ['تغابن'] },
  { num: 65, name: 'الطلاق', ayas: 12, type: 'مدنية 🕌', aliases: ['طلاق'] },
  { num: 66, name: 'التحريم', ayas: 12, type: 'مدنية 🕌', aliases: ['تحريم', 'يا أيها النبي'] },
  { num: 67, name: 'الملك', ayas: 30, type: 'مكية 🕋', aliases: ['ملك', 'تبارك', 'المنجية', 'الواقية'] },
  { num: 68, name: 'القلم', ayas: 52, type: 'مكية 🕋', aliases: ['قلم', 'ن'] },
  { num: 69, name: 'الحاقة', ayas: 52, type: 'مكية 🕋', aliases: ['حاقة', 'الحاقه', 'حاقه'] },
  { num: 70, name: 'المعارج', ayas: 44, type: 'مكية 🕋', aliases: ['معارج', 'سأل سائل'] },
  { num: 71, name: 'نوح', ayas: 28, type: 'مكية 🕋', aliases: [] },
  { num: 72, name: 'الجن', ayas: 28, type: 'مكية 🕋', aliases: ['جن', 'قل اوحي إلي'] },
  { num: 73, name: 'المزمل', ayas: 20, type: 'مكية 🕋', aliases: ['مزمل'] },
  { num: 74, name: 'المدثر', ayas: 56, type: 'مكية 🕋', aliases: ['مدثر'] },
  { num: 75, name: 'القيامة', ayas: 40, type: 'مكية 🕋', aliases: ['قيامة', 'القيامه', 'قيامه', 'لا أقسم بيوم القيامة'] },
  { num: 76, name: 'الإنسان', ayas: 31, type: 'مدنية 🕌', aliases: ['الانسان', 'انسان', 'الدهر', 'هل أتى'] },
  { num: 77, name: 'المرسلات', ayas: 50, type: 'مكية 🕋', aliases: ['مرسلات'] },
  { num: 78, name: 'النبأ', ayas: 40, type: 'مكية 🕋', aliases: ['نبا', 'النباء', 'عم', 'عمة', 'التساؤل'] },
  { num: 79, name: 'النازعات', ayas: 46, type: 'مكية 🕋', aliases: ['نازعات'] },
  { num: 80, name: 'عبس', ayas: 42, type: 'مكية 🕋', aliases: ['الأعمى', 'الصاخة'] },
  { num: 81, name: 'التكوير', ayas: 29, type: 'مكية 🕋', aliases: ['تكوير', 'إذا الشمس كورت'] },
  { num: 82, name: 'الانفطار', ayas: 19, type: 'مكية 🕋', aliases: ['انفطار', 'إذا السماء انفطرت'] },
  { num: 83, name: 'المطففين', ayas: 36, type: 'مكية 🕋', aliases: ['مطففين', 'ويل للمطففين'] },
  { num: 84, name: 'الانشقاق', ayas: 25, type: 'مكية 🕋', aliases: ['انشقاق', 'إذا السماء انشقت'] },
  { num: 85, name: 'البروج', ayas: 22, type: 'مكية 🕋', aliases: ['بروج'] },
  { num: 86, name: 'الطارق', ayas: 17, type: 'مكية 🕋', aliases: ['طارق', 'والسماء والطارق'] },
  { num: 87, name: 'الأعلى', ayas: 19, type: 'مكية 🕋', aliases: ['الاعلى', 'اعلى', 'سبح اسم ربك'] },
  { num: 88, name: 'الغاشية', ayas: 26, type: 'مكية 🕋', aliases: ['غاشية', 'الغاشيه', 'غاشيه', 'هل أتاك'] },
  { num: 89, name: 'الفجر', ayas: 30, type: 'مكية 🕋', aliases: ['فجر', 'والفجر'] },
  { num: 90, name: 'البلد', ayas: 20, type: 'مكية 🕋', aliases: ['بلد', 'لا أقسم بهذا البلد'] },
  { num: 91, name: 'الشمس', ayas: 15, type: 'مكية 🕋', aliases: ['شمس', 'والشمس وضحاها'] },
  { num: 92, name: 'الليل', ayas: 21, type: 'مكية 🕋', aliases: ['ليل', 'والليل إذا يغشى'] },
  { num: 93, name: 'الضحى', ayas: 11, type: 'مكية 🕋', aliases: ['ضحي', 'ضحى', 'والضحى'] },
  { num: 94, name: 'الشرح', ayas: 8, type: 'مكية 🕋', aliases: ['شرح', 'الانشراح', 'الم نشرح'] },
  { num: 95, name: 'التين', ayas: 8, type: 'مكية 🕋', aliases: ['تين', 'والتين والزيتون'] },
  { num: 96, name: 'العلق', ayas: 19, type: 'مكية 🕋', aliases: ['علق', 'اقرأ', 'اقرا'] },
  { num: 97, name: 'القدر', ayas: 5, type: 'مكية 🕋', aliases: ['قدر', 'إنا أنزلناه', 'انا انزلناه'] },
  { num: 98, name: 'البينة', ayas: 8, type: 'مدنية 🕌', aliases: ['بينة', 'البينه', 'بينه', 'لم يكن'] },
  { num: 99, name: 'الزلزلة', ayas: 8, type: 'مدنية 🕌', aliases: ['زلزلة', 'الزلزله', 'زلزله', 'إذا زلزلت'] },
  { num: 100, name: 'العاديات', ayas: 11, type: 'مكية 🕋', aliases: ['عاديات', 'والعاديات'] },
  { num: 101, name: 'القارعة', ayas: 11, type: 'مكية 🕋', aliases: ['قارعة', 'القارعه', 'قارعه'] },
  { num: 102, name: 'التكاثر', ayas: 8, type: 'مكية 🕋', aliases: ['تكاثر', 'ألهاكم التكاثر'] },
  { num: 103, name: 'العصر', ayas: 3, type: 'مكية 🕋', aliases: ['عصر', 'والعصر'] },
  { num: 104, name: 'الهمزة', ayas: 9, type: 'مكية 🕋', aliases: ['همزة', 'الهمزه', 'همزه', 'ويل لكل همزة'] },
  { num: 105, name: 'الفيل', ayas: 5, type: 'مكية 🕋', aliases: ['فيل', 'ألم تر كيف'] },
  { num: 106, name: 'قريش', ayas: 4, type: 'مكية 🕋', aliases: ['لإيلاف', 'لايلاف'] },
  { num: 107, name: 'الماعون', ayas: 7, type: 'مكية 🕋', aliases: ['ماعون', 'أرأيت', 'ارايت'] },
  { num: 108, name: 'الكوثر', ayas: 3, type: 'مكية 🕋', aliases: ['كوثر', 'إنا أعطيناك', 'انا اعطيناك'] },
  { num: 109, name: 'الكافرون', ayas: 6, type: 'مكية 🕋', aliases: ['كافرون', 'قل يا أيها الكافرون', 'الجحد'] },
  { num: 110, name: 'النصر', ayas: 3, type: 'مدنية 🕌', aliases: ['نصر', 'إذا جاء نصر الله', 'التوديع'] },
  { num: 111, name: 'المسد', ayas: 5, type: 'مكية 🕋', aliases: ['مسد', 'تبت', 'اللهب'] },
  { num: 112, name: 'الإخلاص', ayas: 4, type: 'مكية 🕋', aliases: ['اخلاص', 'قل هو الله احد', 'التوحيد'] },
  { num: 113, name: 'الفلق', ayas: 5, type: 'مكية 🕋', aliases: ['فلق', 'قل اعوذ برب الفلق'] },
  { num: 114, name: 'الناس', ayas: 6, type: 'مكية 🕋', aliases: ['ناس', 'قل اعوذ برب الناس'] }
];

// 🔍 تنظيف وتطبيع النص للبحث الدقيق
export function normalizeSurahName(str) {
    if (!str) return '';
    return str.toString().toLowerCase().trim()
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // إزالة التشكيل
        .replace(/^(?:سورة|سوره)\s*/, '') // إزالة كلمة سورة
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/ئ/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/^ال/, '') // إزالة التعريف
        .replace(/[\s\-_]+/g, '');
}

// 🔎 البحث عن السورة بالاسم أو الرقم أو الأسماء الشائعة
export function findSurah(query) {
    if (!query) return null;
    const trimmed = query.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= 114) {
        return QURAN_SURAHS.find(s => s.num === num) || null;
    }

    const target = normalizeSurahName(trimmed);
    if (!target) return null;

    // 1. مطابقة تامة مع الاسم الأساسي
    let match = QURAN_SURAHS.find(s => normalizeSurahName(s.name) === target);
    if (match) return match;

    // 2. مطابقة مع الأسماء الشائعة (aliases)
    match = QURAN_SURAHS.find(s => s.aliases && s.aliases.some(a => normalizeSurahName(a) === target));
    if (match) return match;

    // 3. مطابقة بالاحتواء (بدء السورة بالاسم أو العكس)
    match = QURAN_SURAHS.find(s => {
        const normName = normalizeSurahName(s.name);
        return normName.includes(target) || target.includes(normName);
    });

    return match || null;
}

// 🌐 جلب نص آيات السورة بالرسم العثماني
export async function fetchSurahText(surahNum) {
    try {
        const res = await axios.get(`https://api.alquran.cloud/v1/surah/${surahNum}/quran-uthmani`, { timeout: 8000 });
        if (res.data?.code === 200 && res.data?.data?.ayahs) {
            return res.data.data;
        }
    } catch (_) {}

    try {
        const res2 = await axios.get(`https://api.alquran.cloud/v1/surah/${surahNum}/quran-simple`, { timeout: 8000 });
        if (res2.data?.code === 200 && res2.data?.data?.ayahs) {
            return res2.data.data;
        }
    } catch (_) {}

    return null;
}

// 🎙️ روابط التلاوة الصوتية المباشرة للشيخ محمد صديق المنشاوي (مرتل)
export function getMinshawiAudioUrls(surahNum) {
    const padded = String(surahNum).padStart(3, '0');
    return {
        primary: `https://download.quranicaudio.com/quran/muhammad_siddeeq_al-minshaawee/${padded}.mp3`,
        fallback1: `https://server11.mp3quran.net/minsh/${padded}.mp3`,
        fallback2: `https://server10.mp3quran.net/minsh/${padded}.mp3`
    };
}

// ⚡ معالجة وتنفيذ أمر القرآن كاملاً
export async function handleQuranCommand(normalizedBody, rawBody, currentConn, from, mek, handleCommandTiming) {
    // التحقق من صيغة الأمر
    const isQuranTrigger = /^(?:\.|\/|!)?(?:قران|قرآن|سورة|سوره)(?:\s|$)/i.test(normalizedBody);
    if (!isQuranTrigger) return false;

    // استخراج اسم أو رقم السورة من الرسالة
    let query = normalizedBody.replace(/^(?:\.|\/|!)?(?:قران|قرآن)\s*(?:سورة|سوره)?\s*/i, '').trim();
    if (!query && /^(?:\.|\/|!)?(?:سورة|سوره)\s+/i.test(normalizedBody)) {
        query = normalizedBody.replace(/^(?:\.|\/|!)?(?:سورة|سوره)\s*/i, '').trim();
    }

    // إذا كتب العضو فقط (قران) أو (قرآن) دون تحديد السورة
    if (!query) {
        if (typeof handleCommandTiming === 'function') await handleCommandTiming('📖');
        const guideText = 
            `╭━━━〔 📖 *القرآن الكريم بصوت الشيخ المنشاوي* 〕━━━╮\n` +
            `اكتب كلمة *(قران)* متبوعة باسم السورة أو رقمها، مثال:\n\n` +
            `• *قران سورة الكهف*\n` +
            `• *قران البقرة*\n` +
            `• *قران يس*\n` +
            `• *قران الملك*\n` +
            `• *قران يوسف*\n` +
            `• *قران مريم*\n` +
            `• *قران 18*\n\n` +
            `✨ *يرسل لك البوت:* نص السورة كاملاً للقراءة 📖 + تسجيل صوتي (فويس) خاشع لتلاوة السورة بصوت الشيخ محمد صديق المنشاوي 🎙️🤍\n` +
            `╰━━━━━━━━━━━━━━━━━━━━╯`;
        await currentConn.sendMessage(from, { text: guideText }, { quoted: mek });
        return true;
    }

    const surah = findSurah(query);
    if (!surah) {
        if (typeof handleCommandTiming === 'function') await handleCommandTiming('⚠️');
        await currentConn.sendMessage(from, { 
            text: `⚠️ لم يتم العثور على سورة باسم « *${query}* »!\n💡 برجاء التأكد من كتابة اسم السورة بشكل صحيح، مثال:\n*(قران سورة الكهف)* أو *(قران 18)*.` 
        }, { quoted: mek });
        return true;
    }

    if (typeof handleCommandTiming === 'function') await handleCommandTiming('📖');

    // 1️⃣ جلب نص آيات السورة
    const surahData = await fetchSurahText(surah.num);

    let fullAyahsText = '';
    if (surahData && Array.isArray(surahData.ayahs) && surahData.ayahs.length > 0) {
        const mapped = surahData.ayahs.map(a => {
            let t = a.text || '';
            // تنظيف البسملة المكررة تلقائياً في الآية الأولى لغير الفاتحة والتوبة
            if (surah.num !== 1 && surah.num !== 9 && a.numberInSurah === 1) {
                t = t.replace(/^بِسْمِ\s*ٱ?للَّهِ\s*ٱ?لرَّحْمَٰنِ\s*ٱ?لرَّحِيمِ\s*/, '').trim();
            }
            return `${t} ﴿${a.numberInSurah}﴾`;
        });
        fullAyahsText = mapped.join(' ');
    }

    const basmalaHeader = (surah.num !== 9 && surah.num !== 1) ? `بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\n\n` : '';

    const captionHeader = 
        `╭━━━〔 📖 *سورة ${surah.name}* 〕━━━╮\n` +
        `┃ 🏷️ *رقم السورة:* ${surah.num} من 114\n` +
        `┃ 🔢 *عدد الآيات:* ${surah.ayas} آية\n` +
        `┃ 📍 *مكان النزول:* ${surah.type}\n` +
        `┃ 🎙️ *القارئ:* الشيخ محمد صديق المنشاوي (مرتل) 🤍\n` +
        `╰━━━━━━━━━━━━━━━━━━━━╯\n\n`;

    let textMsg = '';
    if (fullAyahsText) {
        textMsg = `${captionHeader}${basmalaHeader}${fullAyahsText}\n\n🤍 *صدق الله العظيم*\n\n🎧 _جاري إرسال فويس تلاوة سورة ${surah.name} بصوت الشيخ المنشاوي الآن..._`;
    } else {
        textMsg = `${captionHeader}✨ *سورة ${surah.name} كاملة بصوت الشيخ محمد صديق المنشاوي*\n\n🎧 _جاري إرسال فويس التلاوة الآن..._`;
    }

    // إرسال النص أولاً
    await currentConn.sendMessage(from, { text: textMsg }, { quoted: mek });

    // 2️⃣ إرسال فويس تلاوة الشيخ المنشاوي مباشرة
    const audioUrls = getMinshawiAudioUrls(surah.num);
    const audioTitle = `سورة_${surah.name}_المنشاوي.mp3`;

    let audioSent = false;
    const sendAudioAttempt = async (url) => {
        return await currentConn.sendMessage(from, {
            audio: { url },
            mimetype: 'audio/mp4',
            ptt: true,
            fileName: audioTitle
        }, { quoted: mek });
    };

    try {
        await sendAudioAttempt(audioUrls.primary);
        audioSent = true;
    } catch (err1) {
        try {
            await sendAudioAttempt(audioUrls.fallback1);
            audioSent = true;
        } catch (err2) {
            try {
                await sendAudioAttempt(audioUrls.fallback2);
                audioSent = true;
            } catch (_) {}
        }
    }

    // إذا فشل الإرسال المباشر للـ PTT لأي سبب بالشبكة، يتم إرسال الرابط المباشر
    if (!audioSent) {
        await currentConn.sendMessage(from, { 
            text: `🎧 *رابط تلاوة سورة ${surah.name} بصوت الشيخ المنشاوي مباشرة:*\n${audioUrls.primary}` 
        }, { quoted: mek });
    }

    return true;
}

export default {
    QURAN_SURAHS,
    findSurah,
    fetchSurahText,
    getMinshawiAudioUrls,
    handleQuranCommand
};
