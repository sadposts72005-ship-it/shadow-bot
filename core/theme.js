// core/theme.js
// ⧼ 𝑺𝑯𝑨𝑫𝑶𝑾 𝑩𝑶𝑻 ⧽ v2 - الهوية المظلمة 🖤✨

export const shadowTheme = {
  // الرموز الأساسية (Shadow Mode)
  shadow: '🥷',
  moon: '🌙',
  star: '✨',
  ghost: '👻',
  dark: '🖤',
  blade: '🗡️',
  target: '🎯',
  shadowBadge: '『 𝑺𝑯𝑨𝑫𝑶𝑾 』',
  
  // الفواصل الشبحية
  divider: '❖ ━━━⧼ 𝑺𝑯𝑨𝑫𝑶𝑾 𝑩𝑶𝑻 ⧽━━━ ❖',
  smallDivider: '❖ ━━━━ ❖',
  endDivider: '❖ ━━━━━━━━━━━━━━━━━━━━ ❖',
  
  // تنسيق النصوص السريعة
  title: (text) => `> 🥷 *${text}*`,
  subtitle: (text) => `> 🖤 *${text}*`,
  info: (text) => `> ✨ *${text}*`,
  warning: (text) => `> ⚠️ *${text}*`,
  success: (text) => `> ✅ *${text}*`,
  error: (text) => `> ❌ *${text}*`,
  
  // بناء الرسائل الهيكلية المعقدة (الألعاب والقوائم)
  build: (sections) => {
    let msg = `> ${shadowTheme.divider}\n>\n`
    for (const section of sections) {
      if (section.type === 'title') {
        msg += `> 🥷 *${section.text}*\n`
      } else if (section.type === 'subtitle') {
        msg += `> 🖤 *${section.text}*\n`
      } else if (section.type === 'info') {
        msg += `> ✨ *${section.label}:* ${section.value}\n`
      } else if (section.type === 'line') {
        msg += `> ${section.text}\n`
      } else if (section.type === 'divider') {
        msg += `> ${shadowTheme.smallDivider}\n`
      } else if (section.type === 'spacer') {
        msg += `> \n`
      }
    }
    msg += `>\n> ${shadowTheme.endDivider}`
    return msg
  }
}

export const formatWithShadow = (data) => {
  return shadowTheme.build(data)
}

