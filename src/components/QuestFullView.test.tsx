import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { demoDataset } from '../data/demo'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AppStateProvider } from '../state/AppState'
import type { Quest } from '../domain/types'

vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: demoDataset }) }))
const { QuestFullView } = await import('./QuestFullView')

describe('trader quest view', () => {
  it('links nowhere outside the app and says plainly when no rewards are known (owner, 12.10.2026: no wiki anywhere)', () => {
    const quest = { ...demoDataset.quests[0]!, rewards: [], wikiLink: 'https://escapefromtarkov.fandom.com/wiki/Gratitude' } as Quest
    const { container } = render(<LocaleProvider><AppStateProvider><MemoryRouter><QuestFullView quest={quest} availability={new Map()} onOpenQuest={() => {}} /></MemoryRouter></AppStateProvider></LocaleProvider>)
    expect(screen.getByText('Награды не указаны.')).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/wiki|вики/i)
    expect(container.querySelector('a[href^="http"]')).toBeNull()
  })
})
