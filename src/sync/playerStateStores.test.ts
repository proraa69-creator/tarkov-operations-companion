import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setQuestCheck, readQuestChecks } from '../progression/questChecks'
import { markDocumentFound, readFoundDocuments } from '../progression/foundDocuments'
import { readQuestKeyFavorites, readQuestKeyReminder, setQuestKeyFavorite } from '../quests/questKeyFavorites'
import { readPositions, savePosition } from '../trading/tradingPositions'
import { readTradingSettings, writeTradingSettings } from '../trading/tradingSettings'
import { renderHook, act } from '@testing-library/react'
import { mapSketchKey, readMapSketch, useMapSketch, withOtherDevices } from '../maps/mapSketch'
import { markPromoCodesRead, PROMO_SYNC, setPromoCodeUsed } from '../promo/promoCodes'
import { NEWS, readNews } from '../news/newsState'
import { readManualTraderLevels, setManualTraderLevel } from '../gunsmith/traderLevels'
import { noteProfileLists, PLAYER_STATE_ADAPTERS, setPlayerStateProfile, watchPlayerStateStores, type PlayerListsChange, type ProfileLists } from './playerStateStores'

const adapter = (kind: string) => PLAYER_STATE_ADAPTERS.find((entry) => entry.kind === kind)!
const emptyMode = () => ({ raidItemIds: [], hideoutLevels: {}, itemCounts: {} })
const emptyLists = (): ProfileLists => ({ favoriteItemIds: [], modes: { pvp: emptyMode(), pve: emptyMode(), seasonal: emptyMode() } })

describe('the stores as the account\'s other devices see them', () => {
  beforeEach(() => {
    localStorage.clear()
    setPlayerStateProfile('p1')
  })
  afterEach(() => { noteProfileLists(null, null); vi.useRealTimers() })

  it('«Скопировать» on one device is a tick on the other: the promo window hears it', () => {
    setPromoCodeUsed('COPIED', true)
    const used = adapter('promo-used')
    expect([...used.read('')!.keys()]).toEqual(['COPIED'])

    const heard = vi.fn()
    window.addEventListener(PROMO_SYNC.event, heard)
    used.write('', new Map([['COPIED', true], ['FROM-PHONE', true]]))
    window.removeEventListener(PROMO_SYNC.event, heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(PROMO_SYNC.used)!)).toEqual(['COPIED', 'FROM-PHONE'])
    used.write('', new Map())
    expect(JSON.parse(localStorage.getItem(PROMO_SYNC.used)!)).toEqual([])
  })

  it('«Прочитано» of the codes only grows', () => {
    markPromoCodesRead([{ code: 'A', addedAt: 'x' }])
    expect(adapter('promo-read').addOnly).toBe(true)
    expect([...adapter('promo-read').read('')!.keys()]).toEqual(['A'])
  })

  it('news read from another device joins this device\'s first look: no badge of ten', () => {
    if (NEWS.length < 3) return
    const news = adapter('news-read')
    expect(news.read('')!.size).toBe(0)
    news.write('', new Map([[NEWS[0]!.version, true]]))
    const read = readNews()
    expect(read.has(NEWS[0]!.version)).toBe(true)
    expect(read.has(NEWS[1]!.version)).toBe(true)
    expect(read.size).toBe(NEWS.length)
  })

  it('the checks of a raid, found documents and starred keys: per profile and mode, in the store\'s own format', () => {
    setQuestCheck('p1', 'pve', 'quest', true, 123)
    expect(adapter('quest-checks').read('pve')).toEqual(new Map([['quest', 123]]))
    expect(adapter('quest-checks').read('pvp')).toEqual(new Map())
    adapter('quest-checks').write('pve', new Map([['quest', 123], ['other', 456]]))
    expect([...readQuestChecks('p1', 'pve').keys()]).toEqual(['quest', 'other'])
    adapter('quest-checks').write('pve', new Map())
    expect(readQuestChecks('p1', 'pve').size).toBe(0)
    expect(localStorage.getItem('tarkov-quest-checks-v1:p1:pve')).toBeNull()

    markDocumentFound('p1', 'seasonal', 'marker', 77)
    expect(adapter('found-documents').read('seasonal')).toEqual(new Map([['marker', 77]]))
    adapter('found-documents').write('seasonal', new Map([['marker', 77], ['other', 78]]))
    expect(readFoundDocuments('p1', 'seasonal').get('other')).toBe(78)

    setQuestKeyFavorite('p1', 'pvp', 'key-1', true)
    expect(adapter('quest-key-favorites').read('pvp')).toEqual(new Map([['key-1', true]]))
    adapter('quest-key-favorites').write('pvp', new Map([['key-2', true]]))
    expect([...readQuestKeyFavorites('p1', 'pvp')]).toEqual(['key-2'])
  })

  it('nothing is read before the profile is known, or from a damaged value: neither is a reason to take anything off', () => {
    setPlayerStateProfile(null)
    expect(adapter('quest-checks').read('pvp')).toBeNull()
    expect(adapter('map-sketch').read('pvp')).toBeNull()
    setPlayerStateProfile('p1')
    localStorage.setItem('tarkov-quest-checks-v1:p1:pvp', '{broken')
    expect(adapter('quest-checks').read('pvp')).toBeNull()
    localStorage.setItem(PROMO_SYNC.used, 'not json')
    expect(adapter('promo-used').read('')).toBeNull()
    localStorage.setItem('raidos-trading-positions-v1', '{"a":1}')
    expect(adapter('trading-positions').read('pvp')).toBeNull()
  })

  it('«Купил»: one list on the device, each mode apart on the account', () => {
    const position = (mode: 'pvp' | 'pve', itemId: string) => ({ mode, itemId, paid: 10, plus: 5, notify: true, boughtAt: 1, base: 7 })
    savePosition(position('pvp', 'gpu'))
    savePosition(position('pve', 'gpu'))
    expect([...adapter('trading-positions').read('pve')!.keys()]).toEqual(['gpu'])
    adapter('trading-positions').write('pve', new Map([['lion', position('pve', 'lion')]]))
    expect(readPositions().map((row) => `${row.mode}:${row.itemId}`).sort()).toEqual(['pve:lion', 'pvp:gpu'])
    expect(adapter('trading-positions').accepts!(position('pve', 'lion'), 'lion', 'pve')).toBe(true)
    expect(adapter('trading-positions').accepts!({ itemId: 'lion' }, 'lion', 'pve')).toBe(false)
  })

  it('«Зарисовка»: stroke by stroke per map, so what two devices drew both stay', () => {
    const stroke = (x: number) => ({ zoom: 2, points: [[x, x], [x + 1, x]] })
    localStorage.setItem(mapSketchKey('p1', 'pvp', 'customs'), JSON.stringify([stroke(1)]))
    localStorage.setItem(mapSketchKey('p1', 'pve', 'customs'), JSON.stringify([stroke(9)]))
    const here = adapter('map-sketch').read('pvp')!
    expect([...here.keys()]).toEqual([expect.stringMatching(/^customs\|/)])
    const heard = vi.fn()
    const off = watchPlayerStateStores(heard)
    const next = new Map<string, unknown>([...here, [`customs|other`, stroke(2)], [`woods|other`, stroke(3)]])
    adapter('map-sketch').write('pvp', next)
    off()
    expect(heard).toHaveBeenCalled()
    expect(readMapSketch(mapSketchKey('p1', 'pvp', 'customs'))).toEqual([stroke(1), stroke(2)])
    expect(readMapSketch(mapSketchKey('p1', 'pvp', 'woods'))).toEqual([stroke(3)])
    expect(readMapSketch(mapSketchKey('p1', 'pve', 'customs'))).toEqual([stroke(9)])
    adapter('map-sketch').write('pvp', new Map())
    expect(localStorage.getItem(mapSketchKey('p1', 'pvp', 'customs'))).toBeNull()
    expect(localStorage.getItem(mapSketchKey('p1', 'pve', 'customs'))).not.toBeNull()
  })

  it('a stroke drawn on another device shows on the open map at once; during a drawing here it joins when that is kept', () => {
    const stroke = (x: number) => ({ zoom: 2, points: [[x, x] as [number, number], [x + 1, x] as [number, number]] })
    const { result } = renderHook(() => useMapSketch('p1', 'pvp', 'customs'))
    expect(result.current.strokes).toEqual([])
    act(() => { adapter('map-sketch').write('pvp', new Map([['customs|a', stroke(1)]])) })
    expect(result.current.strokes).toEqual([stroke(1)])
    act(() => { result.current.begin() })
    act(() => { result.current.draw(stroke(5)) })
    act(() => { adapter('map-sketch').write('pvp', new Map([['customs|a', stroke(1)], ['customs|b', stroke(2)]])) })
    act(() => { result.current.accept() })
    expect(result.current.strokes).toEqual([stroke(1), stroke(5), stroke(2)])
    expect(readMapSketch(mapSketchKey('p1', 'pvp', 'customs'))).toEqual([stroke(1), stroke(5), stroke(2)])

    // Dropped here: what came meanwhile still shows.
    act(() => { result.current.begin() })
    act(() => { adapter('map-sketch').write('pvp', new Map([['customs|c', stroke(3)]])) })
    act(() => { result.current.cancel() })
    expect(result.current.strokes).toEqual([stroke(3)])
  })

  it('a kept drawing keeps what another device did meanwhile, and what was rubbed out here stays out', () => {
    const stroke = (x: number) => ({ zoom: 2, points: [[x, x] as [number, number]] })
    const [a, b, c, mine, theirs] = [stroke(1), stroke(2), stroke(3), stroke(4), stroke(5)]
    // Began from a, b, c. Here: b rubbed out, mine drawn. There meanwhile: c taken off, theirs drawn.
    expect(withOtherDevices([a, c, mine], [a, b, c], [a, b, theirs])).toEqual([a, mine, theirs])
    // Nothing happened elsewhere: exactly what was drawn here; a cross deletes it all.
    expect(withOtherDevices([a, mine], [a, b], [a, b])).toEqual([a, mine])
    expect(withOtherDevices([], [a, b], [a, b])).toEqual([])
  })

  it('older strokes with no colour and newer ones with one both travel as stored, and read back the same (no echo)', () => {
    const key = mapSketchKey('p1', 'pvp', 'customs')
    const older = { zoom: 2, points: [[1, 1], [2, 2]] }
    const newer = { zoom: 3, points: [[3, 3], [4, 4]], color: '#2ab7ff' }
    const later = { zoom: 3, points: [[5, 5], [6, 6]], color: '#123456', width: 7 }
    localStorage.setItem(key, JSON.stringify([older, newer]))
    const here = adapter('map-sketch').read('pvp')!
    expect([...here.values()]).toEqual([older, newer])
    // On another device: the same strokes, whatever this version knows of them, under the same names.
    const items = [...here.keys()]
    adapter('map-sketch').write('pvp', new Map<string, unknown>([...here, ['customs|later', later]]))
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([older, newer, later])
    const back = adapter('map-sketch').read('pvp')!
    expect([...back.keys()].slice(0, 2)).toEqual(items)
    expect(back.get(items[1]!)).toEqual(newer)
    // Different colours are different strokes, on the same line.
    const red = { zoom: 2, points: [[1, 1], [2, 2]], color: '#ff2b2b' }
    localStorage.setItem(key, JSON.stringify([older, red]))
    expect(adapter('map-sketch').read('pvp')!.size).toBe(2)
    // A damaged map is no reason to take its strokes off.
    localStorage.setItem(key, '{broken')
    expect(adapter('map-sketch').read('pvp')).toBeNull()
  })

  it('the pencil\'s last colour stays on this device and is no map', () => {
    localStorage.setItem('raidos-map-sketch-v1:color', '#ffd60a')
    expect(adapter('map-sketch').read('pvp')!.size).toBe(0)
  })

  it('the player\'s switches travel as the store wrote them, and only those known here', () => {
    writeTradingSettings({ enabled: true, minProfit: 50_000 })
    const prefs = adapter('prefs')
    const kept = prefs.read('')!
    expect(kept.get('raidos-trading-notify-v1')).toBe(localStorage.getItem('raidos-trading-notify-v1'))
    expect(prefs.accepts!('{}', 'raidos-device-id-v1', '')).toBe(false)
    prefs.write('', new Map([['raidos-quest-key-reminder-v1', 'on']]))
    expect(readQuestKeyReminder()).toBe(true)
    expect(readTradingSettings().enabled).toBe(false)
  })

  it('the traders\' levels: per mode, and the rest of the store stays', () => {
    setManualTraderLevel('pvp', 'prapor', 3)
    setManualTraderLevel('pve', 'prapor', 2)
    expect(adapter('trader-levels').read('pve')).toEqual(new Map([['prapor', 2]]))
    adapter('trader-levels').write('pve', new Map([['therapist', 4]]))
    expect(readManualTraderLevels('pve')).toEqual({ therapist: 4 })
    expect(readManualTraderLevels('pvp')).toEqual({ prapor: 3 })
    adapter('trader-levels').write('pve', new Map())
    expect(readManualTraderLevels('pve')).toEqual({})
  })

  describe('what the profile holds', () => {
    it('reads nothing before the state told it, then the lists as they are', () => {
      expect(adapter('favorite-items').read('')).toBeNull()
      const lists = emptyLists()
      lists.favoriteItemIds = ['a', 'b']
      lists.modes.pve.hideoutLevels = { lavatory: 2 }
      lists.modes.pve.storyManual = { chapters: { chapter: { marks: { 1: { goal: 1 } } } }, choices: { question: 'yes' } }
      noteProfileLists(lists, vi.fn())
      expect([...adapter('favorite-items').read('')!.keys()]).toEqual(['a', 'b'])
      expect(adapter('hideout-levels').read('pve')).toEqual(new Map([['lavatory', 2]]))
      expect(adapter('hideout-levels').read('pvp')).toEqual(new Map())
      expect(adapter('story-marks').read('pve')).toEqual(new Map<string, unknown>([['m|chapter', { marks: { 1: { goal: 1 } } }], ['c|question', 'yes']]))
    })

    it('the favourites a new profile starts with for show never go to the account', () => {
      noteProfileLists({ ...emptyLists(), favoriteItemIds: ['graphics-card', 'ledx', 'salewa', 'real-item'] }, vi.fn())
      expect([...adapter('favorite-items').read('')!.keys()]).toEqual(['real-item'])
    })

    it('a change from the server goes to the state; a commit from before it is not read as a click that took it away', () => {
      vi.useFakeTimers()
      const apply = vi.fn<(change: PlayerListsChange) => void>()
      const before = emptyLists()
      noteProfileLists(before, apply)
      adapter('favorite-items').write('', new Map([['from-phone', true]]))
      expect(apply).toHaveBeenCalledWith({ favoriteItemIds: ['from-phone'] })
      // React commits something from before the change: the engine still sees what came from the server.
      noteProfileLists({ ...before, modes: { ...before.modes, pvp: { ...before.modes.pvp, raidItemIds: [] } } }, apply)
      expect([...adapter('favorite-items').read('')!.keys()]).toEqual(['from-phone'])
      // The state has it now.
      noteProfileLists({ ...before, favoriteItemIds: ['from-phone'] }, apply)
      expect([...adapter('favorite-items').read('')!.keys()]).toEqual(['from-phone'])
      // And a click after that counts.
      noteProfileLists({ ...before, favoriteItemIds: [] }, apply)
      expect(adapter('favorite-items').read('')!.size).toBe(0)
    })

    it('a change that never shows in the state lets go after a moment: the state is what counts', () => {
      vi.useFakeTimers()
      const apply = vi.fn()
      const before = emptyLists()
      noteProfileLists(before, apply)
      adapter('raid-items').write('pve', new Map([['x', true]]))
      expect(apply).toHaveBeenCalledWith({ mode: 'pve', raidItemIds: ['x'] })
      expect(adapter('raid-items').read('pve')!.size).toBe(1)
      vi.advanceTimersByTime(3100)
      expect(adapter('raid-items').read('pve')!.size).toBe(0)
    })

    it('every list of the profile goes to the state in its own form', () => {
      const apply = vi.fn()
      noteProfileLists(emptyLists(), apply)
      adapter('hideout-levels').write('pvp', new Map([['stash', 3]]))
      adapter('item-counts').write('pvp', new Map([['gpu', 2]]))
      adapter('story-marks').write('pve', new Map<string, unknown>([['m|c1', { marks: {} }], ['c|q1', 'left']]))
      expect(apply.mock.calls.map(([change]) => change)).toEqual([
        { mode: 'pvp', hideoutLevels: { stash: 3 } },
        { mode: 'pvp', itemCounts: { gpu: 2 } },
        { mode: 'pve', storyManual: { chapters: { c1: { marks: {} } }, choices: { q1: 'left' } } },
      ])
    })
  })
})
