import { describe, expect, it } from 'vitest'
import { experienceAtLevel, levelReachable } from './levelExperience'

describe('the experience between levels (player\'s report, 14.10.2026: PvE 39 shown as 59)', () => {
  it('the table is incremental: level 39 starts at 3 663 831, level 59 at 16 720 667', () => {
    expect([experienceAtLevel(1), experienceAtLevel(2), experienceAtLevel(3)]).toEqual([0, 1000, 4017])
    expect(experienceAtLevel(39)).toBe(3_663_831)
    expect(experienceAtLevel(59)).toBe(16_720_667)
  })

  it('39 to 59 takes 12.7 million experience: no play gives it within two and a half days', () => {
    const screen = { level: 39, observedAt: '2026-10-14T10:00:00.000Z' }
    expect(levelReachable(screen, 59, '2026-10-14T12:00:00.000Z')).toBe(false)
    expect(levelReachable(screen, 59, '2026-10-16T10:00:00.000Z')).toBe(false)
    expect(levelReachable(screen, 59, '2026-10-17T10:00:00.000Z')).toBe(true)
    // A level or two the same evening is ordinary play.
    expect(levelReachable(screen, 40, '2026-10-14T10:01:00.000Z')).toBe(true)
    expect(levelReachable(screen, 41, '2026-10-14T12:00:00.000Z')).toBe(true)
  })

  it('counts from Tarkov.dev\'s exact experience when it has it', () => {
    // 3 700 000 → level 45 (6 102 063): 2.4 million, more than at once, fine two hours later.
    const tarkovDev = { level: 39, observedAt: '2026-10-14T10:00:00.000Z', experience: 3_700_000 }
    expect(levelReachable(tarkovDev, 45, '2026-10-14T10:00:00.000Z')).toBe(false)
    expect(levelReachable(tarkovDev, 45, '2026-10-14T13:00:00.000Z')).toBe(true)
  })

  it('a lower level (prestige, wipe), the last level and unknown times are never refused', () => {
    const screen = { level: 59, observedAt: '2026-10-14T10:00:00.000Z' }
    expect(levelReachable(screen, 1, '2026-10-14T10:05:00.000Z')).toBe(true)
    expect(levelReachable({ level: 79, observedAt: '2026-10-14T10:00:00.000Z' }, 79, '2026-10-14T10:05:00.000Z')).toBe(true)
    expect(levelReachable({ level: 39, observedAt: 'not a time' }, 59, '2026-10-14T10:05:00.000Z')).toBe(true)
  })
})
