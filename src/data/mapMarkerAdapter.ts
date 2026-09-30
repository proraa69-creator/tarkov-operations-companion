import type { GameMap, Item, KeycardColor, MapMarker, MarkerLayerId, MarkerType, PossibleSpot, Quest, RaidMode } from '../domain/types'
import { canonicalMapId, localizeMapCopy, mapDisplayName } from './mapIds'
import { BATTLE_PASS_DOCUMENT_ITEM_IDS, BATTLE_PASS_DOCUMENT_KINDS, BATTLE_PASS_DOCUMENTS, battlePassDocumentDescription } from './battlePassDocuments'
import { heightRange, markerFloor, markerPosition, outlineToLatLng, pointHeight } from './mapProjection'
import { resolveSupplementArea, supplementBossesFor, supplementChanceText, type LiveBossZone } from './bossSpawnSupplement'

type JsonRecord = Record<string, unknown>

interface MarkerContext {
  maps: GameMap[]
  mapNameByApiId: Map<string, string>
  quests: Quest[]
  items: Map<string, Item>
  /** Game mode of the loaded feed; bosses from the research list (bossSpawnSupplement) are added only when it is known. */
  mode?: RaidMode
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
    markers.push(...adaptBosses(map, rawMap, mobs, context.items, context.mode))
    markers.push(...adaptSpawns(map, rawMap))
    markers.push(...adaptHazards(map, rawMap))
    markers.push(...adaptLoot(map, rawMap, context.items))
    markers.push(...adaptLocks(map, rawMap, context.items))
    markers.push(...adaptStationaryWeapons(map, rawMap, context.items))
    markers.push(...adaptBattlePassDocuments(map, rawMap))
  }

  markers.push(...adaptQuestZones(taskRoot, context))
  return [...new Map(markers.map((marker) => [marker.id, marker])).values()]
}

/** A live (tarkov.dev loose loot) document and a community pin closer than this are one place. */
const SAME_DOCUMENT_SPOT_METRES = 3

function adaptBattlePassDocuments(map: GameMap, rawMap: JsonRecord): MapMarker[] {
  // Exact spawns, if the tarkov.dev loose-loot feed lists the document items.
  const live: MapMarker[] = asArray(rawMap.lootLoose).flatMap((loot, index) => {
    const kinds = [...new Set(strings(loot.items).flatMap((id) => BATTLE_PASS_DOCUMENT_ITEM_IDS.get(id) ?? []))]
    if (!kinds.length) return []
    const base = baseMarker(map, `battle-pass-documents-live-${index}`, loot.position, undefined, asRecord(loot.position).y, asRecord(loot.position).y)
    if (!base) return []
    return [{
      ...base,
      type: 'cache' as const,
      layerId: 'loot.documents' as const,
      title: 'Документы боевого пропуска',
      description: `${kinds.map((kind) => BATTLE_PASS_DOCUMENT_KINDS[kind].ru).join(', ')}.`,
      meta: 'Боевой пропуск',
      itemId: BATTLE_PASS_DOCUMENT_KINDS[kinds[0]].itemId,
      source: 'json.tarkov.dev/maps',
    }]
  })
  const community: MapMarker[] = (BATTLE_PASS_DOCUMENTS[map.id] ?? []).flatMap((point, index) => {
    // No height: the point stays on the general map (a guessed y put it on the wrong floor / underground).
    const base = baseMarker(map, `battle-pass-documents-${index}`, { x: point.x, y: point.y, z: point.z }, undefined, undefined, undefined)
    if (!base) return []
    if (live.some((marker) => Math.hypot(marker.position[0] - base.position[0], marker.position[1] - base.position[1]) < SAME_DOCUMENT_SPOT_METRES)) return []
    return [{
      ...base,
      type: 'cache' as const,
      layerId: 'loot.documents' as const,
      title: 'Документы боевого пропуска',
      description: battlePassDocumentDescription(point),
      meta: 'Боевой пропуск',
      itemId: point.documents[0] ? BATTLE_PASS_DOCUMENT_KINDS[point.documents[0]].itemId : undefined,
      approximate: true,
      source: 'battle-pass-documents',
    }]
  })
  return [...live, ...community]
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

/** Real bosses and boss groups; anything else in the feed (test or unreleased mobs) is not shown. */
const KNOWN_BOSSES = new Set([
  'reshala', 'killa', 'glukhar', 'shturman', 'sanitar', 'tagilla', 'zryachiy', 'kaban', 'kollontay', 'partisan',
  'knight', 'big-pipe', 'birdeye', 'cultist-priest', 'rogue', 'raider', 'kollontay', 'relic', 'svetloozerskiy',
])

/**
 * Spawn points of one boss closer than this (in-game metres, x/z) are drawn as one marker: the owner saw several
 * markers of one boss inside a ~100 m sector. Every zone, every listing (two raider groups, a zone listed twice) and
 * every point of that boss on the map are merged, so no two markers of one boss end up closer than this.
 * 120 rather than 100: Reshala's and the Goons' two Customs Stronghold spots are 101 m apart in the feed.
 */
export const BOSS_MERGE_METRES = 120

/** Zones where a boss must not be drawn although the feed lists them (product owner corrections). */
function allowedZone(mapId: string, mobId: string, zone: string) {
  // Rogues (ex-USEC): since patch 1.1.5.0 (8 Sep 2026) their base on Lighthouse is the chalets, not the water treatment
  // plant (research list 30.09.2026). Old treatment-plant zones are not drawn; without a chalet zone the research
  // supplement puts them in the chalets.
  if (mapId === 'lighthouse' && mobId === 'rogue') return /chalet|шале/i.test(zone) || !zone
  return true
}

/** One raw boss spawn point of one listing and zone (before merging). */
interface BossSpawnPoint {
  position: JsonRecord
  x: number
  z: number
  zone: string
  /** `bossIndex-locationIndex`: the zone of one listing, so its chance is counted once per merged marker. */
  zoneKey: string
  zoneChance: number
}

interface BossGroup {
  key: string
  name: string
  spawnChance: number
  escorts: string[]
  info: ReturnType<typeof bossInfoFromMob>
  points: BossSpawnPoint[]
}

function adaptBosses(map: GameMap, rawMap: JsonRecord, mobs: Map<string, JsonRecord>, items: Map<string, Item>, mode?: RaidMode): MapMarker[] {
  // All listings of one boss on this map (two raider groups, a duplicated zone, tarkov.dev + our extra zone)
  // are collected first and merged together, so the map never shows the same boss twice within ~100 m.
  const groups = new Map<string, BossGroup>()
  /** Bosses the feed lists with an explicit 0 % for this mode: the research supplement must not add them back. */
  const zeroed: Array<{ key: string; name: string }> = []
  asArray(rawMap.bosses).forEach((boss, bossIndex) => {
    const mobKey = text(boss.mob)
    const mob = mobs.get(mobKey)
    // Knight always roams with Big Pipe and Birdeye, so the marker stands for the whole trio.
    const mobId = text(mob?.normalizedName)
    const isGoons = mobId === 'knight' || mobKey === 'bossKnight'
    if (map.id === 'lighthouse' && mobId === 'glukhar') return
    if (!mob || (!KNOWN_BOSSES.has(mobId) && !text(mob.imagePortraitLink))) return
    // Big Pipe and Birdeye are drawn as part of the Goons marker.
    if (mobId === 'big-pipe' || mobId === 'birdeye') return
    // The maps feed is loaded per game mode (regular / pve / pvp-season). A boss the feed lists with an explicit
    // 0 % chance does not spawn in this mode; one started by a trigger (a lever, an extract switch) still does.
    const name = isGoons ? 'Кочевники' : text(mob?.name, mobKey || 'Босс')
    const key = isGoons ? 'goons' : mobId || name
    if (explicitZero(boss.spawnChance) && !text(boss.spawnTrigger)) { zeroed.push({ key, name }); return }
    const group = groups.get(key) ?? { key, name, spawnChance: 0, escorts: [], info: bossInfoFromMob(mob, name, items), points: [] }
    groups.set(key, group)
    group.spawnChance = Math.max(group.spawnChance, number(boss.spawnChance))
    if (!group.escorts.length) group.escorts = bossEscorts(boss, mobs, isGoons)
    const locations = [...asArray(boss.spawnLocations), ...(bossIndex === firstListingIndex(rawMap, mobs, mobId) ? EXTRA_BOSS_LOCATIONS[text(rawMap.normalizedName)]?.[mobId] ?? [] : [])]
    locations.forEach((location, locationIndex) => {
      if (!allowedZone(map.id, mobId, text(location.name))) return
      // A zone with an explicit 0 % chance is not used by this boss in this mode.
      if (explicitZero(location.chance)) return
      const zone = prettifyZone(text(location.name))
      const zoneKey = `${bossIndex}-${locationIndex}`
      const positions = asArray(location.positions)
      const valid = positions.filter((position) => Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.z)))
      // A zone without usable coordinates keeps its (unplaceable) first point, like before: baseMarker drops it.
      for (const position of valid.length ? valid : positions.slice(0, 1)) {
        group.points.push({ position, x: number(position.x), z: number(position.z), zone, zoneKey, zoneChance: number(location.chance) })
      }
    })
  })

  const liveMarkers = [...groups.values()].flatMap((group) => mergeBossSpawnPoints(group.points).flatMap((cluster, clusterIndex) => {
    const center = cluster.center
    const base = baseMarker(map, `boss-${group.key}-${clusterIndex}`, center.position, undefined, center.position.y, center.position.y)
    if (!base) return []
    const zones = [...new Set(cluster.points.map((point) => point.zone).filter(Boolean))]
    // Chance of the merged zones of this place (each zone counted once), e.g. two dorm zones of 33 % → 66 %.
    const zoneChances = new Map(cluster.points.map((point) => [point.zoneKey, point.zoneChance]))
    const locationChance = Math.min(1, [...zoneChances.values()].reduce((sum, chance) => sum + chance, 0))
    return [{
      ...base,
      type: 'boss',
      layerId: 'boss',
      title: group.name,
      description: `Возможная зона появления: ${zones.join(', ') || 'неизвестная зона'}.`,
      meta: group.spawnChance ? `${Math.round(group.spawnChance * 100)}%` : undefined,
      boss: {
        ...group.info,
        spawnChance: group.spawnChance || undefined,
        locationChance: locationChance || undefined,
        locationName: zones.join(', ') || undefined,
        escorts: group.escorts.length ? group.escorts : undefined,
      },
      source: 'json.tarkov.dev/maps',
    } satisfies MapMarker]
  }))
  if (!mode) return liveMarkers
  // Placed only when the live group has a drawable point (a zone-less listing or one filtered out does not count).
  const present = [...groups.values()].filter((group) => group.points.some((point) => Number.isFinite(Number(point.position.x)) && Number.isFinite(Number(point.position.z))))
  const liveZones: LiveBossZone[] = [...groups.values()].flatMap((group) => group.points.filter((point) => Number.isFinite(Number(point.position.x)) && Number.isFinite(Number(point.position.z))).map((point) => ({ zone: point.zone, x: point.x, y: Number.isFinite(Number(point.position.y)) ? Number(point.position.y) : undefined, z: point.z })))
  return [...liveMarkers, ...adaptSupplementBosses(map, mode, present, zeroed, liveZones, mobs, items)]
}

/**
 * Bosses from the owner's research list that the live feed has no points for on this map in this mode
 * (see bossSpawnSupplement.ts): approximate area markers with the research chance per mode.
 */
function adaptSupplementBosses(map: GameMap, mode: RaidMode, present: BossGroup[], zeroed: Array<{ key: string; name: string }>, liveZones: LiveBossZone[], mobs: Map<string, JsonRecord>, items: Map<string, Item>): MapMarker[] {
  return supplementBossesFor(map.id, mode, { present, zeroed }).flatMap((boss) => {
    const points = boss.areas.map((area) => ({ ...resolveSupplementArea(area, map, liveZones), zone: area.zone }))
    const mob = mobs.get(boss.infoKey) ?? [...mobs.values()].find((entry) => text(entry.normalizedName) === boss.infoKey)
    const info = mob ? bossInfoFromMob(mob, boss.name, items) : { key: boss.infoKey, name: boss.name }
    const chance = boss.modes[mode]?.chance
    return mergeBossSpawnPoints(points).flatMap((cluster, clusterIndex) => {
      const center = cluster.center
      const base = baseMarker(map, `boss-${boss.key}-supplement-${clusterIndex}`, { x: center.x, y: center.y, z: center.z }, undefined, center.y, center.y)
      if (!base) return []
      const zones = [...new Set(cluster.points.map((point) => point.zone))]
      return [{
        ...base,
        type: 'boss',
        layerId: 'boss',
        title: boss.name,
        description: [
          `Возможная зона появления: ${zones.join(', ')}.`,
          boss.note,
          supplementChanceText(boss),
          'Tarkov.dev пока не отмечает этого босса здесь — зона по списку боссов, точка приблизительная.',
        ].filter(Boolean).join(' '),
        meta: chance ? `${Math.round(chance * 100)}%` : undefined,
        approximate: true,
        boss: {
          ...info,
          key: boss.infoKey,
          name: boss.name,
          spawnChance: chance,
          locationName: zones.join(', '),
          escorts: boss.escorts,
        },
        source: 'boss-spawn-supplement',
      } satisfies MapMarker]
    })
  })
}

/** Our extra zones are added once per boss (to its first listing), not to every raider group. */
function firstListingIndex(rawMap: JsonRecord, mobs: Map<string, JsonRecord>, mobId: string) {
  return asArray(rawMap.bosses).findIndex((boss) => text(mobs.get(text(boss.mob))?.normalizedName) === mobId)
}

function explicitZero(value: unknown) {
  return value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) === 0
}

function bossEscorts(boss: JsonRecord, mobs: Map<string, JsonRecord>, isGoons: boolean) {
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
  return escorts
}

/**
 * Merges the spawn points of one boss on one map into places at least BOSS_MERGE_METRES apart.
 * Agglomerative: the two closest places merge until every pair is ≥ BOSS_MERGE_METRES apart. Each place is drawn at
 * its most central real spawn point (the medoid) — an average landed on roads and open ground between buildings
 * (Killa outside the mall, Shturman beside the sawmill), sometimes outside the building.
 */
export function mergeBossSpawnPoints<T extends { x: number; z: number }>(points: T[], metres = BOSS_MERGE_METRES): Array<{ center: T; points: T[] }> {
  if (!points.length) return []
  const distance = (a: T, b: T) => Math.hypot(a.x - b.x, a.z - b.z)
  const order = new Map(points.map((point, index) => [point, index]))
  let clusters = points.map((point) => ({ center: point, points: [point] }))
  for (;;) {
    let best: [number, number, number] | undefined
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const gap = distance(clusters[i].center, clusters[j].center)
        if (gap < metres && (!best || gap < best[2])) best = [i, j, gap]
      }
    }
    if (!best) break
    // Points keep the feed order (zone names are listed in that order).
    const merged = [...clusters[best[0]].points, ...clusters[best[1]].points].sort((a, b) => order.get(a)! - order.get(b)!)
    const center = medoid(merged, distance)
    clusters = [...clusters.filter((_, index) => index !== best![0] && index !== best![1]), { center, points: merged }]
  }
  // Stable order: the place with more spawn points (the boss's main spot) first, then west → east.
  return clusters.sort((a, b) => b.points.length - a.points.length || a.center.x - b.center.x || a.center.z - b.center.z)
}

function medoid<T>(points: T[], distance: (a: T, b: T) => number) {
  const spread = (candidate: T) => points.reduce((sum, other) => sum + distance(other, candidate), 0)
  return points.reduce((best, candidate) => (spread(candidate) < spread(best) ? candidate : best), points[0])
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
    // Battle pass documents get their own layer (adaptBattlePassDocuments).
    if (strings(loot.items).some((id) => BATTLE_PASS_DOCUMENT_ITEM_IDS.has(id))) return []
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

/** TerraGroup Labs keycards by tarkov.dev item id (names are localized, ids are not). */
const KEYCARD_IDS: Record<string, KeycardColor> = {
  '5c1d0efb86f7744baf2e7b7b': 'red',
  '5c1d0dc586f7744baf2e7b79': 'green',
  '5c1d0c5f86f7744bb2683cf0': 'blue',
  '5c1e495a86f7743109743dfb': 'violet',
  '5c1d0d6d86f7744bb2683e1f': 'yellow',
  '5c1d0f4986f7744bb01837fa': 'black',
  '5efde6b4f5448336730dbd61': 'blue-marking',
  '6711039f9e648049e50b3307': 'residential',
  '5c94bbff86f7747ee735c08f': 'access',
}

const KEYCARD_NAME_PATTERNS: Array<[RegExp, KeycardColor]> = [
  [/blue marking|синей (полос|марк|метк)/i, 'blue-marking'],
  [/residential|жил(ого|ой|ые)/i, 'residential'],
  [/access keycard|пропуск|доступа/i, 'access'],
  [/\(red\)|красн/i, 'red'],
  [/\(green\)|зел[её]н/i, 'green'],
  [/\(violet\)|фиолет/i, 'violet'],
  [/\(yellow\)|ж[её]лт/i, 'yellow'],
  [/\(black\)|ч[её]рн/i, 'black'],
  [/\(blue\)|син/i, 'blue'],
]

export function keycardColor(keyId: string, keyName = ''): KeycardColor | undefined {
  if (KEYCARD_IDS[keyId]) return KEYCARD_IDS[keyId]
  if (!/keycard|ключ-?карт/i.test(keyName)) return undefined
  return KEYCARD_NAME_PATTERNS.find(([pattern]) => pattern.test(keyName))?.[1]
}

const KEYCARD_LABELS: Record<KeycardColor, string> = {
  red: 'Ключ-карта TerraGroup Labs (красная)',
  green: 'Ключ-карта TerraGroup Labs (зелёная)',
  blue: 'Ключ-карта TerraGroup Labs (синяя)',
  violet: 'Ключ-карта TerraGroup Labs (фиолетовая)',
  yellow: 'Ключ-карта TerraGroup Labs (жёлтая)',
  black: 'Ключ-карта TerraGroup Labs (чёрная)',
  'blue-marking': 'Ключ-карта с синей полосой',
  residential: 'Ключ-карта жилого блока TerraGroup Labs',
  access: 'Ключ-карта доступа в Лабораторию',
}

function adaptLocks(map: GameMap, rawMap: JsonRecord, items: Map<string, Item>): MapMarker[] {
  return asArray(rawMap.locks).flatMap((lock, index) => {
    const base = baseMarker(map, `lock-${text(lock.id, String(index))}`, lock.position, undefined, asRecord(lock.position).y, asRecord(lock.position).y)
    if (!base) return []
    const keyId = text(lock.key) || text(asRecord(lock.key).id)
    const key = items.get(keyId)
    const keycard = keycardColor(keyId, key?.name ?? text(asRecord(lock.key).name))
    // tarkov.dev names the card in the catalog language; a Russian catalog without the name gets our label.
    const keyName = (key?.name ?? text(asRecord(lock.key).name)).trim()
    const shownName = keyName || (keycard ? KEYCARD_LABELS[keycard] : '')
    const needsPower = Boolean(lock.needsPower)
    const needs = keycard ? `Нужна ключ-карта «${shownName}».` : `Нужен ключ «${shownName}».`
    const lockType = text(lock.lockType, 'door')
    const lockLabel = lockType === 'container' ? 'Запертый контейнер' : lockType === 'trunk' ? 'Дверь или багажник машины' : 'Дверь'
    return [{
      ...base,
      type: 'key' as const,
      layerId: 'key' as const,
      title: shownName ? `${lockLabel} · открывает: ${shownName}` : lockType === 'door' ? 'Запертая дверь' : lockLabel,
      description: `${shownName ? needs : 'Требуется ключ.'}${needsPower ? ' Также необходимо питание.' : ''}`,
      // Keycard doors show the card colour in the tooltip instead.
      meta: keycard ? undefined : 'Запертая дверь',
      itemId: keyId || undefined,
      lock: { keyId: keyId || undefined, keyName: shownName, keycard, needsPower: needsPower || undefined },
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

/** Candidate points of one objective closer than this (and on one floor) are one room / building. */
export const POSSIBLE_SPOT_METRES = 20
/** Height difference that still counts as the same floor. */
const SAME_FLOOR_METRES = 3
/** The same zone or spawn point listed twice (e.g. once per map variant) is drawn once; distinct points are all kept. */
const DUPLICATE_POINT_METRES = 0.25

interface QuestPoint {
  kind: 'zone' | 'item'
  map: GameMap
  x: number
  y?: number
  z: number
  idSuffix: string
  zone?: JsonRecord
  position: JsonRecord
}

function adaptQuestZones(taskRoot: JsonRecord, context: MarkerContext): MapMarker[] {
  const markers: MapMarker[] = []
  const maps = new Map(context.maps.map((map) => [map.id, map]))

  for (const quest of context.quests) {
    const rawTask = asRecord(asRecord(taskRoot.tasks)[quest.id])
    const questMarkers: MapMarker[] = []
    for (const objective of asArray(rawTask.objectives)) {
      const objectiveId = text(objective.id)
      const points: QuestPoint[] = []
      for (const zone of asArray(objective.zones)) {
        const map = resolveMap(text(zone.map) || strings(objective.maps)[0], context, maps)
        if (!map) continue
        const center = asRecord(zone.position)
        points.push({ kind: 'zone', map, ...pointCoords(center), idSuffix: text(zone.id, objectiveId), zone, position: center })
      }
      // Quest items (findQuestItem) carry exact spawn points instead of zones.
      asArray(objective.possibleLocations).forEach((location, locationIndex) => {
        const map = resolveMap(text(location.map) || strings(objective.maps)[0], context, maps)
        if (!map) return
        asArray(location.positions).forEach((position, index) => {
          const idSuffix = `${objectiveId}-${locationIndex ? `${locationIndex}-` : ''}${index}`
          points.push({ kind: 'item', map, ...pointCoords(position), idSuffix, position })
        })
      })
      const itemObjective = objectiveLayer(objective) === 'quest.item' || asArray(objective.possibleLocations).length > 0
      const itemId = text(objective.questItem) || text(asRecord(objective.questItem).id) || undefined
      for (const mapPoints of groupBy(uniquePoints(points), (point) => point.map.id).values()) {
        const possible = possibleSpots(mapPoints, itemObjective)
        mapPoints.forEach((point, index) => {
          const base = point.kind === 'zone'
            ? baseMarker(point.map, `quest-zone-${quest.id}-${point.idSuffix}`, point.position, point.zone?.outline, point.zone?.top, point.zone?.bottom)
            : baseMarker(point.map, `quest-item-${quest.id}-${point.idSuffix}`, point.position, undefined, undefined, undefined)
          if (!base) return
          const spot = possible.get(index)
          const isItem = point.kind === 'item'
          questMarkers.push({
            ...base,
            type: 'quest',
            layerId: isItem ? 'quest.item' : objectiveLayer(objective),
            title: quest.name,
            description: text(objective.description, isItem ? 'Квестовый предмет.' : 'Зона выполнения задания.'),
            // «Возможное место предмета · 1 из 4» is drawn by the tooltip from `possibleSpot`.
            meta: `${quest.trader} · ур. ${quest.level}${isItem && !spot ? ' · место предмета' : ''}`,
            questId: quest.id,
            objectiveId: objectiveId || undefined,
            possibleSpot: spot,
            itemId: isItem ? itemId : undefined,
            source: 'json.tarkov.dev/tasks',
          })
        })
      }
    }
    markers.push(...unifyQuestLayers(questMarkers))
  }

  return markers
}

function pointCoords(position: JsonRecord) {
  const y = Number(position.y)
  return { x: number(position.x), y: position.y == null || !Number.isFinite(y) ? undefined : y, z: number(position.z) }
}

function sameFloor(a: { y?: number }, b: { y?: number }, metres: number) {
  return a.y == null || b.y == null || Math.abs(a.y - b.y) <= metres
}

/** Drops repeated points of one objective (tarkov.dev lists some zones twice, e.g. once per map variant). */
function uniquePoints(points: QuestPoint[]) {
  const kept: QuestPoint[] = []
  for (const point of points) {
    const twin = kept.find((other) => other.map.id === point.map.id && other.kind === point.kind
      && Math.hypot(other.x - point.x, other.z - point.z) < DUPLICATE_POINT_METRES && sameFloor(other, point, DUPLICATE_POINT_METRES))
    if (!twin) kept.push(point)
  }
  return kept
}

/**
 * Candidate points of one objective on one map. The item of a find objective lies at one of its listed
 * spawn points, so all of them are «possible places». Zones of other objectives count as alternatives
 * only when several of them sit in one room / building (closer than POSSIBLE_SPOT_METRES, same floor).
 */
export function possibleSpots(points: Array<{ x: number; y?: number; z: number }>, itemObjective: boolean): Map<number, PossibleSpot> {
  const result = new Map<number, PossibleSpot>()
  if (points.length < 2) return result
  const candidates = itemObjective
    ? points.map((_, index) => index)
    : points.map((_, index) => index).filter((index) => points.some((other, otherIndex) => otherIndex !== index
      && Math.hypot(other.x - points[index].x, other.z - points[index].z) <= POSSIBLE_SPOT_METRES
      && sameFloor(other, points[index], SAME_FLOOR_METRES)))
  if (candidates.length < 2) return result
  candidates.forEach((pointIndex, order) => result.set(pointIndex, { kind: itemObjective ? 'item' : 'zone', index: order + 1, count: candidates.length }))
  return result
}

/** «Возможное место предмета · 2 из 4»: the tooltip / card line for a candidate point (also for the map card). */
export function possibleSpotText(spot: PossibleSpot) {
  return `${spot.kind === 'item' ? 'Возможное место предмета' : 'Возможная точка задания'} · ${spot.index} из ${spot.count}`
}

/**
 * One quest keeps one icon on a map: a quest whose points there are all item spawns stays «Квестовый предмет»,
 * any other quest (e.g. «visit the room» + «find the drive» in that room) is drawn with the quest icon everywhere.
 */
function unifyQuestLayers(markers: MapMarker[]): MapMarker[] {
  const layerByMap = new Map<string, MarkerLayerId>()
  for (const [mapId, onMap] of groupBy(markers, (marker) => marker.mapId)) {
    layerByMap.set(mapId, onMap.every((marker) => marker.layerId === 'quest.item') ? 'quest.item' : 'quest.zone')
  }
  return markers.map((marker) => ({ ...marker, layerId: layerByMap.get(marker.mapId) ?? marker.layerId }))
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const id = key(value)
    const group = groups.get(id)
    if (group) group.push(value)
    else groups.set(id, [value])
  }
  return groups
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
