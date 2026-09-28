import type { GameMap, MapMarker, Quest } from '../domain/types'
import { normalizeQuestKey } from './wikiQuestParse'

export function adaptStoryQuestMarkers(quests: Quest[], maps: GameMap[], landmarks: MapMarker[]): MapMarker[] {
  const markers: MapMarker[] = []
  for (const quest of quests.filter((entry) => entry.kind === 'story')) {
    const stages = quest.stages?.length
      ? quest.stages
      : [{ id: `${quest.id}-0`, title: quest.name, description: quest.description, mapIds: quest.mapIds ?? (quest.mapId ? [quest.mapId] : []), landmarkHints: [] }]
    // A marker only where the Wiki names a concrete place: talk / hand-over stages (no map) and
    // whole-map objectives (no landmark found) get no point — never a map-centre guess.
    stages.forEach((stage, stageIndex) => {
      for (const mapId of stage.mapIds) {
        const map = maps.find((entry) => entry.id === mapId)
        if (!map) continue
        const landmark = landmarkMarker(map, stage.landmarkHints ?? [], landmarks)
        if (!landmark) continue
        const position = landmark.position
        markers.push({
          floor: landmark.floor,
          height: landmark.height,
          id: `${mapId}-${quest.id}-stage-${stageIndex}`,
          mapId,
          type: 'quest',
          layerId: 'quest.zone',
          title: quest.name,
          description: stage.description || stage.title,
          position,
          questId: quest.id,
          stageIndex,
          meta: `Глава истории · этап ${stageIndex + 1}/${stages.length}`,
          source: 'tarkov-wiki/story',
        })
      }
    })
  }
  return markers
}

function landmarkMarker(map: GameMap, hints: string[], landmarks: MapMarker[]): MapMarker | undefined {
  const onMap = landmarks.filter((marker) => marker.mapId === map.id && marker.position)
  for (const hint of hints.map(normalizeQuestKey).filter((hint) => hint.length >= 4)) {
    const match = onMap.find((marker) => {
      const title = normalizeQuestKey(marker.title)
      const description = normalizeQuestKey(marker.description)
      return title.includes(hint) || hint.includes(title) && title.length >= 4 || description.includes(hint)
    })
    if (match) return match
  }
  return undefined
}