import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import http from 'http';
import v8 from 'v8';
import vm from 'vm';
import { handleAllMessages } from './handler.js';

// ⚡ تفعيل واستدعاء Garbage Collector وضبط استهلاك الذاكرة وتخفيف استهلاك الرام
try {
    v8.setFlagsFromString('--expose_gc');
    v8.setFlagsFromString('--optimize_for_size');
    v8.setFlagsFromString('--max_old_space_size=120');
    v8.setFlagsFromString('--max_semi_space_size=2');
    if (!global.gc) {
        global.gc = vm.runInNewContext('gc');
    }
} catch (_) {}

// 🧹 كتم سجلات Baileys / libsignal الضخمة الخاصة بالجلسات لمنع امتلاء الرام
const _origInfo = console.info;
console.info = function (...args) {
    if (typeof args[0] === 'string' && (args[0].includes('Closing session') || args[0].includes('SessionEntry'))) return;
    _origInfo.apply(console, args);
};

// ⚡ تحرير الذاكرة دورياً وبشكل مكثف للحفاظ على استهلاك الرام خفيفاً جداً
if (typeof global.gc === 'function') {
    setTimeout(() => { try { global.gc(); } catch (_) {} }, 3000);
    setTimeout(() => { try { global.gc(); } catch (_) {} }, 7000);
    setTimeout(() => { try { global.gc(); } catch (_) {} }, 15000);
    setInterval(() => {
        try { global.gc(); } catch (_) {}
    }, 25000);
}
// ⏰ استيراد دالة الأذكار التلقائية والترحيب من ملف الـ plugins
import { startAutoReminders } from './plugins/datels.js';
// 🤖 استيراد محرك البوتات الفرعية (Sub-Bots)
import { initAllSubBots } from './core/subbot.js';
// ✈️ استيراد محرك تليجرام الموحد (Telegram Bot Engine)
import { startTelegramBot, startTelegramWatchdog, stopTelegramBot, getTelegramStatus, OFFICIAL_TELEGRAM_TOKEN, getSanitizedTelegramToken } from './core/telegram.js';
import { loadLocalDB } from './core/database.js';

// 🌐 خادم ويب ولوحة تحكم مصغرة (HTTP Dashboard) لإدارة البوت وفحص حالته 24/7
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    // تفعيل بوت تليجرام الجديد فوراً في الذاكرة (@Shadowcomm_bot) وحظر التوكن القديم نهائياً
    if ((req.url === '/activate-new-telegram' || req.url === '/activate-telegram') && (req.method === 'POST' || req.method === 'GET')) {
        (async () => {
            try {
                const { loadLocalDB, saveLocalDB } = await import('./core/database.js');
                const db = loadLocalDB() || {};
                db.telegramToken = OFFICIAL_TELEGRAM_TOKEN;
                saveLocalDB(db);

                const startRes = await startTelegramBot(OFFICIAL_TELEGRAM_TOKEN);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`
                    <body style="font-family: Arial; text-align: center; padding: 50px; background: #0f172a; color: #fff;">
                        <h2 style="color: #4ade80;">🎉 تم تفعيل وتشغيل بوت تليجرام الجديد بنجاح 100%!</h2>
                        <p style="font-size: 16px;">تم إيقاف البوت القديم وتوجيه البوت للعمل فوراً على المعرف الجديد الشغال مع جوجل بلاي وكل الأنظمة:</p>
                        <p style="font-size: 24px; color: #38bdf8; font-weight: bold; margin: 15px 0;">@${startRes.botInfo?.username || 'Shadowcomm_bot'}</p>
                        <a href="https://t.me/${startRes.botInfo?.username || 'Shadowcomm_bot'}" target="_blank" style="display:inline-block; margin-top:15px; padding:12px 25px; background:#38bdf8; color:#000; text-decoration:none; border-radius:8px; font-weight:bold; font-size:16px;">فتح البوت في تليجرام وتجربته 🚀</a>
                        <br><br><a href="/" style="color: #94a3b8;">العودة للوحة التحكم</a>
                    </body>
                `);
                return;
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('خطأ أثناء تفعيل تليجرام: ' + (e?.message || e));
            }
        })();
        return;
    }

    if (req.method === 'POST' && req.url === '/set-telegram') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const params = new URLSearchParams(body);
                const token = params.get('token')?.trim();
                if (token) {
                    const startRes = await startTelegramBot(token);
                    if (startRes.success) {
                        const { loadLocalDB, saveLocalDB } = await import('./core/database.js');
                        const db = loadLocalDB();
                        db.telegramToken = token;
                        saveLocalDB(db);
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`
                            <body style="font-family: Arial; text-align: center; padding: 50px; background: #0f172a; color: #fff;">
                                <h2 style="color: #4ade80;">✅ تم ربط وتشغيل بوت تليجرام بنجاح!</h2>
                                <p>اسم البوت: <b>${startRes.botInfo?.first_name}</b> (@${startRes.botInfo?.username})</p>
                                <a href="https://t.me/${startRes.botInfo?.username}" target="_blank" style="display:inline-block; margin-top:15px; padding:10px 20px; background:#38bdf8; color:#000; text-decoration:none; border-radius:8px; font-weight:bold;">فتح البوت في تليجرام 🚀</a>
                                <br><br><a href="/" style="color: #94a3b8;">العودة للوحة التحكم</a>
                            </body>
                        `);
                        return;
                    }
                }
            } catch (_) {}
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<body style="font-family: Arial; text-align: center; padding: 50px; background: #0f172a; color: #fff;"><h2 style="color: #ef4444;">❌ فشل التحقق من توكن تليجرام!</h2><p>تأكد من صحة التوكن المأخوذ من @BotFather وحاول ثانية.</p><br><a href="/" style="color: #38bdf8;">العودة</a></body>`);
        });
        return;
    }

    // حفظ وتعيين رقم البوت الأساسي الجديد وطلب كود اقتران
    if (req.method === 'POST' && req.url === '/set-bot-number') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const params = new URLSearchParams(body);
                const rawPhone = params.get('phone')?.trim();
                const cleanPhone = rawPhone?.replace(/[^0-9]/g, '');
                if (cleanPhone && cleanPhone.length >= 8) {
                    const numFile = path.join(process.cwd(), 'bot_number.json');
                    fs.writeFileSync(numFile, JSON.stringify({ phone: cleanPhone }, null, 2), 'utf8');

                    // تصفير الجلسة القديمة لربط الرقم الجديد بنظافة تامة
                    const sessionDir = path.join(process.cwd(), 'session_data');
                    if (fs.existsSync(sessionDir)) {
                        const files = fs.readdirSync(sessionDir);
                        for (const file of files) {
                            if (file !== 'scramble_db_backup.json') {
                                try { fs.rmSync(path.join(sessionDir, file), { recursive: true, force: true }); } catch (_) {}
                            }
                        }
                    }

                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`
                        <body style="font-family: Arial; text-align: center; padding: 50px; background: #0f172a; color: #fff;">
                            <h2 style="color: #4ade80;">✅ تم حفظ رقم البوت الأساسي الجديد: +${cleanPhone}</h2>
                            <p>جاري إعادة تشغيل السيرفر وتوليد كود الاقتران الجديد الآن...<br>انتظر 5 ثوانٍ ثم اضغط على الزر أدناه لرؤية الكود.</p>
                            <br><a href="/" style="display:inline-block; padding:10px 20px; background:#38bdf8; color:#000; text-decoration:none; border-radius:8px; font-weight:bold;">العودة لرؤية كود الاقتران 🔑</a>
                        </body>
                    `);
                    setTimeout(() => { process.exit(0); }, 1500);
                    return;
                }
            } catch (_) {}
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<body style="font-family: Arial; text-align: center; padding: 50px; background: #0f172a; color: #fff;"><h2 style="color: #ef4444;">❌ يرجى إدخال رقم هاتف صحيح!</h2><br><a href="/" style="color: #38bdf8;">العودة</a></body>`);
        });
        return;
    }

    // تصفير جلسة البوت الأساسي لربط رقم جديد من الصفر
    if (req.url === '/reset-main-bot' && (req.method === 'POST' || req.method === 'GET')) {
        try {
            const sessionDir = path.join(process.cwd(), 'session_data');
            if (fs.existsSync(sessionDir)) {
                const files = fs.readdirSync(sessionDir);
                for (const file of files) {
                    if (file !== 'scramble_db_backup.json') {
                        try {
                            fs.rmSync(path.join(sessionDir, file), { recursive: true, force: true });
                        } catch (_) {}
                    }
                }
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <body style="font-family: Arial; text-align: center; padding: 50px; background: #0f172a; color: #fff;">
                    <h2 style="color: #4ade80;">✅ تم تصفير جلسة البوت الأساسي بنجاح!</h2>
                    <p>سيتم إعادة تشغيل السيرفر وطلب كود اقتران جديد الآن.<br>البوتات الفرعية آمنة وشغالة بنسبة 100%.</p>
                    <br><a href="/" style="color: #38bdf8;">العودة للوحة التحكم</a>
                </body>
            `);
            setTimeout(() => {
                process.exit(0);
            }, 1000);
            return;
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('خطأ أثناء تصفير الجلسة: ' + (e?.message || e));
            return;
        }
    }

    // إذا كان الطلب من تطبيق فحص (UptimeRobot / JSON Request)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            status: 'online',
            bot: 'Shadow Bot',
            uptime: `${Math.floor(process.uptime())}s`,
            telegram: getTelegramStatus().isActive ? 'connected' : 'disabled',
            message: 'البوت متصل وشغال 24 ساعة بنجاح! 🚀'
        }));
        return;
    }

    // عرض واجهة ويب خفيفة وسهلة لإدارة البوت وربط تليجرام مباشرة بدون واتساب
    const tg = getTelegramStatus();
    const isWaConnected = Boolean(global.conn?.user?.id && global.conn?.ws?.isOpen !== false);
    const waUserNum = global.conn?.user?.id?.split(':')[0]?.replace(/[^0-9]/g, '') || '';
    const pairCode = global.latestPairingCode || '';
    const pairPhone = global.latestPairingPhone || '';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${!isWaConnected ? '<meta http-equiv="refresh" content="5">' : ''}
            <title>لوحة تحكم شادو بوت | Shadow Bot</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 25px; text-align: center; }
                .card { max-width: 540px; margin: 20px auto; background: #1e293b; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); border: 1px solid #334155; }
                h1 { color: #38bdf8; margin-top: 0; }
                .status-badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: bold; margin: 8px 0; font-size: 14px; }
                .online { background: #065f46; color: #34d399; }
                .waiting { background: #854d0e; color: #facc15; }
                .input-box { width: 100%; box-sizing: border-box; padding: 12px; margin: 12px 0; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; font-size: 14px; text-align: left; direction: ltr; }
                .btn { background: #2563eb; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px; width: 100%; transition: 0.2s; }
                .btn:hover { background: #1d4ed8; }
                .hint { color: #94a3b8; font-size: 13px; line-height: 1.6; text-align: right; margin-top: 15px; background: #0f172a; padding: 12px; border-radius: 8px; }
                .code-box { background: #0284c7; color: #fff; font-size: 26px; font-weight: bold; letter-spacing: 4px; padding: 12px; border-radius: 10px; margin: 15px 0; user-select: all; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🤖 شادو بوت | Shadow Bot</h1>
                <div class="status-badge online">🟢 السيرفر يعمل بكفاءة 24/7</div>
                <br>
                <div class="status-badge ${isWaConnected ? 'online' : 'waiting'}">
                    ${isWaConnected ? '🟢 واتساب الأساسي: متصل ومحمي (+ ' + waUserNum + ')' : (pairCode ? '🔑 كود ربط واتساب جاهز للاستخدام' : '⏳ واتساب الأساسي: جاري إعداد الاتصال')}
                </div>
                <p>الحالة على تليجرام: <b>${tg.isActive ? '⚡ متصل (@' + tg.username + ')' : '🛑 غير مربوط حالياً'}</b></p>
                <div style="margin: 10px 0 20px 0;">
                    <a href="/activate-new-telegram" style="display: inline-block; padding: 10px 18px; background: #10b981; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px;">⚡ تفعيل بوت تليجرام الجديد فوراً (@Shadowcomm_bot)</a>
                </div>

                ${pairCode ? `
                    <div style="background: #0f172a; border: 2px dashed #38bdf8; padding: 15px; border-radius: 12px; margin: 20px 0;">
                        <h3 style="color: #38bdf8; margin: 0 0 5px 0;">🔑 كود اقتران واتساب لرقم (+${pairPhone}):</h3>
                        <div class="code-box">${pairCode}</div>
                        <p style="font-size: 13px; color: #cbd5e1; margin: 0; line-height: 1.6;">
                            📱 افتح واتساب في هاتفك ➔ الأجهزة المرتبطة ➔ ربط جهاز ➔ ربط باستخدام رقم الهاتف ➔ واكتب الكود أعلاه!
                        </p>
                    </div>
                ` : ''}
                
                <hr style="border: 0; border-top: 1px solid #334155; margin: 20px 0;">

                <h3>📱 ربط أو تغيير رقم البوت الأساسي (واتساب)</h3>
                <form action="/set-bot-number" method="POST">
                    <input class="input-box" type="text" name="phone" placeholder="أدخل رقم البوت الجديد مع كود الدولة (مثال: 2010... أو 1...)" required>
                    <button class="btn" type="submit">طلب كود الاقتران للرقم الجديد 🚀</button>
                </form>

                <hr style="border: 0; border-top: 1px solid #334155; margin: 20px 0;">

                <h3>✈️ ربط البوت بتليجرام مباشرة (بدون واتساب)</h3>
                <form action="/set-telegram" method="POST">
                    <input class="input-box" type="text" name="token" placeholder="الصق توكن تليجرام هنا (من @BotFather)" required>
                    <button class="btn" type="submit">ربط وتشغيل البوت على تليجرام 🚀</button>
                </form>

                <div class="hint">
                    <b>💡 خطوات استخراج التوكن في 30 ثانية مجاناً وبدون أي حظر:</b><br>
                    1. افتح تطبيق تليجرام وابحث عن الحساب الرسمي: <b>@BotFather</b><br>
                    2. اضغط Start واكتب له أمر: <b>/newbot</b><br>
                    3. اختر اسماً للبوت، ثم يوزراً ينتهي بكلمة bot.<br>
                    4. انسخ التوكن (Token) وضعه في المربع بالأعلى واضغط ربط!
                </div>

                <hr style="border: 0; border-top: 1px solid #334155; margin: 20px 0;">

                <h3>🔄 تصفير جلسة البوت الأساسي لربط رقم جديد</h3>
                <p style="font-size: 13px; color: #94a3b8; line-height: 1.6;">إذا تم حظر رقم البوت الأساسي، يمكنك تصفير جلسته لربط رقم جديد من الصفر دون المساس بالبوتات الفرعية إطلاقاً.</p>
                <form action="/reset-main-bot" method="POST" onsubmit="return confirm('هل أنت متأكد من تصفير جلسة البوت الأساسي لربط رقم جديد؟ (البوتات الفرعية لن تتأثر)');">
                    <button class="btn" type="submit" style="background: #dc2626;">تصفير الجلسة وطلب كود جديد 🔄</button>
                </form>
            </div>
        </body>
        </html>
    `);
});
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 [Web Server] خادم فحص الحالة شغال وجاهز لاستقبال Ping على البورت ${PORT}`);
});

// 🤖 تشغيل واسترجاع جميع البوتات الفرعية (Sub-Bots) بشكل مستقل تماماً في حال كان البوت الأساسي مفصولاً
setTimeout(() => {
    try {
        if (!global.conn || !global.conn.user) {
            console.log('⚡ [Sub-Bots Standalone Boot] بدء تشغيل البوتات الفرعية باستقلالية (البوت الأساسي غير متصل بعد)...');
            initAllSubBots(global.conn || null);
        }
    } catch (err) {
        console.error('❌ خطأ في الإقلاع المستقل للبوتات الفرعية:', err);
    }
}, 12000);

// ✈️ تشغيل بوت تليجرام تلقائياً ومراقبته على السيرفر سحابياً 24/7 دون الحاجة لأي كمبيوتر
setTimeout(async () => {
    try {
        const tgToken = getSanitizedTelegramToken();
        console.log('✈️ [Telegram] جاري تشغيل بوت تليجرام السحابي 24/7 على الاستضافة...');
        await startTelegramBot(tgToken);
        startTelegramWatchdog(tgToken);

        // ⏰ تشغيل نظام الأذكار والصلوات ومواقيت القفل والفتح 24/7 للبوتات الفرعية والأساسي
        try {
            startAutoReminders();
        } catch (_) {}
    } catch (e) {
        console.error('❌ خطأ في تشغيل بوت تليجرام التلقائي:', e);
        startTelegramWatchdog(OFFICIAL_TELEGRAM_TOKEN);
    }
}, 3500);

// 🛡️ حماية العملية من الانهيار عند حدوث أي خطأ بالشبكة أو السوكيت
process.on('uncaughtException', (err) => {
    console.error('⚠️ [Uncaught Exception]:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [Unhandled Rejection]:', reason?.message || reason);
});

// ⚙️ إعدادات البوت العالمية (Global Settings)
global.setting = {
    clearSesi: false, // تنظيف كاش الجلسات الـ Trash (مغلق حالياً)
    clearTmp: true,   // تنظيف المجلد المؤقت تلقائياً لمنع امتلاء المساحة
    addReply: false   // تفعيل الرد مع إظهار الصورة المصغرة (Thumbnail) في الرسائل
};

const botSentMsgIds = new Set();
global.botSentMsgIds = botSentMsgIds;

// 🗃️ كاش رسائل لـ Baileys لدعم media retry وتشفير الوسائط المشفرة (مهم لواتساب أعمال)
// يخزن آخر 2000 رسالة فقط ليقدر Baileys يعمل reupload عند الحاجة
const mainMsgStore = new Map();
global.mainMsgStore = mainMsgStore;

// ⏰ وقت تشغيل البوت الحالي لتجاهل أي رسائل قديمة وصلت أثناء إيقاف البوت
global.botStartTime = Math.floor(Date.now() / 1000);

export function getMsgTimestamp(m) {
    if (!m) return 0;
    let ts = m.messageTimestamp;
    if (ts === undefined || ts === null) {
        ts = m.key?.timestamp || m.message?.messageContextInfo?.deviceListMetadata?.senderTimestamp;
    }
    if (ts === undefined || ts === null) return 0;

    let num = 0;
    if (typeof ts === 'number') {
        num = ts;
    } else if (typeof ts === 'string') {
        num = parseInt(ts, 10) || 0;
    } else if (typeof ts === 'object') {
        if (typeof ts.toNumber === 'function') {
            num = ts.toNumber();
        } else if (typeof ts.low === 'number') {
            const high = typeof ts.high === 'number' ? ts.high : 0;
            num = (high * 4294967296) + (ts.low >>> 0);
        }
    }

    if (num > 1e11) {
        num = Math.floor(num / 1000);
    }
    return num;
}

let isReconnecting = false;

export async function startShadowBot() {
    global.startShadowBot = startShadowBot;
    // 🛑 تنظيف أي سوكيت قديم لمنع التعليق وتراكم السوكيتات عند انقطاع الإنترنت أو قفل الهاتف
    if (global.conn) {
        try {
            global.conn.ws?.removeAllListeners();
            global.conn.ws?.close();
            global.conn.ev?.removeAllListeners();
        } catch (_) {}
    }

    // 🧹 تنفيذ تصفير بيانات الجلسة القديمة للبوت الأساسي فقط عند طلب التصفير (لضمان كود ربط نظيف 100%)
    try {
        const resetFlagFile = path.join(process.cwd(), 'force_reset_main.json');
        const resetDoneFile = path.join(process.cwd(), 'last_reset_applied.txt');
        if (fs.existsSync(resetFlagFile)) {
            const flagData = JSON.parse(fs.readFileSync(resetFlagFile, 'utf8') || '{}');
            const token = flagData.resetToken || '';
            let appliedToken = '';
            if (fs.existsSync(resetDoneFile)) {
                appliedToken = fs.readFileSync(resetDoneFile, 'utf8').trim();
            }
            if (token && token !== appliedToken) {
                console.log('🧹 [Force Reset] جاري مسح جلسة البوت الأساسي القديمة وتوليد كود ربط جديد نظيف...');
                const sessionDir = path.join(process.cwd(), 'session_data');
                if (fs.existsSync(sessionDir)) {
                    const files = fs.readdirSync(sessionDir);
                    for (const file of files) {
                        if (file !== 'scramble_db_backup.json') {
                            try { fs.rmSync(path.join(sessionDir, file), { recursive: true, force: true }); } catch (_) {}
                        }
                    }
                }
                fs.writeFileSync(resetDoneFile, token, 'utf8');
                global.latestPairingCode = null;
                console.log('✅ [Force Reset] تم مسح session_data بنجاح! البوتات الفرعية آمنة 100%.');
            }
        }
    } catch (e) {
        console.error('❌ خطأ أثناء تطبيق التصفير الإجباري:', e?.message || e);
    }

    // 📁 استخدام مجلد الجلسة الخاص بالبوت لضمان حفظ الاتصال
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    
    // 🔄 جلب أحدث إصدار توافقي تلقائياً لتفادي خطأ 405
    const { version } = await fetchLatestBaileysVersion();

    const conn = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent', enabled: false }))
        },
        version,
        // 🌐 محاكاة متصفح لينكس كروم معتمد رسمياً لمنع الحظر والتعرف التلقائي
        browser: ['Windows', 'Chrome', '131.0.6778.86'],
        // 🔥 قفل كلي وصارم لكل أنواع اللوجات والباينري لمنع التهنيج وسرعة الاستجابة
        logger: pino({ level: 'silent', enabled: false }),
        printQRInTerminal: false,
        syncPhonenumber: true,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2000,
        maxMsgRetryCount: 5,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        fireInitQueries: false,
        shouldSyncHistoryMessage: () => false, // تجاهل الرسائل القديمة تماماً لعدم تكرار الردود عند التشغيل
        shouldIgnoreJid: () => false,
        // 🛑 إرجاع undefined عند عدم توفر الرسالة لمنع بايلز من إرسال رسائل فارغة أو نقط (. / conversation: '') عند طلب retry
        getMessage: async (key) => {
            if (key?.id && mainMsgStore.has(key.id)) {
                return mainMsgStore.get(key.id);
            }
            return undefined;
        }
    });

    global.conn = conn;

    // 🛑 تتبع وتفادي تكرار ردود البوت على رسائله هو فقط
    const originalSendMessage = conn.sendMessage.bind(conn);
    conn.sendMessage = async (...args) => {
        try {
            // 🛑 فلتر أمني صارم: منع إرسال أي رسالة فارغة أو نقط لوحدها (. أو .. إلخ) من البوت الأساسي
            if (args[1] && typeof args[1] === 'object') {
                if (args[1].text !== undefined) {
                    if (typeof args[1].text !== 'string') {
                        args[1].text = String(args[1].text || '');
                    }
                    const cleanText = args[1].text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
                    if (!cleanText || /^\.+$/.test(cleanText)) {
                        console.warn(`🛑 [Main-Bot Filter] تم منع إرسال رسالة فارغة أو نقط فاضية تلقائياً: "${args[1].text}"`);
                        return null;
                    }
                }
                if (args[1].caption !== undefined && typeof args[1].caption === 'string') {
                    const cleanCap = args[1].caption.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
                    if (!cleanCap || /^\.+$/.test(cleanCap)) {
                        args[1].caption = '';
                    }
                }
            }
            // 🛡️ تشديد أمان واتساب: محاكاة الكتابة البشرية (Typing Presence) لمنع الحظر التلقائي من خوارزميات واتساب
            const targetJid = args[0];
            if (targetJid && typeof targetJid === 'string' && !targetJid.includes('status@broadcast')) {
                try {
                    await conn.sendPresenceUpdate('composing', targetJid);
                    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 350) + 250));
                } catch (_) {}
            }

            const res = await originalSendMessage(...args);

            try {
                if (targetJid && typeof targetJid === 'string' && !targetJid.includes('status@broadcast')) {
                    conn.sendPresenceUpdate('paused', targetJid).catch(() => {});
                }
            } catch (_) {}
            if (res?.key?.id) {
                botSentMsgIds.add(res.key.id);
                conn.sentMsgIds = conn.sentMsgIds || new Set();
                conn.sentMsgIds.add(res.key.id);
                setTimeout(() => {
                    botSentMsgIds.delete(res.key.id);
                    conn.sentMsgIds?.delete(res.key.id);
                }, 120000);
            }
            return res;
        } catch (e) {
            console.error('❌ خطأ في إرسال الرسالة:', e?.message || e);
            throw e;
        }
    };

    // 🎮 [تأمين الكاشات - الربط الصارم مع الـ Handler لمنع سبام النقط والـ Reacts والألعاب]
    conn.football = conn.football || {};
    conn.obito = conn.obito || {};
    conn.scramble = conn.scramble || {};
    conn.movies = conn.movies || {};
    conn.gameSolo = conn.gameSolo || {};
    conn.game = conn.game || {};

    // تثبيت المتغيرات العالمية للألعاب منعاً للتخريف والـ Loops
    if (!global.bakasa) global.bakasa = {};

    let isPairingRequested = false;

    // حفظ بيانات الجلسة عند التحديث تلقائياً (تجنباً لخروج البوت)
    conn.ev.on('creds.update', async () => {
        await saveCreds();
    });

    // مراقبة حالة الاتصال وإعادة الربط التلقائي عند الفصل
    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        // 🔑 طلب كود الربط بطريقة آمنة وسريعة إذا كان البوت غير مسجل
        if (!conn.authState.creds.registered && !isPairingRequested) {
            isPairingRequested = true;
            setTimeout(async () => {
                try {
                    if (conn.authState.creds.registered) return;
                    let targetBotPhone = '201229409956';
                    try {
                        const numFile = path.join(process.cwd(), 'bot_number.json');
                        if (fs.existsSync(numFile)) {
                            const parsed = JSON.parse(fs.readFileSync(numFile, 'utf8'));
                            if (parsed.phone) targetBotPhone = String(parsed.phone);
                        }
                    } catch (_) {}
                    if (process.env.BOT_NUMBER) targetBotPhone = String(process.env.BOT_NUMBER);
                    let phoneNumber = targetBotPhone.replace(/[^0-9]/g, '');

                    let code = await conn.requestPairingCode(phoneNumber);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    global.latestPairingCode = code;
                    global.latestPairingPhone = phoneNumber;

                    console.log('\n====================================');
                    console.log(`🤖 SHADOW BOT PAIRING CODE (+${phoneNumber}):`, code);
                    console.log('====================================\n');

                    // إرسال كود الاقتران عبر تليجرام أيضاً إن كان البوت يعمل على تليجرام
                    try {
                        const { sendTelegramMessage } = await import('./core/telegram.js');
                        const dbPath = path.join(process.cwd(), 'scramble_db.json');
                        if (fs.existsSync(dbPath)) {
                            const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                            const token = db.telegramToken;
                            const hajjChat = db.hajjTelegramChatId || db.masterTelegramChatId;
                            if (token && hajjChat) {
                                await sendTelegramMessage(token, hajjChat, `🔑 *كود اقتران البوت الأساسي الجديد (+${phoneNumber}):*\n\n\`${code}\`\n\n📌 انسخ الكود وضعه في واتساب - الأجهزة المرتبطة.`);
                            }
                        }
                    } catch (_) {}
                } catch (err) {
                    console.error('❌ خطأ في طلب كود الربط:', err?.message || err);
                    isPairingRequested = false;
                }
            }, 3000);
        }

        if (connection === 'open') {
            global.botStartTime = Math.floor(Date.now() / 1000);
            global.latestPairingCode = null; // تم الاقتران بنجاح
            console.log('\n==================================================');
            console.log('✅ [Shadow Bot] متصل الآن وشغال بأعلى كفاءة خاص وجروبات! 🎉');
            console.log('🤖 تم تشغيل البوت بنجاح.. جاهز لاستقبال الأوامر.');
            console.log('==================================================\n');

            // 🎯 تشغيل عداد الأذكار ومواقيت الصلاة التلقائي فوراً وبشكل مستقل
            try {
                startAutoReminders(conn);
            } catch (err) {
                console.error('❌ خطأ في تشغيل عداد الأذكار التلقائي:', err);
            }

            // 👥 مزامنة وتسجيل جميع المجموعات التي يتواجد بها البوت تلقائياً فور الاتصال (مع مهلة استقرار للشبكة)
            setTimeout(async () => {
                try {
                    if (conn?.user?.id && typeof conn.groupFetchAllParticipating === 'function') {
                        const participatingGroups = await conn.groupFetchAllParticipating();
                        if (participatingGroups && typeof participatingGroups === 'object') {
                            const { loadLocalDB, saveLocalDB } = await import('./core/database.js');
                            const db = loadLocalDB();
                            if (!db.knownGroups) db.knownGroups = [];
                            let added = 0;
                            for (const gid of Object.keys(participatingGroups)) {
                                if (gid && gid.endsWith('@g.us') && !db.knownGroups.includes(gid)) {
                                    db.knownGroups.push(gid);
                                    added++;
                                }
                            }
                            if (added > 0) {
                                saveLocalDB(db);
                                console.log(`📡 [Groups Sync] تم تحديث وتسجيل ${added} مجموعة جديدة تلقائياً.`);
                            }
                        }
                    }
                } catch (_) {}
            }, 5000);

            // 🤖 تشغيل واسترجاع جميع البوتات الفرعية (Sub-Bots) المسجلة
            try {
                initAllSubBots(conn);
            } catch (err) {
                console.error('❌ خطأ في تشغيل البوتات الفرعية:', err);
            }

            // 🧹 تنظيف مجلد الـ Tmp تلقائياً عند اتصال البوت لتوفير المساحة
            if (global.setting.clearTmp) {
                const tmpDir = path.join(process.cwd(), 'tmp');
                if (fs.existsSync(tmpDir)) {
                    fs.readdirSync(tmpDir).forEach(file => {
                        try {
                            fs.unlinkSync(path.join(tmpDir, file));
                        } catch (e) {}
                    });
                    console.log('🧹 [System] تم تنظيف مجلد الملفات المؤقتة (tmp) بنجاح.');
                }
            }
        }

        if (connection === 'close') {
            isPairingRequested = false;
            const reason = lastDisconnect?.error?.output?.statusCode;
            const isRegistered = Boolean(conn.authState?.creds?.registered);
            console.log(`⚠️ [Main-Bot] انقطع الاتصال! الكود: ${reason} (مسجل: ${isRegistered})`);

            // 🛑 إذا تم تسجيل الخروج من واتساب (401)
            if (reason === DisconnectReason.loggedOut || reason === 401) {
                console.log(`❌ [Shadow Bot] تم تسجيل خروج جلسة البوت الأساسي (401). جاري تنظيف الجلسة لإتاحة ربط جديد فوراً...`);
                try {
                    const sessionDir = path.join(process.cwd(), 'session_data');
                    if (fs.existsSync(sessionDir)) {
                        const files = fs.readdirSync(sessionDir);
                        for (const file of files) {
                            if (file !== 'scramble_db_backup.json') {
                                try { fs.rmSync(path.join(sessionDir, file), { recursive: true, force: true }); } catch (_) {}
                            }
                        }
                    }
                } catch (_) {}
                global.latestPairingCode = null;
                if (!isReconnecting) {
                    isReconnecting = true;
                    setTimeout(() => {
                        isReconnecting = false;
                        startShadowBot();
                    }, 3000);
                }
                return;
            }

            // 🛑 الحظر الصريح من واتساب فقط هو كود 403
            const isBanned = reason === 403;
            if (isBanned) {
                console.log(`❌ [Shadow Bot] تم حظر رقم البوت الأساسي من واتساب (403).`);
                return;
            }

            // لا نقوم بمسح الجلسة أبداً تلقائياً، بل نعيد الاتصال دائماً للحفاظ على استقرار البوت ورقمك
            if (!isReconnecting) {
                isReconnecting = true;
                const delayMs = (reason === 515 || reason === DisconnectReason.restartRequired) ? 1500 : 3500;
                console.log(`🔄 [Main-Bot] جاري إعادة الاتصال التلقائي النظيف بعد ${delayMs / 1000} ثوانٍ...`);
                setTimeout(() => {
                    isReconnecting = false;
                    startShadowBot();
                }, delayMs);
            }
        }
    });

    // 📩 استقبال وفحص الرسائل الواردة وتوجيهها لملف الهاندلر
    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;

            // 📸 التقاط وتخزين رسائل الـ View-Once وتخزين الكاش فوراً لكل الرسائل (سواء notify أو append من هاتف البوت/واتساب أعمال)
            for (const m of chatUpdate.messages) {
                if (!m || !m.message) continue;
                if (m.key?.id && m.message) {
                    mainMsgStore.set(m.key.id, m.message);
                    if (mainMsgStore.size > 50) {
                        const firstKey = mainMsgStore.keys().next().value;
                        mainMsgStore.delete(firstKey);
                    }

                }
            }

            // تجاهل أي رسائل قديمة أو مزامنة أثناء إيقاف البوت عند تشغيل الأوامر
            if (chatUpdate.type !== 'notify') return;

            const nowSec = Math.floor(Date.now() / 1000);
            const activeStart = global.botStartTime || nowSec;

            for (const m of chatUpdate.messages) {
                if (!m || !m.message) continue;

                // ⏰ تجاهل قاطع وفوري للرسائل القديمة جداً فقط (أكثر من دقيقتين) لمنع مشاكل فرق توقيت السيرفر
                const msgTime = getMsgTimestamp(m);
                if (msgTime > 0) {
                    if (msgTime < (activeStart - 25) || (nowSec - msgTime) > 180) {
                        continue;
                    }
                }

                // تجاهل الرسائل الصادرة برمجياً من البوت نفسه فقط
                if (m.key.id && botSentMsgIds.has(m.key.id)) continue;

                const from = m.key.remoteJid;
                if (!from) continue;

                // 📡 تسجيل أي جروب نشط تلقائياً لضمان وصول الأذكار والصلوات إليه
                if (from.endsWith('@g.us')) {
                    try {
                        const { loadLocalDB, saveLocalDB } = await import('./core/database.js');
                        const db = loadLocalDB();
                        if (!db.knownGroups) db.knownGroups = [];
                        if (!db.knownGroups.includes(from)) {
                            db.knownGroups.push(from);
                            saveLocalDB(db);
                        }
                    } catch (_) {}
                }

                // 🚀 تمرير الرسالة فوراً للمفسر (Handler)
                await handleAllMessages(m, conn);
            }
        } catch (err) {
            console.error('❌ خطأ في استقبال الرسائل وتوجيهها:', err);
        }
    });

    // 📥 تسجيل المجموعات فور انضمام البوت أو تحديثها لضمان وصول الأذكار والصلوات فوراً
    conn.ev.on('groups.upsert', async (groups) => {
        try {
            const { loadLocalDB, saveLocalDB } = await import('./core/database.js');
            const db = loadLocalDB();
            if (!db.knownGroups) db.knownGroups = [];
            let updated = false;
            for (const g of groups) {
                const gid = g.id;
                if (gid && gid.endsWith('@g.us') && !db.knownGroups.includes(gid)) {
                    db.knownGroups.push(gid);
                    updated = true;
                }
            }
            if (updated) saveLocalDB(db);
        } catch (_) {}
    });

    // 🔥 الترحيب التلقائي الذكي وتسجيل الجروب لأي عضو ينضم للجروب بشكل مباشر
    conn.ev.on('group-participants.update', async (update) => {
        try {
            if (update?.id && update.id.endsWith('@g.us')) {
                const { loadLocalDB, saveLocalDB } = await import('./core/database.js');
                const db = loadLocalDB();
                if (!db.knownGroups) db.knownGroups = [];
                if (!db.knownGroups.includes(update.id)) {
                    db.knownGroups.push(update.id);
                    saveLocalDB(db);
                }
            }

            // استدعاء ملف datels لتنفيذ دالة الترحيب الموحدة
            const datelsModule = await import('./plugins/datels.js');
            const handler = datelsModule.default || datelsModule;
            if (handler && typeof handler.participantsUpdate === 'function') {
                await handler.participantsUpdate(update, conn);
            }
        } catch (err) {
            console.error('❌ خطأ في تشغيل الترحيب التلقائي للجروب:', err);
        }
    });
}

// تشغيل البوت الأساسي لشادو
startShadowBot();
