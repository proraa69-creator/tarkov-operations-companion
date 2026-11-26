import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { exitNameKey, resetGameNamesForTests, setGameNames, setWantedGameLanguage } from '../data/gameNames'
import { exitNames } from '../data/exitShortNames'
import { joinCjkWords } from '../shared/cjk'
import type { ExtraGameLanguage } from './gameLanguage'
import { anyGameWord } from './gameWordPatterns'
import { GAME_WORDS } from './gameWords'
import { matchQuestsFromOcr } from './questOcr'
import { isTasksMenuText, tableMatches } from './screenScanSync'
import { tasksScreenKind } from './storyScan'
import { isTraderScreenText, parseTraderNickname, traderScreenParts } from './modeSelectScreen'
import { traderBadgeRects } from './traderLoyalty'
import { fleaFilterAllows, isTraderRow } from './fleaScreen'
import { exitHighlights, parseExtractList } from '../maps/raidExtracts'
import { createTooltipMatcher } from '../overlay/tooltipMatch'
import { screenEntries, screenScore } from '../kappa/collector'
import type { OcrWordBox } from './storyPaneLayout'
import { GAME_LANGUAGE_SCREENS, SCREEN_NAMES, type LanguageScreens } from './__fixtures__/gameLanguageScreens'

/**
 * Every screen reader on the real Tesseract output of the players' screenshots of the game in German, Japanese, Chinese,
 * Polish, Spanish, Brazilian Portuguese, French, Korean and Turkish (SPT 4.1.6, 1920×1080:
 * src/import/__fixtures__/gameLanguageScreens.ts). What each reads there now, never less — and never a quest, an exit or
 * an item that is not on the screen.
 */
const LANGUAGES = ['de', 'ja', 'zh', 'pl', 'es', 'pt', 'fr', 'ko', 'tr'] as const
type Language = (typeof LANGUAGES)[number]
const screens = (language: Language): LanguageScreens => GAME_LANGUAGE_SCREENS[language]!
const SIZE = { width: 1920, height: 1080 }

const quest = (id: string, name: string, nameEn: string): Quest => ({ id, name, nameRu: name, nameEn, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] })
const QUESTS: Quest[] = Object.entries(SCREEN_NAMES.quests).map(([id, names]) => quest(id, names.ru, names.en))
const item = (id: string, name: string, shortName: string) => ({ id, name, shortName, category: 'Бартер', description: '', prices: [] }) as unknown as Item
const ITEMS: Item[] = Object.entries(SCREEN_NAMES.items).map(([id, names]) => item(id, names.ru, names.ruShort))

/** The quests the Tasks screenshots show (all handed in), by language: «Ballet Lover» in Portuguese, «House Arrest - Part 2» elsewhere. */
const DEBTOR = '639dbaf17c898a131e1cffff', GLORY_1 = '639135b04ed9512be67647d7', BROADCAST_2 = '63913715f8e5dd32bf4e3aaa', BROADCAST_3 = '63a511ea30d85e10e375b045'
const GREEN_CORRIDOR = '639136d68ba6894d155e77cf', ROAD_CLOSED = '639282134ed9512be67647ed', ZHIVCHIK = '5d25bfd086f77442734d3007', HOUSE_ARREST_2 = '639135cd8ba6894d155e77cb', BALLET_LOVER = '639135a7e705511c8a4a1b78'
const ON_SCREEN = (language: Language) => [DEBTOR, GLORY_1, BROADCAST_2, BROADCAST_3, GREEN_CORRIDOR, ROAD_CLOSED, ZHIVCHIK, language === 'pt' ? BALLET_LOVER : HOUSE_ARREST_2]

const DSP = '62e910aaf957f2915e0a5e36', MS2000 = '5991b51486f77447b112d44f', CABLE = '5d0375ff86f774186372f685', RSP_YELLOW = '624c0b3340357b5f566e8766'
const FIREKLEAN = '5bc9b355d4351e6d1509862a', GPHONE = '5bc9b720d4351e450201234b', BEARD_OIL = '5bc9b9ecd4351e3bac122519', FIRESTEEL = '5bc9c377d4351e3bac12251b'

function installNames(language: Language) {
  setWantedGameLanguage(language)
  const own = screens(language).names
  setGameNames({
    language: language as ExtraGameLanguage,
    quests: new Map(Object.entries(own.quests).filter(([, title]) => Boolean(title))),
    items: new Map(Object.entries(own.items).filter(([, names]) => Boolean(names.name))),
    exits: new Map(Object.entries(SCREEN_NAMES.exits).flatMap(([key, names]) => (own.exits[key] ? [[exitNameKey(names.ru), own.exits[key]!], [exitNameKey(names.en), own.exits[key]!]] : [])) as Array<[string, string]>),
  })
}

const wordsOf = (blocks: LanguageScreens['traders']['blocks']): OcrWordBox[] => blocks.flatMap((lines) => lines.flatMap((line) => joinCjkWords(line)))
/** The screenshots' rows are handed in (no status: nothing to add); the same rows being done: the done word → the active one. */
function asActive(language: Language, text: string) {
  const done = new RegExp(anyGameWord(GAME_WORDS[language].status.done), 'giu')
  return text.split('\n').map((line) => line.replace(done, GAME_WORDS[language].status.active[0]!)).join('\n')
}

/** What every reader makes of a language's screenshots. */
function readAll(language: Language) {
  installNames(language)
  const shots = screens(language)
  const tasks = shots.tasks.text
  const active = asActive(language, tasks)
  const traders = wordsOf(shots.traders.blocks), collector = wordsOf(shots.collector.blocks)
  const lit = (text: string, map: 'customs' | 'woods') => [...(exitHighlights({ names: parseExtractList(text, language), at: 10, text, language }, 0, EXIT_LIST(map), 20)?.lit ?? [])].sort()
  const variants = new Map(ITEMS.map((entry) => {
    const english = SCREEN_NAMES.items[entry.id as keyof typeof SCREEN_NAMES.items]
    return [entry.id, [shots.names.items[entry.id]!, { name: english.en, shortName: english.enShort }]]
  }))
  const matcher = createTooltipMatcher(ITEMS, variants)
  // The stash's labels looked for among the cards' items, the Collector's tab's among his.
  const wanted = (ids: string[]) => screenEntries(new Map(ids.map((id) => [id, 1])), ITEMS)
  const seen = (ids: string[], lines: string[]) => wanted(ids).filter((entry) => screenScore(entry, lines.join('\n')) >= 0.78).map((entry) => entry.item.id).sort()
  return {
    tasks: {
      menu: isTasksMenuText(tasks, language),
      kind: tasksScreenKind(tasks, null, language),
      handedIn: tableMatches(tasks, matchQuestsFromOcr(tasks, QUESTS, { language })).length,
      active: tableMatches(active, matchQuestsFromOcr(active, QUESTS, { language })).map((match) => match.questId).sort(),
    },
    traders: {
      screen: isTraderScreenText(shots.traders.text, language),
      nickname: traderScreenParts(traders, SIZE, language).nickname?.value ?? null,
      badges: traderBadgeRects(traders, SIZE, language).length,
    },
    collector: {
      nickname: traderScreenParts(collector, SIZE, language).nickname?.value ?? null,
      level: traderScreenParts(collector, SIZE, language).level?.value ?? null,
    },
    exits: { customs: lit(shots.exits.customs, 'customs'), woods: lit(shots.exits.woods, 'woods') },
    tooltips: shots.tooltips.map((cards) => cards.map((lines) => lines.map((line) => matcher(line.replace(/\s+/g, ' ').trim())?.id).find(Boolean) ?? null).find(Boolean) ?? null),
    flea: {
      chips: shots.flea.chips.map((chip) => fleaFilterAllows(chip, language)),
      traders: shots.flea.rows.filter((row) => isTraderRow(row.seller, row.info, language)).length,
      items: [...new Set(shots.flea.rows.map((row) => (row.name ? matcher(row.name.replace(/\s+/g, ' ').trim())?.id : undefined)).filter(Boolean))],
    },
    labels: { stash: seen([DSP, MS2000, CABLE, RSP_YELLOW], shots.labels.stash), collector: seen([FIREKLEAN, GPHONE, BEARD_OIL, FIRESTEEL], shots.labels.collector) },
  }
}

/** A map's exits (Customs' or Woods'), with their names in the game's language (installNames first). */
const CUSTOMS_EXIT = /^ex_customs_|^RUAF Roadblock$/
const EXIT_LIST = (map: 'customs' | 'woods') => Object.entries(SCREEN_NAMES.exits)
  .filter(([id]) => CUSTOMS_EXIT.test(id) === (map === 'customs'))
  .map(([id, names]) => ({ id, title: names.ru, titles: exitNames(names.ru) }))

beforeEach(() => resetGameNamesForTests())
afterEach(() => resetGameNamesForTests())

/**
 * What each language's screenshots give now (24.11.2026). The quests and exits read are each on the screen (checked against
 * the screenshots); a reading lost later fails here.
 */
const READ: Record<Language, {
  quests: string[]
  /** «Aktuelles Ansehen:» and «(Du)» both read (else the strip of portraits starts the reading: electron/screenOcr.ts). */
  traderWords: boolean
  /** «LVL 69» of the standing row read by the whole pass (the close-up confirms it or nothing). */
  level: boolean
  customs: string[]
  woods: string[]
  tooltips: Array<string | null>
  flea: { traders: number; items: string[] }
  stash: string[]
  collector: string[]
}> = {
  de: {
    quests: [DEBTOR, GLORY_1, BROADCAST_2, BROADCAST_3, GREEN_CORRIDOR, ROAD_CLOSED, HOUSE_ARREST_2], traderWords: true, level: true,
    customs: ['ex_customs_pmc_flare'], woods: ['Factory Gate', 'RUAF Gate', 'South V-Ex', 'UN Roadblock', 'un-sec', 'wood_sniper_exit'],
    tooltips: [DSP, MS2000, CABLE], flea: { traders: 0, items: [RSP_YELLOW] }, stash: [CABLE, DSP], collector: [FIREKLEAN, GPHONE, BEARD_OIL, FIRESTEEL],
  },
  ja: {
    quests: ON_SCREEN('ja'), traderWords: false, level: false,
    customs: ['ex_customs_pmc_auto', 'ex_customs_pmc_flare', 'ex_customs_pmc_gasstation', 'ex_customs_pmc_zb1011'], woods: ['Factory Gate', 'Outskirts', 'South V-Ex', 'ZB-014', 'wood_sniper_exit'],
    tooltips: [DSP, MS2000, CABLE], flea: { traders: 0, items: [RSP_YELLOW] }, stash: [CABLE, DSP, RSP_YELLOW], collector: [FIREKLEAN, GPHONE, BEARD_OIL, FIRESTEEL],
  },
  zh: {
    quests: [GLORY_1, BROADCAST_3, GREEN_CORRIDOR, ROAD_CLOSED, ZHIVCHIK, HOUSE_ARREST_2], traderWords: true, level: false,
    customs: [], woods: ['Factory Gate', 'RUAF Gate'],
    tooltips: [DSP, null, null], flea: { traders: 1, items: [] }, stash: [DSP], collector: [FIREKLEAN, GPHONE, BEARD_OIL],
  },
  pl: {
    quests: [DEBTOR, GLORY_1, BROADCAST_2, BROADCAST_3, GREEN_CORRIDOR, ROAD_CLOSED, HOUSE_ARREST_2], traderWords: true, level: true,
    customs: ['RUAF Roadblock', 'ex_customs_coop_boiler', 'ex_customs_pmc_auto', 'ex_customs_pmc_crossroads', 'ex_customs_pmc_flare', 'ex_customs_pmc_trailerpark'],
    woods: ['Factory Gate', 'RUAF Gate', 'South V-Ex', 'UN Roadblock', 'ZB-016', 'un-sec', 'wood_sniper_exit'],
    tooltips: [DSP, MS2000, CABLE], flea: { traders: 0, items: [RSP_YELLOW] }, stash: [CABLE, DSP], collector: [FIREKLEAN, GPHONE, BEARD_OIL, FIRESTEEL],
  },
  es: {
    quests: [DEBTOR, GLORY_1, BROADCAST_2, GREEN_CORRIDOR, HOUSE_ARREST_2], traderWords: false, level: true,
    customs: ['ex_customs_pmc_auto', 'ex_customs_pmc_flare', 'ex_customs_pmc_gasstation', 'ex_customs_pmc_zb1011', 'ex_customs_pmc_zb1013'], woods: ['Factory Gate', 'Outskirts', 'South V-Ex', 'wood_sniper_exit'],
    tooltips: [DSP, MS2000, CABLE], flea: { traders: 0, items: [RSP_YELLOW] }, stash: [CABLE, DSP], collector: [FIREKLEAN, GPHONE, FIRESTEEL],
  },
  pt: {
    quests: [GLORY_1, BROADCAST_2, BROADCAST_3, GREEN_CORRIDOR, ROAD_CLOSED, BALLET_LOVER], traderWords: false, level: true,
    customs: ['RUAF Roadblock', 'ex_customs_coop_boiler', 'ex_customs_pmc_auto', 'ex_customs_pmc_crossroads', 'ex_customs_pmc_flare', 'ex_customs_pmc_trailerpark', 'ex_customs_pmc_zb1013'],
    woods: ['Factory Gate', 'South V-Ex', 'UN Roadblock', 'un-sec', 'wood_sniper_exit'],
    tooltips: [DSP, MS2000, CABLE], flea: { traders: 0, items: [RSP_YELLOW] }, stash: [CABLE, DSP], collector: [FIREKLEAN, GPHONE, BEARD_OIL, FIRESTEEL],
  },
  fr: {
    quests: [DEBTOR, GLORY_1, BROADCAST_2, BROADCAST_3, GREEN_CORRIDOR, ROAD_CLOSED, ZHIVCHIK], traderWords: true, level: true,
    customs: ['ex_customs_pmc_auto', 'ex_customs_pmc_gasstation', 'ex_customs_pmc_zb1011'], woods: ['Factory Gate', 'RUAF Gate', 'South V-Ex', 'UN Roadblock', 'un-sec'],
    tooltips: [DSP, MS2000, CABLE], flea: { traders: 0, items: [RSP_YELLOW] }, stash: [DSP, RSP_YELLOW], collector: [FIREKLEAN, GPHONE],
  },
  ko: {
    quests: [GLORY_1, BROADCAST_2, BROADCAST_3, GREEN_CORRIDOR, ZHIVCHIK], traderWords: false, level: false,
    customs: ['ex_customs_pmc_auto', 'ex_customs_pmc_flare', 'ex_customs_pmc_gasstation'], woods: ['Factory Gate', 'RUAF Gate', 'South V-Ex', 'UN Roadblock', 'un-sec', 'wood_sniper_exit'],
    tooltips: [DSP, MS2000, CABLE], flea: { traders: 0, items: [RSP_YELLOW] }, stash: [DSP, RSP_YELLOW], collector: [FIREKLEAN],
  },
  tr: {
    quests: [GLORY_1, BROADCAST_2, GREEN_CORRIDOR, ROAD_CLOSED, HOUSE_ARREST_2], traderWords: true, level: false,
    customs: ['RUAF Roadblock', 'ex_customs_coop_boiler', 'ex_customs_pmc_auto', 'ex_customs_pmc_crossroads', 'ex_customs_pmc_flare', 'ex_customs_pmc_trailerpark'],
    woods: ['Factory Gate', 'RUAF Gate', 'South V-Ex', 'UN Roadblock', 'un-sec', 'wood_sniper_exit'],
    tooltips: [DSP, MS2000, CABLE], flea: { traders: 1, items: [] }, stash: [DSP], collector: [FIREKLEAN, GPHONE],
  },
}

describe.each(LANGUAGES)('the screenshots of a %s game', (language) => {
  const sorted = (ids: readonly string[]) => [...ids].sort()

  it('the Tasks table: the screen, its handed-in rows left alone, the same rows being done named', () => {
    const read = readAll(language).tasks
    expect(read.menu).toBe(true)
    expect(read.kind).toBe('table')
    // Handed in: no status to give, nothing added.
    expect(read.handedIn).toBe(0)
    // Every quest read is on the screen («Yayın- Bölüm53» is no «Bölüm 5»), and as many as now.
    for (const id of read.active) expect(ON_SCREEN(language), id).toContain(id)
    expect(read.active).toEqual(sorted(READ[language].quests))
  })

  it('the traders\' screen and the Collector\'s tab: the nickname, the portraits, the level', () => {
    const read = readAll(language)
    expect(read.traders.nickname).toBe('TESTPILOT')
    expect(read.collector.nickname).toBe('TESTPILOT')
    expect(read.traders.badges).toBeGreaterThanOrEqual(5)
    expect(read.traders.screen).toBe(READ[language].traderWords)
    // Never another number than the player's 69 («6.02» of the standing is no level 2).
    expect(read.collector.level).toBe(READ[language].level ? 69 : null)
  })

  it('the exit lists light the exits they name, each map\'s own', () => {
    const read = readAll(language).exits
    expect(read.customs).toEqual(sorted(READ[language].customs))
    expect(read.woods).toEqual(sorted(READ[language].woods))
  })

  it('the item cards, the flea, the labels', () => {
    const read = readAll(language)
    expect(read.tooltips).toEqual(READ[language].tooltips)
    // «Exclude barter offers» leaves the cheapest on top, «Only functional» does not.
    expect(read.flea.chips).toEqual([true, false])
    expect(read.flea.traders).toBe(READ[language].flea.traders)
    expect(read.flea.items).toEqual(READ[language].flea.items)
    expect(read.labels.stash).toEqual(sorted(READ[language].stash))
    expect(read.labels.collector).toEqual(sorted(READ[language].collector))
  })
})

describe('a part\'s number read with a digit more', () => {
  it('names no part: the Turkish «Yayın- Bölüm53» is no «Bölüm 5» (its 3 a «з» in the keys)', () => {
    installNames('tr')
    const frame = 'Tüccar Tür Görev Konum Durum İlerleme\n. Bi KR Yayın- Bölüm53 Tarkovun aktif! 0%\n. Ça KR Yayın - Bölüm 2 Tarkovun aktif! 0%\n'
    expect(tableMatches(frame, matchQuestsFromOcr(frame, QUESTS, { language: 'tr' })).map((match) => match.questId)).toEqual([BROADCAST_2])
  })
})

describe('the trader screen\'s nickname close up', () => {
  it('drops the «(you)» mark read wrong, still in its brackets', () => {
    expect(parseTraderNickname('TESTPILOT (vot)', 'pt')).toBe('TESTPILOT')
    expect(parseTraderNickname('TESTPILOT (vous', 'fr')).toBe('TESTPILOT')
    expect(parseTraderNickname('TESTPILOT(vot)', 'pt')).toBe('TESTPILOT')
    expect(parseTraderNickname('TESTPILOT (あなた〕', 'ja')).toBe('TESTPILOT')
    expect(parseTraderNickname('TESTPILOT (Lh)', 'ko')).toBe('TESTPILOT')
  })
})
