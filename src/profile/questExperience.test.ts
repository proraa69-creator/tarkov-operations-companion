import { describe, expect, it } from 'vitest'
import { experienceAtLevel, levelProvenByQuests, levelWithQuestExperience } from './questExperience'
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

  it('the player\'s own entry is raised the same way, from the start of its level', () => {
    const typed = { level: 2, observedAt: '2026-10-13T18:00:00.000Z', source: 'manual' as const }
    // 1000 + 9000 = 10 000: level 4; «a», handed in before the entry, is in it already
    expect(levelWithQuestExperience(typed, { a: done('a', '2026-10-13T17:00:00.000Z'), b: done('b', '2026-10-13T18:20:00.000Z') }, quests)).toBe(4)
  })
})

/** Owner, 27.11.2026: «нижняя граница уровня по квестам» — no public profile, the game's screen not read. */
describe('the level the completed quests prove, while nothing has the mode\'s level', () => {
  const quests = [
    { id: 'first', level: 1, experience: 3000 },
    { id: 'shooter', level: 15, experience: 500 },
    { id: 'courier', level: 2, experience: 9000 },
    { id: 'late', level: 30, experience: 20_000 },
    // «Новое начало»: given at prestige 0 from level 55; the prestige it leads to starts the level again
    { id: 'new-beginning', level: 55, experience: 0, prestige: 0 },
  ]
  const active = (taskId: string): TaskProgressRecord => ({ taskId, status: 'active', source: 'eft-log', updatedAt: '2026-11-27T10:00:00.000Z' })

  it('is 1 without a completed quest', () => {
    expect(levelProvenByQuests({}, quests)).toBe(1)
    expect(levelProvenByQuests({ late: active('late') }, quests)).toBe(1)
  })

  it('takes the highest level a completed quest asks for', () => {
    // 3000 + 500 = 3500: level 2 by experience, 15 by «shooter»'s level
    expect(levelProvenByQuests({ first: done('first', '2026-11-27T09:00:00.000Z'), shooter: done('shooter', '2026-11-27T09:10:00.000Z') }, quests)).toBe(15)
  })

  it('or the level the experience of all of them reaches from nothing, when it is higher', () => {
    // 3000 + 9000 = 12 000: level 4 (8 432), not 5 (14 256); the quests ask for 2 at most
    expect(levelProvenByQuests({ first: done('first', '2026-11-27T09:00:00.000Z'), courier: done('courier', '2026-11-27T09:20:00.000Z') }, quests)).toBe(4)
  })

  it('counts every completion the mode shows, the player\'s marks too; not taken, failed, unknown or prestige quests', () => {
    const progress: Record<string, TaskProgressRecord> = {
      shooter: done('shooter', '2026-11-27T09:00:00.000Z', 'manual-fix'),
      late: { taskId: 'late', status: 'failed', source: 'eft-log', updatedAt: '2026-11-27T09:30:00.000Z' },
      'not-in-catalog': done('not-in-catalog', '2026-11-27T09:40:00.000Z'),
      'new-beginning': done('new-beginning', '2026-11-27T09:50:00.000Z'),
    }
    expect(levelProvenByQuests(progress, quests)).toBe(15)
  })
})
