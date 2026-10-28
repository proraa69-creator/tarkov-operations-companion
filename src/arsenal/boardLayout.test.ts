import { describe, expect, it } from 'vitest'
import { boardLayout } from './boardLayout'
import type { GunPart, GunSlot, Weapon } from './gunTypes'

const slot = (nameId: string, allowed: string[]): GunSlot => ({ id: nameId, nameId, name: nameId, required: false, allowed })
const part = (id: string, category: string, slots: GunSlot[] = []): GunPart => ({
  id, name: id, shortName: id, weight: 0.1, ergonomics: 0, recoilModifier: 0, accuracyModifier: 0, slots, conflicts: [], noFlea: false, offers: [], category,
})

describe('the «Сборка оружия» board', () => {
  it('draws a chassis, its rail and the foregrip below even in a slot that mostly takes sight rails (СВД, owner 28.10.2026)', () => {
    const mods = new Map<string, GunPart>([
      ['railA', part('railA', 'mount', [slot('mod_scope', ['scope'])])],
      ['railB', part('railB', 'mount', [slot('mod_scope', ['scope'])])],
      ['chassis', part('chassis', 'handguard', [slot('mod_scope', ['scope']), slot('mod_foregrip', ['rail'])])],
      ['rail', part('rail', 'mount', [slot('mod_foregrip', ['grip'])])],
      ['grip', part('grip', 'foregrip')],
      ['scope', part('scope', 'scope')],
    ])
    const weapon = { ...part('svd', 'marksman-rifle', [slot('mod_mount_001', ['railA', 'railB', 'chassis'])]), weaponClass: 'marksman-rifle', weaponClassName: '', caliber: '', fireRate: 0, recoilVertical: 0, recoilHorizontal: 0 } as Weapon
    const build = { weaponId: 'svd', root: { itemId: 'svd', children: { mod_mount_001: { itemId: 'chassis', children: { mod_scope: { itemId: 'scope', children: {} }, mod_foregrip: { itemId: 'rail', children: { mod_foregrip: { itemId: 'grip', children: {} } } } } } } } }
    const zones = Object.fromEntries(boardLayout(build, weapon, { mods }).cells.map((cell) => [cell.path.join('/'), cell.zone]))
    expect(zones['mod_mount_001']).toBe('bottom')
    expect(zones['mod_mount_001/mod_foregrip']).toBe('bottom')
    expect(zones['mod_mount_001/mod_foregrip/mod_foregrip']).toBe('bottom')
    expect(zones['mod_mount_001/mod_scope']).toBe('top')
  })
})
