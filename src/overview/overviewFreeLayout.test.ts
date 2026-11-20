// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defaultOverviewLayout } from './overviewLayout'
import { addableBlocks, addFree, completeFree, freeFromZones, moveFree, packFree, removeFree, sanitizeFreeLayout, type FreeLayout } from './overviewFreeLayout'

/** Heights of the Overview's blocks, as on a PC. */
const HEIGHT: Record<string, number> = {
  'stat-screen': 104, 'stat-conditions': 168, 'stat-kappa': 119, 'stat-goons': 121,
  raid: 450, squad: 0, requirements: 176, tasks: 150, gunsmith: 150, favorites: 84,
}
const height = (id: string) => HEIGHT[id] ?? 0
const at = (layout: FreeLayout) => Object.fromEntries(packFree(layout, height, 14).map((place) => [place.id, [place.x, place.y, place.w, place.h]]))
const start = () => freeFromZones(defaultOverviewLayout())

describe('the free PC Overview (owner, 20.11.2026: «все блоки можно перемешать и передвигать как нужно»)', () => {
  it('starts as it always stood: the four cards in a row as tall as the tallest, the map\'s column left and the narrow one right', () => {
    expect(at(start())).toEqual({
      'stat-screen': [0, 0, 6, 168], 'stat-conditions': [6, 0, 6, 168], 'stat-kappa': [12, 0, 6, 168], 'stat-goons': [18, 0, 6, 168],
      raid: [0, 182, 15, 450], tasks: [15, 182, 9, 150], squad: [0, 646, 15, 0], gunsmith: [15, 346, 9, 150],
      requirements: [0, 646, 15, 176], favorites: [15, 510, 9, 84],
    })
  })

  it('«Требования рейда» put on top: the whole row of cards goes down under it, «Кочевники» too, the same size', () => {
    const places = at(moveFree(start(), 'requirements', 0, 0))
    expect(places.requirements).toEqual([0, 0, 15, 176])
    expect(['stat-screen', 'stat-conditions', 'stat-kappa', 'stat-goons'].map((id) => places[id])).toEqual([
      [0, 190, 6, 168], [6, 190, 6, 168], [12, 190, 6, 168], [18, 190, 6, 168],
    ])
  })

  it('three cards left in a row stand as wide as the map\'s column; a card alone at the right fills the right column', () => {
    // «Кочевники» carried to the right column, into a row of its own
    const layout = moveFree(start(), 'stat-goons', 4, 18)
    const places = at(layout)
    expect(['stat-screen', 'stat-conditions', 'stat-kappa'].map((id) => places[id]!.slice(0, 3))).toEqual([[0, 0, 5], [5, 0, 5], [10, 0, 5]])
    expect(places['stat-goons']!.slice(0, 3)).toEqual([15, 0, 9])
    // the Kappa card carried onto it: two cards side by side in the right column
    const two = moveFree(layout, 'stat-kappa', layout.order.indexOf('stat-goons'), 0, layout.group!['stat-goons'])
    const both = at(two)
    expect([both['stat-goons']!.slice(0, 3), both['stat-kappa']!.slice(0, 3)]).toEqual([[15, 0, 4.5], [19.5, 0, 4.5]])
    // the two cards left at the left keep their own width (no far stretch... 7.5 each fills the map's column)
    expect(both['stat-screen']!.slice(0, 3)).toEqual([0, 0, 7.5])
  })

  it('a block has no width of its own: it takes the column it stands in (owner, 20.11.2026: «блоки сами будут адаптироваться под размер»)', () => {
    const left = at(moveFree(start(), 'favorites', 4, 0))
    expect(left.favorites!.slice(0, 3)).toEqual([0, 182, 15])
    const right = at(moveFree(start(), 'raid', 4, 18))
    expect(right.raid!.slice(0, 3)).toEqual([15, 182, 9])
  })

  it('a card taken off: the rest of its row stays together at the left, its place empty; «Добавить блок» puts it back into the row', () => {
    const layout = removeFree(start(), 'stat-conditions', packFree(start(), height, 14))
    expect(layout.removed).toEqual(['stat-conditions'])
    const places = at(layout)
    expect(['stat-screen', 'stat-kappa', 'stat-goons'].map((id) => places[id]!.slice(0, 3))).toEqual([[0, 0, 5], [5, 0, 5], [10, 0, 5]])
    // the right column rises beside them
    expect(places.tasks![1]).toBe(0)
    expect(addableBlocks(layout, [])).toEqual(['stat-conditions'])
    expect(addableBlocks(layout, ['stat-conditions'])).toEqual([])
    const back = addFree(layout, 'stat-conditions', height, 14, start())
    expect(back.removed).toBeUndefined()
    expect(Object.values(at(back)).filter((place) => place[2] === 6 && place[1] === 0)).toHaveLength(4)
  })

  it('a block goes up into a gap it fits in (owner, 20.11.2026: «Остальные просто сдвигаются выше»)', () => {
    const places = at(removeFree(start(), 'tasks', packFree(start(), height, 14)))
    expect(places.gunsmith![1]).toBe(182)
  })

  it('a saved layout: unknown blocks dropped, a block it lacks joins after its neighbour of the default, the owner\'s hidden one stays out', () => {
    const base = start()
    const saved = sanitizeFreeLayout({ order: ['requirements', 'nonsense', 'raid', 'tasks'], x: { requirements: 4, raid: 'x' } }, base)!
    expect(saved.x.requirements).toBe(4)
    expect(saved.x.raid).toBe(0)
    const full = completeFree(saved, ['stat-goons'], base)
    expect(full.order).toEqual(['stat-screen', 'stat-conditions', 'stat-kappa', 'requirements', 'favorites', 'raid', 'tasks', 'squad', 'gunsmith'])
    expect(sanitizeFreeLayout('broken', base)).toBeNull()
  })

  it('one column on a narrow window: every block full width, in order; a row of cards shares it', () => {
    const places = packFree(moveFree(start(), 'requirements', 0, 0), height, 14, true)
    expect(places[0]).toMatchObject({ id: 'requirements', x: 0, w: 24, y: 0 })
    expect(places.filter((place) => place.id.startsWith('stat-')).map((place) => place.w)).toEqual([6, 6, 6, 6])
  })
})
