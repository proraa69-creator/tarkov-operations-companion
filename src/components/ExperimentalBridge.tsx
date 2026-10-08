import { useEffect, useMemo, useRef, useState } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { canonicalMapId } from '../data/mapIds'
import { mapForView, readMapView, resolveMapView } from '../data/mapView'
import { useAppState } from '../state/AppState'
import { currentStoryStageIndex, isCurrentTrackedQuest } from '../progression/requirementEngine'
import { createItemMatcher, matchNearest } from '../overlay/itemMatch'
import { createTooltipMatcher, type ItemNameVariant } from '../overlay/tooltipMatch'
import { loadItemNameVariants } from '../overlay/itemNames'
import { describeItem } from '../overlay/itemInfo'
import type { ItemOverlayPayload, MinimapMarker, MinimapPayload, MinimapQuest } from '../overlay/types'
import type { MarkerLayerId } from '../domain/types'
import { collectorEntries, loadCollected, scanForCollectorItems } from '../kappa/collector'
import { computeKeepList, keepBadge, type KeepRow } from '../raidprep/keepList'
import { mateNeedsItem, useMateNeedsRefresh } from '../squad/mateNeeds'
import { featureEnabled } from '../app/archivedFeatures'

const MINIMAP_LAYERS = new Set<MarkerLayerId>(['extract.pmc', 'extract.coop', 'transit', 'quest.zone', 'quest.item', 'loot.documents'])
const PLOTTED_SOURCES_EXCLUDED = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])

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
  // «Что не продавать» of the selected mode, for the badge on the item card (computed once per progress change).
  const progressNow = state.activeProfile.modes[state.raidMode]
  // Archived with the «Что не продавать» page: the item card shows only «Каппа» and «MATE» then.
  const keepRows = useMemo(() => {
    if (!window.tarkovDesktop?.experimental || !featureEnabled('keepItems')) return new Map<string, KeepRow>()
    const rows = computeKeepList({ quests: data.quests, hideout: data.hideout, items: data.items, progress: progressNow, collectorCollected: loadCollected(state.raidMode) })
    return new Map(rows.map((row) => [row.item.id, row]))
  }, [data.quests, data.hideout, data.items, progressNow, state.raidMode])
  const latest = useRef({ data, state, matcher, tooltipMatcher, keepRows })
  // Friends' / squad mates' needed items for the «MATE» badge (refreshed periodically and on raid start).
  useMateNeedsRefresh(state.raidMode, data.quests)

  useEffect(() => {
    latest.current = { data, state, matcher, tooltipMatcher, keepRows }
  })

  useEffect(() => {
    const api = window.tarkovDesktop?.experimental
    if (!api) return
    return api.onQuery((query) => {
      const { data, state, matcher, tooltipMatcher, keepRows } = latest.current
      const progress = state.activeProfile.modes[state.raidMode]
      if (query.kind === 'item') {
        const item = query.input.test
          ? data.items.find((entry) => (entry.fleaPrice ?? 0) > 0 && data.quests.some((quest) => quest.requiredItems?.includes(entry.id)))
          : query.input.tooltip
            // One name in the box: no loose fallback — a wrong item is worse than «not found».
            ? tooltipMatcher(query.input.text)
            : (query.input.lines?.length ? matchNearest(matcher, query.input.lines) : null) ?? matcher(query.input.text)
        // Two independent overlay slots: the keep badge («Что не продавать») and the bare «MATE» badge.
        const payload: ItemOverlayPayload = item ? { ...describeItem(item, data.quests, progress, state.raidMode, keepBadge(keepRows.get(item.id))), ...(mateNeedsItem(state.raidMode, item.id) ? { mate: true } : {}) } : { state: 'not-found', text: query.input.text }
        void api.answer(query.id, payload)
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
        return [{ id: marker.id, position: marker.position, layerId, title: marker.title, subtitle: marker.meta, questId: isQuest ? marker.questId : undefined }]
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
