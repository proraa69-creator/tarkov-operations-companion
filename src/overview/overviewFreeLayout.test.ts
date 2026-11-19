// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defaultOverviewLayout } from './overviewLayout'
import { completeFree, freeFromZones, moveFree, packFree, removeFree, sanitizeFreeLayout } from './overviewFreeLayout'

/** Heights of the Overview's blocks, as on a PC. */
const HEIGHT: Record<string, number> = {
  'stat-screen': 104, 'stat-conditions': 168, 'stat-kappa': 119, 'stat-goons': 121,
  raid: 450, squad: 0, requirements: 176, tasks: 150, gunsmith: 150, favorites: 84,
}
const at = (layout: ReturnType<typeof freeFromZones>) => Object.fromEntries(packFree(layout, (id) => HEIGHT[id] ?? 0, 14).map((place) => [place.id, [place.x, place.y]]))

describe('the free PC Overview (owner, 20.11.2026: «все блоки можно перемешать и передвигать как нужно»)', () => {
  it('starts as it always stood: the cards in a row as tall as the tallest, the wide column left and the narrow one right', () => {
    const layout = freeFromZones(defaultOverviewLayout())
    expect(at(layout)).toEqual({
      'stat-screen': [0, 0], 'stat-conditions': [6, 0], 'stat-kappa': [12, 0], 'stat-goons': [18, 0],
      raid: [0, 182], tasks: [15, 182], squad: [0, 646], gunsmith: [15, 346], requirements: [0, 646], favorites: [15, 510],
    })
  })

  it('«Требования рейда» put on top: the blocks it would cover go down, the one beside it stays', () => {
    const layout = moveFree(freeFromZones(defaultOverviewLayout()), 'requirements', 0, 0)
    const places = at(layout)
    expect(places.requirements).toEqual([0, 0])
    // the three cards over its columns go under it; «Кочевники» (columns 18–24) stays at the top
    expect([places['stat-screen'], places['stat-conditions'], places['stat-kappa']]).toEqual([[0, 190], [6, 190], [12, 190]])
    expect(places['stat-goons']).toEqual([18, 0])
    expect(places.raid![1]).toBeGreaterThan(190)
  })

  it('a block keeps its width and stands on every third column, never past the edge; a card on a multiple of its width', () => {
    const layout = freeFromZones(defaultOverviewLayout())
    expect(moveFree(layout, 'favorites', 9, 22).x.favorites).toBe(15)
    expect(moveFree(layout, 'favorites', 9, 7).x.favorites).toBe(6)
    expect(moveFree(layout, 'stat-kappa', 2, 16).x['stat-kappa']).toBe(18)
    expect(moveFree(layout, 'raid', 4, 40).x.raid).toBe(9)
  })

  it('a card taken off: the others share the row (owner, 17.11.2026); «Сбросить» brings it back', () => {
    const layout = removeFree(freeFromZones(defaultOverviewLayout()), 'stat-goons')
    expect(layout.removed).toEqual(['stat-goons'])
    const places = packFree(layout, (id) => HEIGHT[id] ?? 0, 14).filter((place) => place.id.startsWith('stat-'))
    expect(places.map((place) => [place.id, place.x, place.w])).toEqual([['stat-screen', 0, 8], ['stat-conditions', 8, 8], ['stat-kappa', 16, 8]])
  })

  it('a saved layout: unknown blocks dropped, a block it lacks joins after its neighbour of the default, the owner\'s hidden one stays out', () => {
    const base = freeFromZones(defaultOverviewLayout())
    const saved = sanitizeFreeLayout({ order: ['requirements', 'nonsense', 'raid', 'tasks'], x: { requirements: 4, raid: 'x' } }, base)!
    expect(saved.x.requirements).toBe(3)
    expect(saved.x.raid).toBe(0)
    const full = completeFree(saved, ['stat-goons'], base)
    // «Рынок» follows «Требования рейда», the block before it in the default order, at its own column
    expect(full.order).toEqual(['stat-screen', 'stat-conditions', 'stat-kappa', 'requirements', 'favorites', 'raid', 'tasks', 'squad', 'gunsmith'])
    expect(full.x.favorites).toBe(15)
    expect(sanitizeFreeLayout('broken', base)).toBeNull()
  })

  it('one column on a narrow window: every block full width, in order', () => {
    const layout = moveFree(freeFromZones(defaultOverviewLayout()), 'requirements', 0, 0)
    const places = packFree(layout, (id) => HEIGHT[id] ?? 0, 14, true)
    expect(places.every((place) => place.x === 0 && place.w === 24)).toBe(true)
    expect(places.map((place) => place.id).slice(0, 2)).toEqual(['requirements', 'stat-screen'])
    expect(places[1]!.y).toBe(190)
  })
})
