import type { ModeProgress, Quest, StoryObjectiveReading } from '../domain/types'
import { foldOcrGlyphs, matchQuestsFromOcr, ocrKey } from './questOcr'
import { isTasksMenuText } from './screenScanSync'
import { completedStoryStageIndexes, hasExactStoryStageEvidence, storyObjectivesBlock, storyStageCopies } from './storyStageOcr'
import { readStoryObjectives } from './storyObjectives'
import { storyPaneText, type StoryPaneReading } from './storyPaneLayout'

export interface StoryScanMatch {
  questId: string
  stageIndex?: number
  completedStageIndexes?: number[]
  stageConfirmed?: boolean
  objectives?: StoryObjectiveReading[]
  /**
   * Stages with the same title as a read stage (the read stage itself included), keyed by the read index; only for
   * repeated titles. Resolved against the saved stage by applyStoryScan, never saved.
   */
  stageCopies?: Record<number, number[]>
  /**
   * The pane header names this chapter («ИСТОРИЯ / Небеса в огне») with the status «АКТИВНО»: the account has it,
   * even when the catalog does not know the wording of its current objective yet.
   */
  active?: boolean
}

/**
 * The chapter whose pane is open and whether the header says «АКТИВНО». The header is the line «ИСТОРИЯ» (OCR may clip
 * it to «ТОРИЯ») with the chapter name on it or right under it. Only an exact name counts: never a word of the story.
 */
export function storyPaneChapter(text: string, story: Quest[]): { quest: Quest; active: boolean } | undefined {
  // The header sits on banner art: OCR puts junk before «ИСТОРИЯ» («> ИСТОРИЯ >. a.») and after the name («Typ > tgs»).
  const lines = text.slice(0, 20000).split(/\r?\n/).map((line) => line.trim().replace(/^[^\p{L}]+/u, '')).filter(Boolean)
  const names = story.map((quest) => ({ quest, keys: [quest.name, quest.normalizedName ?? ''].map(ocrKey).filter((key) => key.length >= 3) }))
  const STATUS = /(?:^|\s)(?:активно|active|выполнено|завершено|completed)(?=\s|$)/gi
  const isActive = (line: string) => /(?:^|\s)(?:активно|active)(?=\s|$)/i.test(foldOcrGlyphs(line).toLowerCase())
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index]!.match(/^(?:история|[а-яё]{0,2}тория|story)(?=\s|$)(.*)$/i)
    if (!header) continue
    const window = [header[1]!, ...lines.slice(index + 1, index + 3)]
    for (const candidate of window) {
      const found = titleKeys(candidate.replace(STATUS, ' ')).map((key) => names.find((entry) => entry.keys.some((name) => sameTitle(name, key))))
        .find(Boolean)
      if (found) return { quest: found.quest, active: [lines[index]!, ...lines.slice(index + 1, index + 4)].some(isActive) }
    }
  }
  return undefined
}

/** The chapter name at the start of a header line: the whole line, then its first one to four words (junk follows). */
function titleKeys(line: string) {
  const words = line.split(/\s+/).filter((word) => /\p{L}/u.test(word))
  const keys = [ocrKey(line), ...words.slice(0, 4).map((_, index) => ocrKey(words.slice(0, index + 1).join(' ')))]
  return [...new Set(keys.filter((key) => key.length >= 3))]
}

/** One OCR slip is allowed in a long name («Небеса в огне» read with a Latin «r»); short names must match exactly. */
function sameTitle(name: string, key: string) {
  if (name === key) return true
  if (name.length < 6 || Math.abs(name.length - key.length) > 1) return false
  let a = 0
  let b = 0
  let slips = 0
  while (a < name.length && b < key.length) {
    if (name[a] === key[b]) { a += 1; b += 1; continue }
    slips += 1
    if (slips > 1) return false
    if (name.length > key.length) a += 1
    else if (key.length > name.length) b += 1
    else { a += 1; b += 1 }
  }
  return slips + (name.length - a) + (key.length - b) <= 1
}

/** The copy of a repeated stage meant at `reference`: progress never goes back, so the first copy not before it. */
export function nearestStageCopy(copies: number[], reference: number) {
  const sorted = [...copies].sort((a, b) => a - b)
  return sorted.find((index) => index >= reference) ?? sorted[sorted.length - 1]!
}

/** The story tab / chapter pane of the Tasks menu is on screen. */
export function isStoryMenuText(text: string) {
  if (!isTasksMenuText(text)) return false
  return /сюжетн|истори|тори[яи]|главн(?:ые|ая)\s*задач|(?<![а-яё])[а-яё]{0,4}ные\s*задачи|иональн[а-яё]*\s*задачи/i.test(text)
}

/** Story chapters named on a story-menu frame; trader quests are left to the game logs. */
export function matchStoryChapters(screen: string, quests: Quest[], parts?: StoryPaneReading): StoryScanMatch[] {
  // The pane read part by part (electron/screenOcr.ts) replaces the whole-screen text: no merged columns, the real title.
  if (!parts && !isStoryMenuText(screen)) return []
  const text = parts ? storyPaneText(parts) : screen
  const story = quests.filter((quest) => quest.kind === 'story')
  const matches = matchQuestsFromOcr(text, story)
    .filter((match) => story.some((quest) => quest.id === match.questId))
    .map(({ questId, stageIndex }) => {
      const quest = story.find((entry) => entry.id === questId)!
      const exactEvidence = stageIndex != null && hasExactStoryStageEvidence(text, quest, stageIndex)
      const completedStageIndexes = completedStoryStageIndexes(text, quest)
      const objectives = exactEvidence ? readStoryObjectives(text, quest) : undefined
      // Text that more than one stage shows (repeated objectives): every candidate copy, resolved by applyStoryScan.
      const stageCopies: Record<number, number[]> = {}
      const readings: Array<[number | undefined, string]> = [[exactEvidence ? stageIndex : undefined, storyObjectivesBlock(text)],
        ...(objectives ?? []).map((objective): [number | undefined, string] => [objective.stageIndex, objective.text])]
      for (const [index, visible] of readings) {
        if (index == null) continue
        const copies = [...new Set([...(stageCopies[index] ?? []), ...storyStageCopies(quest, index, visible)])].sort((a, b) => a - b)
        if (copies.length > 1) stageCopies[index] = copies
      }
      return {
        questId,
        // Loose word overlap can identify a chapter, but cannot change its saved stage.
        stageIndex: exactEvidence ? stageIndex : undefined,
        ...(objectives ? { objectives } : {}),
        ...(completedStageIndexes.length ? { completedStageIndexes } : {}),
        ...(Object.keys(stageCopies).length ? { stageCopies } : {}),
      }
    })
  const pane = storyPaneChapter(text, story)
  if (pane) {
    // The header names the open chapter: only it can carry a stage or objectives on this frame.
    const own: StoryScanMatch = matches.find((match) => match.questId === pane.quest.id) ?? { questId: pane.quest.id }
    if (pane.active) {
      own.active = true
      if (!own.objectives?.length) {
        const objectives = readStoryObjectives(text, pane.quest)
        if (objectives.length) own.objectives = objectives
      }
    }
    return [own, ...matches.filter((match) => match.questId !== pane.quest.id).map(({ questId }) => ({ questId }))]
  }
  // A frame has one open objective pane. Shared wording must not advance two chapters.
  return matches.filter(match => match.stageIndex != null).length > 1
    ? matches.map(({ questId }) => ({ questId })) : matches
}

/**
 * Which copy of a repeated stage the pane shows. With a saved stage: the first copy not before it (progress never goes
 * back). Without one: the last copy not after the earliest optional objective that names a single stage (optional
 * objectives belong to the stage being played or a later one). Otherwise unknown.
 */
function resolveStageCopy(match: StoryScanMatch, savedStage: number | undefined): number | undefined {
  const read = match.stageIndex
  if (read == null) return undefined
  const copies = match.stageCopies?.[read]
  if (!copies) return read
  if (savedStage != null) return nearestStageCopy(copies, savedStage)
  const bound = Math.min(...(match.objectives ?? []).filter((objective) => objective.optional && objective.stageIndex != null
    && !match.stageCopies?.[objective.stageIndex]).map((objective) => objective.stageIndex!))
  if (!Number.isFinite(bound)) return undefined
  const before = copies.filter((index) => index <= bound)
  return before.length ? before[before.length - 1] : undefined
}

/** Repeated objectives point at the copy of their stage that belongs to `stage` (its map, its point). */
function placeObjectives(match: StoryScanMatch, stage: number | undefined) {
  if (!match.objectives?.length) return undefined
  return match.objectives.map((objective) => {
    const copies = objective.stageIndex != null ? match.stageCopies?.[objective.stageIndex] : undefined
    return copies && stage != null ? { ...objective, stageIndex: nearestStageCopy(copies, stage) } : objective
  })
}

/**
 * A chapter seen on the story pane is the one being played, at the stage the pane shows.
 * Chapters already finished stay finished — the pane can show any chapter the player clicks.
 */
export function applyStoryScan(progress: ModeProgress, matches: StoryScanMatch[], now = new Date().toISOString()): ModeProgress {
  let taskProgress = progress.taskProgress
  for (const match of matches) {
    const current = taskProgress[match.questId]
    if (current?.status === 'completed') continue
    if (match.stageIndex != null && (!Number.isInteger(match.stageIndex) || match.stageIndex < 0)) continue
    const savedStage = current?.currentStageIndex
    // A repeated title is the copy at or after the saved stage, not the first one in the chapter.
    let stageIndex = resolveStageCopy(match, savedStage)
    if (stageIndex == null) {
      // A sidebar can list locked chapters too; its title alone is not an active account quest. The open pane of an
      // «АКТИВНО» chapter is: publish what it shows, keep the saved stage.
      if (!match.active || !match.objectives?.length || (current && current.updatedAt > now)) continue
      const objectives = placeObjectives(match, savedStage)
      if (current?.status === 'active' && JSON.stringify(current.storyObjectives) === JSON.stringify(objectives)) continue
      taskProgress = { ...taskProgress, [match.questId]: { ...current, taskId: match.questId, status: 'active', source: 'screen-scan', updatedAt: now,
        ...(objectives ? { storyObjectives: objectives } : {}) } }
      continue
    }
    if (savedStage != null && stageIndex != null && stageIndex > savedStage) {
      const completed = new Set(match.completedStageIndexes ?? [])
      // A newly opened adjacent objective may hide the previous one. Two independent, exact
      // readings can confirm that single transition; larger jumps need every skipped stage.
      let verified = true
      for (let index = savedStage; index < stageIndex; index += 1) if (!completed.has(index)) verified = false
      if (!verified && !(stageIndex === savedStage + 1 && match.stageConfirmed)) {
        if (!match.objectives?.length) continue
        // Visible objectives are a snapshot, not proof that every earlier stage was completed.
        stageIndex = savedStage
      }
    }
    if (current && current.updatedAt > now) continue
    const objectives = placeObjectives(match, stageIndex) ?? current?.storyObjectives
    if (current?.status === 'active' && current.currentStageIndex === stageIndex
      && JSON.stringify(current.storyObjectives) === JSON.stringify(objectives)) continue
    taskProgress = {
      ...taskProgress,
      [match.questId]: { ...current, taskId: match.questId, status: 'active', source: 'screen-scan', updatedAt: now, currentStageIndex: stageIndex,
        ...(objectives ? { storyObjectives: objectives } : {}) },
    }
  }
  return taskProgress === progress.taskProgress ? progress : { ...progress, taskProgress }
}

export interface StoryConfirmation {
  context: string
  observedAt: number
  matches: StoryScanMatch[]
}

/** A cached reading and a reading from another profile/mode are never a second confirmation. */
export function confirmStoryFrame(previous: StoryConfirmation | null, context: string, observedAt: number, matches: StoryScanMatch[]) {
  const fresh = Number.isFinite(observedAt) && (!previous || observedAt > previous.observedAt)
  const confirmed = fresh && previous?.context === context ? matches.filter((match) => previous.matches.some((entry) => (
    entry.questId === match.questId && entry.stageIndex === match.stageIndex
    && JSON.stringify(entry.completedStageIndexes ?? []) === JSON.stringify(match.completedStageIndexes ?? [])
    && objectiveShape(entry.objectives) === objectiveShape(match.objectives)
  ))).map((match) => ({ ...match, stageConfirmed: match.stageIndex != null })) : []
  return { confirmed, state: fresh ? { context, observedAt, matches } : previous }
}

/** What two readings must agree on: which objectives, which stage, done or not. A hint OCR read differently is noise. */
function objectiveShape(objectives: StoryObjectiveReading[] | undefined) {
  return JSON.stringify((objectives ?? []).map(({ id, optional, completed, stageIndex, current, total }) => [id, optional, completed, stageIndex ?? null, current ?? null, total ?? null]))
}
