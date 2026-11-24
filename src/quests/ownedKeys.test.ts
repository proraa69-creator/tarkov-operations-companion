import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '../domain/types'
import { createKeyScan } from './keyScan'
import { addSeenKeys, readKeyUses, readOwnedKeys, setKeyUses, setOwnedKey } from './ownedKeys'

// Owner, 07.11.2026: «По нажатию кнопки «Найти ключи» человек заходит в игру и открывает контейнер со всеми ключами… Программа находит
// ключи»; «И добавь кнопку «Ключи в схроне»… Там же должна быть кнопка «Добавить вручную»».
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

describe('the keys the player has', () => {
  it('a key added, counted, given its uses, and taken off with them', () => {
    setOwnedKey('p', 'pvp', 'k1', 1)
    setOwnedKey('p', 'pvp', 'k1', 2)
    setKeyUses('p', 'pvp', 'k1', 38)
    expect([...readOwnedKeys('p', 'pvp')]).toEqual([['k1', 2]])
    expect(readKeyUses('p', 'pvp').get('k1')).toBe(38)
    // PvP, PvE and Season apart
    expect(readOwnedKeys('p', 'pve').size).toBe(0)
    setOwnedKey('p', 'pvp', 'k1', 0)
    expect(readOwnedKeys('p', 'pvp').size).toBe(0)
    expect(readKeyUses('p', 'pvp').size).toBe(0)
  })

  it('a scan adds what it saw and takes nothing off', () => {
    setOwnedKey('p', 'pvp', 'old', 1)
    expect(addSeenKeys('p', 'pvp', new Map([['k1', 1], ['old', 1]]))).toBe(1)
    expect(addSeenKeys('p', 'pvp', new Map([['k1', 2]]))).toBe(0)
    expect(Object.fromEntries(readOwnedKeys('p', 'pvp'))).toEqual({ old: 1, k1: 2 })
  })
})

describe('«Найти ключи»', () => {
  const key = (id: string, name: string, shortName: string): Item => ({ id, name, shortName, category: 'Ключ' } as Item)
  const items = [key('k206', 'Ключ от комнаты 206 общежития', 'Общ. 206'), key('kexit', 'Ключ от выхода с Завода', 'Завод'), { id: 'can', name: 'Банка', shortName: 'Банка', category: 'Еда' } as Item]

  it('reads the keys\' labels on screen into «Ключи в схроне», and only keys', async () => {
    const scanScreenText = vi.fn(async () => ({ gameWindow: true, text: 'Общ. 206\nБанка\nЗавод\n', read: 3 }))
    vi.stubGlobal('tarkovDesktop', { scanScreenText })
    Object.assign(window, { tarkovDesktop: { scanScreenText } })
    const scan = createKeyScan({ items, wanted: ['kexit'], profileId: 'p', mode: 'pvp' })
    const pass = await scan.pass(true)
    expect(pass).toMatchObject({ ok: true, gameWindow: true, found: 2, added: 2 })
    expect([...readOwnedKeys('p', 'pvp').keys()].sort()).toEqual(['k206', 'kexit'])
    // the quests' keys first in the second look
    expect(scanScreenText).toHaveBeenCalledWith({ restart: true, names: ['Завод', 'Общ. 206'] })
    delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
  })

  it('says it needs the Windows app elsewhere', async () => {
    delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
    expect(await createKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' }).pass(true)).toEqual({ ok: false })
  })
})
