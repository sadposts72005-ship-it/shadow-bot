import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'scramble_db.json');

export function loadLocalDB() {
    try {
        if (fs.existsSync(dbPath)) {
            let db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
            if (!db.users) db.users = {};
            if (!db.warns) db.warns = {};
            if (!db.warnGivers) db.warnGivers = {};
            if (!db.hajjUsers) db.hajjUsers = [];
            if (!db.mainHajjUsers) db.mainHajjUsers = [];
            if (!db.bannedGroups) db.bannedGroups = [];
            if (!db.disabledWelcomes) db.disabledWelcomes = [];
            if (!db.bannedUsers) db.bannedUsers = [];
            if (!db.timedGroupControls) db.timedGroupControls = {};
            if (!db.mutedUsers) db.mutedUsers = {};
            if (!db.antiBan) db.antiBan = {};
            if (!db.knownGroups) db.knownGroups = [];
            if (!db.lidMap) db.lidMap = {};
            return db;
        }
    } catch (e) {
        console.error("خطأ في قراءة قاعدة البيانات:", e);
    }
    return {
        users: {},
        bannedUsers: [],
        bannedGroups: [],
        disabledWelcomes: [],
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

export function saveLocalDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error("خطأ في حفظ قاعدة البيانات:", e);
    }
}

export { dbPath };
export default { loadLocalDB, saveLocalDB, dbPath };
