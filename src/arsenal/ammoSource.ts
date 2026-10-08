import { useQuery } from '@tanstack/react-query'
import type { Item, RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'

/**
 * Ammo stats for «Баллистика 2.0» from the tarkov.dev GraphQL API (https://api.tarkov.dev/graphql).
 * Schema (the-hideout/tarkov-api, schema-static.mjs): `items(type: ammo, gameMode: GameMode, lang: LanguageCode)`
 * with `properties { ... on ItemPropertiesAmmo { … ballisticCoeficient … } }` (the API spells it with one «f»).
 * GameMode has only `regular` and `pve`; the Season profile uses the regular (PvP) prices.
 */
export const TARKOV_GRAPHQL_URL = 'https://api.tarkov.dev/graphql'

export interface AmmoStats {
  id: string
  name: string
  shortName: string
  /** Raw tarkov.dev caliber id, e.g. Caliber556x45NATO. */
  caliber: string
  iconUrl?: string
  damage: number
  penetration: number
  /** Percent of damage dealt to armor durability. */
  armorDamage?: number
  /** 0–1 */
  fragmentationChance?: number
  initialSpeed?: number
  ballisticCoefficient?: number
  /** Fractions, e.g. −0.05 = −5 %. */
  recoilModifier?: number
  accuracyModifier?: number
  projectileCount?: number
  tracer?: boolean
  /** Cheapest RUB price (flea or trader) in the selected mode. */
  price?: number
  priceSource?: string
}

export function graphqlGameMode(mode: RaidMode): 'regular' | 'pve' {
  return mode === 'pve' ? 'pve' : 'regular'
}

export function ammoQuery(mode: RaidMode, locale: AppLocale) {
  return `{
  items(type: ammo, gameMode: ${graphqlGameMode(mode)}, lang: ${locale === 'en' ? 'en' : 'ru'}) {
    id name shortName iconLink
    buyFor { priceRUB vendor { name } }
    properties {
      ... on ItemPropertiesAmmo {
        caliber ammoType damage penetrationPower armorDamage fragmentationChance
        initialSpeed ballisticCoeficient recoilModifier accuracyModifier projectileCount tracer
      }
    }
  }
}`
}

type JsonRecord = Record<string, unknown>
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** Rounds fired from guns only (no grenades or flares), with damage and penetration. */
export function adaptAmmoResponse(payload: unknown): AmmoStats[] {
  const items = (payload as { data?: { items?: unknown } })?.data?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((raw) => {
    const item = (raw ?? {}) as JsonRecord
    const props = (item.properties ?? {}) as JsonRecord
    const id = str(item.id)
    const damage = num(props.damage)
    const penetration = num(props.penetrationPower)
    const ammoType = str(props.ammoType)
    if (!id || damage === undefined || penetration === undefined || !props.caliber) return []
    if (ammoType && !['bullet', 'buckshot'].includes(ammoType)) return []
    const offers = (Array.isArray(item.buyFor) ? item.buyFor : []) as JsonRecord[]
    const cheapest = offers
      .map((offer) => ({ price: num(offer.priceRUB) ?? 0, source: str((offer.vendor as JsonRecord | undefined)?.name) }))
      .filter((offer) => offer.price > 0)
      .sort((a, b) => a.price - b.price)[0]
    return [{
      id,
      name: str(item.name) || str(item.shortName),
      shortName: str(item.shortName) || str(item.name),
      caliber: str(props.caliber),
      iconUrl: str(item.iconLink) || undefined,
      damage,
      penetration,
      armorDamage: num(props.armorDamage),
      fragmentationChance: num(props.fragmentationChance),
      initialSpeed: num(props.initialSpeed),
      ballisticCoefficient: num(props.ballisticCoeficient),
      recoilModifier: num(props.recoilModifier),
      accuracyModifier: num(props.accuracyModifier),
      projectileCount: num(props.projectileCount),
      tracer: props.tracer === true,
      price: cheapest?.price,
      priceSource: cheapest?.source || undefined,
    }]
  })
}

/** Fallback when the GraphQL API is unreachable: the catalog's ammo (damage, penetration and price only). */
export function ammoFromCatalog(items: Item[], mode: RaidMode): AmmoStats[] {
  return items.filter((item) => item.category === 'Боеприпас' && item.damage && item.penetration !== undefined).map((item) => {
    const quote = item.prices.filter((entry) => entry.mode === mode).sort((a, b) => a.price - b.price)[0]
    return {
      id: item.id,
      name: item.name,
      shortName: item.shortName,
      caliber: item.caliber ?? '',
      iconUrl: item.iconUrl,
      damage: item.damage ?? 0,
      penetration: item.penetration ?? 0,
      price: quote?.price,
      priceSource: quote?.source,
    }
  })
}

const CALIBER_NAMES: Record<string, string> = {
  Caliber556x45NATO: '5.56×45', Caliber545x39: '5.45×39', Caliber762x39: '7.62×39', Caliber762x51: '7.62×51',
  Caliber762x54R: '7.62×54R', Caliber9x19PARA: '9×19', Caliber9x18PM: '9×18', Caliber9x39: '9×39',
  Caliber366TKM: '.366 TKM', Caliber12g: '12/70', Caliber20g: '20/70', Caliber23x75: '23×75',
  Caliber46x30: '4.6×30', Caliber57x28: '5.7×28', Caliber762x25TT: '7.62×25', Caliber1143x23ACP: '.45 ACP',
  Caliber9x21: '9×21', Caliber9x33R: '.357', Caliber127x55: '12.7×55', Caliber86x70: '.338 LM',
  Caliber762x35: '.300 BLK', Caliber68x51: '6.8×51', Caliber127x33: '.50 AE', Caliber93x64: '9.3×64',
  Caliber127x99: '12.7×99', Caliber40x46: '40×46', Caliber26x75: '26×75', Caliber30x29: '30×29',
}

/** Human caliber name: Caliber556x45NATO → 5.56×45; unknown ids lose the prefix; catalog names pass through. */
export function caliberLabel(caliber: string) {
  if (CALIBER_NAMES[caliber]) return CALIBER_NAMES[caliber]
  return caliber.replace(/^Caliber/, '').replace(/(\d)x(\d)/g, '$1×$2') || '—'
}

/** Damage text: buckshot shows per-pellet damage × pellets. */
export function damageText(ammo: Pick<AmmoStats, 'damage' | 'projectileCount'>) {
  return ammo.projectileCount && ammo.projectileCount > 1 ? `${ammo.damage}×${ammo.projectileCount}` : String(ammo.damage)
}

export async function fetchAmmoStats(mode: RaidMode, locale: AppLocale, fetcher: typeof fetch = fetch): Promise<AmmoStats[]> {
  const response = await fetcher(TARKOV_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: ammoQuery(mode, locale) }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Сервер данных: HTTP ${response.status}`)
  const rows = adaptAmmoResponse(await response.json())
  if (!rows.length) throw new Error('Сервер данных: нет патронов')
  return rows
}

/** Live ammo stats per mode and language; refreshed every 30 minutes (prices move, stats change on patches). */
export function useAmmoStats(mode: RaidMode, locale: AppLocale) {
  return useQuery({
    queryKey: ['tarkov-ammo-stats', graphqlGameMode(mode), locale],
    queryFn: () => fetchAmmoStats(mode, locale),
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  })
}
