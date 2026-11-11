import { describe, expect, it } from 'vitest'
import { defaultPhoneLayout, isDefaultPhoneLayout, loadPhoneLayout, movePhoneBlock, PHONE_BLOCKS, PHONE_LAYOUT_KEY, sanitizePhoneLayout, savePhoneLayout, togglePhoneNarrow } from './phoneLayout'

describe('the phone Overview: one column, every block moves up or down', () => {
  it('starts with every block, «Экран» and «Кочевники» side by side', () => {
    const layout = defaultPhoneLayout()
    expect(layout.order).toEqual([...PHONE_BLOCKS])
    // owner, 11.11.2026: «Экран» and «Кочевники» small on top, then the map, «Требования рейда», the tasks, «Сбор на рейд», «Оружейник»
    expect(layout.order.slice(0, 7)).toEqual(['stat-screen', 'stat-goons', 'raid', 'requirements', 'tasks', 'stat-conditions', 'gunsmith'])
    expect(layout.narrow).toEqual(['stat-screen', 'stat-goons'])
    // «Текущие задания» and «Приоритет карт» stand inside the map's block now
    expect(layout.order).not.toContain('stat-tasks')
    expect(layout.order).not.toContain('priority')
    expect(isDefaultPhoneLayout(layout)).toBe(true)
  })

  it('moves any block one place, the raid map too, and stops at the ends', () => {
    const start = defaultPhoneLayout()
    const up = movePhoneBlock(start, 'raid', -1)
    expect(up.order.indexOf('raid')).toBe(start.order.indexOf('raid') - 1)
    expect(up.order.indexOf('stat-goons')).toBe(start.order.indexOf('raid'))
    expect(movePhoneBlock(start, 'stat-screen', -1)).toBe(start)
    expect(movePhoneBlock(start, 'favorites', 1)).toBe(start)
    expect(movePhoneBlock(start, 'nope', 1)).toBe(start)
  })

  it('every block can become half wide and back (owner, 20.10.2026: the same settings for all blocks)', () => {
    const start = defaultPhoneLayout()
    const wide = togglePhoneNarrow(start, 'stat-screen')
    expect(wide.narrow).toEqual(['stat-goons'])
    expect(togglePhoneNarrow(wide, 'stat-screen').narrow).toEqual(['stat-goons', 'stat-screen'])
    for (const id of ['raid', 'stat-conditions', 'stat-kappa', 'requirements', 'favorites']) {
      expect(togglePhoneNarrow(start, id).narrow).toContain(id)
    }
    expect(togglePhoneNarrow(start, 'nope')).toBe(start)
  })

  it('a saved layout keeps its order, drops unknown blocks and gets new ones at their place', () => {
    const saved = sanitizePhoneLayout({ order: ['raid', 'nope', 'stat-goons', 'raid'], narrow: ['stat-kappa', 'nope'] })
    expect(saved.order).toEqual(['stat-screen', 'raid', 'stat-goons', 'requirements', 'tasks', 'stat-conditions', 'gunsmith', 'stat-kappa', 'squad', 'favorites'])
    expect(saved.order).toHaveLength(PHONE_BLOCKS.length)
    expect(new Set(saved.order).size).toBe(PHONE_BLOCKS.length)
    expect(saved.order.indexOf('raid')).toBeLessThan(saved.order.indexOf('stat-goons'))
    expect(saved.narrow).toEqual(['stat-kappa'])
    expect(sanitizePhoneLayout(null)).toEqual(defaultPhoneLayout())
  })

  it('a phone layout saved with «Прогресс» keeps «Сбор на рейд» in its place and its width', () => {
    const saved = sanitizePhoneLayout({ order: ['raid', 'stat-progress', 'stat-goons', 'stat-kappa'], narrow: ['stat-progress'] })
    expect(saved.order.indexOf('stat-conditions')).toBe(saved.order.indexOf('raid') + 1)
    expect(saved.order).not.toContain('stat-progress')
    expect(saved.narrow).toEqual(['stat-conditions'])
  })

  it('is kept on the phone, and the default is not stored', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } }
    const moved = movePhoneBlock(defaultPhoneLayout(), 'tasks', -1)
    savePhoneLayout(moved, storage)
    expect(store.has(PHONE_LAYOUT_KEY)).toBe(true)
    expect(loadPhoneLayout(storage)).toEqual(moved)
    savePhoneLayout(defaultPhoneLayout(), storage)
    expect(store.has(PHONE_LAYOUT_KEY)).toBe(false)
    expect(loadPhoneLayout({ getItem: () => '{broken' })).toEqual(defaultPhoneLayout())
  })
})

describe('any size by a block\'s corner (owner, 17.10.2026)', () => {
  it('keeps a dragged size within the limits and goes back to the default', async () => {
    const { resizePhoneBlock } = await import('./phoneLayout')
    const start = defaultPhoneLayout()
    const sized = resizePhoneBlock(start, 'raid', { w: 0.333333, h: 251.6 })
    expect(sized.sizes).toEqual({ raid: { w: 0.33, h: 252 } })
    expect(isDefaultPhoneLayout(sized)).toBe(false)
    expect(resizePhoneBlock(start, 'raid', { w: 0.01, h: 5 }).sizes).toEqual({ raid: { w: 0.25, h: 64 } })
    expect(resizePhoneBlock(start, 'raid', { w: 3, h: 99999 }).sizes).toEqual({ raid: { w: 1, h: 1400 } })
    const back = resizePhoneBlock(sized, 'raid', undefined)
    expect(back.sizes).toBeUndefined()
    expect(isDefaultPhoneLayout(back)).toBe(true)
  })

  it('a saved size survives a reload; junk and unknown blocks are dropped', () => {
    const saved = sanitizePhoneLayout({ order: [...PHONE_BLOCKS], narrow: [], sizes: { raid: { w: 0.6, h: 300 }, nope: { w: 0.5 }, tasks: { w: 'x' }, gunsmith: { h: 200 } } })
    expect(saved.sizes).toEqual({ raid: { w: 0.6, h: 300 }, gunsmith: { h: 200 } })
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } }
    savePhoneLayout(saved, storage)
    expect(loadPhoneLayout(storage)).toEqual(saved)
  })
})

describe('«Настроить блоки» on the phone: hold and drop, halves', () => {
  it('a block dropped on another swaps places with it, the rest stay', async () => {
    const { swapPhoneBlocks } = await import('./phoneLayout')
    const start = defaultPhoneLayout()
    const swapped = swapPhoneBlocks(start, 'stat-screen', 'raid')
    expect(swapped.order.indexOf('raid')).toBe(start.order.indexOf('stat-screen'))
    expect(swapped.order.indexOf('stat-screen')).toBe(start.order.indexOf('raid'))
    expect(swapped.order.filter((id) => id !== 'raid' && id !== 'stat-screen')).toEqual(start.order.filter((id) => id !== 'raid' && id !== 'stat-screen'))
    expect(swapPhoneBlocks(start, 'raid', 'raid')).toBe(start)
    expect(swapPhoneBlocks(start, 'raid', 'nope')).toBe(start)
  })

  it('«Пополам» and «Во всю ширину» work on any block, a dragged width included; the height stays', async () => {
    const { setPhoneHalf, resizePhoneBlock } = await import('./phoneLayout')
    const sized = resizePhoneBlock(defaultPhoneLayout(), 'raid', { w: 0.7, h: 300 })
    const half = setPhoneHalf(sized, 'raid', true)
    expect(half.narrow).toContain('raid')
    expect(half.sizes?.raid).toEqual({ h: 300 })
    const full = setPhoneHalf(half, 'raid', false)
    expect(full.narrow).not.toContain('raid')
    expect(full.sizes?.raid).toEqual({ h: 300 })
  })
})

describe('«Заменить блок» on the phone (owner, 11.11.2026)', () => {
  it('a block on the screen trades places and widths with the chosen one', async () => {
    const { replacePhoneBlock } = await import('./phoneLayout')
    const start = defaultPhoneLayout()
    const next = replacePhoneBlock(start, 'stat-screen', 'stat-kappa')
    expect(next.order[0]).toBe('stat-kappa')
    expect(next.order.indexOf('stat-screen')).toBe(start.order.indexOf('stat-kappa'))
    // the slot keeps its width: «Капа» is half wide on top now, «Экран» full width in its old place
    expect(next.narrow).toContain('stat-kappa')
    expect(next.narrow).not.toContain('stat-screen')
    expect(next.hidden).toBeUndefined()
    expect(replacePhoneBlock(start, 'stat-screen', 'stat-screen')).toBe(start)
    expect(replacePhoneBlock(start, 'stat-screen', 'nope')).toBe(start)
  })

  it('a block taken off comes back in its window, and the taking off survives a reload', async () => {
    const { replacePhoneBlock } = await import('./phoneLayout')
    const start = defaultPhoneLayout()
    const off = { ...start, order: start.order.filter((id) => id !== 'favorites'), hidden: ['favorites'] }
    const next = replacePhoneBlock(off, 'stat-goons', 'favorites')
    expect(next.order[1]).toBe('favorites')
    expect(next.order).not.toContain('stat-goons')
    expect(next.hidden).toEqual(['stat-goons'])
    expect(next.narrow).toEqual(['stat-screen', 'favorites'])
    expect(isDefaultPhoneLayout(next)).toBe(false)
    const again = sanitizePhoneLayout(JSON.parse(JSON.stringify(next)))
    expect(again).toEqual(next)
    expect(again.order).not.toContain('stat-goons')
  })
})
