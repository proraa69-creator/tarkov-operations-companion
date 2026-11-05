import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { parseLivePrices, withLivePrice, withLivePrices } from './livePrices'

const at = '2026-11-02T09:00:00.000Z'
const item = (id: string, prices: Item['prices'] = []): Item => ({ id, name: id, shortName: id, category: 'Бартер', description: '', prices })
const snapshot = parseLivePrices({ mode: 'regular', updatedAt: at, items: {
  ledx: { lastLowPrice: 950_000, avg24hPrice: 900_000 },
  cqr: { lastLowPrice: 500_000, avg24hPrice: 67_410 },
  bolts: { avg24hPrice: 9_000 },
  key: { lastLowPrice: 40_000, noFlea: true },
} }, 'pvp')

describe('the flea prices of the minute (owner, 02.11.2026: «они тоже должны меняться в реальном времени»)', () => {
  it('reads the server snapshot of one mode only', () => {
    expect(snapshot?.items.size).toBe(4)
    expect(snapshot?.updatedAt).toBe(Date.parse(at))
    expect(snapshot?.pricesAt).toBeUndefined()
    expect(parseLivePrices({ mode: 'regular', updatedAt: at, pricesAt: '2026-11-02T08:48:03.000Z', items: { ledx: { lastLowPrice: 1 } } }, 'pvp')?.pricesAt).toBe(Date.parse('2026-11-02T08:48:03.000Z'))
    expect(parseLivePrices({ mode: 'pve', items: { ledx: { lastLowPrice: 1 } } }, 'pvp')).toBeNull()
    expect(parseLivePrices({ mode: 'regular', items: {} }, 'pvp')).toBeNull()
  })

  it('puts the minute price into the flea quote of that mode and leaves the other modes and traders alone', () => {
    const ledx = item('ledx', [
      { source: 'Барахолка', kind: 'flea', mode: 'pvp', price: 800_000, basis: 'last-low', updatedAt: '' },
      { source: 'Барахолка', kind: 'flea', mode: 'pve', price: 300_000, basis: 'last-low', updatedAt: '' },
      { source: 'Терапевт', kind: 'trader', mode: 'pvp', price: 200_000, updatedAt: '' },
    ])
    const fresh = withLivePrice(ledx, 'pvp', snapshot)
    expect(fresh.prices.map((quote) => [quote.mode, quote.kind, quote.price])).toEqual([['pvp', 'flea', 950_000], ['pve', 'flea', 300_000], ['pvp', 'trader', 200_000]])
    expect(fresh.prices[0]).toMatchObject({ basis: 'last-low', updatedAt: at })
  })

  it('takes the day average for a lone listing, adds a flea price the catalog lacked, drops one the flea no longer takes', () => {
    expect(withLivePrice(item('cqr'), 'pvp', snapshot).prices).toMatchObject([{ kind: 'flea', price: 67_410, basis: 'avg-24h' }])
    expect(withLivePrice(item('bolts'), 'pvp', snapshot).prices).toMatchObject([{ kind: 'flea', price: 9_000, basis: 'avg-24h' }])
    const key = item('key', [{ source: 'Барахолка', kind: 'flea', mode: 'pvp', price: 35_000, updatedAt: '' }])
    expect(withLivePrice(key, 'pvp', snapshot).prices).toEqual([])
  })

  it('keeps the catalog as it is without a snapshot or for items it does not know', () => {
    const items = [item('salewa')]
    expect(withLivePrices(items, 'pvp', null)).toBe(items)
    expect(withLivePrices(items, 'pvp', snapshot)[0]).toBe(items[0])
  })
})
