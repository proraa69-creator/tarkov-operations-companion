import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '../domain/types'
import { keysAddedByTaken, setKeyAddedByTaken } from '../progression/takenItems'
import { createKeyScan, removeUnseenKeys, runKeyScan, unsureHint } from './keyScan'
import { readOwnedKeys, setOwnedKey } from './ownedKeys'
import { readUnsureKeys } from './unsureKeys'

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

// Owner, 25.11.2026: «слева те что у меня в схроне, справа то что нашел» — «Времянка» is two keys; an earlier scan's keys stayed.
describe('«Найти ключи»: a label of several keys, and the keys this scan did not see', () => {
  const items = [
    key('k-cabin', 'Ключ от времянки', 'Времянка'), key('k-trailer', 'Ключ от времянки трейлерного парка', 'Времянка'),
    key('k-tech', 'Ключ от спецтехники', 'Спецтех'), key('k-pier', 'Ключ от двери к пирсу', 'Пирс'),
  ]
  it('asks to hover «Времянка» until its tooltip tells the key, and never offers that key to take off', async () => {
    setOwnedKey('p', 'pvp', 'k-pier', 1)
    setOwnedKey('p', 'pvp', 'k-cabin', 1)
    let text = 'Времянка\nСпецтех'
    window.tarkovDesktop = { scanScreenText: async () => ({ gameWindow: true, text }) } as unknown as NonNullable<Window['tarkovDesktop']>
    const scan = createKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' })
    const first = await scan.pass(true)
    expect(first.ok && first.unsure).toEqual(['Времянка'])
    expect(unsureHint(first.ok ? first.unsure : [])).toBe('Наведите курсор на «Времянка»: такая подпись у нескольких ключей.')
    // «Пирс» was not on the screen: offered to take off; «Ключ от времянки» not (its label was seen, the key is not told yet).
    expect(scan.unseen()).toEqual(['k-pier'])
    text = 'Ключ от времянки трейлерного парка'
    const second = await scan.pass(false)
    expect(second.ok && second.unsure).toEqual([])
    expect(readOwnedKeys('p', 'pvp').has('k-trailer')).toBe(true)
    removeUnseenKeys('p', 'pvp', scan.unseen())
    expect([...readOwnedKeys('p', 'pvp').keys()].sort()).toEqual(['k-cabin', 'k-tech', 'k-trailer'])
  })
})

// Owner, 27.11.2026: «ключи должны сразу, вот нашлись и сразу добавляются. Только не добавляются ключи под вопросом».
describe('«Найти ключи»: «Ключи под вопросом»', () => {
  const items = [
    key('k-cabin', 'Ключ от времянки', 'Времянка'), key('k-trailer', 'Ключ от времянки трейлерного парка', 'Времянка'),
    key('k-tech', 'Ключ от спецтехники', 'Спецтех'),
  ]
  const screen = (frames: string[]) => {
    let at = 0
    window.tarkovDesktop = { scanScreenText: async () => ({ gameWindow: true, text: frames[Math.min(at++, frames.length - 1)] }) } as unknown as NonNullable<Window['tarkovDesktop']>
  }

  it('the keys told go to the stash at once; a label of two keys adds neither, it waits with the cells seen', async () => {
    screen(['Времянка\nСпецтех', 'Времянка'])
    const scan = createKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' })
    await scan.pass(true)
    await scan.pass(false)
    expect([...readOwnedKeys('p', 'pvp').keys()]).toEqual(['k-tech'])
    expect(readUnsureKeys('p', 'pvp')).toEqual(new Map([['Времянка', { ids: ['k-cabin', 'k-trailer'], seen: 2 }]]))
    // PvE and another profile apart
    expect(readUnsureKeys('p', 'pve').size).toBe(0)
    expect(readUnsureKeys('q', 'pvp').size).toBe(0)
  })

  it('a tooltip that tells the key takes the label off; a scan that sees nothing of the container leaves the last scan\'s', async () => {
    screen(['Времянка', 'Ключ от времянки трейлерного парка'])
    const scan = createKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' })
    await scan.pass(true)
    expect(readUnsureKeys('p', 'pvp').has('Времянка')).toBe(true)
    await scan.pass(false)
    expect(readUnsureKeys('p', 'pvp').size).toBe(0)

    screen(['Времянка'])
    await createKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' }).pass(true)
    screen(['Банка'])
    await createKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' }).pass(true)
    expect(readUnsureKeys('p', 'pvp').has('Времянка')).toBe(true)
    // the next scan that sees the container: its own labels, none here
    screen(['Спецтех'])
    await createKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' }).pass(true)
    expect(readUnsureKeys('p', 'pvp').size).toBe(0)
  })

  it('the end of a scan, run out or stopped, tells the labels left; none, nothing', async () => {
    screen(['Времянка\nСпецтех'])
    const onUnsure = vi.fn()
    let passes = 0
    await runKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' }, { running: () => passes++ < 1, onMessage: () => {}, onUnsure })
    expect(onUnsure).toHaveBeenCalledWith(['Времянка'])

    screen(['Спецтех'])
    const none = vi.fn()
    passes = 0
    await runKeyScan({ items, wanted: [], profileId: 'p', mode: 'pvp' }, { running: () => passes++ < 1, onMessage: () => {}, onUnsure: none })
    expect(none).not.toHaveBeenCalled()
  })
})
