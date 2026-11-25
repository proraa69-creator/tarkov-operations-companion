import type { AppLanguage } from '../i18n/languages'
import type { GameLanguage } from './gameLanguage'
import { noteGameLanguage } from '../data/gameNamesLoader'

/**
 * The game's language is the app's (owner, 25.11.2026: «какой язык приложения, такой язык игры … Не нужно показывать эту
 * настройку»): the screen readers read the game in the language the player picked for the app — or got from his account's
 * country (src/i18n/LocaleProvider.tsx). The PC's main process keeps it in its settings (`gameLanguage`,
 * electron/experimental/settings.ts) for the readers that run there; it is written only when it differs.
 */
export function gameLanguageOfApp(language: AppLanguage): GameLanguage {
  return language
}

export async function syncGameLanguage(language: AppLanguage, api = typeof window === 'undefined' ? undefined : window.tarkovDesktop?.experimental) {
  const game = gameLanguageOfApp(language)
  // Its names (German, Japanese, Chinese…) load at once for the Tasks table and the item card (src/data/gameNamesLoader.ts).
  noteGameLanguage(game)
  if (!api) return
  const settings = await api.getSettings().catch(() => null)
  if (settings?.gameLanguage === game) return
  await api.updateSettings({ gameLanguage: game }).catch(() => undefined)
}
