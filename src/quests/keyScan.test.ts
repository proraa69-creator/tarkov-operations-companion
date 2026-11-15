import { afterEach, describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { keysAddedByTaken, setKeyAddedByTaken } from '../progression/takenItems'
import { createKeyScan } from './keyScan'
import { readOwnedKeys, setOwnedKey } from './ownedKeys'

const key = (id: string, name: string, shortName: string) => ({ id, name, shortName, category: 'Ключ' }) as unknown as Item

afterEach(() => {
  delete window.tarkovDesktop
  localStorage.clear()
})

// Owner, 16.11.2026: a key «Взял» put into «Ключи в схроне» stays there; a scan only adds to it.
describe('«Найти ключи» and the keys «Взял» put into the stash', () => {
  it('a scan that does not see such a key leaves it; one that sees it makes it a stash key', async () => {
    const items = [key('k-dorm', 'Ключ от комнаты 314 в общежитии', 'Общ. 314'), key('k-gas', 'Ключ от заправки', 'Заправка')]
    setOwnedKey('p', 'pvp', 'k-dorm', 1)
    setKeyAddedByTaken('p', 'pvp', 'k-dorm', true)
    let text = 'Заправка'
    window.tarkovDesktop = { scanScreenText: async () => ({ gameWindow: true, text }) } as unknown as NonNullable<Window['tarkovDesktop']>
    const scan = createKeyScan({ items, wanted: ['k-dorm'], profileId: 'p', mode: 'pvp' })
    await scan.pass(true)
    expect([...readOwnedKeys('p', 'pvp').keys()].sort()).toEqual(['k-dorm', 'k-gas'])
    expect(keysAddedByTaken('p', 'pvp').has('k-dorm')).toBe(true)
    text = 'Общ. 314'
    await scan.pass(false)
    expect(readOwnedKeys('p', 'pvp').has('k-dorm')).toBe(true)
    expect(keysAddedByTaken('p', 'pvp').has('k-dorm')).toBe(false)
  })
})
