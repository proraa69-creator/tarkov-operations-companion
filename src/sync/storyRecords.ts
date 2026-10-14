import type { ModeProgress, Quest } from '../domain/types'
import { ENTITY_ID_PATTERN } from '../progression/objectiveProgress'

/**
 * Story chapters through the server (audit P9): the game does not log them, so only the PC whose screen read a chapter
 * knew it. The server keeps, per character, each chapter's status, its stage (the catalog's stage id — a stage number
 * would move when the catalog gains a stage) and the time of the reading; a second PC and the phone show them too.
 */
export interface StoryRecord { chapterId: string; status: 'active' | 'completed'; stageId?: string; updatedAt: string }

/** A chapter record of the app's quest map (src/state/AppState.tsx applyRemoteStoryForMode). */
export interface StoryProgressRecord { taskId: string; status: 'active' | 'completed'; updatedAt: string; currentStageIndex?: number }

type StoryQuest = Pick<Quest, 'id' | 'kind'> & { stages?: Array<{ id: string }> }

const validTime = (value: string) => Number.isFinite(Date.parse(value))

/** This app's readings of the catalog's story chapters in one mode, as the server keeps them. */
export function storyRecordsOf(progress: Pick<ModeProgress, 'taskProgress'>, quests: readonly StoryQuest[]): StoryRecord[] {
  const records: StoryRecord[] = []
  for (const quest of quests) {
    if (quest.kind !== 'story' || !ENTITY_ID_PATTERN.test(quest.id)) continue
    const record = progress.taskProgress[quest.id]
    if (!record || record.status === 'failed' || !validTime(record.updatedAt)) continue
    const stageId = record.currentStageIndex == null ? undefined : quest.stages?.[record.currentStageIndex]?.id
    records.push({
      chapterId: quest.id, status: record.status === 'completed' ? 'completed' : 'active',
      ...(stageId && ENTITY_ID_PATTERN.test(stageId) ? { stageId } : {}), updatedAt: new Date(record.updatedAt).toISOString(),
    })
  }
  return records
}

/** The server's chapters as records of the app: chapters and stages the catalog knows; an unknown stage keeps the status. */
export function storyProgressRecords(records: readonly StoryRecord[], quests: readonly StoryQuest[]): StoryProgressRecord[] {
  const byId = new Map(quests.filter((quest) => quest.kind === 'story').map((quest) => [quest.id, quest]))
  return records.flatMap((record): StoryProgressRecord[] => {
    const quest = byId.get(record.chapterId)
    if (!quest) return []
    const index = record.stageId ? quest.stages?.findIndex((stage) => stage.id === record.stageId) ?? -1 : -1
    return [{ taskId: quest.id, status: record.status, updatedAt: record.updatedAt, ...(index >= 0 ? { currentStageIndex: index } : {}) }]
  })
}

/** The server's answer (GET/POST /v1/me/story/:mode), checked: null without a character. */
export function parseStoryAnswer(value: unknown): { characterId: string; records: StoryRecord[] } | null {
  const answer = value as { characterId?: unknown; records?: unknown } | null
  if (!answer || typeof answer.characterId !== 'string' || !/^[a-f0-9]{24}$/i.test(answer.characterId) || !Array.isArray(answer.records)) return null
  const records = answer.records.flatMap((entry): StoryRecord[] => {
    const record = entry as Partial<StoryRecord> | null
    if (!record || typeof record.chapterId !== 'string' || !ENTITY_ID_PATTERN.test(record.chapterId)) return []
    if ((record.status !== 'active' && record.status !== 'completed') || typeof record.updatedAt !== 'string' || !validTime(record.updatedAt)) return []
    const stageId = typeof record.stageId === 'string' && ENTITY_ID_PATTERN.test(record.stageId) ? record.stageId : undefined
    return [{ chapterId: record.chapterId, status: record.status, ...(stageId ? { stageId } : {}), updatedAt: new Date(record.updatedAt).toISOString() }]
  })
  return { characterId: answer.characterId, records }
}
