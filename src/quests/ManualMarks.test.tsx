import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDataset } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { QuestsPage } from '../pages/QuestsPage'
import { completedQuestStats } from '../progression/requirementEngine'
import { AppStateProvider, useAppState } from '../state/AppState'
import { dismissModeResetNotice, useModeResetNotices } from '../state/modeReset'
import { questAvailabilityOf } from './questReadModel'

const dataset: AppDataset = { ...demoDataset, quests: demoDataset.quests.filter((quest) => quest.kind !== 'story') }
const [FIRST, SECOND, THIRD] = dataset.quests.map((quest) => quest.id)
const nameOf = (id: string) => dataset.quests.find((quest) => quest.id === id)!.name
const probe: { app?: ReturnType<typeof useAppState>; notices?: ReturnType<typeof useModeResetNotices> } = {}
function Probe() {
  const app = useAppState()
  const notices = useModeResetNotices()
  useEffect(() => { probe.app = app; probe.notices = notices })
  return null
}
const pvp = () => probe.app!.activeProfile.modes.pvp
const record = (taskId: string) => pvp().taskProgress[taskId]

function renderQuests(locale: 'ru' | 'en' = 'ru', path = '/quests?filter=all') {
  let profile = createLocalProfile('TEST', 'manual')
  // The logs: the first quest taken at 10:00.
  profile = setTaskProgress(profile, 'pvp', { taskId: FIRST!, status: 'active', source: 'eft-log', updatedAt: '2026-10-15T10:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[path]}><Probe /><QuestsPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => {
  setRenderLanguage('ru')
  for (const notice of probe.notices ?? []) act(() => dismissModeResetNotice(notice.id))
})

describe('«Ручная отметка» (owner, 15.10.2026)', () => {
  it('«Ручное добавление» under the Kappa badge: search, tick, «Добавить» — the ticked quests go to «Текущие» as marks (03.11.2026)', () => {
    renderQuests()
    expect(screen.queryByRole('switch', { name: 'Ручная отметка' })).toBeNull()
    const open = screen.getByRole('button', { name: /Ручное добавление/ })
    expect(open.parentElement?.textContent).toMatch(/Капа: выполнено \d+ из \d+/)
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog', { name: 'Ручное добавление' })
    const box = (id: string) => within(dialog).getByText(nameOf(id), { selector: '.manual-add-name' }).closest('label')!.querySelector('input')!
    // The quest the logs already hold is ticked and cannot be added again; nothing ticked yet: nothing to add.
    expect(box(FIRST!)).toBeChecked()
    expect(box(FIRST!)).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Добавить' })).toBeDisabled()
    // The search narrows the list; the ticks stay while it changes.
    const search = within(dialog).getByRole('textbox', { name: 'Поиск квеста…' })
    fireEvent.change(search, { target: { value: nameOf(SECOND!) } })
    expect(within(dialog).queryByText(nameOf(THIRD!), { selector: '.manual-add-name' })).toBeNull()
    fireEvent.click(box(SECOND!))
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(box(THIRD!))
    expect(box(SECOND!)).toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить (2)' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(record(SECOND!)).toMatchObject({ status: 'active', source: 'manual-fix' })
    expect(record(THIRD!)).toMatchObject({ status: 'active', source: 'manual-fix' })
    expect(pvp().questInputs!.manual[SECOND!]).toMatchObject({ status: 'active' })
    // From then on the logs decide: the game hands one in later.
    act(() => probe.app!.applyLogScanForMode('pvp', [{ taskId: SECOND!, status: 'completed', timestamp: new Date(Date.now() + 60_000).toISOString() }], {}))
    expect(record(SECOND!)).toMatchObject({ status: 'completed', source: 'eft-log' })
  })

  it('the quest card offers «В текущие», «Выполнено», «Снять отметку» without any switch; a mark shows «вручную» and counts', () => {
    renderQuests('ru', `/quests?filter=all&selected=${SECOND}`)
    const card = document.querySelector('.quest-detail')! as HTMLElement
    expect(within(card).getByRole('button', { name: /В текущие/ })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Снять отметку/ })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /Выполнено/ }))
    expect(record(SECOND!)).toMatchObject({ status: 'completed', source: 'manual-fix' })
    expect(within(card).getByText('вручную')).toBeInTheDocument()
    // Counted in «Выполнено».
    expect(completedQuestStats(dataset.quests, questAvailabilityOf(dataset.quests, pvp())).completed).toBe(1)
    // The row of the list shows the tag, without the actions.
    const rows = [...document.querySelectorAll('.quest-catalog-card')] as HTMLElement[]
    expect(rows.some((row) => within(row).queryByText('вручную'))).toBe(true)
    expect(rows.every((row) => within(row).queryByRole('button', { name: /В текущие/ }) === null)).toBe(true)
    // «Снять отметку»: back to what the other sources say (nothing for this quest).
    fireEvent.click(within(card).getByRole('button', { name: /Снять отметку/ }))
    expect(record(SECOND!)).toBeUndefined()
    expect(pvp().questInputs!.manual[SECOND!]).toMatchObject({ status: 'cleared' })
  })

  it('against the logs: a mark beats an older log event, a newer log event beats the mark', () => {
    renderQuests()
    // Taken in the logs at 10:00; marked done at 11:00.
    act(() => probe.app!.setManualQuestMark('pvp', FIRST!, 'completed', '2026-10-15T11:00:00.000Z'))
    expect(record(FIRST!)).toMatchObject({ status: 'completed', source: 'manual-fix' })
    // The game logs it failed at 12:00: the logs decide again.
    act(() => probe.app!.applyLogScanForMode('pvp', [{ taskId: FIRST!, status: 'failed', timestamp: '2026-10-15T12:00:00.000Z' }], {}))
    expect(record(FIRST!)).toMatchObject({ status: 'failed', source: 'eft-log' })
    // Another device's newer mark comes through the server.
    act(() => probe.app!.applyRemoteManualMarks('pvp', [{ taskId: FIRST!, status: 'completed', at: '2026-10-15T13:00:00.000Z' }]))
    expect(record(FIRST!)).toMatchObject({ status: 'completed', source: 'manual-fix', updatedAt: '2026-10-15T13:00:00.000Z' })
    // An older one from the server changes nothing.
    act(() => probe.app!.applyRemoteManualMarks('pvp', [{ taskId: FIRST!, status: 'active', at: '2026-10-15T12:30:00.000Z' }]))
    expect(record(FIRST!)?.status).toBe('completed')
  })

  it('«Отменить» in a quest\'s history brings the status back as a mark, and the next run of the engine keeps it (02.11.2026)', () => {
    renderQuests()
    // The logs hand the quest in at 11:00: an automatic change with «Отменить».
    act(() => probe.app!.applyLogScanForMode('pvp', [{ taskId: FIRST!, status: 'completed', timestamp: '2026-10-15T11:00:00.000Z' }], {}))
    expect(record(FIRST!)).toMatchObject({ status: 'completed', source: 'eft-log' })
    const change = pvp().progressEvents.filter((event) => event.eventType === 'task-status' && event.taskId === FIRST && event.newValue === 'completed').at(-1)
    expect(change).toMatchObject({ oldValue: 'active', reversible: true })
    act(() => probe.app!.undoProgressEvent(change!.id))
    expect(record(FIRST!)).toMatchObject({ status: 'active', source: 'manual-fix' })
    expect(pvp().questInputs!.manual[FIRST!]).toMatchObject({ status: 'active' })
    // The same scan again (the next minute): the undo stays.
    act(() => probe.app!.applyLogScanForMode('pvp', [{ taskId: FIRST!, status: 'completed', timestamp: '2026-10-15T11:00:00.000Z' }], {}))
    expect(record(FIRST!)).toMatchObject({ status: 'active', source: 'manual-fix' })
  })

  it('marks the server keeps from the character before this one do not come back (02.11.2026)', () => {
    renderQuests()
    act(() => probe.app!.applyLogScanForMode('pvp', [{ taskId: FIRST!, status: 'active', timestamp: '2026-10-15T10:00:00.000Z' }], { characterId: 'old-character' }))
    // A new character of the mode from 12:00 (the logs' profile changed).
    act(() => probe.app!.applyLogScanForMode('pvp', [{ taskId: SECOND!, status: 'active', timestamp: '2026-10-15T12:30:00.000Z' }], { characterId: 'new-character', characterSince: '2026-10-15T12:00:00.000Z' }))
    const epoch = pvp().logEpochAt
    expect(epoch).toBeTruthy()
    // The server still holds the old character's mark of 11:00, and a mark made after the change.
    act(() => probe.app!.applyRemoteManualMarks('pvp', [
      { taskId: FIRST!, status: 'completed', at: '2026-10-15T11:00:00.000Z' },
      { taskId: SECOND!, status: 'completed', at: '2026-10-15T13:00:00.000Z' },
    ]))
    expect(pvp().questInputs!.manual[FIRST!]).toBeUndefined()
    expect(record(SECOND!)).toMatchObject({ status: 'completed', source: 'manual-fix' })
  })

  it('«Престиж +» and «Вайп» clear the mode\'s marks; other modes keep theirs', () => {
    renderQuests()
    act(() => probe.app!.setManualQuestMark('pvp', SECOND!, 'completed'))
    act(() => probe.app!.setManualQuestMark('pve', SECOND!, 'active'))
    act(() => probe.app!.resetModeProgress('pvp', new Date(Date.now() + 1000).toISOString(), 'wipe'))
    expect(record(SECOND!)).toBeUndefined()
    expect(pvp().questInputs!.manual).toEqual({})
    expect(probe.app!.activeProfile.modes.pve.taskProgress[SECOND!]).toMatchObject({ status: 'active', source: 'manual-fix' })
  })

  it('in English', () => {
    renderQuests('en', `/quests?filter=all&selected=${SECOND}`)
    fireEvent.click(screen.getByRole('button', { name: /Add manually/ }))
    const dialog = screen.getByRole('dialog', { name: 'Add quests manually' })
    expect(within(dialog).getByRole('textbox', { name: 'Search quests…' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const card = document.querySelector('.quest-detail')! as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /To current/ }))
    expect(record(SECOND!)).toMatchObject({ status: 'active', source: 'manual-fix' })
    expect(within(card).getByText('manual')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Remove mark/ })).toBeInTheDocument()
  })
})
