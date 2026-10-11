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
