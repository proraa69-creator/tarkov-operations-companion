import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { addMissingStoryChapters, applyCuratedStoryStages } from '../data/storyChapters'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { QuestsPage } from './QuestsPage'

// The base as the server builds it: the trader tasks and all ten story chapters.
const dataset: AppDataset = {
  ...demoDataset,
  quests: applyCuratedStoryStages(addMissingStoryChapters(demoDataset.quests.filter((quest) => quest.kind !== 'story'))),
}

function renderQuests(path: string, locale: 'ru' | 'en' = 'ru') {
  // Only «Небеса в огне» is reached in this mode, at stage 8 (the flight recorder on Woods).
  let profile = createLocalProfile('TEST', 'story')
  profile = setTaskProgress(profile, 'pvp', { taskId: 'story-falling-skies', status: 'active', source: 'screen-scan', updatedAt: '2026-10-14T10:00:00.000Z', currentStageIndex: 7 })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[path]}><QuestsPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => setRenderLanguage('ru'))

describe('«Показать все» of the story tab', () => {
  it('is at the end of «Главы истории» on the story tab only', () => {
    const story = renderQuests('/quests?filter=story')
    const button = screen.getByTestId('story-show-all')
    expect(button).toHaveTextContent('Показать все')
    expect(button.closest('.panel')).toHaveTextContent('Главы истории')
    story.unmount()
    for (const filter of ['', '?filter=completed', '?filter=all', '?filter=chronology']) {
      const page = renderQuests(`/quests${filter}`)
      expect(screen.queryByTestId('story-show-all'), filter).toBeNull()
      page.unmount()
    }
  })

  it('opens every chapter of the base, the ones not reached too, with their stages, items, rewards and a way back', () => {
    const { container } = renderQuests('/quests?filter=story')
    // the story list itself shows only the chapter the player has
    expect(container.querySelectorAll('.quest-catalog-card')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('story-show-all'))
    const view = screen.getByTestId('story-all')
    const chapters = [...view.querySelectorAll('.story-all-chapter')].map((chapter) => chapter.getAttribute('data-chapter'))
    expect(chapters).toEqual(['tour', 'falling-skies', 'batya', 'the-unheard', 'blue-fire', 'they-are-already-here', 'accidental-witness', 'the-labyrinth', 'the-ticket', 'boreas'])
    const boreas = view.querySelector('[data-chapter="boreas"]') as HTMLElement
    expect(within(boreas).getByText('Глава не начата')).toBeInTheDocument()
    expect(within(boreas).getAllByText('Прибыть на ледокол', { selector: '.story-all-objective-text', exact: false }).length).toBeGreaterThan(0)
    const fallingSkies = view.querySelector('[data-chapter="falling-skies"]') as HTMLElement
    expect(within(fallingSkies).getByText('Глава в процессе')).toBeInTheDocument()
    // the current stage, an item to hand over with its count, a reward
    expect(fallingSkies.querySelector('.story-all-objective.is-current')).toHaveTextContent('Забрать бортовой самописец самолёта')
    expect(within(fallingSkies).getByText(/Аккумуляторная батарея ×3/)).toBeInTheDocument()
    expect(within(fallingSkies).getByText('Решение: оставить бронированный кейс себе')).toBeInTheDocument()
    // back to the list
    fireEvent.click(within(view).getByRole('button', { name: /Назад к главам/ }))
    expect(screen.queryByTestId('story-all')).toBeNull()
    expect(screen.getByTestId('story-show-all')).toBeInTheDocument()
  })

  it('opens a stage\'s point on the Maps page the way the quest card does', () => {
    renderQuests('/quests?filter=story&all=1')
    const fallingSkies = screen.getByTestId('story-all').querySelector('[data-chapter="falling-skies"]') as HTMLElement
    const recorder = fallingSkies.querySelector('[data-stage="7"]') as HTMLElement
    expect(within(recorder).getByRole('link', { name: /Показать на карте · Лес/ })).toHaveAttribute('href', '/maps/woods?quest=story-falling-skies&stage=7')
    // an objective without a map has no map button
    expect(fallingSkies.querySelector('[data-stage="1"] [data-map-link]')).toBeNull()
  })

  it('finds objectives and items by the search', () => {
    renderQuests('/quests?filter=story&all=1')
    fireEvent.change(screen.getByPlaceholderText('Поиск по главам, задачам и предметам…'), { target: { value: 'ледокол' } })
    const shown = [...screen.getByTestId('story-all').querySelectorAll('.story-all-chapter')].map((chapter) => chapter.getAttribute('data-chapter'))
    expect(shown).toEqual(['boreas'])
  })

  it('is complete in English, with the same chapters', () => {
    renderQuests('/quests?filter=story', 'en')
    expect(screen.getByTestId('story-show-all')).toHaveTextContent('Show all')
    fireEvent.click(screen.getByTestId('story-show-all'))
    const view = screen.getByTestId('story-all')
    expect(screen.queryByTestId('story-show-all')).toBeNull()
    expect(view).toHaveTextContent('All story chapters')
    expect(view.querySelectorAll('.story-all-chapter')).toHaveLength(10)
    const fallingSkies = view.querySelector('[data-chapter="falling-skies"]') as HTMLElement
    expect(within(fallingSkies).getByRole('heading', { name: 'Falling Skies' })).toBeInTheDocument()
    expect(within(fallingSkies).getByText('Chapter in progress')).toBeInTheDocument()
    expect(fallingSkies.querySelector('.story-all-objective.is-current')).toHaveTextContent('Retrieve the plane\'s flight recorder')
    expect(within(fallingSkies).getByText(/Rechargeable battery ×3/)).toBeInTheDocument()
    expect(within(fallingSkies).getByText('How to unlock')).toBeInTheDocument()
    // no Russian left in the chapter's own texts
    for (const node of fallingSkies.querySelectorAll('.story-all-objective-text, .story-all-steps li, .story-all-item strong, .story-all-reward p, h4')) {
      expect(/[А-Яа-яЁё]/.test(node.textContent ?? ''), node.textContent ?? '').toBe(false)
    }
  })
})
