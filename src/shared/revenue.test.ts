import { describe, expect, it } from 'vitest'
import { feePercent, netRevenue, PAYOUT_MATURITY_DAYS, PROVIDER_FEE_PERCENT, providerFee, toRoubles, USD_RATE } from './revenue'

describe('revenue: грязными и чистыми', () => {
  it('ЮKassa берёт комиссию по способу оплаты, БЗБ 5 %, доля стримеров и комиссии — из грязных', () => {
    // ЮKassa-СБП 1000 ₽ (3.5 %) + БЗБ 1000 ₽ (5 %), доля стримера 150 ₽ → комиссия 35 + 50 = 85, чистыми 2000 − 150 − 85 = 1765.
    const parts = netRevenue([{ provider: 'yookassa', method: 'sbp', gross: 1000 }, { provider: 'bezebee', gross: 1000 }], 150)
    expect(parts.gross).toBe(2000)
    expect(parts.streamerEarnings).toBe(150)
    expect(parts.fees).toBe(85)
    expect(parts.net).toBe(1765)
  })

  it('ставки ЮKassa по способу; неизвестный способ — запасные 3.53 %', () => {
    expect(feePercent('yookassa', 'sbp')).toBe(3.5)
    expect(feePercent('yookassa', 'tinkoff_bank')).toBe(3.5)
    expect(feePercent('yookassa', 'bank_card')).toBe(4.27)
    expect(feePercent('yookassa', 'sberbank')).toBe(4.27)
    expect(feePercent('yookassa', 'yoo_money')).toBe(3.53) // нет в таблице → default
    expect(feePercent('yookassa', null)).toBe(3.53)
    expect(feePercent('bezebee')).toBe(5)
    expect(feePercent('boosty')).toBe(0)
    expect(PROVIDER_FEE_PERCENT.bezebee).toBe(5)
  })

  it('неизвестный провайдер — без комиссии; рубли проходят как есть, валюта считается по курсу', () => {
    expect(providerFee('lava', null, 1000)).toBe(0)
    expect(toRoubles(500, 'RUB')).toBe(500)
    expect(toRoubles(500, null)).toBe(500)
    expect(toRoubles(0, 'USD', 7)).toBe(Math.round(7 * USD_RATE))
    expect(PAYOUT_MATURITY_DAYS).toBe(14)
  })
})
