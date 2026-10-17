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
 * - manualObjectives: counting quest objectives by hand, notes and «История изменений». The tick itself is back for
 *   everyone (owner, 17.10.2026): an objective of a current quest is marked done in the quest window and in the quest
 *   card under the map (src/progression/mapObjectives.ts), synced to the player's other devices.
 * - weaponBuilds: «Сборка оружия» (/arsenal/builds): three builds per weapon. Waiting for the owner's approval of the
 *   preview (17.10.2026): only the development server opens it until then; then a «Арсенал» menu item.
 * - hideoutStash: «Убежище» (/hideout): the stash of items the hideout still needs, with «+» / «−». Waiting for the
 *   owner's approval of the screenshots (17.10.2026); shown in a development run.
 * - storyEndings: «Концовки» (src/endings/: the endings tab of the Quests page and the deciding-choice notes in the
 *   story chapters and the BTR Driver's tasks; owner, 12.10.2026: «если нужно будет удалим»). On for now.
 */
export const ARCHIVED = {
  raidBriefing: true,
  keepItems: true,
  raidRoute: true,
  economyTools: true,
  gunBuilder: true,
  weaponBuilds: true,
  hideoutStash: true,
  kappaMenu: true,
  manualObjectives: true,
  storyEndings: false,
} as const

export type ArchivedFeature = keyof typeof ARCHIVED

export const featureEnabled = (feature: ArchivedFeature) => !ARCHIVED[feature]
