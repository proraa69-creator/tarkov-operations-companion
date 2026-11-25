import { describe, expect, it } from 'vitest'
import { cardLevelWord, confirmCards, confirmTraderLevel, findNameLevel, foldNickname, isModeSelectText, isTraderScreenText, looseNickname, modeSelectHeaders, nameLineBox, ocrLines, parseNameLevel, parseTraderLevel, parseTraderNickname, screenNickname, traderLevelWord, traderScreenParts } from './modeSelectScreen'
import { readLevelShapes } from './levelDigits'
import { closeUp, wholeBox } from './__fixtures__/levelDigitLines'
import type { OcrWordBox } from './storyPaneLayout'

/** A word box the way Tesseract gives it. */
const word = (text: string, x0: number, y0: number, x1: number, y1: number): OcrWordBox => ({ text, bbox: { x0, y0, x1, y1 } })

/**
 * The owner's screenshot (2000 × 842, the game at 2560 × 1080): the titles at y ≈ 120–145, the «ник | уровень» lines at
 * y ≈ 531–549, the cards 301 px wide from x = 535, 854 and 1174.
 */
const SIZE = { width: 2000, height: 842 }
const SCREEN: OcrWordBox[] = [
  word('ВЫБОР', 780, 33, 880, 62), word('ПРОФИЛЯ', 890, 33, 1040, 62), word('И', 1050, 33, 1065, 62), word('РЕЖИМА', 1075, 33, 1230, 62),
  word('НАЗАД', 1820, 36, 1905, 62),
  word('PvE', 596, 120, 652, 145), word('Zone', 660, 120, 715, 145),
  word('РvР', 916, 120, 972, 145), word('Zоnе', 980, 120, 1036, 145),
  word('PvP', 1236, 120, 1292, 145), word('Season', 1300, 120, 1385, 145),
  word('ОСНОВНОЙ', 596, 150, 662, 160), word('ОСНОВНОЙ', 916, 150, 982, 160), word('СЕЗОННЫЙ', 1236, 150, 1300, 160),
  word('W', 548, 533, 563, 548), word('Raid_OS', 569, 531, 637, 549), word('|', 643, 531, 646, 549), word('41', 651, 531, 671, 549),
  word('W', 868, 533, 883, 548), word('Raid_OS', 889, 531, 957, 549), word('|', 963, 531, 966, 549), word('12', 971, 531, 990, 549),
  word('W', 1188, 533, 1203, 548), word('Raid_0S', 1209, 531, 1277, 549), word('l', 1283, 531, 1286, 549), word('14', 1291, 531, 1310, 549),
  word('•', 553, 568, 557, 575), word('Ваш', 561, 566, 590, 578), word('основной', 594, 566, 660, 578), word('персонаж', 664, 566, 730, 578),
]

describe('parseNameLevel', () => {
  it('reads «ник | уровень» however the bar and the icon come out', () => {
    expect(parseNameLevel('W Raid_OS | 41')).toEqual({ nickname: 'Raid_OS', level: 41 })
    expect(parseNameLevel('Raid_OS |41')).toEqual({ nickname: 'Raid_OS', level: 41 })
    expect(parseNameLevel('Raid_OS l 41')).toEqual({ nickname: 'Raid_OS', level: 41 })
    expect(parseNameLevel('Raid_OS l41')).toEqual({ nickname: 'Raid_OS', level: 41 })
    expect(parseNameLevel('Raid_OS 1 12')).toEqual({ nickname: 'Raid_OS', level: 12 })
    expect(parseNameLevel('Raid_OS 141')).toEqual({ nickname: 'Raid_OS', level: 41 })
    expect(parseNameLevel('Raid_OS 14')).toEqual({ nickname: 'Raid_OS', level: 14 })
    // Cyrillic look-alikes from the Russian model.
    expect(parseNameLevel('Rаid_ОS | 7')).toEqual({ nickname: 'Raid_OS', level: 7 })
  })

  it('gives nothing for levels the game does not have, names it does not allow and plain text', () => {
    expect(parseNameLevel('Raid_OS | 0')).toBeNull()
    expect(parseNameLevel('Raid_OS | 85')).toBeNull()
    expect(parseNameLevel('Ra | 12')).toBeNull()
    expect(parseNameLevel('• Ваш основной персонаж в Таркове')).toBeNull()
    expect(parseNameLevel('СЕЗОННЫЙ | 54 ДН. 22:26:01')).toBeNull()
    expect(parseNameLevel('2026 | 12')).toBeNull()
  })

  it('«141» keeps 41 only because 141 is no level; «111» is 11', () => {
    expect(parseNameLevel('Raid_OS 111')).toEqual({ nickname: 'Raid_OS', level: 11 })
  })

  it('finds the line among the others of a close-up', () => {
    expect(findNameLevel('~~ ~\nW Raid_OS | 41\n• Ваш основной персонаж в Таркове')).toEqual({ nickname: 'Raid_OS', level: 41 })
  })

  it('reads a nickname like the owner\'s example «J0ss_Kat60» — a capital, a zero in it and digits at its end (25.11.2026)', () => {
    expect(parseNameLevel('J0ss_Kat60 | 25')).toEqual({ nickname: 'J0ss_Kat60', level: 25 })
    // The person icon before the name reads as a stray word and is dropped.
    expect(parseNameLevel('W J0ss_Kat60 | 25')).toEqual({ nickname: 'J0ss_Kat60', level: 25 })
    expect(findNameLevel('✴\nJ0ss_Kat60 | 25\n• Ваш основной персонаж в Таркове')).toEqual({ nickname: 'J0ss_Kat60', level: 25 })
    // The bar as «l», joined to the level.
    expect(parseNameLevel('J0ss_Kat60 l25')).toEqual({ nickname: 'J0ss_Kat60', level: 25 })
  })
})

describe('the mode selection screen', () => {
  it('is recognised by its title or two mode cards, in Russian and English', () => {
    expect(isModeSelectText('ВЫБОР ПРОФИЛЯ И РЕЖИМА\nPvE Zone PvP Zone PvP Season')).toBe(true)
    expect(isModeSelectText('РvЕ Zоnе   РvР Season')).toBe(true)
    expect(isModeSelectText('PROFILE AND MODE SELECTION\nPvP Zone')).toBe(true)
    expect(isModeSelectText('PvP Zone')).toBe(false)
    expect(isModeSelectText('ПЕРСОНАЖ ТОРГОВЦЫ БАРАХОЛКА')).toBe(false)
  })

  it('finds every card, its mode and the line the whole pass read', () => {
    const headers = modeSelectHeaders(SCREEN, SIZE)
    expect(headers.map((header) => header.mode)).toEqual(['pve', 'pvp', 'seasonal'])
    expect(headers.map((header) => header.full && { nickname: header.full.nickname, level: header.full.level })).toEqual([
      { nickname: 'Raid_OS', level: 41 },
      { nickname: 'Raid_OS', level: 12 },
      { nickname: 'Raid_0S', level: 14 },
    ])
    for (const header of headers) {
      // Each band stays inside its own card (535–836, 854–1156, 1174–1476) and holds the line (y 531–549).
      expect(header.band.y).toBeLessThan(531)
      expect(header.band.y + header.band.height).toBeGreaterThan(549)
      expect(header.full!.box.y).toBeLessThan(531)
    }
    expect(headers[0]!.band.x + headers[0]!.band.width).toBeLessThan(854)
    expect(headers[1]!.band.x).toBeGreaterThan(836)
  })

  it('widens a card\'s close-up to its band when the whole pass clipped the name\'s start (owner, 25.11.2026)', () => {
    // «J0ss_Kat60»: the whole pass dropped «J0» over the character art and read «ss_Kat62», starting further right (x 600).
    // The close-up box must still reach the band's title-anchored left edge, left of where «J0ss…» begins (x ≈ 569), so the
    // 3× pass sees «J0» again — and stay inside the card.
    const clipped: OcrWordBox[] = [
      word('PvE', 596, 120, 652, 145), word('Zone', 660, 120, 715, 145),
      word('PvP', 916, 120, 972, 145), word('Zone', 980, 120, 1036, 145),
      word('PvP', 1236, 120, 1292, 145), word('Season', 1300, 120, 1385, 145),
      word('ss_Kat62', 600, 531, 668, 549), word('|', 674, 531, 677, 549), word('25', 683, 531, 703, 549),
    ]
    const pve = modeSelectHeaders(clipped, SIZE).find((header) => header.mode === 'pve')!
    expect(pve.full?.nickname).toBe('ss_Kat62')
    expect(pve.full!.box.x).toBe(pve.band.x)
    expect(pve.full!.box.x).toBeLessThan(569)
    expect(pve.full!.box.x + pve.full!.box.width).toBeLessThanOrEqual(pve.band.x + pve.band.width)
    expect(pve.full!.box.x + pve.full!.box.width).toBeLessThan(854)
  })

  it('is not this screen when one mode shows twice or the titles are at different heights', () => {
    expect(modeSelectHeaders([word('PvP', 10, 100, 40, 120), word('Zone', 45, 100, 80, 120), word('PvP', 400, 100, 430, 120), word('Zone', 435, 100, 470, 120)], SIZE)).toEqual([])
    expect(modeSelectHeaders([word('PvE', 10, 100, 40, 120), word('Zone', 45, 100, 80, 120), word('PvP', 400, 500, 430, 520), word('Zone', 435, 500, 470, 520)], SIZE)).toEqual([])
  })
})

describe('confirmCards', () => {
  const card = (nickname: string, level: number) => ({ nickname, level })

  it('the player\'s PvE card (report of 14.10.2026): a «39» Tesseract read as «59» is 39', () => {
    // What Tesseract (the app's models) read in «Raid_OS | 39» drawn in the game's font at 18 and 22 px: the whole pass
    // «39», the ×3 close-up «59». The old rule took the close-up once the next frame — the same pixels — repeated it.
    const full = parseNameLevel('Raid_OS | 39')!, line = findNameLevel('Raid_OS | 59')!
    const picture = closeUp('card-39-18')
    const digits = readLevelShapes(picture, wholeBox(picture), [line.level, full.level])
    expect(digits).toEqual({ 2: 39 })
    expect(confirmCards([{ mode: 'pve', full, line, digits }])).toEqual([{ mode: 'pve', level: 39, nickname: 'Raid_OS' }])
  })

  it('OCR readings alone never confirm a level: not two of them, not the same close-up twice', () => {
    // «Raid_OS | 50» at 16 px: Tesseract read «58» in the whole pass and in the close-up; the shapes say 50.
    expect(confirmCards([{ mode: 'pvp', full: card('Raid_OS', 58), line: card('Raid_OS', 58), digits: { 2: 50 } }])).toEqual([{ mode: 'pvp', nickname: 'Raid_OS' }])
    expect(confirmCards([{ mode: 'pvp', full: card('Raid_OS', 41), line: card('Raid_OS', 41) }])).toEqual([{ mode: 'pvp', nickname: 'Raid_OS' }])
    expect(confirmCards([{ mode: 'pvp', full: card('Raid_OS', 41), line: card('Raid_OS', 41), digits: { 2: null } }])).toEqual([{ mode: 'pvp', nickname: 'Raid_OS' }])
    expect(confirmCards([{ mode: 'pvp', full: card('Raid_OS', 41), line: card('Other', 41), digits: { 2: null } }])).toEqual([])
  })

  it('the nickname counts without the level (audit P4e): a clear «Raid_OS» next to a «39» the shapes did not confirm', () => {
    expect(confirmCards([{ mode: 'pve', full: card('Raid_OS', 39), line: card('Raid_OS', 59), digits: { 2: null } }])).toEqual([{ mode: 'pve', nickname: 'Raid_OS' }])
  })

  it('the whole pass missed the line: the close-up\'s name counts once the previous frame\'s close-up read it too', () => {
    const missed = [{ mode: 'pvp' as const, line: card('Raid_OS', 12) }]
    expect(confirmCards(missed)).toEqual([])
    expect(confirmCards(missed, { pvp: 'Raid_0S' })).toEqual([{ mode: 'pvp', nickname: 'Raid_OS' }])
    expect(confirmCards(missed, { pve: 'Raid_OS', pvp: 'Other' })).toEqual([])
    // A whole pass that read another name is a disagreement, whatever the earlier close-up said.
    expect(confirmCards([{ mode: 'pvp', full: card('Other', 12), line: card('Raid_OS', 12) }], { pvp: 'Raid_OS' })).toEqual([])
  })

  it('an OCR reading the shapes confirm is the level; the nickname needs two readings alike', () => {
    expect(confirmCards([{ mode: 'pve', full: card('Raid_OS', 41), line: card('Raid_0S', 41), digits: { 2: 41 } }])).toEqual([{ mode: 'pve', level: 41, nickname: 'Raid_0S' }])
    // The whole pass missed the line: the close-up of the band and the shapes still give the level; the name needs the
    // previous frame's close-up.
    expect(confirmCards([{ mode: 'seasonal', line: card('Raid_OS', 14), digits: { 2: 14 } }])).toEqual([{ mode: 'seasonal', level: 14 }])
    expect(confirmCards([{ mode: 'seasonal', line: card('Raid_OS', 14), digits: { 2: 14 } }], { seasonal: 'Raid_OS' })).toEqual([{ mode: 'seasonal', level: 14, nickname: 'Raid_OS' }])
    // Readings of different lengths («3» and «35») each meet the shapes of their own count.
    expect(confirmCards([{ mode: 'pvp', full: card('Raid_OS', 3), line: card('Raid_OS', 35), digits: { 1: null, 2: 35 } }])).toEqual([{ mode: 'pvp', level: 35, nickname: 'Raid_OS' }])
  })

  it('recovers a name whose start the whole pass clipped (owner, 25.11.2026: «J0ss_Kat60» → «ss_Kat62»)', () => {
    // The whole pass dropped «J0» over the character art («ss_Kat62»); the widened 3× close-up reads the whole «J0ss_Kat62».
    const reading = { mode: 'pve' as const, full: card('ss_Kat62', 25), line: card('J0ss_Kat62', 25), digits: { 2: 25 } }
    // One frame alone does not take the longer name — only the level counts.
    expect(confirmCards([reading])).toEqual([{ mode: 'pve', level: 25 }])
    // The next frame's close-up read «J0ss_Kat62» too: the whole name is taken, «J0» no longer lost.
    expect(confirmCards([reading], { pve: 'J0ss_Kat62' })).toEqual([{ mode: 'pve', level: 25, nickname: 'J0ss_Kat62' }])
    // A whole pass that read a different name (not a clip of the close-up) stays a disagreement: only the level.
    expect(confirmCards([{ mode: 'pve', full: card('Zampolit', 25), line: card('J0ss_Kat62', 25), digits: { 2: 25 } }], { pve: 'J0ss_Kat62' }))
      .toEqual([{ mode: 'pve', level: 25 }])
  })
})

describe('where the level is in a close-up', () => {
  const at = (text: string, x0: number, x1: number, y0 = 10): OcrWordBox => ({ text, bbox: { x0, y0, x1, y1: y0 + 30 } })

  it('a card: the last word with digits on the «ник | уровень» line, not a timer under it', () => {
    const lines = [[at('W', 0, 20), at('Raid_OS', 30, 120), at('|', 130, 134), at('41', 140, 170)], [at('54', 10, 40, 60), at('ДН.', 45, 70, 60), at('22:26:01', 80, 160, 60)]]
    expect(cardLevelWord(lines, false)?.text).toBe('41')
    expect(cardLevelWord([lines[1]!], false)).toBeNull()
    // A close-up of the line alone: its last word with digits even when the name was misread.
    expect(cardLevelWord([[at('~~', 0, 20), at('R@id', 30, 80), at('|41', 130, 170)]], true)?.text).toBe('|41')
  })

  it('the traders\' screen: the word after «LVL», not «0.20» next to it', () => {
    expect(traderLevelWord([[at('LVL', 0, 40), at('12', 50, 70), at('0.20', 120, 160)]])?.text).toBe('12')
    expect(traderLevelWord([[at('LVL12', 0, 70)]])?.text).toBe('LVL12')
    expect(traderLevelWord([[at('ЦУЬ', 0, 40), at('12', 50, 70)]])?.text).toBe('12')
  })

  it('the words of each line of a Tesseract result', () => {
    const blocks = [{ paragraphs: [{ lines: [{ words: [at('LVL', 0, 40)] }, { words: [at('12', 50, 70)] }] }] }]
    expect(ocrLines(blocks).map((words) => words.map((entry) => entry.text))).toEqual([['LVL'], ['12']])
    expect(ocrLines(null)).toEqual([])
  })
})

describe('confirmTraderLevel', () => {
  it('needs the shapes: «LVL 39» read as «59» by the whole pass and the close-up gives nothing', () => {
    expect(confirmTraderLevel(59, 59, { 2: 39 })).toBeUndefined()
    expect(confirmTraderLevel(39, 59, { 2: 39 })).toBe(39)
    expect(confirmTraderLevel(undefined, 12, { 2: 12 })).toBe(12)
    expect(confirmTraderLevel(12, 12, { 2: null })).toBeUndefined()
    expect(confirmTraderLevel(12, 12, undefined)).toBeUndefined()
  })
})

describe('screenNickname', () => {
  it('is the name all the cards show, in the spelling the app knows', () => {
    expect(screenNickname([{ nickname: 'Raid_OS' }, { nickname: 'Raid_0S' }, { nickname: 'Raid_OS' }])).toBe('Raid_OS')
    expect(screenNickname([{ nickname: 'Raid_0S' }], 'Raid_OS')).toBe('Raid_OS')
    expect(screenNickname([{ nickname: 'NewName' }], 'Raid_OS')).toBe('NewName')
  })

  it('cards with different names give none; cards without a confirmed name do not count', () => {
    expect(screenNickname([{ nickname: 'Raid_OS' }, { nickname: 'Other' }])).toBeNull()
    expect(screenNickname([])).toBeNull()
    expect(screenNickname([{}, { nickname: 'Raid_OS' }])).toBe('Raid_OS')
    expect(screenNickname([{}, {}])).toBeNull()
  })

  it('folds what OCR mixes up', () => {
    expect(foldNickname('Raid_0S')).toBe(foldNickname('raid-os'))
    expect(foldNickname('Il1')).toBe(foldNickname('lI1'))
  })
})

describe('the traders\' screen', () => {
  /** The owner's screenshot (2000 × 837): «Raid_OS (вы)», the badge «12», «Текущее отношение: I LVL 12 0.20 …». */
  const TRADERS: OcrWordBox[] = [
    word('ТОРГОВЛЯ', 285, 15, 365, 30), word('ЗАДАНИЯ', 408, 15, 462, 30),
    word('Raid_OS', 1425, 55, 1488, 68), word('(вы)', 1492, 55, 1530, 68), word('12', 1612, 45, 1630, 60),
    word('Текущее', 1270, 118, 1318, 130), word('отношение:', 1322, 118, 1378, 130), word('I', 1388, 117, 1396, 131), word('LVL', 1410, 118, 1428, 130), word('12', 1431, 118, 1443, 130), word('0.20', 1468, 118, 1492, 130),
    word('Следующий', 1300, 141, 1360, 153), word('УЛ:', 1364, 141, 1380, 153), word('II', 1388, 140, 1398, 154), word('LVL', 1410, 141, 1428, 153), word('6', 1431, 141, 1438, 153), word('0.70', 1468, 141, 1492, 153),
  ]
  const TEXT = 'ТОРГОВЛЯ ЗАДАНИЯ\nRaid_OS (вы) 12\nТекущее отношение: I LVL 12 0.20 Р 405.7k (потр.)\nСледующий УЛ: II LVL 6 0.70'

  it('is recognised by the standing line and «(вы)»', () => {
    expect(isTraderScreenText(TEXT)).toBe(true)
    expect(isTraderScreenText('Current standing: I LVL 12\nBear_Hunter (you)')).toBe(true)
    expect(isTraderScreenText('ТОРГОВЛЯ ЗАДАНИЯ Прапор Терапевт')).toBe(false)
  })

  it('reads the name before «(вы)» and the level of the current standing, never the next one\'s requirement', () => {
    const parts = traderScreenParts(TRADERS, { width: 2000, height: 837 })
    expect(parts.nickname?.value).toBe('Raid_OS')
    expect(parts.level?.value).toBe(12)
    expect(parts.level!.box.y).toBeLessThan(118)
    expect(parts.level!.box.y + parts.level!.box.height).toBeLessThan(141 + 8)
  })

  it('close-ups: the level after «LVL», the name without the icon or «(вы)»', () => {
    expect(parseTraderLevel('LVL 12')).toBe(12)
    expect(parseTraderLevel('LVI12')).toBe(12)
    expect(parseTraderLevel('LVL 0')).toBeNull()
    expect(parseTraderLevel('12')).toBeNull()
    expect(parseTraderNickname('Raid_OS (вы)')).toBe('Raid_OS')
    expect(parseTraderNickname('Rаid_ОS')).toBe('Raid_OS')
    expect(parseTraderNickname('(вы)')).toBeNull()
  })
})

/**
 * Owner, 25.11.2026: «цифры не читает корректно … научись правильно читать, разделять, где цифра, а где буква». A nickname
 * like «J0ss_Kat60» (the game's slashed «0» after the first letter and at the end) came «JOss_Kat62», «JGss_Kat6a» from the
 * close-up and «3Qss_Kat6a», «ss_Kat62», «JOss_Kat6d» from the whole pass; the close-up's glyphs are now checked by their
 * shapes (src/import/nameGlyphs.ts), and its line is cut tight by its pixels.
 */
describe('the nickname with the game\'s slashed zero', () => {
  const card = (nickname: string, level: number) => ({ nickname, level })
  /** A dark band with the character art (tan) above, the white «ник | уровень» line and a white bullet line under it. */
  function band(): { width: number; height: number; gray: Uint8Array } {
    const width = 400, height = 200, gray = new Uint8Array(width * height).fill(35)
    const fill = (x0: number, y0: number, x1: number, y1: number, value: number) => {
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) gray[y * width + x] = value
    }
    // Trousers over the whole band's top, and a highlight on a boot far right on the line's rows.
    fill(0, 0, 399, 60, 125)
    fill(380, 95, 384, 108, 240)
    // The line: the person icon, the name's letters (strokes with gaps between them), the bar and the level.
    fill(40, 95, 52, 110, 235)
    for (let x = 62; x < 250; x += 14) fill(x, 94, x + 8, 110, 235)
    fill(260, 92, 262, 114, 235)
    fill(272, 94, 300, 110, 235)
    // A bullet line further down.
    for (let x = 30; x < 330; x += 12) fill(x, 150, x + 7, 162, 225)
    return { width, height, gray }
  }

  it('finds the card\'s line by its pixels: tight around it, the art above and the highlight beside it left out', () => {
    const box = nameLineBox(band(), 1080)!
    expect(box.y0).toBeGreaterThanOrEqual(80)
    expect(box.y0).toBeLessThanOrEqual(92)
    expect(box.y1).toBeGreaterThanOrEqual(114)
    expect(box.y1).toBeLessThan(140)
    expect(box.x0).toBeLessThanOrEqual(40)
    expect(box.x0).toBeGreaterThan(20)
    expect(box.x1).toBeGreaterThanOrEqual(300)
    expect(box.x1).toBeLessThan(380)
  })

  it('no white letters in the band, no line', () => {
    const dark = { width: 400, height: 200, gray: new Uint8Array(400 * 200).fill(90) }
    expect(nameLineBox(dark, 1080)).toBeNull()
  })

  it('a checked close-up is the same name as the whole pass\'s look-alikes of the font, at once', () => {
    const line = { nickname: 'J0ss_Kat60', level: 25, zeros: '.0.......0' }
    for (const whole of ['3Qss_Kat6a', 'JOss_Kat6d', 'J0ss_Kat62', 'JGss_Kat6e']) {
      expect(confirmCards([{ mode: 'pve', full: card(whole, 25), line, digits: { 2: 25 } }])).toEqual([{ mode: 'pve', level: 25, nickname: 'J0ss_Kat60', zeros: '.0.......0' }])
    }
    // The whole pass clipped the name's start: the next frame's close-up confirms it, as before.
    const clipped = { mode: 'pve' as const, full: card('ss_Kat6a', 25), line, digits: { 2: 25 } }
    expect(confirmCards([clipped])).toEqual([{ mode: 'pve', level: 25 }])
    expect(confirmCards([clipped], { pve: 'J0ss_Kat60' })).toEqual([{ mode: 'pve', level: 25, nickname: 'J0ss_Kat60', zeros: '.0.......0' }])
    // Another name in the whole pass is still another name.
    expect(confirmCards([{ mode: 'pve', full: card('Zampolit', 25), line, digits: { 2: 25 } }], { pve: 'J0ss_Kat60' })).toEqual([{ mode: 'pve', level: 25 }])
    // An unchecked close-up needs the whole pass to read it alike, as before.
    expect(confirmCards([{ mode: 'pve', full: card('3Qss_Kat6a', 25), line: card('JOss_Kat62', 25), digits: { 2: 25 } }])).toEqual([{ mode: 'pve', level: 25 }])
    expect(looseNickname('3Qss_Kat6a')).toBe(looseNickname('J0ss_Kat60'))
    expect(looseNickname('Bear_Hunter')).not.toBe(looseNickname('Bear_Hunt3r_'))
  })

  it('the screen\'s proven zero wins over a known spelling with the letter O; the known spelling keeps the rest', () => {
    const proven = { nickname: 'J0ss_Kat60', zeros: '.0.......0' }
    expect(screenNickname([proven], 'JOss_Kat60')).toBe('J0ss_Kat60')
    expect(screenNickname([proven], 'J0ss_Kat60')).toBe('J0ss_Kat60')
    // A stale misreading the app kept is not the same name folded: the screen's spelling replaces it.
    expect(screenNickname([proven], 'JOss_Kat62')).toBe('J0ss_Kat60')
    expect(screenNickname([proven], 'ss_Kat62')).toBe('J0ss_Kat60')
    // A round letter the screen proved where the known spelling has «0».
    expect(screenNickname([{ nickname: 'Raid_OS', zeros: '.....o.' }], 'Raid_0S')).toBe('Raid_OS')
    // Unchecked cards: the known spelling as before.
    expect(screenNickname([{ nickname: 'JOss_Kat60' }], 'J0ss_Kat60')).toBe('J0ss_Kat60')
    // Cards of one name: a checked card's spelling, the one with the most proven letters.
    expect(screenNickname([{ nickname: 'JOss_Kat60' }, { nickname: 'J0ss_Kat62', zeros: '.0........' }, proven])).toBe('J0ss_Kat60')
    // Two names on the cards: none.
    expect(screenNickname([proven, { nickname: 'Wolf_Pack', zeros: '.........' }])).toBeNull()
  })
})
