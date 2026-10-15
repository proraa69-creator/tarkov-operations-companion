import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import type { Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AppStateProvider } from '../state/AppState'
import { QuestDiagnosticsPanel } from './QuestDiagnosticsPanel'

const [A, B, C] = ['5936d90786f7742b1420ba5b', '5936d90786f7742b1420ba5c', '5936d90786f7742b1420ba5d']
const quests = [
  { id: A, name: 'Сдан по логам', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], requirements: [] },
  { id: B, name: 'Взят', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], requirements: [{ taskId: C, allowedStatuses: ['complete'] }] },
  { id: C, name: 'Раньше логов', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], requirements: [] },
] as unknown as Quest[]
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { quests } }) }))

function mount(locale: 'ru' | 'en', edition?: 'owner') {
  ;(window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop = edition ? { edition } : undefined
  let profile = createLocalProfile('Оператор', 'diag')
  profile.selectedMode = 'pve'
  profile = setTaskProgress(profile, 'pve', { taskId: A, status: 'completed', source: 'eft-log', updatedAt: '2026-10-15T08:00:00.000Z' })
  profile = setTaskProgress(profile, 'pve', { taskId: B, status: 'active', source: 'screen-scan', updatedAt: '2026-10-15T09:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  return render(<LocaleProvider><AppStateProvider><QuestDiagnosticsPanel /></AppStateProvider></LocaleProvider>)
}

beforeEach(() => localStorage.clear())
afterEach(() => { delete (window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop })

describe('«Диагностика квестов»', () => {
  it('players never see it', () => {
    const view = mount('ru')
    expect(view.container.innerHTML).toBe('')
  })

  it('the owner opens it and reads each mode at a glance: what each source gave, proven prerequisites counted, guesses not', () => {
    mount('ru', 'owner')
    expect(screen.queryByText(/логи:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Диагностика квестов/ }))
    const pve = screen.getByTestId('quest-diagnostics').querySelector('[data-mode="pve"]')!
    expect(pve.textContent).toContain('логи: 1 выполнено, требуются для них: +1, экран: +1, вручную: 0, догадка по хронологии: 0 (не считается)')
    expect(pve.textContent).toContain('Считается «Выполнено»2')
    expect(screen.getByTestId('quest-diagnostics').querySelector('[data-mode="pvp"]')!.textContent).toContain('логи: 0 выполнено, требуются для них: +0, экран: +0, вручную: 0, догадка по хронологии: — (не считается)')
  })

  it('in English', () => {
    mount('en', 'owner')
    fireEvent.click(screen.getByRole('button', { name: /Quest diagnostics/ }))
    expect(screen.getByTestId('quest-diagnostics').querySelector('[data-mode="pve"]')!.textContent).toContain('logs: 1 completed, required by them: +1, screen: +1, manual: 0, chronology guess: 0 (not counted)')
  })
})
