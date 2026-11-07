import { describe, expect, it } from 'vitest'
import { sectorPoints } from '../components/StationaryWeaponZones'
import { STATIONARY_WEAPON_SECTORS, weaponSectorAt } from './stationaryWeaponSectors'

// Report №89; owner, 07.11.2026: «вот он стоит, на север, значит, он должен на север… поворачиваться… дальше он не может назад
// смотреть»; «Дистанцию метров 150».
describe('the sectors of the stationary weapons', () => {
  it('knows the weapons of seven maps, each turning less than half round', () => {
    expect(Object.keys(STATIONARY_WEAPON_SECTORS).sort()).toEqual(['customs', 'ground-zero', 'interchange', 'reserve', 'shoreline', 'streets-of-tarkov', 'woods'])
    for (const sectors of Object.values(STATIONARY_WEAPON_SECTORS)) {
      for (const sector of sectors) {
        expect(sector.heading).toBeGreaterThanOrEqual(0)
        expect(sector.heading).toBeLessThan(360)
        expect(sector.left + sector.right).toBeGreaterThan(20)
        expect(sector.left + sector.right).toBeLessThan(180)
      }
    }
  })

  it('finds a weapon by its marker\'s place ([z, x]) and nothing elsewhere', () => {
    const first = STATIONARY_WEAPON_SECTORS.customs![0]!
    expect(weaponSectorAt('customs', [first.z + 0.5, first.x - 0.5])).toBe(first)
    expect(weaponSectorAt('customs', [first.z + 30, first.x])).toBeUndefined()
    expect(weaponSectorAt('lighthouse', [first.z, first.x])).toBeUndefined()
  })

  it('draws the wedge from the left limit to the right one, 150 m out', () => {
    // heading 90 (along +x), 32 to each side (an arc of 16 steps), from [z 0, x 0]
    const points = sectorPoints([0, 0], { heading: 90, left: 32, right: 32 }, 150)
    expect(points[0]).toEqual([0, 0])
    expect(points[points.length - 1]).toEqual([0, 0])
    const arc = points.slice(1, -1)
    for (const [z, x] of arc) expect(Math.hypot(z, x)).toBeCloseTo(150, 6)
    // the left end at 58°, the right end at 122°, the middle straight along +x
    expect(arc[0]![0]).toBeCloseTo(150 * Math.cos((58 * Math.PI) / 180), 6)
    expect(arc[arc.length - 1]![0]).toBeCloseTo(150 * Math.cos((122 * Math.PI) / 180), 6)
    const middle = arc[Math.floor(arc.length / 2)]!
    expect(middle[0]).toBeCloseTo(0, 6)
    expect(middle[1]).toBeCloseTo(150, 6)
  })
})
