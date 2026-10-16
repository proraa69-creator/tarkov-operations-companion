/**
 * The prestige levels of Escape from Tarkov (0.16.0.0: two, «eight more Prestige levels will be added» — ten in all; the
 * server takes 0–10, server/src/routes/me.ts). Each level's badge is drawn for this app (src/components/PrestigeIcon.tsx):
 * tarkov.dev's prestige images could not be fetched for our mirror (its API was unavailable), and the wiki is never
 * hot-linked.
 */
export const PRESTIGE_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
/** The levels «Престиж +» offers: the game's badges the owner sent (16.10.2026) go up to 6. */
export const PRESTIGE_CHOICES = [1, 2, 3, 4, 5, 6] as const
export const MAX_PRESTIGE = 10
/** The modes «Престиж +» asks between (owner, 16.10.2026: «при нажатии кнопки престиж появляется PVP или PVE»). */
export const PRESTIGE_MODES = ['pvp', 'pve'] as const

/** «Престиж N» / «Prestige N». */
export function prestigeLabel(level: number, locale: 'ru' | 'en' = 'ru') {
  return locale === 'en' ? `Prestige ${level}` : `Престиж ${level}`
}

