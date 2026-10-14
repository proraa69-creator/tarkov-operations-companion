import { describe, expect, it } from 'vitest'
import { FRESH_GAME_MS, gameScanDelay, isFreshGame, quietScanDelay, reuseQuestReading, reuseStableReading, similarFrame, STORY_SCAN_TIMING as timing, unchangedFrame, type GameScreen } from './storyScanTiming'

/**
 * The scanner's pace over time (src/components/StoryScreenScanner.tsx): each look takes `lookMs` (copy and reading), then
 * waits gameScanDelay. `screenAt` says what the game shows at a moment; `since` is when the game window came.
 */
function simulate(screenAt: (at: number) => GameScreen, { until, since, lookMs = 0 }: { until: number; since?: number; lookMs?: number }) {
  const looks: Array<{ at: number; screen: GameScreen }> = []
  let at = 0
  let quiet = 0
  while (at < until) {
    const screen = screenAt(at)
    looks.push({ at, screen })
    quiet = screen === 'known' ? 0 : quiet + 1
    at += lookMs + gameScanDelay(screen, quiet, isFreshGame(since, at))
  }
  return looks
}

describe('fast but fresh story scans', () => {
  it('looks at a game that shows no known screen less and less often, then every eight seconds', () => {
    expect(quietScanDelay(0)).toBe(timing.menuMs)
    expect(quietScanDelay(1)).toBe(timing.menuMs)
    expect(quietScanDelay(2)).toBeGreaterThan(timing.menuMs)
    expect(quietScanDelay(3)).toBeGreaterThan(quietScanDelay(2))
    expect(quietScanDelay(50)).toBe(timing.quietMaxMs)
    expect(quietScanDelay(100_000)).toBe(timing.quietMaxMs)
    expect(timing.quietMaxMs).toBe(8000)
  })
  it('budgets two independent OCR passes under ten seconds at three seconds per pass', () => {
    expect(timing.idleMs + 3000 + timing.storyMs + 3000).toBeLessThan(10_000)
  })
  it('does not reuse a low resolution menu result for the detailed confirmation', () => {
    expect(reuseQuestReading({ at: 1000, detail: false }, 1500, true, true)).toBe(false)
  })
  it('expires unchanged detail readings promptly instead of waiting six seconds', () => {
    expect(reuseQuestReading({ at: 1000, detail: true }, 1500, true, true)).toBe(true)
    expect(reuseQuestReading({ at: 1000, detail: true }, 2000, true, true)).toBe(false)
  })
  it('never reuses a changed image, an empty cache or a future timestamp', () => {
    expect(reuseQuestReading(null, 1500, true, true)).toBe(false)
    expect(reuseQuestReading({ at: 1000, detail: true }, 1500, true, false)).toBe(false)
    expect(reuseQuestReading({ at: 2000, detail: true }, 1500, true, true)).toBe(false)
  })
  it('reads an unchanged screen no more once two readings agreed, and again now and then', () => {
    const read = (reads: number) => ({ at: 1000, detail: true, reads })
    // The confirming second reading always happens.
    expect(reuseStableReading(read(1), 5000, true, true)).toBe(false)
    expect(reuseStableReading(read(2), 5000, true, true)).toBe(true)
    expect(reuseStableReading(read(2), 1000 + timing.stableReuseMs, true, true)).toBe(false)
    expect(reuseStableReading(read(2), 5000, true, false)).toBe(false)
    expect(reuseStableReading(read(2), 5000, false, true)).toBe(false)
    expect(reuseStableReading(null, 5000, true, true)).toBe(false)
  })
  it('tells a changed counter from the same screen', () => {
    const frame = new Uint8Array(120 * 68 * 4).fill(40)
    const same = frame.slice()
    same[400] = 44
    expect(unchangedFrame(frame, same)).toBe(true)
    const counter = frame.slice()
    counter[4 * 900 + 1] = 52
    expect(unchangedFrame(frame, counter)).toBe(false)
    expect(unchangedFrame(null, frame)).toBe(false)
    expect(unchangedFrame(frame, new Uint8Array(8))).toBe(false)
  })
  it('takes a little motion for the same picture, a different screen for another one (one print for both checks)', () => {
    const frame = new Uint8Array(120 * 68 * 4).fill(40)
    const moved = frame.slice()
    for (let index = 0; index < 400; index += 1) moved[index * 4] = 90
    expect(unchangedFrame(frame, moved)).toBe(false)
    expect(similarFrame(frame, moved)).toBe(true)
    expect(similarFrame(frame, new Uint8Array(frame.length).fill(120))).toBe(false)
    expect(similarFrame(null, frame)).toBe(false)
  })
})

describe('the scanner pace over a session', () => {
  it('reads «Задания» opened after an hour on other screens within the slow pace, and costs few looks meanwhile', () => {
    const opened = 60 * 60_000
    const looks = simulate((at) => (at < opened ? 'unknown' : 'known'), { until: opened + 30_000, lookMs: 600 })
    const first = looks.find((look) => look.at >= opened)!
    expect(first.at - opened).toBeLessThanOrEqual(timing.quietMaxMs + 600)
    // An hour of a screen read nothing from: about one look every 8.6 s, not one every 1.8 s as before.
    const quiet = looks.filter((look) => look.at < opened).length
    expect(quiet).toBeLessThan(opened / timing.quietMaxMs + 10)
    // Once recognised, the quick pace is back.
    const after = looks.filter((look) => look.at > first.at)
    expect(after[0]!.at - first.at).toBe(600 + timing.menuMs)
  })

  it('looks quickly in the first 90 seconds of a new game window only (the mode selection), then slows down', () => {
    expect(FRESH_GAME_MS).toBe(90_000)
    const looks = simulate(() => 'unknown', { until: 5 * 60_000, since: 0 })
    const early = looks.filter((look) => look.at < FRESH_GAME_MS)
    expect(early.length).toBeGreaterThanOrEqual(Math.floor(FRESH_GAME_MS / timing.menuMs) - 1)
    const late = looks.filter((look) => look.at >= FRESH_GAME_MS + 60_000)
    for (let index = 1; index < late.length; index += 1) expect(late[index]!.at - late[index - 1]!.at).toBe(timing.quietMaxMs)
  })

  it('does not speed up again after a raid or an Alt+Tab: the game window is the same one', () => {
    // The window came at 0; the player is back from a 40-minute raid (or an Alt+Tab) at 45 minutes.
    expect(isFreshGame(0, 45 * 60_000)).toBe(false)
    expect(gameScanDelay('unknown', 9, isFreshGame(0, 45 * 60_000))).toBe(timing.quietMaxMs)
    // A new game window (the game started again) is a start again.
    expect(isFreshGame(45 * 60_000, 45 * 60_000 + 10_000)).toBe(true)
    expect(isFreshGame(undefined, 1000)).toBe(false)
    expect(isFreshGame(5000, 1000)).toBe(false)
  })

  it('looks at a screen passed over on purpose at the slow pace, also at a game start', () => {
    expect(gameScanDelay('ignored', 0, false)).toBe(timing.quietMaxMs)
    expect(gameScanDelay('ignored', 0, true)).toBe(timing.quietMaxMs)
    expect(gameScanDelay('known', 0, false)).toBe(timing.menuMs)
    expect(gameScanDelay('unknown', 9, true)).toBe(timing.menuMs)
    const looks = simulate(() => 'ignored', { until: 120_000, since: 0 })
    for (let index = 1; index < looks.length; index += 1) expect(looks[index]!.at - looks[index - 1]!.at).toBe(timing.quietMaxMs)
  })
})
