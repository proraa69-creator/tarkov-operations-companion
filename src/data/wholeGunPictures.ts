import type { Item, MapMarker } from '../domain/types'

/**
 * A weapon's picture is the whole gun, on every screen (owner, 02.11.2026: «показывай всегда полностью оружие, а не его кусок»;
 * 06.11.2026: «Должно быть всегда цельное оружие»). The base item's own icon is a bare part, a receiver for an M4A1. The catalog
 * knows the gun's default build (`presetImageUrl`, data/catalogSource.ts), and that build's icon is the small picture without the
 * English name a grid picture has drawn on it; a gun with no such row keeps the build's big picture. A gun with no default
 * build (a flare gun) is whole as it is. Done before anything copies an `iconUrl` out of the catalog.
 */
const PRESET_ID = /([a-z0-9]{16,48})-(?:grid|512|icon|base)/
const PLACEHOLDER = /\/unknown-item-/i
const real = (url: string | undefined) => (url && !PLACEHOLDER.test(url) ? url : undefined)

export function wholeGunIcon(item: Item, byId: ReadonlyMap<string, Item>) {
  if (!item.types?.includes('gun') || !real(item.presetImageUrl)) return item.iconUrl
  const presetId = PRESET_ID.exec(item.presetImageUrl!)?.[1]
  const preset = presetId && presetId !== item.id ? byId.get(presetId) : undefined
  return real(preset?.iconUrl) ?? item.presetImageUrl
}

/** The boss gear on the map's tooltip was drawn from the same bare icons when the catalog was built: same address, same swap. */
function withWholeBossGear(markers: MapMarker[], swapped: ReadonlyMap<string, string>) {
  if (!swapped.size) return markers
  let changed = false
  const next = markers.map((marker) => {
    const gear = marker.boss?.gear
    if (!gear?.some((entry) => entry.iconUrl && swapped.has(entry.iconUrl))) return marker
    changed = true
    return { ...marker, boss: { ...marker.boss!, gear: gear.map((entry) => (entry.iconUrl && swapped.has(entry.iconUrl) ? { ...entry, iconUrl: swapped.get(entry.iconUrl)! } : entry)) } }
  })
  return changed ? next : markers
}

/** The catalog with its guns' icons whole (the same object when there is nothing to do). */
export function withWholeGunPictures<T extends { items: Item[]; markers?: MapMarker[] }>(data: T): T {
  const byId = new Map(data.items.map((item) => [item.id, item]))
  const swapped = new Map<string, string>()
  const items = data.items.map((item) => {
    const whole = wholeGunIcon(item, byId)
    if (!whole || whole === item.iconUrl) return item
    if (item.iconUrl) swapped.set(item.iconUrl, whole)
    return { ...item, iconUrl: whole }
  })
  if (!swapped.size && items.every((item, index) => item === data.items[index])) return data
  return { ...data, items, ...(data.markers ? { markers: withWholeBossGear(data.markers, swapped) } : {}) }
}
