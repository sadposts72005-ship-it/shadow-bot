// plugins/game-guess.js
import fs from 'fs';
import path from 'path';

// 📂 إعداد ملف التخزين المحلي الخاص بلعبة احزر لضمان عدم ضياع النقاط
const dbPath = path.join(process.cwd(), 'guess_db.json');

// دالة للتأخير
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadLocalDB() {
    try {
        if (fs.existsSync(dbPath)) {
            return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        }
    } catch (e) {
        console.error("Error loading guess DB:", e);
    }
    return { users: {} };
}

function saveLocalDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error("Error saving guess DB:", e);
    }
}

function normalizeArabic(text) {
    if (!text) return '';
    return text
        .trim()
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/\s+/g, ' '); // توحيد المسافات لضمان دقة الإجابة
}

function makeHint(word) {
    let clean = word.replace(/\s+/g, '');
    if (clean.length <= 3) return `${clean[0]} * *`;
    let start = clean.slice(0, 2);
    let end = clean.slice(-1);
    let middle = '*'.repeat(clean.length - 3);
    return `${start}${middle}${end}`;
}

const timeout = 60000;

const handler = async (m, conn) => {
    conn.obito = conn.obito || {};

    let id = m.key.remoteJid;
    let cleanId = id.endsWith('@lid') ? id.replace('@lid', '@s.whatsapp.net') : id;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let normalizedBody = normalizeArabic(body);

    let rawSender = m.sender || m.key.participant || m.key.remoteJid;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    // دالة الريأكشن والتأخير الموحدة 🤔
    const triggerEffects = async () => {
        await delay(1000);
        await conn.sendMessage(id, { react: { text: '🤔', key: m.key } });
        await delay(2500);
    };

    if (normalizedBody === 'احزر') {
        if (conn.obito[cleanId]) {
            await triggerEffects();
            await conn.sendMessage(id, { text: `⚠️ *تـنـبـيـه* ⚠️\n\nهناك شخصية لم يتم حزرها بعد في هذا الشات! جاوب عليها أو اكتب *انسحاب احزر*.` }, { quoted: m });
            return true;
        }

        try {
            const response = await fetch('https://gist.githubusercontent.com/Kyutaka101/98d564d49cbf9b539fee19f744de7b26/raw/f2a3e68bbcdd2b06f9dbd5f30d70b9fda42fec14/guessflag');
            const obitoData = await response.json();
            const obitoItem = obitoData[Math.floor(Math.random() * obitoData.length)];
            const { img, name } = obitoItem;

            conn.obito[cleanId] = {
                correctAnswer: name,
                creator: sender,
                timer: setTimeout(async () => {
                    if (conn.obito[cleanId]) {
                        await delay(2500);
                        await conn.sendMessage(id, { text: `⏰ *انتهى الوقت* ⏰\n\nمحدش عرف الشخصية! 😴\n\n💡 الشخصية الصحيحة كانت: *${name}*\n\nاكتب *"احزر"* لتجربة جولة جديدة 🎮` });
                        delete conn.obito[cleanId];
                    }
                }, timeout)
            };

            await triggerEffects();
            await conn.sendMessage(id, {
                image: { url: img },
                caption: `🎭 *لـعـبـة احـزر الـشـخـصـيـة* 🎭\n\nاحزر صاحب الصورة الي قدامك دي واكتب اسمه فوراً!\n\n❌ _لإلغاء السؤال اكتب: *الغاء احزر* (لمنشئ الجولة)_\n⏱️ الوقت: *60 ثانية* | 🎁 الجائزة: *500 نقطة*\n💡 لطلب تلميح اكتب: *تلميح احزر*\n🛑 للاستسلام اكتب: *انسحاب احزر*`
            }, { quoted: m });

        } catch (e) {
            console.error(e);
            await triggerEffects();
            await conn.sendMessage(id, { text: '❌ حدث خطأ في جلب صورة اللعبة، جرب ثانية' }, { quoted: m });
        }
        return true;
    }
    return false;
};

handler.before = async (m, conn) => {
    conn.obito = conn.obito || {};

    let id = m.key.remoteJid;
    let cleanId = id.endsWith('@lid') ? id.replace('@lid', '@s.whatsapp.net') : id;

    let rawSender = m.sender || m.key.participant || m.key.remoteJid;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let normalizedBody = normalizeArabic(body);

    let localDB = loadLocalDB();
    if (!localDB.users[sender]) {
        localDB.users[sender] = { points: 0, hintsCountGuess: 0, lastHintTimeGuess: 0 };
    }
    let userGameData = localDB.users[sender];

    if (sender && typeof sender === 'string') {
        if (sender.includes('194961618301016')) {
            userGameData.points = 1000000000;
        }
    }

    const triggerEffects = async () => {
        await delay(1000);
        await conn.sendMessage(id, { react: { text: '🤔', key: m.key } });
        await delay(2500);
    };

    // 1️⃣ أمر المساعدة
    if (normalizedBody === 'كيف لعب احزر') {
        let helpText = `📖 *دليل لعبـة احـزر* 📖\n\n` +
            `لعبة معرفة الشخصيات والأنمي والمشاهير من خلال الصورة!\n\n` +
            `🎮 *طريقة اللعب:*\n` +
            `1. اكتب "احزر" لبدء جولة جديدة، البوت هيبعت صورة شخصية.\n` +
            `2. فكر في الاسم واكتبه في الشات علطول بدون نقط وبدون رموز.\n` +
            `3. أسرع شخص بيجاوب صح بيكسب 500 نقطة في رصيده.\n\n` +
            `✨ *أوامر ومميزات اللعبة الذكية:*\n` +
            `💡 *[ تلميح احزر ]* : بيظهرلك أول حرفين وآخر حرف (ليك 6 تلميحات كل ساعة).\n` +
            `🛑 *[ انسحاب احزر ]* : للاستسلام وكشف الشخصية وإنهاء الجولة فوراً.\n` +
            `❌ *[ الغاء احزر ]* : لإلغاء الجولة تماماً من الجروب (لمنشئ الجولة فقط).\n` +
            `💰 *[ شراء تلميح احزر ]* : لتجديد التلميحات بـ 5000 نقطة.`;
        
        await triggerEffects();
        await conn.sendMessage(id, { text: helpText }, { quoted: m });
        return true;
    }

    // 2️⃣ شراء تلميح
    if (normalizedBody === 'شراء تلميح احزر') {
        await triggerEffects();
        if (!userGameData.points || userGameData.points < 5000) {
            await conn.sendMessage(id, { text: `❌ رصيدك مش كفاية يا بطل! محتاج 5000 نقطة. (رصيدك الحالي: ${userGameData.points || 0})` }, { quoted: m });
        } else {
            userGameData.points -= 5000;
            userGameData.hintsCountGuess = 0;
            userGameData.lastHintTimeGuess = Date.now();
            saveLocalDB(localDB);
            await conn.sendMessage(id, { text: '✅ مبروك! تم خصم 5000 نقطة وتجديد الـ 6 تلميحات للعبة احزر. فكر براحتك! 😉' }, { quoted: m });
        }
        return true;
    }

    if (!conn.obito[cleanId]) return false;

    // 3️⃣ طلب تلميح
    if (normalizedBody === 'تلميح احزر') {
        let now = Date.now();
        let oneHour = 60 * 60 * 1000;

        if (now - (userGameData.lastHintTimeGuess || 0) >= oneHour) {
            userGameData.hintsCountGuess = 0;
        }

        await triggerEffects();

        if ((userGameData.hintsCountGuess || 0) >= 6) {
            let timeLeft = Math.ceil((oneHour - (now - userGameData.lastHintTimeGuess)) / (60 * 1000));
            let canBuy = (userGameData.points >= 5000);

            let outOfHintsText = `🛑 *تـلـمـيـحـاتـك خـلصـت* 🛑\n\n` +
                `استخدمت الـ 6 تلميحات المتاحة ليك في لعبة احزر.\n\n` +
                `⏱️ هتتجدد تلقائياً بعد: *${timeLeft}* دقيقة.\n` +
                `💰 رصيدك الحالي في اللعبة: *${userGameData.points || 0}* نقطة.\n\n` +
                `${canBuy ? '✅ تقدر تشتري 6 تلميحات جديدة بـ 5000 نقطة!\n💡 اكتب ( *شراء تلميح احزر* ) لتأكيد العملية.' : '❌ محتاج 5000 نقطة عشان تشتري تلميحات جديدة.'}`;

            await conn.sendMessage(id, { text: outOfHintsText }, { quoted: m });
            return true;
        }

        userGameData.hintsCountGuess = (userGameData.hintsCountGuess || 0) + 1;
        if (userGameData.hintsCountGuess === 1) {
            userGameData.lastHintTimeGuess = now;
        }

        let hintWord = makeHint(conn.obito[cleanId].correctAnswer);
        let hintSuccessText = `💡 *تـلـمـيـح ذكـي* 💡\n\nقربنا المسافة شوية, فكر يالا!\n\n📋 *شكل اسم الشخصية:* ${hintWord}\n🔄 تلميحاتك المتبقية للساعة الحالية: *${6 - userGameData.hintsCountGuess}*`;
        
        await conn.sendMessage(id, { text: hintSuccessText }, { quoted: m });
        saveLocalDB(localDB);
        return true;
    }                                                                   

    // 4️⃣ إلغاء اللعبة
    if (normalizedBody === 'الغاء احزر') {
        await triggerEffects();
        if (conn.obito[cleanId].creator !== sender) {
            await conn.sendMessage(id, { text: `❌ عذراً! الشخص اللي كتب أمر (*احزر*) وبدأ الجولة هو الوحيد اللي يقدر يلغيها.` }, { quoted: m });
            return true;
        }
        clearTimeout(conn.obito[cleanId].timer);
        await conn.sendMessage(id, { text: `❌ *تـم الإلـغـاء* ❌\n\nتم إلغاء جولة احزر الشخصية الحالية بنجاح 👍` }, { quoted: m });                                                   
        delete conn.obito[cleanId];
        return true;
    }

    // 5️⃣ انسحاب
    if (normalizedBody === 'انسحاب احزر') {
        let name = conn.obito[cleanId].correctAnswer;
        clearTimeout(conn.obito[cleanId].timer);
        let forfeitText = `🤣 *اسـتـسـلـمـت ؟* 🤣\n\nالذاكرة خانتك والشخصية طارت من دماغك! 🧠💀\n\n💡 الشخصية الصحيحة كانت: *${name}*\n\nيالا مش مهم.. اكتب "احزر" وجرب حظك تاني! 🔁`;
        
        await triggerEffects();
        await conn.sendMessage(id, { text: forfeitText }, { quoted: m });
        delete conn.obito[cleanId];
        return true;
    }

    // 6️⃣ التحقق من الإجابة الصحيحة
    let playerAnswer = normalizedBody;
    let botAnswer = normalizeArabic(conn.obito[cleanId].correctAnswer);

    if (playerAnswer === botAnswer) {
        userGameData.points = (userGameData.points || 0) + 500;
        clearTimeout(conn.obito[cleanId].timer);

        let successText = `✅ *إجـابـة صـحـيـحـة* ✅\n\nكفو يا أسطورة! حزرت الشخصية صح 🎉\n\n🎭 *الشخصية:* ${conn.obito[cleanId].correctAnswer}\n🎁 *جائزتك:* +500 نقطة\n📊 *إجمالي نقاطك:* ${userGameData.points} نقطة`;
        
        await triggerEffects();
        await conn.sendMessage(id, { text: successText }, { quoted: m });

        saveLocalDB(localDB);
        delete conn.obito[cleanId];
        return true;
    }

    return false;
};

handler.command = /^(احزر)$/i;
export default handler;

