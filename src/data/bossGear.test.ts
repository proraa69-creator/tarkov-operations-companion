import { describe, expect, it } from 'vitest'
import { bossGear, bossRetinue, classLabel, retinueGear, retinueSize } from './bossGear'
import { BOSS_INFO } from './bossInfo'

describe('bosses\' rounds and plates (report 178: «сборка + патрон… бронежилеты и их плиты»)', () => {
  it('Tagilla and his Shadow: a class 6 plate in front, class 4 at the back', () => {
    for (const key of ['tagilla', 'tagilla-2']) {
      const [group] = bossGear(key)!.groups
      expect(group!.plates.front).toEqual([6, 6])
      expect(group!.plates.back).toEqual([4, 4])
    }
  })

  it('Black Division: class 4 plates on Labs and Icebreaker, 5 and up with side plates elsewhere', () => {
    const groups = bossGear('black-division')!.groups
    const terminal = groups.find((group) => group.elsewhere)!
    const labs = groups.find((group) => group.maps?.includes('the-lab'))!
    expect(labs.plates.front).toEqual([4, 4])
    expect(terminal.plates.front![0]).toBeGreaterThanOrEqual(5)
    expect(terminal.plates.side![0]).toBeGreaterThanOrEqual(5)
  })

  it('every gun has a name in both languages, every boss is one of the gallery\'s', () => {
    for (const [key, gear] of Object.entries({ tagilla: bossGear('tagilla'), killa: bossGear('killa'), reshala: bossGear('reshala') })) {
      expect(BOSS_INFO[key], key).toBeTruthy()
      for (const group of gear!.groups) for (const weapon of group.weapons) {
        expect(weapon.name.ru && weapon.name.en, weapon.id).toBeTruthy()
        expect(weapon.ammo.length, weapon.name.en).toBeLessThanOrEqual(3)
      }
    }
    // Reshala wears no armour, his Golden TT stays among the guns
    expect(bossGear('reshala')!.groups[0]!.armored).toBe(0)
    expect(bossGear('reshala')!.groups[0]!.weapons.some((weapon) => weapon.name.en.includes('Gold'))).toBe(true)
  })

  it('a class or a range', () => {
    expect(classLabel([6, 6])).toBe('6')
    expect(classLabel([4, 5])).toBe('4–5')
  })
})

describe('«Свита» (owner, 20.11.2026)', () => {
  it('names each kind of guard with how many come on which map, and his kit', () => {
    const reshala = bossRetinue('reshala')!
    expect(reshala.members.map((member) => [member.name.ru, member.counts.map((count) => [count.maps, count.min, count.max])]))
      .toEqual([['Охранник', [[['customs'], 2, 4], [['terminal'], 4, 4]]]])
    expect(retinueSize(reshala)).toEqual([2, 4])
    const guard = retinueGear(reshala.members[0]!)!
    expect(guard.weapons.length).toBeGreaterThan(2)
    expect(guard.weapons.every((weapon) => weapon.ammo.length > 0 || /нож|knife/i.test(weapon.name.en))).toBe(true)
    // Glukhar's three kinds: six on Reserve, three on Terminal
    expect(bossRetinue('glukhar')!.members.map((member) => member.name.ru)).toEqual(['Штурмовик', 'Служба безопасности', 'Разведчик'])
    expect(retinueSize(bossRetinue('glukhar')!)).toEqual([3, 6])
    expect(retinueSize(bossRetinue('kaban')!)).toEqual([7, 8])
  })

  it('the Goons name the other two, with the kit of their own pages; a boss alone has none', () => {
    const birdeye = bossRetinue('goon-1')!
    expect(birdeye.squad).toBe(true)
    expect(birdeye.members.map((member) => member.ref)).toEqual(['goon-2', 'goon-3'])
    expect(retinueGear(birdeye.members[0]!)).toBe(bossGear('goon-2')!.groups[0])
    expect(bossRetinue('killa')).toBeUndefined()
  })
})
