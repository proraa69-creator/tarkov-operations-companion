import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPlayerSnapshot, createLocalProfile, migrateProfile } from '../domain/progress'
import type { PlayerProfileSnapshot, RaidMode } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AppStateProvider, useAppState } from '../state/AppState'
import { dismissModeResetNotice, useModeResetNotices } from '../state/modeReset'
import { sharedLevelsOf } from '../squad/useShareLevels'
import { ModeResetToast } from './ModeResetToast'
import { ModeResetButtons, PrestigeLine } from './PrestigeResetButton'
import { SidebarOperator } from './SidebarOperator'

const QUEST = '5936d90786f7742b1420ba5b'
const probe: { current?: ReturnType<typeof useAppState>; notices?: ReturnType<typeof useModeResetNotices> } = {}
function Probe() {
  const value = useAppState()
  const notices = useModeResetNotices()
  useEffect(() => { probe.current = value; probe.notices = notices })
  return null
}
function Shown() {
  const { activeProfile, raidMode } = useAppState()
  return <PrestigeLine level={activeProfile.modes[raidMode].prestige} locale={localStorage.getItem('tarkov-operations-locale-v1') === 'en' ? 'en' : 'ru'} />
}
const done = (mode: RaidMode) => Boolean(probe.current!.activeProfile.modes[mode].taskProgress[QUEST])
const pve = () => probe.current!.activeProfile.modes.pve

function mount(locale: 'ru' | 'en', selectedMode: RaidMode = 'pve', prestige = 0) {
  const profile = createLocalProfile('Оператор', 'local-test')
  profile.selectedMode = selectedMode
  for (const mode of ['pvp', 'pve', 'seasonal'] as RaidMode[]) {
    profile.modes[mode].taskProgress = { [QUEST]: { taskId: QUEST, status: 'completed', source: 'eft-log', updatedAt: '2026-10-01T10:00:00.000Z' } }
    profile.modes[mode].prestige = prestige
  }
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  render(<MemoryRouter><LocaleProvider><AppStateProvider><Probe /><ModeResetButtons /><Shown /><SidebarOperator /><ModeResetToast /></AppStateProvider></LocaleProvider></MemoryRouter>)
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { for (const notice of probe.notices ?? []) act(() => dismissModeResetNotice(notice.id)) })

describe('«Престиж +» (owner, 15.10.2026)', () => {
  it('asks, with a required prestige: rows of icons only, none chosen, «Сбросить» disabled until one is', () => {
    mount('ru')
    fireEvent.click(screen.getByRole('button', { name: 'Престиж +' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Престиж режима PvE: прогресс этого режима будет удалён и найден заново по журналам игры. Когда игра покажет новый профиль после престижа, старые квесты отпадут сами. Другие режимы не изменятся.')
    const list = within(dialog).getByRole('listbox')
    const rows = within(list).getAllByRole('option')
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(Array.from({ length: 10 }, (_, index) => `Престиж ${index + 1}`))
    // Only the icon: no text and no number in a row; each level its own icon.
    for (const row of rows) {
      expect(row.textContent).toBe('')
      expect(row.querySelectorAll('svg')).toHaveLength(1)
    }
    expect(new Set(rows.map((row) => row.innerHTML)).size).toBe(10)
    expect(rows.every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true)
    const reset = within(dialog).getByRole('button', { name: 'Сбросить' })
    expect(reset).toHaveProperty('disabled', true)
    fireEvent.click(reset)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(done('pve')).toBe(true)
    fireEvent.click(rows[2]!)
    expect(rows[2]!.getAttribute('aria-selected')).toBe('true')
    expect(reset).toHaveProperty('disabled', false)
    // «Отмена» changes nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, true, true])
    expect(pve().resetMarker).toBeUndefined()
    // Reopened: nothing chosen again. Escape cancels too.
    fireEvent.click(screen.getByRole('button', { name: 'Престиж +' }))
    expect(screen.getAllByRole('option').every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('«Сбросить» resets the selected mode only, stores the chosen prestige as the player\'s own and shows it', () => {
    mount('ru')
    expect(screen.getByText('Без престижа')).toBeTruthy()
    expect(screen.queryByTestId('sidebar-prestige')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Престиж +' }))
    fireEvent.click(screen.getByRole('option', { name: 'Престиж 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, false, true])
    // No floor at the press: a pending marker the game's own reset in the logs resolves.
    expect(pve()).toMatchObject({ prestige: 4, prestigeSetAt: pve().resetMarker!.at, resetMarker: { kind: 'prestige' } })
    expect(pve().modeResetAt).toBeUndefined()
    expect(screen.getByRole('status').textContent).toContain('Престиж + — прогресс режима PvE найден заново по журналам')
    expect(screen.getByTestId('reset-pending').textContent).toBe('Ожидаем престиж в журналах игры: квесты до него пока учитываются.')
    // «Престиж 4» with its icon in «Текущий профиль», and the sidebar's icon with its tooltip.
    expect(screen.getByTestId('profile-prestige').textContent).toBe('Престиж 4')
    expect(screen.getByTestId('sidebar-prestige').getAttribute('title')).toBe('Престиж 4')
    // Stored: it survives a restart.
    const stored = JSON.parse(localStorage.getItem('tarkov-operations-profiles-v2')!) as { profiles: unknown[] }
    expect(migrateProfile(stored.profiles[0])!.modes.pve.prestige).toBe(4)
  })

  it('a later game reading may raise the player\'s prestige, never lower it; friends get it with the level', () => {
    mount('ru')
    fireEvent.click(screen.getByRole('button', { name: 'Престиж +' }))
    fireEvent.click(screen.getByRole('option', { name: 'Престиж 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    const profile = probe.current!.activeProfile
    const at = pve().resetMarker!.at
    const later = new Date(Date.parse(at) + 60_000).toISOString()
    const snapshot = (prestige: number): PlayerProfileSnapshot => ({ accountId: 1, nickname: 'Raid_OS', level: 3, experience: 0, faction: 'bear', prestige, fetchedAt: later, upstreamUpdatedAt: later } as PlayerProfileSnapshot)
    expect(applyPlayerSnapshot(profile, 'pve', snapshot(1)).modes.pve.prestige).toBe(2)
    expect(applyPlayerSnapshot(profile, 'pve', snapshot(3)).modes.pve.prestige).toBe(3)
    // Shared through PUT /v1/me/levels: the level the mode starts again at and the chosen prestige.
    expect(sharedLevelsOf(profile.modes).pve).toEqual({ level: 1, prestige: 2, observedAt: at })
    // A mode without a known level or prestige is not sent.
    expect(sharedLevelsOf(profile.modes).pvp).toBeUndefined()
  })

  it('in English, for the season', () => {
    mount('en', 'seasonal')
    fireEvent.click(screen.getByRole('button', { name: 'Prestige +' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Prestige of Season: this mode\'s progress will be deleted and found again from the game logs. Once the game shows the new profile after the prestige, the old quests drop out by themselves. Other modes will not change.')
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-label')).toBe('Prestige 1')
    fireEvent.click(screen.getByRole('option', { name: 'Prestige 1' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset' }))
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, true, false])
    expect(screen.getByRole('status').textContent).toContain('Prestige + — Season progress found again from the logs')
    expect(screen.getByTestId('profile-prestige').textContent).toBe('Prestige 1')
    expect(screen.getByTestId('sidebar-prestige').getAttribute('title')).toBe('Prestige 1')
  })
})

describe('«Вайп» (owner, 15.10.2026)', () => {
  it('sits right below «Престиж +», asks, and «Отмена» changes nothing', () => {
    mount('ru', 'pve', 3)
    const buttons = screen.getAllByRole('button').filter((button) => ['Престиж +', 'Вайп', 'Сброс'].includes(button.textContent ?? ''))
    expect(buttons.map((button) => button.textContent)).toEqual(['Престиж +', 'Вайп', 'Сброс'])
    expect(buttons[0]!.parentElement).toBe(buttons[1]!.parentElement)
    fireEvent.click(screen.getByRole('button', { name: 'Вайп' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Вайп режима PvE: прогресс этого режима будет удалён и найден заново по журналам игры. Когда игра покажет новый профиль после вайпа, старые квесты отпадут сами. Другие режимы не изменятся.')
    expect(within(dialog).queryByRole('listbox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(done('pve')).toBe(true)
  })

  it('«Сделать вайп» resets the selected mode only, leaves a pending marker (no floor) and keeps the prestige (a game wipe keeps it)', () => {
    mount('ru', 'pve', 3)
    expect(screen.getByTestId('sidebar-prestige').getAttribute('title')).toBe('Престиж 3')
    fireEvent.click(screen.getByRole('button', { name: 'Вайп' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сделать вайп' }))
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, false, true])
    expect(pve()).toMatchObject({ resetMarker: { kind: 'wipe' }, prestige: 3 })
    expect(pve().modeResetAt).toBeUndefined()
    expect(pve().logResetAt).toBeUndefined()
    expect(screen.getByRole('status').textContent).toContain('Вайп — прогресс режима PvE найден заново по журналам')
  })

  it('in English', () => {
    mount('en', 'pvp')
    fireEvent.click(screen.getByRole('button', { name: 'Wipe' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Wipe of PvP: this mode\'s progress will be deleted and found again from the game logs. Once the game shows the new profile after the wipe, the old quests drop out by themselves. Other modes will not change.')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Wipe' }))
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([false, true, true])
    expect(screen.getByRole('status').textContent).toContain('Wipe — PvP progress found again from the logs')
  })
})

describe('«Сброс» (owner, 15.10.2026: «сделай эту в отдельную кнопку сброс»)', () => {
  it('asks; «Сбросить и найти заново» wipes the mode, clears a pending marker and keeps the prestige', () => {
    mount('ru', 'pve', 2)
    fireEvent.click(screen.getByRole('button', { name: 'Вайп' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сделать вайп' }))
    expect(pve().resetMarker?.kind).toBe('wipe')
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Сброс режима PvE: прогресс этого режима будет удалён и сразу найден заново по всем журналам игры. Используйте, если квесты отображаются неправильно. Другие режимы не изменятся.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(pve().resetMarker?.kind).toBe('wipe')
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить и найти заново' }))
    expect(pve().resetMarker).toBeUndefined()
    expect(pve().prestige).toBe(2)
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, false, true])
    expect(screen.getAllByRole('status').at(-1)!.textContent).toContain('Прогресс режима PvE найден заново по журналам')
    expect(screen.queryByTestId('reset-pending')).toBeNull()
  })

  it('in English', () => {
    mount('en', 'seasonal')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Reset of Season: this mode\'s progress will be deleted and found again at once from all game logs. Use it if quests are shown wrong. Other modes will not change.')
    fireEvent.click(screen.getByRole('button', { name: 'Reset and find again' }))
    expect(screen.getByRole('status').textContent).toContain('Season progress found again from the logs')
  })
})
