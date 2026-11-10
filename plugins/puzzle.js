import fs from 'fs';
import path from 'path';

const puzzleGames = new Map();

// ⏱️ دالة التأخير المخصصة
const gameDelay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 📂 بنك مجموعات الأشكال العشوائية
const dynamicShapesPool = [
    ["🔶", "🔷", "🔺", "🔻", "🟢", "🟡", "🟣", "🔵"],
    ["🍎", "🍌", "🍇", "🍓", "🍊", "🍉", "🍍", "🍒"],
    ["🦁", "🐯", "🦊", "🐱", "🐶", "🐼", "🐻", "🐨"],
    ["🌍", "🌕", "🪐", "☀️", "⭐", "☄️", "🌙", "🌌"],
    ["🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚒"]
];

function renderNumberBoard(board) {
    return board.map(row => {
        return row.map(cell => {
            if (cell === "⬛") return "⬜"; 
            const numberEmojis = ["️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
            return numberEmojis[cell] || `[ ${cell} ]`;
        }).join("   ");
    }).join("\n");
}

function renderShapeBoard(board, currentShapes) {
    return board.map(row => {
        return row.map(cell => {
            if (cell === "⬛") return "⬜"; 
            return currentShapes[cell - 1] || `[ ${cell} ]`;
        }).join("   ");
    }).join("\n");
}

// 🎯 دالة عرض اللوحة الهدف (المطلوب تقليدها) 3 تحت بعض
function renderTargetBoard(mode, currentShapes) {
    if (mode === 'ارقام') {
        return `1️⃣   2️⃣   3️⃣\n4️⃣   5️⃣   6️⃣\n7️⃣   8️⃣   ⬜`;
    } else {
        const s = currentShapes;
        return `${s[0]}   ${s[1]}   ${s[2]}\n${s[3]}   ${s[4]}   ${s[5]}\n${s[6]}   ${s[7]}   ⬜`;
    }
}

function shuffleBoard() {
    let board = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, "⬛"]
    ];
    let row = 2, col = 2;
    const moves = ['فوق', 'تحت', 'يمين', 'شمال'];
    
    for (let i = 0; i < 60; i++) {
        let move = moves[Math.floor(Math.random() * moves.length)];
        
        if (move === 'تحت' && row > 0) {
            board[row][col] = board[row - 1][col]; board[row - 1][col] = "⬛"; row--;
        } else if (move === 'فوق' && row < 2) {
            board[row][col] = board[row + 1][col]; board[row + 1][col] = "⬛"; row++;
        } else if (move === 'شمال' && col < 2) {
            board[row][col] = board[row][col + 1]; board[row][col + 1] = "⬛"; col++;
        } else if (move === 'يمين' && col > 0) {
            board[row][col] = board[row][col - 1]; board[row][col - 1] = "⬛"; col--;
        }
    }
    return { board, emptyPos: { row, col } };
}

function generateHint(board, emptyPos, gameMode, currentShapes) {
    let { row, col } = emptyPos;
    let options = [];
    if (row > 0 && typeof board[row - 1][col] === 'number') {
        let val = board[row - 1][col];
        let name = gameMode === 'اشكال' ? currentShapes[val - 1] : val;
        options.push(`القطعة [ ${name} ] لـ 'تحت'`);
    }
    if (row < 2 && typeof board[row + 1][col] === 'number') {
        let val = board[row + 1][col];
        let name = gameMode === 'اشكال' ? currentShapes[val - 1] : val;
        options.push(`القطعة [ ${name} ] لـ 'فوق'`);
    }
    if (col > 0 && typeof board[row][col - 1] === 'number') {
        let val = board[row][col - 1];
        let name = gameMode === 'اشكال' ? currentShapes[val - 1] : val;
        options.push(`القطعة [ ${name} ] لـ 'يمين'`);
    }
    if (col < 2 && typeof board[row][col + 1] === 'number') {
        let val = board[row][col + 1];
        let name = gameMode === 'اشكال' ? currentShapes[val - 1] : val;
        options.push(`القطعة [ ${name} ] لـ 'شمال'`);
    }
    let baseHint = options.length > 0 ? options[Math.floor(Math.random() * options.length)] : "حرك أي قطعة مجاورة للمربع الفاضي!";
    return `🔍 *تلميح ذكي للبازل:*\n\n💡 جرب تحرك: *${baseHint}*`;
}

const puzzleHandler = {
    name: 'بازل',
    category: 'games',
    description: 'لعبة البازل المطور أرقام وأشكال عشوائية مفتوحة الوقت 100%',
    
    async execute(client, m, args, command, text) {
        const from = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;

        const msgClean = text ? text.trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي') : "";
        
        const isStart = command === 'بازل' || /^(بازل|puzzle|لعبة بازل|لعبه بازل|لعبة البازل|لعبه البازل|ابدأ بازل|ابدا بازل|جيم بازل)$/i.test(command || msgClean);
        const isCancel = command === 'الغاء' || msgClean.includes('الغي') || msgClean.includes('الغاء');
        const isHint = command === 'تلميح' || msgClean.includes('تلميح');
        const isMove = command === 'move' || ['فوق', 'تحت', 'يمين', 'شمال'].includes(msgClean);

        // 1️⃣ بدء الجيم
        if (isStart) {
            if (puzzleGames.has(from)) {
                return client.sendMessage(from, { text: "❌ فيه جيم بازل شغال بالفعل! استخدم الاتجاهات أو اكتب (تلميح بازل)." }, { quoted: m });
            }

            const modes = ['ارقام', 'اشكال'];
            const chosenMode = modes[Math.floor(Math.random() * modes.length)];
            const { board, emptyPos } = shuffleBoard();
            const randomShapes = dynamicShapesPool[Math.floor(Math.random() * dynamicShapesPool.length)];

            // تم إزالة الـ setTimeout والمؤقت تماماً ليكون الجيم مفتوحاً
            puzzleGames.set(from, {
                creator: sender, board: board, emptyPos: emptyPos, moves: 0,
                hintsUsed: 0, mode: chosenMode, shapes: randomShapes
            });

            const activeBotName = client?.botName || 'الشادو';
            let txt = `🧩 *جيم بازل ${activeBotName} الأسطوري بدأ!* 📊\n`;
            txt += `*━━━━━━━━━━━━━━━━━━━━━*\n\n`;
            txt += `🎯 المود الحالي: *[ مود الـ${chosenMode === 'اشكال' ? 'أشكال عشوائية 🎲' : 'أرقام سريعة 🔢'} ]*\n\n`;
            
            txt += `📋 *اللوحة الحالية الملتخبطة:*\n`;
            txt += `${chosenMode === 'اشكال' ? renderShapeBoard(board, randomShapes) : renderNumberBoard(board)}\n\n`;
            
            txt += `🏆 *الهدف (الترتيب الصحيح للفوز):*\n`;
            txt += `${renderTargetBoard(chosenMode, randomShapes)}\n\n`;
            
            txt += `*━━━━━━━━━━━━━━━━━━━━━*\n`;
            txt += `❓ *كيف تلعب البازل؟*\n`;
            txt += `• الهدف هو ترتيب اللوحة الملتخبطة لتصبح تماماً مثل اللوحة الهدف.\n`;
            txt += `• المربع الأبيض (⬜) هو المكان الفاضي اللي تقدر تنقل القطع فيه.\n`;
            txt += `• الوقت مفتوح تماماً، فكر بذكاء ورتبها براحتك! ✨\n\n`;
            txt += `🎮 *الاوامر المتاحة أثناء اللعب:*\n`;
            txt += `⬅️ *(فوق)*: لسحب القطعة اللي فوق الفراغ لتحت.\n`;
            txt += `⬅️ *(تحت)*: لسحب القطعة اللي تحت الفراغ لفوق.\n`;
            txt += `⬅️ *(يمين)*: لسحب القطعة اللي يمين الفراغ للشمال.\n`;
            txt += `⬅️ *(شمال)*: لسحب القطعة اللي شمال الفراغ لليمين.\n`;
            txt += `🔍 *(تلميح بازل)*: البوت يعطيك حركة ذكية تساعدك (متاح 3 مرات).\n`;
            txt += `🛑 *(الغاء بازل)*: لإنهاء الجيم الحالي فوراً في أي وقت.`;
            
            return await client.sendMessage(from, { text: txt }, { quoted: m });
        }

        // التأكد من وجود جيم شغال للجروب
        if (!puzzleGames.has(from)) return;
        const game = puzzleGames.get(from);

        // 2️⃣ أمر إلغاء بازل
        if (isCancel) {
            const isHajj = m.isSuperAdmin || m.isBotOwner || m.isAbsoluteOwner; 
            if (game.creator !== sender && !isHajj) {
                return client.sendMessage(from, { text: "❌ معلش يا فنان.. اللي شغل اللعبة بس هو اللي يقدر يلغيها! 🤫" }, { quoted: m });
            }
            puzzleGames.delete(from);

            await client.sendMessage(from, { react: { text: "🛑", key: m.key } }).catch(() => {});
            return await client.sendMessage(from, { text: "🛑 تم إلغاء جيم البازل بنجاح بناءً على طلبكم. نراكم في تحدي آخر! 🧩" }, { quoted: m });
        }

        // 3️⃣ أمر تلميح بازل
        if (isHint) {
            if (game.hintsUsed >= 3) {
                await client.sendMessage(from, { react: { text: "❌", key: m.key } }).catch(() => {});
                return await client.sendMessage(from, { text: "⚠️ عذراً يا فنان! لقد استهلكت جميع التلميحات المتاحة لك في هذا الجيم (3/3). 🤔" }, { quoted: m });
            }

            game.hintsUsed++;
            const hintText = generateHint(game.board, game.emptyPos, game.mode, game.shapes) + `\n\n📊 تلميحاتك المستخدمة: (${game.hintsUsed}/3)`;

            await client.sendMessage(from, { react: { text: "🔍", key: m.key } }).catch(() => {});
            return await client.sendMessage(from, { text: hintText }, { quoted: m });
        }

        // 4️⃣ أمر التحريكات الفورية
        if (isMove) {
            let moved = false;
            let { row, col } = game.emptyPos;
            let moveDirection = msgClean;

            if (moveDirection === 'فوق' && row > 0) {
                game.board[row][col] = game.board[row - 1][col]; 
                game.board[row - 1][col] = "⬛"; 
                game.emptyPos.row--; 
                moved = true;
            } else if (moveDirection === 'تحت' && row < 2) {
                game.board[row][col] = game.board[row + 1][col];
                game.board[row + 1][col] = "⬛"; 
                game.emptyPos.row++; 
                moved = true;
            } else if (moveDirection === 'يمين' && col > 0) {
                game.board[row][col] = game.board[row][col - 1]; 
                game.board[row][col - 1] = "⬛"; 
                game.emptyPos.col--; 
                moved = true;
            } else if (moveDirection === 'شمال' && col < 2) {
                game.board[row][col] = game.board[row][col + 1]; 
                game.board[row][col + 1] = "⬛"; 
                game.emptyPos.col++; 
                moved = true;
            }

            if (moved) {
                game.moves++;
                const currentStatus = game.board.flat().join("");
                const winningStatus = "12345678⬛";

                await client.sendMessage(from, { react: { text: "🎮", key: m.key } }).catch(() => {});

                if (currentStatus === winningStatus) {
                    puzzleGames.delete(from);

                    try {
                        const dbPath = path.join(process.cwd(), 'scramble_db.json');
                        if (fs.existsSync(dbPath)) {
                            let db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
                            if (!db.users) db.users = {};
                            let cleanSender = sender.split('@')[0].split(':')[0] + '@s.whatsapp.net';
                            if (!db.users[cleanSender]) {
                                db.users[cleanSender] = { name: m.pushName || 'عضو جديد', points: 1000, level: 1, isInfinite: false };
                            }
                            if (!db.users[cleanSender].isInfinite) {
                                db.users[cleanSender].points = (db.users[cleanSender].points || 0) + 500;
                                db.users[cleanSender].level = (db.users[cleanSender].level || 1) + 1;
                            }
                            fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
                        }
                    } catch (e) {
                        console.error("Error saving puzzle points:", e);
                    }
                    
                    let winMsg = `🎉 *طررررش! فوز ساحق، تم ترتيب البازل بنجاح!* 🎉\n`;
                    winMsg += `*━━━━━━━━━━━━━━━━━━━━━*\n\n`;
                    winMsg += `👤 العبقري الفائز: @${sender.split('@')[0]}\n`;
                    winMsg += `📊 إجمالي الحركات: *${game.moves}* حركة.\n`;
                    winMsg += `💰 جائزة الذكاء: *500 نقطة* تم إضافتها لحسابك تلقائياً! 👑✨`;
                    return await client.sendMessage(from, { text: winMsg, mentions: [sender] }, { quoted: m });
                } else {
                    let updateMsg = `🧩 *الحركة رقم: ${game.moves}*\n`;
                    updateMsg += `-------------------------\n`;
                    updateMsg += `📋 *لوحتك الحالية:*\n`;
                    updateMsg += game.mode === 'اشكال' ? renderShapeBoard(game.board, game.shapes) : renderNumberBoard(game.board);
                    updateMsg += `\n\n`;
                    updateMsg += `🏆 *الهدف المطلوب تقليده:*\n`;
                    updateMsg += renderTargetBoard(game.mode, game.shapes);
                    updateMsg += `\n-------------------------\n`;
                    updateMsg += `🎮 تابع التحريك واكتب الاتجاه القادم مباشرة...`;
                    return await client.sendMessage(from, { text: updateMsg }, { quoted: m });
                }
            }
        }
    }
};

export default puzzleHandler;

