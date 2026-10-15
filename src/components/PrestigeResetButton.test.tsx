import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import type { RaidMode } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AppStateProvider, useAppState } from '../state/AppState'
import { dismissModeResetNotice, useModeResetNotices } from '../state/modeReset'
import { ModeResetToast } from './ModeResetToast'
import { PrestigeResetButton } from './PrestigeResetButton'

const QUEST = '5936d90786f7742b1420ba5b'
const probe: { current?: ReturnType<typeof useAppState>; notices?: ReturnType<typeof useModeResetNotices> } = {}
function Probe() {
  const value = useAppState()
  const notices = useModeResetNotices()
  useEffect(() => { probe.current = value; probe.notices = notices })
  return null
}
const done = (mode: RaidMode) => Boolean(probe.current!.activeProfile.modes[mode].taskProgress[QUEST])

function mount(locale: 'ru' | 'en', selectedMode: RaidMode = 'pve') {
  const profile = createLocalProfile('Оператор', 'local-test')
  profile.selectedMode = selectedMode
  for (const mode of ['pvp', 'pve', 'seasonal'] as RaidMode[]) {
    profile.modes[mode].taskProgress = { [QUEST]: { taskId: QUEST, status: 'completed', source: 'eft-log', updatedAt: '2026-10-01T10:00:00.000Z' } }
  }
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  render(<LocaleProvider><AppStateProvider><Probe /><PrestigeResetButton /><ModeResetToast /></AppStateProvider></LocaleProvider>)
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { for (const notice of probe.notices ?? []) act(() => dismissModeResetNotice(notice.id)) })

describe('«Престиж +»', () => {
  it('asks first; «Отмена» changes nothing', () => {
    mount('ru')
    fireEvent.click(screen.getByRole('button', { name: 'Престиж +' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Сбросить весь прогресс режима PvE? Квесты, главы, лояльность и всё остальное этого режима будут удалены. Другие режимы не изменятся.')
    expect(screen.getByRole('button', { name: 'Сбросить' }).className).toContain('danger')
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, true, true])
    expect(probe.current!.activeProfile.modes.pve.modeResetAt).toBeUndefined()
    // Escape and the close button cancel too.
    fireEvent.click(screen.getByRole('button', { name: 'Престиж +' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Престиж +' }))
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(done('pve')).toBe(true)
  })

  it('«Сбросить» resets the selected mode only, and says so', () => {
    mount('ru')
    fireEvent.click(screen.getByRole('button', { name: 'Престиж +' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, false, true])
    expect(probe.current!.activeProfile.modes.pve.modeResetAt).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Престиж + — прогресс режима PvE сброшен')
  })

  it('in English, for the season', () => {
    mount('en', 'seasonal')
    fireEvent.click(screen.getByRole('button', { name: 'Prestige +' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Reset all Season progress? Quests, chapters, loyalty and everything else of this mode will be deleted. Other modes will not change.')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect([done('pvp'), done('pve'), done('seasonal')]).toEqual([true, true, false])
    expect(screen.getByRole('status').textContent).toContain('Prestige + — Season progress was reset')
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })
})
