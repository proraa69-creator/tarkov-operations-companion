import { describe, expect, it } from 'vitest'
import { liveItemBody, parseLiveItem } from './recognisedItem'
import type { ItemOverlayInfo } from '../overlay/types'

const card: ItemOverlayInfo = {
  state: 'found', itemId: 'gpu', name: 'Видеокарта', shortName: 'GPU', iconUrl: 'https://assets.tarkov.dev/gpu.webp', fleaPrice: 500000,
  bestTrader: { name: 'Механик', price: 300000 }, quests: [{ questId: 'q', name: 'Q', trader: 'Механик', count: 1, kappa: false, purpose: 'сдать' }],
  kappa: false, collector: false, mate: true, mateNames: ['A'], source: 'picture',
  keep: { kind: 'quest', need: 1, remaining: 1, reason: 'Q', foundInRaid: false, more: 0 } as unknown as ItemOverlayInfo['keep'],
}

describe('the card as it goes to the phone', () => {
  it('carries what the card shows, not the lookup\'s diagnostics or the keep badge, and comes back the same', () => {
    const body = liveItemBody(card, 1000.4)
    expect(body).not.toHaveProperty('source')
    expect(body).not.toHaveProperty('keep')
    expect(body.at).toBe(1000)
    const back = parseLiveItem({ ...body, receivedAt: '2026-10-15T10:00:00.000Z' })
    expect(back?.at).toBe(1000)
    expect(back?.payload).toMatchObject({ state: 'found', itemId: 'gpu', name: 'Видеокарта', fleaPrice: 500000, bestTrader: { name: 'Механик', price: 300000 }, mate: true, mateNames: ['A'] })
  })

  it('drops a picture address that is not http(s); refuses what is not a card', () => {
    expect(liveItemBody({ ...card, iconUrl: 'javascript:alert(1)' }, 1)).not.toHaveProperty('iconUrl')
    expect(parseLiveItem({ ...liveItemBody(card, 1), iconUrl: 'data:image/png;base64,AAAA' })?.payload).not.toHaveProperty('iconUrl')
    expect(parseLiveItem(null)).toBeNull()
    expect(parseLiveItem({ itemId: 'x', name: 'y' })).toBeNull()
  })
})
