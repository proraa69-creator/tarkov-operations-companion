// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defaultOverviewLayout } from './overviewLayout'
import { addableBlocks, addFree, completeFree, freeFromZones, moveFree, packFree, removeFree, sanitizeFreeLayout } from './overviewFreeLayout'

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

  it('a card taken off leaves its place empty: the cards to its right move left, none stretches; «Добавить блок» puts it in the gap', () => {
    const start = freeFromZones(defaultOverviewLayout())
    const layout = removeFree(start, 'stat-conditions', packFree(start, (id) => HEIGHT[id] ?? 0, 14))
    expect(layout.removed).toEqual(['stat-conditions'])
    const cards = (from: typeof layout) => packFree(from, (id) => HEIGHT[id] ?? 0, 14).filter((place) => place.id.startsWith('stat-')).map((place) => [place.id, place.x, place.w])
    expect(cards(layout)).toEqual([['stat-screen', 0, 6], ['stat-kappa', 6, 6], ['stat-goons', 12, 6]])
    expect(addableBlocks(layout, [])).toEqual(['stat-conditions'])
    expect(addableBlocks(layout, ['stat-conditions'])).toEqual([])
    const back = addFree(layout, 'stat-conditions', (id) => HEIGHT[id] ?? 0, 14, start)
    expect(back.removed).toBeUndefined()
    expect(cards(back)).toContainEqual(['stat-conditions', 18, 6])
    expect(packFree(back, (id) => HEIGHT[id] ?? 0, 14).find((place) => place.id === 'stat-conditions')!.y).toBe(0)
    // no gap high enough anywhere: where it stands highest, under the others, moving none of them
    const full = removeFree(start, 'favorites', packFree(start, (id) => HEIGHT[id] ?? 0, 14))
    const again = addFree(full, 'favorites', (id) => HEIGHT[id] ?? 0, 14, start)
    expect(again.order.at(-1)).toBe('favorites')
    expect(again.x.favorites).toBe(15)
  })

  it('a block goes up into a gap it fits in (owner, 20.11.2026: «Остальные просто сдвигаются выше»)', () => {
    // «Рынок» put at the top right: «Кочевники» goes under it, and «Текущие задания» stays right under the cards beside them
    const start = freeFromZones(defaultOverviewLayout())
    const moved = moveFree(start, 'favorites', 0, 15)
    const places = Object.fromEntries(packFree(moved, (id) => HEIGHT[id] ?? 0, 14).map((place) => [place.id, place]))
    expect([places.favorites!.x, places.favorites!.y]).toEqual([15, 0])
    expect(places['stat-goons']!.y).toBe(98)
    // the room under «Кочевники» (columns 18–24) is too low for the list beside the Kappa card: it goes under the cards
    expect(places.tasks!.y).toBeGreaterThanOrEqual(places['stat-kappa']!.y + places['stat-kappa']!.h)
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
