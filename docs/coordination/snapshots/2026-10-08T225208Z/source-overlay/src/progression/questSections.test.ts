import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { Quest } from '../domain/types'
import { belongsInQuestSection } from './questSections'

const story: Quest = { id: 'story-tour', kind: 'story', name: 'Тур', trader: '', level: 1, kappa: false, description: '', objectives: [], rewards: [] }
describe('separate account story section', () => {
  it('does not display catalog-only, inferred, completed or other-mode story chapters', () => {
    const progress = createModeProgress()
    expect(belongsInQuestSection(story, progress, 'story')).toBe(false)
    progress.taskProgress[story.id] = { taskId: story.id, status: 'active', source: 'inferred', updatedAt: '' }
    expect(belongsInQuestSection(story, progress, 'story')).toBe(false)
    progress.taskProgress[story.id].source = 'screen-scan'
    expect(belongsInQuestSection(story, progress, 'story')).toBe(false)
    progress.taskProgress[story.id].currentStageIndex = 0
    expect(belongsInQuestSection(story, progress, 'story')).toBe(true)
    expect(belongsInQuestSection(story, createModeProgress(), 'story')).toBe(false)
    progress.taskProgress[story.id].status = 'completed'
    expect(belongsInQuestSection(story, progress, 'story')).toBe(false)
  })
  it('shows an active chapter whose objectives were read from the game even before its stage is known', () => {
    const progress = createModeProgress()
    progress.taskProgress[story.id] = { taskId: story.id, status: 'active', source: 'screen-scan', updatedAt: '' }
    expect(belongsInQuestSection(story, progress, 'story')).toBe(false)
    progress.taskProgress[story.id].storyObjectives = [{ id: 'main:x', text: 'Разузнать у торговцев про упавший самолет', optional: false, completed: false }]
    expect(belongsInQuestSection(story, progress, 'story')).toBe(true)
    progress.taskProgress[story.id].source = 'inferred'
    expect(belongsInQuestSection(story, progress, 'story')).toBe(false)
  })
  it('never duplicates story chapters in current, all, Kappa or completed sections', () => {
    const progress = createModeProgress()
    progress.taskProgress[story.id] = { taskId: story.id, status: 'active', source: 'screen-scan', updatedAt: '', currentStageIndex: 0 }
    for (const section of ['active', 'all', 'kappa', 'completed']) expect(belongsInQuestSection(story, progress, section, 'active')).toBe(false)
  })
  it('keeps ordinary accepted quests in current, not story', () => {
    const quest = { ...story, id: 'ordinary', kind: 'trader' as const }
    const progress = createModeProgress()
    progress.taskProgress[quest.id] = { taskId: quest.id, status: 'active', source: 'eft-log', updatedAt: '' }
    expect(belongsInQuestSection(quest, progress, 'active')).toBe(true)
    expect(belongsInQuestSection(quest, progress, 'story')).toBe(false)
    expect(belongsInQuestSection({ ...quest, storyChapterId: 'tour' }, progress, 'active')).toBe(false)
  })
})
