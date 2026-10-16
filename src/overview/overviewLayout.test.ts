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
    expect(moveBlock(layout, 'rows', 'priority', 99).rows).toEqual(['stats', 'columns', 'priority'])
    expect(moveBlock(layout, 'stats', 'stat-goons', -5).stats).toEqual(['stat-goons', 'stat-tasks', 'stat-progress', 'stat-kappa'])
    // the big raid map moves too, within its wide column (owner, 12.10.2026: «сделай что бы карта в блоке обзор перемещалась»)
    expect(moveBlock(layout, 'left', 'raid', 2).left).toEqual(['squad', 'requirements', 'raid'])
    expect(moveBlock(layout, 'right', 'raid', 0)).toBe(layout)
  })

  it('cleans a saved layout: foreign or doubled ids go, missing blocks come back at their default place', () => {
    const layout = sanitizeOverviewLayout({
      stats: ['stat-kappa', 'stat-kappa', 'favorites', 'stat-tasks'],
      rows: ['columns', 'priority', 'stats'],
      left: 'garbage',
      right: ['gunsmith', 'old-block'],
    })
    // «Прогресс» and «Кочевники» were missing: back at their default places (second and fourth)
    expect(layout.stats).toEqual(['stat-kappa', 'stat-progress', 'stat-tasks', 'stat-goons'])
    // the card row stays above the columns with the map; the strip keeps its place between them
    expect(layout.rows).toEqual(['stats', 'priority', 'columns'])
    // a layout saved before the map could move gets the map back at the top of its column
    expect(layout.left).toEqual(['raid', 'squad', 'requirements'])
    expect(layout.right).toEqual(['tasks', 'gunsmith', 'favorites'])
    expect(sanitizeOverviewLayout(null)).toEqual(defaultOverviewLayout())
    expect(sanitizeOverviewLayout({ rows: ['priority', 'stats', 'columns'] }).rows).toEqual(['priority', 'stats', 'columns'])
  })

  it('is kept on this computer; the default order leaves nothing stored; a broken entry falls back to the default', () => {
    const storage = memory()
    const changed = moveBlock(defaultOverviewLayout(), 'rows', 'priority', 0)
    saveOverviewLayout(changed, storage)
    expect(loadOverviewLayout(storage)).toEqual(changed)
    saveOverviewLayout(defaultOverviewLayout(), storage)
    expect(storage.data.has(OVERVIEW_LAYOUT_KEY)).toBe(false)
    storage.setItem(OVERVIEW_LAYOUT_KEY, '{not json')
    expect(isDefaultLayout(loadOverviewLayout(storage))).toBe(true)
  })
})
