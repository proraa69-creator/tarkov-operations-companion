import type { MapMarker } from '../domain/types'

/**
 * Points standing on another floor than their height says. A map's floors are one height range for all its buildings, and on Улицы Таркова
 * the buildings do not agree: the second floor of the clinic is at 2.5–5 m, inside the range of the ground level, and the parking under
 * ЖК Concordia is at −0.4 m. Told by players who stood there (reports №87 and №88 and their screenshots, 07.11.2026).
 * Here, on the player's device, so a catalog built earlier gets them too; a point the owner corrected by hand is applied after this.
 */
const SECOND_FLOOR = '2 этаж'
const UNDERGROUND = 'Подземный'

const BY_ID: Readonly<Record<string, string>> = {
  // «Что-то мне это напоминает...»: «в палате невинно обожжённой девочки».
  'streets-of-tarkov-quest-zone-66d9cbb67b491f9d5304f6e6-Zone_silient_hill_ward': SECOND_FLOOR,
  // «Инвентаризация»: «Осмотреть питомник» and «Проверить кабинет рентгенолога».
  'streets-of-tarkov-quest-zone-64f731ab83cfca080a361e42-quest_zone_find_2st_med_invent1': SECOND_FLOOR,
  'streets-of-tarkov-quest-zone-64f731ab83cfca080a361e42-quest_zone_find_2st_med_invent2': SECOND_FLOOR,
  // «Должник»: «Второй этаж» (report №106, 09.11.2026): the zone stands at 6 m, in the ground level's range.
  'streets-of-tarkov-quest-zone-639dbaf17c898a131e1cffff-quest_zone_c29_debt': SECOND_FLOOR,
}

/** The rest of these ids is the objective's text, in the language of the catalog. */
const BY_START: ReadonlyArray<readonly [string, string]> = [
  // «Наблюдение»: «на подземной парковке ЖК Concordia».
  ['streets-of-tarkov-quest-item-639135e8c115f907b14700aa-', UNDERGROUND],
]

function floorOf(id: string) {
  return BY_ID[id] ?? BY_START.find(([start]) => id.startsWith(start))?.[1]
}

export function withMarkerFloorFixes(markers: MapMarker[]): MapMarker[] {
  let changed = false
  const next = markers.map((marker) => {
    const floor = floorOf(marker.id)
    if (!floor || marker.floor === floor) return marker
    changed = true
    return { ...marker, floor }
  })
  return changed ? next : markers
}
