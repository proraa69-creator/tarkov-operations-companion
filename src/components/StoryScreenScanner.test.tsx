import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Quest } from '../domain/types'
import { ENGLISH_TABLE_QUESTS, ENGLISH_TASKS_SIDE } from '../import/__fixtures__/englishGameOcr'
import { buildScanResult } from '../import/eftLogTimeline'
import { updateLogStatus } from '../import/logStatus'
import { logsCoverModes } from '../import/logCoverage'
import { STORY_SCAN_TIMING } from '../import/storyScanTiming'
import { RU_TABLE_QUESTS, RU_TASKS_TABLE } from '../import/__fixtures__/russianTasksTable'

// The Russian rows first: «Первый в очереди» is in both lists, and the first title of a kind is the one matched.
const quests = [
  ...RU_TABLE_QUESTS.map(([id, name]) => ({ id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] } as Quest)),
  ...ENGLISH_TABLE_QUESTS.map(([id, name, normalizedName]) => ({
    id, name, normalizedName, trader: 'Prapor', level: 1, kappa: false, description: '', objectives: [], rewards: [],
  } as Quest)),
]
const state = vi.hoisted(() => ({
  raidMode: 'pve' as 'pvp' | 'pve' | 'seasonal',
  activeProfile: { id: 'profile-1' },
  applyStoryScanForMode: vi.fn(),
  applyQuestScanForMode: vi.fn(),
}))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { quests } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => state }))
const { StoryScreenScanner } = await import('./StoryScreenScanner')

type Frame = Awaited<ReturnType<NonNullable<Window['tarkovDesktop']>['captureQuestFrame']>>
const tasksTable: Frame = { text: ENGLISH_TASKS_SIDE, sourceName: 'EscapeFromTarkov', gameWindow: true, observedAt: 1 }

/** A PvE log whose history starts with the profile: every quest accepted before it was handed in. */
function wholeLog() {
  const at = Date.parse('2026-10-14T08:00:00Z')
  return buildScanResult([
    { kind: 'mode', at, mode: 'pve' },
    { kind: 'profile', at: at + 1, profileId: 'b'.repeat(24), accountId: 7 },
    { kind: 'quest', at: at + 2, taskId: quests[0]!.id, status: 'active' },
    { kind: 'quest', at: at + 3, taskId: quests[0]!.id, status: 'completed' },
    { kind: 'quest', at: at + 4, taskId: quests[1]!.id, status: 'active' },
  ], 1)
}

/** Logs that name the game's mode and hold no quest history (so the Tasks table is still read for it). */
function gameIn(mode: 'pvp' | 'pve' | 'seasonal') {
  return buildScanResult([{ kind: 'mode', at: Date.parse('2026-10-14T08:00:00Z'), mode }], 1)
}

let looks: number[] = []
function desktop(frame: Frame) {
  looks = []
  window.tarkovDesktop = {
    captureQuestFrame: vi.fn(async () => { looks.push(Date.now()); return frame }),
    getRaidState: async () => ({ inRaid: false }),
    onRaidStateChanged: () => () => {},
  } as unknown as NonNullable<Window['tarkovDesktop']>
}
const run = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-10-14T10:00:00Z'))
  state.applyQuestScanForMode.mockReset()
  state.applyStoryScanForMode.mockReset()
  sessionStorage.clear()
})
afterEach(() => { cleanup(); vi.useRealTimers(); updateLogStatus({ scan: undefined, notFound: undefined, folder: undefined }); state.raidMode = 'pve'; Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('the quest scanner and the logs (owner, 14.10.2026)', () => {
  it('reads and applies the Tasks table while the logs do not hold every quest, at the quick pace', async () => {
    updateLogStatus({ scan: gameIn('pve') })
    desktop(tasksTable)
    render(<StoryScreenScanner />)
    await run(0)
    expect(state.applyQuestScanForMode).toHaveBeenCalledTimes(1)
    expect(state.applyQuestScanForMode.mock.calls[0]![0]).toBe('pve')
    await run(STORY_SCAN_TIMING.storyMs)
    expect(looks).toHaveLength(2)
  })

  it('passes the Tasks table over at the slow pace once the logs of this mode hold every quest', async () => {
    updateLogStatus({ scan: wholeLog() })
    desktop(tasksTable)
    render(<StoryScreenScanner />)
    await run(0)
    await run(STORY_SCAN_TIMING.quietMaxMs - 1)
    expect(looks).toHaveLength(1)
    await run(1)
    expect(looks).toHaveLength(2)
    expect(state.applyQuestScanForMode).not.toHaveBeenCalled()
  })

  it('reads the table again when the game is in a mode whose logs do not reach back (PvP while only PvE is whole)', async () => {
    // The game went on to PvP afterwards; the app still shows PvE.
    const scan = buildScanResult([
      { kind: 'mode', at: Date.parse('2026-10-14T08:00:00Z'), mode: 'pve' },
      { kind: 'profile', at: Date.parse('2026-10-14T08:00:01Z'), profileId: 'b'.repeat(24), accountId: 7 },
      { kind: 'quest', at: Date.parse('2026-10-14T08:00:02Z'), taskId: quests[0]!.id, status: 'active' },
      { kind: 'quest', at: Date.parse('2026-10-14T08:00:03Z'), taskId: quests[0]!.id, status: 'completed' },
      { kind: 'quest', at: Date.parse('2026-10-14T08:00:04Z'), taskId: quests[1]!.id, status: 'active' },
      { kind: 'mode', at: Date.parse('2026-10-14T09:00:00Z'), mode: 'pvp' },
    ], 2)
    expect(logsCoverModes(scan, quests)).toMatchObject({ pve: true, pvp: false })
    expect(scan.latestMode).toBe('pvp')
    updateLogStatus({ scan })
    desktop(tasksTable)
    render(<StoryScreenScanner />)
    await run(0)
    expect(state.applyQuestScanForMode).toHaveBeenCalledTimes(1)
    expect(state.applyQuestScanForMode.mock.calls[0]![0]).toBe('pvp')
  })

  it('reads the Russian table even when the dimmed «СЮЖЕТНЫЕ» tab is read (audit P1)', async () => {
    updateLogStatus({ scan: gameIn('pve') })
    desktop({ text: RU_TASKS_TABLE, sourceName: 'EscapeFromTarkov', gameWindow: true, observedAt: 1 })
    render(<StoryScreenScanner />)
    await run(0)
    expect(state.applyQuestScanForMode).toHaveBeenCalledTimes(1)
    const matches = state.applyQuestScanForMode.mock.calls[0]![1] as Array<{ questId: string }>
    expect(matches.map((match) => match.questId).sort()).toEqual(RU_TABLE_QUESTS.map(([id]) => id).sort())
    expect(state.applyStoryScanForMode).not.toHaveBeenCalled()
  })

  it('yields to an item lookup or a Kappa scan and asks again shortly, keeping its place', async () => {
    desktop({ text: '', sourceName: '', gameWindow: true, busy: true })
    render(<StoryScreenScanner />)
    await run(0)
    await run(STORY_SCAN_TIMING.busyMs - 1)
    expect(looks).toHaveLength(1)
    await run(1)
    expect(looks).toHaveLength(2)
  })

  it('copies nothing and asks again in a few seconds while a raid is likely', async () => {
    desktop({ text: '', sourceName: '', gameWindow: true, raid: true })
    render(<StoryScreenScanner />)
    await run(0)
    await run(STORY_SCAN_TIMING.raidMs - 1)
    expect(looks).toHaveLength(1)
    await run(1)
    expect(looks).toHaveLength(2)
    expect(state.applyQuestScanForMode).not.toHaveBeenCalled()
  })
})

describe('readings go to the mode the game is in (audit P12, P5e)', () => {
  const tableIds = () => (state.applyQuestScanForMode.mock.calls.at(-1)![1] as Array<{ questId: string }>).map((match) => match.questId).sort()

  it('the logs\' mode, not the mode the app shows', async () => {
    state.raidMode = 'pvp'
    updateLogStatus({ scan: gameIn('pve') })
    desktop(tasksTable)
    render(<StoryScreenScanner />)
    await run(0)
    expect(state.applyQuestScanForMode.mock.calls.map((call) => call[0])).toEqual(['pve'])
  })

  it('held while the logs have not named the game\'s mode, and counted as soon as they do', async () => {
    desktop(tasksTable)
    render(<StoryScreenScanner />)
    await run(0)
    expect(looks).toHaveLength(1)
    // A Logs folder may exist (the search still runs): nothing goes to the app's mode, shown last before the restart.
    expect(state.applyQuestScanForMode).not.toHaveBeenCalled()
    await act(async () => { updateLogStatus({ scan: gameIn('seasonal') }) })
    await run(0)
    expect(looks).toHaveLength(2)
    expect(state.applyQuestScanForMode).toHaveBeenCalledTimes(1)
    expect(state.applyQuestScanForMode.mock.calls[0]![0]).toBe('seasonal')
    // The held frame is the first of the two readings a new row needs.
    expect((state.applyQuestScanForMode.mock.calls[0]![3] as string[]).sort()).toEqual(tableIds())
  })

  it('with no Logs folder found at all, the app\'s mode as before', async () => {
    state.raidMode = 'seasonal'
    updateLogStatus({ notFound: true })
    desktop(tasksTable)
    render(<StoryScreenScanner />)
    await run(0)
    expect(state.applyQuestScanForMode.mock.calls.map((call) => call[0])).toEqual(['seasonal'])
  })

  it('switching the app\'s mode is a view change only: frames are not thrown away', async () => {
    updateLogStatus({ scan: gameIn('pve') })
    desktop(tasksTable)
    const view = render(<StoryScreenScanner />)
    await run(0)
    expect(state.applyQuestScanForMode.mock.calls[0]![3]).toEqual([])
    state.raidMode = 'pvp'
    view.rerender(<StoryScreenScanner />)
    await run(STORY_SCAN_TIMING.storyMs)
    expect(state.applyQuestScanForMode).toHaveBeenCalledTimes(2)
    expect(state.applyQuestScanForMode.mock.calls[1]![0]).toBe('pve')
    expect((state.applyQuestScanForMode.mock.calls[1]![3] as string[]).sort()).toEqual(tableIds())
  })
})
