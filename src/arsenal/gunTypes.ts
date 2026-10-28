/**
 * Data model of the weapon builder («Сборщик оружия»). Built from tarkov.dev GraphQL (src/arsenal/gunQueries.ts).
 * Modifiers are fractions: recoilModifier −0.05 means −5 % recoil, accuracyModifier +0.1 means +10 % accuracy.
 */

/** Where a part can be bought: the flea market or a trader at a loyalty level. */
export interface GunOffer {
  /** 'flea-market' or the trader's normalized name (prapor, mechanic, …). */
  vendor: string
  vendorName: string
  priceRUB: number
  /** Trader loyalty level needed for this offer (traders only). */
  minTraderLevel?: number
  /** The trader's tarkov.dev id and portrait (traders only). */
  traderId?: string
  traderImage?: string
  /** A task that unlocks this offer (tarkov.dev `taskUnlock`): sold only after it is completed. */
  taskUnlock?: { id: string; name: string }
  /** How many a trader sells per restock (tarkov.dev `buyLimit`); traders only. */
  buyLimit?: number
}

export interface GunSlot {
  id: string
  /** Stable slot key inside its parent (mod_barrel, mod_mount_000, …). */
  nameId: string
  name: string
  required: boolean
  /** filters.allowedItems — the only items that fit this slot. */
  allowed: string[]
}

export interface GunPart {
  id: string
  name: string
  shortName: string
  iconLink?: string
  imageLink?: string
  /** The inventory picture (tarkov.dev grid image) and the size in inventory cells. */
  gridImageLink?: string
  /** The part's picture without background (tarkov.dev base image), for the «Сборка оружия» cells. */
  baseImageLink?: string
  width?: number
  height?: number
  weight: number
  ergonomics: number
  recoilModifier: number
  accuracyModifier: number
  /** Barrels only: centre of impact (tarkov.dev value, used for the approximate MOA). */
  centerOfImpact?: number
  /** Magazines only. */
  capacity?: number
  /** Muzzle velocity change in percent (tarkov.dev `velocity`: a short barrel −8, a suppressor +0.7). */
  velocity?: number
  /** Loudness change (suppressors −20…). */
  loudness?: number
  /** Sights only: the highest magnification and the zeroing distances the sight offers (metres). */
  zoomMax?: number
  zeroingDistances?: number[]
  /** A suppressor (tarkov.dev type `suppressor`, or a barrel with an integral moderator). */
  suppressor?: boolean
  slots: GunSlot[]
  /** conflictingItems — may not be installed together with any of these. */
  conflicts: string[]
  /** conflictingSlotIds — slots (their ids) that must stay empty while this part is installed. */
  conflictSlotIds?: string[]
  /** conflictingCategories — may not be installed together with any part of these categories (categoryIds). */
  conflictCategories?: string[]
  offers: GunOffer[]
  /** The flea market's 24-hour average price (tarkov.dev avg24hPrice), when known: «Сборка оружия» prices by it. */
  fleaAvg24h?: number
  /** «noFlea» type: cannot be bought on the flea market. */
  noFlea: boolean
  category?: string
  /** Every category of the item with its parents (tarkov.dev `categories`): «Оружейник» parts asking for a category. */
  categoryIds?: string[]
  /**
   * Cells the part adds to the weapon's inventory size (tarkov.dev `increaseSize`); `forced` (`increaseSizeForced`) adds
   * on top of the other parts instead of overlapping them. Only parts that grow the weapon have it.
   */
  increaseSize?: { left: number; right: number; up: number; down: number; forced: boolean }
}

export interface GunPreset {
  id: string
  name: string
  /** The assembled weapon's small picture: the bare weapon's icon is often only the receiver (NL-545). */
  iconLink?: string
  imageLink?: string
  gridImageLink?: string
  width?: number
  height?: number
  /** Every item of the preset (the weapon itself excluded). */
  itemIds: string[]
}

export interface Weapon extends GunPart {
  weaponClass: string
  weaponClassName: string
  caliber: string
  fireRate: number
  /** Fire modes as tarkov.dev names them (single, fullAuto, burst…). */
  fireModes?: string[]
  /** The iron sights' range in metres. */
  sightingRange?: number
  recoilVertical: number
  recoilHorizontal: number
  /** Weapon base centre of impact (used when no barrel is installed). */
  weaponCenterOfImpact?: number
  defaultAmmoId?: string
  defaultPreset?: GunPreset
}

export interface AmmoStats {
  id: string
  name: string
  shortName: string
  iconLink?: string
  caliber: string
  damage: number
  penetration: number
  armorDamage: number
  fragmentationChance: number
  initialSpeed: number
  projectileCount: number
  recoilModifier: number
  accuracyModifier: number
  tracer: boolean
  /** The bullet for the ballistic solver (src/arsenal/ballistics.ts); absent in data from before 17.10.2026. */
  bulletMassGrams?: number
  bulletDiameterMm?: number
  ballisticCoefficient?: number
  /** One round's weight in kg: a full magazine weighs its capacity of them. */
  weight?: number
  offers: GunOffer[]
  noFlea: boolean
}

export interface GunCatalog {
  weapons: Weapon[]
  mods: Map<string, GunPart>
  ammo: AmmoStats[]
  loadedAt: string
  source: 'live' | 'cache'
}

/** One installed item and what is installed into its slots (keyed by slot nameId). */
export interface BuildNode {
  itemId: string
  children: Record<string, BuildNode>
}

export interface Build {
  weaponId: string
  /** The weapon's own slots. */
  root: BuildNode
  ammoId?: string
}
