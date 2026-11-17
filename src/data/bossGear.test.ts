import { describe, expect, it } from 'vitest'
import { bossGear, classLabel } from './bossGear'
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
