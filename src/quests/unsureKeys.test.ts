import { afterEach, describe, expect, it } from 'vitest'
import { keysAddedByTaken, setKeyAddedByTaken } from '../progression/takenItems'
import { readOwnedKeys, setOwnedKey } from './ownedKeys'
import { dropUnsureKeys, isUnsureKey, readUnsureKeys, resolveUnsureKeys, unsureKeysKey, writeUnsureKeys } from './unsureKeys'

afterEach(() => localStorage.clear())

const cabin = { ids: ['k-cabin', 'k-trailer'], seen: 2 }
const safe = { ids: ['k-safe-1', 'k-safe-2', 'k-safe-3'], seen: 1 }

// Owner, 27.11.2026: «Ключи, которые у нас появились под вопросом, выбираешь какой надо и нажимаешь галочку… какой и сколько
// добавить. А которые не нужны, нажимаешь «Убрать»».
describe('«Ключи под вопросом»', () => {
  it('«Ок»: the ticked keys join the stash, at least as many as ticked; the label told leaves, the one without a tick stays', () => {
    writeUnsureKeys('p', 'pvp', new Map([['Времянка', cabin], ['Сейф', safe]]))
    setOwnedKey('p', 'pvp', 'k-trailer', 3)
    const added = resolveUnsureKeys('p', 'pvp', new Map([['Времянка', new Map([['k-cabin', 1], ['k-trailer', 1]])]]))
    expect(added).toBe(1)
    expect(readOwnedKeys('p', 'pvp')).toEqual(new Map([['k-trailer', 3], ['k-cabin', 1]]))
    expect([...readUnsureKeys('p', 'pvp').keys()]).toEqual(['Сейф'])
  })

  it('a key not of the label, a label gone, no pieces: nothing added', () => {
    writeUnsureKeys('p', 'pvp', new Map([['Времянка', cabin]]))
    resolveUnsureKeys('p', 'pvp', new Map([
      ['Времянка', new Map([['k-other', 2], ['k-cabin', 0]])],
      ['Сейф', new Map([['k-safe-1', 1]])],
    ]))
    expect(readOwnedKeys('p', 'pvp').size).toBe(0)
    expect(readUnsureKeys('p', 'pvp').has('Времянка')).toBe(true)
  })

  it('a key «Взял» put in the list and chosen here is a stash key, as after a scan', () => {
    writeUnsureKeys('p', 'pvp', new Map([['Времянка', cabin]]))
    setOwnedKey('p', 'pvp', 'k-cabin', 1)
    setKeyAddedByTaken('p', 'pvp', 'k-cabin', true)
    resolveUnsureKeys('p', 'pvp', new Map([['Времянка', new Map([['k-cabin', 2]])]]))
    expect(readOwnedKeys('p', 'pvp').get('k-cabin')).toBe(2)
    expect(keysAddedByTaken('p', 'pvp').has('k-cabin')).toBe(false)
  })

  it('«Убрать» drops the label and adds nothing; the last one leaves nothing stored', () => {
    writeUnsureKeys('p', 'pvp', new Map([['Времянка', cabin], ['Сейф', safe]]))
    dropUnsureKeys('p', 'pvp', ['Сейф'])
    expect([...readUnsureKeys('p', 'pvp').keys()]).toEqual(['Времянка'])
    dropUnsureKeys('p', 'pvp', ['Времянка'])
    expect(localStorage.getItem(unsureKeysKey('p', 'pvp'))).toBeNull()
    expect(readOwnedKeys('p', 'pvp').size).toBe(0)
  })

  it('PvP, PvE and Season, and each profile, apart; a damaged value reads as nothing', () => {
    writeUnsureKeys('p', 'pve', new Map([['Времянка', cabin]]))
    expect(readUnsureKeys('p', 'pvp').size).toBe(0)
    expect(readUnsureKeys('p', 'seasonal').size).toBe(0)
    expect(readUnsureKeys('other', 'pve').size).toBe(0)
    expect(readUnsureKeys('p', 'pve').get('Времянка')).toEqual(cabin)
    localStorage.setItem(unsureKeysKey('p', 'pvp'), '{broken')
    expect(readUnsureKeys('p', 'pvp').size).toBe(0)
    localStorage.setItem(unsureKeysKey('p', 'pvp'), JSON.stringify({ A: { ids: [], seen: 1 }, B: { ids: ['x'], seen: 0 }, C: cabin }))
    expect([...readUnsureKeys('p', 'pvp').keys()]).toEqual(['C'])
    expect(isUnsureKey(cabin)).toBe(true)
    expect(isUnsureKey({ ids: ['x', 2], seen: 1 })).toBe(false)
  })

  it('writes nothing when nothing changed: no event, nothing for the account to send', () => {
    writeUnsureKeys('p', 'pvp', new Map([['Времянка', cabin]]))
    let heard = 0
    const count = () => { heard += 1 }
    window.addEventListener('raidos-owned-keys-changed', count)
    try {
      writeUnsureKeys('p', 'pvp', new Map([['Времянка', { ...cabin }]]))
      expect(heard).toBe(0)
      writeUnsureKeys('p', 'pvp', new Map())
      expect(heard).toBe(1)
    } finally { window.removeEventListener('raidos-owned-keys-changed', count) }
  })
})
