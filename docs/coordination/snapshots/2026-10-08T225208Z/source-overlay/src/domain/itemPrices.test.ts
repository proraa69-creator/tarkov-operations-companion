import { describe, expect, it } from 'vitest'
import type { Item, PriceQuote, RaidMode } from './types'
import { bestSale, displayPrice, favoritePriceLabel, fleaQuote, fleaSale, modeQuotes, traderQuotes } from './itemPrices'
import { fleaMarketFee } from './fleaFee'

const quote = (source: string, price: number, mode: RaidMode, extra: Partial<PriceQuote> = {}): PriceQuote => ({ source, price, mode, updatedAt: '', ...extra })
const item = (prices: PriceQuote[], extra: Partial<Item> = {}): Item => ({ id: 'x', name: 'X', shortName: 'X', category: 'Бартер', description: '', prices, ...extra })

/** One item as a merged multi-mode list would have it: PvP and PvE flea prices differ, Season has its own. */
const gpu = item([
  quote('Барахолка', 600000, 'pvp', { kind: 'flea', basis: 'last-low' }),
  quote('Терапевт', 124000, 'pvp', { kind: 'trader' }),
  quote('Барахолка', 410000, 'pve', { kind: 'flea', basis: 'last-low' }),
  quote('Терапевт', 124000, 'pve', { kind: 'trader' }),
  quote('Терапевт', 124000, 'seasonal', { kind: 'trader' }),
], { basePrice: 100000 })

describe('item prices: one mode at a time', () => {
  it('reads only the quotes of the asked mode — PvP and PvE flea prices never mix', () => {
    expect(fleaQuote(gpu, 'pvp')?.price).toBe(600000)
    expect(fleaQuote(gpu, 'pve')?.price).toBe(410000)
    expect(modeQuotes(gpu, 'pve').every((entry) => entry.mode === 'pve')).toBe(true)
    expect(displayPrice(gpu, 'pvp')).toEqual({ source: 'Барахолка', kind: 'flea', price: 600000 })
    expect(displayPrice(gpu, 'pve')).toEqual({ source: 'Барахолка', kind: 'flea', price: 410000 })
  })

  it('Season without a Season flea price shows its trader price, never the PvP or PvE flea price', () => {
    expect(fleaQuote(gpu, 'seasonal')).toBeUndefined()
    expect(displayPrice(gpu, 'seasonal')).toEqual({ source: 'Терапевт', kind: 'trader', price: 124000 })
    expect(bestSale(gpu, 'seasonal')?.kind).toBe('trader')
    expect(displayPrice(item([quote('Барахолка', 500, 'pvp')]), 'seasonal')).toBeUndefined()
  })

  it('a quote without a mode is not taken for any mode', () => {
    const legacy = item([{ source: 'Барахолка', price: 999, updatedAt: '' } as PriceQuote])
    expect(displayPrice(legacy, 'pvp')).toBeUndefined()
  })
})

describe('item prices: no inflated «best price»', () => {
  it('shows the flea price even when the highest number is elsewhere, and labels a 24-hour average', () => {
    // Old code: Math.max over every quote of the mode. Here a trader quote is above the flea price (rare, but the max
    // would have picked it and called it the flea market's «лучшее предложение»).
    const odd = item([quote('Барахолка', 36500, 'pvp', { kind: 'flea', basis: 'last-low' }), quote('Терапевт', 40000, 'pvp', { kind: 'trader' })])
    expect(displayPrice(odd, 'pvp')).toEqual({ source: 'Барахолка', kind: 'flea', price: 36500 })
    const average = item([quote('Барахолка', 41000, 'pvp', { kind: 'flea', basis: 'avg-24h' })])
    expect(displayPrice(average, 'pvp')).toEqual({ source: 'Барахолка', kind: 'flea', price: 41000, average: true })
    expect(favoritePriceLabel(displayPrice(average, 'pvp'))).toBe('барахолка, среднее за 24 ч')
    expect(favoritePriceLabel(displayPrice(odd, 'pvp'))).toBe('барахолка, минимальное предложение')
    expect(favoritePriceLabel(undefined)).toBe('нет цены')
  })

  it('best sale compares the flea price AFTER the fee with the traders (like with like)', () => {
    // Flea 130 000 ₽ looks better than the trader's 125 000 ₽, but the seller keeps 130 000 − 7 015 = 122 985 ₽.
    const fee = fleaMarketFee(100000, 130000)
    expect(fee).toBe(7015)
    const close = item([quote('Барахолка', 130000, 'pvp', { kind: 'flea' }), quote('Механик', 125000, 'pvp', { kind: 'trader' })], { basePrice: 100000 })
    expect(bestSale(close, 'pvp')).toEqual({ source: 'Механик', kind: 'trader', price: 125000, net: 125000 })
    expect(fleaSale(close, 'pvp')).toEqual({ source: 'Барахолка', kind: 'flea', price: 130000, net: 130000 - fee, fee })
    // GPU (economy fixture numbers): 600 000 ₽ on the flea, fee 52 835 ₽, still far above the trader.
    expect(bestSale(gpu, 'pvp')).toEqual({ source: 'Барахолка', kind: 'flea', price: 600000, net: 600000 - fleaMarketFee(100000, 600000), fee: fleaMarketFee(100000, 600000) })
  })

  it('base price is a fallback for lists, never a sale', () => {
    const base = item([quote('Базовая цена', 5000, 'pvp', { kind: 'base' })])
    expect(displayPrice(base, 'pvp')).toEqual({ source: 'Базовая цена', kind: 'base', price: 5000 })
    expect(bestSale(base, 'pvp')).toBeUndefined()
    expect(traderQuotes(base, 'pvp')).toEqual([])
  })

  it('reads quotes of older catalogs (no kind) by their source name', () => {
    const old = item([quote('Барахолка', 29600, 'pvp'), quote('Терапевт', 22500, 'pvp'), quote('Барахолка', 34000, 'pve')])
    expect(fleaQuote(old, 'pvp')?.price).toBe(29600)
    expect(traderQuotes(old, 'pvp').map((entry) => entry.source)).toEqual(['Терапевт'])
  })
})
