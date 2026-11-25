import { describe, expect, it } from 'vitest'
import { netRevenue, PAYOUT_MATURITY_DAYS, PROVIDER_FEE_PERCENT, providerFee, toRoubles, USD_RATE } from './revenue'

describe('revenue: грязными и чистыми', () => {
  it('BZB берёт 5 %, доля стримеров и комиссия вычитаются из грязных', () => {
    // 1000 ₽ грязными по BZB, доля стримера 150 ₽ → комиссия 50 ₽, чистыми 800 ₽.
    const parts = netRevenue({ bezebee: 1000 }, 150)
    expect(parts.gross).toBe(1000)
    expect(parts.streamerEarnings).toBe(150)
    expect(parts.fees).toBe(50)
    expect(parts.net).toBe(800)
  })

  it('ЮKassa и Boosty — заглушка 0 % (ждём владельца), BZB — 5 %', () => {
    expect(PROVIDER_FEE_PERCENT.yookassa).toBe(0)
    expect(PROVIDER_FEE_PERCENT.boosty).toBe(0)
    expect(PROVIDER_FEE_PERCENT.bezebee).toBe(5)
    expect(providerFee('yookassa', 1000)).toBe(0)
    // Пока у ЮKassa 0 %, из двух одинаковых сумм комиссию берём только с BZB.
    expect(netRevenue({ yookassa: 1000, bezebee: 1000 }, 0).net).toBe(2000 - 50)
  })

  it('неизвестный провайдер — без комиссии; рубли проходят как есть, валюту считаем по курсу', () => {
    expect(providerFee('lava', 1000)).toBe(0)
    expect(toRoubles(500, 'RUB')).toBe(500)
    expect(toRoubles(500, null)).toBe(500)
    expect(toRoubles(0, 'USD', 7)).toBe(Math.round(7 * USD_RATE))
    expect(PAYOUT_MATURITY_DAYS).toBe(14)
  })
})
