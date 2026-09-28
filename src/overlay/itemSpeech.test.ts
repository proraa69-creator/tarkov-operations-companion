import { describe, expect, it } from 'vitest'
import { itemSpeech } from './OverlayApp'

describe('item speech', () => {
  it('reads name, flea price, best trader and Collector', () => {
    const text = itemSpeech({ state: 'found', itemId: 'a', name: 'Старинный топор', shortName: 'Топор', fleaPrice: 45200, bestTrader: { name: 'Терапевт', price: 12000 }, quests: [], kappa: true, collector: true })
    expect(text).toBe('Топор. барахолка 45 тысяч. Терапевт 12 тысяч. нужен для Коллекционера')
  })
  it('says when nothing was recognised', () => {
    expect(itemSpeech({ state: 'not-found' })).toBe('Предмет не распознан')
  })
})
