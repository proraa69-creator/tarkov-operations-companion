import { useEffect, useMemo, useRef, useState } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { canonicalMapId } from '../data/mapIds'
import { mapForView, readMapView, resolveMapView } from '../data/mapView'
import { useAppState } from '../state/AppState'
import { currentStoryStageIndex, isCurrentTrackedQuest } from '../progression/requirementEngine'
import { createItemMatcher, matchNearest } from '../overlay/itemMatch'
import { createTooltipMatcher, foldTooltipText, type ItemNameVariant, type TooltipCandidate, type TooltipMatcher } from '../overlay/tooltipMatch'
import { createLookupMemory } from '../overlay/tooltipLookup'
import { candidateDistance, decideByPicture, decodeIcon, iconSignature, isItemIconUrl, PICTURE_MATCH, type PictureAnswer, type PictureCandidate, type PictureCandidatesAnswer, type PictureQuery } from '../overlay/iconMatch'
import type { PictureSignature } from '../overlay/iconSignature'
import { loadItemNameVariants } from '../overlay/itemNames'
import { describeItem } from '../overlay/itemInfo'
import type { ItemOverlayInfo, ItemOverlayPayload, MinimapMarker, MinimapPayload, MinimapQuest } from '../overlay/types'
import type { Item, MarkerLayerId } from '../domain/types'
import { collectorEntries, loadCollected, scanForCollectorItems } from '../kappa/collector'
import { computeKeepList, keepBadge, type KeepRow } from '../raidprep/keepList'
import { mateNeedsItem, useMateNeedsRefresh } from '../squad/mateNeeds'
import { featureEnabled } from '../app/archivedFeatures'

const MINIMAP_LAYERS = new Set<MarkerLayerId>(['extract.pmc', 'extract.coop', 'transit', 'quest.zone', 'quest.item', 'loot.documents'])
const PLOTTED_SOURCES_EXCLUDED = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])

/** Readings the second attempt found an item for (one list for the app, see createLookupMemory). */
const lookupMemory = createLookupMemory(() => window.localStorage, foldTooltipText)
/** Icon signatures by item id for the picture check, kept while the app runs. */
const iconSignatures = new Map<string, PictureSignature>()
const ICON_SIGNATURES_KEPT = 400

/** Rankings of recent readings by matcher: one lookup's second attempt asks for the same readings several times. */
const rankings = new WeakMap<TooltipMatcher, Map<string, TooltipCandidate[]>>()
function rankOf(matcher: TooltipMatcher, text: string) {
  let cache = rankings.get(matcher)
  if (!cache) rankings.set(matcher, cache = new Map())
  let ranked = cache.get(text)
  if (!ranked) {
    ranked = matcher.rank(text, PICTURE_MATCH.candidates)
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    cache.set(text, ranked)
  }
  return ranked
}

/** The items the readings could name, best first (each item with its best score over the readings). */
function rankReadings(matcher: TooltipMatcher, texts: string[]) {
  const best = new Map<string, TooltipCandidate>()
  for (const text of texts) {
    for (const candidate of rankOf(matcher, text)) {
      if ((best.get(candidate.item.id)?.score ?? -Infinity) < candidate.score) best.set(candidate.item.id, candidate)
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, PICTURE_MATCH.candidates)
}

/** Why an item's picture cannot be compared, if it cannot. */
function pictureObstacle(item: Item): 'weapon' | 'no-size' | 'no-icon' | null {
  if (item.types?.includes('gun')) return 'weapon'
  if (!item.width || !item.height) return 'no-size'
  return isItemIconUrl(item.iconUrl) ? null : 'no-icon'
}

/** Whether the reading still names the item among its likely ones (at least this well). */
const readsLike = (matcher: TooltipMatcher, text: string, id: string, score = -Infinity) => rankOf(matcher, text).some((candidate) => candidate.item.id === id && candidate.score >= score)

/** Readings found only by the second attempt are remembered as the item — those that read like its name. */
function rememberReadings(matcher: TooltipMatcher, texts: string[], item: Item) {
  lookupMemory.remember(texts, item.id, (text) => readsLike(matcher, text, item.id, PICTURE_MATCH.memoryText))
}

/** The picture check of the second attempt (src/overlay/iconMatch.ts): which candidate the item under the cursor is. */
async function checkPicture(matcher: TooltipMatcher, items: Map<string, Item>, input: PictureQuery) {
  const ranked = rankReadings(matcher, input.texts)
  // New icons are decoded together (off the main thread in the browser), then kept by item id.
  await Promise.all(ranked.map(async ({ item }) => {
    const bytes = input.icons[item.id]
    if (pictureObstacle(item) || iconSignatures.has(item.id) || !bytes) return
    const pixels = await decodeIcon(bytes)
    if (!pixels) return
    if (iconSignatures.size >= ICON_SIGNATURES_KEPT) iconSignatures.delete(iconSignatures.keys().next().value!)
    iconSignatures.set(item.id, iconSignature(pixels, item.width!, item.height!))
  }))
  const candidates: PictureCandidate[] = []
  const report: PictureAnswer['candidates'] = []
  for (const { item, score } of ranked) {
    const obstacle = pictureObstacle(item)
    const signature = obstacle ? undefined : iconSignatures.get(item.id)
    const distance = obstacle ?? (signature ? candidateDistance(input.screen, { cols: item.width!, rows: item.height! }, signature) ?? 'size' : 'no-icon')
    candidates.push({ id: item.id, text: score, distance })
    report.push({ itemId: item.id, name: item.name, text: Number(score.toFixed(3)), ...(typeof distance === 'object'
      ? { distance: Number(distance.distance.toFixed(3)), shape: Number(distance.shape.toFixed(3)), tint: Number(distance.tint.toFixed(3)), known: Number(distance.known.toFixed(2)) }
      : { skipped: distance }) })
  }
  const verdict = decideByPicture(candidates)
  return { item: verdict.id ? items.get(verdict.id) ?? null : null, reason: verdict.reason, report }
}

/**
 * Answers the in-game overlays from the main window, which already holds the catalog and quest progress:
 * «Ж» asks what the item under the cursor is needed for, «M» asks for the current raid map.
 */
export function ExperimentalBridge() {
  const { data } = useTarkovData()
  const state = useAppState()
  const matcher = useMemo(() => createItemMatcher(data.items), [data.items])
  // The game's tooltip shows the name in the game's language: match against Russian and English names.
  const [nameVariants, setNameVariants] = useState<Map<string, ItemNameVariant[]> | null>(null)
  useEffect(() => {
    if (!window.tarkovDesktop?.experimental) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = () => {
      void loadItemNameVariants().then((names) => { if (active) setNameVariants(names) }).catch(() => {
        if (active) timer = setTimeout(load, 30_000)
      })
    }
    timer = setTimeout(load, 3000)
    return () => { active = false; clearTimeout(timer) }
  }, [])
  const tooltipMatcher = useMemo(() => createTooltipMatcher(data.items, nameVariants ?? undefined), [data.items, nameVariants])
  const itemsById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  // «Что не продавать» of the selected mode, for the badge on the item card (computed once per progress change).
  const progressNow = state.activeProfile.modes[state.raidMode]
  // Archived with the «Что не продавать» page: the item card shows only «Каппа» and «MATE» then.
  const keepRows = useMemo(() => {
    if (!window.tarkovDesktop?.experimental || !featureEnabled('keepItems')) return new Map<string, KeepRow>()
    const rows = computeKeepList({ quests: data.quests, hideout: data.hideout, items: data.items, progress: progressNow, collectorCollected: loadCollected(state.raidMode) })
    return new Map(rows.map((row) => [row.item.id, row]))
  }, [data.quests, data.hideout, data.items, progressNow, state.raidMode])
  const latest = useRef({ data, state, matcher, tooltipMatcher, itemsById, keepRows })
  // Friends' / squad mates' needed items for the «MATE» badge (refreshed periodically and on raid start).
  useMateNeedsRefresh(state.raidMode, data.quests)

  useEffect(() => {
    latest.current = { data, state, matcher, tooltipMatcher, itemsById, keepRows }
  })

  useEffect(() => {
    const api = window.tarkovDesktop?.experimental
    if (!api) return
    return api.onQuery((query) => {
      const { data, state, matcher, tooltipMatcher, itemsById, keepRows } = latest.current
      const progress = state.activeProfile.modes[state.raidMode]
      // Two independent overlay slots: the keep badge («Что не продавать») and the bare «MATE» badge.
      const card = (item: Item, source?: ItemOverlayInfo['source']): ItemOverlayPayload => ({
        ...describeItem(item, data.quests, progress, state.raidMode, keepBadge(keepRows.get(item.id))),
        ...(mateNeedsItem(state.raidMode, item.id) ? { mate: true } : {}),
        ...(source ? { source } : {}),
      })
      if (query.kind === 'item') {
        const { input } = query
        let source: ItemOverlayInfo['source']
        let item: Item | null | undefined
        if (input.test) item = data.items.find((entry) => (entry.fleaPrice ?? 0) > 0 && data.quests.some((quest) => quest.requiredItems?.includes(entry.id)))
        else if (input.tooltip) {
          // A reading the second attempt once found an item for names it at once (if the item still fits it).
          const remembered = lookupMemory.recall(input.text, (id) => itemsById.has(id) && readsLike(tooltipMatcher, input.text, id))
          // One name in the box: no loose fallback — a wrong item is worse than «not found».
          item = remembered ? itemsById.get(remembered) : tooltipMatcher(input.text)
          source = remembered ? 'memory' : input.remember ? 'retry' : undefined
          if (item && !remembered && input.remember?.length) rememberReadings(tooltipMatcher, input.remember, item)
        } else item = (input.lines?.length ? matchNearest(matcher, input.lines) : null) ?? matcher(input.text)
        void api.answer(query.id, item ? card(item, source) : { state: 'not-found', text: input.text } satisfies ItemOverlayPayload)
        return
      }
      if (query.kind === 'item-candidates') {
        const candidates = rankReadings(tooltipMatcher, query.input.texts).map(({ item }) => ({
          itemId: item.id,
          known: iconSignatures.has(item.id),
          ...(pictureObstacle(item) ? {} : { iconUrl: item.iconUrl }),
        }))
        void api.answer(query.id, { candidates } satisfies PictureCandidatesAnswer)
        return
      }
      if (query.kind === 'item-picture') {
        const { input } = query
        void checkPicture(tooltipMatcher, itemsById, input).then(({ item, reason, report }) => {
          // Found only by its picture: the readings are remembered as this item.
          if (item) rememberReadings(tooltipMatcher, input.texts, item)
          const answer: PictureAnswer<ItemOverlayPayload> = { payload: item ? card(item, 'picture') : { state: 'not-found', text: input.texts[0] ?? '' }, reason, candidates: report }
          return api.answer(query.id, answer)
        }).catch(() => api.answer(query.id, null))
        return
      }
      // Raid location can be absent during the first seconds after spawning or in incomplete logs.
      // Never degrade the M hotkey to a tiny "no data" card: use the map selected in the app.
      const mapId = canonicalMapId(query.input.location ?? '') || state.selectedMapId
      const map = data.maps.find((entry) => entry.id === mapId)
      if (!map) {
        void api.answer(query.id, { state: 'no-data', reason: query.input.location ? `Карта «${query.input.location}» не найдена` : 'Карта определится, когда начнётся рейд' } satisfies MinimapPayload)
        return
      }
      const current = new Set(data.quests.filter((quest) => isCurrentTrackedQuest(quest, progress)).map((quest) => quest.id))
      const markers: MinimapMarker[] = data.markers.flatMap((marker) => {
        const layerId = marker.layerId
        if (marker.mapId !== map.id || !layerId || !MINIMAP_LAYERS.has(layerId) || PLOTTED_SOURCES_EXCLUDED.has(marker.source ?? '')) return []
        const isQuest = layerId.startsWith('quest')
        if (isQuest ? !marker.questId || !current.has(marker.questId) : false) return []
        // Quest points carry their height: the minimap's quest button steps through them room by room.
        const height = isQuest ? marker.height ?? (marker.heightRange ? (marker.heightRange[0] + marker.heightRange[1]) / 2 : undefined) : undefined
        return [{ id: marker.id, position: marker.position, layerId, title: marker.title, subtitle: marker.meta, questId: isQuest ? marker.questId : undefined, ...(height != null ? { height } : {}) }]
      })
      const quests: MinimapQuest[] = []
      for (const marker of markers) {
        if (!marker.questId) continue
        const existing = quests.find((entry) => entry.questId === marker.questId)
        if (existing) { existing.markerIds.push(marker.id); continue }
        const quest = data.quests.find((entry) => entry.id === marker.questId)
        if (!quest) continue
        const stage = quest.stages?.[currentStoryStageIndex(quest, progress)]
        const objectives = stage ? [stage.title] : (quest.objectives.length ? quest.objectives : [quest.description]).slice(0, 4)
        quests.push({ questId: quest.id, name: quest.name, trader: quest.trader, markerIds: [marker.id], objectives })
      }
      // The overlay follows the map view chosen on the Maps page (satellite or schematic).
      const preferred = readMapView()
      void api.answer(query.id, { state: 'ready', map: mapForView(map, preferred), view: resolveMapView(map, preferred), markers, questCount: quests.length, quests } satisfies MinimapPayload)
    })
  }, [])

  useEffect(() => {
    const api = window.tarkovDesktop?.experimental
    if (!api) return
    let scanning = false
    return api.onCollectorScan(() => {
      if (scanning) return
      const { data, state } = latest.current
      const notify = (message: string) => { void window.tarkovDesktop?.notify?.('Коллекционер', message).catch(() => {}) }
      const entries = collectorEntries(data.quests, data.items)
      if (!entries.length) { notify('Список предметов не загружен. Обновите каталог в приложении.'); return }
      scanning = true
      notify('Распознавание предметов началось.')
      void scanForCollectorItems(state.raidMode, entries).then((result) => {
        notify(result.ok
          ? result.gameWindow ? `Найдено предметов: ${result.found}. Добавлено новых: ${result.added.length}.` : 'Окно игры не найдено. Откройте схрон и повторите сканирование.'
          : 'Сканирование работает только в приложении для Windows.')
      }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Не удалось распознать предметы.'))
        .finally(() => { scanning = false })
    })
  }, [])

  return null
}
