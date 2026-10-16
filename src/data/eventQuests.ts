import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import type { AppDataset, Quest, RaidMode } from '../domain/types'
import { adaptTaskRows } from './catalogSource'
import { applyCuratedQuestNotes, curatedQuestsFor, withCuratedTasks, type CuratedSeries } from './curatedQuests'
import { EVENT_QUEST_ID, eventSeriesWith, parseEventQuestDefinitions, type EventQuestDefinition } from './eventQuestDefinitions'
import { normalizeQuestKey } from './wikiQuestParse'

/**
 * The owner's event quests in every player's app (server/src/routes/eventQuests.ts, src/data/eventQuestDefinitions.ts).
 * The server's quest base builds them into the catalog (src/data/catalogSource.ts) a minute or so after a change; the
 * app lays the same definitions over the catalog it has at once (DataProvider), so a rename, a new quest, a switch-off
 * or the event's end shows without waiting for the next catalog:
 * - the quests of every series the owner touched are built again from the definitions with the catalog's own adapter
 *   (their map points stay the catalog's: the zones of the same objectives and the markers);
 * - a curated quest that is switched off, over, not in this mode, or an owner's quest that is gone, leaves the catalog
 *   with its map points;
 * - a quest tarkov.dev lists itself (the same id, or the same title) stays tarkov.dev's, as in the catalog.
 */
export const EVENT_QUESTS_KEY = ['event-quests'] as const

export interface EventQuestOverlayOptions {
  mode: RaidMode
  lang: 'ru' | 'en'
  now?: number
}

/**
 * The catalog with the owner's event quests; the same object when nothing changes. `definitions`: undefined while they
 * are not known (no server, not loaded yet), then only the built-in events' end applies.
 */
export function withEventQuests(dataset: AppDataset, definitions: readonly EventQuestDefinition[] | undefined, options: EventQuestOverlayOptions): AppDataset {
  const now = options.now ?? Date.now()
  const series = eventSeriesWith(definitions ?? [])
  const defined = new Set((definitions ?? []).map((definition) => definition.id))
  const traderIds = new Set(dataset.traders.map((trader) => trader.id))
  const live = new Set(curatedQuestsFor(options.mode, series, now).filter(({ quest }) => traderIds.has(quest.trader)).map(({ quest }) => quest.id))
  const managed = new Set(series.flatMap((entry) => entry.quests.map((quest) => quest.id)))
  const ours = (quest: Quest | undefined) => Boolean(quest?.curatedSeriesId)
  // Off, over, not in this mode; or an owner's quest that is no longer defined.
  const gone = new Set(dataset.quests.filter((quest) => ours(quest) && (managed.has(quest.id)
    ? !live.has(quest.id)
    : definitions !== undefined && EVENT_QUEST_ID.test(quest.id))).map((quest) => quest.id))
  const touched = series.filter((entry) => entry.quests.some((quest) => defined.has(quest.id)))
  const rebuilt = touched.length ? rebuiltRows(dataset, touched, live, options, now) : new Map<string, Quest>()
  if (!gone.size && !rebuilt.size) return dataset

  const byId = new Map(dataset.quests.map((quest) => [quest.id, quest]))
  const theirTitles = new Set(dataset.quests.filter((quest) => !ours(quest)).flatMap((quest) => [quest.name, quest.nameRu, quest.nameEn])
    .filter((title): title is string => Boolean(title)).map(normalizeQuestKey).filter(Boolean))
  const quests: Quest[] = []
  for (const quest of dataset.quests) {
    if (gone.has(quest.id)) continue
    const fresh = rebuilt.get(quest.id)
    quests.push(fresh && ours(quest) ? merged(quest, fresh) : quest)
  }
  for (const [id, fresh] of rebuilt) {
    if (byId.has(id) || gone.has(id)) continue
    // the catalog steps aside for tarkov.dev's quest of the same title; so does the app
    if ([fresh.nameRu, fresh.nameEn, ...(fresh.ocrAliases ?? [])].some((title) => title && theirTitles.has(normalizeQuestKey(title)))) continue
    quests.push(fresh)
  }
  const markers = gone.size ? dataset.markers.filter((marker) => !marker.questId || !gone.has(marker.questId)) : dataset.markers
  return { ...dataset, quests, markers }
}

/** The shown quests of the touched series, built as the catalog builds them (no map places: the catalog keeps those). */
function rebuiltRows(dataset: AppDataset, touched: readonly CuratedSeries[], live: ReadonlySet<string>, { mode, lang }: EventQuestOverlayOptions, now: number) {
  const traders = Object.fromEntries(dataset.traders.map((trader) => [trader.id, { id: trader.id }]))
  const rows = new Map<string, Quest>()
  const built = withCuratedTasks({ tasks: {} }, { mode, locale: lang, maps: {}, traders, series: touched, now })
  const wanted = new Set([...built.added].filter((id) => live.has(id)))
  if (!wanted.size) return rows
  const tasks = Object.fromEntries(Object.entries(built.tasks.tasks as Record<string, unknown>).filter(([id]) => wanted.has(id)))
  const items = new Map(dataset.items.map((item) => [item.id, item]))
  const quests = new Map(touched.flatMap((entry) => entry.quests).map((quest) => [quest.id, quest]))
  for (const row of applyCuratedQuestNotes(adaptTaskRows({ tasks }, dataset.traders, dataset.items), wanted, lang, items, touched, now)) {
    const quest = quests.get(row.id)
    rows.set(row.id, {
      ...row,
      ...(quest ? { nameRu: quest.name.ru, nameEn: quest.name.en } : {}),
      ...(quest?.aliases?.length ? { ocrAliases: [...quest.aliases] } : {}),
    })
  }
  return rows
}

/** The catalog's row with the rebuilt fields; its map zones (by objective id), its other titles and the quest grid's data stay. */
function merged(current: Quest, fresh: Quest): Quest {
  const places = new Map((current.objectiveDetails ?? []).map((objective) => [objective.id, objective]))
  const titles = [current.name, current.nameRu, current.nameEn, ...(current.ocrAliases ?? []), ...(fresh.ocrAliases ?? [])]
  const own = new Set([fresh.name, fresh.nameRu, fresh.nameEn].filter((title): title is string => Boolean(title)).map(normalizeQuestKey))
  const aliases: string[] = []
  for (const title of titles) {
    const key = title ? normalizeQuestKey(title) : ''
    if (!key || own.has(key)) continue
    own.add(key)
    aliases.push(title!)
  }
  const next: Quest = {
    ...current,
    ...fresh,
    objectiveDetails: fresh.objectiveDetails?.map((objective) => {
      const kept = places.get(objective.id)
      if (!kept || objective.zones?.length || objective.itemSpots?.length || !(kept.zones?.length || kept.itemSpots?.length)) return objective
      return {
        ...objective,
        ...(kept.zones ? { zones: kept.zones } : {}),
        ...(kept.itemSpots ? { itemSpots: kept.itemSpots } : {}),
        ...(kept.zoneBound !== undefined ? { zoneBound: kept.zoneBound } : {}),
      }
    }),
  }
  if (aliases.length) next.ocrAliases = aliases
  else delete next.ocrAliases
  return next
}

/** The next end of an event after `now` (built-in or the owner's), if any. */
export function nextEventEnd(definitions: readonly EventQuestDefinition[] | undefined, now: number): number | undefined {
  const ends = eventSeriesWith(definitions ?? []).flatMap((series) => series.quests.map((quest) => Date.parse(quest.endsAt ?? series.endsAt ?? '')))
    .filter((end) => Number.isFinite(end) && end > now)
  return ends.length ? Math.min(...ends) : undefined
}

/** «Now» for the overlay: moves on when an event ends, so its quests leave a running app on time. */
export function useEventQuestClock(definitions: readonly EventQuestDefinition[] | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const end = nextEventEnd(definitions, now)
    // timers cannot wait longer than ~24.8 days; a later end is checked again then
    if (end === undefined) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2 ** 31 - 1, Math.max(1000, end - Date.now() + 1000)))
    return () => clearTimeout(timer)
  }, [definitions, now])
  return now
}

/** The owner's event quests (refreshed every 10 minutes and at once on a change); undefined without a server or before the first answer. */
export function useEventQuests(enabled = true): EventQuestDefinition[] | undefined {
  const query = useQuery({
    queryKey: EVENT_QUESTS_KEY,
    queryFn: async () => {
      const request = serviceClient()
      if (!request) return null
      if (isOwnerApp()) {
        try { return parseEventQuestDefinitions(await request('GET', '/v1/accounts/me/admin/event-quests')) } catch { /* not the owner's session: the public list */ }
      }
      return parseEventQuestDefinitions(await request('GET', '/v1/event-quests'))
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  })
  return query.data ?? undefined
}

/** Owner app only: save (create or update) / remove a definition. The server refuses everybody but the owner's account. */
export function useEventQuestWriter() {
  const client = useQueryClient()
  const save = useCallback(async (definition: EventQuestDefinition) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    client.setQueryData(EVENT_QUESTS_KEY, parseEventQuestDefinitions(await request('PUT', '/v1/accounts/me/admin/event-quests', definition)))
  }, [client])
  const remove = useCallback(async (id: string) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    client.setQueryData(EVENT_QUESTS_KEY, parseEventQuestDefinitions(await request('POST', `/v1/accounts/me/admin/event-quests/${encodeURIComponent(id)}/remove`)))
  }, [client])
  return { save, remove }
}
