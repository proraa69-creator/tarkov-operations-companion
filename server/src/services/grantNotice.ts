/**
 * The popup that granted days bring to the player's apps (owner, 02.11.2026: «когда я зачисляю бонусные дни за отчет или
 * еще что либо, у человека в окне должно появлятся окно в котором написано "Вам зачислено N дней за отчет. Спасибо"»):
 * a personal announcement (NoticeStore.personal). A reward names the report or the idea (routes/bugReports.ts gives the
 * reason «Отчёт об ошибке №N» / «Предложение №N»); the owner's own reason for other grants stays in the admin panel.
 */
export interface NoticeTexts { title: string; text: string; titleEn: string; textEn: string }

export function grantNoticeTexts(days: number, reason: string): NoticeTexts {
  const what = /^Отчёт об ошибке №/.test(reason) ? { ru: ' за отчёт', en: ' for your report' }
    : /^Предложение №/.test(reason) ? { ru: ' за предложение', en: ' for your idea' }
      : { ru: '', en: '' }
  return { title: `${creditedRu(days)}${what.ru}`, text: 'Спасибо!', titleEn: `${daysEn(days)} added${what.en}`, textEn: 'Thank you!' }
}

/** «Взял в работу» (owner, 06.11.2026: «у человека появляется уведомление, что его отчет принят в работу. Чтобы они видели, что работа ведется по их заявкам»). */
export function reportTakenNoticeTexts(id: number, kind: 'bug' | 'idea'): NoticeTexts {
  return kind === 'idea'
    ? { title: `Предложение №${id} принято в работу`, text: 'Спасибо!', titleEn: `Your idea №${id} is being worked on`, textEn: 'Thank you!' }
    : { title: `Отчёт №${id} принят в работу`, text: 'Спасибо!', titleEn: `Your report №${id} is being worked on`, textEn: 'Thank you!' }
}

/** The free days of the one-time bonus to the accounts that never paid (services/trialBonus.ts). */
export function trialBonusNoticeTexts(days: number): NoticeTexts {
  return { title: `${creditedRu(days)} пробного периода`, text: 'Спасибо, что пользуетесь Raid OS!', titleEn: `${daysEn(days)} of free trial added`, textEn: 'Thank you for using Raid OS!' }
}

/** «Вам зачислен 1 день», «Вам зачислено 2 дня», «Вам зачислено 5 дней», «Вам зачислен 21 день». */
function creditedRu(days: number) {
  const ones = days % 10
  const tens = days % 100
  if (ones === 1 && tens !== 11) return `Вам зачислен ${days} день`
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `Вам зачислено ${days} дня`
  return `Вам зачислено ${days} дней`
}

const daysEn = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`
