import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StoryObjectivesPanel } from './StoryObjectivesPanel'
import { createModeProgress } from '../domain/progress'
import type { Quest } from '../domain/types'

describe('story task list', () => {
  it('shows observed tasks without stage numbering and gives each task its own map links', () => {
    const quest: Quest = { id: 'story-test', kind: 'story', name: 'Тур', trader: '', level: 1, kappa: false,
      description: '', objectives: [], rewards: [], stages: [
        { id: 'a', title: 'Найти документы', description: '', mapIds: ['woods', 'customs'] },
        { id: 'b', title: 'Поговорить с Механиком', description: '', mapIds: [] },
      ] }
    const progress = createModeProgress()
    progress.taskProgress[quest.id] = { taskId: quest.id, source: 'screen-scan', status: 'active', updatedAt: '', currentStageIndex: 0,
      storyObjectives: [
        { id: 'a', text: 'Найти документы', optional: false, completed: false, stageIndex: 0 },
        { id: 'b', text: 'Поговорить с Механиком', optional: false, completed: false, stageIndex: 1 },
        { id: 'c', text: 'Получить сведения о выходе', optional: true, completed: false },
      ] }
    render(<MemoryRouter><StoryObjectivesPanel quest={quest} progress={progress} maps={[]} /></MemoryRouter>)
    expect(screen.getByText('Найти документы')).toBeTruthy()
    expect(screen.getByText('Поговорить с Механиком')).toBeTruthy()
    expect(screen.getByText('Получить сведения о выходе')).toBeTruthy()
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/maps/woods?quest=story-test&stage=0', '/maps/customs?quest=story-test&stage=0',
    ])
    expect(screen.queryByText(/этап/i)).toBeNull()
  })
})
