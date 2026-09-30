import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { BOSS_LOADOUT, resolveBossItem } from './bossLoadout'
import { BOSS_INFO } from './bossInfo'

const item = (id: string, normalizedName: string, types: string[] = []): Item => ({ id, normalizedName, name: normalizedName, shortName: normalizedName, category: 'Бартер', description: '', prices: [], types })

describe('boss loadout', () => {
  it('body health adds up to the boss total', () => {
    for (const [key, loadout] of Object.entries(BOSS_LOADOUT)) {
      if (!loadout.body) continue
      expect(loadout.body.reduce((a, b) => a + b, 0), key).toBe(BOSS_INFO[key].health)
    }
  })

  it('finds items by id, then by name, preferring the firearm over its parts', () => {
    const items = [
      item('a', 'sig-mpx-9x19-submachine-gun', ['gun']),
      item('b', 'sig-mpx-handguard'),
      item('c', 'physical-bitcoin'),
    ]
    expect(resolveBossItem({ name: { ru: '', en: '' }, ids: ['c'] }, items)?.id).toBe('c')
    expect(resolveBossItem({ name: { ru: '', en: '' }, slug: 'sig-mpx' }, items, undefined, true)?.id).toBe('a')
    expect(resolveBossItem({ name: { ru: '', en: '' }, slug: 'sig-mpx' }, items)?.id).toBe('b')
    expect(resolveBossItem({ name: { ru: '', en: '' }, slug: 'ledx' }, items)).toBeUndefined()
  })
})
