import { installedParts } from './buildModel'
import { cheapestOffer, computeStats, FULL_ACCESS, type BuildCost, type BuildStats, type CostLine, type PurchaseAccess } from './buildStats'
import type { Build, BuildNode, GunCatalog, GunPart, GunSlot, Weapon } from './gunTypes'

/**
 * «Сборка оружия» (owner, 17.10.2026): three builds of one weapon — бюджетная, средняя, топ — from parts that fit
 * (each slot's allowedItems, conflictingItems both ways) and can be bought (flea or a trader, `PurchaseAccess`).
 *
 * Score of a part = its recoil reduction in percent × RECOIL_WEIGHT + its ergonomics × ERGO_WEIGHT; both add up over the
 * build (src/arsenal/buildStats.ts), so a subtree's best choices can be found bottom-up. Every slot keeps a Pareto front
 * of (price, score) and the weapon's front is the set of best builds for every budget. A tier is a point on that front:
 * - budget: the most score per rouble (a rouble counts BUDGET_ROUBLES_PER_POINT per point);
 * - middle: the same with MIDDLE_ROUBLES_PER_POINT;
 * - top: the best score, unless a build at most TOP_NEAR_POINTS lower costs TOP_SAVING less (the owner: «аналоги на 1-2
 *   пункта ниже, но цена очень сильно отличается»).
 * Sights add nothing to the score, so each tier gets one by price rank of its kind (`pickSight`); the magazine keeps at
 * least the default preset's capacity.
 */
export type BuildTier = 'budget' | 'middle' | 'top'
export const BUILD_TIERS: BuildTier[] = ['budget', 'middle', 'top']

export const RECOIL_WEIGHT = 1
export const ERGO_WEIGHT = 0.35
export const BUDGET_ROUBLES_PER_POINT = 1_500
export const MIDDLE_ROUBLES_PER_POINT = 7_000
export const TOP_NEAR_POINTS = 2
export const TOP_SAVING = 0.35
/** Fronts are cut to this many points (spread over the price range). */
const FRONT_LIMIT = 28
/** Mounts in mounts in mounts…: deeper subtrees are left empty. */
const MAX_DEPTH = 7

/** Weapon classes of the page: firearms only (no grenade or rocket launchers, melee, grenades). */
export const BUILD_CLASSES = ['assault-rifle', 'assault-carbine', 'smg', 'handgun', 'revolver', 'shotgun', 'marksman-rifle', 'sniper-rifle', 'machinegun'] as const
/** Grenades and flares fired from a «revolver» or a launcher (MSGL, signal pistols): not bullets. */
const NON_BULLET_CALIBERS = new Set(['Caliber40x46', 'Caliber40mmRU', 'Caliber26x75', 'Caliber30x29'])

/** Weapons the page builds: firearms that fire cartridges. */
export function buildableWeapon(weapon: Pick<Weapon, 'weaponClass' | 'caliber'>) {
  return (BUILD_CLASSES as readonly string[]).includes(weapon.weaponClass) && !NON_BULLET_CALIBERS.has(weapon.caliber)
}

/** A weapon is worth three builds with at least this many kinds of part to choose (ТОЗ-106 has 3, a sawn-off 0). */
export const MIN_PART_KINDS = 4
const kindOf = (slotId: string) => /^mod_(scope|sight|mount)/.test(slotId) ? 'sight' : /^mod_pistol_?grip/.test(slotId) ? 'grip' : slotId.replace(/_\d+$/, '')
const kindsMemo = new WeakMap<Weapon, number>()

/**
 * Kinds of part (muzzle, stock, grip, optic…) of the weapon, up to three mounts deep, that offer a choice: two or more
 * items someone sells.
 */
export function partKinds(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>) {
  const known = kindsMemo.get(weapon)
  if (known !== undefined) return known
  const kinds = new Set<string>()
  const visit = (part: GunPart, depth: number, trail: Set<string>) => {
    if (depth > 3) return
    for (const slot of part.slots) {
      const choices = slot.allowed.flatMap((id) => { const mod = catalog.mods.get(id); return mod && mod.offers.length ? [mod] : [] })
      if (choices.length >= 2) kinds.add(kindOf(slot.nameId))
      for (const mod of choices.slice(0, 40)) {
        if (trail.has(mod.id)) continue
        trail.add(mod.id); visit(mod, depth + 1, trail); trail.delete(mod.id)
      }
    }
  }
  visit(weapon, 0, new Set([weapon.id]))
  kindsMemo.set(weapon, kinds.size)
  return kinds.size
}

/**
 * The weapons «Сборка оружия» lists (owner, 17.10.2026): firearms with a known picture outline (the callouts need it) and
 * enough parts to choose — not revolvers, the ТОЗ, a sawn-off and the like.
 */
export function listedWeapon(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, hasOutline: (pictureId: string) => boolean) {
  return buildableWeapon(weapon) && weapon.weaponClass !== 'revolver' && hasOutline(weapon.defaultPreset?.id ?? weapon.id) && partKinds(weapon, catalog) >= MIN_PART_KINDS
}

/**
 * How the weapon is bought: the bare weapon (every part paid), or its default preset from a trader / the flea, whose
 * own parts then cost nothing — some of them are sold nowhere else (the ПМ slide, the АПС frame…). `found`: nobody sells
 * the weapon (raid, barter or craft only: ВСС, ПКП…) — its default parts come with it and only the added parts cost.
 */
export type WeaponPurchase = 'weapon' | 'preset' | 'found'

export interface TieredLine extends CostLine { included?: boolean }
export type TieredCost = Omit<BuildCost, 'lines'> & { lines: TieredLine[] }

export interface TieredBuild {
  tier: BuildTier
  build: Build
  stats: BuildStats
  /** Lines: the weapon (or its preset) first; parts that came with the preset have `included`. */
  cost: TieredCost
  score: number
  purchase: WeaponPurchase
}

interface Choice { slot: string; itemId: string; sub: Point }
/** One build of a subtree: its price, score, choices, the items in it and every item they may not stand with. */
interface Point { cost: number; score: number; picks: Choice[]; items: ReadonlySet<string>; blocks: ReadonlySet<string> }

const NONE: ReadonlySet<string> = new Set()
const EMPTY: Point = { cost: 0, score: 0, picks: [], items: NONE, blocks: NONE }

const clash = (a: Point, b: Point) => {
  if (!a.items.size || !b.items.size) return false
  for (const id of b.items) if (a.blocks.has(id)) return true
  for (const id of a.items) if (b.blocks.has(id)) return true
  return false
}
const union = (a: ReadonlySet<string>, b: ReadonlySet<string>) => !a.size ? b : !b.size ? a : new Set([...a, ...b])

export function partScore(part: Pick<GunPart, 'recoilModifier' | 'ergonomics'>) {
  return -part.recoilModifier * 100 * RECOIL_WEIGHT + part.ergonomics * ERGO_WEIGHT
}

const SIGHT_SLOTS = /^mod_(scope|sight_rear|sight_front)/
const MAGAZINE_SLOT = /^mod_magazine/
const STANDARD_MAGAZINE = 30
/** Optics by price rank: the cheapest, the middle one and a dear one of the kind that suits the weapon. */
const SIGHT_RANK: Record<BuildTier, number> = { budget: 0, middle: 0.5, top: 0.85 }
const OPTIC_CATEGORY = /(reflex|collimator|compact|holo)/i
const SCOPE_CATEGORY = /(scope|assault|special)/i
/** Marksman rifles too take fast optics (collimators, holographic, the 1x/4x assault scopes), not long scopes. */
const MARKSMAN_CATEGORY = /(reflex|collimator|compact|holo|assault)/i
/**
 * Optics proven in a streamer's 1.0 builds (owner, 17.10.2026: «учти для будущих сборок»), most used first: Trijicon
 * SRO (on an RM33 mount), EOTech XPS3 / EXPS3, ELCAN SpecterDR, Vortex UH-1. The middle and top builds take one of them
 * when it fits; the budget one stays the cheapest optic.
 */
const PROVEN_SIGHTS = [/\bSRO\b/i, /\bEXPS3/i, /\bXPS3/i, /Specter/i, /\bUH-1\b/i]
const provenRank = (part: Pick<GunPart, 'name' | 'shortName'>) => PROVEN_SIGHTS.findIndex((pattern) => pattern.test(part.shortName) || pattern.test(part.name))

export interface SolveOptions {
  access?: PurchaseAccess
  /** Items never to use (a conflict found after solving, see `solveTier`). */
  banned?: Set<string>
}

/**
 * The part's offers with the flea one at its 24-hour average (owner, 17.10.2026: «ориентируйся по средней цене за
 * сутки») — one lucky cheap listing does not change a build; without the average, the current lowest offer.
 */
const averaged = new WeakMap<GunPart, GunPart>()
function dayPriced(part: GunPart): GunPart {
  if (!part.fleaAvg24h) return part
  let known = averaged.get(part)
  if (!known) {
    known = { ...part, offers: part.offers.map((offer) => offer.vendor === 'flea-market' ? { ...offer, priceRUB: part.fleaAvg24h! } : offer) }
    averaged.set(part, known)
  }
  return known
}

/** The cheapest offer the access allows, the flea at its day average. */
export function buildOffer(part: GunPart, access: PurchaseAccess = FULL_ACCESS) {
  return cheapestOffer(dayPriced(part), access)
}

/** Price of one part under the access, or undefined when nobody sells it. */
function priceOf(part: GunPart, access: PurchaseAccess) {
  return buildOffer(part, access)?.priceRUB
}

/**
 * Pareto front of a slot / an item subtree. Memo per solve; `trail` stops an item from being mounted into itself.
 */
function makeSolver(catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess, banned: Set<string>, minCapacity: number, included: ReadonlySet<string>) {
  const itemMemo = new Map<string, Point[]>()

  const itemFront = (part: GunPart, depth: number, trail: Set<string>): Point[] => {
    const key = `${part.id}:${depth >= MAX_DEPTH ? 'x' : ''}`
    const known = itemMemo.get(key)
    if (known) return known
    let front: Point[] = [EMPTY]
    if (depth < MAX_DEPTH) {
      trail.add(part.id)
      for (const slot of part.slots) {
        if (SIGHT_SLOTS.test(slot.nameId) && !slot.required) continue
        const slotPoints = slotFront(slot, depth + 1, trail)
        if (!slotPoints) { front = []; break }
        front = combine(front, slotPoints)
      }
      trail.delete(part.id)
    }
    itemMemo.set(key, front)
    return front
  }

  /** Undefined when a required slot has nothing buyable. */
  const slotFront = (slot: GunSlot, depth: number, trail: Set<string>): Point[] | undefined => {
    // A magazine costs ergonomics, so it would be left out; a weapon is never built without one.
    const magazine = MAGAZINE_SLOT.test(slot.nameId)
    const options: Point[] = slot.required || magazine ? [] : [EMPTY]
    for (const id of slot.allowed) {
      if (banned.has(id) || trail.has(id)) continue
      const part = catalog.mods.get(id)
      if (!part) continue
      // Standard magazines only: at least the default capacity, no drums or casket magazines beyond 30 rounds (or the
      // default when it is larger) — streamer builds use 30-round mags, drums only in fun builds.
      if (magazine && ((part.capacity ?? 0) < minCapacity || (part.capacity ?? 0) > Math.max(minCapacity, STANDARD_MAGAZINE))) continue
      const price = included.has(id) ? 0 : priceOf(part, access)
      if (price === undefined) continue
      const own = partScore(part)
      const self: Point = { ...EMPTY, items: new Set([id]), blocks: new Set(part.conflicts) }
      for (const sub of itemFront(part, depth, trail)) {
        if (clash(self, sub)) continue
        options.push({ cost: price + sub.cost, score: own + sub.score, picks: [{ slot: slot.nameId, itemId: id, sub }], items: union(self.items, sub.items), blocks: union(self.blocks, sub.blocks) })
      }
    }
    if (!options.length) return slot.required ? undefined : [EMPTY]
    return prune(options)
  }

  return { itemFront }
}

/** Every combination of two independent slot fronts that may stand together, pruned (parts are joined only for the kept ones). */
function combine(a: Point[], b: Point[]): Point[] {
  if (a.length === 1 && a[0] === EMPTY) return b
  const pairs: Array<{ cost: number; score: number; left: Point; right: Point }> = []
  for (const left of a) for (const right of b) if (!clash(left, right)) pairs.push({ cost: left.cost + right.cost, score: left.score + right.score, left, right })
  return prune(pairs).map(({ cost, score, left, right }) => ({
    cost, score, picks: [...left.picks, ...right.picks], items: union(left.items, right.items), blocks: union(left.blocks, right.blocks),
  }))
}

/** Pareto front (cheaper or better), then at most FRONT_LIMIT points spread over the price range. */
export function prune<T extends { cost: number; score: number }>(points: T[]): T[] {
  const sorted = [...points].sort((x, y) => x.cost - y.cost || y.score - x.score)
  const front: T[] = []
  for (const point of sorted) if (!front.length || point.score > front[front.length - 1].score + 1e-9) front.push(point)
  if (front.length <= FRONT_LIMIT) return front
  const kept: T[] = []
  for (let index = 0; index < FRONT_LIMIT; index++) kept.push(front[Math.round(index * (front.length - 1) / (FRONT_LIMIT - 1))])
  return [...new Set(kept)]
}

/** The tier's point of the weapon's front. */
export function pickTier<T extends { cost: number; score: number }>(front: T[], tier: BuildTier): T | undefined {
  if (!front.length) return undefined
  if (tier === 'top') {
    const best = front[front.length - 1]
    // Never below the middle build.
    const floor = Math.max(best.score - TOP_NEAR_POINTS, pickTier(front, 'middle')!.score)
    const near = front.find((point) => point.score >= floor)
    return near && near.cost <= best.cost * (1 - TOP_SAVING) ? near : best
  }
  const rate = tier === 'budget' ? BUDGET_ROUBLES_PER_POINT : MIDDLE_ROUBLES_PER_POINT
  return front.reduce((best, point) => point.score - point.cost / rate > best.score - best.cost / rate ? point : best)
}

function toNode(itemId: string, point: Point): BuildNode {
  return { itemId, children: Object.fromEntries(point.picks.map((pick) => [pick.slot, toNode(pick.itemId, pick.sub)])) }
}

/** The first pair of installed items that may not stand together, if any. */
export function findConflict(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>): [string, string] | undefined {
  const parts = [weapon, ...installedParts(build, catalog).map((entry) => entry.part)]
  const ids = new Set(parts.map((part) => part.id))
  for (const part of parts) {
    const other = part.conflicts.find((id) => ids.has(id) && id !== part.id)
    if (other) return [part.id, other]
  }
  return undefined
}

function defaultMagazineCapacity(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>) {
  const ids = weapon.defaultPreset?.itemIds ?? []
  return Math.max(0, ...ids.map((id) => catalog.mods.get(id)?.capacity ?? 0))
}

/** Free positions an optic can go to: a scope / rear-sight / mount slot of the weapon or of an installed part. */
function sightSlots(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>) {
  const out: Array<{ node: BuildNode; slot: GunSlot }> = []
  const walk = (part: GunPart, node: BuildNode) => {
    for (const slot of part.slots) {
      const child = node.children[slot.nameId]
      if (child) { const childPart = catalog.mods.get(child.itemId); if (childPart) walk(childPart, child); continue }
      if (/^mod_(scope|sight_rear|mount)/.test(slot.nameId)) out.push({ node, slot })
    }
  }
  walk(weapon, build.root)
  return out
}

/**
 * One optic for the tier: of the sights that fit a free slot (directly, or on up to two mounts), the kind suiting the
 * weapon (collimators for pistols, SMGs, shotguns and assault rifles, scopes for marksman and sniper rifles) and the
 * price rank of the tier. Nothing when the weapon takes no optic.
 */
function pickSight(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, access: PurchaseAccess, banned: Set<string>): Build {
  const kind = weapon.weaponClass === 'sniper-rifle' ? SCOPE_CATEGORY : weapon.weaponClass === 'marksman-rifle' ? MARKSMAN_CATEGORY : OPTIC_CATEGORY
  type Chain = Array<{ slot: string; part: GunPart }>
  type Option = { slotNode: BuildNode; chain: Chain; price: number; sight: GunPart }
  const options: Option[] = []
  const ids = new Set(installedParts(build, catalog).map((entry) => entry.part.id))
  const fits = (part: GunPart, chain: Chain) => !banned.has(part.id)
    && ![...ids, ...chain.map((link) => link.part.id)].some((id) => part.conflicts.includes(id) || catalog.mods.get(id)?.conflicts.includes(part.id))
  const isSight = (part: GunPart) => kind.test(part.category ?? '') && !part.slots.some((child) => child.required)
  const isMount = (part: GunPart) => /mount/i.test(part.category ?? '') && part.slots.some((child) => /^mod_(scope|sight_rear|mount)/.test(child.nameId))
  const explore = (slotNode: BuildNode, slot: GunSlot, chain: Chain, price: number) => {
    for (const id of slot.allowed) {
      const part = catalog.mods.get(id)
      if (!part || !fits(part, chain)) continue
      const own = priceOf(part, access)
      if (own === undefined) continue
      const next = [...chain, { slot: slot.nameId, part }]
      if (isSight(part)) options.push({ slotNode, chain: next, price: price + own, sight: part })
      else if (isMount(part) && chain.length < 2 && !part.slots.some((child) => child.required)) {
        for (const child of part.slots.filter((entry) => /^mod_(scope|sight_rear|mount)/.test(entry.nameId))) explore(slotNode, child, next, price + own)
      }
    }
  }
  for (const { node, slot } of sightSlots(build, weapon, catalog)) explore(node, slot, [], 0)
  if (!options.length) return build
  // Fewer mounts first at equal price; among sights of one price, the lighter on ergonomics.
  const sorted = options.sort((a, b) => a.price - b.price || a.chain.length - b.chain.length || partScore(b.sight) - partScore(a.sight))
  const proven = tier === 'budget' ? [] : sorted.filter((option) => provenRank(option.sight) >= 0)
  const chosen = proven.length
    // middle: the cheapest proven optic; top: the most used one, on its cheapest mount
    ? (tier === 'middle' ? proven[0] : [...proven].sort((a, b) => provenRank(a.sight) - provenRank(b.sight) || a.price - b.price)[0])
    : sorted[Math.min(sorted.length - 1, Math.round(SIGHT_RANK[tier] * (sorted.length - 1)))]
  const next: Build = structuredClone(build)
  const target = findNode(next.root, chosen.slotNode, build.root)
  if (!target) return build
  let node = target
  for (const link of chosen.chain) {
    const child: BuildNode = { itemId: link.part.id, children: {} }
    node.children[link.slot] = child
    node = child
  }
  return next
}

/** The node of `copy` at the place `original` holds in `originalRoot`. */
function findNode(copy: BuildNode, original: BuildNode, originalRoot: BuildNode): BuildNode | undefined {
  if (original === originalRoot) return copy
  for (const [slot, child] of Object.entries(originalRoot.children)) {
    const found = findNode(copy.children[slot], original, child)
    if (found) return found
  }
  return undefined
}

/** The three builds of a weapon (a tier is missing when no buildable set of parts exists under the access). */
export function solveTieredBuilds(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, options: SolveOptions = {}): TieredBuild[] {
  return BUILD_TIERS.flatMap((tier) => solveTier(weapon, catalog, tier, options) ?? [])
}

export function solveTier(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, options: SolveOptions = {}): TieredBuild | undefined {
  const access = options.access ?? FULL_ACCESS
  const banned = new Set(options.banned ?? [])
  const minCapacity = defaultMagazineCapacity(weapon, catalog)
  const presetItem = weapon.defaultPreset ? catalog.mods.get(weapon.defaultPreset.id) : undefined
  const purchases: Array<{ purchase: WeaponPurchase; price: number; included: ReadonlySet<string> }> = []
  const weaponPrice = priceOf(weapon, access)
  if (weaponPrice !== undefined) purchases.push({ purchase: 'weapon', price: weaponPrice, included: NONE })
  const presetPrice = presetItem ? priceOf(presetItem, access) : undefined
  if (presetPrice !== undefined) purchases.push({ purchase: 'preset', price: presetPrice, included: new Set(weapon.defaultPreset!.itemIds) })
  if (!purchases.length) purchases.push({ purchase: 'found', price: 0, included: new Set(weapon.defaultPreset?.itemIds ?? []) })
  for (let attempt = 0; attempt < 24; attempt++) {
    const front = prune(purchases.flatMap(({ purchase, price, included }) => makeSolver(catalog, access, banned, minCapacity, included)
      .itemFront(weapon, 0, new Set()).map((point) => ({ ...point, cost: point.cost + price, purchase, included }))))
    const point = pickTier(front, tier)
    if (!point) return undefined
    let build: Build = { weaponId: weapon.id, root: toNode(weapon.id, point), ammoId: weapon.defaultAmmoId }
    build = pickSight(build, weapon, catalog, tier, access, banned)
    const conflict = findConflict(build, weapon, catalog)
    if (conflict) {
      // Drop the conflicting part that is not the weapon and try again without it.
      banned.add(conflict[0] === weapon.id ? conflict[1] : conflict[0])
      continue
    }
    const stats = computeStats(build, weapon, catalog)
    return { tier, build, stats, cost: buildCost(build, weapon, catalog, access, point.purchase, presetItem, point.included), score: point.score, purchase: point.purchase }
  }
  return undefined
}

/** What the build costs bought this way: the weapon or its preset, then every part that did not come with it. */
function buildCost(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess, purchase: WeaponPurchase, presetItem: GunPart | undefined, included: ReadonlySet<string>): TieredCost {
  const first = purchase === 'preset' && presetItem ? presetItem : weapon
  const lines: TieredLine[] = [purchase === 'found' ? { part: first } : { part: first, offer: buildOffer(first, access) }]
  for (const { part } of installedParts(build, catalog)) {
    lines.push(included.has(part.id) ? { part, included: true } : { part, offer: buildOffer(part, access) })
  }
  return {
    total: lines.reduce((total, line) => total + (line.offer?.priceRUB ?? 0), 0),
    lines,
    unavailable: lines.filter((line, index) => !line.offer && !line.included && !(index === 0 && purchase === 'found')).map((line) => line.part),
  }
}
