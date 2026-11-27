import { describe, expect, it } from 'vitest'
import { traderPortrait, traderPortraitOf } from './traderPortraits'

describe('trader portraits in the app', () => {
  it('finds every trader by normalized name or by tarkov.dev id, and the demo ids', () => {
    expect(traderPortrait({ normalizedName: 'prapor' })).toMatch(/prapor.*\.webp/)
    expect(traderPortrait({ id: '5ac3b934156ae10c4430e83c' })).toMatch(/ragman.*\.webp/)
    expect(traderPortrait({ id: '688246958448b05efd61d462', normalizedName: '' })).toMatch(/voevoda.*\.webp/)
    expect(traderPortrait({ id: 'jaeger' })).toMatch(/jaeger.*\.webp/)
  })

  it('a quest\'s trader: by its id, else by its name in Russian or English («Сбор на рейд»\'s cards)', () => {
    expect(traderPortraitOf({ trader: 'Прапор' })).toMatch(/prapor.*\.webp/)
    expect(traderPortraitOf({ trader: 'Ragman' })).toMatch(/ragman.*\.webp/)
    expect(traderPortraitOf({ trader: 'Кто-то', traderId: '5c0647fdd443bc2504c2d371' })).toMatch(/jaeger.*\.webp/)
    expect(traderPortraitOf({ trader: 'Кто-то' })).toBeUndefined()
  })

  it('a trader the app has no portrait for keeps the catalog picture, else none (the card shows the letter)', () => {
    expect(traderPortrait({ id: 'new-one', imageUrl: 'https://raidos.app/x.webp' })).toBe('https://raidos.app/x.webp')
    expect(traderPortrait({ id: 'new-one' })).toBeUndefined()
    expect(traderPortrait(undefined)).toBeUndefined()
  })
})
