import {
  buildEconomySnapshot, buildLegacyAmmo, buildLegacyBarters, buildLegacyBosses, buildLegacyCrafts, buildLegacyItems, buildLegacyTraders,
  type TarkovJsonBundle,
} from '../../../src/data/tarkovJsonAdapters.js'
import { graphqlSnapshotIdentity } from './dataGateway.js'
import { applicationGraphqlRequests, type LegacyGraphqlRequest } from './legacyGraphqlRegistry.js'
import type { MirrorStorage } from './mirrorStorage.js'

const MINUTE = 60_000

export interface LegacyGraphqlStatus {
  state: 'idle' | 'running' | 'done' | 'degraded' | 'error'
  total: number
  ready: number
  failed: number
  startedAt: string | null
  finishedAt: string | null
  error?: string
}

export interface LegacyGraphqlBuilderOptions {
  storage: MirrorStorage
  now?: () => Date
  intervalMs?: number
  initialDelayMs?: number
  log?: (message: string) => void
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export class LegacyGraphqlBuilder {
  private readonly now: () => Date
  private running: Promise<void> | null = null
  private initial: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private current: LegacyGraphqlStatus = { state: 'idle', total: applicationGraphqlRequests().length, ready: 0, failed: 0, startedAt: null, finishedAt: null }

  constructor(private readonly options: LegacyGraphqlBuilderOptions) { this.now = options.now ?? (() => new Date()) }

  status(): LegacyGraphqlStatus { return { ...this.current } }

  start() {
    if (this.initial || this.timer) return
    const kick = () => { void this.run().catch(() => undefined) }
    this.initial = setTimeout(kick, this.options.initialDelayMs ?? 30_000)
    this.initial.unref?.()
    this.timer = setInterval(kick, this.options.intervalMs ?? MINUTE)
    this.timer.unref?.()
  }

  stop() {
    if (this.initial) clearTimeout(this.initial)
    if (this.timer) clearInterval(this.timer)
    this.initial = this.timer = null
  }

  run() {
    if (this.running) return this.running
    this.running = this.pass().finally(() => { this.running = null })
    return this.running
  }

  private async pass() {
    const requests = applicationGraphqlRequests()
    this.current = { state: 'running', total: requests.length, ready: 0, failed: 0, startedAt: this.now().toISOString(), finishedAt: null }
    const bundles = new Map<string, Promise<TarkovJsonBundle>>()
    for (const request of requests) {
      try {
        const key = `${request.mode}:${request.lang}`
        let bundle = bundles.get(key)
        if (!bundle) { bundle = this.loadBundle(request.mode, request.lang); bundles.set(key, bundle) }
        await this.publish(request, await bundle)
        this.current.ready += 1
      } catch (error) {
        this.current.failed += 1
        const message = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, 'upstream').slice(0, 160)
        this.current.error = message
        this.options.log?.(`legacy GraphQL ${request.kind}/${request.mode}/${request.lang}: ${message}`)
      }
    }
    this.current.state = this.current.failed === 0 ? 'done' : this.current.ready > 0 ? 'degraded' : 'error'
    this.current.finishedAt = this.now().toISOString()
  }

  private async readJson(slot: string, path: string, required = true): Promise<unknown> {
    const body = await this.options.storage.read(slot, path)
    if (!body) {
      if (!required) return {}
      throw new Error(`missing ${slot}/${path}`)
    }
    try { return JSON.parse(body.toString('utf8')) }
    catch { throw new Error(`invalid ${slot}/${path}`) }
  }

  private async loadBundle(mode: 'regular' | 'pve' | 'pvp-season', lang: 'ru' | 'en'): Promise<TarkovJsonBundle> {
    const slot = `dataset-${mode}`
    const [items, itemNames, traderNames, hideoutNames, traders, barters, crafts, maps, prices] = await Promise.all([
      this.readJson(slot, 'items.json'), this.readJson(slot, `items_${lang}.json`), this.readJson(slot, `traders_${lang}.json`),
      this.readJson(slot, `hideout_${lang}.json`), this.readJson(slot, 'traders.json'), this.readJson(slot, 'barters.json'),
      this.readJson(slot, 'crafts.json'), this.readJson(slot, 'maps.json'), this.readJson(`prices-${mode}`, 'prices.json'),
    ])
    const names = { data: { ...object(object(itemNames).data ?? itemNames), ...object(object(traderNames).data ?? traderNames), ...object(object(hideoutNames).data ?? hideoutNames) } }
    return { items, names, traders, barters, crafts, maps, prices, mode: mode === 'regular' ? 'pvp' : mode === 'pve' ? 'pve' : 'seasonal', imageBaseUrl: process.env.RAIDOS_ITEM_IMAGE_URL || 'https://raidos.app/v1/item-images' }
  }

  private response(request: LegacyGraphqlRequest, bundle: TarkovJsonBundle) {
    const items = () => buildLegacyItems(bundle)
    switch (request.kind) {
      case 'bosses': return { data: { bosses: buildLegacyBosses(bundle) } }
      case 'guns': return { data: { items: items().filter((row) => Array.isArray(row.types) && row.types.includes('gun')) } }
      case 'mods': return { data: { items: items().filter((row) => Array.isArray(row.types) && row.types.includes('mods')) } }
      case 'ammo': return { data: { ammo: buildLegacyAmmo(bundle) } }
      case 'detailed-ammo': return { data: { items: items().filter((row) => Array.isArray(row.types) && row.types.includes('ammo')) } }
      case 'traders': return { data: { traders: buildLegacyTraders(bundle) } }
      case 'barters': return { data: { barters: buildLegacyBarters(bundle, request.mode === 'pve' ? 'pve' : 'pvp', request.lang) } }
      case 'crafts': return { data: { crafts: buildLegacyCrafts(bundle, request.mode === 'pve' ? 'pve' : 'pvp', request.lang) } }
      case 'economy-prices': {
        const economy = buildEconomySnapshot(bundle, request.mode === 'pve' ? 'pve' : 'pvp', request.lang)
        return { data: { fleaMarket: economy.flea, items: items() } }
      }
    }
  }

  private async publish(request: LegacyGraphqlRequest, bundle: TarkovJsonBundle) {
    const identity = graphqlSnapshotIdentity(request.query, request.variables)
    const body = `${JSON.stringify(this.response(request, bundle))}\n`
    const transaction = await this.options.storage.begin(identity.slot)
    try {
      await transaction.write('response.json', body)
      await transaction.publish({ kind: request.kind, mode: request.mode, lang: request.lang, query: identity.canonical, variables: identity.variables }, async () => {
        const saved = await this.options.storage.read(identity.slot, 'response.json')
        const parsed = saved ? JSON.parse(saved.toString('utf8')) as { data?: unknown } : null
        if (!parsed?.data) throw new Error('legacy GraphQL smoke check failed')
      })
    } catch (error) { await transaction.abort(); throw error }
  }
}
