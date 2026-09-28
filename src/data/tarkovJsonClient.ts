import { get, set } from 'idb-keyval'
import type { AppDataset, RaidMode } from '../domain/types'
import { fetchLiveCatalog } from './catalogSource'
import type { AppLocale } from '../i18n/LocaleProvider'

const CACHE_PREFIX = 'tarkov-operations-catalog-v11'
export async function fetchTarkovCatalog(mode: RaidMode, locale: AppLocale = 'ru'): Promise<AppDataset> {
  const cacheKey = `${CACHE_PREFIX}-${mode}-${locale}`
  try {
    const service = locale === 'ru' ? await window.tarkovDesktop?.serviceRequest('GET', `/v1/catalog/${mode}`) : undefined
    let dataset: AppDataset
    if (service) dataset = service as AppDataset
    else if (import.meta.env.VITE_COMPANION_API_URL && locale === 'ru') {
      const response = await fetch(`${import.meta.env.VITE_COMPANION_API_URL}/v1/catalog/${mode}`, { signal: AbortSignal.timeout(45_000) })
      if (!response.ok) throw new Error('Сервис каталога временно недоступен')
      dataset = await response.json() as AppDataset
    } else dataset = await fetchLiveCatalog(mode, locale)
    await set(cacheKey, dataset)
    return dataset
  } catch (error) {
    const cached = await get<AppDataset>(cacheKey)
    if (cached) return { ...cached, metadata: { ...cached.metadata!, source: 'cache' } }
    throw error
  }
}
