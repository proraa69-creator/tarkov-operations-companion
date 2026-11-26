/** Loading the range's armour catalogue (src/range/rangeArmor.ts) for a mode and a language. */
import { useQuery } from '@tanstack/react-query'
import type { RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { loadTarkovItemsDataset } from '../data/tarkovDataset'
import { readGameCache, writeGameCache } from '../data/gameDataCache'
import { buildArmorCatalog, type ArmorCatalog, type RangeItem } from './rangeArmor'

type Json = Record<string, unknown>
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

/** The mode's catalogue, loaded with the gun catalogue's items file and kept for three days offline. */
export async function fetchArmorCatalog(mode: RaidMode, locale: AppLocale): Promise<ArmorCatalog> {
  const key = `raid-os-range-armor-v2-${mode}-${locale}`
  const cached = await readGameCache<{ savedAt: number; list: RangeItem[]; deviation?: Record<string, number> }>(key)
  if (cached && Date.now() - cached.savedAt < 30 * 60_000) return fromList(cached.list, cached.deviation)
  try {
    const bundle = await loadTarkovItemsDataset(mode, locale)
    const root = record(record(bundle.items).data ?? bundle.items)
    const names = record(record(bundle.names).data ?? bundle.names)
    const catalog = buildArmorCatalog({ items: record(root.items), materials: record(root.armorMaterials), names, imageBase: bundle.imageBaseUrl ?? 'https://raidos.app/v1/item-images' })
    await writeGameCache(key, { savedAt: Date.now(), list: catalog.list, deviation: catalog.deviation }, 3 * 24 * 60 * 60 * 1000)
    return catalog
  } catch (error) {
    if (cached) return fromList(cached.list, cached.deviation)
    throw error
  }
}

const fromList = (items: RangeItem[], deviation: Record<string, number> = {}): ArmorCatalog => ({ items: new Map(items.map((item) => [item.id, item])), list: items, deviation })

export function useArmorCatalog(mode: RaidMode, locale: AppLocale) {
  return useQuery({ queryKey: ['range-armor', mode, locale], queryFn: () => fetchArmorCatalog(mode, locale), staleTime: 30 * 60_000, gcTime: 60 * 60_000, retry: 2, refetchOnWindowFocus: false })
}
