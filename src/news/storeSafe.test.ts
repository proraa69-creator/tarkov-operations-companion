import { describe, expect, it } from 'vitest'
import { NEWS } from './newsState'
import { storeSafeNews, storeSafeText } from './storeSafe'

describe('the App Store app: news without anything about paying (owner, 12.11.2026)', () => {
  it('drops a line about a subscription, a bonus day, a payment or a trial, keeps the game\'s own', () => {
    expect(storeSafeText('«Добавить точку»: предложите место со скриншотом — +1 день подписки за новую точку')).toBe(false)
    expect(storeSafeText('Беларусь: оплата подписки только в рублях')).toBe(false)
    expect(storeSafeText('Quests: a «7 of 10» counter for kill and hand-over objectives')).toBe(true)
    expect(storeSafeText('Карта: ключи в одной комнате — одна точка, при приближении видны все')).toBe(true)
  })

  it('no shipped news line that is left speaks of paying, and releases with nothing left go', () => {
    const safe = storeSafeNews(NEWS)
    for (const entry of safe) {
      expect(entry.items.length).toBeGreaterThan(0)
      for (const item of entry.items) expect(`${item.ru} ${item.en}`).not.toMatch(/подписк|оплат|subscri/i)
    }
    expect(safe.length).toBeGreaterThan(5)
  })
})
