/** Two fresh readings within 10 seconds when each OCR pass takes at most 3 seconds. */
export const STORY_SCAN_TIMING = { menuMs: 1200, storyMs: 600, idleMs: 1500, quietMaxMs: 4000, rereadDetailMs: 1000, rereadMenuMs: 1800, screenshotMaxAgeMs: 10_000, stableReuseMs: 20_000 } as const

/**
 * The game is in front but shows none of the screens read here (a raid the logs did not report, the stash, a loading
 * screen): every such look waits longer — 1.2 s, then ×1.6 up to 4 s — so a raid costs a screen copy every few seconds
 * instead of almost every second (players, 13.10.2026: «Micro freezes», «мышь дёргается»). A recognised screen (story
 * pane, tasks, mode select, traders) brings back the quick pace.
 */
export function quietScanDelay(quietLooks: number) {
  return Math.min(STORY_SCAN_TIMING.quietMaxMs, Math.round(STORY_SCAN_TIMING.menuMs * Math.pow(1.6, Math.max(0, quietLooks - 1))))
}

export function reuseQuestReading(previous: { at: number; detail: boolean } | null, now: number, detail: boolean, same: boolean) {
  return Boolean(previous && same && previous.detail === detail && now >= previous.at
    && now - previous.at < (detail ? STORY_SCAN_TIMING.rereadDetailMs : STORY_SCAN_TIMING.rereadMenuMs))
}

/**
 * A screen that has not changed since it was read twice (the two readings that confirm a stage) is not read again: the
 * same pixels give the same text, and each whole-screen pass costs the processor about three seconds. Stash, traders,
 * the story pane being read — most of the time between raids — then cost nothing. Read again now and then all the same.
 */
export function reuseStableReading(previous: { at: number; detail: boolean; reads: number } | null, now: number, detail: boolean, unchanged: boolean) {
  return Boolean(previous && unchanged && previous.detail === detail && previous.reads >= 2 && now >= previous.at
    && now - previous.at < STORY_SCAN_TIMING.stableReuseMs)
}

/**
 * Two fine prints of the game's screen (about 120 × 68, 4 bytes a sample) show the same picture: no sample moved by
 * more than a little. A changed counter («2/5» → «3/5») moves its sample well past that.
 */
export function unchangedFrame(a: Uint8Array | null | undefined, b: Uint8Array) {
  if (!a || a.length !== b.length || !b.length) return false
  for (let index = 0; index < a.length; index += 4) {
    if (Math.abs(a[index]! - b[index]!) > 6 || Math.abs(a[index + 1]! - b[index + 1]!) > 6 || Math.abs(a[index + 2]! - b[index + 2]!) > 6) return false
  }
  return true
}
