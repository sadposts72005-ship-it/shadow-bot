import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { handleAllMessages } from './handler.js';
// ⏰ استيراد دالة الأذكار التلقائية والترحيب من ملف الـ plugins
import { startAutoReminders } from './plugins/datels.js';
// 🤖 استيراد محرك البوتات الفرعية (Sub-Bots)
import { initAllSubBots } from './core/subbot.js';

// 🌐 خادم ويب مصغر (HTTP Server) لإبقاء البوت نشطاً 24/7 على منصات السحاب (Render / Koyeb / UptimeRobot)
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
        status: 'online',
        bot: 'Shadow Bot',
        uptime: `${Math.floor(process.uptime())}s`,
        message: 'البوت متصل وشغال 24 ساعة بنجاح! 🚀'
    }));
});
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 [Web Server] خادم فحص الحالة شغال وجاهز لاستقبال Ping على البورت ${PORT}`);
});

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

async function startShadowBot() {
    // 📁 استخدام مجلد الجلسة الخاص بالبوت لضمان حفظ الاتصال
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    
    // 🔄 جلب أحدث إصدار توافقي تلقائياً لتفادي خطأ 405
    const { version } = await fetchLatestBaileysVersion();

    const conn = makeWASocket({
        auth: state,
        version,
        // 🌐 محاكاة متصفح حقيقي مقبولة من سيرفرات واتساب
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        // 🔥 قفل كلي وصارم لكل أنواع اللوجات والباينري لمنع التهنيج وسرعة الاستجابة في الترمكس
        logger: pino({ level: 'silent', enabled: false }),
        authProvider: {
            logger: pino({ level: 'silent', enabled: false })
        },
        printQRInTerminal: false,
        syncPhonenumber: true,
        defaultQueryTimeoutMs: undefined,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        fireInitQueries: false,
        shouldSyncHistoryMessage: () => false, // تجاهل الرسائل القديمة تماماً لعدم تكرار الردود عند التشغيل
        shouldIgnoreJid: () => false,
        // 🔓 استرجاع محتوى الرسائل بشكل صحيح في الخاص والجروبات لمنع التجاهل الصامت ومنع رسائل السبام
        getMessage: async (key) => {
            return { conversation: '' };
        }
    });

    // 🛑 تتبع وتفادي تكرار ردود البوت على رسائله هو فقط
    const originalSendMessage = conn.sendMessage.bind(conn);
    conn.sendMessage = async (...args) => {
        try {
            const res = await originalSendMessage(...args);
            if (res?.key?.id) {
                botSentMsgIds.add(res.key.id);
                setTimeout(() => botSentMsgIds.delete(res.key.id), 120000);
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

        // 🔑 طلب كود الربط بطريقة آمنة عند فتح السوكيت فقط إذا كان غير مربوط
        if (connection === 'connecting' && !conn.authState.creds.registered && !isPairingRequested) {
            isPairingRequested = true;
            setTimeout(async () => {
                try {
                    let phoneNumber = '201229409956'.replace(/[^0-9]/g, ''); // رقمك المرتبط بالبوت
                    let code = await conn.requestPairingCode(phoneNumber);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    console.log('\n====================================');
                    console.log('🤖 SHADOW BOT PAIRING CODE:', code);
                    console.log('====================================\n');
                } catch (err) {
                    console.error('❌ خطأ في طلب كود الربط:', err?.message || err);
                    isPairingRequested = false;
                }
            }, 6000);
        }

        if (connection === 'open') {
            global.botStartTime = Math.floor(Date.now() / 1000);
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
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ انفصل البوت! الكود: ${reason}. جاري إعادة الاتصال...`);
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => startShadowBot(), 3000); // إعادة تشغيل تلقائي بعد 3 ثوانٍ
            }
        }
    });

    // 📩 استقبال وفحص الرسائل الواردة وتوجيهها لملف الهاندلر
    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            // تجاهل أي رسائل قديمة أو مزامنة أثناء إيقاف البوت
            if (chatUpdate.type !== 'notify') return;
            if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;

            const nowSec = Math.floor(Date.now() / 1000);
            const activeStart = global.botStartTime || nowSec;

            for (const m of chatUpdate.messages) {
                if (!m || !m.message) continue;

                // ⏰ تجاهل قاطع وفوري لأي رسالة قديمة:
                // 1. إذا كان توقيت الرسالة قبل لحظة تشغيل البوت الحالي
                // 2. أو إذا كان عمر الرسالة أقدم من 30 ثانية من الآن
                // 3. أو إذا لم نتمكن من قراءة توقيت الرسالة أثناء أول 45 ثانية من فتح الاتصال (فترة المزامنة)
                const msgTime = getMsgTimestamp(m);
                if (msgTime > 0) {
                    if (msgTime < (activeStart - 2) || msgTime < (nowSec - 30)) {
                        continue;
                    }
                } else {
                    if ((nowSec - activeStart) < 45) {
                        continue;
                    }
                }

                // تجاهل الرسائل الصادرة برمجياً من البوت نفسه فقط
                if (m.key.id && botSentMsgIds.has(m.key.id)) continue;

                const from = m.key.remoteJid;
                if (!from) continue;

                // 🚀 تمرير الرسالة فوراً للمفسر (Handler)
                await handleAllMessages(m, conn);
            }
        } catch (err) {
            console.error('❌ خطأ في استقبال الرسائل وتوجيهها:', err);
        }
    });

    // 🔥 الترحيب التلقائي الذكي لأي عضو ينضم للجروب بشكل مباشر
    conn.ev.on('group-participants.update', async (update) => {
        try {
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
