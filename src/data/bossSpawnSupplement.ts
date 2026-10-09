/**
 * Bosses that the owner's research list («Боссы по картам», 30.09.2026 — scratchpad research/bosses-by-map.md) puts
 * on a map, for the maps / modes where the live tarkov.dev feed has no spawn points for them yet (Black Division
 * patrols, Terminal's five bosses, Rogues in the Lighthouse chalets after 1.1.5.0, Goons, Partisan, cultists…).
 *
 * The live feed always wins: a boss is added from here only when tarkov.dev lists no usable point for it on that map in
 * the loaded mode, and never when tarkov.dev lists it with an explicit 0 % chance for that mode.
 * A boss is added only in the modes the research list gives it (a mode missing from `modes` = does not spawn there).
 *
 * Every marker is approximate: the research gives spawn AREAS, not points. Each area is anchored to a named place:
 *  - `liveZone`: a spawn zone of another boss on the same map in the live feed (Terminal: all bosses share the port zone);
 *  - `label`: a map label, resolved by its text in the loaded tarkov.dev map config (the-hideout/tarkov-dev maps.json
 *    `labels`), falling back to the stored position, which is that label's position copied from the same file
 *    (as of 30.09.2026) or, where marked `community`, from the community map szepiz/tarkov-quest-data
 *    (`api/maps.json` additions, CC0-1.0, 2026-08-16).
 * Areas come from the research list (Reshala, Sanitar, Glukhar zones; Rogues → chalets, Black Division on Terminal → port)
 * and, where it gives none, from guides found on 30.09.2026 (timesaver.gg Goons guide: Customs Stronghold, Woods Scav
 * bunker, Lighthouse water treatment, Shoreline weather station; cultist guides: Customs Stronghold, Woods abandoned
 * village, Shoreline resort and the road by the swamp village; Black Division: Shoreline resort, Streets near Concordia,
 * Ground Zero in front of the TerraGroup building; Partisan roams — one marker at a place guides name).
 * Bosses with no known area (Ground Zero cultists, Labyrinth, Icebreaker, Lab raiders) are left to the live feed.
 */
import type { GameMap, RaidMode } from '../domain/types'

export interface SupplementModeChance {
  /** Chance used for the tooltip's «шанс N%»; absent when the research could not find one for this mode. */
  chance?: number
  /** As written in the research list, e.g. «15–20%» or «шанс неизвестен». */
  text: string
}

export interface SupplementArea {
  /** Russian zone name (English in src/i18n/uiEnglishBossSupplement.ts). */
  zone: string
  /** Map label text in the tarkov.dev map config, resolved at runtime. */
  label: string
  x: number
  z: number
  /** The stored position is a community map label (not in tarkov.dev's maps.json). */
  community?: boolean
  /** Prefer the live spawn zone of any boss on this map whose name matches. */
  liveZone?: RegExp
}

export interface SupplementBoss {
  /** Group key as the map adapter uses it (mob normalizedName; 'goons' for Knight's trio). */
  key: string
  /** Key for boss info lookups (portrait, gear): the tarkov.dev normalizedName. */
  infoKey: string
  name: string
  /** Live boss group keys / names that are this boss (the live feed wins when any of them has points). */
  match: RegExp
  modes: Partial<Record<RaidMode, SupplementModeChance>>
  areas: SupplementArea[]
  escorts?: string[]
  /** Extra sentence for the tooltip (Russian, translated by the same phrase file). */
  note?: string
}

const pct = (chance: number, text = `${Math.round(chance * 100)}%`): SupplementModeChance => ({ chance, text })
const UNKNOWN: SupplementModeChance = { text: 'шанс неизвестен' }
const ROAMS = 'Бродит по карте, постоянной точки нет.'
const NIGHT = 'Только ночные рейды.'
const PARTISAN_KARMA = 'Базовый шанс 25% (обновление 09.10.2026); в PvP и Сезоне выше, если в рейде есть ЧВК с низкой кармой.'

const GOONS = { key: 'goons', infoKey: 'knight', name: 'Кочевники', match: /^(goons|knight)$|кочевник/i, escorts: ['Knight', 'Big Pipe', 'Birdeye'] }
const PARTISAN = { key: 'partisan', infoKey: 'partisan', name: 'Партизан', match: /^partisan$|партизан/i, note: `${ROAMS} ${PARTISAN_KARMA}` }
/**
 * Official technical update (EFT channel, 09.10.2026): base chance 25% on Lighthouse, Shoreline, Woods and Customs;
 * in PvP and Season the final chance grows with low-karma PMCs in the raid.
 */
const PARTISAN_CHANCE = { pvp: pct(0.25, 'от 25%'), pve: pct(0.25), seasonal: pct(0.25, 'от 25%') }
const CULTISTS = { key: 'cultist-priest', infoKey: 'cultist-priest', name: 'Жрец культа', match: /cultist|жрец|культ/i, escorts: ['Культисты ×3–4'], note: NIGHT }
const BLACK_DIVISION = { key: 'black-division', infoKey: 'black-division', name: 'Black Division', match: /black.?div/i, note: 'Патруль из 4 человек.' }
/** «15–20%» in PvP / Season (tarkovdex, timesaver, goon-tracker disagree). */
const GOONS_ROTATION = pct(0.15, '15–20%')

const terminalBoss = (key: string, name: string, match: RegExp, pvp: SupplementModeChance = pct(0.2)): SupplementBoss => ({
  key, infoKey: key, name, match, modes: { pvp, pve: pct(0.2), seasonal: pct(0.2) },
  areas: [{ zone: 'Порт', label: 'Seaport Terminal', x: 286.3, z: -238.5, community: true, liveZone: /port/i }],
  note: 'Один из пяти боссов Терминала за рейд.',
})

export const BOSS_SPAWN_SUPPLEMENT: Record<string, SupplementBoss[]> = {
  customs: [
    { key: 'reshala', infoKey: 'reshala', name: 'Решала', match: /^reshala$|решала/i, escorts: ['Охранник Решалы ×4'],
      modes: { pvp: pct(0.75, '60–75%'), pve: pct(1), seasonal: pct(0.45) },
      areas: [{ zone: 'Общаги', label: 'Dorms', x: 200, z: 150 }, { zone: 'Новая заправка', label: 'New Gas', x: 404, z: 31 }, { zone: 'Крепость', label: 'Fortress', x: 201, z: -127 }] },
    { ...GOONS, modes: { pvp: GOONS_ROTATION, pve: pct(0.3), seasonal: GOONS_ROTATION }, areas: [{ zone: 'Крепость', label: 'Fortress', x: 201, z: -127 }] },
    { ...PARTISAN, modes: PARTISAN_CHANCE, areas: [{ zone: 'Старая стройка', label: 'Old Construction', x: 75, z: -9 }] },
    { ...CULTISTS, modes: { pvp: UNKNOWN, pve: pct(0.25), seasonal: pct(0.1) }, areas: [{ zone: 'Крепость', label: 'Fortress', x: 201, z: -127 }] },
  ],
  woods: [
    { key: 'shturman', infoKey: 'shturman', name: 'Штурман', match: /^shturman$|штурман/i, escorts: ['Охранник Штурмана ×2'],
      modes: { pvp: pct(1), pve: pct(0.75), seasonal: pct(0.75) }, areas: [{ zone: 'Лесопилка', label: 'Sawmill', x: 10, z: -3 }] },
    { ...GOONS, modes: { pvp: GOONS_ROTATION, pve: pct(0.25), seasonal: GOONS_ROTATION }, areas: [{ zone: 'Бункер Диких', label: 'Scav Bunker', x: 226.2, z: -700.6, community: true }] },
    { ...PARTISAN, modes: PARTISAN_CHANCE, areas: [{ zone: 'Снайперская скала', label: 'Sniper Rock', x: 85, z: -147 }] },
    { ...CULTISTS, modes: { pvp: UNKNOWN, pve: pct(0.3), seasonal: pct(0.1) }, areas: [{ zone: 'Заброшенная деревня', label: 'Cultist Village', x: -80, z: -680 }] },
  ],
  shoreline: [
    { key: 'sanitar', infoKey: 'sanitar', name: 'Санитар', match: /^sanitar$|санитар/i, escorts: ['Охранник Санитара ×3'],
      modes: { pvp: { text: 'шанс неизвестен (в 1.0 было 60–75%)' }, pve: pct(0.75), seasonal: pct(0.45) },
      areas: [{ zone: 'Санаторий', label: 'Resort', x: -258.2, z: -71.2 }, { zone: 'Причал', label: 'Pier', x: -338.6, z: 525 }] },
    { ...GOONS, modes: { pvp: GOONS_ROTATION, pve: pct(0.3), seasonal: GOONS_ROTATION }, areas: [{ zone: 'Метеостанция', label: 'Weather Station', x: -496, z: 257 }] },
    { ...PARTISAN, modes: PARTISAN_CHANCE, areas: [{ zone: 'Электростанция', label: 'Power Station', x: -215.8, z: 178.4 }] },
    { ...CULTISTS, modes: { pvp: UNKNOWN, pve: pct(0.25), seasonal: pct(0.05) },
      areas: [{ zone: 'Санаторий', label: 'Resort', x: -258.2, z: -71.2 }, { zone: 'Болото', label: 'Swamp', x: 326, z: -118.5 }] },
    { ...BLACK_DIVISION, modes: { seasonal: pct(0.35) }, areas: [{ zone: 'Санаторий', label: 'Resort', x: -258.2, z: -71.2 }] },
  ],
  interchange: [
    { key: 'killa', infoKey: 'killa', name: 'Килла', match: /^killa$|^килла$/i,
      modes: { pvp: pct(0.75, '~75%'), pve: pct(0.75), seasonal: pct(0.45) }, areas: [{ zone: 'Центр ТЦ «УЛЬТРА»', label: 'Generic', x: -28, z: 0.5 }] },
  ],
  reserve: [
    { key: 'glukhar', infoKey: 'glukhar', name: 'Глухарь', match: /^glukhar$|глухарь/i, escorts: ['Охрана Глухаря ×6'],
      modes: { pvp: pct(0.5), pve: pct(0.75), seasonal: pct(0.2, '~20–30%') },
      areas: [
        { zone: 'К-здания', label: 'K Buildings', x: 28, z: -102 }, { zone: 'Белый конь', label: 'White Knight', x: 82.2, z: -30.2 },
        { zone: 'Казармы', label: 'Barracks', x: 167, z: -222 }, { zone: 'Склад-бункер', label: 'д - Warehouse Bunkers', x: 80, z: -167 },
      ] },
  ],
  lighthouse: [
    { key: 'zryachiy', infoKey: 'zryachiy', name: 'Зрячий', match: /^zryachiy$|зрячий/i,
      modes: { pvp: pct(1), pve: pct(1), seasonal: pct(1) }, areas: [{ zone: 'Остров Смотрителя', label: 'Lightkeeper Island', x: 382, z: 496 }] },
    { key: 'rogue', infoKey: 'rogue', name: 'Отступники', match: /^rogue$|отступник/i,
      modes: { pvp: UNKNOWN, pve: pct(0.4, '40% / 25% / 10%'), seasonal: pct(0.8) },
      areas: [{ zone: 'Шале', label: 'Grand Chalet', x: -133, z: 100 }, { zone: 'Курорт Pikes Peak (шале)', label: 'Pikes Peak Resort', x: -107, z: -53 }],
      note: 'С патча 1.1.5.0 база Отступников — шале, очистные без турелей.' },
    { ...GOONS, modes: { pvp: GOONS_ROTATION, pve: pct(0.3), seasonal: GOONS_ROTATION }, areas: [{ zone: 'Очистные', label: 'Water Treatment', x: -65, z: -600 }] },
    { ...PARTISAN, modes: PARTISAN_CHANCE, areas: [{ zone: 'Очистные', label: 'Water Treatment', x: -65, z: -600 }] },
  ],
  'streets-of-tarkov': [
    { key: 'kaban', infoKey: 'kaban', name: 'Кабан', match: /^kaban$|кабан/i, modes: { pvp: pct(0.75), pve: pct(0.75), seasonal: pct(0.45) },
      areas: [{ zone: 'Автосалон LEXOS', label: 'Lexos', x: 66, z: 305 }] },
    { key: 'kollontay', infoKey: 'kollontay', name: 'Коллонтай', match: /^kollontay$|коллонтай|колонтай/i, escorts: ['Охранник Коллонтая ×2'],
      modes: { pvp: pct(0.75, '60–75%'), pve: pct(0.75, '45–75%'), seasonal: pct(0.45) },
      areas: [{ zone: 'Академия МВД', label: 'MVD Academy', x: -253.1, z: 137.8, community: true }] },
    { ...BLACK_DIVISION, modes: { seasonal: pct(0.35) }, areas: [{ zone: 'Конкордия', label: 'Concordia', x: 140, z: 362 }] },
  ],
  'ground-zero': [
    { ...BLACK_DIVISION, modes: { seasonal: pct(0.35) }, areas: [{ zone: 'Перед зданием TerraGroup', label: 'TerraGroup', x: -50, z: 0 }], note: 'Только Эпицентр 21+.' },
  ],
  terminal: [
    terminalBoss('reshala', 'Решала', /^reshala$|решала/i),
    terminalBoss('sanitar', 'Санитар', /^sanitar$|санитар/i),
    terminalBoss('killa', 'Килла', /^killa$|^килла$/i),
    terminalBoss('glukhar', 'Глухарь', /^glukhar$|глухарь/i),
    terminalBoss('tagilla', 'Тагилла', /^tagilla$|^тагилла$/i, pct(0.2, '20% (или 100% — источники расходятся)')),
    { ...BLACK_DIVISION, modes: { pvp: pct(1), pve: pct(1), seasonal: pct(1) },
      areas: [{ zone: 'Порт', label: 'Seaport Terminal', x: 286.3, z: -238.5, community: true, liveZone: /port/i }],
      note: 'Засады у порта, ворот и ангаров.' },
  ],
}

const MODE_LABEL: Record<RaidMode, string> = { pvp: 'PvP', pve: 'PvE', seasonal: 'Сезон' }

/** «Шанс по данным сообщества (30.09.2026): PvP 15–20%, PvE 30%, Сезон 15–20%.» — every mode the boss spawns in. */
export function supplementChanceText(boss: SupplementBoss) {
  const parts = (['pvp', 'pve', 'seasonal'] as RaidMode[]).flatMap((mode) => (boss.modes[mode] ? [`${MODE_LABEL[mode]} ${boss.modes[mode]!.text}`] : []))
  return `Шанс по данным сообщества (30.09.2026): ${parts.join(', ')}.`
}

export interface LiveBossZone { zone: string; x: number; y?: number; z: number }

/** Where an area is drawn: a matching live zone of another boss, else the map label (live config, else stored). */
export function resolveSupplementArea(area: SupplementArea, map: Pick<GameMap, 'labels'>, liveZones: LiveBossZone[]): { x: number; y?: number; z: number } {
  const live = area.liveZone ? liveZones.find((zone) => area.liveZone!.test(zone.zone)) : undefined
  if (live) return live
  const wanted = area.label.trim().toLowerCase()
  const label = map.labels?.find((entry) => entry.text.trim().toLowerCase() === wanted)
  return label ? { x: label.x, z: label.z } : { x: area.x, z: area.z }
}

/** Bosses to add for this map and mode: listed for the mode, not in the live feed (by group key or name). */
export function supplementBossesFor(mapId: string, mode: RaidMode, live: { present: Array<{ key: string; name: string }>; zeroed: Array<{ key: string; name: string }> }) {
  const known = (boss: SupplementBoss, list: Array<{ key: string; name: string }>) => list.some((entry) => boss.match.test(entry.key) || boss.match.test(entry.name) || entry.key === boss.key)
  return (BOSS_SPAWN_SUPPLEMENT[mapId] ?? []).filter((boss) => boss.modes[mode] && !known(boss, live.present) && !known(boss, live.zeroed))
}
