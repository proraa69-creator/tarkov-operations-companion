import type { ModeProgress, RaidMode } from '../domain/types'

const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

/**
 * The character level of each mode the app has read (owner, 15.11.2026, «Личный кабинет»: «если есть инфа, пиши
 * уровень в каждом режиме… ПВЕ, ПВП, сезонный и уровни»). A level counts only with its source (`levelAnchor`), as on
 * «Текущий профиль» (PlayerLoadoutSummary); a mode without one is left out.
 */
export function knownModeLevels(modes: Partial<Record<RaidMode, Pick<ModeProgress, 'playerLevel' | 'levelAnchor'>>>) {
  return MODES.flatMap((mode) => {
    const progress = modes[mode]
    const level = progress?.levelAnchor ? progress.playerLevel : 0
    return level > 0 ? [{ mode, level }] : []
  })
}
