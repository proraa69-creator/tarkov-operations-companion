import type { Item } from '../domain/types'

/**
 * Items tarkov.dev has no picture of (its icon is the «unknown item» placeholder, its other addresses answer 404): the game's
 * own picture kept with the app (owner, 05.11.2026: «Найди эти фигурки в интернете и добавь к нам»). From the official wiki,
 * uploaded there 01.11.2026: File:Black Division Operator figurine image.png, File:Black Division Team Leader figurine image.png,
 * File:Wedge figurine image.png. Their inspect pictures, because the wiki's icons have an English label drawn on them.
 */
export const LOCAL_ITEM_PICTURES: ReadonlySet<string> = new Set([
  '6ad9cd192b8132e9720f993a', // Black Division Operator figurine
  '6ad9cce9e1f879d17605ca33', // Black Division Team Leader figurine
  '6ad9cf0b5394c084310cac90', // Wedge figurine
])

export function localItemPicture(id: string) {
  return LOCAL_ITEM_PICTURES.has(id) ? `${import.meta.env.BASE_URL}item-pictures/${id}.webp` : undefined
}

const PLACEHOLDER = /\/unknown-item-/i

/** A catalog with these items' placeholder icon replaced, for every page that shows `iconUrl` (the same object when there is nothing to do). */
export function withLocalItemPictures<T extends { items: Item[] }>(data: T): T {
  const stands = (item: Item) => LOCAL_ITEM_PICTURES.has(item.id) && (!item.iconUrl || PLACEHOLDER.test(item.iconUrl))
  if (!data.items.some(stands)) return data
  return { ...data, items: data.items.map((item) => stands(item) ? { ...item, iconUrl: localItemPicture(item.id) } : item) }
}
