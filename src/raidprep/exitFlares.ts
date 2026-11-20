import type { MapMarker, Quest } from '../domain/types'
import { extractGuideOf } from '../data/extractGuide'

/**
 * The flare an exit needs, in «Требования рейда» (owner, 19.11.2026: «если на карте есть выход, для которого нужен сигнальный
 * патрон… в требованиях рейда отображался… Реактивный сигнальный патрон (зелёный), и было написано, что он нужен для выхода»).
 * Every exit opened by a flare takes a green one: RSP-30 or 26x75, either will do.
 */
export const GREEN_FLARE_IDS: readonly string[] = ['6217726288ed9f0845317459', '62389aaba63f32501b1b444f']

/** ZiD SP-81 26x75: the pistol the 26x75 flares are fired from. */
export const SIGNAL_PISTOL_ID = '620109578d82e67e7911abf2'

/** Its name and picture when the loaded catalog has not got it (demo data). */
const SIGNAL_PISTOL_FALLBACK = {
  ru: 'Сигнальный пистолет ЗиД СП-81 26x75',
  en: 'ZiD SP-81 26x75 signal pistol',
  iconUrl: `https://assets.tarkov.dev/${SIGNAL_PISTOL_ID}-icon.webp`,
}

/** tarkov.dev names an exit opened by a flare «… (Сигнал)»; the Icebreaker's helicopter is called by one too (our exit guide). */
const FLARE_EXIT_NAME = /\((?:Сигнал|Flare)\)/i
const FLARE_EXIT_GUIDE = /зелён\S* ракет|РСП-30/i

/** The exits of this map a PMC opens with a flare, one each (the Scavs' twin of an exit is not another exit). */
export function flareExitsOn(markers: readonly MapMarker[], mapId: string): MapMarker[] {
  const seen = new Set<string>()
  return markers.filter((marker) => {
    if (marker.mapId !== mapId || marker.type !== 'extract' || marker.layerId === 'transit' || marker.extractFaction === 'scav') return false
    if (!FLARE_EXIT_NAME.test(marker.title) && !FLARE_EXIT_GUIDE.test(extractGuideOf(marker.id)?.ru ?? '')) return false
    const key = marker.extractId ?? marker.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A line of «Требования рейда» of a quest, as the Overview has them (this map, this mode's progress, quests put aside left out). */
export interface QuestRaidLine {
  purpose: string
  objectiveId?: string
  quest: Pick<Quest, 'objectiveDetails'>
}

/**
 * The flare exits a quest line is the flare of: its objective is to leave through that exit («Прекратить огонь!»). An extract
 * objective that names no exit zone stands for every flare exit of the map.
 */
export function exitsFiredBy(line: QuestRaidLine, exits: readonly MapMarker[]): MapMarker[] {
  if (line.purpose !== 'signal' || !line.objectiveId) return []
  const objective = line.quest.objectiveDetails?.find((entry) => entry.id === line.objectiveId || entry.legacyId === line.objectiveId)
  if (objective?.type !== 'extract') return []
  const zones = (objective.zones ?? []).map((zone) => zone.id).filter(Boolean)
  return exits.filter((exit) => !zones.length || zones.some((id) => id === exit.id || id === `extract-${exit.extractId}`))
}

/** The exits whose flare a quest of the list already asks for. */
function exitsFiredByQuests(lines: readonly QuestRaidLine[], exits: readonly MapMarker[]) {
  return new Set(lines.flatMap((line) => exitsFiredBy(line, exits).map((exit) => exit.id)))
}

/**
 * The flare exits of this map that want a line of their own in «Требования рейда»: all of them, but the one whose flare a current
 * quest already asks for (owner, 19.11.2026: «если у вас активен квест «Прекратить огонь»… отдельно для выхода не нужно…
 * если квест выполнен или ещё не доступен — всегда показывать патрон, нужный для выхода»). A flare a quest fires elsewhere does not
 * open the exit, so the exit keeps its own line next to it.
 */
export function exitFlareNeeds(markers: readonly MapMarker[], mapId: string, questLines: readonly QuestRaidLine[]): MapMarker[] {
  const exits = flareExitsOn(markers, mapId)
  const fired = exitsFiredByQuests(questLines, exits)
  return exits.filter((exit) => !fired.has(exit.id))
}

/** Catalog fields the flare card reads. */
export interface FlareItem {
  id: string
  name: string
  iconUrl?: string
  caliber?: string
  types?: string[]
}

const FLARE_NAME = /сигнальн\S* (?:патрон|ракет)|осветительн\S* патрон|flare cartridge|signal cartridge|signal flare|(?:РСП|РОП|RSP|ROP)-30/i
/** RSP-30 and ROP-30: fired from the hand, no pistol (tarkov.dev gives them a «gun» of their own). */
const HAND_FLARE = /(?:РСП|РОП|RSP|ROP)-30/i

/** A flare of any colour: 26x75 or RSP-30 / ROP-30 (not the pistol itself). */
export function isFlare(item: FlareItem) {
  if (item.id === SIGNAL_PISTOL_ID) return false
  return /26x75/i.test(item.caliber ?? '') || FLARE_NAME.test(item.name)
}

export function isHandFlare(item: FlareItem) {
  return isFlare(item) && (HAND_FLARE.test(item.name) || Boolean(item.types?.includes('gun')))
}

export interface FlareCard {
  /** «26x75». */
  caliber: string
  pistol: { id: string; name: string; iconUrl?: string }
  /** The 26x75 flares of the row, fired from the pistol. */
  cartridges: Array<{ id: string; name: string; iconUrl?: string }>
  /** The RSP-30 of the row, fired without one. */
  handFlares: Array<{ id: string; name: string; iconUrl?: string }>
}

/**
 * The hover card of a flare (owner, 19.11.2026: «показывать сигнальный пистолет с патроном и его калибр… из какого пистолета он
 * стреляет»): the pistol, the 26x75 cartridges it fires, and the RSP-30 that need none. Undefined when no item of the row is a flare.
 */
export function flareCardOf(items: readonly FlareItem[], pistol: FlareItem | undefined, locale: 'ru' | 'en'): FlareCard | undefined {
  const flares = items.filter(isFlare)
  if (!flares.length) return undefined
  const card = (item: FlareItem) => ({ id: item.id, name: item.name, iconUrl: item.iconUrl })
  return {
    caliber: (pistol?.caliber ?? '').replace(/^Caliber/i, '') || '26x75',
    pistol: pistol ? card(pistol) : { id: SIGNAL_PISTOL_ID, name: SIGNAL_PISTOL_FALLBACK[locale], iconUrl: SIGNAL_PISTOL_FALLBACK.iconUrl },
    cartridges: flares.filter((item) => !isHandFlare(item)).map(card),
    handFlares: flares.filter(isHandFlare).map(card),
  }
}
