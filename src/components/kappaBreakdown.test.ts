import { describe, expect, it } from 'vitest'
import type { ModeProgress, Quest, TaskProgressRecord } from '../domain/types'
import { createLocalProfile } from '../domain/progress'
import { calculateAvailability, completedQuestStats } from '../progression/requirementEngine'
import { kappaBreakdown } from './kappaBreakdown'

const quest = (id: string, name: string, level: number, kappa: boolean, requires: string[] = []): Quest => ({
  id, name, trader: 'Прапор', level, kappa, description: '', objectives: [], rewards: [],
  requirements: requires.map((taskId) => ({ taskId, allowedStatuses: ['complete'] })),
})

// Real Kappa chain shape: «Дебют» → «Проверка» → (non-Kappa) «Охота на крыс», which the log shows as accepted.
const kappaQuests: Quest[] = [
  quest('debut', 'Дебют', 1, true),
  quest('checking', 'Проверка', 2, true, ['debut']),
  quest('rat-hunt', 'Охота на крыс', 9, false, ['checking']),
  quest('shortage', 'Дефицит', 3, true),
  quest('sanitary', 'Санитарные нормы', 9, true),
  quest('scanned', 'Секта', 14, true),
  quest('manual', 'Ищейка', 18, true),
  quest('failed', 'Ловушка', 20, true),
  quest('story', 'Тур', 1, true),
]
kappaQuests[kappaQuests.length - 1].kind = 'story'

const record = (taskId: string, status: TaskProgressRecord['status'], source: TaskProgressRecord['source']): TaskProgressRecord => ({ taskId, status, source, updatedAt: '2026-10-08T10:00:00.000Z' })

function kappaProgress(): ModeProgress {
  const progress = createLocalProfile('TEST', 'kappa-breakdown').modes.pvp
  return {
    ...progress,
    taskProgress: {
      'rat-hunt': record('rat-hunt', 'active', 'eft-log'),
      shortage: record('shortage', 'completed', 'eft-log'),
      scanned: record('scanned', 'completed', 'screen-scan'),
      manual: record('manual', 'completed', 'manual'),
      failed: record('failed', 'failed', 'eft-log'),
      // stored chain guesses and imports are not trusted by the engine, so they do not count on their own
      sanitary: record('sanitary', 'completed', 'inferred'),
    },
  }
}

describe('kappaBreakdown', () => {
  it('lists exactly the tasks the card counts, with where «done» came from', () => {
    const progress = kappaProgress()
    const availability = calculateAvailability(kappaQuests, progress)
    const rows = kappaBreakdown(kappaQuests, availability, progress)
    const stats = completedQuestStats(kappaQuests, availability)

    expect(stats).toMatchObject({ kappaCompleted: 5, kappaTotal: 7 })
    expect(rows.filter((row) => row.counted)).toHaveLength(stats.kappaCompleted)
    expect(rows).toHaveLength(stats.kappaTotal)
    expect(rows.map((row) => [row.quest.id, row.counted, row.source, row.via?.id, row.viaStatus])).toEqual([
      ['shortage', true, 'eft-log', undefined, undefined],
      ['scanned', true, 'screen-scan', undefined, undefined],
      ['manual', true, 'manual', undefined, undefined],
      ['debut', true, 'inferred', 'rat-hunt', 'active'],
      ['checking', true, 'inferred', 'rat-hunt', 'active'],
      ['sanitary', false, undefined, undefined, undefined],
      ['failed', false, undefined, undefined, undefined],
    ])
    expect(rows.find((row) => row.quest.id === 'failed')?.status).toBe('failed')
  })

  it('names the nearest later task when several prove the same one', () => {
    const progress = kappaProgress()
    progress.taskProgress.checking = record('checking', 'completed', 'eft-log')
    const availability = calculateAvailability(kappaQuests, progress)
    const debut = kappaBreakdown(kappaQuests, availability, progress).find((row) => row.quest.id === 'debut')
    expect(debut).toMatchObject({ counted: true, source: 'inferred', viaStatus: 'completed' })
    expect(debut?.via?.id).toBe('checking')
  })

  it('counts nothing without trusted records', () => {
    const progress = createLocalProfile('TEST', 'kappa-empty').modes.pvp
    const rows = kappaBreakdown(kappaQuests, calculateAvailability(kappaQuests, progress), progress)
    expect(rows.every((row) => !row.counted && !row.source)).toBe(true)
  })
})
