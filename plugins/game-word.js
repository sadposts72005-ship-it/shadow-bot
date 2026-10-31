// plugins/game-scramble.js
import { shadowTheme as theme } from '../core/theme.js';                               
import fs from 'fs';
import path from 'path';

// 📂 إعداد ملف التخزين المحلي الخاص باللعبة لضمان عدم ضياع النقاط
const dbPath = path.join(process.cwd(), 'scramble_db.json');

function loadLocalDB() {
    try {
        if (fs.existsSync(dbPath)) {
            return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        }
    } catch (e) {
        console.error("Error loading scramble DB:", e);
    }
    return { users: {} };
}

function saveLocalDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error("Error saving scramble DB:", e);
    }
}

// دالة للتأخير المخصص
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// دالة موحدة لعمل الريأكشن والتأخير قبل إرسال الرسائل الاستجابية
async function waitAndReact(conn, id, m) {
    await delay(1000);
    await conn.sendMessage(id, { react: { text: '🧩', key: m.key } }).catch(() => {});
    await delay(2500);
}

// 🌟 تقسيم بنك الكلمات إلى فئات محددة لمعرفتها تلقائياً
const categorizedWords = {
    'مشاهير ولاعبي كرة': [                                                      'ويجز', 'انغام', 'شيرين', 'مسلم', 'يسرا', 'شيكو', 'عفروتو', 'شاهين', 'ابيوسف', 'حكيم',                                                          'منير', 'عدوية', 'اليسا', 'اصالة', 'يارا', 'سعد', 'صلاح', 'زيزو', 'افشة', 'كهربا',
        'حجازي', 'النني', 'مرموش', 'شوبير', 'جوزيه', 'طيب', 'شلبي', 'شيبة', 'بيكا', 'رمضان',
        'عز', 'السقا', 'حلمي', 'امام', 'كرارة', 'فهمي', 'ماجد', 'رجب', 'ممدوح', 'زاهر',                                                                 'صبري', 'كمال', 'ساسا', 'بهاؤ', 'قمر', 'توفيق', 'عباس', 'حجار', 'صالح', 'طه',                                                                   'شفيقة', 'الشيخ', 'موزة', 'ظاظا', 'الجوكر', 'ماجد', 'وهبي', 'علامة', 'وسوف', 'الساهر',
        'كرم', 'زغبي', 'فارس', 'شاكر', 'زين', 'عطية', 'فواز', 'صاوي', 'نبوي', 'لطفي',
        'سمرة', 'رزق', 'بدير', 'حسني', 'شعبان', 'ياسين', 'شريف', 'زكي', 'صالح', 'شلبي',                                                                 'غانم', 'راتب', 'عدل', 'فهمي', 'مليجي', 'شوقي', 'دقن', 'ادهم', 'روستي', 'رستم',
        'مظهر', 'سرحان', 'اباظة', 'شريف', 'نابلسي', 'ياسين', 'صدقي', 'منيب', 'رزق', 'شادية'                                                         ],
    'حيوانات وطيور وزواحف': [
        'اسد', 'نمر', 'فهد', 'زرافة', 'فيل', 'تمساح', 'ثعلب', 'صقر', 'نسر', 'عصفور',
        'ذئب', 'حصان', 'جمل', 'خروف', 'ماعز', 'بقر', 'ارنب', 'كلب', 'قطة', 'فأر',                                                                       'سنجاب', 'قرد', 'دب', 'بطريق', 'نعامة', 'بومة', 'غراب', 'حمام', 'بطة', 'وزة',
        'دجاجة', 'ديك', 'ثعبان', 'عقرب', 'سلحفاه', 'ضفدع', 'حوت', 'قرش', 'دولفين', 'سمكة',
        'بغبغاء', 'هدهد', 'غزال', 'كنغر', 'كوالا', 'باندا', 'خفاش', 'حمار', 'بغل', 'ثور',
        'عجل', 'جاموس', 'سحلية', 'برص', 'حرباء', 'ضب', 'كوبرا', 'افعى', 'ورل', 'طاووس',
        'بجع', 'لقلق', 'بلبل', 'شحرور', 'طيار', 'نملة', 'نحلة', 'دبور', 'ذبابة', 'ناموسة',
        'جرادة', 'صرصور', 'عنكبوت', 'خنفساء', 'فراشة', 'يعسوب', 'يرقة', 'شرنقة', 'دودة', 'علقة',
        'قملة', 'برغوث', 'قراد', 'سوسة', 'رنة', 'ايل', 'وعل', 'تيس', 'شبل', 'خرتيت',
        'فقمة', 'قندس', 'قنفذ', 'نيص', 'ظربان', 'راكون', 'فنك', 'ضبع', 'وشق', 'ببر',
        'بابون', 'مكاك', 'ليمور', 'كسلان', 'مدرع', 'سمان', 'إيمو', 'كيوي', 'طنان', 'باشق',
        'حدأة', 'عقاب', 'نورس', 'غواص', 'كروان', 'بلطي', 'بوري', 'تونة', 'سلمون', 'سردين',
        'كابوريا', 'محار', 'قوقع', 'حلزون', 'حبار', 'سبيط', 'سلور', 'جرذ', 'هامستر', 'يمام'
    ],
    'نباتات وفواكه وخضروات': [                                                  'فراولة', 'بطيخ', 'مانجو', 'تفاح', 'موز', 'برتقال', 'خوخ', 'مشمش', 'برقوق', 'عنب',
        'تين', 'رمان', 'جوافة', 'كمثرى', 'اناناس', 'كيوي', 'كرز', 'تمر', 'طماطم', 'خيار',
        'جزر', 'بطاطس', 'بصل', 'ثوم', 'بسلة', 'بامية', 'ملوخية', 'كرنب', 'قرنبيط', 'باذنجان',
        'فلفل', 'خس', 'جرجير', 'بقدونس', 'كزبرة', 'نعناع', 'شبت', 'ليمون', 'زيتون', 'مشروم',
        'فجل', 'لفت', 'بنجر', 'قلقاس', 'كوسة', 'سبانخ', 'ذرة', 'شجرة', 'ياسمين', 'ورد',
        'فل', 'نرجس', 'ريحان', 'توليب', 'ارز', 'قمح', 'شعير', 'برسيم', 'قصب', 'قطن',
        'كتان', 'كنف', 'تبغ', 'بن', 'شاي', 'كاكاو', 'يوسفي', 'لارنج', 'نبق', 'دوم',
        'خروب', 'حرنكش', 'قشطة', 'بابايا', 'عجوة', 'كرات', 'سلق', 'خبيزة', 'هندباء', 'شطة',
        'بروكلي', 'لوبيا', 'عدس', 'حمص', 'ترمس', 'حلبة', 'سمسم', 'زعتر', 'كركم', 'قرفة',                                                                'كمون', 'نخلة', 'جميز', 'توت', 'صنوبر', 'بلوط', 'سنديان', 'بامبو', 'حلفا', 'بوص',
        'بردية', 'بنفسج', 'لافندر', 'خزامى', 'صبار', 'سدر', 'كافور', 'لوتس', 'زنبق', 'طحالب',
        'كمأة', 'فطر', 'كاجو', 'لوز', 'بندق', 'فسدق', 'جوز', 'قسطل', 'فول', 'بطاطا'
    ],
    'جماد وأدوات وملابس': [
        'قلم', 'ساعة', 'كرسي', 'كنبة', 'سرير', 'دولاب', 'مكتب', 'شباك', 'باب', 'ستارة',
        'سجادة', 'نجفة', 'مصباح', 'ثلاجة', 'خلاط', 'كاتل', 'مكواة', 'مكنسة', 'طبق', 'معلقة',
        'شوكة', 'سكينة', 'شنطة', 'محفظة', 'نظارة', 'مفتاح', 'قفل', 'كشكول', 'كتاب', 'مسطرة',
        'براية', 'الوان', 'لوحة', 'شاحن', 'سماعة', 'شمسية', 'مراية', 'تابلت', 'سخان', 'كيسة',
        'شاشة', 'ماوس', 'راوتر', 'راديو', 'كاسيت', 'رف', 'اباجورة', 'فازة', 'تابلوه', 'برواز',
        'مفضة', 'طفاءة', 'ولاعة', 'مقص', 'دباسة', 'خرامة', 'صمغ', 'شاكوش', 'كماشة', 'مفك',
        'منشار', 'بنسة', 'متر', 'ميزان', 'رولة', 'سلم', 'حبل', 'سلك', 'مشترك', 'فيشة',                                                                  'بنطلون', 'قميص', 'تيشرت', 'جاكيت', 'بلوفر', 'فيست', 'بليزر', 'بدلة', 'فستان', 'جيب',
        'عباءة', 'ترنج', 'بيجامة', 'جلابية', 'شورت', 'كاب', 'كوفية', 'جوانتي', 'شراب', 'حذاء',
        'كوتشي', 'شبشب', 'صندل', 'بوت', 'حزام', 'مفرش', 'ملاية', 'لحاف', 'بطانية', 'مخدة',
        'فوطة', 'بشكير', 'برنس', 'مشط', 'صابونة', 'شامبو', 'ليفة', 'توكة', 'دبوس', 'مكياج',
        'عطر', 'اسبراي', 'كريم', 'فازلين', 'شفرة', 'مكنة', 'سيارة', 'اتوبيس', 'توكتوك', 'عجلة',                                                         'طيارة', 'سفينة', 'مركب', 'قطار', 'مترو', 'ترام', 'جرار', 'ونش', 'صاروخ', 'دبابة',
        'مدفع', 'بندقية', 'طبنجة', 'خرطوش', 'سيف', 'درع', 'خوذة', 'عوامة', 'مرجحة', 'زحليقة',
        'كرة', 'مضرب', 'شبكة', 'صفارة', 'كأس', 'مروحة', 'موبايل', 'تكييف', 'كيبورد', 'مسامير'
    ],
    'أكلات ومشروبات': [
        'كشري', 'رقاق', 'كباب', 'كفتة', 'بيتزا', 'برجر', 'كريب', 'بانيه', 'رنجة', 'فسيخ',
        'سجق', 'ارز', 'شوربة', 'سلطة', 'مخلل', 'شاي', 'قهوة', 'عصير', 'بيبسي', 'مانجا',
        'ممبار', 'كرشة', 'فشة', 'كوارع', 'طحال', 'تكا', 'تورلي', 'لوبيا', 'بصارة', 'كشك',
        'عجة', 'بيض', 'عسل', 'طحينة', 'مش', 'قشطة', 'امعلي', 'غريبة', 'كحك', 'بيتفور',
        'منين', 'عزيزية', 'مهلبية', 'جيلو', 'سحلب', 'سوبيا', 'قصب', 'ينسون', 'نعناع'
    ],
    'مدن وجغرافيا': [                                                           'طنطا', 'دمياط', 'مصر', 'بنها', 'سيوة', 'الطور', 'مطروح', 'السلوم', 'الضبعة', 'الرحاب',
        'مدينتي', 'الهرم', 'فيصل', 'الدقي', 'حلوان', 'شبرا', 'مترو', 'النيل', 'ناصر', 'قارون',
        'جمصة', 'القاهرة', 'الجيزة', 'الاقصر', 'اسوان', 'السويس', 'الفيوم', 'المنيا', 'اسيوط',
        'سوهاج', 'قنا'
    ]                                                                   };

const wordsBank = Object.values(categorizedWords).flat();
const timeout = 120000; // ⏱️ تم تعديل الوقت هنا ليصبح دقيقتين (120 ثانية)

function getCategoryOfWord(word) {
    for (let category in categorizedWords) {
        if (categorizedWords[category].includes(word)) {
            return category;
        }
    }
    return 'عامة';
}                                                                       
function scrambleWord(word) {
    let cleanWord = word.replace(/\s+/g, '');
    let shuffled = cleanWord.split('').sort(() => Math.random() - 0.5).join('   ');                                                                 return shuffled;
}

function normalizeArabic(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}

function makeHint(word) {                                                   let clean = word.replace(/\s+/g, '');
    if (clean.length <= 3) return `${clean[0]} * *`;
    let start = clean.slice(0, 2);
    let end = clean.slice(-1);
    let middle = '*'.repeat(clean.length - 3);
    return `${start}${middle}${end}`;
}

const handler = async (m, conn) => {
    conn.scramble = conn.scramble || {};
    conn.playedWords = conn.playedWords || [];

    let id = m.key.remoteJid;
    let cleanId = id.endsWith('@lid') ? id.replace('@lid', '@s.whatsapp.net') : id;

    let rawSender = m.key.participant || m.key.remoteJid;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let normalizedBody = normalizeArabic(body);
                                                                            let localDB = loadLocalDB();
    if (!localDB.users[sender]) {
        localDB.users[sender] = { points: 0, hintsCount: 0, lastHintTime: 0 };
    }                                                                       let userGameData = localDB.users[sender];

    if (normalizedBody === 'شراء تلميح') {                                      if (!userGameData.points || userGameData.points < 5000) {
            await waitAndReact(conn, id, m);
            return await conn.sendMessage(id, { text: `❌ رصيدك مش كفاية يا بطل! محتاج 5000 نقطة. (رصيدك الحالي: ${userGameData.points || 0})` }, { quoted: m });
        } else {
            userGameData.points -= 5000;                                            userGameData.hintsCount = 0;
            userGameData.lastHintTime = Date.now();                     
            saveLocalDB(localDB);
            await waitAndReact(conn, id, m);
            return await conn.sendMessage(id, { text: '✅ مبروك! تم خصم 5000 نقطة وتجديد الـ 6 تلميحات ليك. فكر براحتك! 😉' }, { quoted: m });
        }                                                                   }
                                                                            
    if (conn.scramble[cleanId]) {
        await waitAndReact(conn, id, m);
        return conn.sendMessage(id, { text: theme.build([                           { type: 'title', text: '⚠️ تـنـبـيـه' },
            { type: 'subtitle', text: 'هناك كلمة لم يتم حلها بعد في هذا الشات! اكتب "تلميح رتب" أو "غلب حماري" إن كنت لا تعرفها.' }
        ]) }, { quoted: m });
    }                                                                   
    let availableWords = wordsBank.filter(w => !conn.playedWords.includes(w));
    if (availableWords.length === 0) {
        conn.playedWords = [];
        availableWords = wordsBank;
    }

    let correctWord = availableWords[Math.floor(Math.random() * availableWords.length)];
    let scrambledLetters = scrambleWord(correctWord);
    let wordCategory = getCategoryOfWord(correctWord);

    conn.playedWords.push(correctWord);

    conn.scramble[cleanId] = {
        correct: correctWord,
        category: wordCategory,
        timer: setTimeout(async () => {
            if (conn.scramble[cleanId]) {
                await conn.sendMessage(id, { text: theme.build([
                    { type: 'title', text: '⏰ انـتـهى الـوقـت' },
                    { type: 'subtitle', text: 'محدش عرف يجمع الكلمة صح في خلال دقيقتين! 😴' },
                    { type: 'divider' },
                    { type: 'info', label: 'الكلمة الصحيحة كانت', value: correctWord },
                    { type: 'line', text: 'اكتب "رتب" لتجربة كلمة جديدة' }
                ]) });
                delete conn.scramble[cleanId];
            }
        }, timeout)
    };

    await waitAndReact(conn, id, m);
    await conn.sendMessage(id, { text: theme.build([
        { type: 'title', text: '🧩 لـعـبـة رتـب الـحـروف 🧩' },
        { type: 'subtitle', text: 'اجمع الحروف دي عشان تكوّن الكلمة الصح' },
        { type: 'divider' },
        { type: 'info', label: 'الحروف المبعثرة', value: `[  ${scrambledLetters}  ]` },
        { type: 'divider' },
        { type: 'line', text: '⏱️ الوقت: 2 دقيقة | 🎁 الجائزة: 300 نقطة' },
        { type: 'line', text: `💡 التلميح المباشر للكلمة: من فئة ( ${wordCategory} )` },
        { type: 'line', text: '💡 لطلب تلميح حروف اكتب: تلميح رتب 💡' },
        { type: 'line', text: '💡 للاستسلام اكتب: غلب حماري 🛑' }
    ]) }, { quoted: m });
};

handler.before = async (m, conn) => {
    conn.scramble = conn.scramble || {};
    let id = m.key.remoteJid;
    let cleanId = id.endsWith('@lid') ? id.replace('@lid', '@s.whatsapp.net') : id;

    let rawSender = m.key.participant || m.key.remoteJid;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    if (!body) return false;
    let normalizedBody = normalizeArabic(body);

    if (normalizedBody === 'كيف لعب رتب') {
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: theme.build([                     
            { type: 'title', text: '📖 دليـل لعبـة رتـب الـحـروف الـشـامـل 📖' },
            { type: 'subtitle', text: 'شرح تفصيلي لكل الأنظمة والميزات وطريقة التشغيل:' },
            { type: 'divider' },
            { type: 'line', text: '🎮 *1. آلية وبدء الجولة:*' },
            { type: 'line', text: '• اكتب أمر ( رتب ) أو ( ترتيب ) في الشات لتوليد كلمة عشوائية مبعثرة.' },
            { type: 'line', text: '• يقوم البوت بسحب كلمة عشوائية من 6 فئات مختلفة مقسمة بدقة ويقوم بخلط حروفها بمسافات عريضة.' },
            { type: 'line', text: '• مدة الجولة هي ( 2 دقيقة ) فقط، إذا لم يقم أحد بحلها بالوقت المحدد تنتهي الجولة تلقائياً ويتم كشف الإجابة.' },
            { type: 'spacer' },
            { type: 'line', text: '🧠 *2. طريقة التخمين والذكاء:*' },
            { type: 'line', text: '• أرسل ترتيب الكلمة الصحيح مباشرة في الشات كرسالة عادية بدون أوامر أو علامات.' },
            { type: 'line', text: '• البوت مدمج بنظام معالجة لغوية ذكي يتجاهل الهمزات والفروقات بين (هـ / ة) و (ى / ي) لتسهيل اللعب.' },
            { type: 'spacer' },
            { type: 'line', text: '💡 *3. نظام التلميحات المتقدم ومحددات الاستخدام:*' },
            { type: 'line', text: '• عند كتابة ( تلميح رتب ): يكشف البوت تصميماً ذكياً يوضح أول حرفين وآخر حرف من الكلمة الأصلية.' },
            { type: 'line', text: '• لكل لاعب ( 6 تلميحات مجانية ) فقط كل ساعة يتم تصفيرها تلقائياً بعد مرور 60 دقيقة.' },
            { type: 'line', text: '• في حال نفاد تلميحاتك قبل انتهاء الساعة، يمكنك كتابة أمر ( شراء تلميح ) لشراء 6 تلميحات جديدة فوراً مقابل ( 5000 نقطة ) من رصيدك.' },
            { type: 'spacer' },
            { type: 'line', text: '🛑 *4. الاستسلام والإلغاء:*' },
            { type: 'line', text: '• اكتب ( غلب حماري ): للاستسلام، يقوم البوت بإلغاء المؤقت وإظهار الكلمة فوراً بنبرة فكاهية.' },
            { type: 'line', text: '• اكتب ( الغاء رتب ): لإنهاء الجولة تماماً من الجروب دون كشف الكلمة لتطهير الكاش.' },
            { type: 'spacer' },
            { type: 'line', text: '🪙 *5. الجوائز والتخزين المحلي:*' },
            { type: 'line', text: '• أسرع لاعب يكتب الإجابة الصحيحة يفوز بـ ( 300 نقطة ).' },
            { type: 'line', text: '• اللعبة مرتبطة بملف كاش مستقل لضمان حفظ الرصيد بأمان حتى بعد ريستارت البوت.' }
        ]) }, { quoted: m });
        return true;
    }

    if (!conn.scramble[cleanId]) return false;

    let cleanSenderNumber = sender.replace(/[^0-9]/g, '');
    const isHajj = cleanSenderNumber.includes('194961618301016'); 

    let localDB = loadLocalDB();
    if (!localDB.users[sender]) {
        localDB.users[sender] = { points: 0, hintsCount: 0, lastHintTime: 0 };
    }
    let userGameData = localDB.users[sender];

    if (normalizedBody === 'تلميح رتب') {
        let now = Date.now();                                                   let oneHour = 60 * 60 * 1000;

        if (now - (userGameData.lastHintTime || 0) >= oneHour) {                    userGameData.hintsCount = 0;
        }

        if ((userGameData.hintsCount || 0) >= 6 && !isHajj) {
            let timeLeft = Math.ceil((oneHour - (now - userGameData.lastHintTime)) / (60 * 1000));
            let canBuy = (userGameData.points >= 5000);

            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: theme.build([
                { type: 'title', text: '🛑 تـلـمـيـحـاتـك خـلصـت' },
                { type: 'subtitle', text: `استخدمت الـ 6 تلميحات المتاحة ليك يا بطل.` },
                { type: 'divider' },
                { type: 'line', text: `⏱️ هتتجدد تلقائياً بعد: ${timeLeft} دقيقة.` },
                { type: 'line', text: `💰 رصيدك الحالي في اللعبة: ${userGameData.points || 0} نقطة.` },
                { type: 'divider' },
                { type: 'line', text: canBuy ? '✅ تقدر تشتري 6 تلميحات جديدة بـ 5000 نقطة!' : '❌ محتاج 5000 نقطة عشان تشتري تلميحات جديدة.' },
                { type: 'line', text: canBuy ? '💡 اكتب ( شراء تلميح ) لتأكيد العملية.' : '' }
            ]) }, { quoted: m });                                                   return true;
        }                                                               
        
        userGameData.hintsCount = (userGameData.hintsCount || 0) + 1;
        if (userGameData.hintsCount === 1) {
            userGameData.lastHintTime = now;
        }

        let hintWord = makeHint(conn.scramble[cleanId].correct);
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: theme.build([
            { type: 'title', text: '💡 تـلـمـيـح ذـكـي 💡' },
            { type: 'subtitle', text: isHajj ? '👑 لأجل عيون بابا المجال الحج التلميحات مفتوحة ليك مجاناً!' : 'قربنا المسافة شوية، فكر يالا!' },
            { type: 'divider' },
            { type: 'info', label: 'شكل الكلمة', value: hintWord },
            { type: 'line', text: isHajj ? '🔄 تلميحاتك المتبقية: ∞' : `🔄 تلميحاتك المتبقية للساعة الحالية: ${6 - userGameData.hintsCount}` }
        ]) }, { quoted: m });

        saveLocalDB(localDB);                                                   return true;
    }

    if (normalizedBody === 'الغاء رتب') {
        clearTimeout(conn.scramble[cleanId].timer);
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: theme.build([
            { type: 'title', text: '❌ تـم الإلـغـاء' },
            { type: 'subtitle', text: 'تم إلغاء جولة رتب الحروف الحالية بنجاح 👍' }
        ]) }, { quoted: m });
        delete conn.scramble[cleanId];
        return true;
    }

    if (normalizedBody === 'غلب حماري') {
        let correctWord = conn.scramble[cleanId].correct;
        clearTimeout(conn.scramble[cleanId].timer);
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: theme.build([
            { type: 'title', text: '🤣 غـلـب حـمـارك ؟' },
            { type: 'subtitle', text: 'يا عيني.. المخ هنج والذكاء انتحر! 🧠💀' },
            { type: 'divider' },
            { type: 'info', label: 'الكلمة الصحيحة كانت', value: correctWord },
            { type: 'line', text: 'يالا مش مهم.. اكتب "رتب" وجرب حظك تاني!' }
        ]) }, { quoted: m });                                                   delete conn.scramble[cleanId];
        return true;
    }                                                                   
    
    let playerAnswer = normalizedBody;
    let botAnswer = normalizeArabic(conn.scramble[cleanId].correct);
                                                                            if (playerAnswer === botAnswer) {
        clearTimeout(conn.scramble[cleanId].timer);
        
        let finalPointsOutput;
        if (isHajj) {
            finalPointsOutput = '1,000,000,000 👑';
        } else {
            userGameData.points = (userGameData.points || 0) + 300;
            finalPointsOutput = `${userGameData.points} نقطة`;
            saveLocalDB(localDB);
        }

        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: theme.build([                            { type: 'title', text: '✅ إجـابـة صـحـيـحـة' },
            { type: 'subtitle', text: isHajj ? '👑 بابا المجال الحج قفل اللعبة بذكائه الملكي!' : `كفو يا فنان! جمّعت الكلمة صح 🎉` },                                                                                   { type: 'divider' },
            { type: 'info', label: 'الكلمة', value: conn.scramble[cleanId].correct },
            { type: 'info', label: 'جائزتك', value: isHajj ? 'فخامة ملكية ✨' : '+300 نقطة' },                  { type: 'info', label: 'إجمالي نقاطك', value: finalPointsOutput }
        ]) }, { quoted: m });

        delete conn.scramble[cleanId];                                          return true;
    }
                                                                            return false;
};

handler.command = /^(رتب|ترتيب|كيف لعب رتب|شراء تلميح)$/i;
export default handler;
