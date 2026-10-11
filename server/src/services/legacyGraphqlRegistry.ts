import { AMMO_QUERY, GUNS_QUERY, MODS_QUERY } from '../../../src/arsenal/gunQueries.js'
import { economyQueries } from '../../../src/data/economyQueries.js'
import type { MirrorMode } from './tarkovDataMirror.js'

export type LegacyGraphqlKind = 'bosses' | 'guns' | 'mods' | 'ammo' | 'detailed-ammo' | 'traders' | 'economy-prices' | 'barters' | 'crafts'

export interface LegacyGraphqlRequest {
  query: string
  variables?: Record<string, unknown>
  kind: LegacyGraphqlKind
  mode: MirrorMode
  lang: 'ru' | 'en'
}

export const BOSSES_QUERY = `query RaidOsBosses {
  bosses(lang: ru) {
    name
    normalizedName
    imagePortraitLink
    health { max }
    equipment { item { id name shortName iconLink properties { ... on ItemPropertiesWeapon { defaultPreset { iconLink } } } } attributes { name value } }
  }
}`

export const detailedAmmoQuery = (mode: string, lang: string) => `{
  items(type: ammo, gameMode: ${mode}, lang: ${lang}) {
    id name shortName iconLink lastLowPrice
    buyFor { priceRUB vendor { name normalizedName } }
    properties {
      ... on ItemPropertiesAmmo {
        caliber ammoType damage penetrationPower armorDamage fragmentationChance
        initialSpeed ballisticCoeficient recoilModifier accuracyModifier projectileCount tracer
      }
    }
  }
}`

export const tradersQuery = (mode: string, lang: string) => `{ traders(gameMode: ${mode}, lang: ${lang}) { id name normalizedName resetTime imageLink } }`

export function applicationGraphqlRequests(): LegacyGraphqlRequest[] {
  const requests: LegacyGraphqlRequest[] = [{ query: BOSSES_QUERY, kind: 'bosses', mode: 'regular', lang: 'ru' }]
  for (const mode of ['regular', 'pve'] as const) for (const lang of ['ru', 'en'] as const) {
    const variables = { lang, gameMode: mode }
    requests.push(
      { query: GUNS_QUERY, variables, kind: 'guns', mode, lang },
      { query: MODS_QUERY, variables, kind: 'mods', mode, lang },
      { query: AMMO_QUERY, variables, kind: 'ammo', mode, lang },
      { query: detailedAmmoQuery(mode, lang), kind: 'detailed-ammo', mode, lang },
      { query: tradersQuery(mode, lang), kind: 'traders', mode, lang },
    )
    const economy = economyQueries(mode, lang)
    requests.push(
      { query: economy.prices, kind: 'economy-prices', mode, lang },
      { query: economy.barters, kind: 'barters', mode, lang },
      { query: economy.crafts, kind: 'crafts', mode, lang },
    )
  }
  return requests
}
