import type { AppLanguage } from './languages'

/**
 * The app's language a player gets from his account's country until he picks one himself (owner, 25.11.2026: «Язык при
 * входе должен быть от страны аккаунта»). The game's language follows the app's (src/import/gameLanguageSync.ts), so this is
 * also the language the screen readers read the game in.
 */
const BY_COUNTRY: Record<string, AppLanguage> = {}
const put = (language: AppLanguage, codes: string[]) => { for (const code of codes) BY_COUNTRY[code] = language }

// The CIS and the Russian-speaking countries around it (src/shared/countries.ts CIS_COUNTRIES, Ukraine and Georgia too:
// Ukrainian was taken out and reads as Russian, owner 25.11.2026).
put('ru', ['RU', 'BY', 'KZ', 'KG', 'TJ', 'UZ', 'TM', 'AM', 'AZ', 'MD', 'UA', 'GE'])
put('de', ['DE', 'AT', 'CH', 'LI'])
put('ja', ['JP'])
put('zh', ['CN', 'TW', 'HK', 'MO', 'SG'])
put('pl', ['PL'])
put('es', ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR', 'GQ'])
put('pt', ['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL'])
put('fr', ['FR', 'BE', 'LU', 'MC', 'SN', 'CI', 'ML', 'BF', 'NE', 'GN', 'BJ', 'TG', 'CM', 'GA', 'CG', 'CD', 'MG', 'HT', 'RE', 'GP', 'MQ', 'GF', 'NC', 'PF', 'YT', 'PM', 'WF', 'BL', 'MF'])
put('ko', ['KR'])
put('tr', ['TR'])

/** The language of an account's country (ISO 3166-1 alpha-2); English for every other one, null without a country. */
export function countryLanguage(country: unknown): AppLanguage | null {
  if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country) || country.toUpperCase() === 'XX') return null
  return BY_COUNTRY[country.toUpperCase()] ?? 'en'
}
