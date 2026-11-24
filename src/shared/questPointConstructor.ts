/**
 * The quest constructor's point settings shared by the server (server/src/routes/questPoints.ts,
 * server/src/services/questPointPhotoStore.ts) and the apps (src/data/questPointOverrides.ts,
 * src/components/PointConstructor.tsx), so an app never sends what the server would refuse (owner, 16.10.2026: «можно
 * выбрать любую эмблему для обозначения … возможность добавить предмет из каталога или фотографию для понимания где
 * искать»).
 */

/**
 * Emblems a point the owner places may carry: the map's own marker layers (src/assets/markerImages.ts), so the point
 * looks like the map's other points of that kind and follows the layer switches. Spawns are not offered (04.10.2026).
 */
export const QUEST_POINT_ICONS = [
  'quest.zone', 'quest.item', 'extract.pmc', 'extract.scav', 'extract.coop', 'transit', 'key', 'boss', 'hazard',
  'loot.valuable', 'loot.weapon', 'loot.medical', 'loot.provision', 'loot.technical', 'loot.container', 'loot.documents', 'landmark',
  // «Редактор карты» (owner, 10.11.2026: «добавлять вручную спавны любых предметов … выбираю из каталога картинку маркера»).
  'loot.key', 'loot.guaranteed', 'switch', 'btr',
] as const
export type QuestPointIcon = typeof QUEST_POINT_ICONS[number]
export const isQuestPointIcon = (value: unknown): value is QuestPointIcon => typeof value === 'string' && (QUEST_POINT_ICONS as readonly string[]).includes(value)
/** The emblems of a quest point: a point with one of them belongs to a quest. */
export const isQuestIcon = (icon: QuestPointIcon | undefined) => icon === 'quest.zone' || icon === 'quest.item'

/**
 * Photos of a point («где искать», the owner's screenshot): PNG / JPEG / WEBP checked by their first bytes on the server,
 * at most `fileBytes` each (the app scales a larger picture down to `side` first, src/notices/imageResize.ts), at most
 * `perPoint` on one point. Items from the catalog: at most `itemsPerPoint`.
 */
export const QUEST_POINT_PHOTO_LIMITS = { perPoint: 4, fileBytes: 5 * 1024 * 1024, side: 1920 } as const
export const QUEST_POINT_ITEMS_MAX = 6
/**
 * «Требования рейда» of a point (owner, 10.11.2026: «добавляю название + требования рейда (предмет) условия»): catalog
 * items needed to get there / to take it (a key, a tool…), at most `QUEST_POINT_ITEMS_MAX`, and a short condition
 * («только ночью», «после выключения света»), RU and optionally EN.
 */
export const QUEST_POINT_CONDITIONS_MAX = 300
/** A stored photo's id (random, 24 hex). */
export const QUEST_POINT_PHOTO_ID = /^[a-f0-9]{24}$/
/** A catalog item id (tarkov.dev, 24 hex). */
export const QUEST_POINT_ITEM_ID = /^[a-f0-9]{24}$/
