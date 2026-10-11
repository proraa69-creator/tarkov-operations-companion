import { GUNS_QUERY, MODS_QUERY, AMMO_QUERY } from '../../../src/arsenal/gunQueries.js'
import { economyQueries } from '../../../src/data/economyQueries.js'
import type { DataGateway } from './dataGateway.js'

const DAY = 24 * 60 * 60 * 1000
/** A pass with failures (upstream slow or down right after a deploy) is run again soon, not only the next day. */
const RETRY_MS = 10 * 60 * 1000
const MAX_RETRIES = 6

const BOSSES_QUERY = `query RaidOsBosses {
  bosses(lang: ru) {
    name
    normalizedName
    imagePortraitLink
    health { max }
    equipment { item { id name shortName iconLink properties { ... on ItemPropertiesWeapon { defaultPreset { iconLink } } } } attributes { name value } }
  }
}`

const detailedAmmoQuery = (mode: string, lang: string) => `{
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

const tradersQuery = (mode: string, lang: string) => `{ traders(gameMode: ${mode}, lang: ${lang}) { id name normalizedName resetTime imageLink } }`

export function applicationGraphqlRequests() {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = [{ query: BOSSES_QUERY }]
  for (const gameMode of ['regular', 'pve'] as const) for (const lang of ['ru', 'en'] as const) {
    const variables = { lang, gameMode }
    requests.push({ query: GUNS_QUERY, variables }, { query: MODS_QUERY, variables }, { query: AMMO_QUERY, variables })
    requests.push({ query: detailedAmmoQuery(gameMode, lang) }, { query: tradersQuery(gameMode, lang) })
    const economy = economyQueries(gameMode, lang)
    requests.push({ query: economy.prices }, { query: economy.barters }, { query: economy.crafts })
  }
  return requests
}

export class GraphqlPrewarm {
  private running: Promise<void> | null = null
  private initial: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private retries = 0

  constructor(private readonly gateway: DataGateway, private readonly log: (message: string) => void = console.log, private readonly retryMs = RETRY_MS) {}

  start(initialDelayMs = 30_000, intervalMs = DAY) {
    if (this.initial || this.timer) return
    const kick = () => { void this.run().catch(() => undefined) }
    this.initial = setTimeout(kick, initialDelayMs)
    this.initial.unref?.()
    this.timer = setInterval(kick, intervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.initial) clearTimeout(this.initial)
    if (this.timer) clearInterval(this.timer)
    if (this.retry) clearTimeout(this.retry)
    this.initial = this.timer = this.retry = null
  }

  run() {
    if (this.running) return this.running
    this.running = this.pass().finally(() => { this.running = null })
    return this.running
  }

  private async pass() {
    const requests = applicationGraphqlRequests()
    const total = requests.length
    let done = 0
    const workers = Array.from({ length: 2 }, async () => {
      for (;;) {
        const request = requests.shift()
        if (!request) return
        try { await this.gateway.graphql(request.query, request.variables); done += 1 }
        catch (error) { this.log(`GraphQL prewarm: ${error instanceof Error ? error.message : String(error)}`) }
      }
    })
    await Promise.all(workers)
    this.log(`GraphQL prewarm: ${done}/${total} snapshots refreshed`)
    // A new app version asks new queries: until their snapshots exist the strict API answers 503 for them
    // («Данные модулей сейчас недоступны»), so a failed pass is tried again in a few minutes.
    if (done === total) this.retries = 0
    else if (this.timer && !this.retry && this.retries < MAX_RETRIES) {
      this.retries += 1
      this.log(`GraphQL prewarm: ${total - done} failed, retry ${this.retries}/${MAX_RETRIES} in ${Math.round(this.retryMs / 60_000)} min`)
      this.retry = setTimeout(() => { this.retry = null; void this.run().catch(() => undefined) }, this.retryMs)
      this.retry.unref?.()
    }
  }
}
