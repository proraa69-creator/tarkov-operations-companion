import type { RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { gatewayRequest, tarkovJson, usesDataGateway } from './tarkovApi'
import type { TarkovJsonBundle } from './tarkovJsonAdapters'

export const mirrorMode = (mode: RaidMode) => mode === 'pvp' ? 'regular' : mode === 'pve' ? 'pve' : 'pvp-season'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const dataObject = (value: unknown) => {
  const root = object(value)
  return object(root.data === undefined ? root : root.data)
}

/**
 * The items part of a mirrored mode only — items, their names, traders and prices — for the gun catalogue (weapons, mods,
 * ammo): it never needs the maps (~9 MB), barters, crafts or hideout. Prices that cannot be fetched (the server is still
 * preparing them) fall back to the items file, as the direct route always does.
 */
export async function loadTarkovItemsDataset(mode: RaidMode, locale: AppLocale): Promise<TarkovJsonBundle> {
  const upstreamMode = mirrorMode(mode)
  const [items, itemNames, traders, traderNames] = await Promise.all([
    tarkovJson(`${upstreamMode}/items`), tarkovJson(`${upstreamMode}/items_${locale}`),
    tarkovJson(`${upstreamMode}/traders`), tarkovJson(`${upstreamMode}/traders_${locale}`),
  ])
  const prices = usesDataGateway() ? await gatewayRequest('GET', `/v1/data/prices/${mode}`).catch(() => items) : items
  return {
    items, traders, prices, mode,
    names: { data: { ...dataObject(itemNames), ...dataObject(traderNames) } },
    imageBaseUrl: usesDataGateway() ? 'https://raidos.app/v1/item-images' : 'https://assets.tarkov.dev',
  }
}

/**
 * Only the traders and their names (about 60 KB) — all the restock times need (src/restock/restockSource.ts). They are
 * read every 2 minutes, in the background too, for the top-bar countdown and the restock notifications: with the whole
 * dataset that was ~30 MB of JSON (items, maps, barters, crafts, prices) downloaded, parsed and copied each time.
 */
export async function loadTarkovTradersDataset(mode: RaidMode, locale: AppLocale): Promise<TarkovJsonBundle> {
  const upstreamMode = mirrorMode(mode)
  const [traders, traderNames] = await Promise.all([tarkovJson(`${upstreamMode}/traders`), tarkovJson(`${upstreamMode}/traders_${locale}`)])
  return { items: {}, traders, mode, names: { data: dataObject(traderNames) } }
}

/** One coherent app view of a mirrored mode. All calls go through raidos.app in production. */
export async function loadTarkovDataset(mode: RaidMode, locale: AppLocale): Promise<TarkovJsonBundle> {
  const upstreamMode = mirrorMode(mode)
  const [items, itemNames, traders, traderNames, hideoutNames, barters, crafts, maps, prices] = await Promise.all([
    tarkovJson(`${upstreamMode}/items`), tarkovJson(`${upstreamMode}/items_${locale}`),
    tarkovJson(`${upstreamMode}/traders`), tarkovJson(`${upstreamMode}/traders_${locale}`), tarkovJson(`${upstreamMode}/hideout_${locale}`),
    tarkovJson(`${upstreamMode}/barters`), tarkovJson(`${upstreamMode}/crafts`), tarkovJson(`${upstreamMode}/maps`),
    usesDataGateway() ? gatewayRequest('GET', `/v1/data/prices/${mode}`) : tarkovJson(`${upstreamMode}/items`),
  ])
  return {
    items, traders, barters, crafts, maps, prices, mode,
    names: { data: { ...dataObject(itemNames), ...dataObject(traderNames), ...dataObject(hideoutNames) } },
    imageBaseUrl: usesDataGateway() ? 'https://raidos.app/v1/item-images' : 'https://assets.tarkov.dev',
  }
}
