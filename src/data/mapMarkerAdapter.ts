import type { GameMap, Item, MapMarker, MarkerLayerId, MarkerType, Quest } from '../domain/types'
import { canonicalMapId, localizeMapCopy, mapDisplayName } from './mapIds'
import { BATTLE_PASS_DOCUMENTS } from './battlePassDocuments'
import { heightRange, markerFloor, markerPosition, outlineToLatLng, pointHeight } from './mapProjection'

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
  const mobs = mobIndex(asRecord(root.mobs))

  for (const rawMap of recordValues(rawMaps)) {
    const mapId = text(rawMap.normalizedName)
    const map = mapById.get(mapId)
    if (!map) continue
    markers.push(...adaptExtracts(map, rawMap, context.items))
    markers.push(...adaptTransits(map, rawMap, context))
    markers.push(...adaptBosses(map, rawMap, mobs, context.items))
    markers.push(...adaptSpawns(map, rawMap))
    markers.push(...adaptHazards(map, rawMap))
    markers.push(...adaptLoot(map, rawMap, context.items))
    markers.push(...adaptLocks(map, rawMap, context.items))
    markers.push(...adaptStationaryWeapons(map, rawMap, context.items))
    markers.push(...adaptBattlePassDocuments(map))
  }

  markers.push(...adaptQuestZones(taskRoot, context))
  return [...new Map(markers.map((marker) => [marker.id, marker])).values()]
}

function adaptBattlePassDocuments(map: GameMap): MapMarker[] {
  return (BATTLE_PASS_DOCUMENTS[map.id] ?? []).flatMap((point, index) => {
    const base = baseMarker(map, `battle-pass-documents-${index}`, { x: point.x, y: point.y ?? 0, z: point.z }, undefined, undefined, undefined)
    if (!base) return []
    return [{
      ...base,
      type: 'cache' as const,
      layerId: 'loot.documents' as const,
      title: 'Документы боевого пропуска',
      description: point.note ?? 'Место появления документов боевого пропуска.',
      meta: 'Боевой пропуск',
      source: 'battle-pass-documents',
    }]
  })
}

const SHARED_EXTRACT_DISTANCE = 15

function sameExtractSpot(a: JsonRecord, b: JsonRecord) {
  if (text(a.name).trim().toLowerCase() !== text(b.name).trim().toLowerCase()) return false
  const pa = asRecord(a.position)
  const pb = asRecord(b.position)
  const dx = Number(pa.x) - Number(pb.x)
  const dz = Number(pa.z) - Number(pb.z)
  return Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) <= SHARED_EXTRACT_DISTANCE
}

function adaptExtracts(map: GameMap, rawMap: JsonRecord, items: Map<string, Item>): MapMarker[] {
  const extracts = asArray(rawMap.extracts)
  const pmcExtracts = extracts.filter((extract) => text(extract.faction) === 'pmc')
  // tarkov.dev lists shared exits (e.g. Woods "Outskirts") once per faction at the same spot; show them as one PMC exit.
  const sharedWithScav = new Set(pmcExtracts.filter((pmc) => extracts.some((other) => text(other.faction) === 'scav' && sameExtractSpot(pmc, other))))
  return extracts.flatMap((extract, index) => {
    if (text(extract.faction) === 'scav' && pmcExtracts.some((pmc) => sameExtractSpot(pmc, extract))) return []
    const base = baseMarker(map, `extract-${text(extract.id, String(index))}`, extract.position, extract.outline, extract.top, extract.bottom)
    if (!base) return []
    const faction = extractFaction(text(extract.faction))
    const shared = sharedWithScav.has(extract)
    const factionLabel = faction === 'pmc' ? 'Выход ЧВК' : faction === 'scav' ? 'Выход Диких' : 'Совместный выход'
    return [{
      ...base,
      type: 'extract',
      layerId: faction === 'pmc' ? 'extract.pmc' : faction === 'scav' ? 'extract.scav' : 'extract.coop',
      extractFaction: faction,
      extractId: text(extract.id),
      title: localizeMapCopy(text(extract.name, factionLabel)),
      description: extractDescription(faction, extract, items, shared),
      meta: factionLabel,
      requiresPower: strings(extract.switches).length > 0 || Boolean(text(extract.switch)),
      requiresCoop: faction === 'coop',
      source: 'json.tarkov.dev/maps',
    }]
  })
}

function adaptTransits(map: GameMap, rawMap: JsonRecord, context: MarkerContext): MapMarker[] {
  return asArray(rawMap.transits).flatMap((transit, index) => {
    const base = baseMarker(map, `transit-${text(transit.id, String(index))}`, transit.position, transit.outline, transit.top, transit.bottom)
    if (!base) return []
    const targetId = resolveApiMapId(text(transit.map), context)
    const targetName = targetId ? mapDisplayName(targetId, context.maps) : ''
    const title = targetName ? `Переход на карту ${targetName}` : 'Переход'
    return [{
      ...base,
      type: 'extract',
      layerId: 'transit',
      title,
      description: targetName ? `Переход на карту ${targetName}.` : localizeMapCopy(text(transit.description, 'Точка перехода между локациями.')),
      meta: 'Переход',
      source: 'json.tarkov.dev/maps',
    }]
  })
}

const GEAR_SLOTS = ['FirstPrimaryWeapon', 'SecondPrimaryWeapon', 'Holster', 'Headwear', 'ArmorVest', 'TacticalVest']

/** Spawn zones tarkov.dev does not list yet, keyed by map and mob normalizedName. */
const EXTRA_BOSS_LOCATIONS: Record<string, Record<string, JsonRecord[]>> = {
  shoreline: {
    sanitar: [{ name: 'Санаторий (главный корпус)', positions: [{ x: -250, y: -2, z: -138 }] }],
  },
}

function adaptBosses(map: GameMap, rawMap: JsonRecord, mobs: Map<string, JsonRecord>, items: Map<string, Item>): MapMarker[] {
  return asArray(rawMap.bosses).flatMap((boss, bossIndex) => {
    const mobKey = text(boss.mob)
    const mob = mobs.get(mobKey)
    // Knight always roams with Big Pipe and Birdeye, so the marker stands for the whole trio.
    const mobId = text(mob?.normalizedName)
    const isGoons = mobId === 'knight' || mobKey === 'bossKnight'
    if (map.id === 'lighthouse' && mobId === 'glukhar') return []
    const name = isGoons ? 'Кочевники' : text(mob?.name, mobKey || 'Босс')
    const spawnChance = number(boss.spawnChance)
    const escorts = asArray(boss.escorts).map((escort) => {
      const escortName = text(mobs.get(text(escort.mob))?.name, text(escort.mob))
      const count = Math.max(0, ...asArray(escort.amount).map((amount) => number(amount.count)))
      return count > 1 ? `${escortName} ×${count}` : escortName
    }).filter(Boolean)
    if (isGoons) {
      for (const member of ['Birdeye', 'Big Pipe', 'Knight']) {
        if (!escorts.some((escort) => escort.toLowerCase().replace(/\s/g, '').includes(member.toLowerCase().replace(/\s/g, '')))) escorts.unshift(member)
      }
    }
    const info = mob ? bossInfoFromMob(mob, name, items) : { name }
    const locations = [...asArray(boss.spawnLocations), ...(EXTRA_BOSS_LOCATIONS[text(rawMap.normalizedName)]?.[mobId] ?? [])]
    return locations.flatMap((location, locationIndex) => {
      const positions = asArray(location.positions)
      const position = averagePosition(positions)
      const base = baseMarker(map, `boss-${bossIndex}-${locationIndex}`, position, undefined, position?.y, position?.y)
      if (!base) return []
      const zone = prettifyZone(text(location.name))
      const locationChance = number(location.chance)
      return [{
        ...base,
        type: 'boss',
        layerId: 'boss',
        title: name,
        description: `Возможная зона появления: ${zone || 'неизвестная зона'}.`,
        meta: spawnChance ? `${Math.round(spawnChance * 100)}%` : undefined,
        boss: {
          ...info,
          spawnChance: spawnChance || undefined,
          locationChance: locationChance || undefined,
          locationName: zone || undefined,
          escorts: escorts.length ? escorts : undefined,
        },
        source: 'json.tarkov.dev/maps',
      } satisfies MapMarker]
    })
  })
}

function averagePosition(positions: JsonRecord[]) {
  if (positions.length < 2) return positions[0]
  const valid = positions.filter((position) => Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.z)))
  if (!valid.length) return positions[0]
  return {
    x: valid.reduce((sum, position) => sum + number(position.x), 0) / valid.length,
    y: valid.reduce((sum, position) => sum + number(position.y), 0) / valid.length,
    z: valid.reduce((sum, position) => sum + number(position.z), 0) / valid.length,
  }
}

function mobIndex(rawMobs: JsonRecord) {
  const index = new Map<string, JsonRecord>()
  for (const [key, value] of Object.entries(rawMobs)) {
    const mob = asRecord(value)
    index.set(key, mob)
    for (const alias of [text(mob.id), text(mob.name), text(mob.normalizedName)]) {
      if (alias && !index.has(alias)) index.set(alias, mob)
    }
  }
  return index
}

function bossInfoFromMob(mob: JsonRecord, name: string, items: Map<string, Item>) {
  const equipment = asArray(mob.equipment)
  const gear = GEAR_SLOTS.flatMap((slot) => {
    const entry = equipment.find((candidate) => text(asRecord(candidate.attributes).slot) === slot)
    const item = entry ? items.get(text(entry.item)) : undefined
    return item ? [{ name: item.shortName || item.name, iconUrl: item.iconUrl, slot }] : []
  })
  const health = asArray(mob.health).reduce((sum, part) => sum + number(part.max), 0)
  return {
    key: text(mob.normalizedName) || undefined,
    name,
    portraitUrl: text(mob.imagePortraitLink) || undefined,
    gear: gear.length ? gear : undefined,
    health: health || undefined,
  }
}

function prettifyZone(zone: string) {
  return zone
    .replace(/^Zone_?/i, '')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
}

function adaptSpawns(map: GameMap, rawMap: JsonRecord): MapMarker[] {
  return asArray(rawMap.spawns).flatMap((spawn, index) => {
    const base = baseMarker(map, `spawn-${index}`, spawn.position, undefined, asRecord(spawn.position).y, asRecord(spawn.position).y)
    if (!base) return []
    return [{
      ...base,
      type: 'spawn',
      layerId: 'spawn',
      title: strings(spawn.sides).includes('pmc') ? 'Спавн ЧВК' : strings(spawn.sides).includes('scav') ? 'Спавн Диких' : 'Спавн',
      description: strings(spawn.categories).join(', ') || 'Точка появления.',
      meta: text(spawn.zoneName, 'спавн'),
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
      meta: 'Опасность',
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

function adaptLocks(map: GameMap, rawMap: JsonRecord, items: Map<string, Item>): MapMarker[] {
  return asArray(rawMap.locks).flatMap((lock, index) => {
    const base = baseMarker(map, `lock-${text(lock.id, String(index))}`, lock.position, undefined, asRecord(lock.position).y, asRecord(lock.position).y)
    if (!base) return []
    const keyId = text(lock.key)
    const key = items.get(keyId)
    return [{
      ...base,
      type: 'key' as const,
      layerId: 'key' as const,
      title: key ? `Дверь: ${key.shortName || key.name}` : 'Запертая дверь',
      description: `${key ? `Нужен ключ «${key.name}».` : 'Требуется ключ.'}${lock.needsPower ? ' Также необходимо питание.' : ''}`,
      meta: text(lock.lockType, 'door'),
      itemId: keyId || undefined,
      source: 'json.tarkov.dev/maps',
    }]
  })
}

function adaptStationaryWeapons(map: GameMap, rawMap: JsonRecord, items: Map<string, Item>): MapMarker[] {
  return asArray(rawMap.stationaryWeapons).flatMap((weapon, index) => {
    const base = baseMarker(map, `stationary-weapon-${index}`, weapon.position, undefined, asRecord(weapon.position).y, asRecord(weapon.position).y)
    if (!base) return []
    const itemId = text(weapon.stationaryWeapon)
    const item = items.get(itemId)
    return [{
      ...base,
      type: 'cache' as const,
      layerId: 'loot.weapon' as const,
      title: item?.name ?? 'Стационарное оружие',
      description: 'Стационарное вооружение на локации.',
      meta: item?.shortName,
      itemId: itemId || undefined,
      source: 'json.tarkov.dev/maps',
    }]
  })
}

function adaptQuestZones(taskRoot: JsonRecord, context: MarkerContext): MapMarker[] {
  const markers: MapMarker[] = []
  const maps = new Map(context.maps.map((map) => [map.id, map]))

  for (const quest of context.quests) {
    const rawTask = asRecord(asRecord(taskRoot.tasks)[quest.id])
    for (const objective of asArray(rawTask.objectives)) {
      for (const zone of asArray(objective.zones)) {
        const map = resolveMap(text(zone.map) || strings(objective.maps)[0], context, maps)
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
      // Quest items (findQuestItem) carry exact spawn points instead of zones.
      for (const location of asArray(objective.possibleLocations)) {
        const map = resolveMap(text(location.map) || strings(objective.maps)[0], context, maps)
        if (!map) continue
        asArray(location.positions).forEach((position, index) => {
          const base = baseMarker(map, `quest-item-${quest.id}-${text(objective.id)}-${index}`, position, undefined, undefined, undefined)
          if (!base) return
          markers.push({
            ...base,
            type: 'quest',
            layerId: 'quest.item',
            title: quest.name,
            description: text(objective.description, 'Квестовый предмет.'),
            meta: `${quest.trader} · ур. ${quest.level} · место предмета`,
            questId: quest.id,
            itemId: text(objective.questItem) || text(asRecord(objective.questItem).id) || undefined,
            source: 'json.tarkov.dev/tasks',
          })
        })
      }
    }
  }

  return markers
}

function resolveApiMapId(rawId: string, context: MarkerContext) {
  if (!rawId) return ''
  return canonicalMapId(context.mapNameByApiId.get(rawId) ?? context.mapNameByApiId.get(canonicalMapId(rawId)) ?? rawId)
}

function resolveMap(rawId: string, context: MarkerContext, maps: Map<string, GameMap>) {
  const resolved = resolveApiMapId(rawId, context)
  return maps.get(resolved) ?? maps.get(canonicalMapId(rawId))
}

function baseMarker(
  map: GameMap,
  id: string,
  position: unknown,
  outline: unknown,
  top: unknown,
  bottom: unknown,
): Pick<MapMarker, 'id' | 'mapId' | 'position' | 'outline' | 'heightRange' | 'height' | 'floor'> | undefined {
  const markerPos = markerPosition(asRecord(position), outline)
  if (!markerPos) return undefined
  const range = heightRange(top, bottom)
  const height = pointHeight(asRecord(position), range)
  return {
    id: `${map.id}-${id}`,
    mapId: map.id,
    position: markerPos,
    outline: outlineToLatLng(outline),
    heightRange: range,
    height,
    floor: markerFloor(map, range, markerPos, height),
  }
}

function extractFaction(faction: string) {
  if (faction === 'pmc') return 'pmc'
  if (faction === 'scav') return 'scav'
  return 'coop'
}

function extractDescription(faction: string, extract: JsonRecord, items: Map<string, Item>, shared = false) {
  const parts = [faction === 'pmc' ? 'Выход ЧВК.' : faction === 'scav' ? 'Выход Диких.' : 'Совместный или общий выход.']
  if (strings(extract.switches).length || text(extract.switch)) parts.push('Может требовать активации.')
  const transfer = asRecord(extract.transferItem)
  const itemId = text(transfer.item)
  if (itemId) {
    const item = items.get(itemId)
    const count = Math.max(1, number(transfer.count))
    parts.push(`Требуется: ${item?.name ?? itemId}${count > 1 ? ` ×${count}` : ''}.`)
  }
  if (shared) parts.push('Также доступен Диким.')
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
