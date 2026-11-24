import { describe, expect, it } from 'vitest'
import type { Item, MapMarker } from '../domain/types'
import { withWholeGunPictures } from './wholeGunPictures'

const BASE = 'a'.repeat(24)
const PRESET = 'b'.repeat(24)
const item = (extra: Partial<Item>): Item => ({ id: BASE, name: 'Colt M4A1', shortName: 'M4A1', category: 'Оружие', description: '', types: ['gun'], iconUrl: `https://raidos.app/v1/item-images/${BASE}-icon.webp`, presetImageUrl: `https://raidos.app/v1/item-images/${PRESET}-grid.webp`, ...extra } as Item)
const presetRow = item({ id: PRESET, name: 'M4A1 build', types: ['preset'], iconUrl: `https://raidos.app/v1/item-images/${PRESET}-icon.webp`, presetImageUrl: undefined })

describe('a weapon is always the whole gun (owner, 06.11.2026: «Должно быть всегда цельное оружие»)', () => {
  it('takes the icon of its default build, which has no English name drawn on it', () => {
    const { items } = withWholeGunPictures({ items: [item({}), presetRow] })
    expect(items[0]!.iconUrl).toBe(presetRow.iconUrl)
  })

  it('with no row of that build: the build\'s big picture', () => {
    const { items } = withWholeGunPictures({ items: [item({})] })
    expect(items[0]!.iconUrl).toBe(`https://raidos.app/v1/item-images/${PRESET}-grid.webp`)
  })

  it('never a placeholder: the build\'s «unknown item» icon counts as none', () => {
    const { items } = withWholeGunPictures({ items: [item({}), { ...presetRow, iconUrl: 'https://assets.tarkov.dev/unknown-item-icon.webp' }] })
    expect(items[0]!.iconUrl).toBe(`https://raidos.app/v1/item-images/${PRESET}-grid.webp`)
    const noBuild = item({ presetImageUrl: 'https://assets.tarkov.dev/unknown-item-grid.webp' })
    expect(withWholeGunPictures({ items: [noBuild] }).items[0]!.iconUrl).toBe(noBuild.iconUrl)
  })

  it('leaves alone a gun with no default build and whatever is not a gun, and hands back the same object', () => {
    const flare = item({ presetImageUrl: undefined })
    const mod = item({ types: ['mods'], presetImageUrl: `https://raidos.app/v1/item-images/${PRESET}-grid.webp` })
    const data = { items: [flare, mod] }
    expect(withWholeGunPictures(data)).toBe(data)
  })

  it('the boss gear on the map is swapped by the same address; other gear stays', () => {
    const helmet = { name: 'Шлем', iconUrl: 'https://raidos.app/v1/item-images/helmet-icon.webp', slot: 'Headwear' }
    const marker = { id: 'boss', boss: { name: 'Решала', gear: [{ name: 'M4A1', iconUrl: item({}).iconUrl, slot: 'FirstPrimaryWeapon' }, helmet] } } as unknown as MapMarker
    const { markers } = withWholeGunPictures({ items: [item({}), presetRow], markers: [marker] })
    expect(markers![0]!.boss!.gear!.map((entry) => entry.iconUrl)).toEqual([presetRow.iconUrl, helmet.iconUrl])
  })
})
