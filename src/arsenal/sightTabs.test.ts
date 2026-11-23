// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { GunSlot } from './gunTypes'
import { isScopeSeat, ringSeat, sightTabs, sightTabsOf } from './sightTabs'

const slot = (nameId: string, allowed: string[]): GunSlot => ({ id: nameId, nameId, name: nameId, required: false, allowed })
// a 30 mm scope, ADO P4 (its own mount), a red dot, a thermal scope
const catalog = { mods: new Map([['tube', { category: 'scope' }], ['p4', { category: 'scope' }], ['dot', { category: 'reflex-sight' }], ['reap', { category: 'special-scope' }], ['riser', { category: 'mount' }]]) }
// rings: a seat for the optical scope only; a riser takes the red dot and ADO P4 as well
const ring = { category: 'mount', slots: [slot('mod_scope', ['tube'])] }
const ringWithDot = { category: 'mount', slots: [slot('mod_scope_000', ['tube']), slot('mod_scope_001', ['dot'])] }
const riser = { category: 'mount', slots: [slot('mod_scope', ['tube', 'p4', 'dot', 'reap', 'riser'])] }

describe('a sight slot\'s tabs (owner, 23.11.2026: «кольца, оптические прицелы, прицелы на планку и коллиматоры, тепловизоры и ночные»)', () => {
  it('knows a ring by its seat for the optical scope only', () => {
    expect(isScopeSeat(slot('mod_scope', ['tube']), catalog)).toBe(true)
    expect(isScopeSeat(slot('mod_scope', ['tube', 'dot']), catalog)).toBe(false)
    expect(isScopeSeat(slot('mod_scope', []), catalog)).toBe(false)
    expect(ringSeat(ring, catalog)?.nameId).toBe('mod_scope')
    expect(ringSeat(ringWithDot, catalog)?.nameId).toBe('mod_scope_000')
    expect(ringSeat(riser, catalog)).toBeUndefined()
  })

  it('on a rail: the rings under «Оптические прицелы» (and «Кольца»), a scope with its own mount under the rail scopes (owner, 24.11.2026)', () => {
    expect(sightTabsOf(ring, catalog, false)).toEqual(['optics', 'mounts'])
    expect(sightTabsOf(riser, catalog, false)).toEqual(['mounts'])
    expect(sightTabsOf({ category: 'scope' }, catalog, false)).toEqual(['rail'])
    expect(sightTabsOf({ category: 'assault-scope' }, catalog, false)).toEqual(['rail'])
    expect(sightTabsOf({ category: 'reflex-sight' }, catalog, false)).toEqual(['rail'])
    expect(sightTabsOf({ category: 'compact-reflex-sight' }, catalog, false)).toEqual(['rail'])
    expect(sightTabsOf({ category: 'special-scope' }, catalog, false)).toEqual(['special'])
    expect(sightTabsOf({ category: 'ironsight' }, catalog, false)).toEqual(['other'])
    expect(sightTabsOf({}, catalog, false)).toEqual(['other'])
    const parts = [{ category: 'special-scope' }, ring, { category: 'reflex-sight' }, riser, { category: 'scope' }, { category: 'assault-scope' }]
    expect(sightTabs(parts, catalog, false).map((tab) => [tab.key, tab.count])).toEqual([['mounts', 2], ['optics', 1], ['rail', 3], ['special', 1]])
  })

  it('in a ring\'s seat the scopes are the optical scopes, all in one list', () => {
    expect(sightTabsOf({ category: 'scope' }, catalog, true)).toEqual(['optics'])
    expect(sightTabs([{ category: 'scope' }, { category: 'scope' }], catalog, true)).toEqual([])
  })

  it('none for a slot without sights, nor for one whose sights all fall in one tab', () => {
    expect(sightTabs([{ category: 'stock' }, riser], catalog, false)).toEqual([])
    expect(sightTabs([{ category: 'reflex-sight' }, { category: 'compact-reflex-sight' }], catalog, false)).toEqual([])
  })
})
