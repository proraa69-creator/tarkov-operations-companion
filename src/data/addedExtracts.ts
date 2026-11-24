/**
 * Exits the game has that tarkov.dev does not list yet, added to its extracts by map id (src/data/mapMarkerAdapter.ts).
 * One is dropped as soon as tarkov.dev lists an exit of the same name. Texts in Russian like the rest of the map copy
 * (English: src/i18n/uiEnglishMap.ts).
 *
 * Lighthouse: the vehicle exit by the transit to Reserve (owner, 01.11.2026, a player's report with an in-game
 * screenshot: «Выхода автомобиль нету на карте около перехода на резерв»). tarkov.dev (PvP and PvE) lists the transit
 * only; the car stands on the road next to it, so the exit is drawn at the transit's road, a few metres aside.
 */
export interface AddedExtract {
  id: string
  name: string
  faction: 'pmc' | 'scav' | 'shared'
  position: { x: number; y: number; z: number }
  note: string
}

export const ADDED_EXTRACTS: Record<string, AddedExtract[]> = {
  lighthouse: [{
    id: 'raidos-lighthouse-reserve-vex',
    name: 'Дорога к военной базе (V-Ex)',
    faction: 'pmc',
    position: { x: -308, y: 15.3, z: -780.7 },
    note: 'Выход на машине у перехода на Резерв: платный, машина уезжает с первым игроком.',
  }],
}

/** The added exits of a map (tarkov.dev's normalizedName) as tarkov.dev records, without those it already lists. */
export function addedExtractRecords(mapId: string, listed: Array<Record<string, unknown>>) {
  const names = new Set(listed.map((extract) => String(extract.name ?? '').trim().toLowerCase()))
  return (ADDED_EXTRACTS[mapId] ?? []).filter((extract) => !names.has(extract.name.toLowerCase()) && !/v-?ex/i.test([...names].join(' ')))
}
