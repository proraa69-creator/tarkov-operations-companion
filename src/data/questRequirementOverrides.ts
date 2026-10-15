import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import type { AppDataset, CuratedRequirementKind, Item, MapMarker, Quest } from '../domain/types'

/**
 * Quest requirements the owner curated in the quest constructor (server/src/routes/questRequirements.ts; owner,
 * 15.10.2026: «функцию выбора предмета или ключа из каталога, что бы я в реальном времени мог добавить требование
 * квеста»). Every player's app merges them into the quests (DataProvider → `data.quests`), so the quest page, the
 * quest card under the map, «Требования рейда» on the Overview, the raid briefing and the item overlay all read them as
 * the quest's own `raidRequirements`:
 * - `add`: the quest needs `count` of the item for `kind`; when the catalog already has the same item for the same
 *   kind, the entry corrects its count (and «найден в рейде») and adds its comment instead of a second row;
 * - `hide`: the catalog's requirement of that item and kind is dropped («скрыть»).
 * Every merged entry carries `curated` («добавлено Raid OS»). The same in every game mode.
 */
export type QuestRequirementOp = 'add' | 'hide'
export type { CuratedRequirementKind }

export interface QuestRequirementOverride {
  id: string
  questId: string
  op: QuestRequirementOp
  itemId: string
  kind: CuratedRequirementKind
  count: number
  foundInRaid?: boolean
  comment?: string
  commentEn?: string
  objectiveId?: string
  /** A map marker id of the quest (an added point: `owner-quest-<id>`). */
  pointId?: string
  mapId?: string
  position: number
  /** Owner app only (the public list has no author). */
  updatedBy?: string
  updatedAt?: string
}

export type QuestRequirementInput = Omit<QuestRequirementOverride, 'id' | 'position' | 'updatedBy' | 'updatedAt'> & { id?: string }

export const QUEST_REQUIREMENTS_KEY = ['quest-requirement-overrides'] as const
export const CURATED_KINDS: readonly CuratedRequirementKind[] = ['bring', 'handover', 'find', 'key', 'plant', 'use']
export const QUEST_REQUIREMENT_COMMENT_MAX = 300
/** How each kind reads in the quest's `raidRequirements` (the catalog has no own «use»: it counts as «bring»). */
export const PURPOSE_OF_KIND: Record<CuratedRequirementKind, NonNullable<Quest['raidRequirements']>[number]['purpose']> = {
  bring: 'bring', handover: 'handover', find: 'find', key: 'key', plant: 'place', use: 'bring',
}
/** Labels of the kinds (RU; English in src/i18n/uiEnglishQuestEditor.ts). */
export const CURATED_KIND_LABEL: Record<CuratedRequirementKind, string> = {
  bring: 'Взять в рейд', handover: 'Сдать торговцу', find: 'Найти в рейде', key: 'Нужен ключ', plant: 'Заложить', use: 'Использовать',
}
const ITEM_ID = /^[a-f0-9]{24}$/
/** One shared empty list, so the dataset keeps its identity while nothing is curated. */
const NONE: QuestRequirementOverride[] = []

export function parseQuestRequirementOverrides(answer: unknown): QuestRequirementOverride[] {
  const list = (answer as { overrides?: unknown } | null)?.overrides
  if (!Array.isArray(list)) return NONE
  const parsed = list.flatMap((entry): QuestRequirementOverride[] => {
    const row = (entry ?? {}) as Partial<QuestRequirementOverride>
    if (typeof row.id !== 'string' || typeof row.questId !== 'string' || typeof row.itemId !== 'string' || !ITEM_ID.test(row.itemId)) return []
    if (row.op !== 'add' && row.op !== 'hide') return []
    if (!CURATED_KINDS.includes(row.kind as CuratedRequirementKind)) return []
    const count = Number.isInteger(row.count) && Number(row.count) > 0 ? Number(row.count) : 1
    const text = (key: 'comment' | 'commentEn' | 'objectiveId' | 'pointId' | 'mapId') => (typeof row[key] === 'string' && row[key] ? { [key]: row[key] } : {})
    return [{
      id: row.id, questId: row.questId, op: row.op, itemId: row.itemId, kind: row.kind as CuratedRequirementKind, count,
      ...(typeof row.foundInRaid === 'boolean' ? { foundInRaid: row.foundInRaid } : {}),
      ...text('comment'), ...text('commentEn'), ...text('objectiveId'), ...text('pointId'), ...text('mapId'),
      position: Number.isFinite(row.position) ? Number(row.position) : 0,
      ...(typeof row.updatedBy === 'string' ? { updatedBy: row.updatedBy } : {}),
      ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}),
    }]
  })
  return parsed.length ? parsed.sort((a, b) => a.position - b.position) : NONE
}

/** The single entry in a write's answer (`{ override, overrides }`), if any. */
export function parseSavedQuestRequirement(answer: unknown): QuestRequirementOverride | undefined {
  const override = (answer as { override?: unknown } | null)?.override
  return override && typeof override === 'object' ? parseQuestRequirementOverrides({ overrides: [override] })[0] : undefined
}

type RaidRequirement = NonNullable<Quest['raidRequirements']>[number]

/** Does a catalog requirement stand for this item and kind? («Использовать» also matches the catalog's «пометить».) */
export function requirementMatches(requirement: Pick<RaidRequirement, 'itemId' | 'purpose'>, itemId: string, kind: CuratedRequirementKind) {
  if (requirement.itemId !== itemId) return false
  return requirement.purpose === PURPOSE_OF_KIND[kind] || (kind === 'use' && requirement.purpose === 'mark')
}

/** The catalog's kind of a requirement, for «скрыть» (the reverse of PURPOSE_OF_KIND). */
export function kindOfPurpose(purpose: RaidRequirement['purpose']): CuratedRequirementKind {
  if (purpose === 'place') return 'plant'
  if (purpose === 'mark') return 'use'
  return purpose
}

/** The comment in the app's language (English falls back to the Russian one). */
export const commentOf = (entry: Pick<QuestRequirementOverride, 'comment' | 'commentEn'>, lang: 'ru' | 'en') =>
  (lang === 'en' ? entry.commentEn || entry.comment : entry.comment || entry.commentEn) || undefined

/** One quest with the owner's requirements merged in. */
export function questWithRequirements(quest: Quest, entries: QuestRequirementOverride[], lang: 'ru' | 'en' = 'ru', markers?: Map<string, MapMarker>): Quest {
  if (!entries.length) return quest
  let requirements: RaidRequirement[] = [...(quest.raidRequirements ?? [])]
  const hiddenItems = new Set<string>()
  for (const entry of entries.filter((row) => row.op === 'hide')) {
    const before = requirements.length
    requirements = requirements.filter((requirement) => !requirementMatches(requirement, entry.itemId, entry.kind))
    if (requirements.length !== before) hiddenItems.add(entry.itemId)
  }
  for (const entry of [...entries].filter((row) => row.op === 'add').sort((a, b) => a.position - b.position)) {
    const comment = commentOf(entry, lang)
    const fir = entry.kind === 'handover' || entry.kind === 'find' ? entry.foundInRaid : undefined
    const curated = { id: entry.id, kind: entry.kind, ...(comment ? { comment } : {}), ...(entry.pointId ? { pointId: entry.pointId } : {}) }
    const index = requirements.findIndex((requirement) => !requirement.curated && requirementMatches(requirement, entry.itemId, entry.kind))
    if (index >= 0) {
      const original = requirements[index]
      requirements[index] = { ...original, count: entry.count, ...(fir !== undefined ? { foundInRaid: fir } : {}), curated: { ...curated, replaced: true } }
      continue
    }
    requirements.push({
      itemId: entry.itemId,
      count: entry.count,
      purpose: PURPOSE_OF_KIND[entry.kind],
      mapIds: mapsOf(quest, entry, markers),
      ...(fir ? { foundInRaid: true } : {}),
      ...(entry.objectiveId ? { objectiveId: entry.objectiveId } : {}),
      curated,
    })
  }
  // A hidden item leaves the plain list too, unless another of its requirements stays.
  const requiredItems = quest.requiredItems?.filter((id) => !hiddenItems.has(id) || requirements.some((requirement) => requirement.itemId === id))
  return { ...quest, raidRequirements: requirements, ...(quest.requiredItems ? { requiredItems } : {}) }
}

/** Where an added requirement counts: its map, its point's map, its objective's maps, else the quest's maps. */
function mapsOf(quest: Quest, entry: QuestRequirementOverride, markers?: Map<string, MapMarker>): string[] {
  if (entry.mapId) return [entry.mapId]
  const point = entry.pointId ? markers?.get(entry.pointId) : undefined
  if (point) return [point.mapId]
  const objective = entry.objectiveId ? quest.objectiveDetails?.find((row) => row.id === entry.objectiveId) : undefined
  if (objective?.mapIds?.length) return [...objective.mapIds]
  if (quest.anyMap) return []
  return [...new Set([...(quest.mapIds ?? []), ...(quest.mapId ? [quest.mapId] : [])])]
}

/**
 * The dataset with the owner's requirements merged into its quests, and the items linked to a point listed on that
 * point (its tooltip: «Нужен ключ: …»). The same dataset object when there are none.
 */
export function withQuestRequirementOverrides(dataset: AppDataset, overrides: QuestRequirementOverride[], lang: 'ru' | 'en' = 'ru'): AppDataset {
  if (!overrides.length) return dataset
  const byQuest = new Map<string, QuestRequirementOverride[]>()
  for (const entry of overrides) byQuest.set(entry.questId, [...(byQuest.get(entry.questId) ?? []), entry])
  const markersById = new Map(dataset.markers.map((marker) => [marker.id, marker]))
  const quests = dataset.quests.map((quest) => {
    const entries = byQuest.get(quest.id)
    return entries ? questWithRequirements(quest, entries, lang, markersById) : quest
  })
  const linked = overrides.filter((entry) => entry.op === 'add' && entry.pointId && markersById.has(entry.pointId))
  if (!linked.length) return { ...dataset, quests }
  const items = new Map<string, Item>(dataset.items.map((item) => [item.id, item]))
  const byPoint = new Map<string, QuestRequirementOverride[]>()
  for (const entry of linked) byPoint.set(entry.pointId!, [...(byPoint.get(entry.pointId!) ?? []), entry])
  const markers = dataset.markers.map((marker) => {
    const entries = byPoint.get(marker.id)
    if (!entries || marker.questId !== entries[0].questId) return marker
    const needs = entries.flatMap((entry) => {
      const item = items.get(entry.itemId)
      return item ? [{ itemId: item.id, name: item.name, ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}), kind: entry.kind, count: entry.count }] : []
    })
    return needs.length ? { ...marker, hint: { ...marker.hint, needs } } : marker
  })
  return { ...dataset, quests, markers }
}

/** The owner's curated requirements (refreshed every 10 minutes and at once on a change); empty without a server. */
export function useQuestRequirementOverrides(enabled = true) {
  const query = useQuery({
    queryKey: QUEST_REQUIREMENTS_KEY,
    queryFn: async () => {
      const request = serviceClient()
      if (!request) return NONE
      if (isOwnerApp()) {
        try { return parseQuestRequirementOverrides(await request('GET', '/v1/accounts/me/admin/quest-requirements')) } catch { /* not the owner's session: the public list */ }
      }
      try { return parseQuestRequirementOverrides(await request('GET', '/v1/quest-requirements')) } catch { return NONE /* an older server without the route */ }
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  })
  return query.data ?? NONE
}

function request() {
  const send = serviceClient()
  if (!send) throw new Error('Нет связи с сервером')
  return send
}

/** Owner app only: add / change / hide, reorder and remove. The server refuses everybody but the owner's account. */
export function useQuestRequirementWriter() {
  const client = useQueryClient()
  const store = useCallback((overrides: QuestRequirementOverride[]) => client.setQueryData(QUEST_REQUIREMENTS_KEY, overrides), [client])
  const save = useCallback(async (input: QuestRequirementInput) => {
    const answer = await request()('PUT', '/v1/accounts/me/admin/quest-requirements', input)
    store(parseQuestRequirementOverrides(answer))
    return parseSavedQuestRequirement(answer)
  }, [store])
  const remove = useCallback(async (id: string) => {
    store(parseQuestRequirementOverrides(await request()('POST', `/v1/accounts/me/admin/quest-requirements/${id}/remove`)))
  }, [store])
  const reorder = useCallback(async (questId: string, ids: string[]) => {
    store(parseQuestRequirementOverrides(await request()('POST', '/v1/accounts/me/admin/quest-requirements/order', { questId, ids })))
  }, [store])
  return { save, remove, reorder }
}

/** The input that brings an entry back as it was (its id when it still exists). */
export function restoreRequirementInput(entry: QuestRequirementOverride, keepId: boolean): QuestRequirementInput {
  const input: QuestRequirementInput & Partial<Pick<QuestRequirementOverride, 'position' | 'updatedBy' | 'updatedAt'>> = { ...entry }
  delete input.position
  delete input.updatedBy
  delete input.updatedAt
  if (!keepId) delete input.id
  return input
}
