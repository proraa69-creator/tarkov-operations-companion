import { describe, expect, it } from 'vitest'
import { weaponSize } from './buildStats'
import { adaptMods } from './gunQueries'
import type { GunPart } from './gunTypes'

const grow = (sides: Partial<Record<'left' | 'right' | 'up' | 'down', number>>, forced = false) => ({ left: 0, right: 0, up: 0, down: 0, ...sides, forced })
const part = (id: string, increaseSize?: GunPart['increaseSize']): GunPart => ({
  id, name: id, shortName: id, weight: 0, ergonomics: 0, recoilModifier: 0, accuracyModifier: 0, slots: [], conflicts: [], offers: [], noFlea: false,
  ...(increaseSize ? { increaseSize } : {}),
})
const catalogOf = (parts: GunPart[]) => ({ mods: new Map(parts.map((entry) => [entry.id, entry])) })

describe('weapon size in cells (Gunsmith width / height)', () => {
  it('reads json.tarkov.dev `increaseSize` and `increaseSizeForced`', () => {
    const mods = adaptMods({ data: { items: [
      { id: 'stock', name: 'Stock', properties: { increaseSize: { right: 2 }, increaseSizeForced: false } },
      { id: 'can', name: 'Suppressor', properties: { increaseSize: { right: 1 }, increaseSizeForced: true } },
      { id: 'grip', name: 'Grip', properties: {} },
    ] } })
    expect(mods.get('stock')?.increaseSize).toEqual(grow({ right: 2 }))
    expect(mods.get('can')?.increaseSize).toEqual(grow({ right: 1 }, true))
    expect(mods.get('grip')?.increaseSize).toBeUndefined()
  })

  it('grows the bare weapon by the largest ordinary growth on each side plus every forced one', () => {
    const parts = [part('stock', grow({ right: 2 })), part('brace', grow({ right: 1 })), part('can', grow({ right: 1 }, true)), part('mag', grow({ down: 1 })), part('scope', grow({ up: 1 }))]
    expect(weaponSize(parts, { width: 3, height: 1 }, catalogOf(parts))).toEqual({ width: 6, height: 3 })
    expect(weaponSize([], { width: 3, height: 1 }, catalogOf(parts))).toEqual({ width: 3, height: 1 })
  })

  it('knows nothing without part sizes (a catalogue cached by an older version) or without the weapon’s own size', () => {
    const plain = [part('stock')]
    expect(weaponSize(plain, { width: 3, height: 1 }, catalogOf(plain))).toEqual({})
    const sized = [part('stock', grow({ right: 2 }))]
    expect(weaponSize(sized, {}, catalogOf(sized))).toEqual({})
  })
})
