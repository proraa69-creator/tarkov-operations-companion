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

  it('never offers a task the game opens by its own conditions until the logs have it (owner, 12.10.2026)', () => {
    // «Оружейник. АКС-74Н»: no level, no task before it, but a hidden counter of Mechanic's tasks (and Mechanic may be
    // closed altogether); «Оружейник. MP-133»: a talk with Mechanic
    const aks = { ...quest, id: 'aks-74n', level: 1, requirements: [], gameConditions: ['progress' as const] }
    const mp133 = { ...quest, id: 'mp-133', level: 1, requirements: [], gameConditions: ['dialogue' as const] }
    const progress = createModeProgress()
    expect(evaluateTaskAvailability(aks, progress)).toEqual({ status: 'locked', blockers: ['Откроется в игре по ходу заданий торговца'] })
    expect(evaluateTaskAvailability(mp133, progress).blockers).toEqual(['Откроется после разговора с торговцем в игре'])
    expect(calculateAvailability([aks, mp133], progress).get('aks-74n')?.status).toBe('locked')
    // taken in the game: the logs decide
    progress.taskProgress['aks-74n'] = { taskId: 'aks-74n', status: 'active', source: 'eft-log', updatedAt: '' }
    expect(calculateAvailability([aks, mp133], progress).get('aks-74n')?.status).toBe('active')
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

  it('takes a tarkov.dev quest without requirements at its word, not the wiki chain («Егерь» 11 instead of 2)', () => {
    const progress = createModeProgress()
    progress.taskProgress.scum = { taskId: 'scum', status: 'active', source: 'eft-log', updatedAt: '2026-10-08T00:00:00.000Z' }
    const jaeger = (id: string, previous?: string[]): Quest => ({ id, name: id, trader: 'Егерь', level: 1, kappa: false, description: '',
      objectives: [], rewards: [], requirements: [], ...(previous ? { previous } : {}) })
    // tarkov.dev: «Всей этой швали...» has no requirement; the wiki's «Предыдущий квест» names an old Jaeger chain.
    const availability = calculateAvailability([jaeger('chain-1'), jaeger('chain-2', ['chain-1']), jaeger('scum', ['chain-2'])], progress)
    expect(availability.get('chain-1')?.status).not.toBe('completed')
    expect(availability.get('chain-2')?.status).not.toBe('completed')
    // A quest tarkov.dev does not know (no requirement list at all) still follows its wiki chain.
    const wikiOnly = calculateAvailability([jaeger('chain-1'), { ...jaeger('scum', ['chain-1']), requirements: undefined }], progress)
    expect(wikiOnly.get('chain-1')?.status).toBe('completed')
  })

  describe('«Оружейник» from the logs only (the chain was rebuilt over the old task ids)', () => {
    const at = '2026-10-11T00:00:00.000Z'
    const master = (n: number): Quest => ({ id: `m${n}`, name: `Оружейник - Мастер. Часть ${n}`, trader: 'Механик', level: 40, kappa: true,
      description: '', objectives: [], rewards: [], requirements: n > 1 ? [{ taskId: `m${n - 1}`, allowedStatuses: ['complete'] }] : [] })
    const weapon: Quest = { id: 'mp133', name: 'Оружейник. МР-133', trader: 'Механик', level: 0, kappa: true, description: '', objectives: [], rewards: [], requirements: [] }
    const chain = [weapon, ...[1, 2, 9, 10, 11, 12, 13].map(master)]
    chain[2] = { ...chain[2]!, requirements: [{ taskId: 'm1', allowedStatuses: ['complete'] }] }
    chain[3] = { ...chain[3]!, requirements: [{ taskId: 'm2', allowedStatuses: ['complete'] }] }
    const logged = (records: Record<string, 'active' | 'completed' | 'failed'>) => {
      const progress = createModeProgress()
      progress.playerLevel = 45
      for (const [taskId, status] of Object.entries(records)) progress.taskProgress[taskId] = { taskId, status, source: 'eft-log', updatedAt: at }
      return progress
    }

    it('shows the parts the logs mention, never guesses the rest («Мастер» 10 and 13 taken, 11 locked)', () => {
      const availability = calculateAvailability(chain, logged({ m10: 'active', m13: 'active' }))
      expect(availability.get('m13')?.status).toBe('active')
      expect(availability.get('m10')?.status).toBe('active')
      // the part after a part held right now cannot have been taken since
      expect(availability.get('m11')?.status).toBe('locked')
      // handed in before the oldest log or not: the logs do not say
      expect(availability.get('m12')?.status).toBe('unknown')
      expect(availability.get('m9')?.status).toBe('unknown')
      expect(availability.get('m1')?.status).toBe('unknown')
      expect(availability.get('mp133')?.status).toBe('unknown')
    })

    it('does not infer a part handed in from a later part held', () => {
      const availability = calculateAvailability(chain, logged({ m13: 'active' }))
      for (const id of ['m12', 'm11', 'm10', 'm9', 'm2', 'm1', 'mp133']) expect(availability.get(id)?.status).toBe('unknown')
    })

    it('gives a player whose whole history is in the logs the usual available and locked', () => {
      const availability = calculateAvailability(chain, logged({ mp133: 'completed', m1: 'active' }))
      expect(availability.get('mp133')?.status).toBe('completed')
      expect(availability.get('m1')?.status).toBe('active')
      expect(availability.get('m2')?.status).toBe('locked')
      expect(availability.get('m13')?.status).toBe('locked')
    })

    it('still rebuilds the other traders\' chains from a quest held now', () => {
      const other: Quest = { id: 'next', name: 'Следующее', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [],
        requirements: [{ taskId: 'debut', allowedStatuses: ['complete'] }] }
      const debut: Quest = { ...other, id: 'debut', name: 'Дебют', requirements: [] }
      const availability = calculateAvailability([...chain, debut, other], logged({ next: 'active' }))
      expect(availability.get('debut')?.status).toBe('completed')
      // a history older than the logs: the Gunsmith parts the logs do not mention are unknown, not available
      expect(availability.get('mp133')?.status).toBe('unknown')
    })
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
