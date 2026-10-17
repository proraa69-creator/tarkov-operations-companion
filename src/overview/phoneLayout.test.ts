import { describe, expect, it } from 'vitest'
import { defaultPhoneLayout, isDefaultPhoneLayout, loadPhoneLayout, movePhoneBlock, PHONE_BLOCKS, PHONE_LAYOUT_KEY, sanitizePhoneLayout, savePhoneLayout, togglePhoneNarrow } from './phoneLayout'

describe('the phone Overview: one column, every block moves up or down', () => {
  it('starts with every block, the two counters side by side', () => {
    const layout = defaultPhoneLayout()
    expect(layout.order).toEqual([...PHONE_BLOCKS])
    // owner, 17.10.2026: «Текущие задания» and «Задания для Капы» small, side by side at the top
    expect(layout.order.slice(0, 4)).toEqual(['stat-tasks', 'stat-kappa', 'stat-conditions', 'stat-goons'])
    expect(layout.narrow).toEqual(['stat-tasks', 'stat-kappa'])
    expect(isDefaultPhoneLayout(layout)).toBe(true)
  })

  it('moves any block one place, the raid map too, and stops at the ends', () => {
    const start = defaultPhoneLayout()
    const up = movePhoneBlock(start, 'raid', -1)
    expect(up.order.indexOf('raid')).toBe(start.order.indexOf('raid') - 1)
    expect(up.order.indexOf('priority')).toBe(start.order.indexOf('raid'))
    expect(movePhoneBlock(start, 'stat-tasks', -1)).toBe(start)
    expect(movePhoneBlock(start, 'favorites', 1)).toBe(start)
    expect(movePhoneBlock(start, 'nope', 1)).toBe(start)
  })

  it('only «Текущие задания» and «Задания для Капы» become half wide; «Сбор на рейд» and «Кочевники» stay full width', () => {
    const start = defaultPhoneLayout()
    const wide = togglePhoneNarrow(start, 'stat-tasks')
    expect(wide.narrow).toEqual(['stat-kappa'])
    expect(togglePhoneNarrow(wide, 'stat-tasks').narrow).toEqual(['stat-kappa', 'stat-tasks'])
    expect(togglePhoneNarrow(start, 'raid')).toBe(start)
    expect(togglePhoneNarrow(start, 'stat-conditions')).toBe(start)
    expect(togglePhoneNarrow(start, 'stat-goons')).toBe(start)
  })

  it('a saved layout keeps its order, drops unknown blocks and gets new ones at their place', () => {
    const saved = sanitizePhoneLayout({ order: ['raid', 'nope', 'stat-tasks', 'raid'], narrow: ['stat-kappa', 'stat-conditions', 'raid'] })
    expect(saved.order).toEqual(['raid', 'stat-kappa', 'stat-conditions', 'stat-goons', 'priority', 'stat-tasks', 'squad', 'requirements', 'tasks', 'gunsmith', 'favorites'])
    expect(saved.order).toHaveLength(PHONE_BLOCKS.length)
    expect(new Set(saved.order).size).toBe(PHONE_BLOCKS.length)
    expect(saved.order.indexOf('raid')).toBeLessThan(saved.order.indexOf('stat-tasks'))
    expect(saved.narrow).toEqual(['stat-kappa'])
    expect(sanitizePhoneLayout(null)).toEqual(defaultPhoneLayout())
  })

  it('a phone layout saved with «Прогресс» keeps «Сбор на рейд» in its place, now full width', () => {
    const saved = sanitizePhoneLayout({ order: ['raid', 'stat-progress', 'stat-tasks', 'stat-kappa'], narrow: ['stat-progress'] })
    expect(saved.order.slice(0, 3)).toEqual(['raid', 'stat-conditions', 'stat-tasks'])
    expect(saved.order).not.toContain('stat-progress')
    expect(saved.narrow).toEqual([])
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
