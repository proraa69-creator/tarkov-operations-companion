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
  weight: number
  ergonomics: number
  recoilModifier: number
  accuracyModifier: number
  /** Barrels only: centre of impact (tarkov.dev value, used for the approximate MOA). */
  centerOfImpact?: number
  /** Magazines only. */
  capacity?: number
  slots: GunSlot[]
  /** conflictingItems — may not be installed together with any of these. */
  conflicts: string[]
  offers: GunOffer[]
  /** «noFlea» type: cannot be bought on the flea market. */
  noFlea: boolean
  category?: string
}

export interface GunPreset {
  id: string
  name: string
  imageLink?: string
  /** Every item of the preset (the weapon itself excluded). */
  itemIds: string[]
}

export interface Weapon extends GunPart {
  weaponClass: string
  weaponClassName: string
  caliber: string
  fireRate: number
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
