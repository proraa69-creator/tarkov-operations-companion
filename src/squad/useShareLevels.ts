/**
 * «Информация о друге» (owner, 12.10.2026: «уровни во всех режимах, значок престижа»): the desktop app shares its own
 * level in every mode with the signed-in account (PUT /v1/me/levels), and friends see that before the public Tarkov.dev
 * profile, which the server often cannot reach and which stays stale until somebody opens it on tarkov.dev.
 *
 * - Only a level the app knows: a mode with a level anchor — the game's «Выбор профиля и режима» or traders' screen, or
 *   Tarkov.dev looked up from this PC (src/domain/progress.ts) — raised by the quest experience since
 *   (src/profile/questExperience.ts). The prestige comes only from the mode's Tarkov.dev profile; without one it is null
 *   (unknown: friends see no badge). PvP, PvE and Season each go as their own.
 * - The desktop app only: the phone reads no game screens and never overwrites what the PC shared.
 * - Once after start (or sign-in) and whenever a value changes, a few seconds after the last change. No polling.
 */
import { useEffect, useRef } from 'react'
import type { ModeProgress, RaidMode } from '../domain/types'
import { isDesktopShell } from '../platform'
import { cleanIpcError, refreshServerStatus, useServerStatus } from '../sync/serverSync'

export const SHARE_LEVELS_PATH = '/v1/me/levels'
/** Quiet time after the last change: at start the screen, Tarkov.dev and the quests settle the levels within seconds. */
export const SHARE_LEVELS_DELAY_MS = 5_000
/** What the server takes (server/src/routes/me.ts): the game's level cap and a sane prestige range. */
const MAX_LEVEL = 79
const MAX_PRESTIGE = 10
const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

export interface SharedModeLevel { level: number; prestige: number | null; observedAt: string }
export type SharedModeLevels = Partial<Record<RaidMode, SharedModeLevel>>
type LevelState = Pick<ModeProgress, 'playerLevel' | 'levelAnchor' | 'prestige' | 'playerSnapshot'>

/** Each mode's level as this app knows it, in the server's shape; a mode without a known level is left out. */
export function sharedLevelsOf(modes: Record<RaidMode, LevelState>): SharedModeLevels {
  const shared: SharedModeLevels = {}
  for (const mode of MODES) {
    const progress = modes[mode]
    const anchor = progress?.levelAnchor
    if (!anchor) continue
    // The level the player sees here: the anchor's, or higher by the quests handed in since.
    const level = progress.playerLevel
    const observedAt = Date.parse(anchor.observedAt)
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL || !Number.isFinite(observedAt)) continue
    // The game's screens show no prestige: only a Tarkov.dev profile of this mode knows it.
    const prestige = progress.playerSnapshot && Number.isInteger(progress.prestige) && progress.prestige >= 0 && progress.prestige <= MAX_PRESTIGE ? progress.prestige : null
    shared[mode] = { level, prestige, observedAt: new Date(observedAt).toISOString() }
  }
  return shared
}

/** PUT /v1/me/levels through the desktop gateway; false when it did not get through (tried again on the next change). */
export async function shareLevels(levels: SharedModeLevels): Promise<boolean> {
  const request = window.tarkovDesktop?.serviceRequest
  if (!request) return false
  try {
    return (await request('PUT', SHARE_LEVELS_PATH, { modes: levels })) != null
  } catch (error) {
    // The server stopped or the session expired: the account status says so, and coming back online sends again.
    if (/недоступен|Сессия истекла/i.test(cleanIpcError(error))) void refreshServerStatus()
    return false
  }
}

/** Mounted once (AppShell) with the active profile's modes. */
export function useShareLevels(modes: Record<RaidMode, LevelState>) {
  const status = useServerStatus()
  // Which account gets them: a new sign-in sends again. The e-mail only tells accounts apart here, it is not sent.
  const account = isDesktopShell() && status?.signedIn && status.online ? status.email ?? 'signed-in' : ''
  const levels = account ? JSON.stringify(sharedLevelsOf(modes)) : '{}'
  const sent = useRef('')
  useEffect(() => {
    const key = `${account}\n${levels}`
    if (!account || levels === '{}' || sent.current === key) return
    const timer = window.setTimeout(() => {
      void shareLevels(JSON.parse(levels) as SharedModeLevels).then((ok) => { if (ok) sent.current = key })
    }, SHARE_LEVELS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [account, levels])
}
