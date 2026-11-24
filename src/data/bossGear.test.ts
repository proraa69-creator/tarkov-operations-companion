import { describe, expect, it } from 'vitest'
import { bossGear, bossRetinue, classLabel, lightsWarning, LIGHTS_WARNED, retinueGear, retinueLoot, retinueMaps, retinueSize } from './bossGear'
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

  it('what each kind wears and may carry: helmets, armour, rigs and a loot list of at least 1 %', () => {
    for (const [key, retinue] of Object.entries({ reshala: bossRetinue('reshala'), glukhar: bossRetinue('glukhar'), kaban: bossRetinue('kaban'), sanitar: bossRetinue('sanitar') })) {
      for (const member of retinue!.members) {
        expect(member.helmets, `${key} ${member.name.en}`).toBeDefined()
        expect(member.rigs, `${key} ${member.name.en}`).toBeDefined()
        for (const entry of [...member.helmets!, ...member.rigs!]) expect(entry.name.ru && entry.name.en, entry.id).toBeTruthy()
        const chances = (member.loot ?? []).map((entry) => entry.chance)
        expect(chances.every((chance) => chance >= 1 && chance <= 100), key).toBe(true)
        expect(chances, key).toEqual([...chances].sort((a, b) => b - a))
      }
    }
    // Reshala's guards wear helmets; Sanitar's carry stims (M.U.L.E., meldonin, trimadol on about every sixth)
    expect(bossRetinue('reshala')!.members[0]!.helmets!.length).toBeGreaterThan(0)
    expect(bossRetinue('sanitar')!.members[0]!.loot!.some((entry) => entry.id === '5ed51652f6c34d2cc26336a1' && entry.chance > 10)).toBe(true)
  })

  it('Zryachiy\'s two followers on Lighthouse: sniper rifles and no armour (the offline copy\'s data)', () => {
    const [follower] = bossRetinue('zryachiy')!.members
    expect(follower!.counts).toEqual([{ min: 2, max: 2, maps: ['lighthouse'] }])
    expect(follower!.weapons!.map((weapon) => weapon.name.en)).toEqual(expect.arrayContaining(['SV-98', 'SVDS']))
    expect(follower!.weapons!.every((weapon) => weapon.ammo.length > 0)).toBe(true)
    expect(follower!.armored).toBe(0)
    expect(follower!.face).toBeUndefined()
    expect(retinueMaps(bossRetinue('zryachiy')!)).toEqual(['lighthouse'])
  })

  it('report 201: Glukhar\'s guards nearly always carry a light or IR on the gun, and the panel says what it blinds', () => {
    for (const member of bossRetinue('glukhar')!.members) {
      expect(member.lights!.share, member.name.en).toBeGreaterThanOrEqual(LIGHTS_WARNED)
      expect(member.lights!.devices.length, member.name.en).toBeGreaterThan(0)
      expect(lightsWarning(member.lights), member.name.en).toMatch(/слепит/)
    }
    // other guards light up less often: no warning (Reshala's: about half the guns)
    expect(lightsWarning(bossRetinue('reshala')!.members[0]!.lights)).toBeUndefined()
    expect(lightsWarning({ share: 0.9, white: 0.8, ir: 0.1, devices: [] })).toBe('Почти всегда с фонарём: слепит вблизи')
    expect(lightsWarning({ share: 0.9, white: 0.1, ir: 0.8, devices: [] })).toBe('Почти всегда с ИК-подсветкой: слепит в ПНВ')
    expect(lightsWarning({ share: 0.9, white: 0.5, ir: 0.4, devices: [] })).toMatch(/свет слепит вблизи, ИК — в ПНВ/)
    expect(lightsWarning(undefined)).toBeUndefined()
  })

  it('PvE takes its own loot list where it has one, the Season the PvP one', () => {
    const member = { name: { ru: 'Охранник', en: 'Guard' }, counts: [], loot: [{ id: 'a', chance: 5 }], lootPve: [{ id: 'b', chance: 3 }] }
    expect(retinueLoot(member, 'pve').map((entry) => entry.id)).toEqual(['b'])
    expect(retinueLoot(member, 'seasonal').map((entry) => entry.id)).toEqual(['a'])
    expect(retinueLoot({ ...member, lootPve: undefined }, 'pve').map((entry) => entry.id)).toEqual(['a'])
    expect(retinueMaps(bossRetinue('glukhar')!).sort()).toEqual(['reserve', 'terminal'])
  })

  it('the Goons name the other two, with the kit of their own pages; a boss alone has none', () => {
    const birdeye = bossRetinue('goon-1')!
    expect(birdeye.squad).toBe(true)
    expect(birdeye.members.map((member) => member.ref)).toEqual(['goon-2', 'goon-3'])
    expect(retinueGear(birdeye.members[0]!)).toBe(bossGear('goon-2')!.groups[0])
    expect(bossRetinue('killa')).toBeUndefined()
  })
})
