export default {
    name: 'chats_responses',
    async execute(mek, currentConn, { from, sender, botName, isHajj, normalizedBody, textLower, dynamicState }) {
        
        // الحفاظ على الأمان لو الـ dynamicState مش مبعوتة صح
        const state = dynamicState || {};

        // 🤫 1. نظام التحقيق بعد الشتيمة
        if (state[sender] === 'waiting_for_shatema_clarification') {
            if (['انت', 'اه انت', 'ايوا انت', 'إنت', 'أنت'].includes(normalizedBody)) {
                delete state[sender];
                await currentConn.sendMessage(from, { text: 'مش هرد عليك لأجل أبويا 🤫' }, { quoted: mek });
                return true;
            }
        }

        // 💀 2. رد الموت
        if (normalizedBody === 'بموت' || normalizedBody === 'مت') {
            await currentConn.sendMessage(from, { text: 'روح موت بعيد 🐤😂' }, { quoted: mek });
            return true;
        }

        // 👑 3. رد هوية المطور
        if (normalizedBody === 'ابوك مين' || normalizedBody === 'أبوك مين') {
            await currentConn.sendMessage(from, { text: 'أبويا وصاحب فضل عليا هو الحج شادو بابا الكل 👑❤️' }, { quoted: mek });
            return true;
        }

        // 🤖 4. نداء البوت (معدل ليقبل اسم البوت الحالي ديناميكياً)
        const currentName = (botName || currentConn.botName || 'شادو').toLowerCase();
        if (normalizedBody === 'شادو' || normalizedBody === 'بوت' || normalizedBody === currentName) {
            await currentConn.sendMessage(from, { text: `تحت أمرك يا فنان أنا ${botName || currentConn.botName || 'شادو'} اتفضل أأمرني ❤️` }, { quoted: mek });
            return true;
        }

        // ✨ 5. رد الأخوة
        if (normalizedBody === 'اخويا' || normalizedBody === 'أخويا') {
            await currentConn.sendMessage(from, { text: 'قلب وروح اخوك من جوه ❤️💫' }, { quoted: mek });
            return true;
        }

        // 🤬 6. فلتر الشتايم وبدء التحقيق
        if (textLower.includes('كسمك') || textLower.includes('خول') || textLower.includes('عرص') || textLower.includes('متناك') || textLower.includes('بضان')) {
            state[sender] = 'waiting_for_shatema_clarification';
            await currentConn.sendMessage(from, { text: 'انا ولا مين؟ 🤨' }, { quoted: mek });
            return true;
        }

        return false;
    }
};

