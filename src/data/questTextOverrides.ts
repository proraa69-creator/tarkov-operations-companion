import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import type { AppDataset, MapMarker, Quest } from '../domain/types'

/**
 * Quest texts the owner corrected in the quest constructor (server/src/routes/questTexts.ts; owner, 13.10.2026: «в
 * нижнем окне квеста могу редактировать описание»). Every player's app lays them over the catalog in its interface
 * language (DataProvider → `data`, so the quest sheet on the map, the quests page and the minimap all get them):
 * - `name`: the quest's title as the apps show it (owner, 16.10.2026: «все надписи в этом квесте»); also the title of
 *   its map points;
 * - `description`: the quest's description;
 * - `objective`: one objective's line (`target` = objective id), also the text of that objective's map points;
 * - `stage-title` / `stage-description`: a story chapter stage (`target` = stage index), also its points' text.
 * The same in every game mode, like the corrected points (src/data/questPointOverrides.ts).
 */
export type QuestTextField = 'name' | 'description' | 'objective' | 'stage-title' | 'stage-description'
export type QuestTextLang = 'ru' | 'en'

export interface QuestTextOverride {
  id: string
  questId: string
  field: QuestTextField
  target: string
  lang: QuestTextLang
  text: string
  /** Owner app only (the public list has no author). */
  updatedBy?: string
  updatedAt?: string
}

export type QuestTextInput = Pick<QuestTextOverride, 'questId' | 'field' | 'target' | 'lang' | 'text'>

export const QUEST_TEXTS_KEY = ['quest-text-overrides'] as const
export const QUEST_TEXT_MAX_LENGTH = 2000
/** A quest title: one line (server/src/routes/questTexts.ts). */
export const QUEST_NAME_MAX_LENGTH = 120
const FIELDS: readonly QuestTextField[] = ['name', 'description', 'objective', 'stage-title', 'stage-description']
/** One shared empty list, so the dataset keeps its identity while nothing is corrected. */
const NONE: QuestTextOverride[] = []

export function parseQuestTextOverrides(answer: unknown): QuestTextOverride[] {
  const list = (answer as { overrides?: unknown } | null)?.overrides
  if (!Array.isArray(list)) return NONE
  const parsed = list.flatMap((entry): QuestTextOverride[] => {
    const row = entry as Partial<QuestTextOverride>
    if (typeof row.id !== 'string' || typeof row.questId !== 'string' || typeof row.target !== 'string' || typeof row.text !== 'string' || !row.text) return []
    if (!FIELDS.includes(row.field as QuestTextField) || (row.lang !== 'ru' && row.lang !== 'en')) return []
    return [{
      id: row.id, questId: row.questId, field: row.field as QuestTextField, target: row.target, lang: row.lang, text: row.text,
      ...(typeof row.updatedBy === 'string' ? { updatedBy: row.updatedBy } : {}),
      ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}),
    }]
  })
  return parsed.length ? parsed : NONE
}

/** The correction of one field in one language, if any. */
export function findQuestText(overrides: QuestTextOverride[], questId: string, field: QuestTextField, target: string, lang: QuestTextLang) {
  return overrides.find((entry) => entry.questId === questId && entry.field === field && entry.target === target && entry.lang === lang)
}

/** The quests and quest points with the owner's texts of this language; the same dataset object when there are none. */
export function withQuestTextOverrides(dataset: AppDataset, overrides: QuestTextOverride[], lang: QuestTextLang): AppDataset {
  const mine = overrides.filter((entry) => entry.lang === lang)
  if (!mine.length) return dataset
  const byQuest = new Map<string, QuestTextOverride[]>()
  for (const entry of mine) byQuest.set(entry.questId, [...(byQuest.get(entry.questId) ?? []), entry])
  const quests = dataset.quests.map((quest) => {
    const texts = byQuest.get(quest.id)
    return texts ? questWithTexts(quest, texts) : quest
  })
  const questsById = new Map(quests.map((quest) => [quest.id, quest]))
  const originalNames = new Map(dataset.quests.map((quest) => [quest.id, quest.name]))
  const markers = dataset.markers.map((marker) => {
    const texts = marker.questId ? byQuest.get(marker.questId) : undefined
    return texts ? markerWithTexts(marker, texts, questsById.get(marker.questId!), originalNames.get(marker.questId!)) : marker
  })
  return { ...dataset, quests, markers }
}

function questWithTexts(quest: Quest, texts: QuestTextOverride[]): Quest {
  const text = (field: QuestTextField, target: string) => texts.find((entry) => entry.field === field && entry.target === target)?.text
  const next: Quest = { ...quest }
  // The game's own title stays readable on the game's screens (src/import/questOcr.ts matches ocrAliases too).
  const name = text('name', '')
  if (name && name !== quest.name) Object.assign(next, { name, ocrAliases: [...new Set([...(quest.ocrAliases ?? []), quest.name])] })
  const description = text('description', '')
  if (description) next.description = description
  if (quest.objectiveDetails?.some((objective) => text('objective', objective.id))) {
    next.objectiveDetails = quest.objectiveDetails.map((objective) => {
      const line = text('objective', objective.id)
      return line ? { ...objective, description: line } : objective
    })
  }
  if (quest.objectiveIds?.length && quest.objectives.some((_, index) => text('objective', quest.objectiveIds![index] ?? ''))) {
    next.objectives = quest.objectives.map((line, index) => text('objective', quest.objectiveIds![index] ?? '') ?? line)
  }
  if (quest.stages?.some((_, index) => text('stage-title', String(index)) || text('stage-description', String(index)))) {
    next.stages = quest.stages.map((stage, index) => {
      const title = text('stage-title', String(index))
      const body = text('stage-description', String(index))
      return title || body ? { ...stage, ...(title ? { title } : {}), ...(body ? { description: body } : {}) } : stage
    })
  }
  return next
}

/**
 * A point's text follows its objective (tarkov.dev points) or its story stage (description, else the title); a point
 * titled with the quest's name takes the corrected name.
 */
function markerWithTexts(marker: MapMarker, texts: QuestTextOverride[], quest: Quest | undefined, originalName: string | undefined): MapMarker {
  const named = quest && originalName && quest.name !== originalName && marker.title === originalName ? { ...marker, title: quest.name } : marker
  return markerTextOf(named, texts, quest)
}

function markerTextOf(marker: MapMarker, texts: QuestTextOverride[], quest: Quest | undefined): MapMarker {
  if (marker.objectiveId) {
    const line = texts.find((entry) => entry.field === 'objective' && entry.target === marker.objectiveId)?.text
    return line ? { ...marker, description: line } : marker
  }
  if (marker.stageIndex != null && quest?.stages?.[marker.stageIndex]) {
    const corrected = texts.some((entry) => (entry.field === 'stage-title' || entry.field === 'stage-description') && entry.target === String(marker.stageIndex))
    const stage = quest.stages[marker.stageIndex]
    return corrected ? { ...marker, description: stage.description || stage.title } : marker
  }
  return marker
}

/** The owner's text corrections (refreshed every 10 minutes and at once on a change); empty without a server. */
export function useQuestTextOverrides(enabled = true) {
  const query = useQuery({
    queryKey: QUEST_TEXTS_KEY,
    queryFn: async () => {
      const request = serviceClient()
      if (!request) return NONE
      if (isOwnerApp()) {
        try { return parseQuestTextOverrides(await request('GET', '/v1/accounts/me/admin/quest-texts')) } catch { /* not the owner's session: the public list */ }
      }
      return parseQuestTextOverrides(await request('GET', '/v1/quest-texts'))
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  })
  return query.data ?? NONE
}

/** Owner app only: save / reset a text. The server refuses everybody but the owner's account. */
export function useQuestTextWriter() {
  const client = useQueryClient()
  const store = useCallback((overrides: QuestTextOverride[]) => client.setQueryData(QUEST_TEXTS_KEY, overrides), [client])
  const save = useCallback(async (input: QuestTextInput) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    store(parseQuestTextOverrides(await request('PUT', '/v1/accounts/me/admin/quest-texts', input)))
  }, [store])
  const reset = useCallback(async (id: string) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    store(parseQuestTextOverrides(await request('POST', `/v1/accounts/me/admin/quest-texts/${id}/remove`)))
  }, [store])
  return { save, reset }
}
