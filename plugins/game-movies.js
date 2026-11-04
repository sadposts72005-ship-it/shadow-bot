// plugins/game-movies.js
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

// ⏱️ دالة تأخير لمنع الحظر ومحاكاة الكتابة الطبيعية للإنسان
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 📂 مسار ملف قاعدة بيانات الأفلام الصوتية
const moviesDataPath = path.join(process.cwd(), 'assets', 'audio', 'movies', 'movies_data.json');

// تحميل قائمة الأفلام
function loadMoviesList() {
    try {
        if (fs.existsSync(moviesDataPath)) {
            return JSON.parse(fs.readFileSync(moviesDataPath, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading movies_data.json:', e?.message || e);
    }
    return [];
}

const moviesList = loadMoviesList();

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

const timeoutDuration = 180000; // 3 دقائق (180 ثانية)

const handler = async (m, conn) => {
    conn.movies = conn.movies || {};

    let id = m.key.remoteJid;
    let cleanId = id.endsWith('@lid') ? id.replace('@lid', '@s.whatsapp.net') : id;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let normalizedBody = normalizeArabic(body);

    let rawSender = m.sender || m.key.participant || m.key.remoteJid;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    if (['افلام', 'فيلم', 'لعبة افلام', 'لعبه افلام', 'خمن الفيلم'].includes(normalizedBody)) {
        if (conn.movies[cleanId]) {
            // تأخير طبيعي مع ريأكشن
            await delay(1200);
            await conn.sendMessage(id, { react: { text: '⚠️', key: m.key } }).catch(() => {});
            await delay(1500);
            await conn.sendMessage(id, { 
                text: `⚠️ *تـنـبـيـه* ⚠️\n\nهناك جولة أفلام شغالة بالفعل في الشات!\nاسمع الريكورد وجاوب، أو اكتب *تلميح افلام* أو *انسحاب افلام*.` 
            }, { quoted: m });
            return true;
        }

        const pool = moviesList.length > 0 ? moviesList : loadMoviesList();
        if (!pool || pool.length === 0) {
            await delay(1000);
            await conn.sendMessage(id, { text: '❌ تعذر تحميل قاعدة بيانات الأفلام، يرجى إعادة المحاولة.' }, { quoted: m });
            return true;
        }

        // اختيار فيلم عشوائي من أكثر من 300 مقطع
        const selectedMovie = pool[Math.floor(Math.random() * pool.length)];
        let audioPath = path.join(process.cwd(), 'assets', 'audio', 'movies', `${selectedMovie.id}.opus`);
        if (!fs.existsSync(audioPath)) {
            audioPath = path.join(process.cwd(), 'assets', 'audio', 'movies', `${selectedMovie.id}.mp3`);
        }

        if (!fs.existsSync(audioPath)) {
            await delay(1000);
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

        // ⏱️ تأخير واقعي في الرد:
        // 1. التفاعل بالريأكشن بعد 1.2 ثانية
        await delay(1200);
        await conn.sendMessage(id, { react: { text: '🎬', key: m.key } }).catch(() => {});

        // 2. محاكاة تسجيل مقطع صوتي (Recording presence) لمدة ثانيتين
        await conn.sendPresenceUpdate('recording', id).catch(() => {});
        await delay(2000);

        // 3. إرسال المقطع الصوتي المغير أولاً كفويس نوت PTT
        try {
            const audioBuffer = fs.readFileSync(audioPath);
            await conn.sendMessage(id, {
                audio: audioBuffer,
                mimetype: audioPath.endsWith('.opus') ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
                ptt: true
            }, { quoted: m });
        } catch (err) {
            console.error('Error sending movie audio:', err);
        }

        // 4. تأخير طبيعي قبل إرسال بطاقة تعليمات وتفاصيل الجولة مع حالة كتابة (Composing)
        await delay(1500);
        await conn.sendPresenceUpdate('composing', id).catch(() => {});
        await delay(1200);

        const introCard = 
            `🎬 *لـعـبـة خـمـن اسـم الـفـيـلـم* 🎬\n\n` +
            `اسمع الريكورد ده لإفيه أو مشهد شهير وخمن اسم الفيلم إيه! 👂🎙️\n\n` +
            `✨ *التصنيف:* مشاهد وإفيهات سينمائية حقيقية 100% بأصوات الممثلين الأصلية 🎭🇪🇬\n` +
            `🎁 *الجائزة:* *1000 نقطة* لأول إجابة صحيحة! 💰\n` +
            `⏱️ *الوقت المتاح:* 3 دقائق\n\n` +
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

    // 1️⃣ شرح اللعبة
    if (['شرح لعبة افلام', 'شرح افلام', 'كيف لعب افلام'].includes(normalizedBody)) {
        await delay(1200);
        await conn.sendMessage(id, { react: { text: '🎬', key: m.key } }).catch(() => {});
        await conn.sendPresenceUpdate('composing', id).catch(() => {});
        await delay(1500);

        const helpText = 
            `📖 *دليـل لـعـبـة خـمـن الـفـيـلـم* 📖\n\n` +
            `تحدي سمعي ممتع لأقوى وأشهر إفيهات السينما المصرية بأصوات الممثلين الأصلية 100%!\n\n` +
            `🎮 *طريقة اللعب:*\n` +
            `1. اكتب كلمة *(افلام)* في الجروب.\n` +
            `2. البوت هيبعت ريكورد صوتي حقيقي لإفيه أو مشهد شهير من الفيلم بصوت الفنان الأصلي.\n` +
            `3. اسمع كويس وخمن اسم الفيلم واكتبه في الشات فوراً خلال 3 دقائق.\n` +
            `4. أول شخص يكتب اسم الفيلم صح بيكسب *1000 نقطة* فوراً في رصيده! 🏆\n\n` +
            `✨ *الأوامر المتاحة:*\n` +
            `💡 *[ تلميح افلام ]* : بيوضحلك سنة الإنتاج أو أبطال الفيلم أو حروف الاسم.\n` +
            `🛑 *[ انسحاب افلام ]* : للاستسلام وكشف الفيلم وإنهاء الجولة.\n` +
            `❌ *[ الغاء افلام ]* : لإلغاء الجولة من الجروب (لمنشئها فقط).`;

        await conn.sendMessage(id, { text: helpText }, { quoted: m });
        return true;
    }

    // ➕ أمر إضافة فيلم حقيقي (للمطور والمالك)
    const rawText = body.trim();
    if (/^(اضف\s+فيلم|اضافة\s+فيلم)/i.test(rawText)) {
        const owners = ['201129249396', '201229409956', '194961618301016'];
        const cleanSenderNum = sender.replace(/[^0-9]/g, '');
        const isOwner = owners.includes(cleanSenderNum) || m.key.fromMe;
        if (!isOwner) {
            await delay(1000);
            await conn.sendMessage(id, { text: '❌ عذراً! هذا الأمر مخصص لمالك البوت فقط لإضافة مقاطع أفلام جديدة.' }, { quoted: m });
            return true;
        }

        // استخراج الميديا المقتبسة أو المرفقة
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        let mediaMsg = null;
        let mediaType = null;

        if (quotedMsg?.audioMessage) {
            mediaMsg = quotedMsg.audioMessage;
            mediaType = 'audio';
        } else if (quotedMsg?.videoMessage) {
            mediaMsg = quotedMsg.videoMessage;
            mediaType = 'video';
        } else if (m.message?.audioMessage) {
            mediaMsg = m.message.audioMessage;
            mediaType = 'audio';
        } else if (m.message?.videoMessage) {
            mediaMsg = m.message.videoMessage;
            mediaType = 'video';
        }

        if (!mediaMsg) {
            await delay(1000);
            await conn.sendMessage(id, { 
                text: `⚠️ *طـريـقـة إضـافـة فـيـلـم حـقـيـقـي* ⚠️\n\nقم بالرد على ريكورد أو فويس أو فيديو لمشهد الفيلم واكتب:\n*اضف فيلم [اسم الفيلم] | [الإفيه أو الجملة]*\n\n📌 *مثال:*\nاضف فيلم الفيل الأزرق 2 | لا تخافوا ولكن احذروا` 
            }, { quoted: m });
            return true;
        }

        const argsStr = rawText.replace(/^(اضف\s+فيلم|اضافة\s+فيلم)/i, '').trim();
        const parts = argsStr.split('|').map(p => p.trim());
        const movieName = parts[0];
        const movieQuote = parts[1] || 'مشهد شهير من الفيلم';
        const movieActors = parts[2] || 'أبطال الفيلم';
        const movieYear = parts[3] || '2020';

        if (!movieName) {
            await delay(1000);
            await conn.sendMessage(id, { text: '❌ يرجى كتابة اسم الفيلم! مثال:\n*اضف فيلم ولاد رزق | عينك في عيني كدة*' }, { quoted: m });
            return true;
        }

        await delay(800);
        await conn.sendMessage(id, { react: { text: '⏳', key: m.key } }).catch(() => {});
        await conn.sendPresenceUpdate('recording', id).catch(() => {});

        try {
            const stream = await downloadContentFromMessage(mediaMsg, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const scratchDir = path.join(process.cwd(), 'scratch');
            if (!fs.existsSync(scratchDir)) {
                fs.mkdirSync(scratchDir, { recursive: true });
            }
            const tempInput = path.join(scratchDir, `temp_${Date.now()}.${mediaType === 'video' ? 'mp4' : 'ogg'}`);
            fs.writeFileSync(tempInput, buffer);

            const nextNum = moviesList.length + 1;
            const newId = `movie_${String(nextNum).padStart(3, '0')}`;
            const targetOpus = path.join(process.cwd(), 'assets', 'audio', 'movies', `${newId}.opus`);

            const ffmpegBin = (process.platform === 'win32')
                ? path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
                : 'ffmpeg';

            await new Promise((resolve, reject) => {
                execFile(ffmpegBin, ['-y', '-i', tempInput, '-c:a', 'libopus', '-b:a', '48k', targetOpus], (err) => {
                    try { fs.unlinkSync(tempInput); } catch (_) {}
                    if (err) return reject(err);
                    resolve();
                });
            });

            const newEntry = {
                id: newId,
                name: movieName,
                aliases: [
                    movieName,
                    movieName.replace(/[أإآ]/g, 'ا'),
                    movieName.replace(/ة/g, 'ه'),
                    movieName.replace(/ى/g, 'ي')
                ],
                year: movieYear,
                actors: movieActors,
                quote: movieQuote
            };

            moviesList.push(newEntry);
            fs.writeFileSync(moviesDataPath, JSON.stringify(moviesList, null, 2), 'utf8');

            await conn.sendMessage(id, { react: { text: '✅', key: m.key } }).catch(() => {});
            await delay(1200);

            const successCard = 
                `✅ *تـم إضـافـة الـفـيـلـم بـنـجـاح!* 🎬🔥\n\n` +
                `تم حفظ المقطع الصوتي بصوت الممثلين الأصلي بنقاء عالي وبصيغة واتساب المعتمدة 🎙️\n\n` +
                `🎬 *اسم الفيلم:* *${movieName}*\n` +
                `🗣️ *الإفيه:* "${movieQuote}"\n` +
                `🆔 *رقم المقطع:* ${newId}\n` +
                `📚 *إجمالي المقاطع المتاحة الآن:* ${moviesList.length} مقطع\n\n` +
                `المقطع دخل فوراً في قرعة لعبة الأفلام 🍿!`;

            await conn.sendMessage(id, { text: successCard }, { quoted: m });
            return true;
        } catch (e) {
            console.error('Error in add movie command:', e);
            await conn.sendMessage(id, { text: '❌ حدث خطأ أثناء معالجة وتحويل الصوت: ' + (e?.message || e) }, { quoted: m });
            return true;
        }
    }

    if (!conn.movies[cleanId]) return false;
    const session = conn.movies[cleanId];
    const movie = session.movie;

    // 2️⃣ إلغاء اللعبة
    if (['الغاء افلام', 'الغاء فيلم'].includes(normalizedBody)) {
        await delay(1000);
        if (session.creator !== sender) {
            await conn.sendMessage(id, { text: '❌ عذراً! الشخص الذي بدأ الجولة فقط هو من يمكنه إلغاؤها.' }, { quoted: m });
            return true;
        }
        clearTimeout(session.timer);
        delete conn.movies[cleanId];
        await conn.sendMessage(id, { react: { text: '❌', key: m.key } }).catch(() => {});
        await delay(1200);
        await conn.sendMessage(id, { text: '❌ *تم الإلغاء* ❌\n\nتم إلغاء جولة خمن الفيلم الحالية بنجاح 👍' }, { quoted: m });
        return true;
    }

    // 3️⃣ انسحاب من اللعبة
    if (['انسحاب افلام', 'انسحاب فيلم'].includes(normalizedBody)) {
        clearTimeout(session.timer);
        delete conn.movies[cleanId];

        await delay(1000);
        await conn.sendMessage(id, { react: { text: '🤣', key: m.key } }).catch(() => {});
        await conn.sendPresenceUpdate('composing', id).catch(() => {});
        await delay(1500);

        const forfeitText = 
            `🤣 *استـسـلـمـتـوا ؟!* 🤣\n\n` +
            `الذاكرة خانتكم والإفيه طار من دماغكم! 🧠💀\n\n` +
            `🎬 *الفيلم الصحيح كان:* *${movie.name}*\n` +
            `📅 *سنة العرض:* ${movie.year}\n` +
            `🌟 *بطولة:* ${movie.actors}\n` +
            `🗣️ *الإفيه الأصلي:* "${movie.quote}"\n\n` +
            `يالا مش مهم.. اكتب *"افلام"* وجرب حظك في فيلم تاني! 🍿🔁`;

        await conn.sendMessage(id, { text: forfeitText }, { quoted: m });
        return true;
    }

    // 4️⃣ طلب تلميح
    if (['تلميح افلام', 'تلميح فيلم'].includes(normalizedBody)) {
        session.hintsGiven = (session.hintsGiven || 0) + 1;

        await delay(1000);
        await conn.sendMessage(id, { react: { text: '💡', key: m.key } }).catch(() => {});
        await conn.sendPresenceUpdate('composing', id).catch(() => {});
        await delay(1800);

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

        // تأخير واقعي مع ريأكشن احتفالي
        await delay(1000);
        await conn.sendMessage(id, { react: { text: '🎯', key: m.key } }).catch(() => {});
        await conn.sendPresenceUpdate('composing', id).catch(() => {});
        await delay(1800);

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
