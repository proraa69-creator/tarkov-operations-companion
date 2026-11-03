import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HideoutStation, Item, Quest } from '../domain/types'
import { collectorEntries, loadCollected, screenEntries } from '../kappa/collector'
import { readHideoutFound, writeHideoutFound } from '../hideout/hideoutFound'
import { countScreenItems, createScreenSync, distributeScreenItems, screenSyncSummary } from './screenSync'

const item = (id: string, name: string, shortName: string) => ({ id, name, shortName, category: 'Предмет', description: '', prices: [] }) as unknown as Item

describe('distributeScreenItems', () => {
  const kappaNeeds = new Map([['axe', 1], ['book', 1], ['both', 1]])

  it('ticks Kappa items not collected yet and raises the hideout to what the screen shows', () => {
    const result = distributeScreenItems({
      seen: new Map([['axe', 1], ['bolts', 3], ['wire', 1]]),
      kappa: { needs: kappaNeeds, collected: [] },
      hideout: new Map([['bolts', { found: 1, total: 5 }], ['wire', { found: 0, total: 2 }]]),
    })
    expect(result.kappa).toEqual(['axe'])
    expect([...result.hideout]).toEqual([['bolts', 3], ['wire', 1]])
    expect(result.hideoutAdded).toBe(3)
  })

  it('never goes above what the hideout needs and never lowers what is marked', () => {
    const result = distributeScreenItems({
      seen: new Map([['bolts', 9], ['wire', 1]]),
      kappa: { needs: kappaNeeds, collected: [] },
      hideout: new Map([['bolts', { found: 1, total: 4 }], ['wire', { found: 2, total: 2 }]]),
    })
    expect([...result.hideout]).toEqual([['bolts', 4]])
    expect(result.hideoutAdded).toBe(3)
  })

  it('does not count the same stash twice: a second scan adds nothing', () => {
    const hideout = new Map([['bolts', { found: 3, total: 5 }]])
    const result = distributeScreenItems({ seen: new Map([['bolts', 3]]), kappa: { needs: kappaNeeds, collected: [] }, hideout })
    expect(result.hideout.size).toBe(0)
    expect(result.hideoutAdded).toBe(0)
  })

  it('gives an item wanted by both to Kappa first and the extra pieces to the hideout', () => {
    const hideout = new Map([['both', { found: 0, total: 3 }]])
    const one = distributeScreenItems({ seen: new Map([['both', 1]]), kappa: { needs: kappaNeeds, collected: [] }, hideout })
    expect(one.kappa).toEqual(['both'])
    expect(one.hideout.size).toBe(0)
    const three = distributeScreenItems({ seen: new Map([['both', 3]]), kappa: { needs: kappaNeeds, collected: [] }, hideout })
    expect(three.kappa).toEqual(['both'])
    expect([...three.hideout]).toEqual([['both', 2]])
    // Already ticked for Kappa: its piece stays kept for Kappa.
    const ticked = distributeScreenItems({ seen: new Map([['both', 2]]), kappa: { needs: kappaNeeds, collected: ['both'] }, hideout })
    expect(ticked.kappa).toEqual([])
    expect([...ticked.hideout]).toEqual([['both', 1]])
  })

  it('leaves items wanted by neither list alone', () => {
    const result = distributeScreenItems({ seen: new Map([['junk', 4]]), kappa: { needs: kappaNeeds, collected: ['axe'] }, hideout: new Map() })
    expect(result).toEqual({ kappa: [], hideout: new Map(), hideoutAdded: 0, quests: new Map(), questsAdded: 0 })
  })

  // Owner, 31.10.2026: «все обнаруженные предметы добавляются, для каппы, для убежища и квестов».
  it('after Kappa and the hideout the pieces left go to the quests still to do, at least, never more than they need', () => {
    const hideout = new Map([['gpu', { found: 0, total: 2 }]])
    const quests = new Map([['gpu', { found: 1, total: 3 }], ['salewa', { found: 0, total: 2 }]])
    const result = distributeScreenItems({ seen: new Map([['gpu', 6], ['salewa', 1]]), kappa: { needs: new Map(), collected: [] }, hideout, quests })
    expect(result.hideout).toEqual(new Map([['gpu', 2]]))
    expect(result.quests).toEqual(new Map([['gpu', 3], ['salewa', 1]]))
    expect(result.questsAdded).toBe(3)
  })
})

describe('countScreenItems', () => {
  const catalog = [item('axe', 'Старинный топор', 'Топор'), item('bolts', 'Болты', 'Болты'), item('wire', 'Пучок проводов', 'Провода')]
  const entries = screenEntries(new Map([['axe', 1], ['bolts', 4], ['wire', 2]]), catalog)

  it('counts one piece per stash label, each label for one item', () => {
    expect([...countScreenItems(entries, 'Болты\nТопор\nБолты\nПатрон')].sort()).toEqual([['axe', 1], ['bolts', 2]])
    expect(countScreenItems(entries, '').size).toBe(0)
  })
})

describe('screen sync pass', () => {
  const catalog = [item('axe', 'Старинный топор', 'Топор'), item('bolts', 'Болты', 'Болты'), item('wire', 'Пучок проводов', 'Провода')]
  const quests = [{ id: 'collector', name: 'Коллекционер', raidRequirements: [{ itemId: 'axe', count: 1, purpose: 'handover', mapIds: [] }] }] as unknown as Quest[]
  const stations = [
    { id: 'gen', name: 'Генератор', levels: [{ level: 1, itemRequirements: [{ itemId: 'bolts', count: 2 }] }, { level: 2, itemRequirements: [{ itemId: 'bolts', count: 3 }, { itemId: 'wire', count: 1 }] }] },
  ] as unknown as HideoutStation[]

  afterEach(() => {
    localStorage.clear()
    delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
  })

  it('reads one frame and puts Kappa items on «Каппа» and hideout pieces on «Убежище» of the current mode only', async () => {
    const scanScreenText = vi.fn().mockResolvedValue({ text: 'Топор\nБолты\nБолты', gameWindow: true, read: 3, pending: 0 })
    ;(window as { tarkovDesktop?: unknown }).tarkovDesktop = { scanScreenText }
    writeHideoutFound('p1', 'pvp', new Map([['bolts', 1]]))
    // Level I built: bolts still needed 3 (level II), wire 1.
    const sync = createScreenSync({ mode: 'pvp', profileId: 'p1', kappa: collectorEntries(quests, catalog), stations, built: { gen: 1 }, items: catalog })
    const result = await sync.pass(true)
    expect(result).toMatchObject({ ok: true, gameWindow: true, kappaAdded: ['axe'], hideoutAdded: 1 })
    expect(scanScreenText).toHaveBeenCalledWith({ restart: true, names: ['Топор', 'Болты', 'Провода'] })
    expect(loadCollected('pvp')).toEqual(['axe'])
    expect(readHideoutFound('p1', 'pvp').get('bolts')).toBe(2)
    expect(loadCollected('pve')).toEqual([])
    expect(readHideoutFound('p1', 'pve').size).toBe(0)

    // The next pass of the same scan: a new label adds, the labels already counted do not count again.
    scanScreenText.mockResolvedValue({ text: 'Провода', gameWindow: true, read: 1, pending: 0 })
    const next = await sync.pass(false)
    expect(next).toMatchObject({ ok: true, kappaAdded: [], hideoutAdded: 1 })
    expect(readHideoutFound('p1', 'pvp').get('bolts')).toBe(2)
    expect(readHideoutFound('p1', 'pvp').get('wire')).toBe(1)
  })

  it('says when the game window is not on screen and outside the Windows app', async () => {
    const sync = createScreenSync({ mode: 'pve', profileId: 'p1', kappa: [], stations, built: {}, items: catalog })
    expect(await sync.pass(true)).toEqual({ ok: false, reason: 'desktop' })
    ;(window as { tarkovDesktop?: unknown }).tarkovDesktop = { scanScreenText: vi.fn().mockResolvedValue({ text: '', gameWindow: false, waiting: true, labels: 0, read: 0, pending: 0 }) }
    expect(await sync.pass(true)).toMatchObject({ ok: true, gameWindow: false, waiting: true, kappaAdded: [], hideoutAdded: 0 })
  })
})

describe('screen sync summary in English', () => {
  it('translates the result line', async () => {
    const { setRenderLanguage, uiText } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      expect(uiText(`Готово. ${screenSyncSummary(2, 5)}`)).toBe('Done. Kappa: +2, Hideout: +5, Quests: +0')
      expect(uiText(`Прочитано подписей: 12 · ${screenSyncSummary(0, 1)}. Листайте схрон — сканирование идёт.`)).toBe('Labels read: 12 · Kappa: +0, Hideout: +1, Quests: +0. Scroll the stash — scanning is running.')
      expect(uiText(' Синхронизация по экрану')).toBe(' Screen sync')
      expect(uiText('Окно игры не найдено. Откройте схрон в игре и нажмите «Синхронизация по экрану» ещё раз.')).toBe('Game window not found. Open your stash in the game and press «Screen sync» again.')
    } finally {
      setRenderLanguage('ru')
    }
  })
})

describe('«Не нужны» (owner, 31.10.2026)', () => {
  it('lists what the scan saw that no unbuilt level, no quest to do and no Collector item wants', async () => {
    const { unneededItems } = await import('./UnneededItems')
    const seen = new Map([['bolts', 7], ['gpu', 1], ['salewa', 3], ['axe', 1], ['junk', 2]])
    const result = unneededItems(seen, { hideout: new Map([['gpu', 1]]), quests: new Map([['salewa', 2]]), kappa: new Set(['axe']) })
    expect(result).toEqual([{ itemId: 'bolts', count: 7 }, { itemId: 'junk', count: 2 }])
  })
})
