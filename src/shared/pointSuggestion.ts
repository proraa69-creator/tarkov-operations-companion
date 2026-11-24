/**
 * «Ваши предложения» → «Добавить точку» (owner, 10.11.2026: «Сделай пользователям функцию добавления точки… появляется
 * список 4 ряда всех иконок, которые есть на карте… Блоки, выходы и переходы, потом задания, ключи и предметы… он может
 * просто написать название, выбрать картинку по этому названию… приложить скриншот, на котором есть координаты. По этим
 * координатам будет добавляться точка… За каждую точку дается 1 бонус. При условии, что этой точки нет на карте»).
 *
 * Shared by the app (src/components/SuggestPointSection.tsx), the owner's table (src/reports/ReportsTable.tsx) and the
 * server (server/src/routes/bugReports.ts), so an app never sends what the server would refuse.
 *
 * The place of the point is never typed in: the game writes the camera position into the name of every screenshot it
 * takes (src/overlay/screenshotPosition.ts), and both the app and the server read it from there.
 */
import type { QuestPointIcon } from './questPointConstructor.js'

export type PointSuggestionBlockId = 'exits' | 'quests' | 'keys' | 'items'

export interface PointSuggestionBlock {
  id: PointSuggestionBlockId
  title: string
  icons: readonly QuestPointIcon[]
  /** Two points of one emblem closer than this are the same point (game metres). */
  sameWithin: number
}

/** The four rows, in the owner's order. Locked doors and «Нужные ключи» are not offered (owner: «двери не надо»). */
export const POINT_SUGGESTION_BLOCKS: readonly PointSuggestionBlock[] = [
  { id: 'exits', title: 'Выходы и переходы', icons: ['extract.pmc', 'extract.scav', 'extract.coop', 'transit', 'switch'], sameWithin: 25 },
  { id: 'quests', title: 'Задания', icons: ['quest.zone', 'quest.item'], sameWithin: 10 },
  { id: 'keys', title: 'Ключи', icons: ['loot.key'], sameWithin: 3 },
  {
    id: 'items',
    title: 'Предметы',
    icons: ['loot.container', 'loot.guaranteed', 'loot.valuable', 'loot.weapon', 'loot.medical', 'loot.provision', 'loot.technical', 'loot.documents'],
    sameWithin: 3,
  },
]

export const POINT_SUGGESTION_ICONS = POINT_SUGGESTION_BLOCKS.flatMap((block) => [...block.icons]) as [QuestPointIcon, ...QuestPointIcon[]]

/** What each emblem is called in the rows and in the owner's table (the map's own names, src/pages/MapsPage.tsx). */
export const POINT_SUGGESTION_ICON_LABELS: Partial<Record<QuestPointIcon, string>> = {
  'extract.pmc': 'Выход ЧВК',
  'extract.scav': 'Выход дикого',
  'extract.coop': 'Совместный выход',
  transit: 'Переход',
  switch: 'Рубильник',
  'quest.zone': 'Квест',
  'quest.item': 'Квестовый предмет',
  'loot.key': 'Ключ',
  'loot.container': 'Контейнер',
  'loot.guaranteed': 'Спавн 100 %',
  'loot.valuable': 'Драгоценности',
  'loot.weapon': 'Станковое оружие',
  'loot.medical': 'Медицина',
  'loot.provision': 'Провизия',
  'loot.technical': 'Технический лут',
  'loot.documents': 'Документы',
}

export const pointSuggestionLabel = (icon: QuestPointIcon) => POINT_SUGGESTION_ICON_LABELS[icon] ?? icon
export const pointSuggestionBlock = (icon: QuestPointIcon) => POINT_SUGGESTION_BLOCKS.find((block) => block.icons.includes(icon))

/** What must be chosen from the lists for a point of this emblem: the quest of a quest point, the key itself for a key. */
export const pointSuggestionNeeds = (icon: QuestPointIcon): 'quest' | 'item' | undefined => (icon === 'quest.zone' || icon === 'quest.item' ? 'quest' : icon === 'loot.key' ? 'item' : undefined)

export const POINT_SUGGESTION_NAME_MAX = 80
/** The name of the screenshot file as the game wrote it. */
export const POINT_SUGGESTION_SHOT_MAX = 200
/** Subscription days for a point the owner accepts («За каждую точку дается 1 бонус»). */
export const POINT_SUGGESTION_REWARD_DAYS = 1

/** What the player sends with the report (`suggest` of POST /v1/bug-reports). The server reads the place from `shot`. */
export interface PointSuggestionInput {
  icon: QuestPointIcon
  name: string
  mapId: string
  /** The map's floor name under the point, when the map has floors. */
  floor?: string
  /** The catalog item the point is about (a key, an item). */
  itemId?: string
  /** The quest of a quest point. */
  questId?: string
  mode?: 'pvp' | 'pve' | 'seasonal'
  /** The screenshot's file name, with the coordinates the game wrote into it. */
  shot: string
}

/** A suggestion as the server keeps it: the place read from the screenshot's name, and the point it became. */
export interface PointSuggestion extends PointSuggestionInput {
  x: number
  /** Height (the game's Y). */
  y: number
  z: number
  /** The map point made of it once the owner accepted it. */
  pointId?: string
}

export interface PlacedPoint {
  icon?: string
  mapId: string
  x: number
  z: number
  questId?: string
  itemIds?: readonly string[]
}

/**
 * The point that already stands where a new one is proposed: the same emblem on the same map within the block's
 * distance. Quest points only count for the same quest; item and key points only when they are about the same item (or
 * either side names none).
 */
export function samePlacedPoint<T extends PlacedPoint>(suggestion: Pick<PointSuggestion, 'icon' | 'mapId' | 'x' | 'z' | 'questId' | 'itemId'>, placed: readonly T[]): T | undefined {
  const within = pointSuggestionBlock(suggestion.icon)?.sameWithin ?? 3
  return placed.find((point) => {
    if (point.icon !== suggestion.icon || point.mapId !== suggestion.mapId) return false
    if (Math.hypot(point.x - suggestion.x, point.z - suggestion.z) > within) return false
    if (suggestion.questId || point.questId) return suggestion.questId === point.questId
    if (suggestion.itemId && point.itemIds?.length) return point.itemIds.includes(suggestion.itemId)
    return true
  })
}

/** «Точка: Ключ — …», the report's topic (at most the topic's 120 characters). */
export const pointSuggestionTopic = (icon: QuestPointIcon, name: string) => `Точка: ${pointSuggestionLabel(icon)} — ${name}`.slice(0, 120)
