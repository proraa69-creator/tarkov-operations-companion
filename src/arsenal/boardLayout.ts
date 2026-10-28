import type { SlotCell } from './buildModel'
import type { Build, BuildNode, GunCatalog, GunPart, GunSlot, Weapon } from './gunTypes'

/**
 * Where each slot sits around the weapon on the «Сборка оружия» board (owner, 17.10.2026, after db4tarkov FORGE): the
 * weapon in the middle; along the middle row, front to back, the muzzle, gas block, barrel, handguard and receiver to
 * its left and the stock tube to its right; sights, scopes and the charging handle above; magazine, pistol grip, stock,
 * foregrips and bipods below; tactical devices in their own row at the bottom. A part installed in a slot keeps its own
 * slots next to it (the same column), so a handguard with more mounts widens its column and pushes the others apart.
 */

export type Zone = 'top' | 'middle' | 'bottom' | 'rail'
export type SlotKind = 'muzzle' | 'gas' | 'barrel' | 'handguard' | 'receiver' | 'stock' | 'magazine' | 'grip' | 'charge'
  | 'sight' | 'scope' | 'mount' | 'foregrip' | 'bipod' | 'tactical' | 'launcher' | 'other'

export interface PlacedCell extends SlotCell {
  kind: SlotKind
  column: number
  zone: Zone
  /** Steps from the weapon (1 for the weapon's own slots). */
  depth: number
}

export interface BoardLayout {
  columns: number
  /** The weapon's own column in the middle row. */
  weaponColumn: number
  cells: PlacedCell[]
}

/** Middle-row columns, front (muzzle) to back (stock); the weapon sits at WEAPON_COLUMN. */
const MAIN_COLUMN: Partial<Record<SlotKind, number>> = { muzzle: 0, gas: 1, barrel: 2, handguard: 3, receiver: 4, stock: 6 }
export const WEAPON_COLUMN = 5
const COLUMNS = 8

export function slotKind(nameId: string): SlotKind {
  const id = nameId.toLowerCase()
  if (id.includes('muzzle')) return 'muzzle'
  if (id.includes('gas_block')) return 'gas'
  if (id.includes('barrel')) return 'barrel'
  if (id.includes('handguard')) return 'handguard'
  if (id.includes('reciever') || id.includes('receiver')) return 'receiver'
  if (id.includes('pistol_grip') || id.includes('pistolgrip')) return 'grip'
  if (id.includes('stock')) return 'stock'
  if (id.includes('magazine')) return 'magazine'
  if (id.includes('charge')) return 'charge'
  if (id.includes('scope')) return 'scope'
  if (id.includes('sight')) return 'sight'
  if (id.includes('foregrip')) return 'foregrip'
  if (id.includes('bipod')) return 'bipod'
  if (id.includes('tactical') || id.includes('flashlight')) return 'tactical'
  if (id.includes('launcher')) return 'launcher'
  if (id.includes('mount')) return 'mount'
  return 'other'
}

type PartLookup = Pick<GunCatalog, 'mods'>

const carriesGrip = (part: GunPart) => /foregrip|bipod/.test(part.category ?? '') || part.slots.some((own) => ['foregrip', 'bipod'].includes(slotKind(own.nameId)))

/**
 * A mount is drawn above the weapon when what goes on it carries optics, below when it carries grips. An installed part
 * decides by itself: a chassis or rail that takes a foregrip goes below (owner, 28.10.2026: «блок для крепления рукоятки
 * очутился наверху. Он должен быть внизу» — the СВД's mod_mount_001 mostly takes sight rails).
 */
function mountZone(slot: GunSlot, catalog: PartLookup, installed?: GunPart): 'top' | 'bottom' {
  if (installed) return carriesGrip(installed) ? 'bottom' : 'top'
  let optics = 0
  let grips = 0
  for (const id of slot.allowed) {
    const part = catalog.mods.get(id)
    if (!part) continue
    const kinds = part.slots.map((own) => slotKind(own.nameId))
    if (kinds.includes('scope') || kinds.includes('sight') || /scope|sight|optic|collimator|reflex/.test(part.category ?? '')) optics++
    if (kinds.includes('foregrip') || kinds.includes('bipod') || /foregrip|bipod/.test(part.category ?? '')) grips++
  }
  return grips > optics ? 'bottom' : 'top'
}

function zoneOf(kind: SlotKind, slot: GunSlot, catalog: PartLookup, installed?: GunPart): Exclude<Zone, 'middle'> {
  if (kind === 'scope' || kind === 'sight' || kind === 'charge') return 'top'
  if (kind === 'tactical') return 'rail'
  if (kind === 'mount') return mountZone(slot, catalog, installed)
  return 'bottom'
}

/** Columns of the weapon's own slots that are not on the middle row. */
function weaponChildColumn(kind: SlotKind) {
  if (kind === 'scope' || kind === 'sight' || kind === 'mount') return WEAPON_COLUMN - 1
  if (kind === 'charge') return WEAPON_COLUMN + 1
  return WEAPON_COLUMN
}

export function boardLayout(build: Build, weapon: Weapon, catalog: PartLookup): BoardLayout {
  const cells: PlacedCell[] = []
  const walk = (owner: GunPart, node: BuildNode, path: string[], depth: number, ownerColumn: number, ownerMain: boolean, ownerZone: Zone) => {
    for (const slot of owner.slots) {
      const child = node.children[slot.nameId]
      const part = child ? catalog.mods.get(child.itemId) : undefined
      const kind = slotKind(slot.nameId)
      const mainColumn = MAIN_COLUMN[kind]
      // The middle row: a front-to-back part on the weapon or on another middle-row part (a stock on the stock tube
      // goes below it instead).
      const isMain = mainColumn !== undefined && (depth === 1 || ownerMain) && !(kind === 'stock' && depth > 1)
      const column = isMain ? mainColumn! : depth === 1 ? weaponChildColumn(kind) : ownerColumn
      // Parts on a part above or below the weapon stay on that side (a scope on a top mount goes higher still); foregrips,
      // bipods and what carries them always go below, sights on a chassis below still above.
      const below = kind === 'foregrip' || kind === 'bipod' || (!!part && carriesGrip(part) && kind !== 'handguard')
      const zone: Zone = isMain ? 'middle' : below ? 'bottom' : (kind === 'scope' || kind === 'sight') && ownerZone === 'bottom' ? 'top' : !ownerMain && depth > 1 && ownerZone !== 'middle' && kind !== 'tactical' ? ownerZone : zoneOf(kind, slot, catalog, part)
      const cell: PlacedCell = { path: [...path, slot.nameId], slot, part, kind, column, zone, depth }
      cells.push(cell)
      if (part && child) walk(part, child, cell.path, depth + 1, column, isMain, zone)
    }
  }
  walk(weapon, build.root, [], 1, WEAPON_COLUMN, true, 'middle')
  return { columns: COLUMNS, weaponColumn: WEAPON_COLUMN, cells }
}

/**
 * The cells of one column and zone in drawing order. Above the weapon the deeper ones come first (they stack higher);
 * on the middle row the outer parts sit further from the weapon (a suppressor left of its adapter); below, the
 * weapon's own slots first.
 */
export function zoneCells(layout: BoardLayout, column: number, zone: Zone): PlacedCell[] {
  const list = layout.cells.filter((cell) => cell.column === column && cell.zone === zone)
  const order = new Map(layout.cells.map((cell, index) => [cell, index]))
  return list.sort((a, b) => {
    if (zone === 'top') return b.depth - a.depth || order.get(a)! - order.get(b)!
    if (zone === 'middle') return column < layout.weaponColumn ? b.depth - a.depth || order.get(a)! - order.get(b)! : a.depth - b.depth || order.get(a)! - order.get(b)!
    return a.depth - b.depth || order.get(a)! - order.get(b)!
  })
}

/**
 * Board density (owner, 17.10.2026: «ещё плотнее, как на сайте»): above and below the weapon a column's cells spread into
 * the free neighbouring columns of the same row instead of widening their own column, so the columns stay one cell wide
 * where they can. `counts` is the number of cells per column of one row; the result is each column's first grid column
 * and how many columns it spans.
 */
export function rowSpans(counts: number[]): Array<{ start: number; span: number } | undefined> {
  const taken = counts.map((count) => count > 0)
  return counts.map((count, column) => {
    if (!count) return undefined
    let start = column
    let end = column
    // Grow outward one free column at a time, right first, until there is room for every cell.
    while (end - start + 1 < count) {
      if (end + 1 < counts.length && !taken[end + 1]) taken[++end] = true
      else if (start - 1 >= 0 && !taken[start - 1]) taken[--start] = true
      else break
    }
    return { start, span: end - start + 1 }
  })
}
