import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    requestSubBotPairing,
    cancelSubBotPairing,
    stopSubBot,
    startSubBotRemote,
    deleteSubBotRemote,
    cleanPhoneNumber,
    getSubBotsList,
    activeSubBots,
    findSubBotByPassword,
    updateSubBotSettings,
    generateSubBotPassword,
    loadSubBotsRegistry
} from './subbot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOT_ROOT = path.resolve(__dirname, '..');
const SUB_BOTS_REGISTRY = path.join(BOT_ROOT, 'sessions', 'sub_bots_registry.json');

const REMOTE_HUB_URL = 'https://shadow-bot-server.vercel.app';
const HUB_TOKEN = 'SHADOW_HAJJ_SECURE_TOKEN_2026_9999';

let isBridgeStarted = false;
let isPolling = false;

function getSubBotsDataForBridge() {
    try {
        const list = getSubBotsList();
        if (Array.isArray(list) && list.length > 0) {
            return list.map(b => {
                const cleanP = cleanPhoneNumber(b.phone) || b.phone;
                const isConn = activeSubBots.has(cleanP);
                return {
                    ...b,
                    status: isConn ? 'active' : (b.status || 'stopped')
                };
            });
        }
    } catch (_) {}

    try {
        if (fs.existsSync(SUB_BOTS_REGISTRY)) {
            const raw = fs.readFileSync(SUB_BOTS_REGISTRY, 'utf8').trim();
            if (raw && raw !== '{}') {
                const reg = JSON.parse(raw);
                return Object.entries(reg).map(([phone, data]) => {
                    const cleanP = cleanPhoneNumber(phone) || phone;
                    const isConn = activeSubBots.has(cleanP);
                    const platform = data.installPlatform || (data.notifyJid?.startsWith('web:') ? 'web' : (data.notifyJid?.startsWith('tg:') ? 'telegram' : 'whatsapp'));
                    return {
                        phone: cleanP,
                        botName: data.botName || 'بوت فرعي',
                        callName: data.callName || 'فرعي',
                        gender: data.gender === 'female' ? 'أنثى' : 'ذكر',
                        personality: data.personality === 'bad' ? 'قليل الأدب ومشاكس 😈🔥' : 'محترم ومؤدب 😇🤍',
                        adminPhone: data.adminPhone || '201129249396',
                        adminLid: data.adminLid || '',
                        platform: platform,
                        status: isConn ? 'active' : (data.status || 'stopped'),
                        installedAt: data.installedAt ? new Date(data.installedAt).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }) : 'غير مسجل',
                        botPassword: data.botPassword || ''
                    };
                });
            }
        }
    } catch (_) {}

    return [];
}

async function resolveBridgeTask(taskId, success, data = null, error = null) {
    try {
        await fetch(`${REMOTE_HUB_URL}/api/bridge/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${HUB_TOKEN}`
            },
            body: JSON.stringify({ taskId, success, data, error })
        });
    } catch (e) {
        console.error(`❌ [Bridge Worker] فشل إرسال حل المهمة ${taskId}:`, e.message);
    }
}

async function handleBridgeTask(task) {
    const { id, type, payload } = task;
    console.log(`📥 [Bridge Worker] مهمة واردة من موقع الويب: [${type}] (ID: ${id})`);

    try {
        if (type === 'install-subbot') {
            const { phone, botName, callName, adminPhone, gender, personality } = payload;
            const cleanP = cleanPhoneNumber ? cleanPhoneNumber(phone) : phone;

            let pairResultSent = false;
            const codePromise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (!pairResultSent) {
                        pairResultSent = true;
                        reject(new Error('انتهت مهلة استخراج الكود (25 ثانية).'));
                    }
                }, 25000);

                requestSubBotPairing(
                    cleanP,
                    botName,
                    callName,
                    adminPhone,
                    adminPhone === '201129249396' ? '194961618301016' : '',
                    gender,
                    personality,
                    global.conn || null,
                    `web:${Date.now()}`,
                    null,
                    async (notifyText) => {
                        const text = String(notifyText || '').trim();
                        const cleanCodeMatch = text.match(/^[A-Za-z0-9]{8}$/) || text.match(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
                        if (cleanCodeMatch && !pairResultSent) {
                            pairResultSent = true;
                            clearTimeout(timer);
                            const raw = cleanCodeMatch[0].replace(/[^A-Za-z0-9]/g, '');
                            const formatted = raw.match(/.{1,4}/g)?.join('-') || raw;
                            resolve({ cleanCode: raw, formattedCode: formatted });
                        }
                    }
                ).catch(err => {
                    if (!pairResultSent) {
                        pairResultSent = true;
                        clearTimeout(timer);
                        reject(err);
                    }
                });
            });

            const pairData = await codePromise;
            let botPassword = '';
            try {
                if (fs.existsSync(SUB_BOTS_REGISTRY)) {
                    const reg = JSON.parse(fs.readFileSync(SUB_BOTS_REGISTRY, 'utf8') || '{}');
                    botPassword = reg[cleanP]?.botPassword || '';
                }
            } catch (_) {}
            if (!botPassword) {
                botPassword = typeof generateSubBotPassword === 'function' ? generateSubBotPassword() : ('SB-' + Math.random().toString(36).substring(2, 8).toUpperCase());
            }

            await resolveBridgeTask(id, true, {
                pairingCode: pairData.cleanCode,
                formattedCode: pairData.formattedCode,
                botPassword
            });
            console.log(`✅ [Bridge Worker] تم تسليم كود الاقتران بنجاح: ${pairData.formattedCode}`);

        } else if (type === 'cancel-pairing') {
            const phone = payload.phone;
            let cancelRes = { success: true, message: 'تم إلغاء التنصيب بنجاح ❌' };
            if (typeof cancelSubBotPairing === 'function') {
                cancelRes = await cancelSubBotPairing(phone);
            }
            await resolveBridgeTask(id, true, cancelRes);

        } else if (type === 'find-subbot') {
            const pwd = (payload.password || '').trim().toUpperCase();
            let found = null;
            if (typeof findSubBotByPassword === 'function') {
                found = findSubBotByPassword(pwd);
            }
            if (!found) {
                found = getSubBotsDataForBridge().find(b => b.botPassword && b.botPassword.trim().toUpperCase() === pwd);
            }
            await resolveBridgeTask(id, true, found);

        } else if (type === 'user-update') {
            const { password, botName, callName, gender, personality } = payload;
            const pwd = password.trim().toUpperCase();
            const matched = getSubBotsDataForBridge().find(b => b.botPassword && b.botPassword.trim().toUpperCase() === pwd);
            if (!matched) {
                return await resolveBridgeTask(id, false, null, 'الباسورد السري غير صحيح!');
            }
            if (typeof updateSubBotSettings === 'function') {
                const res = await updateSubBotSettings(matched.phone, { botName, callName, gender, personality });
                await resolveBridgeTask(id, res.success, res, res.message);
            } else {
                await resolveBridgeTask(id, false, null, 'محرك التعديل غير متوفر');
            }

        } else if (type === 'user-action') {
            const { password, action } = payload;
            const pwd = password.trim().toUpperCase();
            const matched = getSubBotsDataForBridge().find(b => b.botPassword && b.botPassword.trim().toUpperCase() === pwd);
            if (!matched) {
                return await resolveBridgeTask(id, false, null, 'الباسورد السري غير صحيح!');
            }
            const phone = matched.phone;
            if (action === 'stop' && typeof stopSubBot === 'function') {
                await stopSubBot(phone);
                await resolveBridgeTask(id, true, { success: true, message: 'تم إيقاف البوت بنجاح ⏸️' });
            } else if (action === 'start' && typeof startSubBotRemote === 'function') {
                await startSubBotRemote(phone, global.conn || null);
                await resolveBridgeTask(id, true, { success: true, message: 'تم تشغيل البوت بنجاح ▶️' });
            } else if (action === 'delete') {
                if (typeof deleteSubBotRemote === 'function') await deleteSubBotRemote(phone, global.conn || null);
                await resolveBridgeTask(id, true, { success: true, message: 'تم حذف البوت نهائياً 🗑️' });
            } else {
                await resolveBridgeTask(id, false, null, 'إجراء غير مدعوم');
            }

        } else if (type === 'admin-action') {
            const { phone, action } = payload;
            const cleanP = cleanPhoneNumber(phone) || phone;
            if (action === 'stop' && typeof stopSubBot === 'function') {
                await stopSubBot(cleanP);
                await resolveBridgeTask(id, true, { success: true, message: `تم إيقاف البوت (+${cleanP}) بنجاح.` });
            } else if (action === 'start' && typeof startSubBotRemote === 'function') {
                await startSubBotRemote(cleanP, global.conn || null);
                await resolveBridgeTask(id, true, { success: true, message: `تم تشغيل البوت (+${cleanP}) بنجاح.` });
            } else if (action === 'delete') {
                if (typeof deleteSubBotRemote === 'function') await deleteSubBotRemote(cleanP, global.conn || null);
                await resolveBridgeTask(id, true, { success: true, message: `تم حذف البوت (+${cleanP}) نهائياً بنجاح.` });
            } else {
                await resolveBridgeTask(id, false, null, 'إجراء غير مدعوم');
            }

        } else if (type === 'subbot-status') {
            const phone = payload.phone;
            const cleanP = cleanPhoneNumber(phone) || phone;
            const hasSocket = activeSubBots.has(cleanP) && Boolean(activeSubBots.get(cleanP)?.sock?.user?.id);
            let isPairedOnDisk = false;
            try {
                const credsPath = path.join(BOT_ROOT, 'sessions', 'sub_bots', cleanP, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8') || '{}');
                    if (creds && (creds.registered || creds.me?.id)) {
                        isPairedOnDisk = true;
                    }
                }
            } catch (_) {}
            const isConn = hasSocket || isPairedOnDisk;
            await resolveBridgeTask(id, true, { connected: isConn });
        }
    } catch (err) {
        console.error(`❌ [Bridge Worker] خطأ أثناء تنفيذ المهمة ${id}:`, err?.message || err);
        await resolveBridgeTask(id, false, null, err?.message || 'خطأ غير معروف في تنفيذ المهمة');
    }
}

export function startBridgeWorker() {
    if (isBridgeStarted) return;
    isBridgeStarted = true;

    console.log(`\n🌉 [Bridge Worker] تم تشغيل جسر شادو بوت السحابي للربط مع Vercel (${REMOTE_HUB_URL})...`);

    // 1. نبضات القلب لمزامنة قائمة البوتات والإحصائيات كل 3 ثوانٍ
    async function sendHeartbeat() {
        try {
            const list = getSubBotsDataForBridge();
            let activeCount = 0;
            let stoppedCount = 0;
            let webCount = 0;
            let telegramCount = 0;
            let whatsappCount = 0;
            list.forEach(bot => {
                if (bot.status === 'active') activeCount++;
                else stoppedCount++;
                const p = (bot.platform || '').toLowerCase();
                if (p === 'web') webCount++;
                else if (p === 'telegram') telegramCount++;
                else whatsappCount++;
            });
            const stats = {
                total: list.length,
                activeCount,
                stoppedCount,
                webCount,
                telegramCount,
                whatsappCount
            };
            await fetch(`${REMOTE_HUB_URL}/api/bridge/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${HUB_TOKEN}`
                },
                body: JSON.stringify({ subbots: list, stats })
            });
        } catch (_) {}
    }

    setTimeout(sendHeartbeat, 1000);
    setInterval(sendHeartbeat, 3000);

    // 2. سحب المهام المعلقة كل 1 ثانية
    async function pollTasks() {
        if (isPolling) return;
        isPolling = true;
        try {
            const res = await fetch(`${REMOTE_HUB_URL}/api/bridge/tasks`, {
                headers: { 'Authorization': `Bearer ${HUB_TOKEN}` }
            });
            if (res.ok) {
                const data = await res.json();
                const tasks = data.tasks || [];
                for (const task of tasks) {
                    await handleBridgeTask(task);
                }
            }
        } catch (_) {
        } finally {
            isPolling = false;
        }
    }

    setInterval(pollTasks, 1000);
}
