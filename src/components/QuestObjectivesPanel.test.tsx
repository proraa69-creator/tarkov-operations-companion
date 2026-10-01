import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import type { LocalProfile, Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { applyObjectiveChange, taskStatusEvents } from '../progression/objectiveProgress'
import { QUEST_OVERRIDES_KEY } from '../progression/questOverrides'
import { AppStateProvider, useAppState } from '../state/AppState'
import { QuestObjectivesPanel } from './QuestObjectivesPanel'

vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { metadata: { source: 'json.tarkov.dev', mode: 'pvp', loadedAt: '2026-10-01T00:00:00.000Z', counts: {}, sourceVersion: 'v2' } } }) }))

const TASK = '5c0d4c12d09282029f539173'
const quest: Quest = {
  id: TASK, name: 'Миротворческая миссия', trader: 'Миротворец', level: 10, kappa: true, description: '', rewards: [], objectives: [],
  objectiveDetails: [
    { id: 'obj-visit', type: 'visit', description: 'Найти блокпост ООН', count: 1 },
    { id: 'obj-shoot', type: 'shoot', description: 'Убить Диких в форме ООН', count: 30 },
  ],
}
const PROFILES_KEY = 'tarkov-operations-profiles-v2'

function seed(update: (profile: LocalProfile) => LocalProfile = (profile) => profile) {
  const profile = update(createLocalProfile('Operator', 'p-objectives'))
  localStorage.setItem(PROFILES_KEY, JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
}

const probe: { current?: ReturnType<typeof useAppState> } = {}
function Probe() {
  const state = useAppState()
  useEffect(() => { probe.current = state })
  return null
}

function renderPanel() {
  return render(<LocaleProvider><AppStateProvider><Probe /><QuestObjectivesPanel quest={quest} /></AppStateProvider></LocaleProvider>)
}

afterEach(() => { localStorage.clear(); probe.current = undefined })

describe('QuestObjectivesPanel', () => {
  it('edits counters and checkboxes per mode and records the history', async () => {
    seed()
    const user = userEvent.setup()
    renderPanel()
    expect(screen.getByText('0/30')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Больше' }))
    await user.click(screen.getByRole('button', { name: 'Больше' }))
    expect(screen.getByText('2/30')).toBeInTheDocument()
    await user.click(screen.getByText('Найти блокпост ООН'))
    expect(screen.getByRole('checkbox', { name: /Найти блокпост ООН/ })).toBeChecked()
    const history = screen.getByRole('heading', { name: /История изменений/ }).parentElement!
    expect(within(history).getAllByRole('listitem')).toHaveLength(3)
    // Manual changes are the user's own: no «Отменить».
    expect(within(history).queryByRole('button', { name: /Отменить/ })).toBeNull()
    expect(probe.current!.activeProfile.modes.pvp.objectiveProgress['obj-shoot']).toMatchObject({ current: 2, source: 'manual' })
    expect(probe.current!.activeProfile.modes.pve.objectiveProgress).toEqual({})
  })

  it('undoes an automatic change and asks before a log completion overrides a manual «not done»', async () => {
    seed((profile) => {
      let pvp = applyObjectiveChange(profile.modes.pvp, 'pvp', { objectiveId: 'obj-shoot', taskId: TASK, type: 'shoot', target: 30, current: 8, source: 'ocr', confidence: 0.7, observedAt: '2026-09-30T10:00:00.000Z' }, { eventId: 'ev-ocr-1' }).progress
      pvp = applyObjectiveChange(pvp, 'pvp', { objectiveId: 'obj-shoot', taskId: TASK, type: 'shoot', target: 30, current: 12, source: 'ocr', confidence: 0.7, observedAt: '2026-09-30T11:00:00.000Z' }, { eventId: 'ev-ocr-2' }).progress
      pvp = applyObjectiveChange(pvp, 'pvp', { objectiveId: 'obj-visit', taskId: TASK, type: 'visit', target: 1, current: 0, source: 'manual', confidence: 1, observedAt: '2026-09-30T09:00:00.000Z' }, { eventId: 'ev-man-1' }).progress
      return { ...profile, modes: { ...profile.modes, pvp } }
    })
    const user = userEvent.setup()
    renderPanel()
    expect(screen.getByText('12/30')).toBeInTheDocument()
    const undo = screen.getAllByRole('button', { name: /Отменить/ })
    expect(undo).toHaveLength(2)
    await user.click(undo[0])
    expect(screen.getByText('8/30')).toBeInTheDocument()
    expect(screen.getByText(/отменено/)).toBeInTheDocument()

    // The log reports the quest completed: the manually unchecked objective is asked about, not overwritten.
    const before = probe.current!.activeProfile.modes.pvp.taskProgress
    act(() => probe.current!.applyLogStateForMode('pvp', [{ taskId: TASK, status: 'completed', timestamp: '2026-09-30T12:00:00.000Z' }]))
    expect(taskStatusEvents(before, probe.current!.activeProfile.modes.pvp.taskProgress, 'pvp')).toHaveLength(1)
    // Both objectives the user left «not done» (the visit, and the counter set back by the undo) are asked about.
    const [visitQuestion, shootQuestion] = screen.getAllByRole('alert')
    expect(visitQuestion).toHaveTextContent('Журнал игры подтверждает выполнение задания')
    expect(screen.getByRole('checkbox', { name: /Найти блокпост ООН/ })).not.toBeChecked()
    await user.click(within(visitQuestion).getByRole('button', { name: 'Отметить' }))
    expect(screen.getByRole('checkbox', { name: /Найти блокпост ООН/ })).toBeChecked()
    expect(probe.current!.activeProfile.modes.pvp.objectiveProgress['obj-visit']).toMatchObject({ current: 1, source: 'log' })
    await user.click(within(shootQuestion).getByRole('button', { name: 'Оставить как есть' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('8/30')).toBeInTheDocument()
  })

  it('keeps a note in the override layer and flags it after a catalog update', async () => {
    localStorage.setItem(QUEST_OVERRIDES_KEY, JSON.stringify({ version: 1, overrides: [{ id: 'ov-1', kind: 'objective-note', taskId: TASK, objectiveId: 'obj-shoot', mode: 'all', note: 'Форма в 3-м общежитии', source: 'user', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', catalog: { source: 'json.tarkov.dev', version: 'v1' } }] }))
    seed()
    const user = userEvent.setup()
    renderPanel()
    expect(screen.getByText(/Форма в 3-м общежитии/)).toBeInTheDocument()
    expect(screen.getByText(/записано для прошлой версии данных/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Заметка к цели' })[0])
    await user.type(screen.getByPlaceholderText(/Своя заметка/), 'Блокпост у моста')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('Блокпост у моста')).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem(QUEST_OVERRIDES_KEY)!) as { overrides: Array<{ objectiveId: string; catalog: { version?: string } }> }
    expect(saved.overrides.map((entry) => [entry.objectiveId, entry.catalog.version])).toEqual([['obj-shoot', 'v1'], ['obj-visit', 'v2']])
  })

  it('renders in English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    seed((profile) => ({ ...profile, modes: { ...profile.modes, pvp: applyObjectiveChange(profile.modes.pvp, 'pvp', { objectiveId: 'obj-shoot', taskId: TASK, type: 'shoot', target: 30, current: 5, source: 'ocr', confidence: 0.7, observedAt: '2026-09-30T10:00:00.000Z' }).progress } }))
    renderPanel()
    expect(screen.getByRole('heading', { name: /Objectives/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Change history/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.getAllByText(/screen/).length).toBeGreaterThan(0)
  })
})
