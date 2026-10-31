import { describe as describeLow, expect as expectLow, it as itLow } from 'vitest'
import { isCountryCode } from './countries'
import { ASIA_PRICE_COUNTRIES, CIS_PAYMENT_COUNTRIES, LOW_INCOME_PRICE_COUNTRIES, paymentRegionOf as regionOfLow } from './paymentRegions'

// Owner, 01.11.2026: «все азиатские страны… и все страны где низкий уровень жизни и зп, их добавь в снг».
describeLow('the CIS price for Asia and the low-income countries', () => {
  itLow('lists only real country codes, and never Russia or Cyprus', () => {
    for (const code of [...ASIA_PRICE_COUNTRIES, ...LOW_INCOME_PRICE_COUNTRIES]) expectLow(isCountryCode(code), code).toBe(true)
    expectLow(CIS_PAYMENT_COUNTRIES).not.toContain('RU')
    expectLow(CIS_PAYMENT_COUNTRIES).not.toContain('CY')
  })
  itLow('gives Asia and the low-income countries the CIS price; Russia SBP, Europe and the rest the world price', () => {
    for (const code of ['KZ', 'BY', 'IN', 'CN', 'TR', 'GE', 'VN', 'JP', 'NG', 'EG', 'BO']) expectLow(regionOfLow(code), code).toBe('CIS')
    expectLow(regionOfLow('RU')).toBe('RU')
    for (const code of ['DE', 'US', 'UA', 'BR', 'CY', 'XX']) expectLow(regionOfLow(code), code).toBe('WORLD')
  })
})
