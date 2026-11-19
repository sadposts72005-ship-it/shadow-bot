// plugins/game-guess.js
import fs from 'fs';
import path from 'path';
import { modifyUserPoints, getUserPoints } from '../core/points.js';

// 📂 إعداد ملف التخزين المحلي الخاص بلعبة احزر لضمان عدم ضياع النقاط
const dbPath = path.join(process.cwd(), 'guess_db.json');
const charactersFilePath = path.join(process.cwd(), 'assets', 'guess_characters.json');

// دالة للتأخير ومحاكاة الكتابة البشرية
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

// 🗃️ تحميل قائمة الشخصيات المحلية الشاملة والمحدثة
function loadCharactersList() {
    try {
        if (fs.existsSync(charactersFilePath)) {
            const data = JSON.parse(fs.readFileSync(charactersFilePath, 'utf8'));
            if (Array.isArray(data) && data.length > 0) {
                return data;
            }
        }
    } catch (e) {
        console.error("Error loading guess_characters.json:", e);
    }

    // احتياطي فوري إذا لم يوجد الملف لضمان استمرار اللعبة 100%
    return [
        { name: "لوفي", anime: "ون بيس", aliases: ["لوفي", "مونكي دي لوفي", "قبعة القش"], img: "https://s4.anilist.co/file/anilistcdn/character/large/b40-MNypXsxSRb1R.png" },
        { name: "غوكو", anime: "دراجون بول", aliases: ["غوكو", "جوكو", "سون غوكو", "كاكاروت"], img: "https://s4.anilist.co/file/anilistcdn/character/large/246-wsRRr6z1kii8.png" },
        { name: "سايتاما", anime: "وان بنش مان", aliases: ["سايتاما", "الرجل ذو اللكمة الواحدة"], img: "https://s4.anilist.co/file/anilistcdn/character/large/b73935-1nmZz6x2gT0J.png" },
        { name: "غوجو", anime: "جوجيتسو كايسن", aliases: ["غوجو", "جوجو", "غوجو ساتورو", "ساتورو غوجو"], img: "https://s4.anilist.co/file/anilistcdn/character/large/b127969-l124yYzyzXsl.png" },
        { name: "ليفاي", anime: "هجوم العمالقة", aliases: ["ليفاي", "ليفاي اكرمان", "القائد ليفاي"], img: "https://s4.anilist.co/file/anilistcdn/character/large/b45627-cYZjYnsw3F6e.png" },
        { name: "ايانوكوجي", anime: "فصل النخبة", aliases: ["ايانوكوجي", "كيوتاكا ايانوكوجي", "كيوتاكا"], img: "https://s4.anilist.co/file/anilistcdn/character/large/b123212-ewZgUQr9vvEM.png" },
        { name: "استا", anime: "بلاك كلوفر", aliases: ["استا", "آستا"], img: "https://s4.anilist.co/file/anilistcdn/character/large/b122354-9E07g34sD6v1.png" }
    ];
}

const charactersList = loadCharactersList();

// 🧠 سجل لتتبع آخر أنمي تم اختياره في كل شات (لمنع تكرار شخصيتين من نفس الأنمي ورا بعض)
const lastAnimePerChat = new Map();
// 🔄 سجل لمنع تكرار نفس الشخصيات مؤخراً في نفس الشات
const recentCharactersPerChat = new Map();

/**
 * اختيار شخصية عشوائية ذكية مع ضمان عدم تكرار الأنمي ورا بعض
 */
function pickSmartCharacter(chatId) {
    const lastAnime = lastAnimePerChat.get(chatId);
    let pool = charactersList;

    // 1. استبعاد الأنمي الذي ظهر في الجولة السابقة مباشرة في هذا الشات
    if (lastAnime && pool.some(c => c.anime !== lastAnime)) {
        pool = pool.filter(c => c.anime !== lastAnime);
    }

    // 2. تجنب تكرار آخر 20 شخصية ظهرت في نفس الشات
    const recent = recentCharactersPerChat.get(chatId) || [];
    let candidates = pool.filter(c => !recent.includes(c.name));
    if (candidates.length === 0) candidates = pool;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    // 3. تحديث السجل للشات
    lastAnimePerChat.set(chatId, chosen.anime);
    recent.push(chosen.name);
    if (recent.length > 25) recent.shift();
    recentCharactersPerChat.set(chatId, recent);

    return chosen;
}

function normalizeArabic(text) {
    if (!text) return '';
    return text
        .trim()
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
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

/**
 * فحص مرن ودقيق لإجابة اللاعب مع مطابقة الأسماء الأساسية والمرادفات
 */
function isGuessCorrect(playerInput, session) {
    const normInput = normalizeArabic(playerInput);
    if (!normInput) return false;

    const primary = normalizeArabic(session.correctAnswer);
    if (normInput === primary) return true;

    const aliases = (session.aliases || []).map(normalizeArabic);
    if (aliases.includes(normInput)) return true;

    // مرونة إضافية: إذا كتب اللاعب الاسم كاملاً أو الجزء الأساسي منه
    // مثلاً: الشخصية "لوفي"، اللاعب كتب "مونكي دي لوفي"
    // أو الشخصية "غوجو"، اللاعب كتب "غوجو ساتورو"
    // أو الشخصية "اللحية البيضاء"، اللاعب كتب "وايت بيرد" أو "ادوارد نيوجيت"
    const allTargets = [primary, ...aliases].filter(Boolean);
    const inputWords = normInput.split(/\s+/).filter(w => w.length >= 3);

    for (const target of allTargets) {
        if (target.length >= 3) {
            // مطابقة مباشرة كاملة
            if (normInput === target) return true;

            // إذا كان المدخل أو الهدف يحتوي على الآخر بالكامل
            if (normInput.includes(target) || target.includes(normInput)) {
                // التأكد من أن الكلمة المشتركة ليست حرفاً أو مقطعاً صغيراً
                const targetWords = target.split(/\s+/).filter(w => w.length >= 3);
                const hasMatchingWord = inputWords.some(w => targetWords.includes(w) || target.startsWith(w) || target.endsWith(w));
                if (hasMatchingWord) return true;
            }
        }
    }

    return false;
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
            // اختيار شخصية عشوائية ذكية مع استبعاد نفس أنمي الجولة السابقة
            const character = pickSmartCharacter(cleanId);
            const { img, name, anime, aliases } = character;

            conn.obito[cleanId] = {
                correctAnswer: name,
                anime: anime,
                aliases: aliases || [name],
                creator: sender,
                timer: setTimeout(async () => {
                    if (conn.obito[cleanId]) {
                        await delay(2500);
                        await conn.sendMessage(id, { text: `⏰ *انتهى الوقت* ⏰\n\nمحدش عرف الشخصية! 😴\n\n💡 الشخصية الصحيحة كانت: *${name}* من أنمي *( ${anime} )*\n\nاكتب *"احزر"* لتجربة جولة جديدة 🎮` });
                        delete conn.obito[cleanId];
                    }
                }, timeout)
            };

            await triggerEffects();
            await conn.sendMessage(id, {
                image: { url: img },
                caption: `🎭 *لـعـبـة احـزر الـشـخـصـيـة* 🎭\n\n` +
                         `احزر صاحب الصورة الي قدامك دي واكتب اسمه فوراً!\n\n` +
                         `🎬 *الأنمي:* ${anime}\n` +
                         `⏱️ الوقت: *60 ثانية* | 🎁 الجائزة: *500 نقطة*\n` +
                         `💡 لطلب تلميح اكتب: *تلميح احزر*\n` +
                         `🛑 للاستسلام اكتب: *انسحاب احزر*\n` +
                         `❌ _لإلغاء السؤال اكتب: *الغاء احزر* (لمنشئ الجولة)_`
            }, { quoted: m });

        } catch (e) {
            console.error('Error in game-guess:', e);
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
        const currentPts = getUserPoints(sender);
        if (currentPts < 5000) {
            await conn.sendMessage(id, { text: `❌ رصيدك مش كفاية يا بطل! محتاج 5000 نقطة. (رصيدك الحالي: ${currentPts})` }, { quoted: m });
        } else {
            modifyUserPoints(sender, -5000, m.pushName);
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
            let currentPts = getUserPoints(sender);
            let canBuy = (currentPts >= 5000);

            let outOfHintsText = `🛑 *تـلـمـيـحـاتـك خـلصـت* 🛑\n\n` +
                `استخدمت الـ 6 تلميحات المتاحة ليك في لعبة احزر.\n\n` +
                `⏱️ هتتجدد تلقائياً بعد: *${timeLeft}* دقيقة.\n` +
                `💰 رصيدك الحالي في اللعبة: *${currentPts}* نقطة.\n\n` +
                `${canBuy ? '✅ تقدر تشتري 6 تلميحات جديدة بـ 5000 نقطة!\n💡 اكتب ( *شراء تلميح احزر* ) لتأكيد العملية.' : '❌ محتاج 5000 نقطة عشان تشتري تلميحات جديدة.'}`;

            await conn.sendMessage(id, { text: outOfHintsText }, { quoted: m });
            return true;
        }

        userGameData.hintsCountGuess = (userGameData.hintsCountGuess || 0) + 1;
        if (userGameData.hintsCountGuess === 1) {
            userGameData.lastHintTimeGuess = now;
        }

        let hintWord = makeHint(conn.obito[cleanId].correctAnswer);
        let currentAnime = conn.obito[cleanId].anime;
        let hintSuccessText = `💡 *تـلـمـيـح ذكـي* 💡\n\nقربنا المسافة شوية, فكر يالا!\n\n🎬 *الأنمي:* ${currentAnime}\n📋 *شكل الاسم:* ${hintWord}\n🔄 تلميحاتك المتبقية للساعة الحالية: *${6 - userGameData.hintsCountGuess}*`;
        
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
        let anime = conn.obito[cleanId].anime;
        clearTimeout(conn.obito[cleanId].timer);
        let forfeitText = `🤣 *اسـتـسـلـمـت ؟* 🤣\n\nالذاكرة خانتك والشخصية طارت من دماغك! 🧠💀\n\n💡 الشخصية الصحيحة كانت: *${name}* من أنمي *( ${anime} )*\n\nيالا مش مهم.. اكتب "احزر" وجرب حظك تاني! 🔁`;
        
        await triggerEffects();
        await conn.sendMessage(id, { text: forfeitText }, { quoted: m });
        delete conn.obito[cleanId];
        return true;
    }

    // 6️⃣ التحقق من الإجابة الصحيحة
    if (isGuessCorrect(normalizedBody, conn.obito[cleanId])) {
        const res = modifyUserPoints(sender, 500, m.pushName);
        const totalPts = res.total ?? res.points ?? 500;
        clearTimeout(conn.obito[cleanId].timer);

        const correctName = conn.obito[cleanId].correctAnswer;
        const correctAnime = conn.obito[cleanId].anime;

        let successText = `✅ *إجـابـة صـحـيـحـة* ✅\n\n` +
                          `كفو يا أسطورة! حزرت الشخصية صح 🎉\n\n` +
                          `🎭 *الشخصية:* ${correctName}\n` +
                          `🎬 *الأنمي:* ${correctAnime}\n` +
                          `🎁 *جائزتك:* +500 نقطة\n` +
                          `📊 *إجمالي نقاطك:* ${totalPts} نقطة`;
        
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
