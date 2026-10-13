import { describe, expect, it } from 'vitest'
import { BOSS_TACTICS } from './bossTactics'
import { BOSS_TACTICS_EN } from './bossTacticsEn'

const LISTS = ['behavior', 'weakPoints', 'tactics', 'dangers'] as const

describe('«Тактика боя» in English (owner, 13.10.2026)', () => {
  it('has every boss, line for line, without a Russian word left', () => {
    expect(Object.keys(BOSS_TACTICS_EN).sort()).toEqual(BOSS_TACTICS.map((boss) => boss.key).sort())
    for (const boss of BOSS_TACTICS) {
      const en = BOSS_TACTICS_EN[boss.key]!
      for (const list of LISTS) expect(en[list], `${boss.key}.${list}`).toHaveLength(boss[list].length)
      expect(Boolean(en.loot), `${boss.key}.loot`).toBe(Boolean(boss.loot))
      const text = [en.summary, ...LISTS.flatMap((list) => en[list]), en.loot ?? ''].join('\n')
      expect(text, boss.key).not.toMatch(/[А-Яа-яЁё]/)
    }
  })
})
