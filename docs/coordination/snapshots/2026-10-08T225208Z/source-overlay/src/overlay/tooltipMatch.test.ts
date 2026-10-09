import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { createTooltipMatcher, foldName, foldTooltipText, looseDigits, pickSameName, repairOcrNumbers, type ItemNameVariant } from './tooltipMatch'

const item = (id: string, name: string, shortName: string) => ({ id, name, shortName }) as unknown as Item
const priced = (entry: Item, price?: number) => ({ ...entry, prices: price ? [{ source: 'Прапор', price, mode: 'pvp', updatedAt: '' }] : [] }) as Item

const ITEMS = [
  item('alenka', 'Шоколад "Аленка"', 'Аленка'),
  item('medkit', 'Набор медикаментов', 'Мед.'),
  item('piranha', 'Патрон 12/70 "Пиранья"', 'Пиранья'),
  item('flechette', 'Патрон 12/70 "Флешетта"', 'Флешетта'),
  item('sv98-10', 'Магазин на 10 патронов 7.62x54R для СВ-98', 'СВ-98'),
  item('mosin-10', 'Магазин на 10 патронов 7.62x54R для винтовки Мосина', 'Мосин'),
  item('m14-20', 'Магазин на 20 патронов 7.62x51 для M14', 'M14'),
  item('akm-10', 'Магазин алюминиевый на 10 патронов 7.62x39 для АК', 'AK al.'),
  item('akm-30', 'Магазин алюминиевый на 30 патронов 7.62x39 для АК', 'AK al.'),
  item('pm-pistol', 'Пистолет Макарова ПМ 9x18ПМ', 'ПМ'),
  item('pm-mag', 'Магазин "90-93" на 8 патронов 9x18ПМ для Пистолета Макарова', 'ПМ'),
  item('dorm-220', 'Ключ от комнаты 220 общежития', 'Общ 220'),
  item('dorm-228', 'Ключ от комнаты 228 общежития', 'Общ 228'),
  item('bp-545', 'Пачка патронов 5.45x39мм БП гж (30 штук)', 'БП'),
  item('bp-556', 'Пачка патронов 5.56x45мм M855 (30 штук)', 'M855'),
  item('aks74un', 'Автомат Калашникова АКС-74УН 5.45x39', 'АКС-74УН'),
  item('aks74u', 'Автомат Калашникова АКС-74У 5.45x39', 'АКС-74У'),
  item('ledx', 'Трансиллюминатор кожи LEDX', 'LEDX'),
  item('pmag-20', 'Магазин Magpul "PMAG 20 GEN M3 STANAG" на 20 патронов 5.56x45', 'PMAG 20'),
  item('pmag-30', 'Магазин Magpul "PMAG 30 GEN M3 STANAG" на 30 патронов 5.56x45', 'PMAG 30'),
  item('rotor-43', 'Дульный тормоз-компенсатор Ротор 43 .366 ТКМ', 'Р43 .366ТКМ'),
  item('plate-3', 'Бронепластина Level III', 'Level III'),
  item('plate-4', 'Бронепластина Level IV', 'Level IV'),
]
const ENGLISH = new Map<string, ItemNameVariant[]>([
  ['sv98-10', [{ name: 'SV-98 7.62x54R 10-round magazine', shortName: 'SV-98' }]],
  ['m14-20', [{ name: 'M14 7.62x51 20-round magazine', shortName: 'M14' }]],
  ['ledx', [{ name: 'LEDX Skin Transilluminator', shortName: 'LEDX' }]],
  ['aks74un', [{ name: 'Kalashnikov AKS-74UN 5.45x39 assault rifle', shortName: 'AKS-74UN' }]],
])

describe('item from the game tooltip', () => {
  const match = createTooltipMatcher(ITEMS, ENGLISH)

  it('settles one name of different ids by the price, else gives no answer', () => {
    // Since the identity is the id, two ids with the very same name (the «… (120 штук)» ammo packs) used to give no
    // answer at all. The tooltip cannot tell them apart; the card is about the price, so the price decides.
    const pack = (id: string, price?: number) => priced(item(id, 'Пачка патронов 5.45x39мм БП гс (120 штук)', 'БП'), price)
    const name = 'Пачка патронов 5.45x39мм БП гс (120 штук)'
    // Nothing known about either: no answer rather than maybe the wrong one.
    expect(createTooltipMatcher([pack('one'), pack('two')])(name)).toBeNull()
    // Only one sells (flea or trader): that one — also when the name is read with slips.
    expect(createTooltipMatcher([pack('one'), pack('two', 900)])(name)?.id).toBe('two')
    expect(createTooltipMatcher([pack('one'), pack('two', 900)])('Пачка патр0нов 5. 45x39мм БП гс (120 штук)')?.id).toBe('two')
    // Both sell for the same: either card is right, the first one.
    expect(createTooltipMatcher([pack('one', 900), pack('two', 900)])(name)?.id).toBe('one')
    // Different prices: the card could show the wrong one.
    expect(createTooltipMatcher([pack('one', 900), pack('two', 1200)])(name)).toBeNull()
    // A short name several items share still names none of them, whatever they cost.
    expect(createTooltipMatcher([priced(item('a', 'Пистолет', 'Общий'), 5), priced(item('b', 'Магазин', 'Общий'), 5)])('Общий')).toBeNull()
  })

  it('picks among same-name items by the price', () => {
    const flea = (id: string, fleaPrice?: number) => ({ ...item(id, 'Предмет', 'П'), prices: [{ source: 'Базовая цена', price: 10, updatedAt: '' }], fleaPrice }) as Item
    expect(pickSameName([flea('a'), flea('b', 300)])?.id).toBe('b')
    expect(pickSameName([flea('a'), flea('b')])).toBeNull()
    expect(pickSameName([flea('a', 300), flea('b', 300), flea('c')])?.id).toBe('a')
    expect(pickSameName([flea('a', 300), flea('b', 301)])).toBeNull()
  })

  it('reads long names despite one stray digit-like character', () => {
    // A letter read as a digit adds a number the name does not have; long names hold many such letters.
    expect(match('Мага3ин на 10 патронов 7.62x54R для СВ-98')?.id).toBe('sv98-10')
    expect(match('Трансиллюминатор к0жи LEDX')?.id).toBe('ledx')
    expect(match('Kalashnikov AKS-74UN 5.45x39 assau1t rifle')?.id).toBe('aks74un')
    // A digit read as a letter loses one.
    expect(match('Магазин Magpul "PMAG 20 GEN MЗ STANAG" на 20 патронов 5.56x45')?.id).toBe('pmag-20')
    expect(match('Магазин Magpul "PMAG 30 GEN MЗ STANAG" на 30 патронов 5.56x45')?.id).toBe('pmag-30')
    // The stray digit does not blur the number that tells look-alike twins apart («0т»: 220, not 0220).
    expect(match('Ключ 0т комнаты 220 общежития')?.id).toBe('dorm-220')
  })

  it('joins a decimal number the OCR split, keeping calibres written with a leading point', () => {
    expect(match('Магазин на 10 патронов 7. 62x54R для СВ-98')?.id).toBe('sv98-10')
    expect(match('Kalashnikov AKS-74UN 5 .45x39 assault rifle')?.id).toBe('aks74un')
    expect(match('Пачка патронов 5, 45x39мм БП гж (30 штук)')?.id).toBe('bp-545')
    expect(match('Дульный тормоз-компенсатор Ротор 43 .366 ТКМ')?.id).toBe('rotor-43')
  })

  it('never answers the item whose number was read as another', () => {
    expect(match('Магазин на 70 патронов 7.62x54R для СВ-98')).toBeNull()
    expect(match('SV-98 7.62x54R 70-round magazine')).toBeNull()
    expect(match('Пачка патронов 5.56x39мм БП гж (30 штук)')).toBeNull()
    expect(match('Магазин алюминиевый на 20 патронов 7.62x39 для АК')).toBeNull()
    // A stray digit elsewhere in the line does not excuse a changed number.
    expect(match('Мага3ин на 70 патронов 7.62x54R для СВ-98')).toBeNull()
    expect(match('Магазин Magpul "PMAG 20 GEN M3 STANAG" на 30 патронов 5.56x45')).toBeNull()
  })

  it('tells Roman numerals apart, also when read as digits or other letters', () => {
    expect(match('Бронепластина Level III')?.id).toBe('plate-3')
    expect(match('Бронепластина Level IIl')?.id).toBe('plate-3')
    expect(match('Бронепластина Level lV')?.id).toBe('plate-4')
    // "IV" read as "1V": a number the name does not have is only a slip.
    expect(match('Бронепластина Level 1V')?.id).toBe('plate-4')
    // "III" read as "111" is as far from "IV" as from "III": no guess.
    expect(match('Бронепластина Level 111')).toBeNull()
  })

  it('ranks the likely items for the second attempt, best first, without a minimum score', () => {
    // «ПМ» names the pistol and its magazine: no answer, but both lead the candidates for the picture.
    expect(match('ПМ')).toBeNull()
    expect(match.rank('ПМ', 2).map((candidate) => candidate.item.id).sort()).toEqual(['pm-mag', 'pm-pistol'])
    // Too garbled to answer, yet the right item leads.
    const garbled = 'Мaгaзин нa 1 пaтpoнoв 7.62x5 для CB-9'
    expect(match(garbled)).toBeNull()
    const ranked = match.rank(garbled, 3)
    expect(ranked).toHaveLength(3)
    expect(ranked[0]!.item.id).toBe('sv98-10')
    expect(ranked.map((candidate) => candidate.score)).toEqual(ranked.map((candidate) => candidate.score).sort((a, b) => b - a))
    expect(new Set(ranked.map((candidate) => candidate.item.id)).size).toBe(3)
    expect(match.rank('', 8)).toEqual([])
    expect(match.rank('Магазин на 10 патронов 7.62x54R для СВ-98', 0)).toEqual([])
  })

  it('matches the whole name the tooltip shows, despite OCR slips', () => {
    expect(match('Шоколад "Аленка"')?.id).toBe('alenka')
    expect(match('Шоколaд «Алeнкa»')?.id).toBe('alenka')
    expect(match('Патрон 12/70 Пиранья')?.id).toBe('piranha')
    expect(match('| Набор медикаментов')?.id).toBe('medkit')
    expect(match('Трансиллюминатор кожи LEDХ')?.id).toBe('ledx')
  })

  it('reads English tooltips too (the game language need not be the app language)', () => {
    expect(match('SV-98 7.62x54R 10-round magazine')?.id).toBe('sv98-10')
    expect(match('LEDX Skin Transiluminator')?.id).toBe('ledx')
    expect(match('Kalashnikov AKS-74UN 5.45x39 assault rifle')?.id).toBe('aks74un')
  })

  it('never takes one magazine for another: the numbers must agree', () => {
    expect(match('Магазин на 10 патронов 7.62x54R для СВ-98')?.id).toBe('sv98-10')
    // A 10-round magazine is not the 20-round one, even with the rest of the line garbled.
    expect(match('Магазин на 10 патронов 7.62x51 для M14')).toBeNull()
    expect(match('Магазин алюминиевый на 10 патронов 7.62x39 для АК')?.id).toBe('akm-10')
    expect(match('Магазин алюминиевый на 30 патронов 7.62x39 для АК')?.id).toBe('akm-30')
    expect(match('Пачка патронов 5.45x39мм БП гж (30 штук)')?.id).toBe('bp-545')
  })

  it('forgives the digit slips of the game font but not a guess between twins', () => {
    // Square 0 read as 8/@, flat 3 as 5, dropped decimal point.
    expect(match('Магазин на 1@ патронов 762x54R для СВ-98')?.id).toBe('sv98-10')
    expect(match('Автомат Калашникова АКС-74УН 5.45х59')?.id).toBe('aks74un')
    // Room 220 and room 228 differ only in digits the OCR mixes up: no answer rather than maybe the wrong key.
    expect(match('Ключ от комнаты 228 общежития')).toBeNull()
    expect(match('Ключ от комнаты 220 общежития')?.id).toBe('dorm-220')
  })

  it('accepts a short name only whole and only when it names one item', () => {
    expect(match('Пиранья')?.id).toBe('piranha')
    expect(match('LEDX')?.id).toBe('ledx')
    // "ПМ" is the pistol and its magazine; "AK al." two magazines.
    expect(match('ПМ')).toBeNull()
    expect(match('AK al.')).toBeNull()
  })

  it('answers nothing rather than a wrong item', () => {
    expect(match('Рюкзак')).toBeNull()
    expect(match('Патрон')).toBeNull()
    expect(match('')).toBeNull()
    // One letter apart from two items: АКС-74У or АКС-74УН.
    expect(match('Автомат Калашникова АКС-74УМ 5.45x39')).toBeNull()
  })
})

describe('OCR text folding', () => {
  it('repairs look-alike letters inside numbers only', () => {
    expect(repairOcrNumbers('на 1О патронов')).toBe('на 10 патронов')
    expect(repairOcrNumbers('2o-round')).toBe('20-round')
    expect(repairOcrNumbers('Liberator HP 2.O')).toBe('Liberator HP 2.0')
    expect(repairOcrNumbers('Бронежилет 6Б43')).toBe('Бронежилет 6Б43')
    expect(repairOcrNumbers('M4A1')).toBe('M4A1')
  })

  it('folds Cyrillic and Latin look-alikes and keeps decimal points', () => {
    expect(foldName('Пачка 5,45х39мм')).toBe(foldName('Пaчкa 5.45x39мм'))
    expect(foldName('0.6л')).toContain('0.6')
    // The key a reading is remembered under: the same for the same reading, whatever the look-alikes.
    expect(foldTooltipText('Магазин на 1О патронов')).toBe(foldTooltipText('Мaгaзин  на 10 патронов'))
  })

  it('merges digits the game font makes look alike, on both sides the same way', () => {
    expect(looseDigits(foldName('SAS8 M-LOK'))).toBe(looseDigits(foldName('SA58 M-LOK')))
    expect(looseDigits(foldName('Бронежилет 662'))).toBe(looseDigits(foldName('Бронежилет 6Б2')))
    expect(looseDigits('10')).not.toBe(looseDigits('20'))
  })
})
