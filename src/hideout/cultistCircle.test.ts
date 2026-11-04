import { describe, expect, it } from 'vitest'
import { circleRows, circleTime, CULTIST_EXCHANGES, exchangeDrops, exchangeRewards, stackCount, type CircleExchange } from './cultistCircle'

const CULTIST_FIGURINE = '655c669103999d3c810c025b'
const SKULL_MASK = '635267ab3c89e2112001f826'
const CULTIST_KNIFE = '5fc64ea372b0dd78d51159dc'
const BITCOIN = '59faff1d86f7746c51718c9c'

describe('the circle\'s fixed exchanges', () => {
  it('holds only what surely drops: no figurine whose reward goes by chance', () => {
    expect(CULTIST_EXCHANGES).toHaveLength(60)
    const put = new Set(CULTIST_EXCHANGES.flatMap((exchange) => exchange.put.map(([id]) => id)))
    // Den, Tagilla, Scav: the wiki says «and/or», «or»
    for (const id of ['66572b8d80b1cd4b6a67847f', '66572cbdad599021091c611a', '655c673673a43e23e857aebd']) expect(put.has(id), id).toBe(false)
    for (const { put: spent, get, seconds } of CULTIST_EXCHANGES) {
      expect(spent.length).toBeGreaterThan(0)
      expect(get.length).toBeGreaterThan(0)
      expect([360, 666, 3960, 39960]).toContain(seconds)
      for (const stack of [...spent, ...get]) {
        expect(stack[0]).toMatch(/^[0-9a-f]{24}$/)
        expect(stackCount(stack)).toBeGreaterThan(0)
      }
    }
  })

  it('tells one figurine from five by the count of what goes in', () => {
    const one = CULTIST_EXCHANGES.find((exchange) => exchange.get.some(([id]) => id === SKULL_MASK))!
    const five = CULTIST_EXCHANGES.find((exchange) => exchange.get.some(([id]) => id === CULTIST_KNIFE))!
    expect(one).toMatchObject({ put: [[CULTIST_FIGURINE]], seconds: 3960 })
    expect(five).toMatchObject({ put: [[CULTIST_FIGURINE, 5]], seconds: 39960 })
  })

  it('marks the exchanges that work every time, the Bitcoin halves among them', () => {
    expect(CULTIST_EXCHANGES.filter((exchange) => exchange.repeatable)).toHaveLength(6)
    const halves = CULTIST_EXCHANGES.find((exchange) => exchange.get.some(([id]) => id === BITCOIN))!
    expect(halves).toMatchObject({ repeatable: true, seconds: 666 })
    expect(halves.put).toHaveLength(2)
  })
})

describe('the list of rewards', () => {
  const exchange = (put: CircleExchange['put'], get: CircleExchange['get']): CircleExchange => ({ put, get, seconds: 3960 })

  it('lists what comes out beyond what went in: an item that only comes back is no reward', () => {
    const hologram = exchange([['cat']], [['cat'], ['keycard']])
    expect(exchangeRewards(hologram)).toEqual([['keycard']])
    expect(exchangeRewards(exchange([['fence']], [['fence', 3]]))).toEqual([['fence', 3]])
    // nothing but the item itself: listed under it
    expect(exchangeRewards(exchange([['dumbbell']], [['dumbbell']]))).toEqual([['dumbbell']])
  })

  it('writes everything that drops together: the rewards, then what only comes back', () => {
    expect(exchangeDrops(exchange([['cat']], [['cat'], ['keycard']]))).toEqual([['keycard'], ['cat']])
    expect(exchangeDrops(exchange([['a']], [['goal', 4], ['bonus']]))).toEqual([['goal', 4], ['bonus']])
    expect(exchangeDrops(exchange([['dumbbell']], [['dumbbell']]))).toEqual([['dumbbell']])
  })

  it('gives one row per exchange, with what a quest may want apart, and only exchanges the catalog fully knows', () => {
    const first = exchange([['a']], [['a'], ['goal', 2], ['bonus']])
    const unknown = exchange([['missing']], [['other']])
    const rows = circleRows((id) => id !== 'missing', [first, unknown])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ exchange: first, drops: [['goal', 2], ['bonus'], ['a']], rewards: [['goal', 2], ['bonus']] })
  })

  it('every real exchange is a row of its own', () => {
    const rows = circleRows()
    expect(rows).toHaveLength(CULTIST_EXCHANGES.length)
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })
})

describe('the time of an exchange', () => {
  it('reads as in the game, in both languages', () => {
    expect(circleTime(360)).toBe('6 мин')
    expect(circleTime(3960)).toBe('1 ч 6 мин')
    expect(circleTime(39960)).toBe('11 ч 6 мин')
    expect(circleTime(666)).toBe('11 мин 6 с')
    expect(circleTime(3960, 'en')).toBe('1 h 6 min')
    expect(circleTime(666, 'en')).toBe('11 min 6 s')
  })
})
