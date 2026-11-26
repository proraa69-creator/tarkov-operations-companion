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
 * Проценты комиссий платёжных систем; владелец, 25.11.2026. Процент берётся от суммы платежа. Неизвестный провайдер — 0.
 * Вписывать реальные числа ТОЛЬКО сюда.
 *
 * ЮKassa — ставки ПО СПОСОБУ оплаты (payments.method), по данным самой ЮKassa (income_amount vs amount, 435 оплат,
 * 25.11.2026): СБП и Т-Банк 3.5 %, карта и Сбербанк 4.27 %, в среднем 3.53 %. `default` — для неизвестного/нового способа
 * (например yoo_money). БЗБ — 5 % (зачисляет уже за вычетом; в payments.amount у нас лежит list/грязными, поэтому
 * вычитаем 5 %). Boosty — старый архивный провайдер, ставка неизвестна («архив»); на итог почти не влияет.
 */
export const PROVIDER_FEE_PERCENT = {
  yookassa: { sbp: 3.5, tinkoff_bank: 3.5, bank_card: 4.27, sberbank: 4.27, default: 3.53 } as Record<string, number>,
  bezebee: 5,
  boosty: 0,
}

/**
 * Курс доллара к рублю для валютных оплат; владелец, 25.11.2026 (курс БЗБ, уточнять). Сейчас в payments.amount у всех
 * платежей рубли (долларовые Global-оплаты БЗБ владелец вносит уже в рублях), поэтому курс в расчёте не участвует. Ветка
 * на будущее (см. toRoubles): если сумма начнёт храниться в валюте — рублёвый эквивалент = amount_original × курс.
 */
export const USD_RATE = 84.43
/** Курс евро к рублю (на будущее; владелец, 25.11.2026). */
export const EUR_RATE = 92.59

/**
 * Рублёвый эквивалент суммы платежа (та же единица, что и вход; на сервере — копейки). Рубли берём как есть; валюту
 * пересчитываем по курсу. Сейчас все платежи рублёвые, поэтому всегда возвращает `amount`.
 */
export function toRoubles(amount: number, currency: string | null | undefined, amountOriginal?: number | null): number {
  if (!currency || currency === 'RUB') return amount
  if (currency === 'USD') return Math.round((amountOriginal ?? amount) * USD_RATE)
  if (currency === 'EUR') return Math.round((amountOriginal ?? amount) * EUR_RATE)
  return amount
}

/** Процент комиссии для платежа данного провайдера и способа оплаты (`method` важен только для ЮKassa). */
export function feePercent(provider: string, method?: string | null): number {
  const fee = (PROVIDER_FEE_PERCENT as Record<string, unknown>)[provider]
  if (typeof fee === 'number') return fee
  if (fee && typeof fee === 'object') {
    const byMethod = fee as Record<string, number>
    return byMethod[method ?? 'default'] ?? byMethod.default ?? 0
  }
  return 0
}

/** Комиссия платёжной системы с суммы `gross` (та же единица, что и gross; на сервере — копейки). */
export function providerFee(provider: string, method: string | null | undefined, gross: number): number {
  return Math.round(gross * feePercent(provider, method) / 100)
}

/** Группа платежей одного провайдера и способа оплаты: сумма грязными (в копейках на сервере). */
export interface GrossGroup { provider: string; method?: string | null; gross: number }

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
 * систем. `groups` — суммы платежей, разбитые по провайдеру и способу оплаты; `streamerEarnings` — доля стримеров; в той
 * же единице (на сервере — копейки).
 *
 * Пример: ЮKassa-СБП 1000 ₽ (3.5 %) + БЗБ 1000 ₽ (5 %), доля стримеров 150 ₽ →
 *   грязными 2000, комиссия 35 + 50 = 85, доля 150, чистыми 2000 − 150 − 85 = 1765.
 */
export function netRevenue(groups: GrossGroup[], streamerEarnings: number): NetRevenueParts {
  const gross = groups.reduce((sum, group) => sum + group.gross, 0)
  const fees = groups.reduce((sum, group) => sum + providerFee(group.provider, group.method, group.gross), 0)
  return { gross, streamerEarnings, fees, net: gross - streamerEarnings - fees }
}

/**
 * Выплаты стримерам производятся в течение 14 дней после оплаты — на случай возврата (владелец, 25.11.2026). К выводу
 * доступен только заработок с платежей, прошедших столько дней назад и не возвращённых.
 */
export const PAYOUT_MATURITY_DAYS = 14
