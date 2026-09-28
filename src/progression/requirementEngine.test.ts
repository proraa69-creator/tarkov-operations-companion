import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { calculateAvailability, evaluateTaskAvailability, isCurrentQuest, isCurrentQuestStatus } from './requirementEngine'

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

  it('treats only started account quests as current', () => {
    expect(isCurrentQuestStatus('active')).toBe(true)
    expect(isCurrentQuestStatus('available')).toBe(false)
    expect(isCurrentQuestStatus('completed')).toBe(false)
    expect(isCurrentQuestStatus('locked')).toBe(false)
    expect(isCurrentQuest({ id: 'debut' }, 'active')).toBe(true)
  })

  it('treats a story chapter marked as current as current', () => {
    const progress = createModeProgress()
    progress.taskProgress['story-tour'] = { taskId: 'story-tour', status: 'active', source: 'manual', updatedAt: '2026-09-26T00:00:00.000Z', currentStageIndex: 1 }
    const quest: Quest = {
      id: 'story-tour', kind: 'story', name: 'Тур', trader: 'Глава истории', level: 1, kappa: false,
      description: '', objectives: [], rewards: [],
    }
    const availability = calculateAvailability([quest], progress)
    expect(availability.get('story-tour')?.status).toBe('active')
    expect(isCurrentQuest(quest, availability.get('story-tour')?.status)).toBe(true)
    expect(isCurrentQuest(quest, 'available')).toBe(false)
  })

  it('locks the next quest when only previous ids are known', () => {
    const chained: Quest = {
      id: 'checking', name: 'Проверка', trader: 'Прапор', level: 2, kappa: true,
      description: '', objectives: [], rewards: [], previous: ['debut'],
    }
    const progress = createModeProgress()
    progress.playerLevel = 20
    expect(evaluateTaskAvailability(chained, progress).status).toBe('locked')
    progress.taskProgress.debut = { taskId: 'debut', status: 'completed', source: 'eft-log', updatedAt: '' }
    expect(evaluateTaskAvailability(chained, progress).status).toBe('available')
  })

  it('takes current quests from the logs and story chapters from the story-pane scan', () => {
    const progress = createModeProgress()
    progress.taskProgress.debut = { taskId: 'debut', status: 'active', source: 'eft-log', updatedAt: '2026-09-26T00:00:00.000Z' }
    progress.taskProgress['story-tour'] = { taskId: 'story-tour', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z', currentStageIndex: 4 }
    const availability = calculateAvailability([
      { id: 'debut', name: 'Дебют', trader: 'Прапор', level: 1, kappa: true, description: '', objectives: [], rewards: [] },
      { id: 'story-tour', kind: 'story', name: 'Тур', trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [] },
    ], progress)
    expect(availability.get('debut')?.status).toBe('active')
    expect(isCurrentQuest({ id: 'debut' }, availability.get('debut')?.status)).toBe(true)
    expect(availability.get('story-tour')?.status).toBe('active')
  })

  it('reconstructs mandatory completed prerequisites from a current quest', () => {
    const progress = createModeProgress()
    progress.taskProgress.checking = { taskId: 'checking', status: 'active', source: 'eft-log', updatedAt: '2026-09-26T00:00:00.000Z' }
    const availability = calculateAvailability([
      { id: 'debut', name: 'Дебют', trader: 'Прапор', level: 1, kappa: true, description: '', objectives: [], rewards: [] },
      { id: 'checking', name: 'Проверка', trader: 'Прапор', level: 1, kappa: true, description: '', objectives: [], rewards: [], previous: ['debut'] },
    ], progress)
    expect(availability.get('debut')?.status).toBe('completed')
  })

  it('does not guess which alternative prerequisite was completed', () => {
    const progress = createModeProgress()
    progress.taskProgress.next = { taskId: 'next', status: 'active', source: 'eft-log', updatedAt: '' }
    const alternatives: Quest[] = [
      { id: 'a', name: 'A', trader: 'Тест', level: 1, kappa: false, description: '', objectives: [], rewards: [] },
      { id: 'b', name: 'B', trader: 'Тест', level: 1, kappa: false, description: '', objectives: [], rewards: [] },
      { id: 'next', name: 'Next', trader: 'Тест', level: 1, kappa: false, description: '', objectives: [], rewards: [], requirements: [
        { taskId: 'a', allowedStatuses: ['complete'], group: 'choice' },
        { taskId: 'b', allowedStatuses: ['complete'], group: 'choice' },
      ] },
    ]
    const availability = calculateAvailability(alternatives, progress)
    expect(availability.get('a')?.status).not.toBe('completed')
    expect(availability.get('b')?.status).not.toBe('completed')
  })

  it('does not treat wiki catalog stubs as current', () => {
    const stub: Quest = {
      id: 'wiki:ищеика', name: 'Ищейка', trader: 'Wiki', level: 1, kappa: false,
      description: '', objectives: [], rewards: [],
    }
    expect(evaluateTaskAvailability(stub, createModeProgress()).status).toBe('available')
    expect(isCurrentQuest(stub, 'available')).toBe(false)
    expect(isCurrentQuest(stub, 'active')).toBe(false)
  })
})
