/**
 * Two fresh readings within 10 seconds when each OCR pass takes at most 3 seconds. `quietMaxMs` is the slow pace of a
 * game screen that shows nothing read here; `raidMs` and `busyMs` are how soon the scanner asks again while the main
 * process holds the looks back (a likely raid, an item lookup or a Kappa scan running): those asks copy nothing.
 */
export const STORY_SCAN_TIMING = { menuMs: 1200, storyMs: 600, idleMs: 1500, quietMaxMs: 8000, raidMs: 5000, busyMs: 1500, rereadDetailMs: 1000, rereadMenuMs: 1800, screenshotMaxAgeMs: 10_000, stableReuseMs: 20_000 } as const

/**
 * What a look at the game showed: a screen read here (story pane, Tasks table, mode select, traders), one recognised
 * and passed over on purpose (the Tasks table of a mode whose logs hold every quest: src/import/logCoverage.ts), or none.
 */
export type GameScreen = 'known' | 'ignored' | 'unknown'

/**
 * The game is in front but shows none of the screens read here (the stash, the hideout, a raid the logs did not report,
 * a loading screen): every such look waits longer — 1.2 s, then ×1.6 up to 8 s — so a screen like that costs a screen
 * copy and a reading every 8 seconds instead of almost every second (players, 13.10.2026: «Micro freezes», «мышь
 * дёргается»; 14.10.2026: «при использовании приложения начинает тупить экран и мышка»). It never stops: a player who opens
 * «Задания» after an hour is read within the slow pace, and a recognised screen brings back the quick one.
 */
export function quietScanDelay(quietLooks: number) {
  return Math.min(STORY_SCAN_TIMING.quietMaxMs, Math.round(STORY_SCAN_TIMING.menuMs * Math.pow(1.6, Math.max(0, quietLooks - 1))))
}

/**
 * A new game window came (the game was started, or started again: another process and window than any seen before,
 * electron/experimental/gameWindow.ts): «Выбор профиля и режима» shows for a few seconds only, and a player who picks the
 * mode at once left it before a slow-pace gap was over (owner, 14.10.2026: «у многих людей первоначально не находит
 * персонажа»). This long after the window came, it is looked at at the quick pace. Alt+Tab back into the game or the
 * end of a raid is not a new window: no quick pace then (it ran for 3 minutes after every raid and every longer Alt+Tab).
 */
export const FRESH_GAME_MS = 90_000

/** The game window in front came `since` (its first sighting): still within the quick pace of a game start. */
export function isFreshGame(since: number | undefined, now: number) {
  return since !== undefined && Number.isFinite(since) && now >= since && now - since < FRESH_GAME_MS
}

/**
 * The pause before the next look at the game (outside a raid). A screen passed over on purpose is looked at again at the
 * slow pace, whatever else: it costs no quick reading. Otherwise a known screen and a game start keep the quick pace.
 */
export function gameScanDelay(screen: GameScreen, quietLooks: number, freshGame: boolean) {
  if (screen === 'ignored') return STORY_SCAN_TIMING.quietMaxMs
  return screen === 'known' || freshGame ? STORY_SCAN_TIMING.menuMs : quietScanDelay(quietLooks)
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

/** Mean per-channel difference (0–255) below which two prints count as the same picture (a little motion). */
const SAME_FRAME_DIFF = 3

/** Two prints show nearly the same picture: on average the samples moved by less than a few levels. */
export function similarFrame(a: Uint8Array | null | undefined, b: Uint8Array) {
  if (!a || a.length !== b.length || !b.length) return false
  let total = 0
  for (let index = 0; index < a.length; index += 4) {
    total += Math.abs(a[index]! - b[index]!) + Math.abs(a[index + 1]! - b[index + 1]!) + Math.abs(a[index + 2]! - b[index + 2]!)
  }
  return total / ((a.length / 4) * 3) < SAME_FRAME_DIFF
}
