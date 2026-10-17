import silhouettes from './weaponSilhouettes.json'
import type { InstalledPart } from './buildModel'

/**
 * Where each part sits on the weapon picture (default build, tarkov.dev 512 px, muzzle on the left), for the callouts of
 * «Сборка оружия». No source gives part positions, so a part's slot kind names a place along the weapon (`SLOT_PLACES`:
 * share of the length, and its top, middle or bottom) and the picture's sampled outline (scripts/weapon-silhouettes.mjs)
 * puts the point on the metal. A part in a mount points where the mount is.
 */
type Edge = 'top' | 'middle' | 'bottom'
interface Place { x: number; edge: Edge; /** Search this share of the length either side for the lowest point (magazine, grip). */ spread?: number }

const SLOT_PLACES: Array<[RegExp, Place]> = [
  [/^mod_muzzle/, { x: 0.02, edge: 'middle' }],
  [/^mod_barrel/, { x: 0.12, edge: 'middle' }],
  [/^mod_gas_block/, { x: 0.22, edge: 'top' }],
  [/^mod_sight_front/, { x: 0.18, edge: 'top' }],
  [/^mod_handguard/, { x: 0.33, edge: 'middle' }],
  [/^mod_foregrip/, { x: 0.32, edge: 'bottom' }],
  [/^mod_launcher/, { x: 0.28, edge: 'bottom' }],
  [/^mod_bipod/, { x: 0.2, edge: 'bottom' }],
  [/^mod_tactical/, { x: 0.27, edge: 'middle' }],
  [/^mod_(scope|sight_rear)/, { x: 0.55, edge: 'top' }],
  [/^mod_mount/, { x: 0.45, edge: 'top' }],
  [/^mod_reciever/, { x: 0.55, edge: 'middle' }],
  [/^mod_charge/, { x: 0.7, edge: 'top' }],
  [/^mod_magazine/, { x: 0.5, edge: 'bottom', spread: 0.12 }],
  [/^mod_pistol_?grip/, { x: 0.7, edge: 'bottom', spread: 0.1 }],
  [/^mod_stock/, { x: 0.9, edge: 'middle' }],
]
const FALLBACK: Place = { x: 0.5, edge: 'middle' }

interface Silhouette { ratio: number; cols: number[][] }
const SHAPES = silhouettes as Record<string, Silhouette>

export interface Anchor {
  /** 0…1 of the picture width and height. */
  x: number
  y: number
  edge: Edge
}

/** The picture's aspect ratio (width / height) when its outline is known. */
export function pictureRatio(pictureId: string | undefined) {
  return pictureId ? SHAPES[pictureId]?.ratio : undefined
}

export function placeOf(slotId: string): Place {
  return SLOT_PLACES.find(([pattern]) => pattern.test(slotId))?.[1] ?? FALLBACK
}

/** The point of one part: the place of its own slot (a scope on a mount points at the top rail, a grip on a rail below). */
export function anchorOf(part: Pick<InstalledPart, 'path'>, pictureId: string | undefined): Anchor {
  const place = placeOf(part.path.at(-1) ?? '')
  const shape = pictureId ? SHAPES[pictureId] : undefined
  if (!shape) return { x: place.x, y: place.edge === 'top' ? 0.25 : place.edge === 'bottom' ? 0.75 : 0.5, edge: place.edge }
  const columns = shape.cols
  const filled = columns.map((col, index) => ({ col, index })).filter(({ col }) => col.length === 2)
  if (!filled.length) return { x: place.x, y: 0.5, edge: place.edge }
  // Along the weapon itself (the picture may have empty margins).
  const first = filled[0].index
  const last = filled[filled.length - 1].index
  const target = first + place.x * (last - first)
  let index = Math.round(target)
  if (place.spread) {
    const reach = Math.max(1, Math.round(place.spread * (last - first)))
    let best = -1
    for (let probe = Math.max(first, index - reach); probe <= Math.min(last, index + reach); probe++) {
      const col = columns[probe]
      if (col.length === 2 && col[1] > best) { best = col[1]; index = probe }
    }
  }
  while (columns[index]?.length !== 2 && index < last) index++
  const [top, bottom] = columns[index]
  const inset = Math.max(4, (bottom - top) * 0.18)
  const y = place.edge === 'top' ? top + inset : place.edge === 'bottom' ? bottom - inset : (top + bottom) / 2
  return { x: (index + 0.5) / columns.length, y: y / 255, edge: place.edge }
}

/** Russian name of a slot for the callout (the data has only codes like MOD_PISTOL_GRIP). */
const SLOT_NAMES: Array<[RegExp, string]> = [
  [/^mod_muzzle/, 'Дульное устройство'], [/^mod_barrel/, 'Ствол'], [/^mod_gas_block/, 'Газовый блок'], [/^mod_sight_front/, 'Мушка'],
  [/^mod_handguard/, 'Цевьё'], [/^mod_foregrip/, 'Тактическая рукоятка'], [/^mod_launcher/, 'Подствольник'], [/^mod_bipod/, 'Сошки'],
  [/^mod_tactical/, 'Тактическое устройство'], [/^mod_scope/, 'Прицел'], [/^mod_sight_rear/, 'Целик'], [/^mod_mount/, 'Крепление'],
  [/^mod_reciever/, 'Ствольная коробка'], [/^mod_charge/, 'Рукоятка взведения'], [/^mod_magazine/, 'Магазин'],
  [/^mod_pistol_?grip/, 'Пистолетная рукоятка'], [/^mod_stock/, 'Приклад'],
]

export function slotLabel(slotId: string) {
  return SLOT_NAMES.find(([pattern]) => pattern.test(slotId))?.[1] ?? 'Модуль'
}

/** Whether the picture's outline is known: only such weapons are listed (the callouts need it). */
export function hasOutline(pictureId: string) {
  return Boolean(SHAPES[pictureId])
}
