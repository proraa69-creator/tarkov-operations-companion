/**
 * Деньги: выручка грязными (gross) и чистыми (net) и созревание выплат стримерам.
 *
 * Единственное место, откуда расчёт чистой выручки и правило выплат берут и сайт (website/src), и приложение (src), и
 * сервер (server/src). Сервер считает чистыми по этим значениям и отдаёт готовые числа клиентам; клиенты показывают и
 * берут тексты/константы отсюда же, чтобы всё совпадало. Владельцу вписывать проценты и курс — ТОЛЬКО здесь.
 */

/** Платёжные системы, по которым сервис платит комиссию. */
export type RevenueProvider = 'yookassa' | 'bezebee' | 'boosty'

/**
 * Проценты комиссий платёжных систем; владелец, 25.11.2026. Процент берётся от суммы платежа у соответствующего
 * провайдера. Неизвестный провайдер — комиссия 0. Вписывать реальные числа ТОЛЬКО сюда, одним числом на провайдера.
 */
export const PROVIDER_FEE_PERCENT: Record<RevenueProvider, number> = {
  // TODO ждём % от владельца — пока 0 (чистыми по ЮKassa = грязными минус доля стримеров). Вписать одно число.
  yookassa: 0,
  // БЗБ: владелец, 25.11.2026 — 5 %. Чистое по BZB-платежу = amount × 0.95 (минус доля стримера, если есть).
  bezebee: 5,
  // TODO ждём % от владельца — Boosty больше не используется, оставлено для исторических платежей. Вписать одно число.
  boosty: 0,
}

/**
 * Курс доллара к рублю для долларовых оплат; владелец, 25.11.2026; уточнить (ЗАГЛУШКА).
 *
 * Сейчас ВСЕ платежи в рублях (payments.currency = 'RUB'), поэтому курс ни на что не влияет. Ветка на будущее: если
 * появится оплата в валюте (например BZB в USD), рублёвый эквивалент = amount_original (в валюте) × USD_RATE (см.
 * toRoubles). Владелец впишет реальный курс сюда.
 */
export const USD_RATE = 100

/**
 * Рублёвый эквивалент суммы платежа (в той же единице, что и вход; на сервере — копейки). Рубли берём как есть; для
 * валютных оплат пересчитываем исходную сумму по курсу. Сейчас все платежи рублёвые, поэтому всегда возвращает `amount`.
 */
export function toRoubles(amount: number, currency: string | null | undefined, amountOriginal?: number | null): number {
  if (!currency || currency === 'RUB') return amount
  if (currency === 'USD') return Math.round((amountOriginal ?? amount) * USD_RATE)
  return amount
}

/** Комиссия платёжной системы с суммы `gross` (та же единица, что и gross; на сервере — копейки). */
export function providerFee(provider: string, gross: number): number {
  const percent = PROVIDER_FEE_PERCENT[provider as RevenueProvider] ?? 0
  return Math.round(gross * percent / 100)
}

export interface NetRevenueParts {
  /** Грязными — сумма всех платежей. */
  gross: number
  /** Доля стримеров (сумма streamer_earning). */
  streamerEarnings: number
  /** Комиссия платёжных систем суммарно. */
  fees: number
  /** Чистыми = грязными − доля стримеров − комиссия платёжных систем. */
  net: number
}

/**
 * Чистая выручка одной формулой для всех трёх частей проекта: грязными минус доля стримеров минус комиссии платёжных
 * систем. `grossByProvider` — суммы платежей по провайдерам (ключи 'yookassa' | 'bezebee' | 'boosty' | …),
 * `streamerEarnings` — доля стримеров; в той же единице (на сервере — копейки).
 *
 * Пример: платежи BZB 1000 ₽, доля стримеров 150 ₽, комиссия BZB 5 % →
 *   грязными 1000, комиссия 50, доля 150, чистыми 1000 − 150 − 50 = 800.
 */
export function netRevenue(grossByProvider: Record<string, number>, streamerEarnings: number): NetRevenueParts {
  const gross = Object.values(grossByProvider).reduce((sum, value) => sum + value, 0)
  const fees = Object.entries(grossByProvider).reduce((sum, [provider, value]) => sum + providerFee(provider, value), 0)
  return { gross, streamerEarnings, fees, net: gross - streamerEarnings - fees }
}

/**
 * Выплаты стримерам производятся в течение 14 дней после оплаты — на случай возврата (владелец, 25.11.2026). К выводу
 * доступен только заработок с платежей, прошедших столько дней назад и не возвращённых.
 */
export const PAYOUT_MATURITY_DAYS = 14
