/**
 * Signs of a raid besides the game's logs, for the quest scanner (electron/screenOcr.ts). Without a watched Logs folder the
 * app could not tell a raid at all, and the scanner copied and read the game's whole screen through every raid; the logs
 * also miss offline and training raids. What the app does see:
 *   - a new screenshot with coordinates in its name: the game writes coordinates only in a raid;
 *   - movement keys held (W A S D, at two looks in a row: typing does not hold a key that long) — a raid or the hideout,
 *     neither of them a screen the scanner reads.
 * While one of them holds, the scanner takes no screen copy at all. A raid end in the logs clears them.
 */
export const RAID_SIGNAL_MS = { screenshot: 3 * 60_000, movement: 30_000 } as const

export type RaidSignal = keyof typeof RAID_SIGNAL_MS

export interface RaidSignals {
  /** When each sign was seen last. */
  at: Partial<Record<RaidSignal, number>>
}

/**
 * Whether a raid is likely now: one of the signs was seen lately. They come and go, so they count with a watched Logs
 * folder too (an offline raid the logs miss).
 */
export function raidSignalActive(signals: RaidSignals, now: number) {
  return (Object.keys(RAID_SIGNAL_MS) as RaidSignal[]).some((kind) => {
    const at = signals.at[kind]
    return at !== undefined && now >= at && now - at < RAID_SIGNAL_MS[kind]
  })
}

const signals: RaidSignals = { at: {} }

export function noteRaidSignal(kind: RaidSignal, at = Date.now()) {
  if (!Number.isFinite(at)) return
  signals.at[kind] = Math.max(signals.at[kind] ?? 0, at)
}

/** The logs report the raid over: what was seen before it no longer counts. */
export function clearRaidSignals() {
  signals.at = {}
}

/** `logsWatched` is kept for the callers (screenOcr.ts); since the minimap went no sign depends on it. */
export function raidLikely(now = Date.now(), options: { logsWatched?: boolean } = {}) {
  void options
  return raidSignalActive(signals, now)
}
