/**
 * Quests turned in raise the level (owner, 13.10.2026: «после выхода в схрон он может сдать квесты и получить опыт от
 * торговцев… учитывай опыт и добавляй его, в том числе повышай уровень если его достаточно»). From the level's anchor (the
 * game's mode selection screen or Tarkov.dev, src/domain/types.ts LevelAnchor) the catalog experience of every quest the
 * logs show completed after it is added. Without Tarkov.dev's exact experience the anchor counts from the start of its
 * level, so the result is the level the player has at least — never a guess above it; the next reading corrects the rest.
 *
 * Without an anchor (owner, 27.11.2026: «нижняя граница уровня по квестам»: no public profile, the game's screen not read)
 * the quests completed in the mode give the level the player has at least (levelProvenByQuests), until a reading or the
 * player's own entry («Указать уровень») replaces it.
 */
import { useEffect } from 'react'
import type { LevelAnchor, Quest, TaskProgressRecord } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { PLAYER_LEVELS } from './playerLevels'
import { levelFromExperience, type PlayerLevelRow } from './playerProfileNormalizer'
import { experienceAtLevel } from './levelExperience'

export { experienceAtLevel }

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

/**
 * The level the quests completed in the mode prove at least, for a mode nothing has the level of: the game gives a quest
 * only from its level, and its experience adds up — the higher of the highest level a completed quest asks for and the
 * level the experience of all of them reaches from nothing. Raids and the hideout's bonus give more on top, so the real
 * level is never below it. The prestige quests («Новое начало») do not count: the prestige they lead to starts the level
 * again. Any completion of the mode counts, as the app shows it (logs, the server, the player's marks).
 */
export function levelProvenByQuests(taskProgress: Record<string, TaskProgressRecord>, quests: Array<Pick<Quest, 'id' | 'level' | 'experience' | 'prestige'>>, levels: PlayerLevelRow[] = PLAYER_LEVELS) {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  let required = 1
  let gained = 0
  for (const record of Object.values(taskProgress)) {
    if (record.status !== 'completed') continue
    const quest = byId.get(record.taskId)
    if (!quest || quest.prestige != null) continue
    if (Number.isInteger(quest.level) && quest.level > required) required = quest.level
    if (quest.experience && quest.experience > 0) gained += quest.experience
  }
  return Math.max(required, levelFromExperience(gained, levels))
}

/**
 * The shown mode: its level follows the quests completed since its anchor (the catalog of that mode); without an anchor,
 * the level its completed quests prove at least (levelProvenByQuests).
 */
export function useQuestExperienceLevel() {
  const state = useAppState()
  const { data, source } = useTarkovData()
  const progress = state.activeProfile.modes[state.raidMode]
  const anchor = progress.levelAnchor
  useEffect(() => {
    if (source === 'demo') return
    if (!anchor) {
      // A catalog without quests proves nothing: the level would go and come back once they are there.
      if (!data.quests.length) return
      const level = levelProvenByQuests(progress.taskProgress, data.quests)
      if (level !== progress.playerLevel) state.estimatePlayerLevel(state.raidMode, level)
      return
    }
    const level = levelWithQuestExperience(anchor, progress.taskProgress, data.quests)
    if (level > progress.playerLevel) state.raisePlayerLevel(state.raidMode, level)
  // The state's functions change with every render; the inputs below decide.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, progress.taskProgress, progress.playerLevel, data.quests, source, state.raidMode])
}
