// The minimap payload of Customs as the app builds it (components/ExperimentalBridge.tsx, «M» query): the map in the
// chosen view, exits / quest points of the profile's current quests, and the quest list. Saved for take t06.
import { writeFileSync } from 'node:fs'
import { openApp, close, S } from './rec.mjs'
const lang = process.argv[2] ?? 'ru'
const { page } = await openApp({ locale: lang, hash: '#/maps/customs' })
const payload = await page.evaluate(async () => {
  const keys = await new Promise((resolve) => { const open = indexedDB.open('keyval-store'); open.onsuccess = () => { const req = open.result.transaction('keyval', 'readonly').objectStore('keyval').getAllKeys(); req.onsuccess = () => resolve(req.result) } })
  const key = keys.find((k) => /catalog-v\d+-pvp-/.test(k))
  const data = await new Promise((resolve) => { const open = indexedDB.open('keyval-store'); open.onsuccess = () => { const req = open.result.transaction('keyval', 'readonly').objectStore('keyval').get(key); req.onsuccess = () => resolve(req.result) } })
  const { mapForView, resolveMapView } = await import('/src/data/mapView.ts')
  const { currentStoryStageIndex, isCurrentTrackedQuest } = await import('/src/progression/requirementEngine.ts')
  const stored = JSON.parse(localStorage.getItem('tarkov-operations-profiles-v2'))
  const progress = (stored.profiles.find((p) => p.id === stored.activeProfileId) ?? stored.profiles[0]).modes.pvp
  const MINIMAP_LAYERS = new Set(['extract.pmc', 'extract.coop', 'transit', 'quest.zone', 'quest.item', 'loot.documents'])
  const EXCLUDED = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])
  const map = data.maps.find((entry) => entry.id === 'customs')
  const current = new Set(data.quests.filter((quest) => isCurrentTrackedQuest(quest, progress)).map((quest) => quest.id))
  const markers = data.markers.flatMap((marker) => {
    const layerId = marker.layerId
    if (marker.mapId !== map.id || !layerId || !MINIMAP_LAYERS.has(layerId) || EXCLUDED.has(marker.source ?? '')) return []
    const isQuest = layerId.startsWith('quest')
    if (isQuest && (!marker.questId || !current.has(marker.questId))) return []
    const height = isQuest ? marker.height ?? (marker.heightRange ? (marker.heightRange[0] + marker.heightRange[1]) / 2 : undefined) : undefined
    return [{ id: marker.id, position: marker.position, layerId, title: marker.title, subtitle: marker.meta, questId: isQuest ? marker.questId : undefined, ...(height != null ? { height } : {}) }]
  })
  const quests = []
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
  return { state: 'ready', map: mapForView(map, 'satellite'), view: resolveMapView(map, 'satellite'), markers, questCount: quests.length, quests }
})
console.log('markers', payload.markers.length, 'quests', payload.quests.map((q) => `${q.name} (${q.markerIds.length})`).join(', '))
writeFileSync(`${S}/promo/rec/minimap-${lang}.json`, JSON.stringify(payload))
await close()
