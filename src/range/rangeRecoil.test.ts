import { describe, expect, it } from 'vitest'
import { createRecoil, RECOIL_TICK, weaponRecoil } from './rangeRecoil'
import { seededRandom } from './rangeModel'

/** Full-auto: the barrel's climb sampled as each next bullet leaves (the game's 800 rpm M4A1: a shot every 4.5 ticks). */
function burst(id: string, mods: number, round: number, shots: number, runs: number) {
  const weapon = weaponRecoil(id)!
  const interval = 60 / weapon.fireRate
  const totals = Array.from({ length: shots }, () => ({ up: 0, right: 0, right2: 0, view: 0 }))
  for (let run = 0; run < runs; run++) {
    const sim = createRecoil(weapon, mods, round, seededRandom(run + 1))
    let time = 0, next = 0, fired = 0
    while (fired < shots) {
      if (time >= next - 1e-9) {
        if (fired > 0) {
          const now = sim.read()
          const entry = totals[fired - 1]!
          entry.up += now.bore.up; entry.right += now.bore.right; entry.right2 += now.bore.right ** 2; entry.view += now.view.up
        }
        sim.shot()
        fired += 1
        next += interval
      }
      sim.tick(true)
      time += RECOIL_TICK
    }
  }
  return totals.slice(0, shots - 1).map((entry) => ({ up: entry.up / runs, right: entry.right / runs, spread: Math.sqrt(entry.right2 / runs), view: entry.view / runs }))
}

describe('the game\'s recoil (M4A1 default build, M855, aiming, standing)', () => {
  const m4 = burst('5447a9cd4bdc2dbd208b4567', -0.29, 0, 31, 600)

  it('climbs over the first shots and holds a plateau after the 5th', () => {
    expect(m4[0]!.up).toBeGreaterThan(0.85)
    expect(m4[0]!.up).toBeLessThan(1.2)
    expect(m4[4]!.up).toBeGreaterThan(4.2)
    expect(m4[4]!.up).toBeLessThan(5.2)
    expect(m4[9]!.up).toBeGreaterThan(4.6)
    expect(m4[9]!.up).toBeLessThan(5.7)
    expect(Math.abs(m4[19]!.up - m4[9]!.up)).toBeLessThan(0.5)
  })

  it('spreads to the sides more and more on the plateau, on average straight', () => {
    expect(Math.abs(m4[29]!.right)).toBeLessThan(0.15)
    expect(m4[29]!.spread).toBeGreaterThan(m4[9]!.spread)
  })

  it('a single shot kicks too and settles (owner, 23.11.2026: «нету отдачи в одиночном режиме стрельбы»)', () => {
    const sim = createRecoil(weaponRecoil('5447a9cd4bdc2dbd208b4567')!, -0.29, 0, seededRandom(7), 56)
    sim.shot()
    // the kick waits for the next tick: not at rest before it, or the range stops its ticks and the shot never kicks
    expect(sim.resting()).toBe(false)
    let bore = 0, view = 0, restAt = -1
    for (let tick = 0; tick < 600; tick++) {
      sim.tick(false)
      bore = Math.max(bore, sim.read().bore.up)
      view = Math.max(view, sim.read().view.up)
      if (restAt < 0 && sim.resting()) restAt = tick
    }
    expect(bore).toBeGreaterThan(0.4)
    expect(view).toBeGreaterThan(0.4)
    // back near the aim and still within a few seconds
    expect(restAt).toBeGreaterThan(20)
    expect(restAt).toBeLessThan(400)
    expect(Math.abs(sim.read().bore.up)).toBeLessThan(0.2)
  })

  it('a round with more recoil kicks harder, mods with less recoil softer', () => {
    const hot = burst('5447a9cd4bdc2dbd208b4567', -0.29, 0.15, 6, 300)
    const soft = burst('5447a9cd4bdc2dbd208b4567', -0.45, 0, 6, 300)
    expect(hot[4]!.up).toBeGreaterThan(m4[4]!.up)
    expect(soft[4]!.up).toBeLessThan(m4[4]!.up)
  })
})
