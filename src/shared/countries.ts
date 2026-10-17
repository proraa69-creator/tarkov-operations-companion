/**
 * The country a player names at registration (owner, 13.10.2026: «научись понимать из какого региона зарегистрировался
 * человек … при регистрации нужно указать страну»; «в админ панели, в разделе пользователи, разделение снг и Европа»).
 * Shared by the server (validation and the region filter of «Пользователи»: server/src/services/accountStore.ts,
 * adminStore.ts), the website (registration forms, the cabinet, the admin panel) and the apps (the account window).
 *
 * No Node or DOM specifics: the names come from Intl.DisplayNames where the runtime has it, otherwise the code is shown.
 */

/** Every officially assigned ISO 3166-1 alpha-2 code (249), A→Z. */
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
] as const

export type CountryCode = (typeof COUNTRY_CODES)[number]
/** «СНГ», «Европа» or «Другие страны»; the admin panel adds «Не указана» for accounts without a country. */
export type CountryRegion = 'cis' | 'europe' | 'other'
export const COUNTRY_REGIONS: readonly CountryRegion[] = ['cis', 'europe', 'other']

/**
 * «СНГ»: the members of the Commonwealth of Independent States, the associate member Turkmenistan included. A country
 * moves to another region by moving its code from one of these two lists to the other; a code in neither list is
 * «Другие страны».
 */
export const CIS_COUNTRIES: readonly CountryCode[] = ['RU', 'BY', 'KZ', 'KG', 'TJ', 'UZ', 'TM', 'AM', 'AZ', 'MD']

/**
 * «Европа»: Europe of the UN geoscheme (M49 region 150: Eastern, Northern, Southern and Western Europe, territories
 * included) plus Cyprus (an EU member the scheme counts as Western Asia), minus the CIS list above. So Ukraine is Europe,
 * while Georgia and Türkiye (Western Asia in the scheme) are «Другие страны».
 */
export const EUROPE_COUNTRIES: readonly CountryCode[] = [
  // Eastern Europe without RU, BY, MD
  'BG', 'CZ', 'HU', 'PL', 'RO', 'SK', 'UA',
  // Northern Europe
  'AX', 'DK', 'EE', 'FI', 'FO', 'GB', 'GG', 'IE', 'IM', 'IS', 'JE', 'LT', 'LV', 'NO', 'SE', 'SJ',
  // Southern Europe
  'AD', 'AL', 'BA', 'ES', 'GI', 'GR', 'HR', 'IT', 'ME', 'MK', 'MT', 'PT', 'RS', 'SI', 'SM', 'VA',
  // Western Europe
  'AT', 'BE', 'CH', 'DE', 'FR', 'LI', 'LU', 'MC', 'NL',
  // The EU member outside the scheme's Europe
  'CY',
]

const ASSIGNED: ReadonlySet<string> = new Set(COUNTRY_CODES)
const REGION_OF = new Map<string, CountryRegion>([
  ...CIS_COUNTRIES.map((code) => [code, 'cis'] as const),
  ...EUROPE_COUNTRIES.map((code) => [code, 'europe'] as const),
])

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === 'string' && ASSIGNED.has(value)
}

/** «kz » → «KZ» for an assigned code; anything else (empty, unknown, not a string) → undefined. */
export function normalizeCountry(value: unknown): CountryCode | undefined {
  if (typeof value !== 'string') return undefined
  const code = value.trim().toUpperCase()
  return isCountryCode(code) ? code : undefined
}

export function regionOf(code: string): CountryRegion {
  return REGION_OF.get(code.trim().toUpperCase()) ?? 'other'
}

/** The site and the apps speak Russian or English. */
export type CountryLocale = 'ru' | 'en'

export const REGION_LABELS: Record<CountryLocale, Record<CountryRegion, string>> = {
  ru: { cis: 'СНГ', europe: 'Европа', other: 'Другие страны' },
  en: { cis: 'CIS', europe: 'Europe', other: 'Other countries' },
}

const displayNames = new Map<string, Intl.DisplayNames | null>()

/** «Казахстан» / «Kazakhstan»; the code itself where the runtime has no country names. */
export function countryName(code: string, locale: CountryLocale): string {
  let names = displayNames.get(locale)
  if (names === undefined) {
    try {
      names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([locale], { type: 'region' }) : null
    } catch {
      names = null
    }
    displayNames.set(locale, names)
  }
  try {
    return names?.of(code) || code
  } catch {
    return code
  }
}

export interface CountryOption { code: CountryCode; name: string }
export interface CountryGroup { region: CountryRegion; label: string; countries: readonly CountryOption[] }

const groupCache = new Map<CountryLocale, readonly CountryGroup[]>()

/** The registration select: «СНГ», «Европа», «Другие страны», each sorted by the name in `locale`. */
export function countryGroups(locale: CountryLocale): readonly CountryGroup[] {
  const cached = groupCache.get(locale)
  if (cached) return cached
  const collator = new Intl.Collator(locale)
  const groups = COUNTRY_REGIONS.map((region) => ({
    region,
    label: REGION_LABELS[locale][region],
    countries: COUNTRY_CODES.filter((code) => regionOf(code) === region)
      .map((code) => ({ code, name: countryName(code, locale) }))
      .sort((a, b) => collator.compare(a.name, b.name)),
  }))
  groupCache.set(locale, groups)
  return groups
}

const optionCache = new Map<CountryLocale, readonly CountryOption[]>()

/**
 * Every country in one list, sorted by the name in `locale` (owner, 13.10.2026: «в регистрации не разделяй СНГ, Европу и
 * другие страны, просто общий список»). The regions stay for the admin panel.
 */
export function countryOptions(locale: CountryLocale): readonly CountryOption[] {
  const cached = optionCache.get(locale)
  if (cached) return cached
  const collator = new Intl.Collator(locale)
  const options = COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) => collator.compare(a.name, b.name))
  optionCache.set(locale, options)
  return options
}

/** Other names people type for a country (both languages): abbreviations, old and everyday names. */
export const COUNTRY_ALIASES: Partial<Record<CountryCode, readonly string[]>> = {
  RU: ['РФ', 'Российская Федерация', 'Russian Federation'],
  US: ['США', 'Америка', 'Соединённые Штаты Америки', 'USA', 'America', 'United States of America'],
  GB: ['Англия', 'Британия', 'Соединённое Королевство', 'Шотландия', 'Уэльс', 'UK', 'England', 'Britain', 'Great Britain', 'Scotland', 'Wales'],
  AE: ['Эмираты', 'Объединённые Арабские Эмираты', 'UAE', 'Emirates'],
  BY: ['Белоруссия', 'Belorussia'],
  KG: ['Кыргызстан', 'Kirghizia'],
  MD: ['Молдавия', 'Moldavia'],
  CZ: ['Чешская Республика', 'Czech Republic'],
  TR: ['Turkey'],
  KR: ['Южная Корея', 'Корея', 'Korea'],
  KP: ['Северная Корея'],
  NL: ['Голландия', 'Holland'],
  DE: ['ФРГ', 'Deutschland'],
  CN: ['КНР'],
  CI: ['Берег Слоновой Кости', 'Ivory Coast'],
  SZ: ['Свазиленд', 'Swaziland'],
  MK: ['Македония', 'Macedonia'],
  TL: ['East Timor'],
  CD: ['ДР Конго', 'DR Congo', 'DRC'],
  PS: ['Палестина', 'Palestine'],
  VA: ['Vatican'],
}

/** Letters only, in lower case, without accents and punctuation: «Кот-д’Ивуар» → «кот дивуар», «U.S.» → «us». */
function fold(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.'’ʼ`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** «Аландские о-ва» is found by «острова», «St. Kitts» by «Saint», «Bosnia & Herzegovina» by «and». */
const spelledOut = (name: string) => name.replace(/о-ва(?![а-яё])/gi, 'острова').replace(/о-в(?![а-яё])/gi, 'остров').replace(/\bSt\.\s/g, 'Saint ').replace(/\s&\s/g, ' and ')

interface SearchKey { spaced: string; compact: string }
const keyCache = new Map<CountryCode, readonly SearchKey[]>()

function searchKeys(code: CountryCode): readonly SearchKey[] {
  const cached = keyCache.get(code)
  if (cached) return cached
  const names = [countryName(code, 'ru'), countryName(code, 'en'), ...(COUNTRY_ALIASES[code] ?? [])]
  const keys: SearchKey[] = []
  for (const name of names) {
    for (const variant of new Set([name, spelledOut(name)])) {
      const spaced = fold(variant)
      if (spaced && !keys.some((key) => key.spaced === spaced)) keys.push({ spaced, compact: spaced.replace(/ /g, '') })
    }
  }
  keyCache.set(code, keys)
  return keys
}

/**
 * The countries matching what the player typed (owner, 13.10.2026: «при нажатии выбора страны окно с ручным вводом»):
 * by the name in Russian or English, the ISO code («kz»), or a common other name («США», «UAE»), in any letter case,
 * with or without accents, spaces and hyphens. The best matches first: the code or a whole name, then names that start
 * with it, then names with a word that starts with it, then names that contain it; each group sorted by name.
 */
export function searchCountries(query: string, locale: CountryLocale): readonly CountryOption[] {
  const spaced = fold(query)
  if (!spaced) return countryOptions(locale)
  const compact = spaced.replace(/ /g, '')
  const upper = query.trim().toUpperCase()
  const ranked: Array<{ option: CountryOption; rank: number }> = []
  for (const option of countryOptions(locale)) {
    let rank = Infinity
    if (upper === option.code) rank = 0
    for (const key of searchKeys(option.code)) {
      if (key.compact === compact) rank = Math.min(rank, 0)
      else if (key.compact.startsWith(compact)) rank = Math.min(rank, 1)
      else if (` ${key.spaced}`.includes(` ${spaced}`)) rank = Math.min(rank, 2)
      else if (compact.length >= 2 && key.compact.includes(compact)) rank = Math.min(rank, 3)
    }
    if (rank < Infinity) ranked.push({ option, rank })
  }
  // countryOptions is already sorted by name: a stable sort by rank keeps that order inside each group.
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.option)
}

/**
 * «Моей страны нет в списке — ввести вручную» (owner, 15.10.2026: «проконтролируй что бы они смогли выбрать страну и что
 * бы был выбор вручную написать»): a country typed by hand is stored as this code, with the typed text next to it
 * (accounts.country_other on the server). Not an assigned ISO code (ISO 3166-1 leaves XX to users), so every region
 * filter counts it as «Другие» (regionOf) and nothing mistakes it for a real country.
 */
export const MANUAL_COUNTRY_CODE = 'XX'
/** The longest country typed by hand, after cleaning. */
export const MANUAL_COUNTRY_MAX = 60
/** Letters of any alphabet, spaces and hyphens; starts and ends with a letter. */
const MANUAL_COUNTRY_PATTERN = /^\p{L}(?:[\p{L} -]*\p{L})?$/u

/**
 * A country typed by hand as stored: trimmed, inner runs of spaces made one, «‐ – —» read as «-». undefined when it is
 * empty, longer than MANUAL_COUNTRY_MAX or has anything but letters, spaces and hyphens.
 */
export function cleanManualCountry(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.normalize('NFC').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim()
  if (!text || text.length > MANUAL_COUNTRY_MAX || !MANUAL_COUNTRY_PATTERN.test(text)) return undefined
  return text
}

/**
 * The listed country a typed name means: the whole name in Russian or English or a common other name («Казахстан»,
 * «kazakhstan», «США», «UK»), in any letter case and with or without accents, or the two-letter code itself. Only an exact
 * match: «Казах» is no country. undefined when nothing matches.
 */
export function countryByName(text: string): CountryCode | undefined {
  const spaced = fold(text)
  if (!spaced) return undefined
  const code = text.trim().toUpperCase()
  if (code.length === 2 && isCountryCode(code)) return code
  const compact = spaced.replace(/ /g, '')
  return COUNTRY_CODES.find((candidate) => searchKeys(candidate).some((key) => key.compact === compact))
}
