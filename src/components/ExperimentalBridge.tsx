import { useEffect, useMemo, useRef } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { canonicalMapId } from '../data/mapIds'
import { useAppState } from '../state/AppState'
import { isCurrentTrackedQuest } from '../progression/requirementEngine'
import { createItemMatcher } from '../overlay/itemMatch'
import { describeItem } from '../overlay/itemInfo'
import type { ItemOverlayPayload, MinimapMarker, MinimapPayload } from '../overlay/types'
import type { MarkerLayerId } from '../domain/types'
import { collectorEntries, scanForCollectorItems } from '../kappa/collector'

const MINIMAP_LAYERS = new Set<MarkerLayerId>(['extract.pmc', 'extract.coop', 'transit', 'quest.zone', 'quest.item'])
const PLOTTED_SOURCES_EXCLUDED = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])

/**
 * Answers the in-game overlays from the main window, which already holds the catalog and quest progress:
 * «Ж» asks what the item under the cursor is needed for, «M» asks for the current raid map.
 */
export function ExperimentalBridge() {
  const { data } = useTarkovData()
  const state = useAppState()
  const matcher = useMemo(() => createItemMatcher(data.items), [data.items])
  const latest = useRef({ data, state, matcher })

  useEffect(() => {
    latest.current = { data, state, matcher }
  })

  useEffect(() => {
    const api = window.tarkovDesktop?.experimental
    if (!api) return
    return api.onQuery((query) => {
      const { data, state, matcher } = latest.current
      const progress = state.activeProfile.modes[state.raidMode]
      if (query.kind === 'item') {
        const item = query.input.test
          ? data.items.find((entry) => (entry.fleaPrice ?? 0) > 0 && data.quests.some((quest) => quest.requiredItems?.includes(entry.id)))
          : matcher(query.input.text)
        const payload: ItemOverlayPayload = item ? describeItem(item, data.quests, progress, state.raidMode) : { state: 'not-found', text: query.input.text }
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
        return [{ id: marker.id, position: marker.position, layerId, title: marker.title, subtitle: marker.meta }]
      })
      const questCount = new Set(markers.flatMap((marker) => marker.layerId.startsWith('quest') ? [marker.title] : [])).size
      void api.answer(query.id, { state: 'ready', map, markers, questCount } satisfies MinimapPayload)
    })
  }, [])

  useEffect(() => {
    const api = window.tarkovDesktop?.experimental
    if (!api) return
    return api.onCollectorScan(() => {
      const { data, state } = latest.current
      void scanForCollectorItems(state.raidMode, collectorEntries(data.quests, data.items)).catch(() => {})
    })
  }, [])

  return null
}
