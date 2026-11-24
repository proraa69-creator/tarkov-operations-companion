import type { RaidState } from '../import/raidState'

/**
 * Spam protection of «Видел» (owner, 17.11.2026: «нельзя несколько раз подряд поставить… раз в 10 минут. Либо если можешь
 * отслеживать, что человек вышел с рейда, отметил. Если он не заходил в следующий рейд, значит он не может отметить»).
 * The server allows one sighting an account every 10 minutes (server/src/routes/goons.ts); the PC app, which reads the
 * game's logs, also waits for a new raid after a sighting. A raid the app did not see (it was closed) cannot hold the
 * button for ever: after RAID_GATE_MAX_MS only the 10 minutes count.
 */
export const GOON_REPORT_EVERY_MS = 10 * 60_000
export const RAID_GATE_MAX_MS = 60 * 60_000

const RAID_KEY = 'raidos-last-raid-start-v1'

/** Remembers when the newest raid the logs showed started (called on every raid state the PC app gets). */
export function noteRaidStart(state: RaidState | null | undefined) {
  if (!state?.inRaid || !state.since) return
  try {
    const known = Number(localStorage.getItem(RAID_KEY)) || 0
    if (state.since > known) localStorage.setItem(RAID_KEY, String(state.since))
  } catch { /* storage blocked: the 10 minutes still hold */ }
}

export function lastRaidStart(): number {
  try { return Number(localStorage.getItem(RAID_KEY)) || 0 } catch { return 0 }
}

export type GoonReportBlock = { kind: 'wait'; minutes: number } | { kind: 'raid' } | null

/**
 * Whether «Видел» may send now. `lastOwnAt`: this player's newest sighting (any mode); `raidTracked`: the PC app follows the
 * game's logs; `raidStart`: the newest raid start it saw.
 */
export function goonReportBlock(input: { lastOwnAt?: number; raidTracked: boolean; raidStart: number; now: number }): GoonReportBlock {
  const { lastOwnAt, raidTracked, raidStart, now } = input
  if (!lastOwnAt) return null
  const since = now - lastOwnAt
  if (since < GOON_REPORT_EVERY_MS) return { kind: 'wait', minutes: Math.max(1, Math.ceil((GOON_REPORT_EVERY_MS - since) / 60_000)) }
  if (raidTracked && raidStart <= lastOwnAt && since < RAID_GATE_MAX_MS) return { kind: 'raid' }
  return null
}
