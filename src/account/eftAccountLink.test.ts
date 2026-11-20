import { describe, expect, it } from 'vitest'
import { eftAccountIdOf } from './eftAccountLink'

describe('the game account of this PC from its logs', () => {
  // support chat, 20.11.2026: two players on one PC — the Season under the bound account, the other's PvP before it
  it('is the one that played last, whatever the mode', () => {
    expect(eftAccountIdOf({ latestMode: 'seasonal', latestAccountIdByMode: { pvp: 888, seasonal: 442 }, accountIds: [888, 442] })).toBe(442)
    expect(eftAccountIdOf({ latestMode: 'pvp', latestAccountIdByMode: { pvp: 888, seasonal: 442 }, accountIds: [888, 442] })).toBe(888)
  })

  it('without the newest mode: PvP, then PvE, then the Season', () => {
    expect(eftAccountIdOf({ latestAccountIdByMode: { pve: 2, seasonal: 3 }, accountIds: [2, 3] })).toBe(2)
    expect(eftAccountIdOf({ latestMode: 'pve', latestAccountIdByMode: { pvp: 1 }, accountIds: [1] })).toBe(1)
    expect(eftAccountIdOf({ latestAccountIdByMode: {}, accountIds: [] })).toBeUndefined()
  })
})
