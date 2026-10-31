import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Quest } from '../domain/types'
import { AppStateProvider, useAppState } from './AppState'

/**
 * The quest scanner applies a Tasks frame every few seconds while the table is open (audit P5f): a frame that changes
 * nothing must not give the app a new state — no profile write to localStorage, no re-render of every page.
 */
const quest = (id: string, name: string): Quest => ({ id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] })
const QUESTS = [quest('debut', 'Дебют'), quest('cans', 'Стрельба по баночкам')]

/** What the page under the provider saw: the state of its last render and how many renders were committed. */
const seen = { app: undefined as unknown as ReturnType<typeof useAppState>, renders: 0 }
function Probe() {
  const value = useAppState()
  useEffect(() => { seen.app = value; seen.renders += 1 })
  return null
}

beforeEach(() => { localStorage.clear(); seen.renders = 0 })
afterEach(() => vi.restoreAllMocks())

describe('screen readings applied to the app state', () => {
  it('a Tasks frame showing nothing new: no new state, no profile write, no re-render', () => {
    render(<AppStateProvider><Probe /></AppStateProvider>)
    act(() => seen.app.applyQuestScanForMode('pve', [{ questId: 'debut', status: 'active' }], QUESTS, ['debut']))
    expect(seen.app.activeProfile.modes.pve.taskProgress.debut).toMatchObject({ status: 'active', source: 'screen-scan' })
    const stored = seen.app.activeProfile.modes.pve.taskProgress.debut
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const before = seen.renders
    for (let frame = 0; frame < 5; frame += 1) act(() => seen.app.applyQuestScanForMode('pve', [{ questId: 'debut', status: 'active' }], QUESTS, ['debut']))
    expect(seen.renders).toBe(before)
    expect(setItem).not.toHaveBeenCalled()
    expect(seen.app.activeProfile.modes.pve.taskProgress.debut).toBe(stored)
  })

  it('a new row read twice is written, to the mode it was read for only', () => {
    render(<AppStateProvider><Probe /></AppStateProvider>)
    // A row whose status cell was not read: two frames.
    act(() => seen.app.applyQuestScanForMode('pve', [{ questId: 'cans' }], QUESTS, []))
    expect(seen.app.activeProfile.modes.pve.taskProgress.cans).toBeUndefined()
    act(() => seen.app.applyQuestScanForMode('pve', [{ questId: 'cans' }], QUESTS, ['cans']))
    expect(seen.app.activeProfile.modes.pve.taskProgress.cans?.status).toBe('active')
    expect(seen.app.activeProfile.modes.pvp.taskProgress.cans).toBeUndefined()
    expect(seen.app.activeProfile.modes.seasonal.taskProgress.cans).toBeUndefined()
  })

  it('the Tasks table counts in every mode it was read for: PvP and Season too (owner, 31.10.2026)', () => {
    render(<AppStateProvider><Probe /></AppStateProvider>)
    for (const mode of ['pvp', 'seasonal'] as const) {
      act(() => seen.app.applyQuestScanForMode(mode, [{ questId: 'cans', status: 'active' }], QUESTS, ['cans']))
      expect(seen.app.activeProfile.modes[mode].taskProgress.cans).toMatchObject({ status: 'active', source: 'screen-scan' })
    }
    // Story chapters are read from the screen in every mode.
    act(() => seen.app.applyStoryScanForMode('pvp', [{ questId: 'story-tour', stageIndex: 0 }]))
    expect(seen.app.activeProfile.modes.pvp.taskProgress['story-tour']).toMatchObject({ status: 'active', source: 'screen-scan' })
  })

  it('a whole list read twice ends the OCR quest it no longer shows, in its mode only (audit P8)', () => {
    render(<AppStateProvider><Probe /></AppStateProvider>)
    act(() => seen.app.applyQuestScanForMode('pve', [{ questId: 'cans', status: 'active' }], QUESTS, ['cans']))
    const session = { wholeList: { ids: ['debut'], at: 2 } }
    act(() => seen.app.applyQuestScanForMode('pve', [{ questId: 'debut', status: 'active' }], QUESTS, ['debut'], session))
    expect(seen.app.activeProfile.modes.pve.taskProgress.cans).toBeUndefined()
    expect(seen.app.activeProfile.modes.pve.taskProgress.debut?.status).toBe('active')
  })

  it('a story reading that changes nothing gives no new state either', () => {
    render(<AppStateProvider><Probe /></AppStateProvider>)
    const before = seen.renders
    act(() => seen.app.applyStoryScanForMode('pvp', [{ questId: 'story-tour' }]))
    expect(seen.renders).toBe(before)
  })
})
