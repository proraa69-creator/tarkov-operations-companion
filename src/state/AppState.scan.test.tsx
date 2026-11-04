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

  describe('a whole read of the table (owner, 04.11.2026)', () => {
    const at = Date.parse('2026-11-04T12:00:00.000Z')
    const logged = (taskId: string, status: 'started' | 'completed', timestamp: string) => ({ taskId, status: status === 'started' ? 'active' as const : 'completed' as const, timestamp } as never)

    it('the mode\'s «Текущие» become the list: what it lacks goes, from the logs as well, in that mode only', () => {
      render(<AppStateProvider><Probe /></AppStateProvider>)
      act(() => seen.app.applyLogScanForMode('pve', [logged('cans', 'started', '2026-10-01T00:00:00.000Z')], {}))
      act(() => seen.app.applyLogScanForMode('pvp', [logged('cans', 'started', '2026-10-01T00:00:00.000Z')], {}))
      let changed: { added: string[]; gone: string[] } | undefined
      act(() => { changed = seen.app.applyWholeTableRead('pve', { startedAt: at, rows: [{ ids: ['debut'] }] }, QUESTS) })
      expect(changed).toEqual({ added: ['debut'], gone: ['cans'] })
      const pve = seen.app.activeProfile.modes.pve
      expect(pve.taskProgress.cans).toBeUndefined()
      expect(pve.taskProgress.debut?.status).toBe('active')
      expect(pve.questInputs?.manual.cans).toEqual({ status: 'absent', at: new Date(at).toISOString() })
      expect(seen.app.activeProfile.modes.pvp.taskProgress.cans?.status).toBe('active')
    })

    it('the logs read again do not bring it back; a newer event of the game does', () => {
      render(<AppStateProvider><Probe /></AppStateProvider>)
      const old = logged('cans', 'started', '2026-10-01T00:00:00.000Z')
      act(() => seen.app.applyLogScanForMode('pve', [old], {}))
      act(() => { seen.app.applyWholeTableRead('pve', { startedAt: at, rows: [{ ids: ['debut'] }] }, QUESTS) })
      act(() => seen.app.applyLogScanForMode('pve', [old], {}))
      expect(seen.app.activeProfile.modes.pve.taskProgress.cans).toBeUndefined()
      act(() => seen.app.applyLogScanForMode('pve', [old, logged('cans', 'started', '2026-11-04T12:30:00.000Z')], {}))
      expect(seen.app.activeProfile.modes.pve.taskProgress.cans?.status).toBe('active')
    })

    it('a list that matches changes nothing', () => {
      render(<AppStateProvider><Probe /></AppStateProvider>)
      act(() => seen.app.applyLogScanForMode('pve', [logged('cans', 'started', '2026-10-01T00:00:00.000Z')], {}))
      const before = seen.app.activeProfile.modes.pve
      let changed: { added: string[]; gone: string[] } | undefined
      act(() => { changed = seen.app.applyWholeTableRead('pve', { startedAt: at, rows: [{ ids: ['cans'] }] }, QUESTS) })
      expect(changed).toEqual({ added: [], gone: [] })
      expect(seen.app.activeProfile.modes.pve).toBe(before)
    })
  })

  it('a story reading that changes nothing gives no new state either', () => {
    render(<AppStateProvider><Probe /></AppStateProvider>)
    const before = seen.renders
    act(() => seen.app.applyStoryScanForMode('pvp', [{ questId: 'story-tour' }]))
    expect(seen.renders).toBe(before)
  })
})
