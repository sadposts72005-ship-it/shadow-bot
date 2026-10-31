// plugins/game-ttt.js
import { shadowTheme } from '../core/theme.js';
import { modifyUserPoints } from '../core/points.js';

// دالة للتأخير المخصص
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// دالة موحدة لعمل الريأكشن والتأخير قبل إرسال الرسائل النصية
async function waitAndReact(conn, id, m) {
    await delay(1000);
    await conn.sendMessage(id, { react: { text: '🎮', key: m.key } }).catch(() => {});
    await delay(2500);
}

// 🛠️ دالة رسم الساحة وإرسالها بالثيم
async function sendBoard(conn, id, board, m, mode, result = null) {
    let render = board.map((v, i) => v ? v : ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'][i]);

    let boardStr = `${render.slice(0, 3).join(' ')}\n` +
        `> ${render.slice(3, 6).join(' ')}\n` +
        `> ${render.slice(6).join(' ')}`;

    let sections = [
        { type: 'title', text: 'سـاحـة الـمـعـركـة (XO) 🎮' },
        { type: 'spacer' },
        { type: 'line', text: boardStr }
    ];

    if (result) {
        sections.push({ type: 'divider' });
        if (result === 'draw') {
            sections.push({ type: 'line', text: '🤝 *تـعـادل!* محدش عرف يسيطر على الساحة.' });
        } else {
            let winnerText = '';
            let isHumanWinner = false;
            if (mode === 'bot') {
                winnerText = result === '❌' ? 'أنت الفائز! 🎉' : 'البوت الذكي 🤖';
                isHumanWinner = (result === '❌');
            } else {
                winnerText = result === '❌' ? 'اللاعب الأول ❌' : 'اللاعب الثاني ⭕';
                isHumanWinner = true;
            }
            sections.push({ type: 'line', text: `🎉 *الـفـائـز:* ${winnerText}` });
            if (isHumanWinner) {
                sections.push({ type: 'line', text: '🎁 *الجائزة:* +100 نقطة تمت إضافتها إلى بروفايلك! 🪙' });
            }
        }
    } else {
        sections.push({ type: 'divider' });
        sections.push({ type: 'line', text: '👉 الدور الحالي على اللاعب التالي.. أرسل رقم المربع (1-9)' });
    }

    await conn.sendMessage(id, { text: shadowTheme.build(sections) }, { quoted: m });
}

const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWinner(board) {
    for (let [a,b,c] of wins) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return board.includes(null) ? null : 'draw';
}

// ذكاء اصطناعي بسيط للبوت لاختيار حركة ذكية أو عشوائية
function makeBotMove(board) {
    let emptyCells = [];
    board.forEach((v, i) => { if (v === null) emptyCells.push(i); });

    // 1. هل يمكن للبوت الفوز في هذه الحركة؟
    for (let cell of emptyCells) {
        let testBoard = [...board];
        testBoard[cell] = '⭕';
        if (checkWinner(testBoard) === '⭕') return cell;
    }

    // 2. هل يمكن للاعب الفوز في حركته القادمة؟ (قم بحظره)
    for (let cell of emptyCells) {
        let testBoard = [...board];
        testBoard[cell] = '❌';
        if (checkWinner(testBoard) === '❌') return cell;
    }

    // 3. اختيار عشوائي إذا لم يجد
    if (emptyCells.includes(4)) return 4; // السيطرة على المنتصف أولاً
    return emptyCells[Math.floor(Math.random() * emptyCells.length)];
}

const handler = async (m, conn) => {
    conn.gameSolo = conn.gameSolo || {};

    let from = m.key.remoteJid || m.chat;
    if (!from) return false;
    let id = from.endsWith('@lid') ? from.replace('@lid', '@s.whatsapp.net') : from;

    let rawSender = m.key.participant || m.key.remoteJid || m.sender;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    let isGroup = id.endsWith('@g.us');
    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let text = body.toLowerCase().trim();

    // 💡 أمر المساعدة ومعرفة طريقة اللعب الجديد
    if (text === 'كيف لعب اكس او' || text === 'كيف العب اكس او') {
        let helpMsg = shadowTheme.build([
            { type: 'title', text: '💡 دليل طريقة لعب إكس أو (XO)' },
            { type: 'spacer' },
            { type: 'line', text: '🎮 *الأنماط المتاحة للعب:*' },
            { type: 'line', text: '1️⃣ اكتب (*اكس او*) ➔ للعب ضد شادو بوت الذكي تلقائياً.' },
            { type: 'line', text: '2️⃣ اكتب (*اكس او شخص*) ➔ لفتح غرفة تحدي ضد صديقك داخل الجروب.' },
            { type: 'divider' },
            { type: 'line', text: '📝 *طريقة اللعب الخطوات:*' },
            { type: 'line', text: '• بمجرد بدء اللعبة، ستظهر لك لوحة مكونة من أرقام من (1 إلى 9).' },
            { type: 'line', text: '• في دورك، أرسل رقم المربع الذي تريد وضع علامتك فيه مباشرة في الشات.' },
            { type: 'line', text: '• الهدف هو تشكيل خط أفقي، رأسي، أو قطري مكون من 3 علامات متشابهة قبل خصمك!' },
            { type: 'divider' },
            { type: 'line', text: '🚫 لإلغاء الجيم في أي وقت اكتب: (*الغاء اكس او*)' }
        ]);
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: helpMsg }, { quoted: m });
        return true;
    }

    // 1️⃣ أمر الإلغاء (مؤمن ومعدل بدون ظهور ID)
    if (text === 'الغاء اكس او' || text === 'إلغاء اكس او') {
        if (!conn.gameSolo[id]) {
            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: shadowTheme.warning('لا توجد لعبة قائمة للإلغاء حالياً.') }, { quoted: m });
            return true;
        }

        let game = conn.gameSolo[id];
        if (game.mode === 'pvp' && sender !== game.players.p1 && sender !== game.players.p2) {
            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: shadowTheme.error('❌ عذراً، اللاعبين داخل الجيم فقط هم من يمكنهم إلغاء اللعبة!') }, { quoted: m });
            return true;
        }

        if (game.timeout) clearTimeout(game.timeout);
        delete conn.gameSolo[id];
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: shadowTheme.success('تم إلغاء لعبة XO بنجاح! 🚫') }, { quoted: m });
        return true;
    }

    // 2️⃣ نمط اللعب ضد البوت تلقائياً (اكس او / اكس_او)
    if (/^(اكس_او|اكس او)$/i.test(text)) {
        if (conn.gameSolo[id]) {
            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: shadowTheme.warning('⚠️ توجد لعبة قائمة بالفعل في هذا الشات!') }, { quoted: m });
            return true;
        }

        conn.gameSolo[id] = {
            board: Array(9).fill(null),
            mode: 'bot',
            turn: 'p1',
            players: { p1: sender, p2: 'bot' },
            timeout: null
        };

        let botStartMsg = shadowTheme.build([
            { type: 'title', text: '🤖 بدأت جولة XO ضد البوت الذكي!' },
            { type: 'spacer' },
            { type: 'line', text: '⚔️ أنت الآن تلعب بـ (❌) والبوت يلعب بـ (⭕)' },
            { type: 'divider' },
            { type: 'line', text: '👉 افتتح اللعب، أرسل رقم المربع الآن من (1-9).' }
        ]);

        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: botStartMsg, mentions: [sender] }, { quoted: m });
        
        // ⏱️ التأخير المطلوب هنا للفصل بين الرسالتين بثانيتين ونصف
        await delay(2500); 
        await sendBoard(conn, id, conn.gameSolo[id].board, m, 'bot');
        return true;
    }

    // 3️⃣ نمط إنشاء الغرفة لشخصين (اكس او شخص)
    if (/^(اكس_او شخص|اكس او شخص)$/i.test(text)) {
        if (!isGroup) {
            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: shadowTheme.error('وضعية التحدي بين شخصين متوفرة داخل الجروبات فقط.') }, { quoted: m });
            return true;
        }

        if (conn.gameSolo[id]) {
            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: shadowTheme.warning('⚠️ توجد لعبة قائمة بالفعل في هذا الشات!') }, { quoted: m });
            return true;
        }

        conn.gameSolo[id] = {
            board: Array(9).fill(null),
            mode: 'pvp',
            turn: 'p1',
            players: { p1: null, p2: null },
            timeout: null
        };

        conn.gameSolo[id].timeout = setTimeout(async () => {
            if (conn.gameSolo[id] && (!conn.gameSolo[id].players.p1 || !conn.gameSolo[id].players.p2)) {
                await conn.sendMessage(id, { text: shadowTheme.warning('⏱️ انتهى وقت انتظار اللاعبين لانطلاق التحدي! تم إلغاء الغرفة.') });
                delete conn.gameSolo[id];
            }
        }, 45000);

        let pvpWaitMsg = shadowTheme.build([
            { type: 'title', text: '📦 تم فتح غرفة تحدي XO جديدة!' },
            { type: 'spacer' },
            { type: 'line', text: '🎮 المطلوب لاعبين اثنين للعب معاً.' },
            { type: 'line', text: '✍️ لانضمام اللاعب الأول واللاعب الثاني، اكتبوا: (*انضمام*)' },
            { type: 'divider' },
            { type: 'line', text: '⏱️ وقت انتظار اكتمال الغرفة: 45 ثانية.' }
        ]);
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: pvpWaitMsg }, { quoted: m });
        return true;
    }
    return false;
};

handler.before = async (m, conn) => {
    conn.gameSolo = conn.gameSolo || {};
    let from = m.key.remoteJid || m.chat;
    if (!from) return false;
    let id = from.endsWith('@lid') ? from.replace('@lid', '@s.whatsapp.net') : from;

    let game = conn.gameSolo[id];
    if (!game) return false;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let text = body.trim().toLowerCase();

    let rawSender = m.key.participant || m.key.remoteJid || m.sender;
    let sender = rawSender.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    // 🌟 نظام الانضمام بدون إظهار الـ ID
    if (text === 'انضمام' && game.mode === 'pvp') {
        if (!game.players.p1) {
            game.players.p1 = sender;
            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: shadowTheme.success(`✅ انضم اللاعب الأول بنجاح (❌) برقمك الثمين وجاري انتظار الخصم...`), mentions: [sender] }, { quoted: m });
            return true;
        }
        if (game.players.p1 && !game.players.p2) {
            if (game.players.p1 === sender) {
                await waitAndReact(conn, id, m);
                await conn.sendMessage(id, { text: shadowTheme.error('❌ أنت مسجل كاللاعب الأول بالفعل! انتظر خصمك.') }, { quoted: m });
                return true;
            }
            game.players.p2 = sender;

            if (game.timeout) clearTimeout(game.timeout);

            game.timeout = setTimeout(async () => {
                if (conn.gameSolo[id]) {
                    await conn.sendMessage(id, { text: shadowTheme.warning('⏱️ انتهى وقت الحركة (30 ثانية)! تم إلغاء اللعبة.') });
                    delete conn.gameSolo[id];
                }
            }, 30000);

            let startGroupMsg = shadowTheme.build([
                { type: 'title', text: 'اكتملت الغرفة وانطلقت المعركة! ⚔️' },
                { type: 'spacer' },
                { type: 'line', text: '❌ اللاعب الأول: جاهز في الميدان!' },
                { type: 'line', text: '⭕ اللاعب الثاني: دخل التحدي الآن!' },
                { type: 'divider' },
                { type: 'line', text: '👉 البداية عند اللاعب الأول (❌)، أرسل رقم المربع الآن.' }
            ]);

            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: startGroupMsg, mentions: [game.players.p1, game.players.p2] }, { quoted: m });
            
            // ⏱️ التأخير المطلوب هنا للفصل بين الرسالتين عند اكتمال غرفة التحدي
            await delay(2500);
            await sendBoard(conn, id, game.board, m, 'pvp');
            return true;
        }
        if (game.players.p1 && game.players.p2) {
            await waitAndReact(conn, id, m);
            await conn.sendMessage(id, { text: shadowTheme.warning('⚠️ الغرفة ممتلئة بالفعل والقتال شغال حالياً!') }, { quoted: m });
            return true;
        }
    }

    // فحص الأرقام (1-9) للعب الحركات
    let pos = parseInt(text) - 1;
    if (isNaN(pos) || pos < 0 || pos > 8) return false;

    // التأكد من اكتمال المعطيات
    if (game.mode === 'pvp' && (!game.players.p1 || !game.players.p2)) return false;
    if (sender !== game.players.p1 && sender !== game.players.p2) return false;

    if (game.board[pos] !== null) {
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: shadowTheme.error('هذا المربع محجوز بالفعل! اختر رقماً آخر.') }, { quoted: m });
        return true;
    }

    if ((game.turn === 'p1' && sender !== game.players.p1) || (game.turn === 'p2' && sender !== game.players.p2)) {
        await waitAndReact(conn, id, m);
        await conn.sendMessage(id, { text: shadowTheme.warning('مش دورك! انتظر حركتك المحددة.') }, { quoted: m });
        return true;
    }

    // تنفيذ حركة اللاعب
    game.board[pos] = game.turn === 'p1' ? '❌' : '⭕';
    let result = checkWinner(game.board);

    if (result) {
        if (result !== 'draw') {
            let winnerJid = (result === '❌') ? game.p1 : (game.mode === 'pvp' ? game.p2 : null);
            if (winnerJid) {
                modifyUserPoints(winnerJid, 100);
            }
        }
        await waitAndReact(conn, id, m);
        await sendBoard(conn, id, game.board, m, game.mode, result);
        if (game.timeout) clearTimeout(game.timeout);
        delete conn.gameSolo[id];
        return true;
    }

    // تبديل الأدوار وتحديث المؤقت
    if (game.timeout) clearTimeout(game.timeout);

    if (game.mode === 'bot') {
        // دور البوت تلقائياً
        let botPos = makeBotMove(game.board);
        if (botPos !== undefined) {
            game.board[botPos] = '⭕';
        }
        result = checkWinner(game.board);
        if (result && result !== 'draw' && result === '❌') {
            modifyUserPoints(game.p1, 100);
        }
        await waitAndReact(conn, id, m);
        await sendBoard(conn, id, game.board, m, 'bot', result);

        if (result) {
            delete conn.gameSolo[id];
        }
    } else {
        // نمط الأشخاص - تحويل الدور للخصم الآخر
        game.turn = game.turn === 'p1' ? 'p2' : 'p1';
        await waitAndReact(conn, id, m);
        await sendBoard(conn, id, game.board, m, 'pvp');

        game.timeout = setTimeout(async () => {
            if (conn.gameSolo[id]) {
                await conn.sendMessage(id, { text: shadowTheme.warning('⏱️ انتهى وقت اللعب (30 ثانية)! تم إلغاء اللعبة لعدم الاستجابة.') });
                delete conn.gameSolo[id];
            }
        }, 30000);
    }

    return true;
};

handler.command = /^(اكس_او شخص|اكس او شخص|انضمام|إلغاء اكس او|الغاء اكس او|اكس او|اكس_او|كيف لعب اكس او|كيف العب اكس او)$/i;
export default handler;
