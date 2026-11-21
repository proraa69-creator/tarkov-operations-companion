import type { ProgressSource, Quest, TaskRequirement } from '../domain/types'

/**
 * The sources a decision of the quest-state engine can carry (src/quests/questEngine.ts): the logs (this PC's and the
 * server's), «Ручная отметка», the screen (Tasks table in PvE, story pane) and legacy manual records. One list for every
 * reader.
 */
export const TRACKED_SOURCES: ReadonlySet<string> = new Set<ProgressSource>(['eft-log', 'manual', 'manual-fix', 'screen-scan'])

/** Only an explicit USEC/BEAR restriction counts; «Any» (or its translation) means everyone. */
export function questFaction(value: string | undefined): 'usec' | 'bear' | undefined {
  const key = value?.trim().toLowerCase() ?? ''
  if (/^(usec|юсек)$/.test(key)) return 'usec'
  if (/^(bear|беар|бир)$/.test(key)) return 'bear'
  return undefined
}

/** The records the game itself wrote: its logs, its screen, a game profile. A mark by hand or a guess tells no faction. */
const GAME_SOURCES: ReadonlySet<string> = new Set<ProgressSource>(['eft-log', 'screen-scan', 'profile-import'])

/**
 * The player's faction for this mode: the profile's, else the one of a USEC- or BEAR-only quest the game says the player
 * took (report №191, Season: «Квестов почему то два, награда тоже разная» — «Обновка» and «Текстиль» come once for each
 * faction, and without a profile both were shown). What the game wrote decides first: with the faction unknown both
 * variants are on screen, and a player marking a chain by hand marks both (report №213: the logs all BEAR, «Оружейник»
 * of both factions and two USEC quests marked by hand, «Обновка. Часть 1» shown twice). Marks by hand count only when the
 * game told nothing. Unknown when neither tells.
 */
export function playerFaction(progress: { faction: 'usec' | 'bear' | 'unknown'; taskProgress: Readonly<Record<string, { status: string; source?: string } | undefined>> }, quests: readonly { id: string; faction?: string }[]): 'usec' | 'bear' | 'unknown' {
  if (progress.faction !== 'unknown') return progress.faction
  const fromGame = new Set<'usec' | 'bear'>()
  const seen = new Set<'usec' | 'bear'>()
  for (const quest of quests) {
    const faction = questFaction(quest.faction)
    const record = faction ? progress.taskProgress[quest.id] : undefined
    if (!faction || !record) continue
    seen.add(faction)
    if (record.source && GAME_SOURCES.has(record.source)) fromGame.add(faction)
  }
  // both seen: a wrong reading somewhere, so neither is certain
  const told = fromGame.size ? fromGame : seen
  return told.size === 1 ? [...told][0]! : 'unknown'
}

/** The quests of the player's faction (and of any): the other faction's own quests left out when the faction is known. */
export function ofFaction<T extends { faction?: string }>(quests: readonly T[], faction: 'usec' | 'bear' | 'unknown'): T[] {
  if (faction === 'unknown') return [...quests]
  return quests.filter((quest) => { const own = questFaction(quest.faction); return !own || own === faction })
}

export function isLiveGameQuest(quest: { id: string; kind?: string; storyChapterId?: string }) {
  return Boolean(quest.id) && !quest.id.startsWith('wiki:') && quest.kind !== 'story' && !quest.storyChapterId
}

/**
 * The quest's prerequisites. A tarkov.dev task brings its own list, and an empty one means «none»: the wiki's «Предыдущий
 * квест» (filled into `previous` for such tasks) describes older chains — «Всей этой швали...» has no requirement in
 * tarkov.dev, but its wiki chain made 9 Jaeger quests «completed» for an account that had done 2. Only quests without
 * tarkov.dev data (wiki pages) use `previous`.
 */
export function questRequirements(quest: Pick<Quest, 'requirements' | 'previous'>): TaskRequirement[] {
  if (quest.requirements) return quest.requirements
  return (quest.previous ?? []).map((taskId) => ({
    taskId,
    allowedStatuses: ['complete'] as Array<'complete' | 'failed' | 'active'>,
  }))
}

/** A mandatory «complete this first» requirement (not one of a group of alternatives, not «taken» or «failed»). */
export const isCompletionOnly = (requirement: TaskRequirement) => !requirement.group && (requirement.allowedStatuses.length === 0 || requirement.allowedStatuses.every((status) => status === 'complete'))
