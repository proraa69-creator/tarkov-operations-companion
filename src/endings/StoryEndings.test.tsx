import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { StageDecisionHint, StoryDecisionNotes } from './StoryDecisionNotes'
import { StoryEndingsView } from './StoryEndingsView'

const wrap = (node: React.ReactNode) => render(<LocaleProvider><MemoryRouter>{node}</MemoryRouter></LocaleProvider>)

describe('«Концовки» on screen', () => {
  it('shows the case choice, Mr. Kerman\'s offer and the four endings with the way out', () => {
    wrap(<StoryEndingsView mode="pve" />)
    expect(screen.getByText('Забрать кейс из упавшего самолёта в Лесу')).toBeInTheDocument()
    expect(screen.getByText('Решающий выбор: предложение мистера Кермана')).toBeInTheDocument()
    for (const name of ['«Выживший»', '«Спаситель»', '«Падший»', '«Должник»']) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    // the mode in play: the PvE step of «Спаситель» stays bright, the PvP one is dimmed
    expect(screen.getByText(/не убивая Диких/).closest('li')).not.toHaveClass('is-other-mode')
    expect(screen.getByText(/совместный выход в Лесу/).closest('li')).toHaveClass('is-other-mode')
  })

  it('tells in a chapter which choices decide the ending, and right at the stage where one leads', () => {
    wrap(<><StoryDecisionNotes quest={{ id: 'story-falling-skies', name: 'Небеса в огне', normalizedName: 'falling-skies', kind: 'story', trader: 'Глава истории' }} />
      <StageDecisionHint text="Оставить бронированный кейс себе" /></>)
    expect(screen.getByText('Решающий выбор: бронированный кейс')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Все концовки' })).toHaveAttribute('href', '/quests?filter=endings')
    expect(screen.getAllByText(/Прапор попросит 500кк/).length).toBe(2)
  })

  it('warns on the BTR Driver\'s tasks; other tasks get nothing', () => {
    const { container } = wrap(<><StoryDecisionNotes quest={{ id: 'btr', name: 'Сохранить дистанцию', trader: 'Водитель БТР' }} />
      <StoryDecisionNotes quest={{ id: 'debut', name: 'Дебют', trader: 'Прапор' }} /><StageDecisionHint text="Поговорить с Прапором" /></>)
    expect(screen.getByText(/встав на сторону Лыжника/)).toBeInTheDocument()
    expect(container.querySelectorAll('.story-decisions')).toHaveLength(1)
    expect(container.querySelector('.story-decision-hint')).toBeNull()
  })
})
