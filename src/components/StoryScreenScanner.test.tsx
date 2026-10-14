import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Quest } from '../domain/types'
import { ENGLISH_TABLE_QUESTS, ENGLISH_TASKS_SIDE } from '../import/__fixtures__/englishGameOcr'
import { buildScanResult } from '../import/eftLogTimeline'
import { updateLogStatus } from '../import/logStatus'
import { STORY_SCAN_TIMING } from '../import/storyScanTiming'

const quests = ENGLISH_TABLE_QUESTS.map(([id, name, normalizedName]) => ({
  id, name, normalizedName, trader: 'Prapor', level: 1, kappa: false, description: '', objectives: [], rewards: [],
} as Quest))
const state = vi.hoisted(() => ({
  raidMode: 'pve' as const,
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
afterEach(() => { cleanup(); vi.useRealTimers(); updateLogStatus({ scan: undefined }); Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('the quest scanner and the logs (owner, 14.10.2026)', () => {
  it('reads and applies the Tasks table while the logs do not hold every quest, at the quick pace', async () => {
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

  it('reads the table again for a mode whose logs do not reach back (PvP while only PvE is whole)', async () => {
    updateLogStatus({ scan: wholeLog() })
    state.raidMode = 'pvp' as never
    try {
      desktop(tasksTable)
      render(<StoryScreenScanner />)
      await run(0)
      expect(state.applyQuestScanForMode).toHaveBeenCalledTimes(1)
    } finally {
      state.raidMode = 'pve'
    }
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
