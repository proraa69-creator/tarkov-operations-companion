import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { evaluateTaskAvailability } from './requirementEngine'

const quest: Quest = {
  id: 'next', name: 'Следующее', trader: 'Прапор', level: 5, kappa: true,
  description: '', objectives: [], rewards: [],
  requirements: [{ taskId: 'debut', allowedStatuses: ['complete'] }],
}

describe('task availability', () => {
  it('reports level and prerequisite blockers', () => {
    const result = evaluateTaskAvailability(quest, createModeProgress())
    expect(result.status).toBe('locked')
    expect(result.blockers).toEqual(['Нужен уровень 5', 'Не выполнено предыдущее задание: debut'])
  })

  it('unlocks when all known requirements are satisfied', () => {
    const progress = createModeProgress()
    progress.playerLevel = 5
    progress.taskProgress.debut = { taskId: 'debut', status: 'completed', source: 'manual', updatedAt: '' }
    expect(evaluateTaskAvailability(quest, progress)).toEqual({ status: 'available', blockers: [] })
  })

  it('keeps opposite-faction tasks locked', () => {
    const progress = createModeProgress()
    progress.playerLevel = 5
    progress.faction = 'bear'
    progress.taskProgress.debut = { taskId: 'debut', status: 'completed', source: 'manual', updatedAt: '' }
    expect(evaluateTaskAvailability({ ...quest, faction: 'USEC' }, progress).blockers).toContain('Задание доступно фракции USEC')
  })
})
