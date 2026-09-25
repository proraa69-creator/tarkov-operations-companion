import type { GameMap, Item, MapMarker, MarkerLayerId, MarkerType, Quest } from '../domain/types'
import { heightRange, markerFloor, markerPosition, outlineToLatLng } from './mapProjection'

type JsonRecord = Record<string, unknown>

interface MarkerContext {
  maps: GameMap[]
  mapNameByApiId: Map<string, string>
  quests: Quest[]
  items: Map<string, Item>
}

export function adaptLiveMapMarkers(root: JsonRecord, taskRoot: JsonRecord, context: MarkerContext): MapMarker[] {
  const markers: MapMarker[] = []
  const mapById = new Map(context.maps.map((map) => [map.id, map]))
  const rawMaps = asRecord(root.maps)

  for (const rawMap of recordValues(rawMaps)) {
    const mapId = text(rawMap.normalizedName)
    const map = mapById.get(mapId)
    if (!map) continue
    markers.push(...adaptExtracts(map, rawMap))
    markers.push(...adaptTransits(map, rawMap, context.mapNameByApiId))
    markers.push(...adaptBosses(map, rawMap))
    markers.push(...adaptSpawns(map, rawMap))
    markers.push(...adaptHazards(map, rawMap))
    markers.push(...adaptLoot(map, rawMap, context.items))
  }

  markers.push(...adaptQuestZones(taskRoot, context))
  return markers
}

function adaptExtracts(map: GameMap, rawMap: JsonRecord): MapMarker[] {
  return asArray(rawMap.extracts).flatMap((extract, index) => {
    const base = baseMarker(map, `extract-${text(extract.id, String(index))}`, extract.position, extract.outline, extract.top, extract.bottom)
    if (!base) return []
    const faction = extractFaction(text(extract.faction))
    return [{
      ...base,
      type: 'extract',
      layerId: faction === 'pmc' ? 'extract.pmc' : faction === 'scav' ? 'extract.scav' : 'extract.coop',
      extractFaction: faction,
      extractId: text(extract.id),
      title: text(extract.name, 'Выход'),
      description: extractDescription(faction, extract),
      meta: faction === 'pmc' ? 'PMC' : faction === 'scav' ? 'Scav' : 'Co-op / shared',
      requiresPower: strings(extract.switches).length > 0 || Boolean(text(extract.switch)),
      requiresCoop: faction === 'coop',
      source: 'json.tarkov.dev/maps',
    }]
  })
}

function adaptTransits(map: GameMap, rawMap: JsonRecord, mapNameByApiId: Map<string, string>): MapMarker[] {
  return asArray(rawMap.transits).flatMap((transit, index) => {
    const base = baseMarker(map, `transit-${text(transit.id, String(index))}`, transit.position, transit.outline, transit.top, transit.bottom)
    if (!base) return []
    const target = mapNameByApiId.get(text(transit.map))
    return [{
      ...base,
      type: 'extract',
      layerId: 'transit',
      title: 'Транзит',
      description: target ? `Переход на карту: ${target}` : text(transit.description, 'Точка перехода между локациями.'),
      meta: 'Transit',
      source: 'json.tarkov.dev/maps',
    }]
  })
}

function adaptBosses(map: GameMap, rawMap: JsonRecord): MapMarker[] {
  return asArray(rawMap.bosses).flatMap((boss, bossIndex) => asArray(boss.spawnLocations).flatMap((location, locationIndex) => {
    const positions = asArray(location.positions)
    const position = positions[0]
    const base = baseMarker(map, `boss-${bossIndex}-${locationIndex}`, position, undefined, position.y, position.y)
    if (!base) return []
    return [{
      ...base,
      type: 'boss',
      layerId: 'boss',
      title: text(boss.mob, 'Босс'),
      description: `Возможная зона появления: ${text(location.name, 'неизвестная зона')}.`,
      meta: `${Math.round(number(boss.spawnChance) * 100)}%`,
      source: 'json.tarkov.dev/maps',
    }]
  }))
}

function adaptSpawns(map: GameMap, rawMap: JsonRecord): MapMarker[] {
  return asArray(rawMap.spawns).flatMap((spawn, index) => {
    const base = baseMarker(map, `spawn-${index}`, spawn.position, undefined, asRecord(spawn.position).y, asRecord(spawn.position).y)
    if (!base) return []
    return [{
      ...base,
      type: 'spawn',
      layerId: 'spawn',
      title: strings(spawn.sides).includes('pmc') ? 'Спавн PMC' : strings(spawn.sides).includes('scav') ? 'Спавн Scav' : 'Спавн',
      description: strings(spawn.categories).join(', ') || 'Точка появления.',
      meta: text(spawn.zoneName, 'spawn'),
      source: 'json.tarkov.dev/maps',
    }]
  })
}

function adaptHazards(map: GameMap, rawMap: JsonRecord): MapMarker[] {
  const hazards = [...asArray(rawMap.hazards), ...asArray(asRecord(rawMap.artillery).zones)]
  return hazards.flatMap((hazard, index) => {
    const base = baseMarker(map, `hazard-${text(hazard.id, String(index))}`, hazard.position, hazard.outline, hazard.top, hazard.bottom ?? hazard.botom)
    if (!base) return []
    return [{
      ...base,
      type: 'danger',
      layerId: 'hazard',
      title: 'Опасная зона',
      description: text(hazard.name, 'Опасная зона или зона артиллерии.'),
      meta: 'Hazard',
      source: 'json.tarkov.dev/maps',
    }]
  })
}

function adaptLoot(map: GameMap, rawMap: JsonRecord, items: Map<string, Item>): MapMarker[] {
  const containerMarkers: MapMarker[] = asArray(rawMap.lootContainers).flatMap((container, index) => {
    const base = baseMarker(map, `loot-container-${index}`, container.position, undefined, asRecord(container.position).y, asRecord(container.position).y)
    if (!base) return []
    return [{
      ...base,
      type: 'cache',
      layerId: 'loot.container' as MarkerLayerId,
      title: 'Контейнер с лутом',
      description: 'Контейнер или ящик с добычей.',
      meta: text(container.lootContainer, 'container'),
      source: 'json.tarkov.dev/maps',
    }]
  })
  const looseMarkers: MapMarker[] = asArray(rawMap.lootLoose).flatMap((loot, index) => {
    const base = baseMarker(map, `loot-loose-${index}`, loot.position, undefined, asRecord(loot.position).y, asRecord(loot.position).y)
    if (!base) return []
    const layerId = lootLayer(strings(loot.items), items)
    const type: MarkerType = layerId === 'loot.medical' ? 'landmark' : layerId === 'loot.weapon' ? 'key' : 'cache'
    return [{
      ...base,
      type,
      layerId,
      title: lootTitle(layerId),
      description: 'Точка свободного лута из данных Tarkov.dev.',
      meta: strings(loot.items).slice(0, 3).map((id) => items.get(id)?.shortName ?? id).join(', '),
      itemId: strings(loot.items)[0],
      source: 'json.tarkov.dev/maps',
    }]
  })
  return [...containerMarkers, ...looseMarkers]
}

function adaptQuestZones(taskRoot: JsonRecord, context: MarkerContext): MapMarker[] {
  const markers: MapMarker[] = []
  const maps = new Map(context.maps.map((map) => [map.id, map]))
  for (const quest of context.quests) {
    const rawTask = asRecord(asRecord(taskRoot.tasks)[quest.id])
    for (const objective of asArray(rawTask.objectives)) {
      for (const zone of asArray(objective.zones)) {
        const mapId = context.mapNameByApiId.get(text(zone.map))
        const map = mapId ? maps.get(mapId) : undefined
        if (!map) continue
        const base = baseMarker(map, `quest-zone-${quest.id}-${text(zone.id, text(objective.id))}`, zone.position, zone.outline, zone.top, zone.bottom)
        if (!base) continue
        markers.push({
          ...base,
          type: 'quest',
          layerId: objectiveLayer(objective),
          title: quest.name,
          description: text(objective.description, 'Зона выполнения задания.'),
          meta: `${quest.trader} · ур. ${quest.level}`,
          questId: quest.id,
          source: 'json.tarkov.dev/tasks',
        })
      }
    }
  }
  return markers
}

function baseMarker(
  map: GameMap,
  id: string,
  position: unknown,
  outline: unknown,
  top: unknown,
  bottom: unknown,
): Pick<MapMarker, 'id' | 'mapId' | 'position' | 'outline' | 'heightRange' | 'floor'> | undefined {
  const markerPos = markerPosition(asRecord(position), outline)
  if (!markerPos) return undefined
  const range = heightRange(top, bottom)
  return {
    id: `${map.id}-${id}`,
    mapId: map.id,
    position: markerPos,
    outline: outlineToLatLng(outline),
    heightRange: range,
    floor: markerFloor(map, range),
  }
}

function extractFaction(faction: string) {
  if (faction === 'pmc') return 'pmc'
  if (faction === 'scav') return 'scav'
  return 'coop'
}

function extractDescription(faction: string, extract: JsonRecord) {
  const parts = [faction === 'pmc' ? 'Выход PMC.' : faction === 'scav' ? 'Выход Scav.' : 'Совместный или общий выход.']
  if (strings(extract.switches).length || text(extract.switch)) parts.push('Может требовать активации.')
  return parts.join(' ')
}

function objectiveLayer(objective: JsonRecord): MarkerLayerId {
  const type = text(objective.type).toLowerCase()
  return type.includes('find') || type.includes('pickup') || strings(objective.items).length ? 'quest.item' : 'quest.zone'
}

function lootLayer(itemIds: string[], items: Map<string, Item>): MarkerLayerId {
  const itemTypes = itemIds.flatMap((id) => items.get(id)?.types ?? [])
  if (itemTypes.some((type) => type.includes('med'))) return 'loot.medical'
  if (itemTypes.some((type) => type === 'food' || type === 'drink')) return 'loot.provision'
  if (itemTypes.some((type) => ['gun', 'weapon', 'ammo', 'preset'].includes(type))) return 'loot.weapon'
  if (itemTypes.some((type) => type.includes('tool') || type.includes('electronics'))) return 'loot.technical'
  if (itemIds.some((id) => (items.get(id)?.fleaPrice ?? 0) > 100_000)) return 'loot.valuable'
  return 'loot.technical'
}

function lootTitle(layerId: MarkerLayerId) {
  if (layerId === 'loot.medical') return 'Медицинский лут'
  if (layerId === 'loot.provision') return 'Провизия'
  if (layerId === 'loot.weapon') return 'Оружие/боеприпасы'
  if (layerId === 'loot.valuable') return 'Ценный лут'
  return 'Технический лут'
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function recordValues(value: JsonRecord) {
  return Object.values(value).map(asRecord)
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.parseFloat(String(value)) || 0
}
