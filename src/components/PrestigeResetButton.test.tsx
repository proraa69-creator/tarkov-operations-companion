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

const openWipePrestige = (name = 'Вайп / Престиж') => fireEvent.click(screen.getByRole('button', { name }))
/** «Вайп / Престиж» → the mode → «Вайп» or the prestige → «Сбросить». */
function press(mode: string, choice: string) {
  openWipePrestige()
  fireEvent.click(screen.getByRole('button', { name: mode }))
  fireEvent.click(screen.getByRole('option', { name: choice }))
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
}

// Owner, 04.11.2026: «Сделай Вайп Престиж не отдельными кнопками, а одной, просто через дробь».
describe('«Вайп / Престиж»', () => {
  it('is one button, «Сброс» under it', () => {
    mount('ru')
    const buttons = screen.getAllByRole('button').filter((button) => button.closest('.mode-reset-buttons'))
    expect(buttons.map((button) => button.textContent)).toEqual(['Вайп / Престиж', 'Сброс'])
  })

  it('asks the mode, then a wipe or the new prestige: nothing chosen, «Сбросить» disabled until one is', () => {
    mount('ru')
    openWipePrestige()
    expect(screen.getByRole('alertdialog').textContent).toContain('В каком режиме?')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getAllByRole('button').filter((button) => button.classList.contains('prestige-mode-button')).map((button) => button.textContent)).toEqual(['PvP', 'PvE', 'Сезон'])
    fireEvent.click(screen.getByRole('button', { name: 'PvE' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Режим PvE: весь прогресс этого режима будет удалён, и вы начнёте заново. Старые журналы игры больше не учитываются: квесты появятся, когда вы возьмёте их в игре.')
    const list = within(dialog).getByRole('listbox')
    const rows = within(list).getAllByRole('option')
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Вайп', ...Array.from({ length: 6 }, (_, index) => `Престиж ${index + 1}`)])
    expect(rows[0]).toHaveProperty('textContent', 'Вайппрестиж останется')
    // Only the badge: no text in a prestige's row; each level its own badge, the game's PvE pictures where the owner sent them.
    const badges = rows.slice(1)
    for (const row of badges) {
      expect(row.textContent).toBe('')
      expect(row.querySelectorAll('svg, img')).toHaveLength(1)
    }
    expect(new Set(badges.map((row) => row.innerHTML)).size).toBe(6)
    expect((badges[0]!.querySelector('img') as HTMLImageElement).dataset.mode).toBe('pve')
    expect(rows.every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true)
    const reset = within(dialog).getByRole('button', { name: 'Сбросить' })
    expect(reset).toHaveProperty('disabled', true)
    fireEvent.click(reset)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(done('pve')).toBe(true)
    fireEvent.click(badges[2]!)
    expect(badges[2]!.getAttribute('aria-selected')).toBe('true')
    expect(reset).toHaveProperty('disabled', false)
    // «Отмена» changes nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, true, true])
    expect(pve().logResetAt).toBeUndefined()
    // Reopened: the mode is asked again and nothing is chosen. Escape cancels too.
    openWipePrestige()
    fireEvent.click(screen.getByRole('button', { name: 'PvE' }))
    expect(screen.getAllByRole('option').every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('a prestige resets the chosen mode only, stores the prestige as the player\'s own and shows it', () => {
    mount('ru')
    expect(screen.getByText('Без престижа')).toBeTruthy()
    expect(screen.queryByTestId('sidebar-prestige')).toBeNull()
    press('PvE', 'Престиж 4')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, false, true])
    // The press is the floor (owner, 04.11.2026: «он все проходит заново»).
    expect(pve()).toMatchObject({ prestige: 4, prestigeSetAt: pve().logResetAt })
    expect(pve().resetMarker).toBeUndefined()
    expect(pve().modeResetAt).toBeUndefined()
    expect(screen.getByRole('status').textContent).toContain('Престиж — прогресс режима PvE сброшен, квесты начнутся заново')
    expect(screen.queryByText(/Ожидаем престиж/)).toBeNull()
    // «Престиж 4» with its icon in «Текущий профиль», and the sidebar's icon with its tooltip.
    expect(screen.getByTestId('profile-prestige').textContent).toBe('Престиж 4')
    expect(screen.getByTestId('sidebar-prestige').getAttribute('title')).toBe('Престиж 4')
    // Stored: it survives a restart.
    const stored = JSON.parse(localStorage.getItem('tarkov-operations-profiles-v2')!) as { profiles: unknown[] }
    expect(migrateProfile(stored.profiles[0])!.modes.pve.prestige).toBe(4)
  })

  it('a later game reading may raise the player\'s prestige, never lower it; friends get it with the level', () => {
    mount('ru')
    press('PvE', 'Престиж 2')
    const profile = probe.current!.activeProfile
    const at = pve().logResetAt!
    const later = new Date(Date.parse(at) + 60_000).toISOString()
    const snapshot = (prestige: number): PlayerProfileSnapshot => ({ accountId: 1, nickname: 'Raid_OS', level: 3, experience: 0, faction: 'bear', prestige, fetchedAt: later, upstreamUpdatedAt: later } as PlayerProfileSnapshot)
    expect(applyPlayerSnapshot(profile, 'pve', snapshot(1)).modes.pve.prestige).toBe(2)
    expect(applyPlayerSnapshot(profile, 'pve', snapshot(3)).modes.pve.prestige).toBe(3)
    // Shared through PUT /v1/me/levels: the level the mode starts again at and the chosen prestige.
    expect(sharedLevelsOf(profile.modes).pve).toEqual({ level: 1, prestige: 2, observedAt: at })
    // A mode without a known level or prestige is not sent.
    expect(sharedLevelsOf(profile.modes).pvp).toBeUndefined()
  })

  it('a wipe resets the chosen mode only, the press is the floor, and keeps the prestige (a game wipe keeps it)', () => {
    mount('ru', 'pve', 3)
    expect(screen.getByTestId('sidebar-prestige').getAttribute('title')).toBe('Престиж 3')
    press('PvE', 'Вайп')
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, false, true])
    expect(pve()).toMatchObject({ prestige: 3 })
    expect(pve().resetMarker).toBeUndefined()
    expect(pve().modeResetAt).toBeUndefined()
    expect(pve().logResetAt).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Вайп — прогресс режима PvE сброшен, квесты начнутся заново')
  })

  it('Season has no prestige: it asks nothing more, and it is a wipe', () => {
    mount('ru', 'pve', 3)
    openWipePrestige()
    fireEvent.click(screen.getByRole('button', { name: 'Сезон' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    const reset = screen.getByRole('button', { name: 'Сбросить' })
    expect(reset).toHaveProperty('disabled', false)
    fireEvent.click(reset)
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, true, false])
    expect(probe.current!.activeProfile.modes.seasonal.prestige).toBe(3)
    expect(screen.getByRole('status').textContent).toContain('Вайп — прогресс режима Сезон сброшен')
  })

  it('in English: the mode chosen in the dialog is reset, whatever mode the app shows', () => {
    mount('en', 'seasonal')
    openWipePrestige('Wipe / Prestige')
    expect(screen.getByRole('alertdialog').textContent).toContain('Which mode?')
    fireEvent.click(screen.getByRole('button', { name: 'PvP' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('PvP: all progress of this mode will be deleted and you start over. Old game logs no longer count: quests appear as you take them in the game.')
    expect(screen.getAllByRole('option').slice(0, 2).map((row) => row.getAttribute('aria-label'))).toEqual(['Wipe', 'Prestige 1'])
    // «Back» returns to the mode choice.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'PvP' }))
    fireEvent.click(screen.getByRole('option', { name: 'Prestige 1' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset' }))
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([false, true, true])
    expect(screen.getByRole('status').textContent).toContain('Prestige — PvP progress was reset, quests start over')
    expect(probe.current!.activeProfile.modes.pvp.prestige).toBe(1)
  })
})

describe('«Сброс» (owner, 15.10.2026: «сделай эту в отдельную кнопку сброс»)', () => {
  it('asks; «Сбросить и найти заново» wipes the mode, takes away the floor an earlier press set, and keeps the prestige', () => {
    mount('ru', 'pve', 2)
    press('PvE', 'Вайп')
    expect(pve().logResetAt).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Сброс режима PvE: прогресс этого режима будет удалён и сразу найден заново по всем журналам игры. Используйте, если квесты отображаются неправильно. Также очистятся избранное (оно общее для всех режимов), отслеживаемые квесты, список на рейд и отложенные квесты. Прогресс других режимов не изменится.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(pve().logResetAt).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить и найти заново' }))
    expect(pve().logResetAt).toBeUndefined()
    expect(pve().prestige).toBe(2)
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, false, true])
    expect(screen.getAllByRole('status').at(-1)!.textContent).toContain('Прогресс режима PvE найден заново по журналам')
  })

  it('in English', () => {
    mount('en', 'seasonal')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Reset of Season: this mode\'s progress will be deleted and found again at once from all game logs. Use it if quests are shown wrong. Favourites (shared by all modes), tracked quests, the raid list and deferred quests are cleared too. Progress of other modes will not change.')
    fireEvent.click(screen.getByRole('button', { name: 'Reset and find again' }))
    expect(screen.getByRole('status').textContent).toContain('Season progress found again from the logs')
  })
})
