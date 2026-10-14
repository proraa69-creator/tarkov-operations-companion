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
