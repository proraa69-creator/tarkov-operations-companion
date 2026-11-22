import { afterEach, describe, expect, it } from 'vitest'
import { clearTakenItemsBefore, forgetKeysAddedByTaken, keysAddedByTaken, readTakenItems, setItemTaken, setKeyAddedByTaken } from './takenItems'

afterEach(() => { localStorage.clear() })

// Owner, 16.11.2026: «если снять отметку «Взял»… ключ должен остаться «в наличии»».
describe('keys «Взял» put into the stash', () => {
  it('are kept per profile and mode, after the raid too, and stable between reads', () => {
    setKeyAddedByTaken('p', 'pvp', 'k1', true)
    setItemTaken('p', 'pvp', 'k1', true, 1_000)
    expect(keysAddedByTaken('p', 'pvp')).toBe(keysAddedByTaken('p', 'pvp'))
    expect([...keysAddedByTaken('p', 'pvp')]).toEqual(['k1'])
    expect(keysAddedByTaken('p', 'pve').size).toBe(0)
    expect(keysAddedByTaken('p', 'seasonal').size).toBe(0)
    expect(keysAddedByTaken('other', 'pvp').size).toBe(0)
    // the raid is over: the mark goes, the key stays known
    clearTakenItemsBefore('p', 2_000)
    expect(readTakenItems('p', 'pvp').has('k1')).toBe(false)
    expect(keysAddedByTaken('p', 'pvp').has('k1')).toBe(true)
  })

  it('a scan that sees one forgets only that one', () => {
    setKeyAddedByTaken('p', 'pvp', 'k1', true)
    setKeyAddedByTaken('p', 'pvp', 'k2', true)
    setKeyAddedByTaken('p', 'pve', 'k1', true)
    forgetKeysAddedByTaken('p', 'pvp', ['k1', 'unrelated'])
    expect([...keysAddedByTaken('p', 'pvp')]).toEqual(['k2'])
    expect([...keysAddedByTaken('p', 'pve')]).toEqual(['k1'])
  })
})
