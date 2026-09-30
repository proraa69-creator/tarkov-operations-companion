/**
 * «Документы боевого пропуска» (Season 1 «KORD BREACH», patch 1.1.0, since 3 Aug 2026): where each document spawns.
 *
 * Positions: game coordinates (x, z — tarkov.dev's coordinate space, no height) from the community map
 * szepiz/tarkov-quest-data `mapdata/bpdocs.json` (CC0-1.0, «placed by hand … checked against the game», as of
 * 2026-08-16). No official or tarkov.dev source publishes these points, so every marker is shown as approximate.
 * Pins of different documents closer than 2.5 m are one point listing all its documents. `place` is a guide description
 * (keengamer, skycoach, escorenews, insider-gaming; Aug–Sep 2026) anchored to the pin by landmark; otherwise `near`
 * is the closest named place (tarkov.dev map label or the community map's label, within 60 m).
 * Floors are not stored: the source's floor numbers could not be matched to our map layers reliably.
 * Research notes and the per-map guide lists: scratchpad research/documents.md (owner to confirm with screenshots).
 * Icebreaker and «Classified documents» have no pins in the source yet.
 *
 * The app also picks up documents from tarkov.dev loose loot at runtime (see BATTLE_PASS_DOCUMENT_ITEM_IDS) if the
 * feed ever lists them.
 */
export type BattlePassDocumentKind = 'financial' | 'medical' | 'blueprints' | 'pmc-files' | 'user-docs' | 'test-docs' | 'technical' | 'project'

/** In-game names (RU client / EN client) and tarkov.dev item ids of the battle pass documents. */
export const BATTLE_PASS_DOCUMENT_KINDS: Record<BattlePassDocumentKind, { itemId: string; ru: string; en: string }> = {
  financial: { itemId: '6a31807f17005505b70d5827', ru: 'Финансовая документация', en: 'Financial documents' },
  medical: { itemId: '6a3182dc6cd8de21cf0a3a7d', ru: 'Медицинская документация', en: 'Medical documents' },
  blueprints: { itemId: '6a31824878450ec91c0ea1ae', ru: 'Чертежи и техническая документация', en: 'Blueprints and technical documentation' },
  'pmc-files': { itemId: '6a317b9692cfdcddcb02a58e', ru: 'Личные данные ЧВК', en: 'PMC personnel files' },
  'user-docs': { itemId: '6a3182b72fd891345e047eef', ru: 'Пользовательская документация', en: 'User documentation' },
  'test-docs': { itemId: '6a31828557705071410ca00e', ru: 'Тестовая документация', en: 'Test documentation' },
  technical: { itemId: '6a31830dde69ceafd805afa0', ru: 'Эксплуатационная документация', en: 'Technical documentation' },
  project: { itemId: '6a3181f178450ec91c0ea1aa', ru: 'Проектная документация', en: 'Project documentation' },
}

/** tarkov.dev item id → document kind (for loose loot in the live maps feed). */
export const BATTLE_PASS_DOCUMENT_ITEM_IDS: ReadonlyMap<string, BattlePassDocumentKind> = new Map(
  (Object.entries(BATTLE_PASS_DOCUMENT_KINDS) as Array<[BattlePassDocumentKind, { itemId: string }]>).map(([kind, entry]) => [entry.itemId, kind]),
)

export interface BattlePassDocumentPoint {
  x: number
  z: number
  y?: number
  documents: BattlePassDocumentKind[]
  /** Guide description of the exact place (RU / EN). */
  place?: { ru: string; en: string }
  /** Nearest named place on the map (English map label). */
  near?: string
  /** Free text (legacy). */
  note?: string
}

export const BATTLE_PASS_DOCUMENTS_SOURCE = 'szepiz/tarkov-quest-data mapdata/bpdocs.json (CC0), 2026-08-16'

/** Russian text of one point: which documents, where, and that the point is approximate. */
export function battlePassDocumentDescription(point: BattlePassDocumentPoint) {
  const kinds = point.documents.map((kind) => BATTLE_PASS_DOCUMENT_KINDS[kind].ru).join(', ')
  const where = point.place ? ` ${point.place.ru}.` : point.near ? ` Ориентир: ${point.near}.` : ''
  return `${kinds}.${where}${point.note ? ` ${point.note}` : ''} ${APPROXIMATE_NOTE}`
}

function battlePassDocumentDescriptionEn(point: BattlePassDocumentPoint) {
  const kinds = point.documents.map((kind) => BATTLE_PASS_DOCUMENT_KINDS[kind].en).join(', ')
  const where = point.place ? ` ${point.place.en}.` : point.near ? ` Landmark: ${point.near}.` : ''
  return `${kinds}.${where}${point.note ? ` ${point.note}` : ''} ${APPROXIMATE_NOTE_EN}`
}

const APPROXIMATE_NOTE_EN = 'Placed by players by hand in the game; the spot is approximate.'

export const APPROXIMATE_NOTE = 'Точку поставили игроки вручную по игре — место приблизительное.'

/** RU → EN pairs for the interface dictionary (src/i18n/uiEnglishGameData.ts). */
export function battlePassDocumentPhrases(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    [APPROXIMATE_NOTE, APPROXIMATE_NOTE_EN],
    ['Ориентир:', 'Landmark:'],
    ...Object.values(BATTLE_PASS_DOCUMENT_KINDS).map((kind): [string, string] => [kind.ru, kind.en]),
  ]
  for (const point of Object.values(BATTLE_PASS_DOCUMENTS).flat()) {
    if (point.place) pairs.push([point.place.ru, point.place.en])
    // The whole description as well: exact matches are translated without the phrase-by-phrase pass.
    pairs.push([battlePassDocumentDescription(point), battlePassDocumentDescriptionEn(point)])
  }
  return [...new Map(pairs).entries()]
}

export const BATTLE_PASS_DOCUMENTS: Record<string, BattlePassDocumentPoint[]> = {
  factory: [
    { x: 25.8, z: -26.08, documents: ['blueprints'], near: 'Heli Crash' },
    { x: 33.91, z: -36.08, documents: ['blueprints'], near: 'East Halls' },
    { x: -15.4, z: -25.86, documents: ['blueprints'], near: 'Med Tent' },
    { x: 20.29, z: 42.22, documents: ['blueprints'], near: 'Hole' },
    { x: 26.66, z: 43.04, documents: ['blueprints', 'project'], near: 'Locker Rooms' },
    { x: 28.8, z: 37.97, documents: ['blueprints'], near: 'Locked Office' },
    { x: 11.58, z: 38.85, documents: ['blueprints'], near: 'South Stairs' },
    { x: 19.07, z: -22.27, documents: ['blueprints'], near: 'Heli Crash' },
    { x: 25.65, z: -35.18, documents: ['blueprints'], near: 'East Halls' },
    { x: 11.42, z: 41.67, documents: ['project'], near: 'South Stairs' },
    { x: 55.45, z: 24.14, documents: ['project'], near: 'Boilers' },
    { x: 30.34, z: -34.69, documents: ['project'], near: 'East Halls' },
    { x: 41.48, z: -15.36, documents: ['project'], near: 'Pumping Station' },
    { x: 23.01, z: 39.67, documents: ['project'], near: 'Breach Room' },
    { x: -22.78, z: 29.32, documents: ['project'], near: 'Servers' },
    { x: 26.34, z: -18.96, documents: ['project'], near: 'Heli Crash' },
  ],
  interchange: [
    { x: -68.17, z: -157.55, documents: ['blueprints'], near: 'Book Store' },
    { x: 3.33, z: -232.75, documents: ['blueprints'], near: 'Garage A' },
    { x: -67.84, z: 54.12, documents: ['blueprints', 'financial'], near: 'Avokado' },
    { x: -92.75, z: 106.8, documents: ['blueprints'], near: 'Oli Warehouse' },
    { x: 35.6, z: 149.21, documents: ['blueprints'], place: { ru: 'OLI — компьютерные кабинки в глубине магазина', en: 'OLI — the PC cubicles in the back of the store' } },
    { x: -79.64, z: -146.27, documents: ['blueprints'], near: 'Book Store' },
    { x: 60.67, z: -25.48, documents: ['blueprints'], near: 'Burger House' },
    { x: -64.52, z: -99.52, documents: ['blueprints'], near: 'Bizarro' },
    { x: 2.06, z: -290.43, documents: ['blueprints'], place: { ru: 'Офисы IDEA — на столах', en: 'IDEA offices — on the desks' } },
    { x: 85.21, z: 100.42, documents: ['blueprints'], place: { ru: 'OLI — задние офисы', en: 'OLI — the back offices' } },
    { x: -79.11, z: 43.99, documents: ['blueprints'], near: 'Avokado' },
    { x: -84.55, z: 113.35, documents: ['blueprints'], near: 'Oli Warehouse' },
    { x: 95.84, z: -84.09, documents: ['blueprints'], near: 'Spiel' },
    { x: -78.45, z: -148.97, documents: ['financial'], near: 'Book Store' },
    { x: 4.03, z: -297.99, documents: ['financial'], place: { ru: 'Офисы IDEA — на столах', en: 'IDEA offices — on the desks' } },
    { x: 420.91, z: 176.8, documents: ['financial'] },
    { x: 86.34, z: 104.33, documents: ['financial'], place: { ru: 'OLI — задние офисы', en: 'OLI — the back offices' } },
    { x: -206.98, z: -356.84, documents: ['financial'], near: 'Power Station' },
    { x: 41.34, z: -223.7, documents: ['financial'], near: 'Garage A' },
    { x: 15.96, z: -134.3, documents: ['financial'], near: 'TTS' },
    { x: -12.46, z: -96.33, documents: ['financial'], near: 'Voyage' },
    { x: -200.3, z: -353.79, documents: ['financial'], near: 'Power Station' },
    { x: 130.63, z: 267.12, documents: ['financial'] },
    { x: 21.78, z: -133.15, documents: ['financial'], near: 'TTS' },
    { x: -67.08, z: 41.75, documents: ['financial'], near: 'Avokado' },
    { x: -61.22, z: -47.48, documents: ['financial'], near: 'Philly Cute' },
    { x: 79.46, z: -208.41, documents: ['financial'], near: 'Nortex' },
    { x: -64.97, z: -158.68, documents: ['financial'], near: 'Book Store' },
  ],
  'the-labyrinth': [
    { x: -16.38, z: 8.72, documents: ['blueprints'], near: 'Assembly Room' },
    { x: 9.73, z: 2.48, documents: ['blueprints'], near: 'Observation Room' },
    { x: -14.63, z: 51.89, documents: ['blueprints'], near: 'Dead Scientist #4' },
    { x: -11.07, z: 26.68, documents: ['blueprints'], near: 'Assembly Room' },
    { x: -7.23, z: 35.96, documents: ['blueprints'], near: 'Assembly Room' },
    { x: -8.41, z: 22.97, documents: ['blueprints'], near: 'Assembly Room' },
    { x: 17.08, z: 7.88, documents: ['blueprints'], near: 'Torture Room' },
    { x: 12.7, z: 4.51, documents: ['blueprints'], near: 'Observation Room' },
    { x: 3.61, z: 28.84, documents: ['blueprints'], near: 'Dead Scientist #3' },
    { x: 8.44, z: -11.01, documents: ['blueprints', 'medical'], near: 'Corpse Room' },
    { x: 1.15, z: 54.36, documents: ['blueprints', 'medical'], near: 'Dead Scientist #4' },
    { x: 12.23, z: 31.39, documents: ['blueprints', 'medical'], near: 'Dead Scientist #3' },
    { x: -27.2, z: 35.88, documents: ['blueprints'], near: 'Dead Scientist #4' },
    { x: 19.22, z: 4.61, documents: ['blueprints'], near: 'Torture Room' },
    { x: 12.95, z: 9.43, documents: ['medical'], near: 'Observation Room' },
    { x: -17.15, z: 35.21, documents: ['medical'], near: 'Assembly Room' },
    { x: -7.4, z: 30.78, documents: ['medical'], near: 'Assembly Room' },
    { x: 14.8, z: 16.63, documents: ['medical'], near: 'Shrine of the Minotaur' },
    { x: -5.39, z: 10.15, documents: ['medical'], near: 'Observation Room' },
    { x: 12.31, z: 18.79, documents: ['medical'], near: 'Shrine of the Minotaur' },
    { x: -6.11, z: 28.17, documents: ['medical'], near: 'Assembly Room' },
    { x: -0.9, z: 35.83, documents: ['medical'], near: 'Assembly Room' },
    { x: 8.95, z: 5.21, documents: ['medical'], near: 'Observation Room' },
    { x: -25.1, z: 40.4, documents: ['medical'], near: 'Dead Scientist #4' },
    { x: -26.62, z: 9.17, documents: ['medical'], near: 'Assembly Room' },
  ],
  customs: [
    { x: 77.97, z: -162.1, documents: ['financial'], place: { ru: 'Библиотека (Crackhouse), 2-й этаж — на полу у книжных полок или между книгами', en: 'Crackhouse library, 2nd floor — on the floor by the bookshelves or between the books' } },
    { x: 77.65, z: -155.94, documents: ['financial'], place: { ru: 'Библиотека (Crackhouse), 2-й этаж — на полу у книжных полок или между книгами', en: 'Crackhouse library, 2nd floor — on the floor by the bookshelves or between the books' } },
    { x: 318.24, z: -186.86, documents: ['financial'], place: { ru: 'Старая заправка — на столе в здании', en: 'Old gas station — on the desk inside the building' } },
    { x: -207.19, z: -54.46, documents: ['financial'] },
    { x: 93.68, z: -59.59, documents: ['financial'], near: 'Repair Shop' },
    { x: -200.72, z: -98.71, documents: ['financial'], near: 'Big Red' },
    { x: 169.6, z: 156.81, documents: ['financial'], place: { ru: 'Общежития — по гайдам: комнаты 212 и 304 трёхэтажного общежития (на тумбочке) и двухэтажное общежитие', en: 'Dorms — per guides: rooms 212 and 304 of the three-story dorm (on the nightstand) and the two-story dorm' } },
    { x: 172.86, z: 185.88, documents: ['financial', 'project'], place: { ru: 'Общежития — по гайдам: комнаты 212 и 304 трёхэтажного общежития (на тумбочке) и двухэтажное общежитие', en: 'Dorms — per guides: rooms 212 and 304 of the three-story dorm (on the nightstand) and the two-story dorm' } },
    { x: 225.09, z: 141.38, documents: ['financial'], place: { ru: 'Общежития — по гайдам: комнаты 212 и 304 трёхэтажного общежития (на тумбочке) и двухэтажное общежитие', en: 'Dorms — per guides: rooms 212 and 304 of the three-story dorm (on the nightstand) and the two-story dorm' } },
    { x: 263.12, z: -75.93, documents: ['financial'], place: { ru: 'Промзона (Industrial Plant) — офис на верхнем этаже', en: 'Industrial plant — the office on the top floor' } },
    { x: 78.92, z: -158.42, documents: ['project'], place: { ru: 'Библиотека (Crackhouse), 2-й этаж — на полках или под окном', en: 'Crackhouse library, 2nd floor — on the shelves or under the window' } },
    { x: 78.49, z: -166.72, documents: ['project'], place: { ru: 'Библиотека (Crackhouse), 2-й этаж — на полках или под окном', en: 'Crackhouse library, 2nd floor — on the shelves or under the window' } },
    { x: 315.76, z: -180.25, documents: ['project'], place: { ru: 'Старая заправка — у входной двери', en: 'Old gas station — next to the entrance door' } },
    { x: 197.28, z: -102.77, documents: ['project'], near: 'Fortress' },
    { x: 68.9, z: -169.76, documents: ['project'], near: 'Crackhouse' },
    { x: 25.41, z: -58.95, documents: ['project'], near: 'Warehouse 17' },
    { x: 90.25, z: -58.36, documents: ['project'], near: 'Repair Shop' },
    { x: 106.01, z: -87.31, documents: ['project'], near: 'Repair Shop' },
  ],
  'streets-of-tarkov': [
    { x: 72.61, z: -20.63, documents: ['financial'], near: 'Cardinal Bank' },
    { x: 59.92, z: -60.86, documents: ['financial'], place: { ru: 'Офис TerraGroup со стороны двора «Кардинала»', en: 'TerraGroup office on the Cardinal courtyard side' } },
    { x: 57.11, z: -70.91, documents: ['financial', 'user-docs'], place: { ru: 'Офис TerraGroup со стороны двора «Кардинала»', en: 'TerraGroup office on the Cardinal courtyard side' } },
    { x: 67.51, z: -58.46, documents: ['user-docs'], place: { ru: 'Офис TerraGroup со стороны двора «Кардинала»', en: 'TerraGroup office on the Cardinal courtyard side' } },
    { x: -170.37, z: 224.9, documents: ['user-docs'], near: 'Office' },
    { x: 84.02, z: -23.48, documents: ['user-docs'], near: 'Cardinal Bank' },
    { x: 115.57, z: -40.56, documents: ['user-docs'], near: 'Cardinal Bank (Unity Credit)' },
    { x: 171.43, z: 162.56, documents: ['user-docs'], near: 'IT Firm Office' },
    { x: -24.51, z: -32.79, documents: ['user-docs'], near: 'Beluga' },
    { x: 135.09, z: 5.32, documents: ['user-docs'], near: 'Kilmov St.' },
    { x: 139.8, z: 378.4, documents: ['user-docs'], near: 'Gale' },
    { x: 152.25, z: 345.24, documents: ['user-docs'], near: 'Polygon' },
    { x: 49, z: 34.42, documents: ['user-docs'], near: 'Corner Diner' },
    { x: -67.75, z: 49.89, documents: ['user-docs'], near: 'Dental' },
    { x: -53.16, z: 62.13, documents: ['user-docs'], near: 'Dental' },
  ],
  'ground-zero': [
    { x: -5.5, z: 61.98, documents: ['medical'], near: 'Science Office' },
    { x: 23.25, z: 71.97, documents: ['medical'], near: 'Coffee Maniac' },
    { x: -18.25, z: 44.85, documents: ['medical'], place: { ru: 'Здание TerraGroup, 2-й этаж — офис учёных (ключ Science office)', en: 'TerraGroup building, 2nd floor — the science office (Science office key)' } },
    { x: -6.34, z: 72.46, documents: ['medical'], near: 'Science Office' },
    { x: 49.36, z: 252.41, documents: ['medical'], near: 'GAGRIN Hotel' },
    { x: 101.48, z: 112.59, documents: ['medical'], near: 'Oasis' },
    { x: 146.99, z: 237.58, documents: ['medical'], near: 'Golden World' },
    { x: 101.83, z: 154.1, documents: ['medical'], near: 'Olive Restaurant' },
    { x: 81.68, z: 129.62, documents: ['medical'], near: 'Coffee Vice' },
    { x: 61.06, z: 150.22, documents: ['user-docs'], near: 'Tarbank' },
    { x: -36.45, z: 65.01, documents: ['user-docs'], near: 'Science Office' },
    { x: -10.78, z: 40.85, documents: ['user-docs'], place: { ru: 'Здание TerraGroup, 2-й этаж — офис учёных (ключ Science office)', en: 'TerraGroup building, 2nd floor — the science office (Science office key)' } },
    { x: -44.74, z: 64.44, documents: ['user-docs'], near: 'Science Office' },
    { x: 14.18, z: 66.05, documents: ['user-docs'], near: 'Coffee Maniac' },
    { x: 52.65, z: 137.1, documents: ['user-docs'], near: 'Tarbank' },
    { x: -6.85, z: 56.26, documents: ['user-docs'], near: 'Science Office' },
    { x: -27.63, z: 80.47, documents: ['user-docs'], near: 'Science Office' },
    { x: -22.95, z: 83.67, documents: ['user-docs'], near: 'Science Office' },
    { x: 55.02, z: 152.84, documents: ['user-docs'], near: 'Tarbank' },
  ],
  'the-lab': [
    { x: -129.04, z: -392.5, documents: ['medical'], near: 'Infirmary Lvl 1' },
    { x: -108.22, z: -443.93, documents: ['medical'], near: 'Residential' },
    { x: -122.05, z: -368.49, documents: ['medical'], near: 'Sterile Laboratory' },
    { x: -231.6, z: -342.87, documents: ['medical'], near: 'Conference Room' },
    { x: -114.1, z: -364.32, documents: ['medical'], near: 'Sterile Laboratory' },
    { x: -134.35, z: -408.18, documents: ['medical'], near: 'Infirmary Lvl 2' },
    { x: -86.64, z: -432.28, documents: ['medical'], near: 'Residential' },
    { x: -126.15, z: -352.15, documents: ['medical'], near: 'Test Room' },
    { x: -121.9, z: -360.84, documents: ['medical'], near: 'Sterile Laboratory' },
    { x: -233.62, z: -312.18, documents: ['medical'], near: 'Gym' },
    { x: -268.62, z: -325.83, documents: ['user-docs'], near: 'Security Barracks' },
    { x: -231.87, z: -345.41, documents: ['user-docs'], near: 'Conference Room' },
    { x: -161.18, z: -347.31, documents: ['user-docs'], near: 'Central Discharge Collector' },
    { x: -172.73, z: -342.41, documents: ['user-docs'], near: 'Main Working Area' },
    { x: -118.83, z: -445.38, documents: ['user-docs'], near: 'Residential' },
    { x: -244.06, z: -382.48, documents: ['user-docs'], near: 'Vestibules #1' },
    { x: -225.81, z: -308.43, documents: ['user-docs'], near: 'Cafeteria' },
    { x: -263.64, z: -342.79, documents: ['user-docs'], near: 'Switchboard' },
    { x: -187.66, z: -407.33, documents: ['user-docs'], near: 'Offices #1' },
    { x: -148.4, z: -393.4, documents: ['user-docs'], near: 'Negotiation Room' },
    { x: -251.16, z: -368.43, documents: ['user-docs'], near: 'Boiler Room' },
  ],
  lighthouse: [
    { x: -63.28, z: -734.4, documents: ['pmc-files'], near: 'Plant 2' },
    { x: -186.66, z: -210.03, documents: ['pmc-files'], near: 'Village' },
    { x: -92.48, z: -490.18, documents: ['pmc-files'] },
    { x: -88.21, z: -72.28, documents: ['pmc-files'], near: 'Pikes Peak Resort' },
    { x: -106.57, z: -12.92, documents: ['pmc-files'], near: 'Pikes Peak Resort' },
    { x: -120.65, z: 86.1, documents: ['pmc-files'], near: 'Grand Chalet' },
    { x: -95.73, z: -489.91, documents: ['technical'] },
    { x: -174.87, z: -645.22, documents: ['technical'], near: 'Plant 3' },
    { x: -191.49, z: -196.75, documents: ['technical'], near: 'Village' },
    { x: 134.16, z: -186.62, documents: ['technical'], near: 'Docks (Boathouses)' },
    { x: 140.49, z: -129.05, documents: ['technical'], near: 'Boathouses' },
    { x: -78.18, z: -85.73, documents: ['technical'], near: 'Pikes Peak Resort' },
    { x: -59.9, z: -129.28, documents: ['technical'] },
    { x: 29.32, z: -620.64, documents: ['technical'], near: 'Plant 1' },
    { x: -116.87, z: 97.17, documents: ['technical'], near: 'Grand Chalet' },
    { x: -86.94, z: -66.16, documents: ['technical'], near: 'Pikes Peak Resort' },
    { x: -68.24, z: 112.7, documents: ['technical'], near: 'Tennis Court' },
  ],
  reserve: [
    { x: -127.97, z: -21.83, documents: ['pmc-files'], near: 'Black Bishop' },
    { x: -42.25, z: 133.2, documents: ['pmc-files'], near: 'White Queen' },
    { x: -4.38, z: 175.43, documents: ['pmc-files', 'project'], near: 'Dome' },
    { x: -42.14, z: 174.18, documents: ['pmc-files'], near: 'White Queen' },
    { x: -11.03, z: 196.9, documents: ['pmc-files'], near: 'White Queen' },
    { x: -16.12, z: 175.6, documents: ['pmc-files'], near: 'Dome' },
    { x: -159.49, z: 0.03, documents: ['pmc-files'], near: 'Black Bishop' },
    { x: 59.77, z: 103.12, documents: ['pmc-files'], near: 'Mechanic' },
    { x: 82.04, z: -14.23, documents: ['pmc-files'], near: 'White Knight' },
    { x: 27.54, z: -93.2, documents: ['pmc-files'], near: 'K Buildings' },
    { x: 22.47, z: -24.32, documents: ['pmc-files'], near: 'Black Knight' },
    { x: 60.29, z: -114.4, documents: ['pmc-files'], near: 'K4' },
    { x: -115.92, z: 33.37, documents: ['project'], place: { ru: 'Командный бункер — офис командования (по гайдам: под столом или у принтера в соседнем кабинете)', en: 'Command bunker — the command office (per guides: under a desk or by the printer in the next room)' } },
    { x: -108.07, z: 17.8, documents: ['project'], place: { ru: 'Командный бункер — офис командования (по гайдам: под столом или у принтера в соседнем кабинете)', en: 'Command bunker — the command office (per guides: under a desk or by the printer in the next room)' } },
  ],
  shoreline: [
    { x: -319.05, z: 485.49, documents: ['technical'], place: { ru: 'Причал — стойка в здании на пирсе', en: 'Pier — the counter of the building on the pier' } },
    { x: -180.99, z: -75.35, documents: ['technical'], near: 'West Wing' },
    { x: -241.37, z: 204, documents: ['technical'], place: { ru: 'Электростанция', en: 'Power station' } },
    { x: -627.65, z: -231.7, documents: ['technical'], near: 'Military Camp (Scav Farm)' },
    { x: 93.95, z: 117.39, documents: ['technical'], near: 'Cottages' },
    { x: -317.95, z: 497.52, documents: ['test-docs'], place: { ru: 'Причал — кушетки перед зданием', en: 'Pier — the emergency beds in front of the building' } },
    { x: -614.52, z: -180.87, documents: ['test-docs'], near: 'Scav Farm' },
    { x: -511.58, z: 237.69, documents: ['test-docs'], place: { ru: 'Метеостанция — 2-й этаж здания', en: 'Weather station — 2nd floor of the building' } },
    { x: -349.01, z: -89.68, documents: ['test-docs'], place: { ru: 'Санаторий, восточное крыло (по гайдам — комната 326, в ящике)', en: 'Health Resort east wing (per guides — room 326, in a drawer)' } },
  ],
  woods: [
    { x: -248.69, z: -22.3, documents: ['technical'], place: { ru: 'Место крушения самолёта — в кабине', en: 'Plane crash site — inside the cockpit' } },
    { x: 295.38, z: -507.65, documents: ['technical'], place: { ru: 'Лагерь USEC — у спутниковой тарелки', en: 'USEC camp — by the satellite dish' } },
    { x: 226.51, z: -712.59, documents: ['technical'], place: { ru: 'Бункер Диких на севере — на синей бочке', en: 'Northern Scav bunker — on a blue barrel' } },
    { x: -43.15, z: -251.39, documents: ['technical'] },
    { x: 141, z: -725.68, documents: ['technical'], near: 'Bridge Overlook' },
    { x: -276.57, z: -422.52, documents: ['technical'], near: 'Marked Circle Bunker' },
    { x: -2.19, z: -75.08, documents: ['technical'], near: 'Cabins' },
    { x: -475.71, z: -178.76, documents: ['technical'], place: { ru: 'Старая лесопилка — сарай у дома с антенной', en: 'Old sawmill — the shack next to the house with the antenna' } },
    { x: 370.15, z: 123.54, documents: ['technical'], place: { ru: 'Сгоревший внедорожник на дороге', en: 'The burnt-out SUV on the road' } },
    { x: -544.33, z: -200.85, documents: ['test-docs'], place: { ru: 'Старая лесопилка — двухэтажный сарай, на столе', en: 'Old sawmill — the two-floor shack, on a table' } },
    { x: -455.92, z: -366.3, documents: ['test-docs'], near: 'Scav Town' },
    { x: 239.01, z: -70.45, documents: ['test-docs'], place: { ru: 'КПП USEC — на тумбе', en: 'USEC checkpoint — on top of the drawers' } },
    { x: -513.47, z: -394.72, documents: ['test-docs'], near: 'Scav Town' },
    { x: 309.77, z: -460.9, documents: ['test-docs'], near: 'USEC Camp' },
    { x: 272.98, z: -510.36, documents: ['test-docs'], near: 'USEC Camp' },
    { x: -513.4, z: -177.57, documents: ['test-docs'], place: { ru: 'Старая лесопилка — двухэтажный сарай, на столе', en: 'Old sawmill — the two-floor shack, on a table' } },
    { x: 285.15, z: -517.1, documents: ['test-docs'], near: 'USEC Camp' },
    { x: 272.54, z: -439.2, documents: ['test-docs'], near: 'USEC Camp' },
    { x: -200.66, z: 230.49, documents: ['test-docs'], near: 'Military Camp' },
  ],
}
