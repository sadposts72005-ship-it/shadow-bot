// plugins/game-football.js
import fs from 'fs';
import path from 'path';
import { modifyUserPoints } from '../core/points.js';

// 📂 إعداد ملف التخزين المحلي الخاص باللعبة لضمان عدم ضياع النقاط
const dbPath = path.join(process.cwd(), 'scramble_db.json');

// دالة للتأخير
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadLocalDB() {
    try {
        if (fs.existsSync(dbPath)) return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    } catch (e) { console.error("خطأ في قراءة قاعدة البيانات:", e); }
    return { users: {} };
}

function saveLocalDB(data) {
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { console.error("خطأ في حفظ قاعدة البيانات:", e); }
}

function normalizeText(text) {
    if (!text) return '';
    return text.trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/\s+/g, ' ');
}

// ⚽ مصفوفة الأسئلة الكروية المتنوعة
const footballQuestions = [
    { q: "من هو اللاعب الأكثر تتويجاً بالكرة الذهبية في التاريخ؟", a: "ميسي", hint: "برغوث أرجنتيني حطم التاريخ مع برشلونة" },
    { q: "ما هو النادي الأوروبي الأكثر فوزاً بدوري أبطال أوروبا؟", a: "ريال مدريد", hint: "الملكي صاحب اللون الأبيض" },
    { q: "في أي دولة عربية أقيمت بطولة كأس العالم 2022؟", a: "قطر", hint: "دولة خليجية نظمت مونديال تاريخي" },
    { q: "من هو الهداف التاريخي لبطولة دوري أبطال أوروبا؟", a: "رونالدو", hint: "الدون البرتغالي صاروخ ماديرا" },
    { q: "ما هو لقب منتخب مصر في كرة القدم؟", a: "الفراعنة", hint: "مرتبط بالتاريخ المصري القديم والأهرامات" },
    { q: "أي نادي إنجليزي يلقب بـ 'الشياطين الحمر'؟", a: "مانشستر يونايتد", hint: "يلعب في ملعب أولد ترافورد" },
    { q: "من هو المدرب التاريخي الذي قاد مانشستر يونايتد لأكثر من 26 عاماً؟", a: "فيرجسون", hint: "السير أليكس..." },
    { q: "ما هو المنتخب الفائز بكأس العالم 2014 في البرازيل？", a: "ألمانيا", hint: "الماكينات الأوروبية" },
    { q: "من هو اللاعب المصري الذي فاز بالحذاء الذهبي للدوري الإنجليزي 3 مرات؟", a: "محمد صلاح", hint: "الملك المصري فخر العرب" },
    { q: "كم عدد اللاعبين في فريق كرة القدم الواحد داخل الملعب أثناء المباراة؟", a: "11", hint: "رقم فردي فوق العشرة" },
    { q: "ما هو النادي الإيطالي الذي يلقب بـ 'السيدة العجوز'؟", a: "يوفنتوس", hint: "اليوفي صاحب اللونين الأبيض والأسود" },
    { q: "من هو هداف كأس العالم التاريخي؟", a: "كلوزه", hint: "قناص ألماني شهير" },
    { q: "أي منتخب عالمي يسمى بـ 'السامبا'؟", a: "البرازيل", hint: "المنتخب الأكثر تتويجاً بكأس العالم" },
    { q: "ما هو النادي المصري الفائز بلقب نادي القرن في أفريقيا؟", a: "الاهلي", hint: "المارد الأحمر الشياطين الحمر بمصر" },
    { q: "ما هو النادي المصري الذي يلقب بـ 'مدرسة الفن والهندسة'؟", a: "الزمالك", hint: "الفارس الأبيض بخطين حمر" },
    { q: "من هو اللاعب الفرنسي الملقب بـ 'الزيزو'؟", a: "زيدان", hint: "أسطورة فرنسا ومدرب الريال السابق" },
    { q: "في أي نادي إنجليزي يلعب النجم النرويجي إيرلينج هالاند؟", a: "مانشستر سيتي", hint: "السيتيزنز تحت قيادة جوارديولا" },
    { q: "من هو مدرب مانشستر سيتي الحالي وصاحب السداسية التاريخية مع برشلونة؟", a: "جوارديولا", hint: "الفيلسوف الإسباني بيب..." },
    { q: "ما هو النادي الألماني الأكثر فوزاً بالبوندسليجا ودوري الأبطال؟", a: "بايرن ميونخ", hint: "العملاق البافاري" },
    { q: "من هو اللاعب السويدي المخضرم الذي لقب نفسه بـ 'السلطان'؟", a: "إبراهيموفيتش", hint: "زلاتان..." },
    { q: "ما هي الدولة التي فازت بأول نسخة في تاريخ كأس العالم عام 1930؟", a: "أوروغواي", hint: "دولة من أمريكا الجنوبية ولعبت النهائي ضد الأرجنتين" },
    { q: "من هو هداف الدوري الإنجليزي التاريخي؟", a: "آلان شيرر", hint: "أسطورة نيوكاسل يونايتد السابق" },
    { q: "ما هو النادي الفرنسي الذي يمتلك أكبر عدد من نجوم العالم حالياً وسابقاً؟", a: "باريس سان جيرمان", hint: "نادي العاصمة الفرنسية البياسجي" },
    { q: "من هو اللاعب البرازيلي الملقب بـ 'الظاهرة'؟", a: "رونالدو", hint: "رونالدو البرازيلي القديم صاحب القصة الشهيرة" },
    { q: "من هو ساحر الكرة البرازيلية الذي اشتهر بابتسامته ومهاراته في برشلونة؟", a: "رونالدينيو", hint: "الساحر روني" },
    { q: "ما هو النادي الإنجليزي الذي يلقب بـ 'الريدز'؟", a: "ليفربول", hint: "نادي محمد صلاح الحالي" },
    { q: "أي نادي إنجليزي يلقب بـ 'المدفعجية'؟", a: "أرسنال", hint: "الجانرز من لندن" },
    { q: "أي منتخب أوروبي يلقب بـ 'الماتادور'؟", a: "إسبانيا", hint: "أبطال تيكي تاكا" },
    { q: "أي منتخب أوروبي يلقب بـ 'الآزوري' ويرتدي اللون الأزرق؟", a: "إيطاليا", hint: "أبطال الدفاع والكاتيناتشو" },
    { q: "في أي بلد يلعب النادي الشهير 'بوكا جونيورز'؟", a: "الأرجنتين", hint: "موطن مارادونا وميسي" },
    { q: "من هو الأسطورة الأرجنتيني صاحب هدف 'يد الله' الشهير عام 1986؟", a: "مارادونا", hint: "دييغو أرماندو..." },
    { q: "ما هو المنتخب الأفريقي الذي يلقب بـ 'أسود التيرانجا'؟", a: "السنغال", hint: "منتخب ساديو ماني" },
    { q: "ما هو المنتخب الأفريقي الذي يلقب بـ 'محاربو الصحراء'؟", a: "الجزائر", hint: "بلد المليون ونصف شهيد" },
    { q: "ما هو المنتخب العربي الأفريقي الملقب بـ 'أسود الأطلس'؟", a: "المغرب", hint: "صاحب المركز الرابع التاريخي في مونديال 2022" },
    { q: "كم عدد دقائق الشوط الواحد في مباراة كرة القدم الرسمية؟", a: "45", hint: "نصف التسعين دقيقة" },
    { q: "كم عدد بطولات كأس العالم التي فاز بها الأسطورة البرازيلي بيليه؟", a: "3", hint: "رقم فردي أقل من 5" },
    { q: "ما هو اللقب المعطى لمنتخب الأرجنتين؟", a: "التانغو", hint: "رقصة شهيرة في أمريكا الجنوبية" },
    { q: "من هو اللاعب الأفريقي الوحيد الذي فاز بالكرة الذهبية وأصبح رئيساً لبلاده؟", a: "جورج وياه", hint: "أسطورة ميلان ورئيس ليبيريا السابق" },
    { q: "من هو الحارس الإيطالي الأسطوري الذي اعتزل بعد مسيرة تاريخية مع يوفنتوس؟", a: "بوفون", hint: "جيجي..." },
    { q: "من هو الحارس الإسباني الملقب بـ 'القديس' وفاز بكأس العالم 2010؟", a: "كاسياس", hint: "إيكر... حارس ريال مدريد التاريخي" },
    { q: "ما هو النادي الإنجليزي الذي يلقب بـ 'السبيرز' ويلعب في لندن؟", a: "توتنهام", hint: "كان يلعب له هاري كين" },
    { q: "في أي بطولة قارية يتنافس النادي الأهلي ونادي الزمالك بشكل أساسي؟", a: "دوري ابطال افريقيا", hint: "أقوى بطولة للأندية في القارة السمراء" },
    { q: "أي لاعب فرنسي انتقل من ريال مدريد إلى نادي الاتحاد السعودي؟", a: "بنزيما", hint: "الحكومة كريم..." },
    { q: "ما هي الدولة التي استضافت كأس العالم لعام 2010 لأول مرة في أفريقيا؟", a: "جنوب افريقيا", hint: "بلد مانديلا وفوفوزيلا" },
    { q: "من هو اللاعب الكرواتي الذي فاز بالكرة الذهبية عام 2018؟", a: "مودريتش", hint: "مايسترو خط وسط ريال مدريد لوكا..." },
    { q: "من هو المنتخب الفائز بكأس العالم 2018 في روسيا؟", a: "فرنسا", hint: "الديوك الفرنسية" },
    { q: "من هو النجم البرازيلي الفائز بدوري الأبطال مع برشلونة وانتقل للهلال السعودي؟", a: "نيمار", hint: "نيمار دا سيلفا" },
    { q: "كم عدد الكروت الصفراء التي تؤدي لطرد اللاعب مباشرة إذا حصل عليها في مباراة واحدة؟", a: "2", hint: "إنذارين من نفس اللون" },
    { q: "ما هو لقب نادي تشيلسي الإنجليزي؟", a: "البلوز", hint: "لونه أزرق غامق" },
    { q: "من هو النادي الفائز بالدوري الإنجليزي الذهبي بدون أي هزيمة؟", a: "أرسنال", hint: "موسم اللاهزيمة التاريخي 2003/2004" },
    // أسئلة إضافية
    { q: "من هو اللاعب الملقب بـ 'الدون'؟", a: "رونالدو", hint: "أسطورة البرتغال" },
    { q: "في أي نادٍ يلعب ليونيل ميسي حالياً؟", a: "انتر ميامي", hint: "نادي أمريكي" },
    { q: "ما هو المنتخب الملقب بـ 'الديوك'؟", a: "فرنسا", hint: "بطل عالم" },
    { q: "من هو الملقب بـ 'الفيلسوف' في التدريب؟", a: "جوارديولا", hint: "مدرب السيتي" },
    { q: "ما هو النادي الذي يلقب بـ 'البارسا'？", a: "برشلونة", hint: "نادي كاتالوني" },
    { q: "من هو صاحب الرقم 7 في النصر السعودي؟", a: "رونالدو", hint: "أسطورة مدريد" },
    { q: "أي منتخب فاز بكأس العالم 2022؟", a: "الأرجنتين", hint: "منتخب ميسي" },
    { q: "من هو الحارس الملقب بـ 'الأخطبوط'؟", a: "كورتوا", hint: "حارس الريال" },
    { q: "ما هو لقب مانشستر سيتي؟", a: "السيتيزنز", hint: "سكان المدينة" },
    { q: "من هو الملقب بـ 'الملك' في الكرة المصرية؟", a: "صلاح", hint: "فخر العرب" }
];

const handler = async (m, conn) => {
    let rawId = m.key?.remoteJid || m.chat;
    if (!rawId) return false;

    let id = rawId.endsWith('@lid') ? rawId.replace('@lid', '@s.whatsapp.net') : rawId;
    conn.football = conn.football || {};

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    let normalizedBody = normalizeText(body);

    let rawSender = m.sender || m.key?.participant || m.key?.remoteJid;
    let sender = rawSender?.endsWith('@lid') ? rawSender.replace('@lid', '@s.whatsapp.net') : rawSender;

    // دالة داخلية للتعامل مع تأثير الريأكشن والتأخير الزمني المطلوبة لكل أمر
    const triggerEffects = async () => {
        await delay(1000);
        await conn.sendMessage(id, { react: { text: '⚽', key: m.key } });
        await delay(2500);
    };

    // 1️⃣ أمر المساعدة
    if (normalizedBody === 'كيف لعب كوره' || normalizedBody === 'كيف العب كوره' || normalizedBody === 'طريقه كوره') {
        await triggerEffects();
        let helpText = `⚽ *دليل تشغيل لعبة كرة القدم* ⚽\n\n` +
            `• 📋 *لبدء اللعبة:* اكتب كلمة (*كوره*).\n` +
            `• ↩️ *طريقة الإجابة:* لازم تعمل *ريبلاي* (رد مباشر) على رسالة السؤال وتكتب إجابتك الصافية.\n` +
            `• 🥇 *الأولوية:* أول لاعب يجاوب بريبلاي صح بيكسب وتنقفل الجولة فوراً.\n` +
            `• 💡 *طلب تلميح:* اكتب (*تلميح كوره*).\n` +
            `• ❌ *إلغاء اللعبة:* اكتب (*الغاء كوره*).\n\n` +
            `⏰ *الوقت المتاح:* أمامكم *دقيقتين (2)* للإجابة قبل إلغاء السؤال تلقائياً!\n` +
            `💰 *الجوائز:* الإجابة الصح بتديك *15 نقطة* تلقائياً!`;
        await conn.sendMessage(id, { text: helpText }, { quoted: m });
        return true;
    }

    // 2️⃣ أمر بدء اللعبة
    if (normalizedBody === 'كوره' || normalizedBody === 'كورة' || normalizedBody === 'لعبة الكورة') {
        if (conn.football[id]) {
            await triggerEffects();
            await conn.sendMessage(id, { text: `⚠️ في سؤال شغال حالياً! اعمل ريبلاي عليه وجاوب أو اكتب *الغاء كوره* عشان تبدأ غيره.` }, { quoted: m });
            return true;
        }

        let randomIndex = Math.floor(Math.random() * footballQuestions.length);
        let randomQuestion = footballQuestions[randomIndex];

        await triggerEffects();
        let sentMsg = await conn.sendMessage(id, {
            text: `🏃‍♂️ *سؤال كروي جديد للاعيبة الجروب!* ⚽\n\n❔ *السؤال:* ${randomQuestion.q}\n\n❌ _لإلغاء السؤال اكتب: *الغاء كوره*_\n⚠️ _تنبيه: لازم تعمل ريبلاي (رد) على الرسالة دي عشان إجابتك تتحسب!_\n⏱️ _الوقت المتاح: دقيقتان فقط!_`
        }, { quoted: m });

        conn.football[id] = {
            question: randomQuestion.q,
            answer: randomQuestion.a,
            hint: randomQuestion.hint,
            creator: sender,
            msgId: sentMsg.key.id,
            timeout: setTimeout(async () => {
                if (conn.football[id] && conn.football[id].msgId === sentMsg.key.id) {
                    delete conn.football[id];
                    await delay(2500);
                    await conn.sendMessage(id, { text: `⏱️ *انتهى الوقت!* مرّت دقيقتان ولم يقم أحد بالإجابة الصحيحة.\n⚽ الإجابة الصحيحة كانت: *${randomQuestion.a}*` });
                }
            }, 2 * 60 * 1000)
        };
        return true;
    }

    // 3️⃣ أمر تلميح كوره
    if (normalizedBody === 'تلميح كوره' || normalizedBody === 'تلميح كورة') {
        if (!conn.football[id]) return false;
        await triggerEffects();
        await conn.sendMessage(id, { text: `💡 *تلميح للسؤال:* ${conn.football[id].hint}` }, { quoted: m });
        return true;
    }

    // 4️⃣ أمر الغاء كوره
    if (normalizedBody === 'الغاء كوره' || normalizedBody === 'الغاء كورة' || normalizedBody === 'ايقاف كوره') {
        if (!conn.football[id]) return false;
        await triggerEffects();

        if (conn.football[id].creator !== sender) {
            await conn.sendMessage(id, { text: `❌ عذراً! الشخص اللي بدأ اللعبة هو الوحيد اللي يقدر يلغيها.` }, { quoted: m });
            return true;
        }

        if (conn.football[id].timeout) clearTimeout(conn.football[id].timeout);
        delete conn.football[id];
        await conn.sendMessage(id, { text: `🚫 تم إلغاء السؤال الحالي بنجاح.` }, { quoted: m });
        return true;
    }

    return false;
};

handler.before = async (m, conn) => {
    let rawId = m.key?.remoteJid || m.chat;
    if (!rawId || !conn.football) return false;

    let id = rawId.endsWith('@lid') ? rawId.replace('@lid', '@s.whatsapp.net') : rawId;
    if (!conn.football[id]) return false;

    let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    if (!body) return false;

    let quotedMsgId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
    if (!quotedMsgId || quotedMsgId !== conn.football[id].msgId) {
        return false;
    }

    let userAnswer = normalizeText(body);
    let correctAnswer = normalizeText(conn.football[id].answer);

    if (userAnswer === correctAnswer) {
        if (conn.football[id].timeout) clearTimeout(conn.football[id].timeout);

        let sender = m.sender || m.key?.participant || m.key?.remoteJid;
        if (!sender) return false;

        const ptResult = modifyUserPoints(sender, 15, m.pushName);
        const userPointsTotal = ptResult.total;

        let userDisplay = sender.split('@')[0];

        // تأثير الريأكشن والتأخير للإجابة الصحيحة داخل الـ before handler
        await delay(1000);
        await conn.sendMessage(id, { react: { text: '⚽', key: m.key } });
        await delay(2500);

        await conn.sendMessage(id, {
            text: `🎉 *إجابة صحيحة وأنت الأسرع!* 🥳\n\n🥇 الفائز: @${userDisplay}\n⚽ الإجابة: *${conn.football[id].answer}*\n💰 الجائزة: *+15* نقطة.\n📊 رصيدك الحالي: *${userPointsTotal}* نقطة.`,
            mentions: [sender]
        }, { quoted: m });

        delete conn.football[id];
        return true;
    }
    return false;
};

handler.command = /^(كوره|كورة|لعبة الكورة|كيف لعب كوره|كيف العب كوره|طريقه كوره|تلميح كوره|تلميح كورة|الغاء كوره|الغاء كورة|ايقاف كوره)$/i;
export default handler;
