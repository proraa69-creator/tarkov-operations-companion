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
 * лучшее»), priced by its parts only, without the weapon (owner, 01.11.2026: «в топ сборок цена должна писаться только за
 * модули, без цены за само оружие»):
 * - budget: the best build up to TIER_LIMITS.budget (100 000 ₽);
 * - middle: the best build up to TIER_LIMITS.middle (200 000 ₽);
 * - top: the best build there is, whatever it costs.
 * Recoil comes first, ergonomics second (RECOIL_WEIGHT, ERGO_WEIGHT); a part and what goes on it are scored together, so
 * a muzzle brake that takes a suppressor, or a handguard rail that takes a foregrip, wins over a part that is better alone
 * when the pair is better. Ammo and sights are not chosen: the player picks the round and the optic. The magazine keeps at
 * least the default preset's capacity. The owner's rules on top of the score (28.10.2026, `BUILD_RULES` below).
 *
 * After the solve (owner, 02.11.2026): the money a cheaper tier leaves under its limit buys upgrades (`spendTheRest`), and
 * every part is swapped for a cheaper one of the same place that is no worse (`cheaperAnalogs`). The owner's own build of
 * a weapon and tier (src/arsenal/ownerBuilds.ts) is shown instead of the solved one, and what his edits taught leans the
 * solver his way on every weapon (`SolveOptions.learned`, LEARNED_POINTS).
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
/** The price limits of the cheaper tiers, the parts without the weapon (roubles). */
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
  /** Lines: the weapon (or its preset) first; parts that came with the preset have `included`. `total`: the parts only. */
  cost: TieredCost
  score: number
  purchase: WeaponPurchase
  /** Set by the owner (his build of the weapon and tier), not solved. */
  owner?: boolean
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
 *   handstops (HANDSTOP), and a foregrip counts FOREGRIP_BONUS more (half of it straight on the handguard, without a
 *   rail), so the handguard gets a rail and a grip on it.
 * - «в топ-сборках всегда использую рукоятки, у которых меньше всего отдачи. На эргономику не смотри», later «на рукоятках
 *   всегда… которые… уменьшают отдачу больше всех»: in every build foregrips and pistol grips are scored by recoil alone.
 * - Every build: pistol grip + buffer tube + stock, no one-piece grip-stock (owner, 01.11.2026, for «до 100 000 ₽» too: «пистолетная
 *   рукоятка… поменять приклад»). Топ: the tube Strike Industries ARE and the stock Magpul
 *   PRS GEN3 wherever they fit (PREFERRED). Charging handle: Radian Weapons on an AR-15, CSS on a Kalashnikov in the top
 *   build. ПТ-3 over ПТ-1 always (AVOIDED).
 */
const SIGHT_CATEGORY = /(sight|scope)/i
const HANDSTOP = /(стоппер|hand ?stop)/i
const FOREGRIP_SLOT = /^mod_foregrip/
const RECEIVER_SLOT = /^mod_reciever/
const RAIL_SLOT = /^mod_scope/
const FOREGRIP_BONUS = 20
const PREFERRED_BONUS = 25
const GRIP_ERGO_TIE = 0.01
/**
 * A part many times dearer than another for the same slot is not taken for a small gain (owner, 01.11.2026: «если какой
 * то из модулей стоит в разы больше, например рукоятка заряжания Radian для m4a1… 300000р… если параметр отличается от
 * более дешевого аналога на 0.5-1%… приоритет на более дешевую запчасть», then «только когда цена различается более чем на
 * 70 тысяч»): more than DEAR_MIN_RUB dearer, for at most SMALL_PART_GAIN of score (about 1 % recoil or 4 ergonomics). Parts with slots of their own are
 * compared by what goes on them, so only parts without slots are weighed this way.
 */
const DEAR_MIN_RUB = 70_000
const SMALL_PART_GAIN = 1.5
/**
 * In «до 100 000 ₽» and «до 200 000 ₽» a part is too dear already at DEAR_FACTOR times the price of one hardly worse
 * (owner, 01.11.2026: «если модули сильно дороже, нужно выбирать более дешевый но не много хуже по параметрам»), when
 * the difference is more than DEAR_MIN_RUB_TIER.
 */
const DEAR_FACTOR = 2
const DEAR_MIN_RUB_TIER = 3_000
const tooDearFor = (tier: BuildTier, price: number, otherPrice: number) => price - otherPrice > DEAR_MIN_RUB
  || (tier !== 'top' && price > otherPrice * DEAR_FACTOR && price - otherPrice > DEAR_MIN_RUB_TIER)
/**
 * The handguard and the receiver with the most ergonomics and the least recoil there is, the barrel with the least recoil
 * (owner, 02.11.2026: «проверяй что бы цевье и ресивер ставились с максимальной эргономикой и - отдачей если есть. и еще
 * смотри стволы что бы была меньше отдача»): their own stats count OWN_WEIGHT times.
 */
const OWN_WEIGHT: Array<{ kind: RegExp; recoil: number; ergo: number }> = [
  { kind: /^(handguard|receiver)$/, recoil: 2, ergo: 2 },
  { kind: /^barrel$/, recoil: 2, ergo: 1 },
]
/**
 * What the owner's own builds taught (owner, 02.11.2026: «должен запоминать что я меняю и делать выводы, как лучше
 * собирать в будущем»): a part he put in where the app had another gets LEARNED_POINTS per time, one he took out loses
 * them, at most LEARNED_MAX times either way — on every weapon it fits.
 */
export const LEARNED_POINTS = 4
const LEARNED_MAX = 3
/** Parts the owner named, by id (every colour), with the tiers they are wanted in. */
const PREFERRED: Array<{ ids: string[]; tiers: BuildTier[] }> = [
  // Magpul PRS GEN3 (black, grey)
  { ids: ['5d44069ca4b9361ebd26fc37', '5d4406a8a4b9361e4f6eb8b7'], tiers: ['top'] },
  // Strike Industries Advanced Receiver Extension (black, anodized red)
  { ids: ['5c793fb92e221644f31bfb64', '5c793fc42e221600114ca25d'], tiers: ['top'] },
  // Radian Weapons Raptor (FDE, Tungsten Grey); not the Raptor-SD — 100…300 thousand for +0.5 ergonomics (DEAR_MIN_RUB)
  { ids: ['5b2240bf5acfc40dc528af69', '5d44334ba4b9362b346d1948'], tiers: ['budget', 'middle', 'top'] },
  // CSS knurled charging handle for AK
  { ids: ['6130ca3fd92c473c77020dbd'], tiers: ['top'] },
]
/**
 * The limit of a cheaper tier spread over the parts (owner, 01.11.2026: «до 100к, мы берем всегда по возможности цевье с
 * возможностью поставить рукоятку, можно не самую дорогую, но которую позволяет бюджет, так же пистолетная рукоятка… по
 * возможности поменять приклад, если он лучше штатного… и какой то дешевый дульник, распредели эти 100к и ищи средние
 * значения»): in «до 100 000 ₽» and «до 200 000 ₽» a part of these kinds costs at most its share of the limit, so the
 * budget goes to a handguard with a foregrip, a pistol grip, a stock and a muzzle device instead of one dear part. A slot
 * where nothing is that cheap keeps its cheapest parts. A muzzle device counts with what goes on it (adapter + brake +
 * suppressor), the other kinds alone (a handguard without its foregrip). The top build has no shares.
 */
export const TIER_SHARES: Array<{ kind: RegExp; share: number; chain?: boolean }> = [
  { kind: /^handguard$/, share: 0.25 },
  { kind: /^stock$/, share: 0.25 },
  { kind: /^foregrip$/, share: 0.12 },
  { kind: /^pistol-grip$/, share: 0.12 },
  { kind: /^(flashhider|comb-muzzle-device|muzzle-device|silencer)$/, share: 0.1, chain: true },
]
/** The most a part may cost in the tier (TIER_SHARES), or undefined when it has no share. */
export function tierShareLimit(part: Pick<GunPart, 'category'>, tier: BuildTier) {
  return tierShare(part, tier)?.most
}
function tierShare(part: Pick<GunPart, 'category'>, tier: BuildTier) {
  if (tier === 'top') return undefined
  const rule = TIER_SHARES.find((entry) => entry.kind.test(part.category ?? ''))
  return rule && { most: TIER_LIMITS[tier] * rule.share, chain: !!rule.chain }
}

/** A part never taken while its better twin is in the catalog: ПТ-1 → ПТ-3 «Классика» (another lock is taken for it). */
const AVOIDED: Array<{ id: string; whenOffered: string }> = [
  { id: '5b222d405acfc400153af4fe', whenOffered: '59ecc3dd86f7746dc827481c' },
]
const isSight = (part: GunPart) => SIGHT_CATEGORY.test(part.category ?? '')
const isHandstop = (part: GunPart, slot: GunSlot) => HANDSTOP.test(part.name) || HANDSTOP.test(part.shortName)
  || (FOREGRIP_SLOT.test(slot.nameId) && part.category === 'auxiliary-mod')
const hasRail = (part: GunPart | undefined) => !!part?.slots.some((child) => RAIL_SLOT.test(child.nameId))

/** The part's score in the tier, with the owner's rules (BUILD_RULES). */
export function ruleScore(part: GunPart, tier: BuildTier, learned?: ReadonlyMap<string, number>) {
  const grip = part.category === 'foregrip' || part.category === 'pistol-grip'
  const weight = OWN_WEIGHT.find((rule) => rule.kind.test(part.category ?? ''))
  // Grips by recoil alone, ergonomics only between grips of equal recoil (owner: «−3 лучше»).
  let score = grip ? -part.recoilModifier * 100 * RECOIL_WEIGHT + part.ergonomics * GRIP_ERGO_TIE
    : weight ? -part.recoilModifier * 100 * RECOIL_WEIGHT * weight.recoil + part.ergonomics * ERGO_WEIGHT * weight.ergo
      : partScore(part)
  if (part.category === 'foregrip') score += FOREGRIP_BONUS
  if (isPreferred(part.id, tier)) score += PREFERRED_BONUS
  const taught = learned?.get(part.id)
  if (taught) score += Math.max(-LEARNED_MAX, Math.min(LEARNED_MAX, taught)) * LEARNED_POINTS
  return score
}
const isPreferred = (id: string, tier: BuildTier) => PREFERRED.some((rule) => rule.tiers.includes(tier) && rule.ids.includes(id))
export interface SolveOptions {
  access?: PurchaseAccess
  /** Items never to use (a conflict found after solving, see `solveTier`). */
  banned?: Set<string>
  /** The owner's own builds of this weapon by tier (src/arsenal/ownerBuilds.ts): shown instead of the solved ones. */
  owner?: Partial<Record<BuildTier, Build>>
  /** What the owner's edits taught: part id → times he put it in (+) or took it out (−), every weapon. */
  learned?: ReadonlyMap<string, number>
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
function makeSolver(catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess, banned: Set<string>, minCapacity: number, included: ReadonlySet<string>, tier: BuildTier,
  learned?: ReadonlyMap<string, number>, shares = tier !== 'top') {
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
        const slotPoints = slotFront(slot, depth + 1, trail, undefined, part)
        if (!slotPoints) { front = []; break }
        front = combine(front, slotPoints)
      }
      if (stock && front.length) {
        const ordinary = slotFront(grip!, depth + 1, trail, (id) => !isGripStock(catalog.mods.get(id), grip!.nameId))
        const stocks = slotFront(stock, depth + 1, trail)
        const together = ordinary && stocks ? combine(ordinary, stocks) : []
        // A grip, a tube and a stock: a one-piece grip-stock only when the ordinary pair cannot be bought (BUILD_RULES).
        const onepiece = together.length ? [] : slotFront(grip!, depth + 1, trail, (id) => isGripStock(catalog.mods.get(id), grip!.nameId)) ?? []
        const pair = prunePoints([...together, ...onepiece.filter((point) => point !== EMPTY)])
        front = pair.length ? combine(front, pair) : []
      }
      trail.delete(part.id)
    }
    itemMemo.set(key, front)
    return front
  }

  /** Undefined when a required slot has nothing buyable. */
  const slotFront = (slot: GunSlot, depth: number, trail: Set<string>, only?: (id: string) => boolean, owner?: GunPart): Point[] | undefined => {
    // A magazine costs ergonomics, so it would be left out; a weapon is never built without one.
    const magazine = MAGAZINE_SLOT.test(slot.nameId)
    // A receiver cover with a scope rail, when the slot has one (BUILD_RULES).
    const railCover = RECEIVER_SLOT.test(slot.nameId) && slot.allowed.some((id) => { const part = catalog.mods.get(id); return !banned.has(id) && hasRail(part) && (included.has(id) || choicePrice(part!, access) !== undefined) })
    const options: Point[] = slot.required || magazine || railCover ? [] : [EMPTY]
    // Parts without slots of their own, with their price: the dear ones gaining little are left out (DEAR_MIN_RUB).
    const leaves = slot.allowed.flatMap((id) => {
      const part = catalog.mods.get(id)
      if (!part || part.slots.length || banned.has(id)) return []
      const price = included.has(id) ? 0 : choicePrice(part, access)
      // grips by recoil, as they are chosen (BUILD_RULES)
      const grip = part.category === 'foregrip' || part.category === 'pistol-grip'
      return price === undefined ? [] : [{ id, price, score: grip ? -part.recoilModifier * 100 * RECOIL_WEIGHT : partScore(part) }]
    })
    // Parts the owner named (PREFERRED) stay.
    const tooDear = (id: string) => {
      const own = leaves.find((leaf) => leaf.id === id)
      return !!own && !isPreferred(id, tier) && leaves.some((other) => tooDearFor(tier, own.price, other.price) && own.score - other.score <= SMALL_PART_GAIN)
    }
    // Over its share of the tier's limit (TIER_SHARES) while the slot has a part of that kind within it.
    const overShare = (id: string, part: GunPart) => {
      const share = shares ? tierShare(part, tier) : undefined
      if (!share || share.chain || included.has(id)) return false
      const most = share.most
      if ((choicePrice(part, access) ?? 0) <= most) return false
      return slot.allowed.some((other) => {
        const candidate = catalog.mods.get(other)
        if (!candidate || banned.has(other) || candidate.category !== part.category) return false
        const price = included.has(other) ? 0 : choicePrice(candidate, access)
        return price !== undefined && price <= most
      })
    }
    for (const id of slot.allowed) {
      if (banned.has(id) || trail.has(id) || (only && !only(id)) || tooDear(id)) continue
      const part = catalog.mods.get(id)
      if (!part) continue
      if (railCover && !hasRail(part)) continue
      if (overShare(id, part)) continue
      if (!slot.required && isSight(part)) continue
      if (isHandstop(part, slot)) continue
      if (AVOIDED.some((rule) => rule.id === id && catalog.mods.has(rule.whenOffered) && !banned.has(rule.whenOffered))) continue
      // Standard magazines only: at least the default capacity, no drums or casket magazines beyond 30 rounds (or the
      // default when it is larger) — streamer builds use 30-round mags, drums only in fun builds.
      if (magazine && ((part.capacity ?? 0) < minCapacity || (part.capacity ?? 0) > Math.max(minCapacity, STANDARD_MAGAZINE))) continue
      const price = included.has(id) ? 0 : choicePrice(part, access)
      if (price === undefined) continue
      // A foregrip straight on the handguard counts half the bonus of one on a rail (BUILD_RULES).
      const own = ruleScore(part, tier, learned) - (part.category === 'foregrip' && !/mount/i.test(owner?.category ?? '') ? FOREGRIP_BONUS / 2 : 0)
      const self: Point = { ...EMPTY, items: new Set([id]), blocks: new Set(part.conflicts) }
      // A bare mount (a sight mount, a rail with nothing on it) is left out.
      const bareMount = /mount/i.test(part.category ?? '') && !slot.required
      for (const sub of itemFront(part, depth, trail)) {
        if (clash(self, sub) || (bareMount && !sub.picks.length)) continue
        options.push({ cost: price + sub.cost, score: own + sub.score, ergo: part.ergonomics + sub.ergo, picks: [{ slot: slot.nameId, itemId: id, sub }], items: union(self.items, sub.items), blocks: union(self.blocks, sub.blocks) })
      }
    }
    if (!options.length) return slot.required ? undefined : [EMPTY]
    return prunePoints(withinChainShare(options))
  }

  /** A muzzle device with what goes on it within its share (TIER_SHARES), when any of the slot's choices is. */
  const withinChainShare = (options: Point[]) => {
    const most = (point: Point) => {
      const part = point.picks[0] && catalog.mods.get(point.picks[0].itemId)
      const share = part && shares ? tierShare(part, tier) : undefined
      return share?.chain ? share.most : undefined
    }
    const over = (point: Point) => { const limit = most(point); return limit !== undefined && point.cost > limit }
    return options.some((point) => most(point) !== undefined && !over(point)) ? options.filter((point) => !over(point)) : options
  }

  return { itemFront, slotFront }
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
  // The cheapest build at most SMALL_GAIN behind (the front is ordered by price, score rising); the top build is the
  // best one, every small gain counted (owner, 28.10.2026: СВД — шасси SAG MK1, «Ротор 43» on its adapter).
  if (tier === 'top' && limit === undefined) return chosen
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

/** One part of a fixed build, with what goes in its slots (by slot nameId). */
const fixed = (itemId: string, children: Record<string, BuildNode> = {}): BuildNode => ({ itemId, children })

/**
 * Top builds the owner assembled himself, shown to every player instead of the solved one (owner, 28.10.2026: «сборку для
 * СВД сделай по моей сборке, как у меня сейчас собрано в моем профиле… Топовая сборка… для всех»). Part ids from his saved
 * «СВД» build in «Сборка оружия». A part the catalog no longer has, or a slot that no longer takes it, falls back to the
 * solved top build.
 */
export const OWNER_TOP_BUILDS: Record<string, Record<string, BuildNode>> = {
  // СВДС
  '5c46fbd72e2216398b5a8c9c': {
    // Рысь adapter for AK grips + Aeroknox Scorpius
    mod_pistol_grip: fixed('6516b129609aaf354b34b3a8', { mod_pistolgrip: fixed('5f6341043ada5942720e2dc5') }),
    mod_magazine: fixed('5c471c442e221602b542a6f8'),
    // Рысь «Шарнир СВД-С» + Strike Industries ARE + Magpul PRS GEN3 (grey)
    mod_stock: fixed('6197b229af1f5202c57a9bea', { mod_stock: fixed('5c793fb92e221644f31bfb64', { mod_stock_000: fixed('5d4406a8a4b9361e4f6eb8b7') }) }),
    // 565 mm barrel; the СВДС brake, the «Ротор 43» adapter and the Ротор 43; the gas tube
    mod_barrel: fixed('5c471cb32e221602b177afaa', {
      mod_muzzle: fixed('5c471bfc2e221602b21d4e17', { mod_muzzle: fixed('5e01e9e273d8eb11426f5bc3', { mod_muzzle: fixed('5e01ea19e9dc277128008c0b') }) }),
      mod_gas_block: fixed('5c471c842e221615214259b5'),
    }),
    // SAG MK1 chassis; Strike Industries 6" KeyMod rail; TangoDown BGV-QDITI
    mod_mount_001: fixed('5dfcd0e547101c39625f66f9', { mod_foregrip: fixed('5a9d6d13a2750c00164f6b03', { mod_foregrip: fixed('661e52e29c8b4dadef008577') }) }),
    // the cut-down receiver cover
    mod_reciever: fixed('5dfce88fe9dc277128008b2e'),
  },
}

/** Whether every part of a fixed build exists and sits in a slot that takes it. */
function fitsFixed(part: GunPart, children: Record<string, BuildNode>, catalog: Pick<GunCatalog, 'mods'>): boolean {
  return Object.entries(children).every(([slotId, node]) => {
    const slot = part.slots.find((entry) => entry.nameId === slotId)
    const child = catalog.mods.get(node.itemId)
    return !!slot && !!child && slot.allowed.includes(node.itemId) && fitsFixed(child, node.children, catalog)
  })
}

/**
 * A build the owner set (his builds of 02.11.2026 by weapon and tier, src/arsenal/ownerBuilds.ts; OWNER_TOP_BUILDS),
 * bought the cheaper way (the weapon, or its preset).
 */
function fixedBuild(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, access: PurchaseAccess, children: Record<string, BuildNode> | undefined, learned?: ReadonlyMap<string, number>): TieredBuild | undefined {
  if (!children || !fitsFixed(weapon, children, catalog)) return undefined
  const build: Build = { weaponId: weapon.id, root: { itemId: weapon.id, children: structuredClone(children) } }
  const presetItem = weapon.defaultPreset ? catalog.mods.get(weapon.defaultPreset.id) : undefined
  const options: Array<{ purchase: WeaponPurchase; included: ReadonlySet<string> }> = []
  if (priceOf(weapon, access) !== undefined) options.push({ purchase: 'weapon', included: NONE })
  if (presetItem && priceOf(presetItem, access) !== undefined) options.push({ purchase: 'preset', included: new Set(weapon.defaultPreset!.itemIds) })
  if (!options.length) options.push({ purchase: 'found', included: new Set(weapon.defaultPreset?.itemIds ?? []) })
  const priced = options.map((option) => ({ ...option, cost: buildCost(build, weapon, catalog, access, option.purchase, presetItem, option.included) }))
  const best = priced.sort((a, b) => a.cost.total - b.cost.total)[0]!
  return { tier, build, stats: computeStats(build, weapon, catalog), cost: best.cost, score: buildScore(build, weapon, catalog, tier, learned), purchase: best.purchase, owner: true }
}

export function solveTier(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, options: SolveOptions = {}): TieredBuild | undefined {
  const access = options.access ?? FULL_ACCESS
  const own = fixedBuild(weapon, catalog, tier, access, options.owner?.[tier]?.root.children ?? (tier === 'top' ? OWNER_TOP_BUILDS[weapon.id] : undefined), options.learned)
  if (own) return own
  return solveTierBranch(weapon, catalog, tier, access, new Set(options.banned ?? []), 0, options.learned)
}

function solveTierBranch(weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, access: PurchaseAccess, banned: Set<string>, depth: number, learned?: ReadonlyMap<string, number>): TieredBuild | undefined {
  const minCapacity = defaultMagazineCapacity(weapon, catalog)
  const presetItem = weapon.defaultPreset ? catalog.mods.get(weapon.defaultPreset.id) : undefined
  // The weapon itself is not priced: a preset costs only what it costs over the bare weapon (its parts).
  const purchases: Array<{ purchase: WeaponPurchase; price: number; included: ReadonlySet<string> }> = []
  const weaponPrice = priceOf(weapon, access)
  if (weaponPrice !== undefined) purchases.push({ purchase: 'weapon', price: 0, included: NONE })
  const presetPrice = presetItem ? priceOf(presetItem, access) : undefined
  if (presetPrice !== undefined) purchases.push({ purchase: 'preset', price: Math.max(0, presetPrice - (weaponPrice ?? presetPrice)), included: new Set(weapon.defaultPreset!.itemIds) })
  if (!purchases.length) purchases.push({ purchase: 'found', price: 0, included: new Set(weapon.defaultPreset?.itemIds ?? []) })
  for (let attempt = 0; attempt < 24; attempt++) {
    // Ergonomics past ERGO_CAP earns nothing: the weapon's points are scored again with it capped.
    const capped = (point: Point) => point.score - ERGO_WEIGHT * Math.max(0, weapon.ergonomics + point.ergo - ERGO_CAP)
    const front = prune(purchases.flatMap(({ purchase, price, included }) => makeSolver(catalog, access, banned, minCapacity, included, tier, learned)
      .itemFront(weapon, 0, new Set()).map((point) => ({ ...point, score: capped(point), cost: point.cost + price, purchase, included }))))
    const point = pickTier(front, tier)
    if (!point) return undefined
    // No «Сборка до 100 000 ₽» that costs more: a weapon too dear for the limit has no such build (MDR, SPEAR, ПКМ…).
    if (tier !== 'top' && point.cost > TIER_LIMITS[tier]) return undefined
    const build: Build = { weaponId: weapon.id, root: toNode(weapon.id, point) }
    const conflict = findConflict(build, weapon, catalog)
    if (conflict) {
      const sides = conflict.filter((id) => id !== weapon.id)
      if (sides.length === 2 && depth < CONFLICT_BRANCH_DEPTH) {
        // Both ways, the better build wins (pickTier: the same rule that chose the point).
        const builds = sides.flatMap((id) => solveTierBranch(weapon, catalog, tier, access, new Set([...banned, id]), depth + 1, learned) ?? [])
        return pickTier(prune(builds.map((option) => ({ option, cost: option.cost.total, score: option.score }))), tier)?.option
      }
      // Drop the conflicting part that is not the weapon and try again without it.
      banned.add(sides[0]!)
      continue
    }
    // The rest of a cheaper tier's money, then the cheaper equal parts (owner, 02.11.2026).
    const bought = { purchase: point.purchase, presetItem, included: point.included }
    const spent = tier === 'top' ? build : spendTheRest(build, weapon, catalog, access, tier, banned, minCapacity, learned, bought)
    const final = cheaperAnalogs(spent, weapon, catalog, access, tier, banned, point.included)
    return { tier, build: final, stats: computeStats(final, weapon, catalog), cost: buildCost(final, weapon, catalog, access, point.purchase, presetItem, point.included), score: buildScore(final, weapon, catalog, tier, learned), purchase: point.purchase }
  }
  return undefined
}

/** The score of a part and what goes on it, as the solver counts it (a foregrip straight on a handguard: half its bonus). */
function nodeScore(node: BuildNode, part: GunPart, owner: GunPart | undefined, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, learned?: ReadonlyMap<string, number>): number {
  const own = ruleScore(part, tier, learned) - (part.category === 'foregrip' && !/mount/i.test(owner?.category ?? '') ? FOREGRIP_BONUS / 2 : 0)
  return Object.values(node.children).reduce((total, child) => {
    const childPart = catalog.mods.get(child.itemId)
    return childPart ? total + nodeScore(child, childPart, part, catalog, tier, learned) : total
  }, own)
}

/** A build's score (the solver's, ergonomics not capped): what tells two builds of one tier apart. */
export function buildScore(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, tier: BuildTier, learned?: ReadonlyMap<string, number>) {
  return nodeScore(build.root, weapon, undefined, catalog, tier, learned) - ruleScore(weapon, tier, learned)
}

interface Place { path: string[]; slot: GunSlot; parent: GunPart; node?: BuildNode; depth: number; trail: string[] }

/** Every place of the build a part goes: the weapon's slots and those of each installed part (sights left out). */
function places(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>): Place[] {
  const out: Place[] = []
  const visit = (node: BuildNode, part: GunPart, path: string[], trail: string[]) => {
    for (const slot of part.slots) {
      if (SIGHT_SLOTS.test(slot.nameId) && !slot.required) continue
      const child = node.children[slot.nameId]
      out.push({ path: [...path, slot.nameId], slot, parent: part, ...(child ? { node: child } : {}), depth: path.length + 1, trail: [...trail, part.id] })
      const childPart = child && catalog.mods.get(child.itemId)
      if (child && childPart) visit(child, childPart, [...path, slot.nameId], [...trail, part.id])
    }
  }
  visit(build.root, weapon, [], [])
  return out
}

/** The build with the place at `path` holding `node` (or emptied). */
function replaceAt(build: Build, path: string[], node: BuildNode | undefined): Build {
  const root = structuredClone(build.root)
  let parent = root
  for (const slotId of path.slice(0, -1)) parent = parent.children[slotId]!
  const last = path[path.length - 1]!
  if (node) parent.children[last] = node
  else delete parent.children[last]
  return { ...build, root }
}

/** Upgrades below this score are not worth the money (about 1 % recoil or 3 ergonomics). */
const UPGRADE_MIN_GAIN = 1

/**
 * The money a cheaper tier leaves under its limit buys upgrades (owner, 02.11.2026: «сборка за 100к и за 200к отличается
 * только одним ресивером хотя по деньгам еще есть запас, после сборки проверяй, есть ли какие то модули, не много дороже
 * но лучше. то есть сделал сборку, лимит денег остался, проверяй что можно улучшить на эту сумму»): place by place, the
 * best set of parts for it that the rest of the money pays for — the parts' shares of the limit (TIER_SHARES) no longer
 * hold — the biggest gain first, as long as one gains UPGRADE_MIN_GAIN.
 */
function spendTheRest(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess, tier: BuildTier, banned: Set<string>, minCapacity: number,
  learned: ReadonlyMap<string, number> | undefined, bought: { purchase: WeaponPurchase; presetItem: GunPart | undefined; included: ReadonlySet<string> }): Build {
  const limit = TIER_LIMITS[tier as Exclude<BuildTier, 'top'>]
  const solver = makeSolver(catalog, access, banned, minCapacity, bought.included, tier, learned, false)
  const total = (candidate: Build) => buildCost(candidate, weapon, catalog, access, bought.purchase, bought.presetItem, bought.included).total
  let current = build
  for (let round = 0; round < 16; round++) {
    if (total(current) >= limit) break
    let best: { build: Build; gain: number } | undefined
    for (const place of places(current, weapon, catalog)) {
      const part = place.node && catalog.mods.get(place.node.itemId)
      // a one-piece grip-stock and the stock beside it are chosen together by the solve, not here
      if (part && isGripStock(part, place.slot.nameId)) continue
      if (place.slot.nameId === STOCK_SLOT && Object.entries(place.parent === weapon ? current.root.children : {}).some(([slotId, node]) => GRIP_SLOT.test(slotId) && isGripStock(catalog.mods.get(node.itemId), slotId))) continue
      const now = place.node && part ? nodeScore(place.node, part, place.parent, catalog, tier, learned) : 0
      const only = GRIP_SLOT.test(place.slot.nameId) ? (id: string) => !isGripStock(catalog.mods.get(id), place.slot.nameId) : undefined
      const front = solver.slotFront(place.slot, place.depth, new Set(place.trail), only, place.parent)
      if (!front) continue
      for (const point of [...front].sort((a, b) => b.score - a.score)) {
        const gain = point.score - now
        if (gain < UPGRADE_MIN_GAIN || (best && gain <= best.gain)) break
        const pick = point.picks[0]
        const next = replaceAt(current, place.path, pick ? toNode(pick.itemId, pick.sub) : undefined)
        if (findConflict(next, weapon, catalog) || total(next) > limit) continue
        best = { build: next, gain }
        break
      }
    }
    if (!best) break
    current = best.build
  }
  return current
}

const GRIP_KINDS: ReadonlySet<string> = new Set(['foregrip', 'pistol-grip'])

/**
 * No worse than `part` in its place: the same kind, no more recoil and no less ergonomics — grips no more recoil, the
 * owner's grips go by recoil alone (BUILD_RULES) — the same magazine capacity, a suppressor for a suppressor, a scope rail
 * for a scope rail.
 */
function noWorse(other: GunPart, part: GunPart) {
  if (other.category !== part.category || other.recoilModifier > part.recoilModifier + 1e-9) return false
  if (!GRIP_KINDS.has(part.category ?? '') && other.ergonomics < part.ergonomics - 1e-9) return false
  return (other.capacity ?? 0) === (part.capacity ?? 0) && (!part.suppressor || !!other.suppressor) && (!hasRail(part) || hasRail(other))
}

/** Whether `other` takes what is on `node` now (every child in a slot of the same name) and leaves no required slot empty. */
function takesChildren(other: GunPart, node: BuildNode) {
  return Object.entries(node.children).every(([slotId, child]) => other.slots.some((slot) => slot.nameId === slotId && slot.allowed.includes(child.itemId)))
    && other.slots.every((slot) => !slot.required || !!node.children[slot.nameId])
}

/**
 * Every part for a cheaper one of the same place that is no worse (owner, 02.11.2026: «проверяй есть ли аналоги дешевле
 * такими же параметрами… сейчас рукоятка за 115к, а есть аналог дешевле с такими же параметрами»): `noWorse`, takes what
 * goes on it, stands with everything else, bought cheaper. The owner's named parts (PREFERRED) and what came with the
 * preset stay.
 */
function cheaperAnalogs(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess, tier: BuildTier, banned: Set<string>, included: ReadonlySet<string>): Build {
  const root = structuredClone(build.root)
  const ids = new Set(installedParts({ ...build, root }, catalog).map(({ part }) => part.id))
  const clashes = (other: GunPart, without: string) => other.conflicts.some((id) => id !== without && ids.has(id))
    || [...ids].some((id) => id !== without && catalog.mods.get(id)?.conflicts.includes(other.id))
  const visit = (node: BuildNode, owner: GunPart) => {
    for (const [slotId, child] of Object.entries(node.children)) {
      const slot = owner.slots.find((entry) => entry.nameId === slotId)
      const part = catalog.mods.get(child.itemId)
      if (!slot || !part) continue
      const price = included.has(part.id) || isPreferred(part.id, tier) ? undefined : buildOffer(part, access)?.priceRUB
      let best: { id: string; price: number } | undefined
      if (price !== undefined) for (const id of slot.allowed) {
        const other = id === part.id || banned.has(id) ? undefined : catalog.mods.get(id)
        if (!other || !noWorse(other, part) || !takesChildren(other, child) || clashes(other, part.id) || isHandstop(other, slot) || (isSight(other) && !slot.required)) continue
        if (AVOIDED.some((rule) => rule.id === id && catalog.mods.has(rule.whenOffered))) continue
        const otherPrice = buildOffer(other, access)?.priceRUB
        if (otherPrice !== undefined && otherPrice < price && (!best || otherPrice < best.price)) best = { id, price: otherPrice }
      }
      if (best) {
        ids.delete(part.id)
        ids.add(best.id)
        child.itemId = best.id
      }
      visit(child, catalog.mods.get(child.itemId)!)
    }
  }
  visit(root, weapon)
  return { ...build, root }
}

/**
 * What the build costs bought this way: the lines are the weapon or its preset, then every part that did not come with it;
 * the total is the parts only — the added ones and, for a preset, what it costs over the bare weapon.
 */
function presetParts(first: TieredLine, weapon: Weapon, access: PurchaseAccess) {
  const price = first.offer?.priceRUB
  return price === undefined || first.part.id === weapon.id ? 0 : Math.max(0, price - (priceOf(weapon, access) ?? price))
}

function buildCost(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess, purchase: WeaponPurchase, presetItem: GunPart | undefined, included: ReadonlySet<string>): TieredCost {
  const first = purchase === 'preset' && presetItem ? presetItem : weapon
  const lines: TieredLine[] = [purchase === 'found' ? { part: first } : { part: first, offer: buildOffer(first, access) }]
  for (const { part } of installedParts(build, catalog)) {
    lines.push(included.has(part.id) ? { part, included: true } : { part, offer: buildOffer(part, access) })
  }
  return {
    total: lines.slice(1).reduce((total, line) => total + (line.offer?.priceRUB ?? 0), 0) + presetParts(lines[0]!, weapon, access),
    lines,
    unavailable: lines.filter((line, index) => !line.offer && !line.included && !(index === 0 && purchase === 'found')).map((line) => line.part),
  }
}
