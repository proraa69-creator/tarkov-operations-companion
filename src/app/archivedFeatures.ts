/**
 * Features taken out of the app for now but kept in the code (the owner turns them back on when needed, 04.10.2026):
 * set a flag to `false` and the menu item, the route and the buttons come back as they were.
 *
 * - raidBriefing: «Брифинг рейда» page (/briefing) and the briefing panel on the map.
 * - keepItems: «Что не продавать» page (/keep-items) and the red «НЕ ПРОДАВАТЬ» line of the in-raid item card
 *   (the card keeps «Каппа» and «MATE»). «Предметы для Каппы» (/kappa-items) stays.
 * - raidRoute: «Построить маршрут» on the overview and the route controls / layer / hint on the map.
 * - economyTools: «Рейтинг ценности», «Бартеры», «Крафты» (/economy/*); «Барахолка» and «Торговцы» stay.
 * - gunBuilder: «Сборщик оружия» (/arsenal/builder); «Баллистика» stays.
 * - kappaMenu: the «Предметы для Каппы» item of the desktop sidebar (the page stays, the overview links to it).
 */
export const ARCHIVED = {
  raidBriefing: true,
  keepItems: true,
  raidRoute: true,
  economyTools: true,
  gunBuilder: true,
  kappaMenu: true,
} as const

export type ArchivedFeature = keyof typeof ARCHIVED

export const featureEnabled = (feature: ArchivedFeature) => !ARCHIVED[feature]
