import { GRIP_SLOT, installedParts, isGripStock, STOCK_SLOT } from './buildModel'
import { cheapestOffer, computeStats, FULL_ACCESS, type BuildCost, type BuildStats, type CostLine, type PurchaseAccess } from './buildStats'
import type { Build, BuildNode, GunCatalog, GunPart, GunSlot, Weapon } from './gunTypes'

/**
 * «Сборка оружия» (owner, 17.10.2026): three builds of one weapon — бюджетная, средняя, топ — from parts that fit
 * (each slot's allowedItems, conflictingItems both ways) and can be bought (flea or a trader, `PurchaseAccess`).
 *
 * Score of a part = its recoil reduction in percent × RECOIL_WEIGHT + its ergonomics × ERGO_WEIGHT; both add up over the
 * build (src/arsenal/buildStats.ts), so a subtree's best choices can be found bottom-up. Every slot keeps a Pareto front
 * of (price, score) and the weapon's front is the set of best builds for every budget. A tier is a point on that front
 * (owner, 28.10.2026: «сборка до 100 тысяч рублей, сборка до 200 тысяч рублей и сборка топовая, без лимита… всё самое
 * лучшее»), the whole build — the weapon and every part — priced:
 * - budget: the best build up to TIER_LIMITS.budget (100 000 ₽);
 * - middle: the best build up to TIER_LIMITS.middle (200 000 ₽);
 * - top: the best build there is, whatever it costs.
 * Recoil comes first, ergonomics second (RECOIL_WEIGHT, ERGO_WEIGHT); a part and what goes on it are scored together, so
 * a muzzle brake that takes a suppressor, or a handguard rail that takes a foregrip, wins over a part that is better alone
 * when the pair is better. Ammo and sights are not chosen: the player picks the round and the optic. The magazine keeps at
 * least the default preset's capacity. The owner's rules on top of the score (28.10.2026, `BUILD_RULES` below).
 */
export type BuildTier = 'budget' | 'middle' | 'top'
export const BUILD_TIERS: BuildTier[] = ['budget', 'middle', 'top']

/**
 * Recoil counts more than ergonomics (owner, 18.10.2026: «ориентируйся не только на эргономику, но и на отдачу… не только
 * эргономика должна преобладать»): ergonomics parts are cheap, so with 1 : 0.35 the cheaper builds raised only ergonomics.
 */
export const RECOIL_WEIGHT = 1.2
export const ERGO_WEIGHT = 0.35
/** The game shows no ergonomics above 100: a build's ergonomics past it earns nothing (`cappedScore`). */
const ERGO_CAP = 100
/**
 * Of two builds this close in score the cheaper one is taken (owner: «если значение незначительное, ставь более дешёвую
 * или доступную»).
 */
export const SMALL_GAIN = 1
/** Flea offers count this much dearer while choosing parts: of two nearly equal parts the trader's one wins. */
const FLEA_CHOICE_FACTOR = 1.1
/** The price limits of the cheaper tiers, the whole build (roubles). */
export const TIER_LIMITS: Record<Exclude<BuildTier, 'top'>, number> = { budget: 100_000, middle: 200_000 }
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
interface Point { cost: number; score: number; ergo: number; picks: Choice[]; items: ReadonlySet<string>; blocks: ReadonlySet<string> }

const NONE: ReadonlySet<string> = new Set()
const EMPTY: Point = { cost: 0, score: 0, ergo: 0, picks: [], items: NONE, blocks: NONE }

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

/*
 * BUILD_RULES — the owner's rules for the builds (28.10.2026):
 * - «Прицелы никогда в сборках не учитывай… Коллиматоры не выбирай никогда»: no sight, scope or iron sight is chosen
 *   (SIGHT_CATEGORY), and a mount is put on only when it carries a part (a rail with a foregrip).
 * - «Всегда в сборках должна быть крышка ствольной коробки с планкой под прицел»: when a receiver slot offers parts with
 *   a scope rail (an AK: Бастион, FAB Defense PDC, TWS Dog Leg Rail, Б-33), the build always takes one of them.
 * - «на цевье всегда ставится направляющая… на это направляющую ставится рукоятка… накладка стоппер — это говно»: no
 *   handstops (HANDSTOP), and a foregrip counts FOREGRIP_BONUS more, so the handguard gets a rail and a grip on it.
 * - «в топ-сборках всегда использую рукоятки, у которых меньше всего отдачи. На эргономику не смотри»: in the top build
 *   foregrips and pistol grips are scored by recoil alone.
 * - Топ: pistol grip + buffer tube + stock, no one-piece grip-stock; the tube Strike Industries ARE and the stock Magpul
 *   PRS GEN3 wherever they fit (PREFERRED). Charging handle: Radian Weapons on an AR-15, CSS on a Kalashnikov in the top
 *   build. ПТ-3 over ПТ-1 always (AVOIDED).
 */
const SIGHT_CATEGORY = /(sight|scope)/i
const HANDSTOP = /(стоппер|hand ?stop)/i
const FOREGRIP_SLOT = /^mod_foregrip/
const RECEIVER_SLOT = /^mod_reciever/
const RAIL_SLOT = /^mod_scope/
const FOREGRIP_BONUS = 12
const PREFERRED_BONUS = 25
/** Parts the owner named, by id (every colour), with the tiers they are wanted in. */
const PREFERRED: Array<{ ids: string[]; tiers: BuildTier[] }> = [
  // Magpul PRS GEN3 (black, grey)
  { ids: ['5d44069ca4b9361ebd26fc37', '5d4406a8a4b9361e4f6eb8b7'], tiers: ['top'] },
  // Strike Industries Advanced Receiver Extension (black, anodized red)
  { ids: ['5c793fb92e221644f31bfb64', '5c793fc42e221600114ca25d'], tiers: ['top'] },
  // Radian Weapons Raptor (FDE, Tungsten Grey), Raptor-SD
  { ids: ['5b2240bf5acfc40dc528af69', '5d44334ba4b9362b346d1948', '6895bf08e2d16810ba0bf43e'], tiers: ['budget', 'middle', 'top'] },
  // CSS knurled charging handle for AK
  { ids: ['6130ca3fd92c473c77020dbd'], tiers: ['top'] },
]
/** A part never taken while its better twin is in the catalog: ПТ-1 → ПТ-3 «Классика» (another lock is taken for it). */
const AVOIDED: Array<{ id: string; whenOffered: string }> = [
  { id: '5b222d405acfc400153af4fe', whenOffered: '59ecc3dd86f7746dc827481c' },
]
const isSight = (part: GunPart) => SIGHT_CATEGORY.test(part.category ?? '')
const isHandstop = (part: GunPart, slot: GunSlot) => HANDSTOP.test(part.name) || HANDSTOP.test(part.shortName)
  || (FOREGRIP_SLOT.test(slot.nameId) && part.category === 'auxiliary-mod')
const hasRail = (part: GunPart | undefined) => !!part?.slots.some((child) => RAIL_SLOT.test(child.nameId))

/** The part's score in the tier, with the owner's rules (BUILD_RULES). */
export function ruleScore(part: GunPart, tier: BuildTier) {
  const grip = part.category === 'foregrip' || part.category === 'pistol-grip'
  let score = tier === 'top' && grip ? -part.recoilModifier * 100 * RECOIL_WEIGHT : partScore(part)
  if (part.category === 'foregrip') score += FOREGRIP_BONUS
  if (PREFERRED.some((rule) => rule.tiers.includes(tier) && rule.ids.includes(part.id))) score += PREFERRED_BONUS
  return score
}
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

/** The price a part is chosen by: flea offers FLEA_CHOICE_FACTOR dearer (the build's cost uses the real prices). */
const choiceMemo = new WeakMap<GunPart, GunPart>()
function choicePrice(part: GunPart, access: PurchaseAccess) {
  let weighted = choiceMemo.get(part)
  if (!weighted) {
    const priced = dayPriced(part)
    weighted = { ...priced, offers: priced.offers.map((offer) => offer.vendor === 'flea-market' ? { ...offer, priceRUB: offer.priceRUB * FLEA_CHOICE_FACTOR } : offer) }
    choiceMemo.set(part, weighted)
  }
  return cheapestOffer(weighted, access)?.priceRUB
}

/** Price of one part under the access, or undefined when nobody sells it. */
function priceOf(part: GunPart, access: PurchaseAccess) {
  return buildOffer(part, access)?.priceRUB
}

/**
 * Pareto front of a slot / an item subtree. Memo per solve; `trail` stops an item from being mounted into itself.
 */
function makeSolver(catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess, banned: Set<string>, minCapacity: number, included: ReadonlySet<string>, tier: BuildTier) {
  const itemMemo = new Map<string, Point[]>()

  const itemFront = (part: GunPart, depth: number, trail: Set<string>): Point[] => {
    const key = `${part.id}:${depth >= MAX_DEPTH ? 'x' : ''}`
    const known = itemMemo.get(key)
    if (known) return known
    let front: Point[] = [EMPTY]
    if (depth < MAX_DEPTH) {
      trail.add(part.id)
      // A grip-stock takes the stock slot beside it (src/arsenal/buildModel.ts isGripStock): the grip and the stock are
      // chosen together — an ordinary grip with a tube and its stock, or a grip-stock with the stock slot left empty.
      const grip = part.slots.find((slot) => GRIP_SLOT.test(slot.nameId))
      const stock = grip && part.slots.find((slot) => slot.nameId === STOCK_SLOT)
      for (const slot of part.slots) {
        if (SIGHT_SLOTS.test(slot.nameId) && !slot.required) continue
        if (stock && (slot === grip || slot === stock)) continue
        const slotPoints = slotFront(slot, depth + 1, trail)
        if (!slotPoints) { front = []; break }
        front = combine(front, slotPoints)
      }
      if (stock && front.length) {
        const ordinary = slotFront(grip!, depth + 1, trail, (id) => !isGripStock(catalog.mods.get(id), grip!.nameId))
        const stocks = slotFront(stock, depth + 1, trail)
        const together = ordinary && stocks ? combine(ordinary, stocks) : []
        // The top build is a grip, a tube and a stock: no one-piece grip-stock (BUILD_RULES).
        const onepiece = tier === 'top' ? [] : slotFront(grip!, depth + 1, trail, (id) => isGripStock(catalog.mods.get(id), grip!.nameId)) ?? []
        const pair = prunePoints([...together, ...onepiece.filter((point) => point !== EMPTY)])
        front = pair.length ? combine(front, pair) : []
      }
      trail.delete(part.id)
    }
    itemMemo.set(key, front)
    return front
  }

  /** Undefined when a required slot has nothing buyable. */
  const slotFront = (slot: GunSlot, depth: number, trail: Set<string>, only?: (id: string) => boolean): Point[] | undefined => {
    // A magazine costs ergonomics, so it would be left out; a weapon is never built without one.
    const magazine = MAGAZINE_SLOT.test(slot.nameId)
    // A receiver cover with a scope rail, when the slot has one (BUILD_RULES).
    const railCover = RECEIVER_SLOT.test(slot.nameId) && slot.allowed.some((id) => { const part = catalog.mods.get(id); return !banned.has(id) && hasRail(part) && (included.has(id) || choicePrice(part!, access) !== undefined) })
    const options: Point[] = slot.required || magazine || railCover ? [] : [EMPTY]
    for (const id of slot.allowed) {
      if (banned.has(id) || trail.has(id) || (only && !only(id))) continue
      const part = catalog.mods.get(id)
      if (!part) continue
      if (railCover && !hasRail(part)) continue
      if (!slot.required && isSight(part)) continue
      if (isHandstop(part, slot)) continue
      if (AVOIDED.some((rule) => rule.id === id && catalog.mods.has(rule.whenOffered) && !banned.has(rule.whenOffered))) continue
      // Standard magazines only: at least the default capacity, no drums or casket magazines beyond 30 rounds (or the
      // default when it is larger) — streamer builds use 30-round mags, drums only in fun builds.
      if (magazine && ((part.capacity ?? 0) < minCapacity || (part.capacity ?? 0) > Math.max(minCapacity, STANDARD_MAGAZINE))) continue
      const price = included.has(id) ? 0 : choicePrice(part, access)
      if (price === undefined) continue
      const own = ruleScore(part, tier)
      const self: Point = { ...EMPTY, items: new Set([id]), blocks: new Set(part.conflicts) }
      // A bare mount (a sight mount, a rail with nothing on it) is left out.
      const bareMount = /mount/i.test(part.category ?? '') && !slot.required
      for (const sub of itemFront(part, depth, trail)) {
        if (clash(self, sub) || (bareMount && !sub.picks.length)) continue
        options.push({ cost: price + sub.cost, score: own + sub.score, ergo: part.ergonomics + sub.ergo, picks: [{ slot: slot.nameId, itemId: id, sub }], items: union(self.items, sub.items), blocks: union(self.blocks, sub.blocks) })
      }
    }
    if (!options.length) return slot.required ? undefined : [EMPTY]
    return prunePoints(options)
  }

  return { itemFront }
}

/** Every combination of two independent slot fronts that may stand together, pruned (parts are joined only for the kept ones). */
function combine(a: Point[], b: Point[]): Point[] {
  if (a.length === 1 && a[0] === EMPTY) return b
  const pairs: Array<{ cost: number; score: number; left: Point; right: Point }> = []
  for (const left of a) for (const right of b) if (!clash(left, right)) pairs.push({ cost: left.cost + right.cost, score: left.score + right.score, left, right })
  return prunePoints(pairs.map(({ cost, score, left, right }) => ({
    cost, score, ergo: left.ergo + right.ergo, picks: [...left.picks, ...right.picks], items: union(left.items, right.items), blocks: union(left.blocks, right.blocks),
  })))
}

/**
 * `prune` for parts that may block others: a point only drops one that blocks at least as much. A one-piece grip-stock
 * (ADAR wooden stock, HERA CQR: cheap and strong, but no stock can go with it) dominated every ordinary pistol grip in
 * the grip slot, so grip + tube + stock was never even tried (owner, 18.10.2026: «M4, приклад — предлагает то же
 * самое»; the separate set was both cheaper and better). Points are kept per set of blocked parts; one blocking
 * nothing still drops a worse, dearer one of any set.
 */
function prunePoints(points: Point[]): Point[] {
  const groups = new Map<string, Point[]>()
  for (const point of points) {
    const key = point.blocks.size ? [...point.blocks].sort().join(',') : ''
    const group = groups.get(key)
    if (group) group.push(point)
    else groups.set(key, [point])
  }
  if (groups.size === 1) return prune(points)
  const free = prune(groups.get('') ?? [])
  const blocking = [...groups.entries()].filter(([key]) => key).flatMap(([, group]) => prune(group))
    .filter((point) => !free.some((other) => other.cost <= point.cost && other.score >= point.score))
  return [...free, ...blocking]
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
export function pickTier<T extends { cost: number; score: number }>(front: T[], tier: BuildTier, limit?: number): T | undefined {
  const chosen = pickTierPoint(front, tier, limit)
  // The cheapest build at most SMALL_GAIN behind (the front is ordered by price, score rising).
  return chosen && (front.find((point) => point.cost <= chosen.cost && point.score >= chosen.score - SMALL_GAIN) ?? chosen)
}

/** The best build within the tier's limit (or the limit given); with none that cheap, the cheapest one. */
function pickTierPoint<T extends { cost: number; score: number }>(front: T[], tier: BuildTier, limit?: number): T | undefined {
  if (!front.length) return undefined
  if (tier === 'top' && limit === undefined) return front[front.length - 1]
  const most = limit ?? TIER_LIMITS[tier as Exclude<BuildTier, 'top'>]
  const within = front.filter((point) => point.cost <= most)
  return within.length ? within[within.length - 1] : front[0]
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

/** The three builds of a weapon (a tier is missing when no buildable set of parts exists under the access). */
export function solveTieredBuilds(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, options: SolveOptions = {}): TieredBuild[] {
  return BUILD_TIERS.flatMap((tier) => solveTier(weapon, catalog, tier, options) ?? [])
}

/**
 * Conflicts are settled both ways this deep: a one-piece grip-stock (ADAR wooden stock, HERA CQR on the M4) against the
 * stock of the buffer tube is solved once without the grip-stock and once without the stock, and the better build is
 * kept (owner, 18.10.2026: «зашёл в M4, приклад — предлагает то же самое»). Banning only the stock, one after another,
 * left the tube bare and never compared grip + tube + stock with the one-piece part. Deeper conflicts drop one side.
 */
const CONFLICT_BRANCH_DEPTH = 2

export function solveTier(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, options: SolveOptions = {}): TieredBuild | undefined {
  return solveTierBranch(weapon, catalog, tier, options.access ?? FULL_ACCESS, new Set(options.banned ?? []), 0)
}

function solveTierBranch(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, access: PurchaseAccess, banned: Set<string>, depth: number): TieredBuild | undefined {
  const minCapacity = defaultMagazineCapacity(weapon, catalog)
  const presetItem = weapon.defaultPreset ? catalog.mods.get(weapon.defaultPreset.id) : undefined
  const purchases: Array<{ purchase: WeaponPurchase; price: number; included: ReadonlySet<string> }> = []
  const weaponPrice = priceOf(weapon, access)
  if (weaponPrice !== undefined) purchases.push({ purchase: 'weapon', price: weaponPrice, included: NONE })
  const presetPrice = presetItem ? priceOf(presetItem, access) : undefined
  if (presetPrice !== undefined) purchases.push({ purchase: 'preset', price: presetPrice, included: new Set(weapon.defaultPreset!.itemIds) })
  if (!purchases.length) purchases.push({ purchase: 'found', price: 0, included: new Set(weapon.defaultPreset?.itemIds ?? []) })
  for (let attempt = 0; attempt < 24; attempt++) {
    // Ergonomics past ERGO_CAP earns nothing: the weapon's points are scored again with it capped.
    const capped = (point: Point) => point.score - ERGO_WEIGHT * Math.max(0, weapon.ergonomics + point.ergo - ERGO_CAP)
    const front = prune(purchases.flatMap(({ purchase, price, included }) => makeSolver(catalog, access, banned, minCapacity, included, tier)
      .itemFront(weapon, 0, new Set()).map((point) => ({ ...point, score: capped(point), cost: point.cost + price, purchase, included }))))
    const point = pickTier(front, tier)
    if (!point) return undefined
    const build: Build = { weaponId: weapon.id, root: toNode(weapon.id, point) }
    const conflict = findConflict(build, weapon, catalog)
    if (conflict) {
      const sides = conflict.filter((id) => id !== weapon.id)
      if (sides.length === 2 && depth < CONFLICT_BRANCH_DEPTH) {
        // Both ways, the better build wins (pickTier: the same rule that chose the point).
        const builds = sides.flatMap((id) => solveTierBranch(weapon, catalog, tier, access, new Set([...banned, id]), depth + 1) ?? [])
        return pickTier(prune(builds.map((option) => ({ option, cost: option.cost.total, score: option.score }))), tier)?.option
      }
      // Drop the conflicting part that is not the weapon and try again without it.
      banned.add(sides[0]!)
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
