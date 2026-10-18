import { describe, expect, it } from 'vitest'
import { itemNotificationText } from './itemNotification'

describe('item notification text', () => {
  it('names the item, its prices and the quests that need it', () => {
    const text = itemNotificationText({
      name: 'Гофрированный шланг', shortName: 'Шланг', kappa: true, fleaPrice: 12345, bestTrader: { name: 'Механик', price: 9000 },
      quests: [{ questId: 'q', name: 'Шоу', trader: 'Прапор', count: 2, kappa: false, purpose: 'сдать' }],
    })
    expect(text.title).toBe('Гофрированный шланг · Каппа')
    expect(text.body).toContain('Шоу ×2')
    expect(text.body).toContain('Механик')
    expect(text.body.split('\n')).toHaveLength(2)
  })

  it('says the price is unknown and leaves out an empty quest line', () => {
    const text = itemNotificationText({ name: 'Болт', shortName: 'Болт', kappa: false, quests: [] })
    expect(text.title).toBe('Болт')
    expect(text.body).toBe('Цена неизвестна')
  })
})
