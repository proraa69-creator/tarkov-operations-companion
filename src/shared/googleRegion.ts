/**
 * «Войти через Google» is for every country but Russia (owner, 15.11.2026). The server cannot tell the country by the
 * address (raidos.app is not behind Cloudflare, no GeoIP), so the button stays hidden on a device set to a Russian time
 * zone, and the server refuses accounts of Russia and Russia as the country of a new account (POST /v1/accounts/google).
 */
const RUSSIAN_TIME_ZONES = new Set([
  'Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Simferopol', 'Europe/Kirov', 'Europe/Volgograd', 'Europe/Astrakhan', 'Europe/Saratov',
  'Europe/Ulyanovsk', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Barnaul', 'Asia/Tomsk',
  'Asia/Novokuznetsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Chita', 'Asia/Yakutsk', 'Asia/Khandyga', 'Asia/Vladivostok',
  'Asia/Ust-Nera', 'Asia/Magadan', 'Asia/Sakhalin', 'Asia/Srednekolymsk', 'Asia/Kamchatka', 'Asia/Anadyr', 'W-SU',
])

export function russianTimeZone(zone = currentZone()) {
  return RUSSIAN_TIME_ZONES.has(zone)
}

function currentZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '' } catch { return '' }
}

export const googleSignInOffered = (zone?: string) => !russianTimeZone(zone)
