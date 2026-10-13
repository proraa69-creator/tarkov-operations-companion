/**
 * Quests turned in raise the level (owner, 13.10.2026: «после выхода в схрон он может сдать квесты и получить опыт от
 * торговцев… учитывай опыт и добавляй его, в том числе повышай уровень если его достаточно»). From the level's anchor (the
 * game's mode selection screen or Tarkov.dev, src/domain/types.ts LevelAnchor) the catalog experience of every quest the
 * logs show completed after it is added. Without Tarkov.dev's exact experience the anchor counts from the start of its
 * level, so the result is the level the player has at least — never a guess above it; the next reading corrects the rest.
 */
import { useEffect } from 'react'
import type { LevelAnchor, Quest, TaskProgressRecord } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { PLAYER_LEVELS } from './playerLevels'
import { levelFromExperience, type PlayerLevelRow } from './playerProfileNormalizer'

/** Total experience at the start of `level` (the table is incremental). */
export function experienceAtLevel(level: number, levels: PlayerLevelRow[] = PLAYER_LEVELS) {
  return levels.filter((row) => row.level <= level).reduce((total, row) => total + Math.max(0, row.exp), 0)
}

/**
 * The level with the experience of quests completed after the anchor. Only completions the logs dated (source 'eft-log')
 * count: their time is when the quest was turned in.
 */
export function levelWithQuestExperience(anchor: LevelAnchor, taskProgress: Record<string, TaskProgressRecord>, quests: Array<Pick<Quest, 'id' | 'experience'>>, levels: PlayerLevelRow[] = PLAYER_LEVELS) {
  const after = Date.parse(anchor.observedAt)
  if (!Number.isFinite(after)) return anchor.level
  const experience = new Map(quests.map((quest) => [quest.id, quest.experience ?? 0]))
  let gained = 0
  for (const record of Object.values(taskProgress)) {
    if (record.status !== 'completed' || record.source !== 'eft-log') continue
    const at = Date.parse(record.updatedAt)
    if (!Number.isFinite(at) || at <= after) continue
    gained += Math.max(0, experience.get(record.taskId) ?? 0)
  }
  if (!gained) return anchor.level
  const base = anchor.experience && levelFromExperience(anchor.experience, levels) === anchor.level ? anchor.experience : experienceAtLevel(anchor.level, levels)
  return Math.max(anchor.level, levelFromExperience(base + gained, levels))
}

/** The shown mode: its level follows the quests completed since its anchor (the catalog of that mode). */
export function useQuestExperienceLevel() {
  const state = useAppState()
  const { data, source } = useTarkovData()
  const progress = state.activeProfile.modes[state.raidMode]
  const anchor = progress.levelAnchor
  useEffect(() => {
    if (!anchor || source === 'demo') return
    const level = levelWithQuestExperience(anchor, progress.taskProgress, data.quests)
    if (level > progress.playerLevel) state.raisePlayerLevel(state.raidMode, level)
  // The state's functions change with every render; the inputs below decide.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, progress.taskProgress, progress.playerLevel, data.quests, source, state.raidMode])
}
