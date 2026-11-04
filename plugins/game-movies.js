// plugins/game-movies.js
import fs from 'fs';
import path from 'path';

// ⏱️ دالة تأخير لمنع الحظر
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 📂 قاعدة الأفلام العربية والمصرية الحديثة (2018 - 2026) مع الإفيهات الصوتية المغيرة
const moviesList = [
    {
        id: 'movie_01',
        name: 'كازابلانكا',
        aliases: ['كازابلانكا', 'كازبلانكا', 'فيلم كازابلانكا'],
        year: '2019',
        actors: 'أمير كرارة، غادة عادل، إياد نصار، عمرو عبد الجليل',
        quote: 'هنا هركبكم المرجوحة.. كازابلانكا دي مش بتاعتكم!'
    },
    {
        id: 'movie_02',
        name: 'ولاد رزق 2',
        aliases: ['ولاد رزق 2', 'ولاد رزق', 'اولاد رزق', 'اولاد رزق 2', 'ولاد رزق عودة اسود الارض'],
        year: '2019',
        actors: 'أحمد عز، عمرو يوسف، أحمد الفيشاوي، أحمد داود',
        quote: 'لو على الشر الشر مبدأ.. عينك على رزقك يا صاحبي!'
    },
    {
        id: 'movie_03',
        name: 'ولاد رزق 3',
        aliases: ['ولاد رزق 3', 'ولاد رزق القاضية', 'اولاد رزق 3', 'القاضية'],
        year: '2024',
        actors: 'أحمد عز، عمرو يوسف، كريم قاسم، آسر ياسين',
        quote: 'القاضية ممكن.. القاضية جاية جاية يا رضا متقلقش!'
    },
    {
        id: 'movie_04',
        name: 'الفيل الأزرق 2',
        aliases: ['الفيل الازرق 2', 'الفيل الأزرق 2', 'الفيل الازرق', 'الفيل الأزرق'],
        year: '2019',
        actors: 'كريم عبد العزيز، نيللي كريم، هند صبري، إياد نصار',
        quote: 'لا تخافوا ولكن احذروا.. فريدة مش مظلومة يا دكتور يحيى!'
    },
    {
        id: 'movie_05',
        name: 'الممر',
        aliases: ['الممر', 'فيلم الممر', 'ممر'],
        year: '2019',
        actors: 'أحمد عز، إياد نصار، أحمد رزق، أحمد فلوكس، محمد فراج',
        quote: 'اقف مكانك.. انت في أرض مصر ومش هتخرج منها حي!'
    },
    {
        id: 'movie_06',
        name: 'البدلة',
        aliases: ['البدلة', 'البدله', 'فيلم البدلة', 'بدلة'],
        year: '2018',
        actors: 'تامر حسني، أكرم حسني، أمينة خليل، ماجد المصري',
        quote: 'احنا مش ظباط بجد يا فقر.. دي كانت حفلة تنكرية والبدلة لبستنا!'
    },
    {
        id: 'movie_07',
        name: 'نادي الرجال السري',
        aliases: ['نادي الرجال السري', 'نادى الرجال السري', 'نادي الرجال'],
        year: '2019',
        actors: 'كريم عبد العزيز، غادة عادل، ماجد الكدواني، نسرين طافش',
        quote: 'الخيانة مش طبع.. الخيانة أسلوب حياة يا دكتور أدهم!'
    },
    {
        id: 'movie_08',
        name: 'وقفة رجالة',
        aliases: ['وقفة رجالة', 'وقفه رجاله', 'وقفة رجاله'],
        year: '2021',
        actors: 'ماجد الكدواني، بيومي فؤاد، سيد رجب، شريف دسوقي',
        quote: 'العمر عدى وإحنا لسه بنفكر نعيش.. يلا بينا نسافر الجونة نغير جو!'
    },
    {
        id: 'movie_09',
        name: 'العارف',
        aliases: ['العارف', 'فيلم العارف', 'عارف'],
        year: '2021',
        actors: 'أحمد عز، أحمد فهمي، مصطفى خاطر، محمود حميدة',
        quote: 'الحرب مبقتش سلاح.. الحرب بقت كليك وماوس والعارف هو اللي هيكسب!'
    },
    {
        id: 'movie_10',
        name: 'مش أنا',
        aliases: ['مش انا', 'مش أنا', 'فيلم مش انا'],
        year: '2021',
        actors: 'تامر حسني، حلا شيحة، ماجد الكدواني، سوسن بدر',
        quote: 'إيدي مش سامعة كلامي وبتضرب الناس لوحدها يا دكتور!'
    },
    {
        id: 'movie_11',
        name: 'واحد تاني',
        aliases: ['واحد تاني', 'فيلم واحد تاني'],
        year: '2022',
        actors: 'أحمد حلمي، روبي، سيد رجب، عمرو عبد الجليل',
        quote: 'الشغف طار ومبقاش موجود.. محتاج اللبوسة المضيئة عشان ارجع تاني!'
    },
    {
        id: 'movie_12',
        name: 'كيرة والجن',
        aliases: ['كيرة والجن', 'كيره والجن', 'كيره والجين', 'كيرة والجين'],
        year: '2022',
        actors: 'كريم عبد العزيز، أحمد عز، هند صبري، سيد رجب',
        quote: 'الدم بالدم.. والبلد دي هتنضف من الإنجليز على إيدنا يا جن!'
    },
    {
        id: 'movie_13',
        name: 'عمهم',
        aliases: ['عمهم', 'فيلم عمهم'],
        year: '2022',
        actors: 'محمد إمام، محمد سلام، هدى المفتي، باسم سمرة',
        quote: 'الشيطان شاطر.. بس عمهم أشطر بكتير!'
    },
    {
        id: 'movie_14',
        name: 'بحبك',
        aliases: ['بحبك', 'فيلم بحبك'],
        year: '2022',
        actors: 'تامر حسني، هنا الزاهد، هدى المفتي، حمدي الميرغني',
        quote: 'أنا مش هسيبك حتى لو العالم كله وقف ضدنا.. أنا بحبك بجد!'
    },
    {
        id: 'movie_15',
        name: 'من أجل زيكو',
        aliases: ['من اجل زيكو', 'من أجل زيكو', 'زيكو'],
        year: '2022',
        actors: 'كريم محمود عبد العزيز، منة شلبي، محمد محمود',
        quote: 'الغزالة رايقة وما الناس الحلوة سايقة.. يلا يا زيكو على المسابقة!'
    },
    {
        id: 'movie_16',
        name: 'بيت الروبي',
        aliases: ['بيت الروبي', 'الروبي', 'بيت روبي'],
        year: '2023',
        actors: 'كريم عبد العزيز، كريم محمود عبد العزيز، نور، تارا عماد',
        quote: 'إحنا مش بتوع تريندات وفيديوهات.. إحنا عيلة الروبي البسيطة!'
    },
    {
        id: 'movie_17',
        name: 'تاج',
        aliases: ['تاج', 'فيلم تاج'],
        year: '2023',
        actors: 'تامر حسني، دينا الشربيني، عمرو عبد الجليل',
        quote: 'أنا سوبر هيرو وبطير بس مش لاقي آكل يا عمي!'
    },
    {
        id: 'movie_18',
        name: 'مستر إكس',
        aliases: ['مستر اكس', 'مستر إكس', 'مستر x'],
        year: '2023',
        actors: 'أحمد فهمي، هنا الزاهد، أوس أوس، بيومي فؤاد',
        quote: 'الفكرة مش في الطلاق.. الفكرة إزاي تخلع بشياكة يا رجالة!'
    },
    {
        id: 'movie_19',
        name: 'أبو نسب',
        aliases: ['ابو نسب', 'أبو نسب', 'فيلم ابو نسب'],
        year: '2023',
        actors: 'محمد إمام، ياسمين صبري، ماجد الكدواني',
        quote: 'أنا متجوز دكتورة أطفال ولا متجوز زعيم عصابة مافيا وسوابق؟!'
    },
    {
        id: 'movie_20',
        name: 'الإسكندراني',
        aliases: ['الاسكندراني', 'الإسكندراني', 'اسكندراني'],
        year: '2024',
        actors: 'أحمد العوضي، زينة، حسين فهمي، بيومي فؤاد',
        quote: 'الإسكندراني لما بيحضر الكل يركن على جنب ويسكت خالص!'
    },
    {
        id: 'movie_21',
        name: 'الحريفة',
        aliases: ['الحريفة', 'الحريفه', 'فيلم الحريفة', 'حريفة'],
        year: '2024',
        actors: 'نور النبوي، كزبرة، أحمد حسام ميدو، خالد الذهبي',
        quote: 'الكورة مش لعب عيال.. الكورة حياتنا والبطولة بتاعتنا يا شلة ماجد!'
    },
    {
        id: 'movie_22',
        name: 'فاصل من اللحظات اللذيذة',
        aliases: ['فاصل من اللحظات اللذيذة', 'فاصل من اللحظات اللذيذه', 'فاصل من اللحظات'],
        year: '2024',
        actors: 'هشام ماجد، هنا الزاهد، محمد ثروت، بيومي فؤاد',
        quote: 'إيه البوابة الغريبة دي اللي بتودينا لعالم تاني أحسن من عيشتنا!'
    },
    {
        id: 'movie_23',
        name: 'عصابة الماكس',
        aliases: ['عصابة الماكس', 'عصابه الماكس', 'الماكس', 'المكسيكي'],
        year: '2024',
        actors: 'أحمد فهمي، لبلبة، روبي، أوس أوس، حاتم صلاح',
        quote: 'السرقة محتاجة عيلة.. مش أي شلة وخلاص مع المكسيكي!'
    },
    {
        id: 'movie_24',
        name: 'أكس مراتي',
        aliases: ['اكس مراتي', 'أكس مراتي', 'طليق مراتي'],
        year: '2024',
        actors: 'هشام ماجد، أمينة خليل، محمد ممدوح',
        quote: 'أنا دكتور نفسي بس طليقك مجنون رسمي وهيقتلنا كلنا يا مدام!'
    },
    {
        id: 'movie_25',
        name: 'اللعب مع العيال',
        aliases: ['اللعب مع العيال', 'لعب مع العيال', 'فيلم اللعب مع العيال'],
        year: '2024',
        actors: 'محمد إمام، باسم سمرة، أسماء جلال، بيومي فؤاد',
        quote: 'أنا مدرس تاريخ في شرم الشيخ.. ودوني مدرسة في الصحراء مع البدو!'
    },
    {
        id: 'movie_26',
        name: 'أهل الكهف',
        aliases: ['اهل الكهف', 'أهل الكهف', 'فيلم اهل الكهف'],
        year: '2024',
        actors: 'خالد النبوي، غادة عادل، محمد ممدوح، محمد فراج',
        quote: 'نِمنا كام سنة وصحينا لقينا العالم كله اتغير ومحدش يعرفنا ولا نعرفه!'
    },
    {
        id: 'movie_27',
        name: 'حرب كرموز',
        aliases: ['حرب كرموز', 'فيلم حرب كرموز'],
        year: '2018',
        actors: 'أمير كرارة، محمود حميدة، غادة عبد الرازق، سكوت أدكينز',
        quote: 'الجنرال يوسف المصري مبيسلّمش ولاده للإنجليز يا كلاب!'
    },
    {
        id: 'movie_28',
        name: '122',
        aliases: ['122', 'مية اتنين وعشرين', 'مية اتنين وعشرين', 'ميه اتنين وعشرين', 'فيلم 122'],
        year: '2019',
        actors: 'أحمد داود، طارق لطفي، أمينة خليل، أحمد الفيشاوي',
        quote: 'المستشفى دي مقبرة للأعضاء البشرية.. مفيش مريض بيخرج منها سليم!'
    },
    {
        id: 'movie_29',
        name: 'تراب الماس',
        aliases: ['تراب الماس', 'فيلم تراب الماس'],
        year: '2018',
        actors: 'آسر ياسين، منة شلبي، ماجد الكدواني، إياد نصار',
        quote: 'الفساد ليه علاج واحد بس.. نقطة سحرية تخلص على الوساخة وتطهر البلد!'
    },
    {
        id: 'movie_30',
        name: 'لص بغداد',
        aliases: ['لص بغداد', 'فيلم لص بغداد'],
        year: '2020',
        actors: 'محمد إمام، ياسمين رئيس، فتحي عبد الوهاب، أمينة خليل',
        quote: 'مقبرة الإسكندر الأكبر مش أي حد يوصلها.. دي لعبة ذكاء وسرعة ومغامرة!'
    }
];

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

function makeMaskedHint(word) {
    let clean = word.replace(/\s+/g, '');
    if (clean.length <= 3) return `${clean[0]} * *`;
    let res = '';
    for (let i = 0; i < clean.length; i++) {
        if (i === 0 || i === Math.floor(clean.length / 2) || i === clean.length - 1) {
            res += clean[i] + ' ';
        } else {
            res += '* ';
        }
    }
    return res.trim();
}

function addPointsToUser(senderJid, amount, pushName = 'بطل الأفلام') {
    const dbPath = path.join(process.cwd(), 'scramble_db.json');
    let db = { users: {} };
    try {
        if (fs.existsSync(dbPath)) db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (_) {}
    if (!db.users) db.users = {};

    const cleanSender = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const standardJid = cleanSender + '@s.whatsapp.net';
    const mappedLid = db.lidMap?.[cleanSender];

    let userKey = standardJid;
    if (db.users[standardJid]) userKey = standardJid;
    else if (mappedLid && db.users[mappedLid + '@s.whatsapp.net']) userKey = mappedLid + '@s.whatsapp.net';
    else if (db.users[cleanSender]) userKey = cleanSender;

    if (!db.users[userKey]) {
        db.users[userKey] = {
            name: pushName || 'عضو شادو',
            age: 'غير محدد',
            status: 'غير محدد',
            bio: 'لا يوجد بايو حالياً',
            points: 1000,
            level: 1,
            joinedAt: new Date().toLocaleDateString('ar-EG'),
            hasRegistered: false,
            isInfinite: false
        };
    }

    const userData = db.users[userKey];
    if (userData.isInfinite) return 'لا نهائي';

    userData.points = (userData.points || 0) + amount;
    userData.level = Math.max(1, Math.floor((userData.points || 0) / 2500) + 1);

    try {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error('Error saving scramble_db in game-movies:', err);
    }

    return userData.points;
}

const timeoutDuration = 60000; // 60 ثانية

const handler = async (m, conn) => {
    conn.movies = conn.movies || {};

    let id = m.key.remoteJid;
    let cleanId = id.endsWith('@lid') ? id.replace('@lid', '@s.whatsapp.net') : id;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let normalizedBody = normalizeArabic(body);

    let rawSender = m.sender || m.key.participant || m.key.remoteJid;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    const triggerEffects = async () => {
        await delay(500);
        await conn.sendMessage(id, { react: { text: '🎬', key: m.key } }).catch(() => {});
        await delay(1200);
    };

    if (['افلام', 'فيلم', 'لعبة افلام', 'لعبه افلام', 'خمن الفيلم'].includes(normalizedBody)) {
        if (conn.movies[cleanId]) {
            await triggerEffects();
            await conn.sendMessage(id, { 
                text: `⚠️ *تـنـبـيـه* ⚠️\n\nهناك جولة أفلام شغالة بالفعل في الشات!\nاسمع الريكورد وجاوب، أو اكتب *تلميح افلام* أو *انسحاب افلام*.` 
            }, { quoted: m });
            return true;
        }

        // اختيار فيلم عشوائي من القائمة
        const selectedMovie = moviesList[Math.floor(Math.random() * moviesList.length)];
        const audioPath = path.join(process.cwd(), 'assets', 'audio', 'movies', `${selectedMovie.id}.mp3`);

        if (!fs.existsSync(audioPath)) {
            await triggerEffects();
            await conn.sendMessage(id, { text: '❌ تعذر العثور على الملف الصوتي للفيلم، يرجى المحاولة مرة أخرى.' }, { quoted: m });
            return true;
        }

        conn.movies[cleanId] = {
            movie: selectedMovie,
            creator: sender,
            hintsGiven: 0,
            startTime: Date.now(),
            timer: setTimeout(async () => {
                if (conn.movies[cleanId]) {
                    const expiredMovie = conn.movies[cleanId].movie;
                    const timeoutText = 
                        `⏰ *انـتـهـى الـوقـت!* ⏰\n\n` +
                        `للأسف محدش عرف اسم الفيلم! 😴\n\n` +
                        `🎬 *اسم الفيلم الصحيح:* *${expiredMovie.name}*\n` +
                        `📅 *سنة الإنتاج:* ${expiredMovie.year}\n` +
                        `🌟 *بطولة:* ${expiredMovie.actors}\n` +
                        `🗣️ *الإفيه في المقطع:* "${expiredMovie.quote}"\n\n` +
                        `اكتب *"افلام"* لبدء جولة جديدة وتحدي جديد! 🎮🍿`;
                    
                    await conn.sendMessage(id, { text: timeoutText }).catch(() => {});
                    delete conn.movies[cleanId];
                }
            }, timeoutDuration)
        };

        await triggerEffects();

        // 1. إرسال المقطع الصوتي المغير أولاً كفويس نوت PTT
        try {
            const audioBuffer = fs.readFileSync(audioPath);
            await conn.sendMessage(id, {
                audio: audioBuffer,
                mimetype: 'audio/mp4',
                ptt: true
            }, { quoted: m });
        } catch (err) {
            console.error('Error sending movie audio:', err);
        }

        // 2. إرسال بطاقة تعليمات وتفاصيل الجولة
        const introCard = 
            `🎬 *لـعـبـة خـمـن اسـم الـفـيـلـم* 🎬\n\n` +
            `اسمع الريكورد المغير ده (صوت مسرع ومعمول له Pitch Shift) وخمن اسم الفيلم إيه! 👂🎙️\n\n` +
            `✨ *التصنيف:* أفلام عربي ومصري حديثة (من 2018 حتى الآن 🇪🇬)\n` +
            `🎁 *الجائزة:* *1000 نقطة* لأول إجابة صحيحة! 💰\n` +
            `⏱️ *الوقت المتاح:* 60 ثانية\n\n` +
            `💡 *[ تلميح افلام ]* : لمساعدتك في معرفة الفيلم\n` +
            `🛑 *[ انسحاب افلام ]* : للاستسلام وكشف اسم الفيلم\n` +
            `❌ *[ الغاء افلام ]* : لإلغاء الجولة (لمنشئها)`;

        await conn.sendMessage(id, { text: introCard });
        return true;
    }

    return false;
};

handler.before = async (m, conn) => {
    conn.movies = conn.movies || {};

    let id = m.key.remoteJid;
    let cleanId = id.endsWith('@lid') ? id.replace('@lid', '@s.whatsapp.net') : id;

    let rawSender = m.sender || m.key.participant || m.key.remoteJid;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let normalizedBody = normalizeArabic(body);
    if (!normalizedBody) return false;

    const triggerEffects = async () => {
        await delay(500);
        await conn.sendMessage(id, { react: { text: '🎬', key: m.key } }).catch(() => {});
        await delay(1200);
    };

    // 1️⃣ شرح اللعبة
    if (['شرح لعبة افلام', 'شرح افلام', 'كيف لعب افلام'].includes(normalizedBody)) {
        await triggerEffects();
        const helpText = 
            `📖 *دليـل لـعـبـة خـمـن الـفـيـلـم* 📖\n\n` +
            `تحدي سمعي ممتع لأشهر الأفلام العربية والمصرية الحديثة (2018 - 2026)!\n\n` +
            `🎮 *طريقة اللعب:*\n` +
            `1. اكتب كلمة *(افلام)* في الجروب.\n` +
            `2. البوت هيبعت ريكورد صوتي لإفيه شهير من فيلم بس الصوت معمول له Pitch Shift (مسرع ومغير طبقته زي السناجب).\n` +
            `3. اسمع كويس وخمن اسم الفيلم واكتبه في الشات فوراً.\n` +
            `4. أول شخص يكتب اسم الفيلم صح بيكسب *1000 نقطة* فوراً في رصيده! 🏆\n\n` +
            `✨ *الأوامر المتاحة:*\n` +
            `💡 *[ تلميح افلام ]* : بيوضحلك سنة الإنتاج أو أبطال الفيلم أو حروف الاسم.\n` +
            `🛑 *[ انسحاب افلام ]* : للاستسلام وكشف الفيلم وإنهاء الجولة.\n` +
            `❌ *[ الغاء افلام ]* : لإلغاء الجولة من الجروب (لمنشئها فقط).`;

        await conn.sendMessage(id, { text: helpText }, { quoted: m });
        return true;
    }

    if (!conn.movies[cleanId]) return false;
    const session = conn.movies[cleanId];
    const movie = session.movie;

    // 2️⃣ إلغاء اللعبة
    if (['الغاء افلام', 'الغاء فيلم'].includes(normalizedBody)) {
        await triggerEffects();
        if (session.creator !== sender) {
            await conn.sendMessage(id, { text: '❌ عذراً! الشخص الذي بدأ الجولة فقط هو من يمكنه إلغاؤها.' }, { quoted: m });
            return true;
        }
        clearTimeout(session.timer);
        delete conn.movies[cleanId];
        await conn.sendMessage(id, { text: '❌ *تم الإلغاء* ❌\n\nتم إلغاء جولة خمن الفيلم الحالية بنجاح 👍' }, { quoted: m });
        return true;
    }

    // 3️⃣ انسحاب من اللعبة
    if (['انسحاب افلام', 'انسحاب فيلم'].includes(normalizedBody)) {
        await triggerEffects();
        clearTimeout(session.timer);
        const forfeitText = 
            `🤣 *استـسـلـمـتـوا ؟!* 🤣\n\n` +
            `الذاكرة خانتكم والإفيه طار من دماغكم! 🧠💀\n\n` +
            `🎬 *الفيلم الصحيح كان:* *${movie.name}*\n` +
            `📅 *سنة العرض:* ${movie.year}\n` +
            `🌟 *بطولة:* ${movie.actors}\n` +
            `🗣️ *الإفيه الأصلي:* "${movie.quote}"\n\n` +
            `يالا مش مهم.. اكتب *"افلام"* وجرب حظك في فيلم تاني! 🍿🔁`;

        await conn.sendMessage(id, { text: forfeitText }, { quoted: m });
        delete conn.movies[cleanId];
        return true;
    }

    // 4️⃣ طلب تلميح
    if (['تلميح افلام', 'تلميح فيلم'].includes(normalizedBody)) {
        await triggerEffects();
        session.hintsGiven = (session.hintsGiven || 0) + 1;

        if (session.hintsGiven === 1) {
            const hint1 = 
                `💡 *تـلـمـيـح رقـم 1* 💡\n\n` +
                `📅 *سنة الإنتاج:* ${movie.year}\n` +
                `🌟 *أبطال الفيلم:* ${movie.actors}\n\n` +
                `ركز كويس واكتب اسم الفيلم بسرعة! 🔥`;
            await conn.sendMessage(id, { text: hint1 }, { quoted: m });
        } else {
            const masked = makeMaskedHint(movie.name);
            const hint2 = 
                `💡 *تـلـمـيـح رقـم 2 (حروف الاسم)* 💡\n\n` +
                `🎬 *شكل اسم الفيلم:* [ ${masked} ]\n\n` +
                `قربت خالص أهي.. اكتب الاسم صح! 🎯`;
            await conn.sendMessage(id, { text: hint2 }, { quoted: m });
        }
        return true;
    }

    // 5️⃣ فحص الإجابة الصحيحة
    const cleanPlayerAnswer = normalizedBody.replace(/^فيلم\s+/, '').trim();
    const cleanMovieName = normalizeArabic(movie.name).replace(/^فيلم\s+/, '').trim();

    const isMatch = (
        cleanPlayerAnswer === cleanMovieName ||
        normalizedBody === normalizeArabic(movie.name) ||
        (movie.aliases && movie.aliases.some(alias => {
            const normAlias = normalizeArabic(alias);
            return normalizedBody === normAlias || cleanPlayerAnswer === normAlias.replace(/^فيلم\s+/, '').trim();
        }))
    );

    if (isMatch) {
        clearTimeout(session.timer);
        delete conn.movies[cleanId];

        // إضافة 1000 نقطة لحساب الفائز
        const pushName = m.pushName || 'بطل الأفلام';
        const newBalance = addPointsToUser(sender, 1000, pushName);
        const balanceDisplay = (typeof newBalance === 'number') ? newBalance.toLocaleString('ar-EG') : newBalance;

        await triggerEffects();

        const winCard = 
            `✅ *إجـابـة صـحـيـحـة يـا عـالـمـي!* 🎯🎉\n\n` +
            `كفو يا أسطورة.. جبتها صح في الجون! 👏🔥\n\n` +
            `🎬 *اسم الفيلم:* *${movie.name}*\n` +
            `📅 *سنة الإنتاج:* ${movie.year}\n` +
            `🌟 *أبطال الفيلم:* ${movie.actors}\n` +
            `🗣️ *الإفيه الأصلي:* "${movie.quote}"\n\n` +
            `🎁 *الجائزة:* *+1000 نقطة ذهبية!* 💰\n` +
            `📊 *إجمالي نقاطك الحالية:* [ ${balanceDisplay} ] نقطة\n\n` +
            `اكتب *"افلام"* للعب جولة جديدة ومنافسة تانية! 🍿🎬`;

        await conn.sendMessage(id, { text: winCard }, { quoted: m });
        return true;
    }

    return false;
};

handler.command = /^(افلام|فيلم|لعبة افلام|لعبه افلام|خمن الفيلم)$/i;

export default handler;
export { moviesList };
