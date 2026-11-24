import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { resetGameNamesForTests, setGameNames, setWantedGameLanguage, exitNameKey } from '../data/gameNames'
import { exitNames } from '../data/exitShortNames'
import { cjkBlocksText, joinCjkWords } from '../shared/cjk'
/** The languages of this file (the others: gameLanguageReadersMore.test.ts). */
type ExtraGameLanguage = 'de' | 'ja' | 'zh'
import { matchQuestsFromOcr, rowStatus } from './questOcr'
import { isTasksMenuText, tableMatches, tableRowCount } from './screenScanSync'
import { tasksScreenKind } from './storyScan'
import { findNameLevel, isModeSelectText, isTraderScreenText, modeSelectHeaders, parseTraderNickname, traderScreenParts } from './modeSelectScreen'
import { traderBadgeRects } from './traderLoyalty'
import { fleaFilterAllows, isTraderRow } from './fleaScreen'
import { exitHighlights, parseExtractList } from '../maps/raidExtracts'
import { createTooltipMatcher } from '../overlay/tooltipMatch'
import { screenEntries, screenScore } from '../kappa/collector'
import type { OcrWordBox } from './storyPaneLayout'
import { GAME_LANGUAGE_OCR } from './__fixtures__/gameLanguageOcr'

/**
 * The screen readers in a German, Japanese and Simplified Chinese game, on real Tesseract output of pictures drawn from the
 * game's own words (src/import/__fixtures__/gameLanguageOcr.ts, scripts/ocr/language-fixtures.mjs): the text as
 * electron/screenOcr.ts hands it over — a Japanese or Chinese reading rebuilt from its word boxes (src/shared/cjk.ts).
 */
const fixture = (name: string) => GAME_LANGUAGE_OCR[name]!
const blocksOf = (name: string) => [{ paragraphs: (fixture(name).blocks ?? []).map((lines) => ({ lines: lines.map((words) => ({ words })) })) }]
/** The text the app reads: Japanese and Chinese from the word boxes, German as the OCR gave it. */
const text = (name: string) => (/^(ja|zh)-/.test(name) ? cjkBlocksText(blocksOf(name))! : fixture(name).text)
/** The word boxes as electron/screenOcr.ts takes them (storyPaneLayout.ocrWordBoxes: runs of characters one word). */
const words = (name: string): OcrWordBox[] => (fixture(name).blocks ?? []).flatMap((lines) => lines.flatMap((line) => joinCjkWords(line)))

const quest = (id: string, name: string, nameEn: string, mapId?: string): Quest => ({ id, name, nameRu: name, nameEn, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...(mapId ? { mapId } : {}) })
/** Trader quests of the pictures (tarkov.dev ids), with their Russian and English titles as the catalog has them. */
const QUESTS: Quest[] = [
  quest('5936d90786f7742b1420ba5b', 'Проба пера', 'Debut', 'customs'),
  quest('5a68663e86f774501078f78a', 'Врачебная тайна. Часть 2', 'Health Care Privacy - Part 2'),
  quest('5a68665c86f774255929b4c7', 'Врачебная тайна. Часть 3', 'Health Care Privacy - Part 3'),
  quest('5967725e86f774601a446662', 'Тряхнуть кассира', 'Shaking Up the Teller', 'interchange'),
  quest('5969f9e986f7741dde183a50', 'Провизор', 'Pharmacist'),
  quest('5936da9e86f7742d65037edf', 'Проверка на вшивость', 'Background Check', 'customs'),
  quest('5967733e86f774602332fc84', 'Дефицит', 'Shortage'),
]
/** Their titles in the game's language (tarkov.dev's tasks_{de,ja,zh}). */
const TITLES: Record<ExtraGameLanguage, string[]> = {
  de: ['Debüt', 'Geheimhaltung im Gesundheitswesen – Teil 2', 'Geheimhaltung im Gesundheitswesen – Teil 3', 'Kassensturz', 'Apotheker', 'Hintergrundprüfung', 'Engpass'],
  ja: ['Debut', 'Health Care Privacy - Part 2', 'Health Care Privacy - Part 3', 'Shaking Up the Teller', 'Pharmacist', 'Background Check', 'Shortage'],
  zh: ['首秀', '医疗隐私 - 2', '医疗隐私 - 3', '探囊取物', '药剂师', '背景调查', '短缺'],
}

const item = (id: string, name: string, shortName: string) => ({ id, name, shortName, category: 'Бартер', description: '', prices: [] }) as unknown as Item
/** Items of the pictures, with their Russian names (the catalog) and their names in each game language (tarkov.dev). */
const ITEMS: Item[] = [
  item('57347ca924597744596b4e71', 'Видеокарта', 'GPU'),
  item('544fb45d4bdc2dee738b4568', 'Аптечка Salewa First Aid Kit', 'Salewa'),
  item('5d02797c86f774203f38e30a', 'Полевой хирургический набор Surv12', 'Surv12'),
  item('5734758f24597738025ee253', 'Золотая цепочка', 'Зол. цепь'),
  item('5c94bbff86f7747ee735c08f', 'Ключ-карта доступа в TerraGroup Labs', 'Доступ'),
]
const ITEM_NAMES: Record<ExtraGameLanguage, Array<[string, string]>> = {
  de: [['Grafikkarte', 'GPU'], ['Salewa Erste-Hilfe-Set', 'Salewa'], ['Surv12 Feldchirurgie-Ausrüstung', 'Surv12'], ['Goldene Halskette', 'Goldkette'], ['TerraGroup Labs Zugangskarte', 'Zugangsk.']],
  ja: [['グラフィックボード', 'GPU'], ['Salewa ファーストエイドキット', 'Salewa'], ['サーヴ12 フィールド サージカルキット', 'Surv12'], ['金のチェーンネックレス', 'GoldChain'], ['TerraGroup Labs アクセスキーカード', 'Access']],
  zh: [['显示卡', '显卡'], ['Salewa急救包', 'Salewa'], ['Surv12野战手术包', 'Surv12'], ['金项链', '金链'], ['TerraGroup实验室访问钥匙卡', '钥匙卡']],
}
/** Customs' exits: the catalog's Russian names and each game language's (tarkov.dev maps_{en,ru,de,ja,zh}). */
const EXITS: Array<{ id: string; ru: string; en: string; de: string; ja: string; zh: string }> = [
  { id: 'gas', ru: 'Старая заправка', en: 'Old Gas Station', de: 'Alte Tankstelle', ja: 'Old Gas Station', zh: '老加油站' },
  { id: 'trailer', ru: 'Трейлерный парк', en: 'Trailer Park', de: 'Wohnwagenpark', ja: 'Trailer Park', zh: '拖车停车场' },
  { id: 'zb1011', ru: 'ЗБ-1011', en: 'ZB-1011', de: 'ZB-1011', ja: 'ZB-1011', zh: 'ZB-1011' },
  { id: 'warehouse', ru: 'Склад 4', en: 'Warehouse 4', de: 'Lagerhaus Nr. 4', ja: 'Warehouse 4', zh: '4号仓库' },
  { id: 'crossroads', ru: 'Перекресток', en: 'Crossroads', de: 'Kreuzung', ja: 'Crossroads', zh: '十字路口' },
  { id: 'rocks', ru: 'Проход между скалами', en: 'Passage Between Rocks', de: 'Durchgang zwischen den Felsen', ja: 'Passage Between Rocks', zh: '石间小道' },
]

/** The game's names of one language, as src/data/gameNamesLoader.ts installs them. */
function installNames(language: ExtraGameLanguage) {
  setWantedGameLanguage(language)
  setGameNames({
    language,
    quests: new Map(QUESTS.map((entry, index) => [entry.id, TITLES[language][index]!])),
    items: new Map(ITEMS.map((entry, index) => [entry.id, { name: ITEM_NAMES[language][index]![0], shortName: ITEM_NAMES[language][index]![1] }])),
    exits: new Map(EXITS.flatMap((exit) => [[exitNameKey(exit.ru), exit[language]], [exitNameKey(exit.en), exit[language]]] as Array<[string, string]>)),
  })
}

beforeEach(() => resetGameNamesForTests())
afterEach(() => resetGameNamesForTests())

describe('the Tasks table', () => {
  it('German: the screen, its rows, their titles and statuses', () => {
    installNames('de')
    const frame = text('de-tasks')
    expect(isTasksMenuText(frame, 'de')).toBe(true)
    expect(tableRowCount(frame, 'de')).toBe(4)
    expect(tasksScreenKind(frame, null, 'de')).toBe('table')
    const matches = tableMatches(frame, matchQuestsFromOcr(frame, QUESTS, { language: 'de' }))
    expect(Object.fromEntries(matches.map((match) => [match.questId, match.status]))).toEqual({
      '5936d90786f7742b1420ba5b': 'active', // Debüt
      '5a68663e86f774501078f78a': 'ready', // … – Teil 2, never Teil 3
      '5967725e86f774601a446662': 'active', // Kassensturz
      '5969f9e986f7741dde183a50': 'locked', // Apotheker
    })
  })

  it('Japanese: the English titles, the Japanese statuses and columns', () => {
    installNames('ja')
    const frame = text('ja-tasks')
    expect(isTasksMenuText(frame, 'ja')).toBe(true)
    expect(tableRowCount(frame, 'ja')).toBe(4)
    const matches = tableMatches(frame, matchQuestsFromOcr(frame, QUESTS, { language: 'ja' }))
    expect(Object.fromEntries(matches.map((match) => [match.questId, match.status]))).toEqual({
      '5936d90786f7742b1420ba5b': 'active',
      '5a68663e86f774501078f78a': 'ready',
      '5967725e86f774601a446662': 'active',
      '5969f9e986f7741dde183a50': 'locked',
    })
  })

  it('Chinese: the Chinese titles, part numbers after the name, the statuses', () => {
    installNames('zh')
    const frame = text('zh-tasks')
    expect(isTasksMenuText(frame, 'zh')).toBe(true)
    expect(tableRowCount(frame, 'zh')).toBe(4)
    const matches = tableMatches(frame, matchQuestsFromOcr(frame, QUESTS, { language: 'zh' }))
    // «探囊取物» came out of this picture as Latin junk («REY»): its row names nothing, rather than a guess.
    expect(Object.fromEntries(matches.map((match) => [match.questId, match.status]))).toEqual({
      '5936d90786f7742b1420ba5b': 'active', // 首秀
      '5a68663e86f774501078f78a': 'ready', // 医疗隐私 - 2, never - 3
      '5969f9e986f7741dde183a50': 'locked', // 药剂师
    })
  })

  it('a Chinese title read whole is found, and a part number decides between the parts', () => {
    installNames('zh')
    const frame = '探囊取物 立交桥 进行中！ 50%\n医疗隐私 - 3 任意地点 已完成！ 100%'
    const matches = matchQuestsFromOcr(frame, QUESTS, { language: 'zh' })
    expect(matches.map((match) => [match.questId, match.status]).sort()).toEqual([
      ['5967725e86f774601a446662', 'active'],
      ['5a68665c86f774255929b4c7', 'ready'],
    ])
  })

  it('a Russian or English game reads as before: the other languages\' words count for nothing there', () => {
    const frame = text('de-tasks')
    expect(rowStatus('Prapor Debüt Customs Aktiv 0%')).toBeUndefined()
    expect(rowStatus('Prapor Debüt Customs Aktiv 0%', 'de')).toBe('active')
    expect(tableRowCount(frame)).toBe(0)
    expect(isTasksMenuText(text('zh-tasks'))).toBe(false)
  })
})

describe('the traders\' screen', () => {
  it('German: the standing\'s level, the nickname marked «(Du)», the portraits («Jäger» read «Jager»)', () => {
    expect(isTraderScreenText(text('de-traders'), 'de')).toBe(true)
    expect(isTraderScreenText(text('de-traders'))).toBe(false)
    const parts = traderScreenParts(words('de-traders'), fixture('de-traders').size, 'de')
    expect(parts.level?.value).toBe(12)
    expect(parts.nickname?.value).toBe('Raid_OS')
    expect(parseTraderNickname('Raid_OS (Du)', 'de')).toBe('Raid_OS')
    expect(traderBadgeRects(words('de-traders'), fixture('de-traders').size, 'de').map((badge) => badge.key))
      .toEqual(['prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic', 'ragman', 'jaeger'])
  })

  it('Japanese and Chinese: the standing row, the portraits; «(あなた)» / «(你)» even with a character misread', () => {
    for (const language of ['ja', 'zh'] as const) {
      const name = `${language}-traders`
      expect(isTraderScreenText(text(name), language), language).toBe(true)
      expect(traderScreenParts(words(name), fixture(name).size, language).level?.value, language).toBe(12)
      expect(traderBadgeRects(words(name), fixture(name).size, language), language).toHaveLength(8)
    }
    expect(parseTraderNickname('Raid_OS (あなた)', 'ja')).toBe('Raid_OS')
    expect(parseTraderNickname('Raid_OS （你）', 'zh')).toBe('Raid_OS')
  })
})

describe('the mode selection', () => {
  it('the German and Chinese cards («PVE-ZONE», «PVE区域») and the name and level under them', () => {
    for (const language of ['de', 'zh'] as const) {
      const name = `${language}-modes`
      expect(isModeSelectText(text(name), language), language).toBe(true)
      // Without the game's language: as before, neither («PVE-ZONE» was never the English «PvE Zone»).
      expect(isModeSelectText(text(name)), language).toBe(false)
      const headers = modeSelectHeaders(words(name), fixture(name).size, language)
      expect(headers.map((header) => header.mode), language).toEqual(['pve', 'pvp'])
    }
    // Each card's line is read close up on its own (electron/screenOcr.ts readModeSelect): the first card's here.
    const cards = text('de-modes').split('\n').find((line) => line.includes('|'))!.split(/(?<=\|\s*\d{1,2})\s+/)
    expect(cards.map(findNameLevel)).toEqual([{ nickname: 'Raid_OS', level: 41 }, { nickname: 'Raid_OS', level: 39 }])
  })
})

describe('the exit list', () => {
  const titles = (exit: (typeof EXITS)[number]) => ({ id: exit.id, title: exit.ru, titles: exitNames(exit.ru) })

  it('German: the names after «EXFIL», the header and the transit left out; the map\'s exits lit by them', () => {
    installNames('de')
    // «4» after «Nr.» goes as scenery, as in the Russian list («Склад 4»): the matching still finds the exit.
    expect(parseExtractList(text('de-exits'), 'de')).toEqual(['Alte Tankstelle', 'Wohnwagenpark', 'ZB-1011', 'Lagerhaus Nr.'])
    const states = exitHighlights({ names: parseExtractList(text('de-exits'), 'de'), at: 10, text: text('de-exits'), language: 'de' }, 0, EXITS.map(titles), 20)
    expect([...states!.lit].sort()).toEqual(['gas', 'trailer', 'warehouse', 'zb1011'])
    expect([...states!.dim].sort()).toEqual(['crossroads', 'rocks'])
  })

  it('Japanese and Chinese: «脱出地点01» / «撤离点01» before the names, the transit «移動地点» / «转移点» left out', () => {
    installNames('ja')
    expect(parseExtractList(text('ja-exits'), 'ja')).toEqual(['Old Gas Station', 'Trailer Park', 'ZB-1011'])
    installNames('zh')
    const names = parseExtractList(text('zh-exits'), 'zh')
    // The OCR's space between the digit and the characters stays in the name; the matching does without it.
    expect(names).toEqual(['老加油站', '拖车停车场', '4 号仓库'])
    const states = exitHighlights({ names, at: 10, text: text('zh-exits'), language: 'zh' }, 0, EXITS.map(titles), 20)
    expect([...states!.lit].sort()).toEqual(['gas', 'trailer', 'warehouse'])
  })
})

describe('the item card and the stash labels', () => {
  it('the tooltip\'s name in the game\'s language names the item', () => {
    const cases: Array<[ExtraGameLanguage, string, string]> = [
      ['de', 'de-tooltip-gpu', '57347ca924597744596b4e71'], ['de', 'de-tooltip-salewa', '544fb45d4bdc2dee738b4568'], ['de', 'de-tooltip-chain', '5734758f24597738025ee253'],
      ['ja', 'ja-tooltip-gpu', '57347ca924597744596b4e71'], ['ja', 'ja-tooltip-chain', '5734758f24597738025ee253'], ['ja', 'ja-tooltip-surv', '5d02797c86f774203f38e30a'],
      ['zh', 'zh-tooltip-gpu', '57347ca924597744596b4e71'], ['zh', 'zh-tooltip-salewa', '544fb45d4bdc2dee738b4568'], ['zh', 'zh-tooltip-chain', '5734758f24597738025ee253'],
    ]
    for (const [language, name, id] of cases) {
      const variants = new Map(ITEMS.map((entry, index) => [entry.id, [{ name: ITEM_NAMES[language][index]![0], shortName: ITEM_NAMES[language][index]![1] }]]))
      const matcher = createTooltipMatcher(ITEMS, variants)
      // The tooltip's one line, as electron/screenOcr.ts recognizeTooltip gives it.
      expect(matcher(fixture(name).text.replace(/\s+/g, ' ').trim())?.id, name).toBe(id)
    }
  })

  it('the stash labels in the game\'s language tick the wanted items', () => {
    for (const [language, expected] of [['de', 4], ['ja', 4], ['zh', 3]] as const) {
      installNames(language)
      const entries = screenEntries(new Map(ITEMS.map((entry) => [entry.id, 1])), ITEMS)
      const seen = entries.filter((entry) => screenScore(entry, fixture(`${language}-labels`).text) >= 0.78).map((entry) => entry.item.id)
      expect(seen.length, `${language}: ${seen.join(', ')}`).toBe(expected)
    }
  })
})

describe('the flea market', () => {
  it('the chips that leave the cheapest offer, the traders\' rows', () => {
    expect(fleaFilterAllows(fixture('de-flea-condition').text, 'de')).toBe(true)
    expect(fleaFilterAllows(fixture('de-flea-barter').text, 'de')).toBe(true)
    expect(fleaFilterAllows('Währung EUR', 'de')).toBe(false)
    expect(fleaFilterAllows(fixture('ja-flea-condition').text, 'ja')).toBe(true)
    expect(fleaFilterAllows(fixture('ja-flea-barter').text, 'ja')).toBe(true)
    expect(fleaFilterAllows(fixture('zh-flea-condition').text, 'zh')).toBe(true)
    expect(fleaFilterAllows(fixture('zh-flea-barter').text, 'zh')).toBe(true)
    expect(fleaFilterAllows(fixture('zh-flea-barter').text)).toBe(false)
    expect(isTraderRow(fixture('de-flea-seller').text, '', 'de')).toBe(true)
    expect(isTraderRow('Jager', '', 'de')).toBe(true)
    expect(isTraderRow('Spieler_42', fixture('de-flea-total').text, 'de')).toBe(true)
    expect(isTraderRow('Spieler_42', 'Gesamt 3', 'de')).toBe(false)
    expect(isTraderRow('Player_42', fixture('ja-flea-limit').text, 'ja')).toBe(true)
    expect(isTraderRow('Player_42', fixture('zh-flea-limit').text, 'zh')).toBe(true)
    expect(isTraderRow('Player_42', fixture('zh-flea-limit').text)).toBe(false)
  })
})
