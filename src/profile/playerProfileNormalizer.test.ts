import { describe, expect, it } from 'vitest'
import { levelFromExperience, normalizePlayerProfile } from './playerProfileNormalizer'

const levels = [
  { level: 1, exp: 0 },
  { level: 2, exp: 1000 },
  { level: 3, exp: 3000 },
  { level: 4, exp: 5000 },
]

describe('player profile normalizer', () => {
  it('calculates a level from cumulative experience thresholds', () => {
    expect(levelFromExperience(0, levels)).toBe(1)
    expect(levelFromExperience(3999, levels)).toBe(2)
    expect(levelFromExperience(9000, levels)).toBe(4)
  })

  it('normalizes a public Tarkov.dev profile snapshot', () => {
    expect(normalizePlayerProfile({
      aid: 7690289,
      info: { nickname: 'SHAURMA', experience: 4000, side: 'Bear', prestigeLevel: 1 },
      updated: 1790359091847,
    }, levels, '2026-09-26T00:00:00.000Z')).toMatchObject({
      accountId: 7690289,
      nickname: 'SHAURMA',
      level: 3,
      faction: 'bear',
      prestige: 1,
      fetchedAt: '2026-09-26T00:00:00.000Z',
    })
  })

  it('rejects a profile without a stable id or nickname', () => {
    expect(() => normalizePlayerProfile({ info: {} }, levels)).toThrow(/Некорректный профиль/)
  })
})
