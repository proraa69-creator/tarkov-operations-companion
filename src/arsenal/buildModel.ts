import type { Build, BuildNode, GunCatalog, GunPart, GunSlot, Weapon } from './gunTypes'

/** Installed item with the path of slot nameIds that leads to it from the weapon. */
export interface InstalledPart {
  path: string[]
  part: GunPart
}

export const emptyNode = (itemId: string): BuildNode => ({ itemId, children: {} })

export function emptyBuild(weapon: Weapon): Build {
  return { weaponId: weapon.id, root: emptyNode(weapon.id), ammoId: weapon.defaultAmmoId }
}

type PartLookup = Pick<GunCatalog, 'mods'>

/**
 * The default preset lists its items flat (containsItems). Rebuilds the tree: every slot, depth-first, takes the first
 * preset item it allows that is still unplaced. Items that fit nowhere are dropped (returned for diagnostics).
 */
export function presetBuild(weapon: Weapon, catalog: PartLookup): { build: Build; unplaced: string[] } {
  const pool = [...(weapon.defaultPreset?.itemIds ?? [])]
  const fill = (part: GunPart, node: BuildNode) => {
    for (const slot of part.slots) {
      const index = pool.findIndex((id) => slot.allowed.includes(id) && catalog.mods.has(id))
      if (index < 0) continue
      const [itemId] = pool.splice(index, 1)
      const child = emptyNode(itemId)
      node.children[slot.nameId] = child
      fill(catalog.mods.get(itemId)!, child)
    }
  }
  const root = emptyNode(weapon.id)
  fill(weapon, root)
  return { build: { weaponId: weapon.id, root, ammoId: weapon.defaultAmmoId }, unplaced: pool }
}

/** All installed mods (the weapon itself excluded), depth-first. */
export function installedParts(build: Build, catalog: PartLookup): InstalledPart[] {
  const out: InstalledPart[] = []
  const walk = (node: BuildNode, path: string[]) => {
    for (const [slotId, child] of Object.entries(node.children)) {
      const part = catalog.mods.get(child.itemId)
      if (!part) continue
      const childPath = [...path, slotId]
      out.push({ path: childPath, part })
      walk(child, childPath)
    }
  }
  walk(build.root, [])
  return out
}

export function nodeAt(build: Build, path: string[]): BuildNode | undefined {
  let node: BuildNode | undefined = build.root
  for (const slotId of path) node = node?.children[slotId]
  return node
}

function idsUnder(node: BuildNode | undefined, out = new Set<string>()) {
  if (!node) return out
  for (const child of Object.values(node.children)) {
    out.add(child.itemId)
    idsUnder(child, out)
  }
  return out
}

export type Compatibility = { ok: true } | { ok: false; reason: 'not-allowed' | 'conflict' | 'slot-blocked' | 'unknown'; conflictWith?: string }

/** Installed items with the slot each sits in (slot ids of the root's own slots need `root`), depth-first. */
export function occupiedSlots(build: Build, catalog: PartLookup, root?: GunPart): Array<{ path: string[]; slotId?: string; part: GunPart }> {
  const out: Array<{ path: string[]; slotId?: string; part: GunPart }> = []
  const walk = (owner: GunPart | undefined, node: BuildNode, path: string[]) => {
    for (const [nameId, child] of Object.entries(node.children)) {
      const part = catalog.mods.get(child.itemId)
      if (!part) continue
      const childPath = [...path, nameId]
      out.push({ path: childPath, slotId: owner?.slots.find((slot) => slot.nameId === nameId)?.id, part })
      walk(part, child, childPath)
    }
  }
  walk(root, build.root, [])
  return out
}

const shares = (a: string[] | undefined, b: string[] | undefined) => Boolean(a?.length && b?.length && a.some((id) => b.includes(id)))
const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index])
const under = (path: string[], prefix: string[]) => path.length >= prefix.length && prefix.every((id, index) => id === path[index])

/**
 * Whether `candidateId` may go into `slot` at `path` (the slot's own path, ending with its nameId) — the game's rules
 * as tarkov.dev carries them (owner, 17.10.2026: «какие и куда подходят, а куда не подходят»):
 * - the slot's filters.allowedItems lists it;
 * - no other installed item conflicts with it in either direction: conflictingItems, or conflictingCategories against
 *   the other item's categories;
 * - conflictingSlotIds: no installed item asks this slot to stay empty, and the candidate does not ask that of a slot
 *   that is occupied.
 * The item currently in that slot, and everything inside it, is being replaced and does not count. `root` (the
 * weapon) lets the weapon's own slots be checked against conflictingSlotIds.
 */
export function canInstall(build: Build, path: string[], slot: GunSlot, candidateId: string, catalog: PartLookup, root?: GunPart): Compatibility {
  const candidate = catalog.mods.get(candidateId)
  if (!candidate) return { ok: false, reason: 'unknown' }
  if (!slot.allowed.includes(candidateId)) return { ok: false, reason: 'not-allowed' }
  const staying = occupiedSlots(build, catalog, root).filter((entry) => !under(entry.path, path))
  for (const { part } of staying) {
    if (part.conflicts.includes(candidateId) || candidate.conflicts.includes(part.id)
      || shares(part.conflictCategories, candidate.categoryIds) || shares(candidate.conflictCategories, part.categoryIds)) {
      return { ok: false, reason: 'conflict', conflictWith: part.id }
    }
  }
  for (const entry of staying) {
    if (blocksSlot(entry.part, slot.id) || (entry.slotId && !samePath(entry.path, path) && blocksSlot(candidate, entry.slotId))) {
      return { ok: false, reason: 'slot-blocked', conflictWith: entry.part.id }
    }
  }
  return { ok: true }
}

function blocksSlot(part: GunPart, slotId: string) {
  return Boolean(slotId && part.conflictSlotIds?.includes(slotId))
}

const clone = (node: BuildNode): BuildNode => ({ itemId: node.itemId, children: Object.fromEntries(Object.entries(node.children).map(([key, child]) => [key, clone(child)])) })

/**
 * Puts `itemId` into the slot at `path` (immutable). Children of the replaced item move over when the new item has
 * a slot with the same nameId that allows them (e.g. a muzzle device stays when the barrel changes).
 */
export function installPart(build: Build, path: string[], itemId: string, catalog: PartLookup): Build {
  const next: Build = { ...build, root: clone(build.root) }
  const parent = nodeAt(next, path.slice(0, -1))
  if (!parent) return build
  const slotId = path[path.length - 1]
  const previous = parent.children[slotId]
  const part = catalog.mods.get(itemId)
  const node = emptyNode(itemId)
  if (previous && part) {
    for (const slot of part.slots) {
      const kept = previous.children[slot.nameId]
      if (kept && slot.allowed.includes(kept.itemId)) node.children[slot.nameId] = kept
    }
  }
  parent.children[slotId] = node
  return next
}

export function removePart(build: Build, path: string[]): Build {
  const next: Build = { ...build, root: clone(build.root) }
  const parent = nodeAt(next, path.slice(0, -1))
  if (parent) delete parent.children[path[path.length - 1]]
  return next
}

/** Required slots (on the weapon and on every installed mod) that are still empty. */
export function missingRequired(build: Build, weapon: Weapon, catalog: PartLookup): Array<{ path: string[]; slot: GunSlot }> {
  const out: Array<{ path: string[]; slot: GunSlot }> = []
  const walk = (part: GunPart, node: BuildNode, path: string[]) => {
    for (const slot of part.slots) {
      const child = node.children[slot.nameId]
      const childPart = child ? catalog.mods.get(child.itemId) : undefined
      if (!childPart) {
        if (slot.required) out.push({ path: [...path, slot.nameId], slot })
        continue
      }
      walk(childPart, child!, [...path, slot.nameId])
    }
  }
  walk(weapon, build.root, [])
  return out
}

/** Items of a slot that can be offered at all (known to the mod catalogue). */
export function slotCandidates(slot: GunSlot, catalog: PartLookup): GunPart[] {
  return slot.allowed.flatMap((id) => catalog.mods.get(id) ?? [])
}

/** One slot of the board: where it is, what fits, what is in it. */
export interface SlotCell { path: string[]; slot: GunSlot; part?: GunPart }
/** The slots of one installed item (the weapon first), shown together under that item. */
export interface SlotGroup { path: string[]; owner: GunPart; depth: number; cells: SlotCell[] }

/**
 * The board of «Сборка оружия» (owner, 17.10.2026, after db4tarkov FORGE): the weapon's slots, then — depth-first —
 * the slots of every installed item that has slots of its own. A handguard with two extra mounts adds a group of two
 * more cells; swapping it for one without them removes that group, and everything that was in those mounts.
 */
export function slotGroups(build: Build, weapon: Weapon, catalog: PartLookup): SlotGroup[] {
  const groups: SlotGroup[] = []
  const walk = (owner: GunPart, node: BuildNode, path: string[], depth: number) => {
    if (!owner.slots.length) return
    const cells = owner.slots.map((slot): SlotCell => {
      const child = node.children[slot.nameId]
      return { path: [...path, slot.nameId], slot, part: child ? catalog.mods.get(child.itemId) : undefined }
    })
    groups.push({ path, owner, depth, cells })
    for (const cell of cells) {
      const child = node.children[cell.slot.nameId]
      if (cell.part && child) walk(cell.part, child, cell.path, depth + 1)
    }
  }
  walk(weapon, build.root, [], 0)
  return groups
}
