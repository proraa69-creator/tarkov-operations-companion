import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RaidMode } from '../domain/types'
import type { RaidState } from '../import/raidState'
import {
  RAID_CONFIRM_MS, RAID_FALLBACK_MS, RAID_RECHECK_MS, clearAllQuestChecks, clearQuestChecks, clearQuestChecksBefore,
  orderByChecks, questChecksKey, readQuestChecks, setQuestCheck, toggleQuestCheck, useQuestChecks, watchRaidStarts,
} from './questChecks'

afterEach(() => localStorage.clear())

describe('quest checks store', () => {
  it('keeps the checks of each profile and mode apart', () => {
    setQuestCheck('p1', 'pvp', 'q-shoreline', true, 1_000)
    toggleQuestCheck('p1', 'pve', 'q-woods', 2_000)
    expect([...readQuestChecks('p1', 'pvp')]).toEqual([['q-shoreline', 1_000]])
    expect([...readQuestChecks('p1', 'pve')]).toEqual([['q-woods', 2_000]])
    expect(readQuestChecks('p1', 'seasonal').size).toBe(0)
    expect(readQuestChecks('p2', 'pvp').size).toBe(0)
    expect(JSON.parse(localStorage.getItem(questChecksKey('p1', 'pvp')) ?? '')).toEqual({ 'q-shoreline': 1_000 })
    toggleQuestCheck('p1', 'pve', 'q-woods')
    expect(readQuestChecks('p1', 'pve').size).toBe(0)
    expect(localStorage.getItem(questChecksKey('p1', 'pve'))).toBeNull()
  })

  it('returns the same snapshot until the stored value changes', () => {
    setQuestCheck('p1', 'pvp', 'q1', true, 1)
    const first = readQuestChecks('p1', 'pvp')
    expect(readQuestChecks('p1', 'pvp')).toBe(first)
    setQuestCheck('p1', 'pvp', 'q2', true, 2)
    expect(readQuestChecks('p1', 'pvp')).not.toBe(first)
  })

  it('reads a damaged or foreign stored value as no checks and writes a clean one next', () => {
    const key = questChecksKey('p1', 'pvp')
    localStorage.setItem(key, '{not json')
    expect(readQuestChecks('p1', 'pvp').size).toBe(0)
    localStorage.setItem(key, '[1,2]')
    expect(readQuestChecks('p1', 'pvp').size).toBe(0)
    localStorage.setItem(key, JSON.stringify({ kept: 5, text: 'x', empty: null, nested: { at: 1 } }))
    expect([...readQuestChecks('p1', 'pvp')]).toEqual([['kept', 5]])
    setQuestCheck('p1', 'pvp', 'next', true, 6)
    expect(JSON.parse(localStorage.getItem(key) ?? '')).toEqual({ kept: 5, next: 6 })
  })

  it('clears the checks made before a raid in every mode of that profile only', () => {
    setQuestCheck('p1', 'pvp', 'before', true, 1_000)
    setQuestCheck('p1', 'pvp', 'during', true, 5_000)
    setQuestCheck('p1', 'seasonal', 'before-season', true, 2_000)
    setQuestCheck('p2', 'pvp', 'other-profile', true, 1_000)
    expect(clearQuestChecksBefore('p1', 4_000)).toBe(2)
    expect([...readQuestChecks('p1', 'pvp').keys()]).toEqual(['during'])
    expect(readQuestChecks('p1', 'seasonal').size).toBe(0)
    expect([...readQuestChecks('p2', 'pvp').keys()]).toEqual(['other-profile'])
    expect(clearQuestChecksBefore('p1', 4_000)).toBe(0)
  })

  it('clears one mode on request and every profile with all data', () => {
    setQuestCheck('p1', 'pvp', 'a', true, 1)
    setQuestCheck('p1', 'pve', 'b', true, 1)
    setQuestCheck('p2', 'seasonal', 'c', true, 1)
    localStorage.setItem('tarkov-restock-notify-v1', '{}')
    clearQuestChecks('p1', 'pvp')
    expect(readQuestChecks('p1', 'pvp').size).toBe(0)
    expect(readQuestChecks('p1', 'pve').size).toBe(1)
    clearAllQuestChecks()
    expect(readQuestChecks('p1', 'pve').size).toBe(0)
    expect(readQuestChecks('p2', 'seasonal').size).toBe(0)
    expect(localStorage.getItem('tarkov-restock-notify-v1')).toBe('{}')
  })

  it('updates the hook from this window, from another window and when the mode changes', () => {
    const { result, rerender } = renderHook(({ mode }: { mode: RaidMode }) => useQuestChecks('p1', mode), { initialProps: { mode: 'pvp' } })
    expect(result.current.size).toBe(0)
    act(() => setQuestCheck('p1', 'pvp', 'q1', true, 1))
    expect(result.current.has('q1')).toBe(true)
    act(() => {
      localStorage.setItem(questChecksKey('p1', 'pvp'), JSON.stringify({ q1: 1, q2: 2 }))
      window.dispatchEvent(new StorageEvent('storage', { key: questChecksKey('p1', 'pvp') }))
    })
    expect(result.current.size).toBe(2)
    rerender({ mode: 'pve' })
    expect(result.current.size).toBe(0)
  })
})

describe('orderByChecks', () => {
  it('moves the checked quests to the end of the list and keeps the order otherwise', () => {
    const entries = ['a', 'b', 'c', 'd'].map((id) => ({ quest: { id } }))
    expect(orderByChecks(entries, new Map())).toBe(entries)
    expect(orderByChecks(entries, new Map([['c', 1], ['a', 2]])).map(({ quest }) => quest.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(orderByChecks(entries, new Map([['elsewhere', 1]]))).toBe(entries)
  })
})

/** The desktop shell's raid state: an event only when «in raid» flips; the rest (since, location) only by asking. */
function raidSource(initial: RaidState = { inRaid: false }) {
  let state = initial
  const listeners = new Set<(next: RaidState) => void>()
  return {
    getRaidState: vi.fn(async () => state),
    onRaidStateChanged: (callback: (next: RaidState) => void) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    update(next: RaidState) { state = next },
    flip(next: RaidState) {
      state = next
      for (const listener of listeners) listener(next)
    },
  }
}

describe('watchRaidStarts', () => {
  const T0 = Date.parse('2026-10-08T19:00:00Z')
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => vi.useRealTimers())

  it('counts a raid once it has lasted the confirm time and matching is over', async () => {
    const source = raidSource()
    const onRaid = vi.fn()
    const stop = watchRaidStarts(source, onRaid)
    await vi.advanceTimersByTimeAsync(0)
    source.flip({ inRaid: true, since: T0 })
    await vi.advanceTimersByTimeAsync(20_000)
    // The network game is created: the log names the location, `since` moves on.
    source.update({ inRaid: true, since: T0 + 20_000, location: 'Interchange' })
    await vi.advanceTimersByTimeAsync(RAID_CONFIRM_MS - 20_000 - 1)
    expect(onRaid).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onRaid).toHaveBeenCalledExactlyOnceWith(T0)
    await vi.advanceTimersByTimeAsync(RAID_FALLBACK_MS)
    expect(onRaid).toHaveBeenCalledOnce()
    stop()
  })

  it('ignores a search cancelled at once or after a long wait', async () => {
    const source = raidSource()
    const onRaid = vi.fn()
    watchRaidStarts(source, onRaid)
    source.flip({ inRaid: true, since: T0 })
    await vi.advanceTimersByTimeAsync(5_000)
    source.flip({ inRaid: false })
    await vi.advanceTimersByTimeAsync(RAID_CONFIRM_MS)
    source.flip({ inRaid: true, since: Date.now() })
    // Still searching for a match: no location in the log yet.
    await vi.advanceTimersByTimeAsync(RAID_CONFIRM_MS + 2 * RAID_RECHECK_MS)
    source.flip({ inRaid: false })
    await vi.advanceTimersByTimeAsync(RAID_FALLBACK_MS)
    expect(onRaid).not.toHaveBeenCalled()
  })

  it('counts a raid whose log never names the location after the fallback time', async () => {
    const source = raidSource()
    const onRaid = vi.fn()
    watchRaidStarts(source, onRaid)
    source.flip({ inRaid: true, since: T0 })
    await vi.advanceTimersByTimeAsync(RAID_FALLBACK_MS - 1)
    expect(onRaid).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RAID_RECHECK_MS)
    expect(onRaid).toHaveBeenCalledExactlyOnceWith(T0)
  })

  it('opened mid-raid: counts a raid that began long ago at once, a fresh one after the rest of the wait', async () => {
    const long = vi.fn()
    watchRaidStarts(raidSource({ inRaid: true, since: T0 - 10 * 60_000, location: 'Woods' }), long)
    await vi.advanceTimersByTimeAsync(0)
    expect(long).toHaveBeenCalledExactlyOnceWith(T0 - 10 * 60_000)

    const fresh = vi.fn()
    watchRaidStarts(raidSource({ inRaid: true, since: T0 - 30_000, location: 'Woods' }), fresh)
    await vi.advanceTimersByTimeAsync(RAID_CONFIRM_MS - 30_000 - 1)
    expect(fresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fresh).toHaveBeenCalledExactlyOnceWith(T0 - 30_000)
  })

  it('a repeated «in raid» event is the same raid, and nothing happens after stopping', async () => {
    const source = raidSource()
    const onRaid = vi.fn()
    const stop = watchRaidStarts(source, onRaid)
    source.flip({ inRaid: true, since: T0, location: 'Customs' })
    await vi.advanceTimersByTimeAsync(RAID_CONFIRM_MS)
    source.flip({ inRaid: true, since: T0, location: 'Customs' })
    await vi.advanceTimersByTimeAsync(RAID_CONFIRM_MS)
    expect(onRaid).toHaveBeenCalledOnce()
    stop()
    source.flip({ inRaid: false })
    source.flip({ inRaid: true, since: Date.now(), location: 'Customs' })
    await vi.advanceTimersByTimeAsync(RAID_FALLBACK_MS)
    expect(onRaid).toHaveBeenCalledOnce()
  })
})
