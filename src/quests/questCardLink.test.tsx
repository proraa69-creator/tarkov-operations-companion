import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset, Quest } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { addMissingStoryChapters, applyCuratedStoryStages } from '../data/storyChapters'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { QuestsPage } from '../pages/QuestsPage'
import { questCardHref } from './questCardLink'

const quest = (id: string, name: string): Quest => ({ id, name, trader: 'Прапор', traderId: 'prapor', level: 1, kappa: false, description: 'Задание от торговца.', objectives: [], rewards: [], requirements: [] })

// Two trader quests and all the story chapters; one of each is the player's.
const dataset: AppDataset = {
  ...demoDataset,
  quests: applyCuratedStoryStages(addMissingStoryChapters([quest('held', 'Взятый квест'), quest('other', 'Не взятый квест')])),
}

function renderQuests(path: string) {
  let profile = createLocalProfile('TEST', 'card-link')
  profile = setTaskProgress(profile, 'pvp', { taskId: 'held', status: 'active', source: 'eft-log', updatedAt: '2026-11-06T10:00:00.000Z' })
  profile = setTaskProgress(profile, 'pvp', { taskId: 'story-falling-skies', status: 'active', source: 'screen-scan', updatedAt: '2026-11-06T10:00:00.000Z', currentStageIndex: 7 })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  localStorage.setItem('tarkov-operations-locale-v1', 'ru')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[path]}><QuestsPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

const card = () => screen.getByRole('heading', { level: 2 })
const tab = () => screen.getByRole('heading', { level: 1 })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('the address of a quest\'s card', () => {
  it('names the tab that has the quest', () => {
    expect(questCardHref({ id: 'a b' })).toBe('/quests?filter=all&selected=a%20b')
    expect(questCardHref({ id: 'story-tour', kind: 'story' })).toBe('/quests?filter=story&selected=story-tour')
  })

  it('opens a trader quest not taken, with another quest current', () => {
    renderQuests(questCardHref({ id: 'other' }))
    expect(tab()).toHaveTextContent('Все задания')
    expect(card()).toHaveTextContent('Не взятый квест')
  })

  it('opens a taken quest', () => {
    renderQuests(questCardHref({ id: 'held' }))
    expect(card()).toHaveTextContent('Взятый квест')
  })

  it('opens the chapter the player is on', () => {
    renderQuests(questCardHref({ id: 'story-falling-skies', kind: 'story' }))
    expect(tab()).toHaveTextContent('Сюжетные квесты')
    expect(card()).toHaveTextContent('Небеса в огне')
  })

  it('opens a chapter the player has not reached', () => {
    renderQuests(questCardHref({ id: 'story-boreas', kind: 'story' }))
    expect(tab()).toHaveTextContent('Сюжетные квесты')
    expect(card()).toHaveTextContent('Борей')
  })
})

describe('what a chosen quest does not take over', () => {
  it('another tab shows its own quest', () => {
    renderQuests(questCardHref({ id: 'other' }))
    fireEvent.click(screen.getByRole('button', { name: 'Текущие' }))
    expect(card()).toHaveTextContent('Взятый квест')
  })

  it('a search on the story tab shows what it found', () => {
    renderQuests(questCardHref({ id: 'story-boreas', kind: 'story' }))
    fireEvent.change(screen.getByPlaceholderText('Поиск задания…'), { target: { value: 'небеса' } })
    expect(card()).toHaveTextContent('Небеса в огне')
  })

  it('the story tab opens chapters only', () => {
    renderQuests('/quests?filter=story&selected=other')
    expect(card()).not.toHaveTextContent('Не взятый квест')
  })
})
