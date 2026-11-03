import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { questAppliesToMap } from './questLocation'
import { currentStoryStageIndex } from './requirementEngine'

const tour = applyCuratedStoryStages([{ id: 'story-tour', kind: 'story', name: 'Тур', trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [], stages: [] }])[0]!

// Owner, 31.10.2026: the game and «Квесты» showed «Найти вход в портовый Терминал», the map put «Тур» on Эпицентр.
describe('the story stage the maps follow', () => {
  const progress = (currentStageIndex: number | undefined, stageIndex: number, completed = false) => ({
    ...createModeProgress(),
    taskProgress: { 'story-tour': { taskId: 'story-tour', status: 'active' as const, source: 'screen-scan' as const, updatedAt: '2026-10-31T00:00:00.000Z', currentStageIndex,
      storyObjectives: [{ id: 'o1', text: 'Найти вход в портовый Терминал', optional: false, completed, stageIndex }] } },
  })

  it('follows the open objective the game shows when it is further on than the saved stage', () => {
    const shown = progress(0, 15)
    expect(currentStoryStageIndex(tour, shown)).toBe(15)
    expect(questAppliesToMap(tour, 'shoreline', currentStoryStageIndex(tour, shown))).toBe(true)
    expect(questAppliesToMap(tour, 'ground-zero', currentStoryStageIndex(tour, shown))).toBe(false)
  })

  it('never goes back from the saved stage, and a finished objective does not count', () => {
    expect(currentStoryStageIndex(tour, progress(17, 15))).toBe(17)
    expect(currentStoryStageIndex(tour, progress(0, 15, true))).toBe(0)
    expect(currentStoryStageIndex(tour, progress(undefined, 15))).toBe(15)
  })
})
