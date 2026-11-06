import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import type { Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AppStateProvider, useAppState } from '../state/AppState'
import { StoryChapterPanel } from './StoryChapterPanel'
import { useState } from 'react'

const chapter = (id: string, order: number, stages: Array<{ title: string; mapIds?: string[] }>) => ({
  id, name: id, normalizedName: id, kind: 'story', trader: 'История', storyOrder: order, level: 0, objectives: [], description: '',
  stages: stages.map((stage, index) => ({ id: `${id}-${index}`, description: '', mapIds: [], ...stage })),
}) as unknown as Quest

const tour = chapter('story-first', 1, [
  { title: 'Поговорить с Терапевтом' },
  { title: 'Выжить на локации Таможня и выйти или посетить Таможню 3 раза', mapIds: ['customs'] },
  { title: 'Передать Лыжнику 5 предметов' },
])
const second = chapter('story-next', 2, [{ title: 'Первый этап второй главы' }])
const quests = [tour, second]

/** The page's part: the panel of the chosen chapter, and the chapter's record as the app keeps it. */
function Harness() {
  const state = useAppState()
  const [selected, setSelected] = useState(tour.id)
  const quest = quests.find((entry) => entry.id === selected)!
  const progress = state.activeProfile.modes[state.raidMode]
  return <>
    <div data-testid="chapter">{selected}</div>
    <div data-testid="record">{JSON.stringify(progress.taskProgress[selected] ? [progress.taskProgress[selected]!.status, progress.taskProgress[selected]!.currentStageIndex] : null)}</div>
    <StoryChapterPanel key={selected} quest={quest} progress={progress} maps={[{ id: 'customs', name: 'Таможня' } as never]} quests={quests} onOpenChapter={setSelected} />
  </>
}

function open() {
  const profile = createLocalProfile('TEST', 'story')
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  return render(<LocaleProvider><AppStateProvider><MemoryRouter><Harness /></MemoryRouter></AppStateProvider></LocaleProvider>)
}
const record = () => screen.getByTestId('record').textContent
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

describe('a story chapter marked by hand', () => {
  beforeEach(() => localStorage.clear())

  it('not started: «Начать главу» opens the stages, a tick and «Ок» put the player there', () => {
    open()
    expect(screen.getByText('Глава не начата')).toBeInTheDocument()
    expect(record()).toBe('null')
    click('Начать главу')
    const dialog = screen.getByRole('dialog', { name: 'На каком вы этапе?' })
    expect(within(dialog).getAllByRole('radio')).toHaveLength(4)
    fireEvent.click(within(dialog).getByRole('radio', { name: /Выжить на локации Таможня/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ок' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(record()).toBe('["active",1]')
    expect(screen.getByText('Этап 2 из 3')).toBeInTheDocument()
  })

  it('either goal opens the way on; until then «Ок»; back returns, and the marks stay', () => {
    open()
    click('Начать главу')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: /Выжить на локации Таможня/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ок' }))
    // Two goals, one of which is enough: a tick, and a counter with plus and minus.
    expect(screen.getByRole('checkbox', { name: /Выжить на локации Таможня и выйти/ })).toBeInTheDocument()
    expect(screen.getByText('0/3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ок' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Перейти на следующий этап' })).toBeNull()
    click('Больше')
    click('Больше')
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ок' })).toBeInTheDocument()
    click('Больше')
    expect(screen.getByText('3/3')).toBeInTheDocument()
    click('Перейти на следующий этап')
    expect(record()).toBe('["active",2]')
    expect(screen.getByText('0/5')).toBeInTheDocument()
    click('Вернуться к прошлому этапу')
    expect(record()).toBe('["active",1]')
    expect(screen.getByText('3/3')).toBeInTheDocument()
  })

  it('going back resets the stages ahead, as far back as the player goes; the stage he stands on keeps its ticks', () => {
    open()
    click('Начать главу')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ок' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Поговорить с Терапевтом' }))
    click('Перейти на следующий этап')
    fireEvent.click(screen.getByRole('checkbox', { name: /Выжить/ }))
    click('Перейти на следующий этап')
    click('Больше')
    click('Больше')
    expect(screen.getByText('2/5')).toBeInTheDocument()
    // Back one stage: the stage left is reset, the one returned to keeps its tick.
    click('Вернуться к прошлому этапу')
    expect(screen.getByRole('checkbox', { name: /Выжить/ })).toBeChecked()
    click('Перейти на следующий этап')
    expect(screen.getByText('0/5')).toBeInTheDocument()
    // Back two stages: both behind the player are clean when he walks forward again.
    click('Вернуться к прошлому этапу')
    click('Вернуться к прошлому этапу')
    expect(screen.getByRole('checkbox', { name: 'Поговорить с Терапевтом' })).toBeChecked()
    click('Перейти на следующий этап')
    expect(screen.getByRole('checkbox', { name: /Выжить/ })).not.toBeChecked()
  })

  it('at the first stage there is nowhere back; the last stage finishes the chapter and moves to the next', () => {
    open()
    click('Начать главу')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ок' }))
    expect(record()).toBe('["active",0]')
    expect(screen.getByRole('button', { name: 'Вернуться к прошлому этапу' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Поговорить с Терапевтом' }))
    click('Перейти на следующий этап')
    fireEvent.click(screen.getByRole('checkbox', { name: /Выжить/ }))
    click('Перейти на следующий этап')
    for (let i = 0; i < 5; i += 1) click('Больше')
    click('Завершить главу')
    expect(screen.getByTestId('chapter')).toHaveTextContent('story-next')
    expect(record()).toBe('["active",0]')
    expect(screen.getByRole('checkbox', { name: 'Первый этап второй главы' })).toBeInTheDocument()
  })

  it('a chapter already finished can be marked from the list, and changed back', () => {
    open()
    click('Начать главу')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Глава уже выполнена' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ок' }))
    expect(screen.getByText('Глава выполнена')).toBeInTheDocument()
    expect(JSON.parse(record()!)[0]).toBe('completed')
    click('Изменить главу')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: /Передать Лыжнику/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ок' }))
    expect(record()).toBe('["active",2]')
  })
})
