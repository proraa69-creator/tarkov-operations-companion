import type { AmmoStats, GunOffer, GunPart, GunPreset, GunSlot, Weapon } from './gunTypes'

/**
 * tarkov.dev GraphQL (https://api.tarkov.dev/graphql, schema: github.com/the-hideout/tarkov-api schema-static.mjs).
 * Three queries: guns (small), mods (large — loaded only when the builder opens) and ammo.
 * `gameMode` is regular | pve; the Season mode uses the regular (PvP) market — GraphQL has no separate season prices —
 * but its cache and saved builds stay separate (src/arsenal/gunCatalog.ts, src/arsenal/buildStorage.ts).
 */
const SLOT_FIELDS = `fragment SlotFields on ItemSlot { id name nameId required filters { allowedItems { id } } }`
/**
 * `lastLowPrice` is asked next to `buyFor`: tarkov.dev's flea entry in `buyFor` is priced at the 24-hour average
 * (`avg24hPrice || lastLowPrice`, tarkov-api datasources/items.mjs), above the cheapest offer one can buy right now.
 */
const OFFER_FIELDS = `lastLowPrice buyFor { priceRUB vendor { name normalizedName ... on TraderOffer { minTraderLevel } } }`

export const GUNS_QUERY = `query RaidOsGuns($lang: LanguageCode, $gameMode: GameMode) {
  items(type: gun, lang: $lang, gameMode: $gameMode) {
    id name shortName iconLink image512pxLink inspectImageLink weight types
    category { name normalizedName }
    conflictingItems { id }
    ${OFFER_FIELDS}
    properties {
      __typename
      ... on ItemPropertiesWeapon {
        caliber fireRate ergonomics recoilVertical recoilHorizontal centerOfImpact
        defaultAmmo { id }
        defaultPreset { id name image512pxLink inspectImageLink containsItems { item { id } count } }
        slots { ...SlotFields }
      }
    }
  }
}
${SLOT_FIELDS}`

export const MODS_QUERY = `query RaidOsMods($lang: LanguageCode, $gameMode: GameMode) {
  items(type: mods, lang: $lang, gameMode: $gameMode) {
    id name shortName iconLink weight types
    accuracyModifier recoilModifier ergonomicsModifier
    category { name normalizedName }
    conflictingItems { id }
    ${OFFER_FIELDS}
    properties {
      __typename
      ... on ItemPropertiesWeaponMod { ergonomics recoilModifier accuracyModifier slots { ...SlotFields } }
      ... on ItemPropertiesBarrel { ergonomics recoilModifier centerOfImpact slots { ...SlotFields } }
      ... on ItemPropertiesMagazine { ergonomics recoilModifier capacity slots { ...SlotFields } }
      ... on ItemPropertiesScope { ergonomics recoilModifier slots { ...SlotFields } }
    }
  }
}
${SLOT_FIELDS}`

export const AMMO_QUERY = `query RaidOsAmmo($lang: LanguageCode, $gameMode: GameMode) {
  ammo(lang: $lang, gameMode: $gameMode) {
    item { id name shortName iconLink types ${OFFER_FIELDS} }
    caliber damage armorDamage penetrationPower fragmentationChance initialSpeed projectileCount
    recoilModifier accuracyModifier tracer
  }
}`

type Json = Record<string, unknown>

const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const list = (value: unknown): Json[] => Array.isArray(value) ? value.map(record) : []
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const optional = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * tarkov.dev returns recoil/accuracy modifiers as fractions (−0.05 = −5 %). Older fields carried whole percents;
 * anything beyond ±1 is read as a percent so a format change cannot multiply recoil by 5.
 */
export function asFraction(value: unknown): number {
  const raw = num(value)
  return Math.abs(raw) > 1 ? raw / 100 : raw
}

/** Buy offers; the flea one at the current lowest offer (`lastLowPrice`) when there is one, not the 24-hour average. */
export function adaptOffers(item: Json): GunOffer[] {
  const lastLow = num(item.lastLowPrice)
  return list(item.buyFor).flatMap((entry) => {
    const vendor = record(entry.vendor)
    const key = text(vendor.normalizedName)
    const priceRUB = key === 'flea-market' && lastLow > 0 ? lastLow : num(entry.priceRUB)
    if (!key || priceRUB <= 0) return []
    const level = optional(vendor.minTraderLevel)
    return [{ vendor: key, vendorName: text(vendor.name, key), priceRUB, ...(key !== 'flea-market' && level ? { minTraderLevel: level } : {}) }]
  })
}

export function adaptSlots(value: unknown): GunSlot[] {
  return list(value).map((slot) => ({
    id: text(slot.id),
    nameId: text(slot.nameId) || text(slot.id),
    name: text(slot.name, text(slot.nameId)),
    required: slot.required === true,
    allowed: list(record(slot.filters).allowedItems).map((item) => text(item.id)).filter(Boolean),
  })).filter((slot) => slot.nameId)
}

function basePart(item: Json, properties: Json): GunPart {
  const types = Array.isArray(item.types) ? item.types : []
  return {
    id: text(item.id),
    name: text(item.name, text(item.shortName)),
    shortName: text(item.shortName, text(item.name)),
    iconLink: text(item.iconLink) || undefined,
    imageLink: text(item.image512pxLink) || text(item.inspectImageLink) || undefined,
    weight: num(item.weight),
    ergonomics: num(properties.ergonomics ?? item.ergonomicsModifier),
    recoilModifier: asFraction(properties.recoilModifier ?? item.recoilModifier),
    accuracyModifier: asFraction(properties.accuracyModifier ?? item.accuracyModifier),
    centerOfImpact: optional(properties.centerOfImpact),
    capacity: optional(properties.capacity),
    slots: adaptSlots(properties.slots),
    conflicts: list(item.conflictingItems).map((entry) => text(entry.id)).filter(Boolean),
    offers: adaptOffers(item),
    noFlea: types.includes('noFlea'),
    category: text(record(item.category).normalizedName) || undefined,
  }
}

function adaptPreset(value: unknown, weaponId: string): GunPreset | undefined {
  const preset = record(value)
  const id = text(preset.id)
  if (!id) return undefined
  const itemIds = list(preset.containsItems).flatMap((entry) => {
    const itemId = text(record(entry.item).id)
    const count = Math.max(1, Math.round(num(entry.count)) || 1)
    return itemId && itemId !== weaponId ? Array.from({ length: count }, () => itemId) : []
  })
  return { id, name: text(preset.name), imageLink: text(preset.image512pxLink) || text(preset.inspectImageLink) || undefined, itemIds }
}

const itemsOf = (payload: unknown) => list(record(record(payload).data).items)

export function adaptWeapons(payload: unknown): Weapon[] {
  return itemsOf(payload).flatMap((item) => {
    const properties = record(item.properties)
    const types = Array.isArray(item.types) ? item.types : []
    // Presets are listed under type gun too; only the bare weapon has its own slots.
    if (types.includes('preset') || (properties.__typename && properties.__typename !== 'ItemPropertiesWeapon')) return []
    const id = text(item.id)
    if (!id || !Array.isArray(properties.slots)) return []
    const part = basePart(item, properties)
    const preset = adaptPreset(properties.defaultPreset, id)
    const category = record(item.category)
    return [{
      ...part,
      recoilModifier: 0,
      accuracyModifier: 0,
      centerOfImpact: undefined,
      weaponCenterOfImpact: optional(properties.centerOfImpact),
      imageLink: preset?.imageLink ?? part.imageLink,
      weaponClass: text(category.normalizedName, 'other'),
      weaponClassName: text(category.name, text(category.normalizedName)),
      caliber: text(properties.caliber),
      fireRate: num(properties.fireRate),
      recoilVertical: num(properties.recoilVertical),
      recoilHorizontal: num(properties.recoilHorizontal),
      defaultAmmoId: text(record(properties.defaultAmmo).id) || undefined,
      defaultPreset: preset,
    } satisfies Weapon]
  })
}

export function adaptMods(payload: unknown): Map<string, GunPart> {
  const mods = new Map<string, GunPart>()
  for (const item of itemsOf(payload)) {
    const part = basePart(item, record(item.properties))
    if (part.id) mods.set(part.id, part)
  }
  return mods
}

export function adaptAmmo(payload: unknown): AmmoStats[] {
  return list(record(record(payload).data).ammo).flatMap((entry) => {
    const item = record(entry.item)
    const id = text(item.id)
    if (!id) return []
    const types = Array.isArray(item.types) ? item.types : []
    return [{
      id,
      name: text(item.name, text(item.shortName)),
      shortName: text(item.shortName, text(item.name)),
      iconLink: text(item.iconLink) || undefined,
      caliber: text(entry.caliber),
      damage: num(entry.damage),
      penetration: num(entry.penetrationPower),
      armorDamage: num(entry.armorDamage),
      fragmentationChance: num(entry.fragmentationChance),
      initialSpeed: num(entry.initialSpeed),
      projectileCount: num(entry.projectileCount) || 1,
      recoilModifier: asFraction(entry.recoilModifier),
      accuracyModifier: asFraction(entry.accuracyModifier),
      tracer: entry.tracer === true,
      offers: adaptOffers(item),
      noFlea: types.includes('noFlea'),
    } satisfies AmmoStats]
  })
}
