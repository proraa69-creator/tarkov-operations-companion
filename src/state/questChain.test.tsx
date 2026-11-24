import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import type { ModeProgress, Quest, RaidMode } from '../domain/types'
import { isCurrentTrackedQuest } from '../progression/requirementEngine'
import { AppStateProvider, useAppState } from './AppState'

/** A player's ticket №37, 04.11.2026, through the app state: «Каратель. Часть 3» from the screen, the logs holding Part 1. */
const P1 = '59c512ad86f7741f0d09de9b'
const P2 = '59c50a9e86f7745fef66f4ff'
const P3 = '59c50c8886f7745fed3193bf'
const part = (id: string, number: number, needs?: string): Quest => ({
  id, name: `Каратель. Часть ${number}`, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [],
  requirements: needs ? [{ taskId: needs, allowedStatuses: ['complete'] }] : [],
})
const quests = [part(P3, 3, P2), part(P2, 2, P1), part(P1, 1)]
const TAKEN = '2026-10-27T10:00:00.000Z'
const READ = '2026-11-01T07:02:02.000Z'

const probe: { current?: ReturnType<typeof useAppState> } = {}
function Probe() {
  const value = useAppState()
  useEffect(() => { probe.current = value })
  return null
}
const state = new Proxy({} as ReturnType<typeof useAppState>, { get: (_target, key) => probe.current![key as keyof ReturnType<typeof useAppState>] })
const mode = (selected: RaidMode): ModeProgress => state.activeProfile.modes[selected]

function start(tableRecord = true) {
  const profile = createLocalProfile('Оператор', 'local-test')
  for (const selected of ['pvp', 'pve'] as const) {
    profile.modes[selected] = {
      ...profile.modes[selected],
      taskProgress: {
        [P1]: { taskId: P1, status: 'active', source: 'eft-log', updatedAt: TAKEN },
        ...(tableRecord ? { [P3]: { taskId: P3, status: 'active' as const, source: 'screen-scan' as const, updatedAt: READ } } : {}),
      },
    }
  }
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  render(<AppStateProvider><Probe /></AppStateProvider>)
}

beforeEach(() => localStorage.clear())

describe('the chain in the app state', () => {
  it('the false part goes from the mode\'s records and «Текущие», with a line in its history; another mode\'s stays until its own catalog comes', () => {
    start()
    expect(isCurrentTrackedQuest(quests[0]!, mode('pvp'))).toBe(true)
    act(() => state.applyQuestChain('pvp', quests))
    expect(mode('pvp').taskProgress[P3]).toBeUndefined()
    expect(mode('pvp').questInputs!.table).toEqual({})
    expect(isCurrentTrackedQuest(quests[0]!, mode('pvp'))).toBe(false)
    expect(isCurrentTrackedQuest(quests[2]!, mode('pvp'))).toBe(true)
    expect(mode('pvp').progressEvents.filter((event) => event.eventType === 'task-status')).toEqual([expect.objectContaining({ taskId: P3, oldValue: 'active', newValue: null, reversible: true })])
    expect(mode('pve').taskProgress[P3]).toBeDefined()
  })

  it('nothing to do changes nothing: no new state, no loop of the effect that calls it', () => {
    start(false)
    const before = state.activeProfile
    act(() => state.applyQuestChain('pvp', quests))
    expect(state.activeProfile).toBe(before)
  })

  it('a frame showing it again adds nothing while the logs hold the part before it; after that part\'s hand-in a reading counts', () => {
    start(false)
    act(() => state.applyQuestScanForMode('pvp', [{ questId: P3, status: 'active', score: 1 }], quests, []))
    expect(mode('pvp').taskProgress[P3]).toBeUndefined()
    const now = new Date(Date.now() - 60_000).toISOString()
    act(() => state.applyLogScanForMode('pvp', [{ taskId: P1, status: 'completed', timestamp: now }, { taskId: P2, status: 'completed', timestamp: now }], {}))
    act(() => state.applyQuestScanForMode('pvp', [{ questId: P3, status: 'active', score: 1 }], quests, []))
    expect(mode('pvp').taskProgress[P3]).toMatchObject({ status: 'active', source: 'screen-scan' })
    act(() => state.applyQuestChain('pvp', quests))
    expect(mode('pvp').taskProgress[P3]).toBeDefined()
  })

  it('a quest left open past a later one in the logs closes, once; «Отменить» brings it back and it stays', () => {
    start(false)
    act(() => state.applyLogScanForMode('pvp', [{ taskId: P2, status: 'active', timestamp: new Date(Date.parse(TAKEN) + 3_600_000).toISOString() }], {}))
    expect(isCurrentTrackedQuest(quests[2]!, mode('pvp'))).toBe(true)
    act(() => state.applyQuestChain('pvp', quests))
    expect(mode('pvp').taskProgress[P1]).toMatchObject({ status: 'completed' })
    expect(isCurrentTrackedQuest(quests[2]!, mode('pvp'))).toBe(false)
    const event = mode('pvp').progressEvents.find((entry) => entry.eventType === 'task-status' && entry.taskId === P1 && entry.newValue === 'completed')!
    expect(event).toMatchObject({ oldValue: 'active', reversible: true })
    act(() => state.undoProgressEvent(event.id))
    expect(mode('pvp').taskProgress[P1]).toMatchObject({ status: 'active', source: 'manual-fix' })
    act(() => state.applyQuestChain('pvp', quests))
    expect(mode('pvp').taskProgress[P1]).toMatchObject({ status: 'active', source: 'manual-fix' })
  })

  it('the first sync: begins once per mode; another character empties that mode and opens it again, the others keep theirs', () => {
    start(false)
    act(() => state.startTableSync())
    const pve = mode('pve').tableSync!
    expect(pve).toMatchObject({ visits: 0, seen: [] })
    expect(mode('pvp').tableSync).toBeDefined()
    expect(mode('seasonal').tableSync).toBeDefined()
    act(() => state.startTableSync())
    expect(mode('pve').tableSync).toBe(pve)
    for (const selected of ['pve', 'pvp'] as const) act(() => state.noteTableVisit(selected, { profileId: state.activeProfile.id, mode: selected, readings: 2, lastAt: 2, seen: [P1], tableBefore: [], whole: true }, quests))
    expect(mode('pve').tableSync?.doneAt).toBeDefined()
    const pvp = mode('pvp').tableSync
    act(() => state.applyLogScanForMode('pve', [], { characterId: 'first-character' }))
    expect(mode('pve').tableSync?.doneAt).toBeDefined()
    act(() => state.applyLogScanForMode('pve', [], { characterId: 'another-character' }))
    expect(mode('pve').tableSync).toBeUndefined()
    expect(mode('pvp').tableSync).toBe(pvp)
  })

  for (const [press, reason] of [['«Сброс»', 'rebuild'], ['«Вайп»', 'wipe'], ['«Престиж»', 'prestige'], ['a new nickname', 'nickname']] as const) {
    it(`${press} opens that mode's first sync again, the others keep theirs`, () => {
      start(false)
      act(() => state.startTableSync())
      for (const selected of ['pve', 'pvp'] as const) act(() => state.noteTableVisit(selected, { profileId: state.activeProfile.id, mode: selected, readings: 2, lastAt: 2, seen: [P1], tableBefore: [], whole: true }, quests))
      act(() => state.resetModeProgress('pve', undefined, reason))
      expect(mode('pve').tableSync).toBeUndefined()
      expect(mode('pvp').tableSync?.doneAt).toBeDefined()
    })
  }

  it('a real quest of a title the old reader invented: gone from before the sync, back from the sync\'s reading, and it stays', () => {
    const OBVIOUS = '666314bf1cd52e3d040a2e78'
    const accusations = { ...part(OBVIOUS, 1), name: 'Серьёзные обвинения' }
    const catalog = [...quests, accusations]
    const profile = createLocalProfile('Оператор', 'local-test')
    profile.modes.pve = { ...profile.modes.pve, taskProgress: { [OBVIOUS]: { taskId: OBVIOUS, status: 'active', source: 'screen-scan', updatedAt: READ } } }
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
    render(<AppStateProvider><Probe /></AppStateProvider>)
    act(() => state.applyQuestChain('pve', catalog))
    expect(mode('pve').taskProgress[OBVIOUS]).toBeDefined()
    act(() => state.startTableSync())
    act(() => state.applyQuestChain('pve', catalog))
    expect(mode('pve').taskProgress[OBVIOUS]).toBeUndefined()
    act(() => state.applyQuestScanForMode('pve', [{ questId: OBVIOUS, status: 'active', score: 1 }], catalog, []))
    expect(mode('pve').taskProgress[OBVIOUS]).toMatchObject({ status: 'active', source: 'screen-scan' })
    act(() => state.applyQuestChain('pve', catalog))
    expect(mode('pve').taskProgress[OBVIOUS]).toBeDefined()
  })

  it('«Отметить вручную» stands against it', () => {
    start()
    act(() => state.setManualQuestMark('pvp', P3, 'active'))
    act(() => state.applyQuestChain('pvp', quests))
    expect(mode('pvp').taskProgress[P3]).toMatchObject({ status: 'active', source: 'manual-fix' })
  })
})
