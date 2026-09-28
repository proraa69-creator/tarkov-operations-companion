import type { MapMarker, Quest } from '../domain/types'
import { normalizeQuestKey } from './wikiQuestCatalog'
import type { WikiLandmark, WikiQuestPin } from './wikiMapPin'

const EXTRACT_ALIASES: Record<string, string[]> = {
  tunnel: ['тоннель'],
  тоннель: ['tunnel'],
  roadtocustoms: ['дорога на таможню'],
  дороганатаможню: ['road to customs'],
  roadatrailbridge: ['жд-мост'],
  ждмост: ['road_at_railbridge'],
  lighthouse: ['маяк'],
  маяк: ['lighthouse'],
  wreckedroad: ['разрушенная дорога'],
  разрушеннаядорога: ['wrecked road'],
  pierboat: ['лодка на причале'],
  лодканапричале: ['pier boat'],
}

export function questNameAliases(questId: string | undefined, quests: Quest[]) {
  if (!questId) return []
  const selected = quests.find((quest) => quest.id === questId)
  const key = selected ? normalizeQuestKey(selected.name) : normalizeQuestKey(questId)
  return quests.filter((quest) => quest.id === questId || (key && normalizeQuestKey(quest.name) === key)).map((quest) => quest.id)
}

export function buildWikiLandmarks(markers: MapMarker[], mapId: string): WikiLandmark[] {
  const landmarks: WikiLandmark[] = []
  const seen = new Set<string>()
  for (const marker of markers) {
    if (marker.mapId !== mapId || marker.type !== 'extract') continue
    const names = [marker.title, ...(EXTRACT_ALIASES[normalizeQuestKey(marker.title)] ?? [])]
    for (const name of names) {
      const key = `${normalizeQuestKey(name)}:${marker.position[1]}:${marker.position[0]}`
      if (!name || seen.has(key)) continue
      seen.add(key)
      landmarks.push({ name, x: marker.position[1], z: marker.position[0] })
    }
  }
  return landmarks
}

export function buildWikiQuestPins(input: {
  mapId: string
  markers: MapMarker[]
  quests: Quest[]
  selectedQuestId?: string
  focusedQuestId?: string
}): WikiQuestPin[] {
  const focusId = input.selectedQuestId || input.focusedQuestId
  if (!focusId) return []
  const aliasIds = new Set(questNameAliases(focusId, input.quests))
  const selected = input.quests.find((quest) => aliasIds.has(quest.id)) ?? input.quests.find((quest) => quest.id === focusId)
  const nameKey = selected ? normalizeQuestKey(selected.name) : ''
  const seen = new Set<string>()
  const pins: WikiQuestPin[] = []
  for (const marker of input.markers) {
    if (marker.mapId !== input.mapId || marker.source !== 'json.tarkov.dev/tasks') continue
    const sameQuest = Boolean(marker.questId && aliasIds.has(marker.questId))
    const sameName = Boolean(nameKey && normalizeQuestKey(marker.title) === nameKey)
    if (!sameQuest && !sameName) continue
    const key = `${Math.round(marker.position[1])}:${Math.round(marker.position[0])}`
    if (seen.has(key)) continue
    seen.add(key)
    pins.push({
      id: marker.id,
      title: selected?.name ?? marker.title,
      description: marker.description,
      x: marker.position[1],
      z: marker.position[0],
      focused: true,
    })
  }
  return pins
}
