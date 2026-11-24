import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { exitNameKey, resetGameNamesForTests, setGameNames, setWantedGameLanguage } from '../data/gameNames'
import { exitNames } from '../data/exitShortNames'
import { cjkBlocksText, joinCjkWords } from '../shared/cjk'
import type { ExtraGameLanguage } from './gameLanguage'
import { matchQuestsFromOcr, rowStatus } from './questOcr'
import { isTasksMenuText, tableMatches, tableRowCount } from './screenScanSync'
import { tasksScreenKind } from './storyScan'
import { isModeSelectText, isTraderScreenText, modeSelectHeaders, parseTraderNickname, traderScreenParts } from './modeSelectScreen'
import { traderBadgeRects } from './traderLoyalty'
import { fleaFilterAllows, isTraderRow } from './fleaScreen'
import { exitHighlights, parseExtractList } from '../maps/raidExtracts'
import { createTooltipMatcher } from '../overlay/tooltipMatch'
import { screenEntries, screenScore } from '../kappa/collector'
import type { OcrWordBox } from './storyPaneLayout'
import { GAME_LANGUAGE_OCR } from './__fixtures__/gameLanguageOcr'

/**
 * The screen readers in a Polish, Spanish, Brazilian Portuguese, French, Korean and Turkish game, on real Tesseract output
 * of pictures drawn from the game's own words (src/import/__fixtures__/gameLanguageOcr.ts, scripts/ocr/language-fixtures.mjs),
 * as src/import/gameLanguageReaders.test.ts does for German, Japanese and Chinese.
 */
type Language = 'pl' | 'es' | 'pt' | 'fr' | 'ko' | 'tr'
const LANGUAGES: Language[] = ['pl', 'es', 'pt', 'fr', 'ko', 'tr']

const fixture = (name: string) => GAME_LANGUAGE_OCR[name]!
const blocksOf = (name: string) => [{ paragraphs: (fixture(name).blocks ?? []).map((lines) => ({ lines: lines.map((words) => ({ words })) })) }]
/** The text the app reads (Japanese and Chinese only are rebuilt from their boxes; Korean keeps the OCR's own spaces). */
const text = (name: string) => (/^(ja|zh)-/.test(name) ? cjkBlocksText(blocksOf(name))! : fixture(name).text)
const words = (name: string): OcrWordBox[] => (fixture(name).blocks ?? []).flatMap((lines) => lines.flatMap((line) => joinCjkWords(line)))

const quest = (id: string, name: string, nameEn: string, mapId?: string): Quest => ({ id, name, nameRu: name, nameEn, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...(mapId ? { mapId } : {}) })
const QUESTS: Quest[] = [
  quest('5936d90786f7742b1420ba5b', 'Проба пера', 'Debut', 'customs'),
  quest('5a68663e86f774501078f78a', 'Врачебная тайна. Часть 2', 'Health Care Privacy - Part 2'),
  quest('5a68665c86f774255929b4c7', 'Врачебная тайна. Часть 3', 'Health Care Privacy - Part 3'),
  quest('5967725e86f774601a446662', 'Тряхнуть кассира', 'Shaking Up the Teller', 'interchange'),
  quest('5969f9e986f7741dde183a50', 'Провизор', 'Pharmacist'),
  quest('5936da9e86f7742d65037edf', 'Проверка на вшивость', 'Background Check', 'customs'),
  quest('5967733e86f774602332fc84', 'Дефицит', 'Shortage'),
]
/** Their titles in each language (tarkov.dev's tasks_{pl,es,pt,fr,ko,tr}). */
const TITLES: Record<Language, string[]> = {
  pl: ['Debiut', 'Prywatna opieka zdrowotna – część 2', 'Prywatna opieka zdrowotna – część 3', 'Potrząsając kasjerem', 'Farmaceuta', 'Rozeznanie', 'Deficyt'],
  es: ['Debut', 'Atención Médica - Parte 2', 'Atención Médica - Parte 3', 'Sacudiendo al cajero', 'Farmacéutico', 'Comprobación de Antecedentes', 'Escasez'],
  pt: ['Estréia', 'Atenção Médica - Parte 2', 'Atenção Médica - Parte 3', 'Agitando o caixa', 'Farmacêutico', 'Verificação de antecedentes', 'Em Falta'],
  fr: ['Première fois', 'Soins privés - Partie 2', 'Soins privés - Partie 3', 'Secouez le caissier', 'Pharmacien', "Vérification d'antécédents", 'Pénurie'],
  ko: ['데뷔', '의료 개인 정보 보호 - 파트 2', '의료 개인 정보 보호 - 파트 3', '돈가방을 갖고 튀어라', '약사', '배경 조사', '재고 부족'],
  tr: ['Başlangıç', 'Sağlık Hizmetleri Gizliliği - Bölüm 2', 'Sağlık Hizmetleri Gizliliği - Bölüm 3', 'Kasiyeri Uyandır', 'Eczacı', 'Arkaplan kontrolü', 'Kıtlık'],
}

const item = (id: string, name: string, shortName: string) => ({ id, name, shortName, category: 'Бартер', description: '', prices: [] }) as unknown as Item
const ITEMS: Item[] = [
  item('57347ca924597744596b4e71', 'Видеокарта', 'GPU'),
  item('544fb45d4bdc2dee738b4568', 'Аптечка Salewa First Aid Kit', 'Salewa'),
  item('5d02797c86f774203f38e30a', 'Полевой хирургический набор Surv12', 'Surv12'),
  item('5734758f24597738025ee253', 'Золотая цепочка', 'Зол. цепь'),
  item('5c94bbff86f7747ee735c08f', 'Ключ-карта доступа в TerraGroup Labs', 'Доступ'),
]
/** tarkov.dev's items_{pl,es,pt,fr,ko,tr}: [name, short name] of each item above. */
const ITEM_NAMES: Record<Language, Array<[string, string]>> = {
  pl: [['Karta graficzna', 'GPU'], ['Zestaw pierwszej pomocy Salewa', 'Salewa'], ['Polowy zestaw chirurgiczny Surv12', 'Surv12'], ['Złoty łańcuszek na szyję', 'Złoty łań.'], ['Karta dostępu TerraGroup Labs', 'Dostęp']],
  es: [['Tarjeta gráfica', 'T. Gráfica'], ['Botiquín de primeros auxilios Salewa', 'Salewa'], ['Kit quirúrgico de campo Surv12', 'Surv12'], ['Cadena de oro', 'Cad. Oro'], ['Tarjeta de acceso a TerraGroup Labs', 'T. Acceso']],
  pt: [['Placa de vídeo', 'GPU'], ['Kit de primeiros socorros Salewa', 'Salewa'], ['Kit cirúrgico de campo Surv12', 'Surv12'], ['Colar de ouro', 'Corr.ouro'], ['Cartão de acesso à Terragroup Labs', 'Cartão']],
  fr: [['Carte graphique', 'Carte Graph.'], ['Kit de premiers secours Salewa', 'Salewa'], ['Kit chirurgical de terrain Surv12', 'Surv12'], ['Collier doré', 'CollierOr'], ["Carte d'accès TerraGroup Labs", 'Accès']],
  ko: [['GPU 그래픽 카드', 'GPU'], ['Salewa 응급 치료 키트', 'Salewa'], ['Surv12 야전 수술 키트', 'Surv12'], ['Golden neck chain 금목걸이', '금목걸이'], ['테라그룹 연구소 출입 키카드 (TerraGroup Labs access keycard)', 'Access']],
  tr: [['Ekran Kartı', 'Ekran kartı'], ['Salewa ilk yardım kiti', 'Salewa'], ['Surv12 saha cerrahi seti', 'Surv12'], ['Altın kolye', 'Altın Kolye'], ['TerraGroup Laboratuvarları erişim kartı', 'Erişim Kartı']],
}
/** Customs' exits: the catalog's Russian and English names, and each language's (tarkov.dev maps_{lang}). */
const EXITS: Array<{ id: string; ru: string; en: string } & Record<Language, string>> = [
  { id: 'gas', ru: 'Старая заправка', en: 'Old Gas Station', pl: 'Stara stacja paliw', es: 'Antigua Gasolinera', pt: 'Posto de Gasolina Antigo', fr: 'Ancienne station-service', ko: 'Old Gas Station', tr: 'Eski Yakıt İstasyonu' },
  { id: 'trailer', ru: 'Трейлерный парк', en: 'Trailer Park', pl: 'Parking naczep', es: 'Parking de Tráileres', pt: 'Estacionamento de Trailers', fr: 'Parc à remorques', ko: 'Trailer Park', tr: 'Treyler Parkı' },
  { id: 'zb1011', ru: 'ЗБ-1011', en: 'ZB-1011', pl: 'ZB-1011', es: 'ZB-1011', pt: 'ZB-1011', fr: 'ZB-1011', ko: 'ZB-1011', tr: 'ZB-1011' },
  { id: 'warehouse', ru: 'Склад 4', en: 'Warehouse 4', pl: 'Magazyn 4', es: 'Almacén Nº4', pt: 'Warehouse 4', fr: 'Entrepôt 4', ko: 'Warehouse 4', tr: 'Depo 4' },
  { id: 'crossroads', ru: 'Перекресток', en: 'Crossroads', pl: 'Rozdroże', es: 'Cruce de Caminos', pt: 'Cruzamento', fr: 'Carrefour', ko: 'Crossroads', tr: 'Kavşak' },
  { id: 'rocks', ru: 'Проход между скалами', en: 'Passage Between Rocks', pl: 'Przejście między skałami', es: 'Pasaje Entre Rocas', pt: 'Passage between rocks', fr: 'Passage entre les rochers', ko: 'Passage Between Rocks', tr: 'Kayalar arasındaki geçit' },
]

function installNames(language: Language) {
  setWantedGameLanguage(language)
  setGameNames({
    language: language as ExtraGameLanguage,
    quests: new Map(QUESTS.map((entry, index) => [entry.id, TITLES[language][index]!])),
    items: new Map(ITEMS.map((entry, index) => [entry.id, { name: ITEM_NAMES[language][index]![0], shortName: ITEM_NAMES[language][index]![1] }])),
    exits: new Map(EXITS.flatMap((exit) => [[exitNameKey(exit.ru), exit[language]], [exitNameKey(exit.en), exit[language]]] as Array<[string, string]>)),
  })
}

beforeEach(() => resetGameNamesForTests())
afterEach(() => resetGameNamesForTests())

describe.each(LANGUAGES)('a %s game', (language) => {
  it('the Tasks table: the screen, its rows, their titles and statuses, part 2 never part 3', () => {
    installNames(language)
    const frame = text(`${language}-tasks`)
    expect(isTasksMenuText(frame, language)).toBe(true)
    expect(tableRowCount(frame, language)).toBe(4)
    expect(tasksScreenKind(frame, null, language)).toBe('table')
    const matches = tableMatches(frame, matchQuestsFromOcr(frame, QUESTS, { language }))
    expect(Object.fromEntries(matches.map((match) => [match.questId, match.status]))).toEqual({
      '5936d90786f7742b1420ba5b': 'active',
      '5a68663e86f774501078f78a': 'ready',
      '5967725e86f774601a446662': 'active',
      '5969f9e986f7741dde183a50': 'locked',
    })
  })

  it('the traders\' screen: the standing\'s level and the portraits; the mode cards', () => {
    expect(isTraderScreenText(text(`${language}-traders`), language)).toBe(true)
    expect(traderScreenParts(words(`${language}-traders`), fixture(`${language}-traders`).size, language).level?.value).toBe(12)
    expect(traderBadgeRects(words(`${language}-traders`), fixture(`${language}-traders`).size, language)).toHaveLength(8)
    expect(isModeSelectText(text(`${language}-modes`), language)).toBe(true)
    expect(modeSelectHeaders(words(`${language}-modes`), fixture(`${language}-modes`).size, language).map((header) => header.mode)).toEqual(['pve', 'pvp'])
  })

  it('the exit list lights the map\'s exits it names', () => {
    installNames(language)
    const names = parseExtractList(text(`${language}-exits`), language)
    expect(names.length).toBeGreaterThanOrEqual(3)
    const states = exitHighlights({ names, at: 10, text: text(`${language}-exits`), language }, 0, EXITS.map((exit) => ({ id: exit.id, title: exit.ru, titles: exitNames(exit.ru) })), 20)
    const listed = ['gas', 'trailer', 'zb1011', ...(['pl', 'fr', 'tr'].includes(language) ? ['warehouse'] : [])]
    expect([...states!.lit].sort()).toEqual(listed.sort())
  })

  it('the item card\'s tooltip and the stash labels in the language', () => {
    installNames(language)
    const variants = new Map(ITEMS.map((entry, index) => [entry.id, [{ name: ITEM_NAMES[language][index]![0], shortName: ITEM_NAMES[language][index]![1] }]]))
    const matcher = createTooltipMatcher(ITEMS, variants)
    for (const [kind, id] of [['gpu', '57347ca924597744596b4e71'], ['salewa', '544fb45d4bdc2dee738b4568'], ['chain', '5734758f24597738025ee253']] as const) {
      expect(matcher(fixture(`${language}-tooltip-${kind}`).text.replace(/\s+/g, ' ').trim())?.id, kind).toBe(id)
    }
    const entries = screenEntries(new Map(ITEMS.map((entry) => [entry.id, 1])), ITEMS)
    const seen = entries.filter((entry) => screenScore(entry, fixture(`${language}-labels`).text) >= 0.78).map((entry) => entry.item.id)
    expect(seen.sort()).toEqual(['544fb45d4bdc2dee738b4568', '57347ca924597744596b4e71', '5734758f24597738025ee253', '5c94bbff86f7747ee735c08f'].sort())
  })

  it('the flea: the chips that leave the cheapest offer, the traders\' rows', () => {
    expect(fleaFilterAllows(fixture(`${language}-flea-condition`).text, language)).toBe(true)
    expect(fleaFilterAllows(fixture(`${language}-flea-barter`).text, language)).toBe(true)
    expect(isTraderRow('Player_42', fixture(`${language}-flea-total`).text, language)).toBe(true)
  })
})

describe('the languages\' own forms', () => {
  it('Polish «ukończone!» is ready to hand in, «ukończone» handed in (no status)', () => {
    expect(rowStatus('Debiut Skład celny ukończone! 100%', 'pl')).toBe('ready')
    expect(rowStatus('Debiut Skład celny ukończone 100%', 'pl')).toBeUndefined()
  })

  it('Spanish: both of the game\'s Spanish wordings, «¡» lost or read as «i»', () => {
    expect(rowStatus('Debut Customs ¡Finalizada! 100%', 'es')).toBe('ready')
    expect(rowStatus('Debut Customs ¡Terminada! 100%', 'es')).toBe('ready')
    expect(rowStatus('Debut Customs iActiva! 0%', 'es')).toBe('active')
    expect(rowStatus('Debut Customs Activa! 0%', 'es')).toBe('active')
    expect(rowStatus('Debut Customs Fallida', 'es')).toBe('failed')
    expect(rowStatus('Debut Customs Fallada', 'es')).toBe('failed')
  })

  it('accents read or lost, the Turkish i in any form', () => {
    expect(rowStatus('Pharmacien Toutes Terminee ! 100%', 'fr')).toBe('ready')
    expect(rowStatus('Pharmacien Toutes Verrouille 0%', 'fr')).toBe('locked')
    expect(rowStatus('Eczacı bölge KİLİTLİ 0%', 'tr')).toBe('locked')
    expect(rowStatus('Eczacı bölge KILITLI 0%', 'tr')).toBe('locked')
    expect(rowStatus('약사 아무 지역 완료! 100%', 'ko')).toBe('ready')
    // «완료함» is handed in, not ready.
    expect(rowStatus('약사 아무 지역 완료함', 'ko')).toBeUndefined()
  })

  it('the trader screen\'s «(you)» around the nickname in every language', () => {
    expect(parseTraderNickname('Raid_OS (ty)', 'pl')).toBe('Raid_OS')
    expect(parseTraderNickname('Raid_OS (tú)', 'es')).toBe('Raid_OS')
    expect(parseTraderNickname('Raid_OS (você)', 'pt')).toBe('Raid_OS')
    expect(parseTraderNickname('Raid_OS (vous)', 'fr')).toBe('Raid_OS')
    expect(parseTraderNickname('Raid_OS (내 정보)', 'ko')).toBe('Raid_OS')
    expect(parseTraderNickname('Raid_OS (sen)', 'tr')).toBe('Raid_OS')
    expect(traderScreenParts(words('pl-traders'), fixture('pl-traders').size, 'pl').nickname?.value).toBe('Raid_OS')
    expect(traderScreenParts(words('ko-traders'), fixture('ko-traders').size, 'ko').nickname?.value).toBe('Raid_OS')
  })
})
