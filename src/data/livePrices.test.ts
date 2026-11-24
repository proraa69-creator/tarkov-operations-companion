import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { fleaRenewedAt } from '../domain/itemPrices'
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

  describe('when each price was renewed (owner, 06.11.2026: «свежеобновленные… на самый верх»)', () => {
    const minute = Math.floor(Date.parse('2026-11-02T08:48:03.000Z') / 60_000)
    const timed = parseLivePrices({ mode: 'regular', updatedAt: at, items: { ledx: { lastLowPrice: 950_000, at: minute }, cqr: { lastLowPrice: 500_000, avg24hPrice: 67_410, at: minute }, old: { lastLowPrice: 10 } } }, 'pvp')
    const quote = (id: string, updatedAt: string, price = 800_000) => item(id, [{ source: 'Барахолка', kind: 'flea', mode: 'pvp', price, basis: 'last-low', updatedAt }])

    it('the item\'s own time, not when the server asked', () => {
      const fresh = withLivePrice(quote('ledx', ''), 'pvp', timed)
      expect(fresh.prices[0]).toMatchObject({ price: 950_000, updatedAt: '2026-11-02T08:48:00.000Z' })
      expect(fleaRenewedAt(fresh, 'pvp')).toBe(Date.parse('2026-11-02T08:48:00.000Z'))
    })

    it('a price renewed at the same sum still moves its time, and the same minute costs no new object', () => {
      const earlier = quote('ledx', '2026-11-02T07:48:03.000Z', 950_000)
      expect(fleaRenewedAt(withLivePrice(earlier, 'pvp', timed), 'pvp')).toBe(Date.parse('2026-11-02T08:48:00.000Z'))
      const same = quote('ledx', '2026-11-02T08:48:03.000Z', 950_000)
      expect(withLivePrice(same, 'pvp', timed)).toBe(same)
    })

    it('a file without times changes nothing: the catalog\'s own time stands while the price is the same', () => {
      const same = quote('old', '2026-11-02T07:48:03.000Z', 10)
      expect(withLivePrice(same, 'pvp', timed)).toBe(same)
      expect(fleaRenewedAt(same, 'pvp')).toBe(Date.parse('2026-11-02T07:48:03.000Z'))
    })

    it('a 24-hour average has no time: there is no offer to be fresh', () => {
      expect(fleaRenewedAt(withLivePrice(item('cqr'), 'pvp', timed), 'pvp')).toBeUndefined()
      expect(fleaRenewedAt(quote('x', ''), 'pvp')).toBeUndefined()
      expect(fleaRenewedAt(quote('x', '2026-11-02T07:48:03.000Z'), 'pve')).toBeUndefined()
    })
  })

  it('keeps the catalog as it is without a snapshot or for items it does not know', () => {
    const items = [item('salewa')]
    expect(withLivePrices(items, 'pvp', null)).toBe(items)
    expect(withLivePrices(items, 'pvp', snapshot)[0]).toBe(items[0])
  })
})
