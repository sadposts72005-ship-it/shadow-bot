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

        // 🤖 4. نداء البوت (معدل ليقبل اسم المناداة والاسم الرسمي ديناميكياً)
        const currentName = (botName || currentConn.botName || 'شادو').toLowerCase().trim();
        const callName = (currentConn.callName || currentConn.subBotConfig?.callName || '').toLowerCase().trim();
        const normCall = callName;
        const normName = currentName;

        const isCallingThisBot = (
            (normalizedBody !== 'بوت' && normalizedBody !== 'يا بوت') &&
            (
                (!currentConn.isSubBot && (normalizedBody === 'شادو' || normalizedBody === 'يا شادو')) ||
                (normName && normName !== 'بوت' && (normalizedBody === normName || normalizedBody === 'يا ' + normName)) ||
                (normCall && normCall !== 'بوت' && (normalizedBody === normCall || normalizedBody === 'يا ' + normCall))
            )
        );

        if (isCallingThisBot) {
            const isFemale = (currentConn.gender === 'female' || currentConn.subBotConfig?.gender === 'female');
            const fananTitle = isFemale ? 'يا فنان/ة اتفضل/ي يا حبيبي/حبيبتي اؤمر/ي❤️' : 'يا فنان اتفضل يا حبيبي اامر❤️';
            await currentConn.sendMessage(from, { text: `تحت امرك ${fananTitle}` }, { quoted: mek });
            return true;
        }

        // ✨ 5. رد الأخوة
        if (normalizedBody === 'اخويا' || normalizedBody === 'أخويا') {
            await currentConn.sendMessage(from, { text: 'قلب وروح اخوك من جوه ❤️💫' }, { quoted: mek });
            return true;
        }

        // 🤬 6. فلتر الشتايم والردود (محترم vs قليل الأدب)
        const isBad = (currentConn.personality === 'bad' || currentConn.subBotConfig?.personality === 'bad');
        if (textLower.includes('كسمك') || textLower.includes('خول') || textLower.includes('عرص') || textLower.includes('متناك') || textLower.includes('بضان') || textLower.includes('شرموط') || textLower.includes('منيوك') || textLower.includes('قحبة')) {
            if (isBad) {
                const savageReplies = [
                    'كسمك انت يابن المتناكة 🖕🔥',
                    'غور يا كسمك من هنا يلا بدل ما افشخك 🤬🖕',
                    'امك عارفة انك خول كده في الشاتات؟ 🖕😂',
                    'ملكش دعوة بيا يا عيل بضان يلا طير 🖕😏',
                    'شكلك عايز تتهان وتاخد على قفاك يا ابن الشرموطة 🖕🔥'
                ];
                const reply = savageReplies[Math.floor(Math.random() * savageReplies.length)];
                await currentConn.sendMessage(from, { text: reply }, { quoted: mek });
                return true;
            } else {
                state[sender] = 'waiting_for_shatema_clarification';
                await currentConn.sendMessage(from, { text: 'انا ولا مين؟ 🤨' }, { quoted: mek });
                return true;
            }
        }

        return false;
    }
};

