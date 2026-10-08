import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RaidState } from '../import/raidState'
import { RAID_CONFIRM_MS, readQuestChecks, setQuestCheck } from '../progression/questChecks'
import { QuestChecksRaidReset } from './QuestChecksRaidReset'

vi.mock('../state/AppState', () => ({ useAppState: () => ({ activeProfile: { id: 'p-raid' } }) }))

const T0 = Date.parse('2026-10-08T19:00:00Z')
const listeners = new Set<(state: RaidState) => void>()
let raid: RaidState = { inRaid: false }

/** «In raid» flipped: the desktop shell sends an event. */
function flip(next: RaidState) {
  raid = next
  act(() => { for (const listener of listeners) listener(next) })
}

const checked = (mode: 'pvp' | 'pve' | 'seasonal', profileId = 'p-raid') => [...readQuestChecks(profileId, mode).keys()]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  raid = { inRaid: false }
  listeners.clear()
  window.tarkovDesktop = {
    getRaidState: async () => raid,
    onRaidStateChanged: (callback: (state: RaidState) => void) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
  } as unknown as NonNullable<Window['tarkovDesktop']>
})
afterEach(() => {
  delete window.tarkovDesktop
  vi.useRealTimers()
  localStorage.clear()
})

describe('QuestChecksRaidReset', () => {
  it('clears the checks made before the next raid in every mode, keeps the ones made during it', async () => {
    setQuestCheck('p-raid', 'pvp', 'from-last-raid', true, T0 - 60_000)
    setQuestCheck('p-raid', 'pve', 'other-mode', true, T0 - 60_000)
    setQuestCheck('p-other', 'pvp', 'other-profile', true, T0 - 60_000)
    render(<QuestChecksRaidReset />)
    flip({ inRaid: true, since: T0 })
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    setQuestCheck('p-raid', 'pvp', 'this-raid', true)
    raid = { inRaid: true, since: T0 + 30_000, location: 'Woods' }
    await act(() => vi.advanceTimersByTimeAsync(RAID_CONFIRM_MS - 10_000 - 1))
    expect(checked('pvp')).toEqual(['from-last-raid', 'this-raid'])
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(checked('pvp')).toEqual(['this-raid'])
    expect(checked('pve')).toEqual([])
    expect(checked('pvp', 'p-other')).toEqual(['other-profile'])
  })

  it('keeps the checks when the search is cancelled back to the menu', async () => {
    setQuestCheck('p-raid', 'pvp', 'from-last-raid', true, T0 - 60_000)
    render(<QuestChecksRaidReset />)
    flip({ inRaid: true, since: T0 })
    await act(() => vi.advanceTimersByTimeAsync(8_000))
    flip({ inRaid: false })
    await act(() => vi.advanceTimersByTimeAsync(10 * RAID_CONFIRM_MS))
    expect(checked('pvp')).toEqual(['from-last-raid'])
  })

  it('opened during a raid: clears at once the checks older than this raid', async () => {
    setQuestCheck('p-raid', 'pvp', 'stale', true, T0 - 20 * 60_000)
    setQuestCheck('p-raid', 'pvp', 'this-raid', true, T0 - 2 * 60_000)
    raid = { inRaid: true, since: T0 - 5 * 60_000, location: 'Customs' }
    render(<QuestChecksRaidReset />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(checked('pvp')).toEqual(['this-raid'])
  })

  it('does nothing without the desktop shell (phone, browser)', async () => {
    delete window.tarkovDesktop
    setQuestCheck('p-raid', 'pvp', 'kept', true, T0 - 60_000)
    render(<QuestChecksRaidReset />)
    await act(() => vi.advanceTimersByTimeAsync(10 * RAID_CONFIRM_MS))
    expect(checked('pvp')).toEqual(['kept'])
  })
})
