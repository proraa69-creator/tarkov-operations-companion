// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sightTabOf, sightTabs } from './sightTabs'

describe('a sight slot\'s tabs (owner, 23.11.2026: «кольца, оптические прицелы, прицелы на планку и коллиматоры, тепловизоры и ночные»)', () => {
  it('sorts the modules by their category', () => {
    expect(sightTabOf({ category: 'mount' })).toBe('mounts')
    expect(sightTabOf({ category: 'scope' })).toBe('optics')
    expect(sightTabOf({ category: 'assault-scope' })).toBe('rail')
    expect(sightTabOf({ category: 'reflex-sight' })).toBe('rail')
    expect(sightTabOf({ category: 'compact-reflex-sight' })).toBe('rail')
    expect(sightTabOf({ category: 'special-scope' })).toBe('special')
    expect(sightTabOf({ category: 'ironsight' })).toBe('other')
    expect(sightTabOf({})).toBe('other')
  })

  it('in the tabs\' order, empty ones left out, with their counts', () => {
    const parts = [{ category: 'special-scope' }, { category: 'mount' }, { category: 'reflex-sight' }, { category: 'mount' }, { category: 'assault-scope' }]
    expect(sightTabs(parts).map((tab) => [tab.key, tab.count])).toEqual([['mounts', 2], ['rail', 2], ['special', 1]])
  })

  it('none for a slot without sights, nor for one whose sights all fall in one tab', () => {
    expect(sightTabs([{ category: 'stock' }, { category: 'mount' }])).toEqual([])
    expect(sightTabs([{ category: 'reflex-sight' }, { category: 'compact-reflex-sight' }])).toEqual([])
  })
})
