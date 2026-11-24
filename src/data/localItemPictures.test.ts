import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { stashPictures } from '../pages/HideoutStashPage'
import { LOCAL_ITEM_PICTURES, localItemPicture, withLocalItemPictures } from './localItemPictures'

const WEDGE = '6ad9cf0b5394c084310cac90'
const PLACEHOLDER = 'https://assets.tarkov.dev/unknown-item-icon.jpg'
const item = (id: string, iconUrl?: string) => ({ id, name: id, shortName: id, category: '', description: '', iconUrl, types: [], prices: [] }) as unknown as Item

describe('pictures kept with the app', () => {
  it('has a file for every item it names', () => {
    expect(LOCAL_ITEM_PICTURES.size).toBe(3)
    for (const id of LOCAL_ITEM_PICTURES) expect(existsSync(join(process.cwd(), 'public', 'item-pictures', `${id}.webp`)), id).toBe(true)
  })

  it('comes first among an item\'s stash pictures, and only for these items', () => {
    expect(stashPictures(WEDGE, item(WEDGE, PLACEHOLDER))[0]).toBe(localItemPicture(WEDGE))
    expect(stashPictures('other', item('other'))[0]).not.toContain('item-pictures')
    expect(localItemPicture('other')).toBeUndefined()
  })

  it('replaces the placeholder only: a real icon stands, and nothing to do is the same object', () => {
    const placeholder = { items: [item(WEDGE, PLACEHOLDER), item('other', 'https://assets.tarkov.dev/other-icon.webp')] }
    const next = withLocalItemPictures(placeholder)
    expect(next.items[0].iconUrl).toBe(localItemPicture(WEDGE))
    expect(next.items[1]).toBe(placeholder.items[1])
    const real = { items: [item(WEDGE, 'https://assets.tarkov.dev/wedge-icon.webp')] }
    expect(withLocalItemPictures(real)).toBe(real)
  })
})
