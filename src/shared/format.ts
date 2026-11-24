export function formatPrice(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value) + ' ₽'
}

/** How long ago to the minute («1 ч 33 мин назад»): the age of one price, where «2 ч назад» would hide half an hour. */
export function ageText(ms: number, locale: 'ru' | 'en') {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return locale === 'en' ? 'just now' : 'только что'
  const hours = Math.floor(minutes / 60)
  if (!hours) return locale === 'en' ? `${minutes} min ago` : `${minutes} мин назад`
  return locale === 'en' ? `${hours} h ${minutes % 60} min ago` : `${hours} ч ${minutes % 60} мин назад`
}

export function timeAgo(timestamp?: number) {
  if (!timestamp) return 'демо-данные'
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  return `${Math.round(minutes / 60)} ч назад`
}
