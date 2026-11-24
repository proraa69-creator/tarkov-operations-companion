/**
 * «Найти точку…» on the map finds keys and items by name (report 134, 10.11.2026: «добавьте пожалуйста в поиске место нахождение
 * ключей или еще каких то предметов например фигурки возможные места спавна и ключи что бы по поиску тебе показывало на каких
 * локациях есть ключ и место»): every key a spot may hold and every item of a loose loot spot, in Russian and English, not only
 * the point's title; and on which maps such points are.
 */
import type { MapMarker } from '../domain/types'

/** Item names by id: the catalog's name and, for the English app, its English one. */
export type ItemNames = (id: string) => readonly string[]

export const searchNeedle = (text: string) => text.trim().toLowerCase().replace(/ё/g, 'е')
const fold = (text: string) => text.toLowerCase().replace(/ё/g, 'е')

/** The keys and items a point may hold. */
export function pointItemIds(marker: Pick<MapMarker, 'keyIds' | 'itemId' | 'lootIds'>): string[] {
  return [...new Set([...(marker.keyIds ?? (marker.itemId ? [marker.itemId] : [])), ...(marker.lootIds ?? [])])]
}

/** One of the point's keys or items is called so. */
export function pointHoldsItem(marker: Pick<MapMarker, 'keyIds' | 'itemId' | 'lootIds'>, needle: string, names: ItemNames) {
  if (needle.length < 2) return false
  return pointItemIds(marker).some((id) => names(id).some((name) => fold(name).includes(needle)))
}

/** The point is what is searched for: its title or text, or one of its keys and items. */
export function pointMatchesSearch(marker: Pick<MapMarker, 'title' | 'description' | 'keyIds' | 'itemId' | 'lootIds'>, needle: string, names: ItemNames) {
  if (!needle) return true
  return fold(`${marker.title} ${marker.description}`).includes(needle) || pointHoldsItem(marker, needle, names)
}

/** The maps with points holding the item searched for, most first (three letters at least, so a word does not list every map). */
export function searchMapCounts(markers: readonly MapMarker[], needle: string, names: ItemNames): Array<{ mapId: string; count: number }> {
  if (needle.length < 3) return []
  const counts = new Map<string, number>()
  for (const marker of markers) {
    if (!marker.layerId?.startsWith('loot.')) continue
    if (pointHoldsItem(marker, needle, names)) counts.set(marker.mapId, (counts.get(marker.mapId) ?? 0) + 1)
  }
  return [...counts].map(([mapId, count]) => ({ mapId, count })).sort((a, b) => b.count - a.count)
}
