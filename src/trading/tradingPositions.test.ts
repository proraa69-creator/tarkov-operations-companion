import { beforeEach, describe, expect, it } from 'vitest'
import { fleaMarketFee } from '../domain/fleaFee'
import { askForNet } from '../domain/trading'
import { positionStatus, readPositions, removePosition, savePosition } from './tradingPositions'

const fee = { offerFeeRate: 0.05, requirementFeeRate: 0.05 }
const position = { paid: 40_000, plus: 20_000, base: 100_000 }

beforeEach(() => localStorage.clear())

describe('what the player bought', () => {
  it('waits until a listing 1% under the lowest price earns the chosen sum', () => {
    const ask = askForNet(100_000, 60_000, fee)!
    const under = Math.floor(ask / 0.99) - 200
    expect(positionStatus(position, under, 0, fee)).toEqual({ ask, ready: false })
    const over = Math.ceil(ask / 0.99) + 200
    const status = positionStatus(position, over, 0, fee)
    const listAt = Math.round(over * 0.99)
    expect(status).toMatchObject({ ask, ready: true, route: 'flea', listAt, fee: fleaMarketFee(100_000, listAt, fee) })
    expect(status.earned).toBe(listAt - fleaMarketFee(100_000, listAt, fee) - 40_000)
    expect(status.earned).toBeGreaterThanOrEqual(20_000)
  })

  it('a trader paying enough will do, the better of the two wins', () => {
    expect(positionStatus(position, 1000, 70_000, fee)).toMatchObject({ ready: true, route: 'trader', earned: 30_000 })
    const high = askForNet(100_000, 200_000, fee)!
    expect(positionStatus(position, Math.ceil(high / 0.99), 70_000, fee).route).toBe('flea')
  })

  it('without a price: waiting', () => {
    expect(positionStatus(position, undefined, 0, fee).ready).toBe(false)
  })

  it('a sum the fee does not allow is said so', () => {
    expect(positionStatus({ paid: 70_000_000, plus: 0, base: 2000 }, 80_000_000, 0, fee)).toEqual({ ask: null, ready: false })
  })

  it('one per item in a mode, the modes apart, kept on the device', () => {
    const row = { mode: 'pvp' as const, itemId: 'a', paid: 1, plus: 0, notify: true, boughtAt: 1, base: 10 }
    savePosition(row)
    savePosition({ ...row, paid: 2 })
    savePosition({ ...row, mode: 'pve' })
    expect(readPositions().map((entry) => [entry.mode, entry.paid])).toEqual([['pvp', 2], ['pve', 1]])
    removePosition('pvp', 'a')
    expect(readPositions().map((entry) => entry.mode)).toEqual(['pve'])
  })

  it('a damaged record does not break anything', () => {
    localStorage.setItem('raidos-trading-positions-v1', '{not json')
    expect(readPositions()).toEqual([])
    localStorage.setItem('raidos-trading-positions-v1', JSON.stringify([{ mode: 'x' }, { mode: 'pvp', itemId: 'a', paid: 5, plus: 0, base: 9 }]))
    expect(readPositions()).toMatchObject([{ itemId: 'a', notify: true }])
  })
})
