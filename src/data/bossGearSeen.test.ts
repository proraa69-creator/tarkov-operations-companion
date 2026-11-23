import { describe, expect, it } from 'vitest'
import { bossGear } from './bossGear'

const ammoOf = (boss: string, weaponId: string, pick: (group: { maps?: string[]; elsewhere?: boolean }) => boolean) =>
  bossGear(boss)!.groups.filter(pick).flatMap((group) => group.weapons.filter((weapon) => weapon.id === weaponId).flatMap((weapon) => weapon.ammo.map((ammo) => ammo.name.ru)))

describe('ammo the players met, over the bot loadouts', () => {
  it('Shturman\'s TKPD fires 7N33 too (report №198)', () => {
    expect(ammoOf('shturman', '68aee763130c00663d08aea8', () => true)).toEqual(['SP', '7Н33'])
  })
  it('Black Division away from Icebreaker and the Lab: M855A1 in the M4A1, CBJ in the MCX .300 BLK (report №195)', () => {
    expect(ammoOf('black-division', '5447a9cd4bdc2dbd208b4567', (group) => Boolean(group.elsewhere))).toEqual(['M995', 'SSA AP', 'M855A1'])
    expect(ammoOf('black-division', '5fbcc1d9016cce60e8341ab3', (group) => Boolean(group.elsewhere))).toEqual(['AP', 'CBJ'])
    // their Icebreaker / Lab kit as it was
    expect(ammoOf('black-division', '5fbcc1d9016cce60e8341ab3', (group) => Boolean(group.maps?.length))).toEqual(['CBJ', 'AP'])
  })
})
