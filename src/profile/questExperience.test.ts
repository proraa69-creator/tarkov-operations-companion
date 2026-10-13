import { describe, expect, it } from 'vitest'
import { experienceAtLevel, levelWithQuestExperience } from './questExperience'
import type { TaskProgressRecord } from '../domain/types'

const done = (taskId: string, updatedAt: string, source: TaskProgressRecord['source'] = 'eft-log'): TaskProgressRecord => ({ taskId, status: 'completed', source, updatedAt })

describe('quest experience after the level was read', () => {
  const quests = [{ id: 'a', experience: 3000 }, { id: 'b', experience: 9000 }, { id: 'c', experience: 500 }]
  const screen = { level: 2, observedAt: '2026-10-13T18:00:00.000Z', source: 'screen' as const }

  it('counts from the start of the level the screen showed: the level the player has at least', () => {
    expect(experienceAtLevel(1)).toBe(0)
    expect(experienceAtLevel(2)).toBe(1000)
    expect(experienceAtLevel(3)).toBe(4017)
    // 1000 + 3000 = 4000 < 4017: still level 2.
    expect(levelWithQuestExperience(screen, { a: done('a', '2026-10-13T18:10:00.000Z') }, quests)).toBe(2)
    // 1000 + 3000 + 9000 = 13000: level 4 (8432) but not 5 (14256).
    expect(levelWithQuestExperience(screen, { a: done('a', '2026-10-13T18:10:00.000Z'), b: done('b', '2026-10-13T18:20:00.000Z') }, quests)).toBe(4)
  })

  it('only quests the logs show completed after the reading count', () => {
    const progress = {
      a: done('a', '2026-10-13T17:59:00.000Z'),
      b: done('b', '2026-10-13T18:20:00.000Z', 'screen-scan'),
      c: { taskId: 'c', status: 'active' as const, source: 'eft-log' as const, updatedAt: '2026-10-13T18:30:00.000Z' },
    }
    expect(levelWithQuestExperience(screen, progress, quests)).toBe(2)
  })

  it('Tarkov.dev\'s exact experience is the start when it matches its level', () => {
    const anchor = { level: 2, observedAt: '2026-10-13T18:00:00.000Z', source: 'tarkov-dev' as const, experience: 3900 }
    // 3900 + 500 = 4400 ≥ 4017: level 3 (counting from the start of level 2 it would still be 2).
    expect(levelWithQuestExperience(anchor, { c: done('c', '2026-10-13T18:05:00.000Z') }, quests)).toBe(3)
  })
})
