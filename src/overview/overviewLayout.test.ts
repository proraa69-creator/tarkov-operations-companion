import { describe, expect, it } from 'vitest'
import { defaultOverviewLayout, isDefaultLayout, loadOverviewLayout, moveBlock, OVERVIEW_LAYOUT_KEY, sanitizeOverviewLayout, saveOverviewLayout } from './overviewLayout'

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key), data }
}

describe('Overview layout (owner, 12.10.2026: «Настроить блоки»)', () => {
  it('moves a block within its zone only; the card row and the two columns stay rows', () => {
    const layout = defaultOverviewLayout()
    const moved = moveBlock(layout, 'right', 'favorites', 0)
    expect(moved.right).toEqual(['favorites', 'tasks', 'gunsmith'])
    expect(moved.left).toBe(layout.left)
    expect(moveBlock(layout, 'right', 'favorites', 2)).toBe(layout)
    expect(moveBlock(layout, 'right', 'squad', 0)).toBe(layout)
    expect(moveBlock(layout, 'rows', 'columns', 0)).toBe(layout)
    expect(moveBlock(layout, 'stats', 'stat-goons', -5).stats).toEqual(['stat-goons', 'stat-screen', 'stat-conditions', 'stat-kappa'])
    // the big raid map moves too, within its wide column (owner, 12.10.2026: «сделай что бы карта в блоке обзор перемещалась»)
    expect(moveBlock(layout, 'left', 'raid', 2).left).toEqual(['squad', 'requirements', 'raid'])
    expect(moveBlock(layout, 'right', 'raid', 0)).toBe(layout)
  })

  it('cleans a saved layout: foreign or doubled ids go, missing blocks come back at their default place', () => {
    const layout = sanitizeOverviewLayout({
      stats: ['stat-kappa', 'stat-kappa', 'favorites', 'stat-screen'],
      rows: ['columns', 'priority', 'stats'],
      left: 'garbage',
      right: ['gunsmith', 'old-block'],
    })
    // «Условия квестов» and «Кочевники» were missing: back at their default places (second and fourth)
    expect(layout.stats).toEqual(['stat-kappa', 'stat-conditions', 'stat-screen', 'stat-goons'])
    // the card row stays above the columns with the map; «Приоритет карт» stands in the map's block now (11.11.2026)
    expect(layout.rows).toEqual(['stats', 'columns'])
    // a layout saved before the map could move gets the map back at the top of its column
    expect(layout.left).toEqual(['raid', 'squad', 'requirements'])
    expect(layout.right).toEqual(['tasks', 'gunsmith', 'favorites'])
    expect(sanitizeOverviewLayout(null)).toEqual(defaultOverviewLayout())
    expect(sanitizeOverviewLayout({ rows: ['priority', 'stats', 'columns'] }).rows).toEqual(['stats', 'columns'])
  })

  it('a layout saved with «Прогресс» keeps «Условия квестов» in the same slot (stat-progress → stat-conditions)', () => {
    const storage = memory()
    storage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify({ stats: ['stat-kappa', 'stat-goons', 'stat-progress', 'stat-tasks'], rows: ['stats', 'columns', 'priority'], left: ['raid', 'squad', 'requirements'], right: ['tasks', 'gunsmith', 'favorites'] }))
    const layout = loadOverviewLayout(storage)
    // «Текущие задания» (stat-tasks) became «Экран» in its slot (11.11.2026)
    expect(layout.stats).toEqual(['stat-kappa', 'stat-goons', 'stat-conditions', 'stat-screen'])
    expect(layout.rows).toEqual(['stats', 'columns'])
    // both ids at once (an edited file): the card once, at the first one's place
    expect(sanitizeOverviewLayout({ stats: ['stat-progress', 'stat-screen', 'stat-conditions'] }).stats).toEqual(['stat-conditions', 'stat-screen', 'stat-kappa', 'stat-goons'])
  })

  it('is kept on this computer; the default order leaves nothing stored; a broken entry falls back to the default', () => {
    const storage = memory()
    const changed = moveBlock(defaultOverviewLayout(), 'stats', 'stat-goons', 0)
    saveOverviewLayout(changed, storage)
    expect(loadOverviewLayout(storage)).toEqual(changed)
    saveOverviewLayout(defaultOverviewLayout(), storage)
    expect(storage.data.has(OVERVIEW_LAYOUT_KEY)).toBe(false)
    storage.setItem(OVERVIEW_LAYOUT_KEY, '{not json')
    expect(isDefaultLayout(loadOverviewLayout(storage))).toBe(true)
  })
})

describe('«Заменить блок» on the PC (owner, 11.11.2026)', () => {
  it('two cards of the top row trade places; anything else changes nothing', async () => {
    const { swapZoneBlocks } = await import('./overviewLayout')
    const layout = defaultOverviewLayout()
    expect(swapZoneBlocks(layout, 'stats', 'stat-screen', 'stat-goons').stats).toEqual(['stat-goons', 'stat-conditions', 'stat-kappa', 'stat-screen'])
    expect(swapZoneBlocks(layout, 'stats', 'stat-screen', 'stat-screen')).toBe(layout)
    expect(swapZoneBlocks(layout, 'stats', 'stat-screen', 'raid')).toBe(layout)
  })
})

describe('a section of the left menu in the top row (owner, 11.11.2026)', () => {
  it('takes the place of a card, the card leaves the row, and both survive a reload', async () => {
    const { swapZoneBlocks } = await import('./overviewLayout')
    const layout = defaultOverviewLayout()
    const next = swapZoneBlocks(layout, 'stats', 'stat-screen', 'nav-flea')
    expect(next.stats).toEqual(['nav-flea', 'stat-conditions', 'stat-kappa', 'stat-goons'])
    // the card that left does not come back by itself; the row keeps four cards
    expect(sanitizeOverviewLayout(JSON.parse(JSON.stringify(next))).stats).toEqual(['nav-flea', 'stat-conditions', 'stat-kappa', 'stat-goons'])
    // and it comes back the same way
    expect(swapZoneBlocks(next, 'stats', 'nav-flea', 'stat-screen').stats).toEqual(layout.stats)
    // never more than the row's cards, nothing foreign
    expect(sanitizeOverviewLayout({ stats: ['nav-flea', 'nav-squad', 'nav-maps', 'nav-traders', 'stat-goons', 'nope'] }).stats).toEqual(['nav-flea', 'nav-squad', 'nav-maps', 'nav-traders'])
    expect(swapZoneBlocks(layout, 'left', 'raid', 'nav-flea')).toBe(layout)
  })
})
