// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SIGHT_HEIGHT } from '../arsenal/ballistics'
import type { Build } from '../arsenal/gunTypes'
import type { PartsIndex } from '../arsenal/partPictures'
import { flightAt } from './rangeFlight'
import { holdBarHalfCm, reticleAt, tickAt, type ScopeMode } from './rangeScope'
import { sightLine, type SightPoints } from './rangeSight'
import type { AmmoStats } from '../arsenal/gunTypes'

const index = JSON.parse(readFileSync(new URL('../../public/gun-parts/index.json', import.meta.url), 'utf8')) as PartsIndex

const M4A1 = '5447a9cd4bdc2dbd208b4567'
const UPPER = '55d355e64bdc2d962f8b4569'
const BARREL = '55d35ee94bdc2d61338b4568'
const HAMR = '544a3a774bdc2d3a388b4567'
// the game's own points of these parts (E:\SPT-photo\range-assets\tools\sight_points.py)
const points: SightPoints = {
  aim: { [HAMR]: [0, 0.04061, -0.17899], [M4A1]: [0.13266, 0.01684, 0.10318] },
  bore: {},
  kind: { [HAMR]: 'AssaultScope', [M4A1]: 'Weapon' },
}
const build = (scope?: string): Build => ({
  weaponId: M4A1,
  root: { itemId: M4A1, children: { mod_reciever: { itemId: UPPER, children: { mod_barrel: { itemId: BARREL, children: {} }, ...(scope ? { mod_scope: { itemId: scope, children: {} } } : {}) } } } },
})

describe('the sight height of the build', () => {
  it('a scope on the M4A1 upper: its optic axis over the barrel’s bore, by the game’s own points', () => {
    const line = sightLine(build(HAMR), index, points, HAMR)
    expect(line.measured).toBe(true)
    expect(line.sightId).toBe(HAMR)
    // the upper's rail 5.3 cm over its barrel slot, the HAMR's axis 4.1 cm over its rail, the barrel 2.2 cm up in the upper
    expect(line.height * 100).toBeCloseTo(7.13, 1)
  })

  it('no scope: the weapon’s own open sights; nothing known: the usual 6.858 cm', () => {
    const open = sightLine(build(), index, points)
    expect(open.sightId).toBe(M4A1)
    expect(open.height * 100).toBeGreaterThan(5)
    expect(open.height * 100).toBeLessThan(10)
    expect(sightLine(build(HAMR), index, { aim: {}, bore: {}, kind: {} }, HAMR)).toEqual({ height: SIGHT_HEIGHT, measured: false })
  })

  it('a higher sight puts the bullet lower under the line of sight short of the zero', () => {
    const m855 = { id: 'm855', caliber: 'Caliber556x45NATO', damage: 54, penetration: 31, initialSpeed: 922, bulletMassGrams: 4, bulletDiameterMm: 5.7, ballisticCoefficient: 0.152 } as unknown as AmmoStats
    const low = flightAt(m855, undefined, 100, 25, { sightHeight: 0.04 })!
    const high = flightAt(m855, undefined, 100, 25, { sightHeight: 0.09 })!
    expect(high.drop).toBeLessThan(low.drop - 2)
    // zeroed with the round fired: it crosses the line of sight at the zero whatever the height
    expect(Math.abs(flightAt(m855, undefined, 100, 100, { sightHeight: 0.09 })!.drop)).toBeLessThan(0.05)
  })
})

describe('the hold bar', () => {
  const sfp: ScopeMode = { zoom: 4, zoomMax: 12, fovDeg: 6, reticle: 'r.webp', reticleMrad: 100, tickMrad: 1.2 }
  it('a little longer than the reticle’s marks, which shrink in the view with a second focal plane scope’s zoom', () => {
    expect(tickAt(sfp, 4)).toBeCloseTo(1.2, 6)
    expect(tickAt(sfp, 8)).toBeCloseTo(0.6, 6)
    expect(tickAt({ ...sfp, ffp: true }, 8)).toBeCloseTo(1.2, 6)
    // 1.2 mrad at 100 m is 12 cm; the bar 15.6 cm across
    expect(holdBarHalfCm(1000, 100, 1.2) * 2).toBeCloseTo(15.6, 6)
  })
  it('never a long stripe (owner, 24.11.2026: «не такую огромную»): at most 3 % of the view, at least 1 %; without known marks 1.8 %', () => {
    expect(holdBarHalfCm(100, 100, 30) * 2).toBeCloseTo(3, 6)
    expect(holdBarHalfCm(1000, 100, 0.01) * 2).toBeCloseTo(10, 6)
    expect(holdBarHalfCm(1000, 100) * 2).toBeCloseTo(18, 6)
  })
})

describe('a first focal plane reticle on steps of magnification (owner, 24.11.2026: «где сетка в первой фокальной плоскости… должно работать правильно»)', () => {
  const ffp: ScopeMode = { zoom: 1, zoomMax: 8, fovDeg: 30, ffp: true, reticle: 'low.webp', reticleMrad: 535, reticleMax: 'max.webp', reticleMaxMrad: 65,
    reticleSteps: [{ zoom: 1, file: 'z0.webp', mrad: 535 }, { zoom: 1.5, file: 'z1.webp', mrad: 357 }, { zoom: 2.25, file: 'z2.webp', mrad: 238 }, { zoom: 3.4, file: 'z3.webp', mrad: 158 }, { zoom: 5.1, file: 'z4.webp', mrad: 105 }, { zoom: 8, file: 'z5.webp', mrad: 65 }] }
  it('the step at or below the magnification: its picture covers the whole view', () => {
    expect(reticleAt(ffp, 1).file).toBe('z0.webp')
    expect(reticleAt(ffp, 3).file).toBe('z2.webp')
    expect(reticleAt(ffp, 3.4).file).toBe('z3.webp')
    expect(reticleAt(ffp, 8).file).toBe('z5.webp')
    // at ×3 the view is 535 / 3 ≈ 178 mrad wide: the ×2.25 picture's 238 mrad covers it, the old high-zoom one's 65 mrad did not
    expect(reticleAt(ffp, 3).mrad!).toBeGreaterThan(535 / 3)
  })
  it('a second focal plane reticle keeps its one picture', () => {
    expect(reticleAt({ ...ffp, ffp: false }, 3).file).toBe('low.webp')
  })
})
