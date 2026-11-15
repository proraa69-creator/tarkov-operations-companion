/**
 * Russian word forms by the number (report 163, owner 15.11.2026: «осталось 698 дней, осталось 36 дней или там осталось 2 дня»):
 * 1, 21, 101 → «день»; 2–4, 22–24 → «дня»; 0, 5–20, 25–30, 111–114 → «дней».
 */
export function ruPlural(count: number, one: string, few: string, many: string) {
  const whole = Math.abs(Math.trunc(count))
  const tens = whole % 100
  const ones = whole % 10
  if (ones === 1 && tens !== 11) return one
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return few
  return many
}

/** «1 день», «2 дня», «36 дней». */
export const ruDays = (count: number) => `${count} ${ruPlural(count, 'день', 'дня', 'дней')}`

/** «Остался 1 день», «Остался 21 день», «Осталось 2 дня», «Осталось 36 дней». */
export const ruDaysLeft = (count: number) => `${ruPlural(count, 'Остался', 'Осталось', 'Осталось')} ${ruDays(count)}`
