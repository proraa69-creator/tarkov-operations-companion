/**
 * «Сообщить об ошибке» categories (owner, 13.10.2026: «там должна быть категория бага, типо квест, функция итд придумай
 * по всем где может быть проблема»), shared by the app's report window (src/components/SupportButtons.tsx) and the
 * server's validation and statistics (server/src/services/bugReportStore.ts).
 */
export const REPORT_CATEGORIES = [
  'quest', 'map', 'minimap', 'progress', 'kappa', 'item-info', 'bosses', 'traders', 'flea', 'hideout', 'gunsmith',
  'ballistics', 'squad', 'account', 'subscription', 'update', 'performance', 'interface', 'other',
] as const
export type ReportCategory = typeof REPORT_CATEGORIES[number]

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  quest: 'Квест: точка, описание, условия',
  map: 'Карта и метки',
  // The key stays for the reports saved before; the in-game minimap went on 15.10.2026.
  minimap: 'Местоположение на карте',
  progress: 'Прогресс и синхронизация с игрой',
  kappa: 'Каппа и сбор предметов',
  'item-info': 'Информация о предмете в рейде',
  bosses: 'Боссы',
  traders: 'Торговцы',
  flea: 'Барахолка и цены',
  hideout: 'Убежище',
  gunsmith: 'Оружейник и сборки',
  ballistics: 'Баллистика и патроны',
  squad: 'Отряд и друзья',
  account: 'Аккаунт и вход',
  subscription: 'Подписка и оплата',
  update: 'Обновление приложения',
  performance: 'Скорость и зависания',
  interface: 'Интерфейс и перевод',
  other: 'Другое',
}

/** What is wrong with a quest (the «Квест» category). The server takes them all: an app of 0.6.0.234 may still send «extra-point». */
export const QUEST_ISSUES = ['wrong-point', 'missing-point', 'extra-point', 'wrong-text', 'changed', 'other'] as const
export type QuestIssue = typeof QUEST_ISSUES[number]
/** What the report window offers (owner, 04.11.2026: «точка изменилась, не хватает точки. И все, два пункта будет»). */
export const QUEST_ISSUES_OFFERED: readonly QuestIssue[] = ['wrong-point', 'missing-point', 'wrong-text', 'changed', 'other']

export const QUEST_ISSUE_LABELS: Record<QuestIssue, string> = {
  // Owner, 04.11.2026: «либо это дополнительная точка, либо точка изменилась, либо не хватает точки».
  'wrong-point': 'Точка изменилась',
  'missing-point': 'Не хватает точки',
  'extra-point': 'Дополнительная точка',
  'wrong-text': 'Неверное описание или цель',
  changed: 'Квест изменился в игре',
  other: 'Другое',
}

/** The game mode the player saw it in (quests can differ between PvP, PvE and Season). */
export const REPORT_MODES = ['pvp', 'pve', 'seasonal'] as const
export type ReportMode = typeof REPORT_MODES[number]

/**
 * Players' points «сходятся» (owner: «если она сходится 2-3-4 раза значит буду в ручную менять») when they are for the
 * same quest on the same map within this many game metres of each other.
 */
export const MATCH_RADIUS_M = 15
/** From this many agreeing players a request is marked as confirmed for the owner. */
export const MATCHES_CONFIRMED = 2
