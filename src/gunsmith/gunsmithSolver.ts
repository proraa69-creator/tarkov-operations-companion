import { canInstall, installedParts, installPart, missingRequired, presetBuild, removePart } from '../arsenal/buildModel'
import { cheapestOffer, computeCost, computeStats, FULL_ACCESS, type BuildCost, type BuildStats, type CostLine, type PurchaseAccess } from '../arsenal/buildStats'
import type { Build, BuildNode, GunCatalog, GunOffer, GunPart, GunSlot, Weapon } from '../arsenal/gunTypes'
import type { WeaponBuildAttribute, WeaponBuildRequirement } from '../domain/types'
import { COMPUTED_ATTRIBUTES, meets, shortfall } from './gunsmith'

/**
 * «Как собрать» for a Gunsmith part: an example build from tarkov.dev's slot data (the same model as «Сборщик оружия»,
 * src/arsenal/buildModel.ts). Starts from the weapon's default preset, puts in every required part (through a mount or
 * adapter when its slot is on another part), fills the required slots, fits the magazine, then changes or removes parts
 * one at a time, always the change that brings ergonomics / recoil / weight closest to the specification, until it is met
 * or nothing helps. A heuristic, not a proof: the page says to check the stats in the game before handing the weapon in.
 */
export interface AttributeCheck {
  attribute: WeaponBuildAttribute
  /** The build's value; undefined when the app cannot compute this stat (effective distance, size…). */
  actual?: number
  met?: boolean
}

export interface GunsmithPlan {
  weapon: Weapon
  build: Build
  stats: BuildStats
  checks: AttributeCheck[]
  /** Required parts no slot of the weapon could take, as far as the data knows. */
  unplaced: string[]
  cost: BuildCost
  /** What to buy on top of the weapon (its default preset): required parts, adapters, the parts the stats need. */
  toBuy: CostLine[]
  /** Cheaper parts for the bought ones that keep every requirement the example meets (by slot). */
  alternatives: SlotAlternatives[]
  /**
   * Every part that can go instead of each replaceable part of the build and keeps the requirements (cheapest first): the
   * module cards' hover window. A slot that changes a stat the app does not compute is listed with `uncomputed`.
   */
  fitting: SlotAlternatives[]
}

export interface PartAlternative {
  part: GunPart
  offer?: GunOffer
  /** How much the whole build gets cheaper with this part instead (parts it needs included). */
  saving: number
  /** The computed stats of the build with this part (ergonomics, recoil, …), to show how close to the limit it is. */
  values: Array<{ attribute: WeaponBuildAttribute; actual: number }>
}

export interface SlotAlternatives {
  path: string[]
  part: GunPart
  options: PartAlternative[]
  /** The slot changes a stat checked only in the game (effective distance, accuracy, size): no replacement is offered. */
  uncomputed?: boolean
}

type Catalog = Pick<GunCatalog, 'weapons' | 'mods'>

interface SlotRef { path: string[]; slot: GunSlot; child?: BuildNode }

/** The weapon of a requirement: the weapon itself, or the weapon whose default preset this is. */
export function findWeapon(catalog: Pick<GunCatalog, 'weapons'>, weaponId: string) {
  return catalog.weapons.find((weapon) => weapon.id === weaponId) ?? catalog.weapons.find((weapon) => weapon.defaultPreset?.id === weaponId)
}

function slotsOf(build: Build, weapon: Weapon, catalog: Catalog): SlotRef[] {
  const out: SlotRef[] = []
  const walk = (part: GunPart, node: BuildNode, path: string[]) => {
    for (const slot of part.slots) {
      const childPath = [...path, slot.nameId]
      const child = node.children[slot.nameId]
      out.push({ path: childPath, slot, child })
      const childPart = child ? catalog.mods.get(child.itemId) : undefined
      if (child && childPart) walk(childPart, child, childPath)
    }
  }
  walk(weapon, build.root, [])
  return out
}

const key = (path: string[]) => path.join('/')
/** A slot that holds a required part, or leads to one, is not touched again. */
const isLocked = (path: string[], locked: string[][]) => locked.some((lockedPath) => lockedPath.length >= path.length && path.every((part, index) => lockedPath[index] === part))

export function solveGunsmithBuild(requirement: WeaponBuildRequirement, catalog: Catalog, access: PurchaseAccess = FULL_ACCESS): GunsmithPlan | null {
  const weapon = findWeapon(catalog, requirement.weaponId)
  if (!weapon) return null
  const preset = new Set(weapon.defaultPreset?.itemIds ?? [])
  const buyable = (part: GunPart) => preset.has(part.id) || Boolean(cheapestOffer(part, access))
  const price = (part: GunPart) => preset.has(part.id) ? 0 : cheapestOffer(part, access)?.priceRUB ?? 1e9
  const locked: string[][] = []
  const unplaced: string[] = []
  let build = presetBuild(weapon, catalog).build

  const tryInstall = (from: Build, path: string[], slot: GunSlot, itemId: string): Build | null =>
    canInstall(from, path, slot, itemId, catalog).ok ? installPart(from, path, itemId, catalog) : null

  // 1. Required parts. Parts that fit the weapon directly go first, so a handguard is in before the sight on its rail.
  const required = [...new Set(requirement.partIds)].filter((id) => catalog.mods.has(id))
  unplaced.push(...requirement.partIds.filter((id) => !catalog.mods.has(id)))
  let pending = required
  for (let round = 0; round < 3 && pending.length; round += 1) {
    const left: string[] = []
    for (const partId of pending) {
      const placed = placePart(build, weapon, catalog, partId, locked, tryInstall, price)
      if (placed) { build = placed.build; locked.push(placed.path) } else left.push(partId)
    }
    if (left.length === pending.length) break
    pending = left
  }
  unplaced.push(...pending)
  // «Any one of» (older data): only when none of them is in yet.
  if (requirement.anyOfIds?.length && !installedParts(build, catalog).some(({ part }) => requirement.anyOfIds!.includes(part.id))) {
    for (const partId of [...requirement.anyOfIds].sort((a, b) => price(catalog.mods.get(a)!) - price(catalog.mods.get(b)!))) {
      if (!catalog.mods.has(partId)) continue
      const placed = placePart(build, weapon, catalog, partId, locked, tryInstall, price)
      if (placed) { build = placed.build; locked.push(placed.path); break }
    }
  }
  // «A part of this category» (containsCategory): the cheapest one that fits, unless the build already has one.
  for (const category of requirement.categories ?? []) {
    const inCategory = (part: GunPart) => part.categoryIds?.includes(category.id) ?? false
    if (installedParts(build, catalog).some(({ part }) => inCategory(part))) continue
    const candidates = [...catalog.mods.values()].filter((part) => inCategory(part) && buyable(part)).sort((a, b) => price(a) - price(b))
    for (const part of candidates.slice(0, 40)) {
      const placed = placePart(build, weapon, catalog, part.id, locked, tryInstall, price)
      if (placed) { build = placed.build; locked.push(placed.path); break }
    }
  }
  // The guide's build of this task (tarkov.help, else the wiki): a set of parts known to pass, put in before the stats are
  // tuned. Not locked: a part of it can still be swapped for a better one or a fitting alternative.
  for (const partId of [...new Set((requirement.guide?.parts ?? []).flatMap((part) => (part.itemId ? [part.itemId] : [])))]) {
    const part = catalog.mods.get(partId)
    if (!part || !buyable(part) || installedParts(build, catalog).some((entry) => entry.part.id === partId)) continue
    const placed = placePart(build, weapon, catalog, partId, locked, tryInstall, price)
    if (placed && !missingRequired(placed.build, weapon, catalog).length) build = placed.build
  }
  build = fillRequired(build, weapon, catalog, tryInstall, buyable, price)

  const attributes = requirement.attributes
  const capacity = attributes.find((attribute) => attribute.name === 'magazineCapacity')
  if (capacity) build = fitMagazine(build, weapon, catalog, locked, capacity, tryInstall, buyable, price)

  // 2. Stats: one change at a time, the one that brings the computed stats closest to the specification.
  const tuned = attributes.filter((attribute) => attribute.name !== 'magazineCapacity' && COMPUTED_ATTRIBUTES.has(attribute.name))
  const gap = (candidate: Build) => {
    const stats = computeStats(candidate, weapon, catalog)
    return tuned.reduce((sum, attribute) => sum + shortfall(attribute, statValue(attribute.name, stats, candidate, catalog)!), 0)
  }
  let current = gap(build)
  for (let step = 0; step < 16 && current > 0; step += 1) {
    let best: { build: Build; gap: number; cost: number } | null = null
    for (const ref of slotsOf(build, weapon, catalog)) {
      if (isLocked(ref.path, locked)) continue
      const options: Array<{ next: Build | null; cost: number }> = []
      if (ref.child && !ref.slot.required) options.push({ next: removePart(build, ref.path), cost: 0 })
      for (const id of ref.slot.allowed) {
        if (id === ref.child?.itemId) continue
        const part = catalog.mods.get(id)
        if (!part || !buyable(part)) continue
        const installed = tryInstall(build, ref.path, ref.slot, id)
        options.push({ next: installed && fillRequired(installed, weapon, catalog, tryInstall, buyable, price), cost: price(part) })
      }
      for (const option of options) {
        if (!option.next || missingRequired(option.next, weapon, catalog).length) continue
        // A change must not undo the magazine the specification needs.
        if (capacity && !meets(capacity, magazineCapacity(option.next, catalog) ?? 0) && meets(capacity, magazineCapacity(build, catalog) ?? 0)) continue
        const value = gap(option.next)
        if (value >= current - 1e-9) continue
        if (!best || value < best.gap - 1e-9 || (Math.abs(value - best.gap) < 1e-9 && option.cost < best.cost)) best = { build: option.next, gap: value, cost: option.cost }
      }
    }
    if (!best) break
    build = best.build
    current = best.gap
  }

  const stats = computeStats(build, weapon, catalog)
  const checks = attributes.map((attribute): AttributeCheck => {
    const actual = COMPUTED_ATTRIBUTES.has(attribute.name) ? statValue(attribute.name, stats, build, catalog) : undefined
    return actual === undefined ? { attribute } : { attribute, actual, met: meets(attribute, actual) }
  })
  const cost = computeCost(build, weapon, catalog, access)
  const presetLeft = [...(weapon.defaultPreset?.itemIds ?? [])]
  const toBuy = cost.lines.slice(1).filter((line) => {
    const index = presetLeft.indexOf(line.part.id)
    if (index < 0) return true
    presetLeft.splice(index, 1)
    return false
  })
  const input = { build, weapon, catalog, locked, toBuy, checks, attributes, tryInstall, buyable, price, access }
  const alternatives = slotAlternatives(input, { onlyCheaper: true, max: MAX_ALTERNATIVES })
  // For the module cards: the parts the build buys and the wiki's parts.
  const focus = new Set([...toBuy.map((line) => line.part.id), ...(requirement.guide?.parts ?? []).flatMap((part) => (part.itemId ? [part.itemId] : []))])
  const fitting = slotAlternatives(input, { onlyCheaper: false, max: MAX_FITTING, focus })
  return { weapon, build, stats, checks, unplaced, cost, toBuy, alternatives, fitting }
}

/** Slots that also change a stat the app does not compute: left alone, so an alternative never breaks it unseen. */
function touchesUncomputed(slotNameId: string, attributes: WeaponBuildAttribute[]) {
  const names = new Set(attributes.filter((attribute) => !COMPUTED_ATTRIBUTES.has(attribute.name)).map((attribute) => attribute.name))
  const slot = slotNameId.toLowerCase()
  if ((names.has('effectiveDistance') || names.has('muzzleVelocity') || names.has('accuracy')) && /barrel|muzzle/.test(slot)) return true
  if (names.has('width') && /stock/.test(slot)) return true
  if (names.has('height') && /magazine|pistol_grip|foregrip|scope|sight|mount|tactical/.test(slot)) return true
  return false
}

const MAX_ALTERNATIVES = 3
const MAX_FITTING = 8

/**
 * «Дешёвые аналоги» (owner, 11.10.2026): for every bought part that is not required, the parts of the same slot that
 * make the whole build cheaper and still meet every requirement the example meets (computed stats, magazine). Cheapest first.
 */
function slotAlternatives(input: {
  build: Build; weapon: Weapon; catalog: Catalog; locked: string[][]; toBuy: CostLine[]; checks: AttributeCheck[]; attributes: WeaponBuildAttribute[]
  tryInstall: TryInstall; buyable: (part: GunPart) => boolean; price: (part: GunPart) => number; access: PurchaseAccess
}, mode: { onlyCheaper: boolean; max: number; focus?: Set<string> }): SlotAlternatives[] {
  const { build, weapon, catalog, locked, toBuy, checks, attributes, tryInstall, buyable, price, access } = input
  const bought = new Set(toBuy.map((line) => line.part.id))
  const keep = checks.filter((check) => check.met === true).map((check) => check.attribute)
  // A requirement the example misses must not get further away.
  const missed = checks.filter((check) => check.met === false && check.actual !== undefined).map((check) => ({ attribute: check.attribute, gap: shortfall(check.attribute, check.actual!) }))
  const costOf = (candidate: Build) => installedParts(candidate, catalog).reduce((sum, entry) => sum + price(entry.part), 0)
  const base = costOf(build)
  const out: SlotAlternatives[] = []
  for (const ref of slotsOf(build, weapon, catalog)) {
    const current = ref.child ? catalog.mods.get(ref.child.itemId) : undefined
    if (!current || isLocked(ref.path, locked) || (mode.onlyCheaper && !bought.has(current.id)) || (mode.focus && !mode.focus.has(current.id))) continue
    if (touchesUncomputed(ref.slot.nameId, attributes)) {
      if (!mode.onlyCheaper) out.push({ path: ref.path, part: current, options: [], uncomputed: true })
      continue
    }
    const options: PartAlternative[] = []
    // The fitting list: the cheapest first, and only as many as it shows.
    const candidates = mode.onlyCheaper ? ref.slot.allowed : [...ref.slot.allowed].sort((a, b) => price(catalog.mods.get(a) ?? current) - price(catalog.mods.get(b) ?? current))
    for (const id of candidates) {
      if (!mode.onlyCheaper && options.length >= mode.max) break
      const part = catalog.mods.get(id)
      if (!part || id === current.id || !buyable(part) || (mode.onlyCheaper && price(part) >= price(current))) continue
      const installed = tryInstall(build, ref.path, ref.slot, id)
      const next = installed && fillRequired(installed, weapon, catalog, tryInstall, buyable, price)
      if (!next || missingRequired(next, weapon, catalog).length) continue
      const stats = computeStats(next, weapon, catalog)
      if (keep.some((attribute) => !meets(attribute, statValue(attribute.name, stats, next, catalog) ?? Number.NaN))) continue
      if (missed.some(({ attribute, gap }) => shortfall(attribute, statValue(attribute.name, stats, next, catalog) ?? Number.NaN) > gap + 1e-9)) continue
      const saving = base - costOf(next)
      const values = checks.flatMap((check) => {
        const actual = check.actual === undefined ? undefined : statValue(check.attribute.name, stats, next, catalog)
        return actual === undefined ? [] : [{ attribute: check.attribute, actual }]
      })
      if (saving > 0 || !mode.onlyCheaper) options.push({ part, offer: cheapestOffer(part, access), saving, values })
    }
    if (options.length || !mode.onlyCheaper) out.push({ path: ref.path, part: current, options: mode.onlyCheaper ? options.sort((a, b) => b.saving - a.saving).slice(0, mode.max) : options })
  }
  return out
}

/** The build's value of a computed stat (recoil = vertical + horizontal, as the game sums it for Gunsmith). */
export function statValue(name: string, stats: BuildStats, build: Build, catalog: Pick<GunCatalog, 'mods'>): number | undefined {
  if (name === 'ergonomics') return stats.ergonomics
  if (name === 'recoil') return stats.recoilVertical + stats.recoilHorizontal
  if (name === 'weight') return stats.weight
  if (name === 'magazineCapacity') return magazineCapacity(build, catalog) ?? 0
  return undefined
}

function magazineCapacity(build: Build, catalog: Pick<GunCatalog, 'mods'>) {
  const parts = installedParts(build, catalog)
  return (parts.find((entry) => entry.path[entry.path.length - 1] === 'mod_magazine' && entry.part.capacity) ?? parts.find((entry) => entry.part.capacity))?.part.capacity
}

type TryInstall = (from: Build, path: string[], slot: GunSlot, itemId: string) => Build | null

/**
 * Puts a required part into the build: into a slot that takes it, else through one or two parts that have such a slot
 * (a mount for a sight, an adapter for a suppressor). Empty slots first, then the cheapest way. Returns its path.
 */
function placePart(build: Build, weapon: Weapon, catalog: Catalog, partId: string, locked: string[][], tryInstall: TryInstall, price: (part: GunPart) => number): { build: Build; path: string[] } | null {
  // Already in (the default preset has it): it only has to stay.
  const present = installedParts(build, catalog).find((entry) => entry.part.id === partId && !locked.some((path) => key(path) === key(entry.path)))
  if (present) return { build, path: present.path }
  const takes = (part: GunPart, ids: Set<string>) => part.slots.some((slot) => slot.allowed.some((id) => ids.has(id)))
  const target = new Set([partId])
  const hosts = new Set([...catalog.mods.values()].filter((part) => takes(part, target)).map((part) => part.id))
  const hosts2 = new Set([...catalog.mods.values()].filter((part) => !hosts.has(part.id) && takes(part, hosts)).map((part) => part.id))
  const refs = slotsOf(build, weapon, catalog).filter((ref) => !isLocked(ref.path, locked))
    .sort((a, b) => Number(Boolean(a.child)) - Number(Boolean(b.child)) || a.path.length - b.path.length)
  type Option = { build: Build; path: string[]; cost: number; occupied: boolean }
  let best: Option | null = null
  const consider = (option: Option | null) => {
    if (!option) return
    if (!best || Number(option.occupied) < Number(best.occupied) || (option.occupied === best.occupied && option.cost < best.cost)) best = option
  }
  /** `partId` into some slot of the part at `hostPath`. */
  const intoHost = (from: Build, hostPath: string[], host: GunPart, cost: number, occupied: boolean): Option | null => {
    for (const slot of host.slots) {
      if (!slot.allowed.includes(partId)) continue
      const path = [...hostPath, slot.nameId]
      const next = tryInstall(from, path, slot, partId)
      if (next) return { build: next, path, cost, occupied }
    }
    return null
  }
  for (const ref of refs) {
    const occupied = Boolean(ref.child)
    if (ref.slot.allowed.includes(partId)) {
      const next = tryInstall(build, ref.path, ref.slot, partId)
      if (next) consider({ build: next, path: ref.path, cost: 0, occupied })
      continue
    }
    for (const id of ref.slot.allowed) {
      const host = catalog.mods.get(id)
      if (!host) continue
      if (hosts.has(id)) {
        const withHost = tryInstall(build, ref.path, ref.slot, id)
        if (withHost) consider(intoHost(withHost, ref.path, host, price(host), occupied))
      } else if (hosts2.has(id)) {
        const withHost = tryInstall(build, ref.path, ref.slot, id)
        if (!withHost) continue
        for (const slot of host.slots) {
          for (const innerId of slot.allowed) {
            const inner = hosts.has(innerId) ? catalog.mods.get(innerId) : undefined
            if (!inner) continue
            const innerPath = [...ref.path, slot.nameId]
            const withInner = tryInstall(withHost, innerPath, slot, innerId)
            if (withInner) consider(intoHost(withInner, innerPath, inner, price(host) + price(inner), occupied))
          }
        }
      }
    }
  }
  return best
}

/** Every required slot gets a part: the default preset's if it fits, else the cheapest one that can be bought. */
function fillRequired(build: Build, weapon: Weapon, catalog: Catalog, tryInstall: TryInstall, buyable: (part: GunPart) => boolean, price: (part: GunPart) => number): Build {
  let current = build
  for (let round = 0; round < 12; round += 1) {
    const missing = missingRequired(current, weapon, catalog)
    if (!missing.length) return current
    let changed = false
    for (const { path, slot } of missing) {
      const options = slot.allowed.flatMap((id) => catalog.mods.get(id) ?? []).filter(buyable).sort((a, b) => price(a) - price(b))
      for (const part of options) {
        const next = tryInstall(current, path, slot, part.id)
        if (next) { current = next; changed = true; break }
      }
    }
    if (!changed) return current
  }
  return current
}

/** The cheapest magazine that holds enough, when the one in the build does not. */
function fitMagazine(build: Build, weapon: Weapon, catalog: Catalog, locked: string[][], capacity: WeaponBuildAttribute, tryInstall: TryInstall, buyable: (part: GunPart) => boolean, price: (part: GunPart) => number) {
  if (meets(capacity, magazineCapacity(build, catalog) ?? 0)) return build
  let best: { build: Build; cost: number } | null = null
  for (const ref of slotsOf(build, weapon, catalog)) {
    if (isLocked(ref.path, locked)) continue
    for (const id of ref.slot.allowed) {
      const part = catalog.mods.get(id)
      if (!part?.capacity || !buyable(part) || !meets(capacity, part.capacity)) continue
      const next = tryInstall(build, ref.path, ref.slot, id)
      if (next && (!best || price(part) < best.cost)) best = { build: fillRequired(next, weapon, catalog, tryInstall, buyable, price), cost: price(part) }
    }
  }
  return best?.build ?? build
}
