/**
 * The character's experience between levels: where a level starts (the table is incremental, src/profile/playerLevels.ts)
 * and which level a character could have reached in a given time at all.
 *
 * Player's report, 14.10.2026: «в PVE … 39 у моего ЧВК, в приложении отображается 59». Level 39 starts at 3 663 831
 * experience, level 59 at 16 720 667: 13 million more, more than every quest of the game together gives (about 10.7
 * million). Such a jump between two readings a few hours apart is a misread «3» (or another mode's screen), never play.
 */
import { PLAYER_LEVELS } from './playerLevels.js'
import { levelFromExperience, type PlayerLevelRow } from './playerProfileNormalizer.js'

/** Total experience at the start of `level` (the table is incremental). */
export function experienceAtLevel(level: number, levels: PlayerLevelRow[] = PLAYER_LEVELS) {
  return levels.filter((row) => row.level <= level).reduce((total, row) => total + Math.max(0, row.exp), 0)
}

/**
 * The most experience anyone gains in a short while (a pile of quests turned in at once: the biggest single reward is
 * 433 333) and in a day: the fastest players gain about 1–1.5 million a day early in a wipe. Both are well above what
 * play gives, so a level within reach is never refused; only jumps no play explains are.
 */
export const MAX_EXPERIENCE_BURST = 2_000_000
export const MAX_EXPERIENCE_PER_DAY = 4_000_000

/** A level known at a moment: Tarkov.dev's with its exact experience, or a game screen's. */
export interface KnownLevel { level: number; observedAt: string; experience?: number }

/**
 * Whether `level` at `at` can follow `from`: the experience from the most `from` can have had (Tarkov.dev's exact figure,
 * or just short of the next level) to the start of `level` is no more than the most anyone gains in that time. Lower
 * levels always can (a prestige, a wipe); unknown times are not judged.
 */
export function levelReachable(from: KnownLevel, level: number, at: string, levels: PlayerLevelRow[] = PLAYER_LEVELS) {
  if (level <= from.level) return true
  const since = Date.parse(at) - Date.parse(from.observedAt)
  if (!Number.isFinite(since)) return true
  const exact = from.experience !== undefined && from.experience > 0 && levelFromExperience(from.experience, levels) === from.level
  const nextLevel = levels.some((row) => row.level === from.level + 1)
  const had = exact ? from.experience! : nextLevel ? experienceAtLevel(from.level + 1, levels) - 1 : Infinity
  const needed = experienceAtLevel(level, levels) - had
  return needed <= MAX_EXPERIENCE_BURST + MAX_EXPERIENCE_PER_DAY * Math.max(0, since) / 86_400_000
}
