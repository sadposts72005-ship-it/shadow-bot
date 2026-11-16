import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'scramble_db.json');

// مسارات النسخ الاحتياطية المحمية داخل مجلدات الجلسات (غير متبعة في Git Pull)
const BACKUP_PATHS = [
    path.join(process.cwd(), 'session_data', 'scramble_db_backup.json'),
    path.join(process.cwd(), 'sessions', 'scramble_db_backup.json')
];

export function loadLocalDB() {
    let db = null;
    let backupDb = null;

    // 1. قراءة قاعدة البيانات الأساسية إن وجدت
    try {
        if (fs.existsSync(dbPath)) {
            const raw = fs.readFileSync(dbPath, 'utf-8');
            if (raw && raw.trim() !== '') {
                db = JSON.parse(raw);
            }
        }
    } catch (e) {
        console.error("خطأ في قراءة قاعدة البيانات الأساسية:", e?.message || e);
    }

    // 2. فحص أحدث نسخة احتياطية محمية من مجلدات الجلسات (session_data و sessions)
    for (const bp of BACKUP_PATHS) {
        try {
            if (fs.existsSync(bp)) {
                const bRaw = fs.readFileSync(bp, 'utf-8');
                if (bRaw && bRaw.trim() !== '') {
                    const b = JSON.parse(bRaw);
                    if (!backupDb || (b.lastSavedAt && b.lastSavedAt > (backupDb.lastSavedAt || 0))) {
                        backupDb = b;
                    }
                }
            }
        } catch (_) {}
    }

    // 3. إذا كانت النسخة الاحتياطية أحدث (بسبب قيام المستخدم بـ Git Pull على السيرفر واسترجاع نسخة قديمة):
    // نعتمد النسخة الاحتياطية المحمية ونسترجعها فوراً إلى scramble_db.json
    if (backupDb) {
        const dbTime = Number(db?.lastSavedAt) || 0;
        const backupTime = Number(backupDb?.lastSavedAt) || 0;

        if (!db || backupTime > dbTime) {
            db = backupDb;
            try {
                fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
                console.log('🛡️ [Database Safety] تم استرجاع أحدث بيانات قاعدة البيانات والحجاج من النسخة المحمية بنجاح!');
            } catch (_) {}
        } else if (db) {
            // دمج الحجاج والأقسام الحساسة لضمان عدم ضياع أي رتبة تمت ترقيتها
            if (Array.isArray(backupDb.hajjUsers)) {
                if (!db.hajjUsers) db.hajjUsers = [];
                for (const u of backupDb.hajjUsers) {
                    if (!db.hajjUsers.includes(u)) db.hajjUsers.push(u);
                }
            }
            if (Array.isArray(backupDb.mainHajjUsers)) {
                if (!db.mainHajjUsers) db.mainHajjUsers = [];
                for (const u of backupDb.mainHajjUsers) {
                    if (!db.mainHajjUsers.includes(u)) db.mainHajjUsers.push(u);
                }
            }
            if (backupDb.users && typeof backupDb.users === 'object') {
                if (!db.users) db.users = {};
                for (const [k, v] of Object.entries(backupDb.users)) {
                    if (!db.users[k]) db.users[k] = v;
                }
            }
            if (backupDb.mutedUsers && typeof backupDb.mutedUsers === 'object') {
                if (!db.mutedUsers) db.mutedUsers = {};
                for (const [gid, list] of Object.entries(backupDb.mutedUsers)) {
                    if (!db.mutedUsers[gid]) db.mutedUsers[gid] = list;
                }
            }
            if (Array.isArray(backupDb.disabledMuslim)) {
                if (!db.disabledMuslim) db.disabledMuslim = [];
                for (const g of backupDb.disabledMuslim) {
                    if (!db.disabledMuslim.includes(g)) db.disabledMuslim.push(g);
                }
            }
            if (Array.isArray(backupDb.disabledWelcomes)) {
                if (!db.disabledWelcomes) db.disabledWelcomes = [];
                for (const g of backupDb.disabledWelcomes) {
                    if (!db.disabledWelcomes.includes(g)) db.disabledWelcomes.push(g);
                }
            }
            if (backupDb.lidMap && typeof backupDb.lidMap === 'object') {
                if (!db.lidMap) db.lidMap = {};
                for (const [k, v] of Object.entries(backupDb.lidMap)) {
                    if (!db.lidMap[k]) db.lidMap[k] = v;
                }
            }
            if (backupDb.telegramToken && !db.telegramToken) {
                db.telegramToken = backupDb.telegramToken;
            }
        }
    }

    if (!db) {
        db = {
            users: {},
            bannedUsers: [],
            bannedGroups: [],
            disabledWelcomes: [],
            disabledMuslim: [],
            warns: {},
            warnGivers: {},
            hajjUsers: [],
            mainHajjUsers: [],
            timedGroupControls: {},
            mutedUsers: {},
            antiBan: {},
            knownGroups: [],
            lidMap: {}
        };
    }

    // التأكد من تهيئة كافة الحقول لعدم حدوث أخطاء برمجية
    if (!db.users) db.users = {};
    if (!db.warns) db.warns = {};
    if (!db.warnGivers) db.warnGivers = {};
    if (!db.hajjUsers) db.hajjUsers = [];
    if (!db.mainHajjUsers) db.mainHajjUsers = [];
    if (!db.bannedGroups) db.bannedGroups = [];
    if (!db.disabledWelcomes) db.disabledWelcomes = [];
    if (!db.disabledMuslim) db.disabledMuslim = [];
    if (!db.bannedUsers) db.bannedUsers = [];
    if (!db.timedGroupControls) db.timedGroupControls = {};
    if (!db.mutedUsers) db.mutedUsers = {};
    if (!db.antiBan) db.antiBan = {};
    if (!db.knownGroups) db.knownGroups = [];
    if (!db.lidMap) db.lidMap = {};

    return db;
}

export function saveLocalDB(data) {
    if (!data || typeof data !== 'object') return;
    try {
        data.lastSavedAt = Date.now();
        const jsonStr = JSON.stringify(data, null, 2);

        // حفظ في المسار الرئيسي
        fs.writeFileSync(dbPath, jsonStr, 'utf-8');

        // حفظ متزامن في المجلدات المحمية من تحديثات Git
        for (const bp of BACKUP_PATHS) {
            try {
                const dir = path.dirname(bp);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(bp, jsonStr, 'utf-8');
            } catch (_) {}
        }
    } catch (e) {
        console.error("خطأ في حفظ قاعدة البيانات:", e?.message || e);
    }
}

export { dbPath };
export default { loadLocalDB, saveLocalDB, dbPath };
