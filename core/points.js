import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'scramble_db.json');

export function loadDB() {
    try {
        if (fs.existsSync(dbPath)) {
            const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            if (!data.users) data.users = {};
            if (!data.lidMap) data.lidMap = {};
            return data;
        }
    } catch (e) {
        console.error('Error loading DB in points.js:', e);
    }
    return { users: {}, lidMap: {} };
}

export function saveDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Error saving DB in points.js:', e);
        return false;
    }
}

export function getCleanNumber(jid) {
    if (!jid) return '';
    return jid.replace(/@.+/, '').replace(/[^0-9]/g, '');
}

export function cleanUserJid(jid) {
    if (!jid) return '';
    const clean = getCleanNumber(jid);
    return clean ? `${clean}@s.whatsapp.net` : jid;
}

export function findUserKeyAndData(jid, db) {
    if (!jid || !db || !db.users) return { key: cleanUserJid(jid), data: null };
    const clean = getCleanNumber(jid);
    if (!clean) return { key: jid, data: null };

    // 1. Direct keys
    if (db.users[jid]) return { key: jid, data: db.users[jid] };
    const stdKey = `${clean}@s.whatsapp.net`;
    if (db.users[stdKey]) return { key: stdKey, data: db.users[stdKey] };
    const lidKey = `${clean}@lid`;
    if (db.users[lidKey]) return { key: lidKey, data: db.users[lidKey] };

    // 2. Mapped keys (LID <-> Phone)
    const mapped = db.lidMap?.[clean];
    if (mapped) {
        const mappedStd = `${mapped}@s.whatsapp.net`;
        if (db.users[mappedStd]) return { key: mappedStd, data: db.users[mappedStd] };
        const mappedLid = `${mapped}@lid`;
        if (db.users[mappedLid]) return { key: mappedLid, data: db.users[mappedLid] };
    }

    // 3. Search by matching numbers
    for (const k of Object.keys(db.users)) {
        const kClean = getCleanNumber(k);
        if (kClean === clean || (mapped && kClean === mapped)) {
            return { key: k, data: db.users[k] };
        }
    }

    return { key: stdKey, data: null };
}

export function modifyUserPoints(jid, amount, name = '') {
    const db = loadDB();
    const { key, data } = findUserKeyAndData(jid, db);

    let user = data;
    if (!user) {
        user = {
            name: name || 'عضو جديد',
            age: 'غير مسجل',
            status: 'غير مسجل',
            bio: 'لا يوجد بايو حالياً',
            points: 1000,
            level: 1,
            joinedAt: new Date().toLocaleString('ar-EG'),
            hasRegistered: false,
            isInfinite: false
        };
        db.users[key] = user;
    }

    if (user.isInfinite) {
        return { points: user.points, change: 0, isInfinite: true, total: user.points };
    }

    const currentPoints = typeof user.points === 'number' ? user.points : 1000;
    const newPoints = Math.max(0, currentPoints + amount);
    user.points = newPoints;
    user.level = Math.max(1, Math.floor(newPoints / 1000) + 1);
    if (name && (!user.name || user.name === 'عضو جديد')) user.name = name;

    saveDB(db);
    return { points: newPoints, change: amount, isInfinite: false, total: newPoints };
}

export function getUserPoints(jid) {
    const db = loadDB();
    const { data } = findUserKeyAndData(jid, db);
    if (!data) return 1000;
    return typeof data.points === 'number' ? data.points : 1000;
}

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

    // إذا كان التوقيت بالملي ثانية (13 رقم)، نحوله للثواني (10 أرقام)
    if (num > 1e11) {
        num = Math.floor(num / 1000);
    }
    return num;
}
