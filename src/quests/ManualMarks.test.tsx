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
import { MANUAL_MARKS_KEY } from './manualMarksSetting'
import { questAvailabilityOf } from './questReadModel'

const dataset: AppDataset = { ...demoDataset, quests: demoDataset.quests.filter((quest) => quest.kind !== 'story') }
const [FIRST, SECOND] = dataset.quests.map((quest) => quest.id)
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
  it('a compact switch right under the Kappa badge: off by default, its tooltip, remembered on this device', () => {
    const page = renderQuests()
    const toggle = screen.getByRole('switch', { name: 'Ручная отметка' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAttribute('title', 'Если квест не появился или статус неверный из-за ошибки — отметьте вручную.')
    // Right under «Капа: выполнено N из M».
    expect(toggle.previousElementSibling).toHaveTextContent(/Капа: выполнено \d+ из \d+/)
    expect(screen.queryByRole('button', { name: /В текущие/ })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem(MANUAL_MARKS_KEY)).toBe('1')
    page.unmount()
    renderQuests()
    expect(screen.getByRole('switch', { name: 'Ручная отметка' })).toHaveAttribute('aria-checked', 'true')
  })

  it('rows and the quest card offer «В текущие», «Выполнено», «Снять отметку»; a mark shows «вручную» and counts', () => {
    localStorage.setItem(MANUAL_MARKS_KEY, '1')
    renderQuests('ru', `/quests?filter=all&selected=${SECOND}`)
    const card = document.querySelector('.quest-detail')! as HTMLElement
    expect(within(card).getByRole('button', { name: /В текущие/ })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Снять отметку/ })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /Выполнено/ }))
    expect(record(SECOND!)).toMatchObject({ status: 'completed', source: 'manual-fix' })
    expect(within(card).getByText('вручную')).toBeInTheDocument()
    // Counted in «Выполнено».
    expect(completedQuestStats(dataset.quests, questAvailabilityOf(dataset.quests, pvp())).completed).toBe(1)
    // The row of the list shows the tag and the actions too.
    const rows = [...document.querySelectorAll('.quest-catalog-card')] as HTMLElement[]
    expect(rows.some((row) => within(row).queryByText('вручную'))).toBe(true)
    // «Снять отметку»: back to what the other sources say (nothing for this quest).
    fireEvent.click(within(card).getByRole('button', { name: /Снять отметку/ }))
    expect(record(SECOND!)).toBeUndefined()
    expect(pvp().questInputs!.manual[SECOND!]).toMatchObject({ status: 'cleared' })
  })

  it('against the logs: a mark beats an older log event, a newer log event beats the mark', () => {
    localStorage.setItem(MANUAL_MARKS_KEY, '1')
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
    localStorage.setItem(MANUAL_MARKS_KEY, '1')
    renderQuests('en', `/quests?filter=all&selected=${SECOND}`)
    const toggle = screen.getByRole('switch', { name: 'Manual marks' })
    expect(toggle).toHaveAttribute('title', 'If a quest did not appear or its status is wrong because of a bug, mark it by hand.')
    const card = document.querySelector('.quest-detail')! as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /To current/ }))
    expect(record(SECOND!)).toMatchObject({ status: 'active', source: 'manual-fix' })
    expect(within(card).getByText('manual')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Remove mark/ })).toBeInTheDocument()
  })
})
