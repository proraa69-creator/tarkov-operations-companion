import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDataset } from '../../../src/domain/types'
import { activeItemImageDirectory } from './itemImageDirectory.js'

let loaded = { path: '', mtime: 0, icons: new Map<string, string>(), grids: new Map<string, string>() }

const EXTERNAL_ASSET = /^https:\/\/assets\.tarkov\.dev\//i

function sanitizeCatalogAssets(catalog: AppDataset): AppDataset {
  const publicOrigin = (() => {
    try { return new URL(process.env.RAIDOS_ITEM_IMAGE_URL || process.env.TARKOV_PUBLIC_URL || 'https://raidos.app').origin }
    catch { return 'https://raidos.app' }
  })()
  const localMapUrl = (value?: string) => {
    if (!value) return undefined
    const match = /^https:\/\/assets\.tarkov\.dev\/(maps\/[A-Za-z0-9_./{}-]+)$/.exec(value)
    return match && !match[1].includes('..') ? `${publicOrigin}/v1/map-tiles/${match[1]}` : EXTERNAL_ASSET.test(value) ? undefined : value
  }
  const localAsset = (value?: string) => value && !EXTERNAL_ASSET.test(value) ? value : undefined
  return {
    ...catalog,
    items: catalog.items.map((item) => ({ ...item, iconUrl: localAsset(item.iconUrl), presetImageUrl: localAsset(item.presetImageUrl) })),
    maps: catalog.maps?.map((map) => ({
      ...map,
      imageUrl: localMapUrl(map.imageUrl),
      tileUrl: localMapUrl(map.tileUrl),
      layers: map.layers?.map((layer) => ({ ...layer, imageUrl: localMapUrl(layer.imageUrl), tileUrl: localMapUrl(layer.tileUrl) })),
    })) ?? catalog.maps,
    quests: catalog.quests?.map((quest) => ({ ...quest, imageUrl: localAsset(quest.imageUrl) })) ?? catalog.quests,
    traders: catalog.traders?.map((trader) => ({ ...trader, imageUrl: localAsset(trader.imageUrl) })) ?? catalog.traders,
    hideout: catalog.hideout?.map((station) => ({ ...station, imageUrl: localAsset(station.imageUrl) })) ?? catalog.hideout,
  }
}

/**
 * What withCachedItemImages reads besides the catalog: the image set in use (its folder and manifest time) and the
 * public address. A prepared catalog answer (services/catalogAnswers.ts) is made again only when this moves.
 */
export function itemImageVersion(): string {
  const directory = process.env.RAIDOS_ITEM_IMAGE_DIR
  const base = process.env.RAIDOS_ITEM_IMAGE_URL
  const origin = process.env.TARKOV_PUBLIC_URL ?? ''
  if (!directory || !base) return `none|${base ?? ''}|${origin}`
  try {
    const activeDirectory = activeItemImageDirectory(directory)
    return `${activeDirectory}|${statSync(join(activeDirectory, 'manifest.json')).mtimeMs}|${base}|${origin}`
  } catch { return `missing|${base}|${origin}` }
}

/** Only verified, locally cached assets replace upstream links. Prices and game modes are untouched. */
export function withCachedItemImages(catalog: AppDataset): AppDataset {
  const directory = process.env.RAIDOS_ITEM_IMAGE_DIR
  const base = process.env.RAIDOS_ITEM_IMAGE_URL
  if (!directory || !base || !/^https:\/\/[^\s?#]+$/.test(base)) return sanitizeCatalogAssets(catalog)
  try {
    const activeDirectory = activeItemImageDirectory(directory)
    const path = join(activeDirectory, 'manifest.json')
    const mtime = statSync(path).mtimeMs
    if (loaded.path !== path || loaded.mtime !== mtime) {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { items: Record<string, { images?: { icon?: { file?: string }; grid?: { file?: string } } }> }
      const icons = new Map<string, string>()
      const grids = new Map<string, string>()
      for (const [id, row] of Object.entries(manifest.items)) {
        const file = row.images?.icon?.file
        if (/^[a-z0-9]{16,48}$/.test(id) && typeof file === 'string' && new RegExp(`^${id}-icon\\.(webp|jpg|jpeg|png)$`).test(file)) icons.set(id, file)
        const grid = row.images?.grid?.file
        if (/^[a-z0-9]{16,48}$/.test(id) && typeof grid === 'string' && new RegExp(`^${id}-grid\\.(webp|jpg|jpeg|png)$`).test(grid)) grids.set(id, grid)
      }
      loaded = { path, mtime, icons, grids }
    }
    const localUrl = (file: string) => `${base.replace(/\/$/, '')}/${file}`
    return sanitizeCatalogAssets({ ...catalog, items: catalog.items.map(item => {
      // Match the preset's asset ID, never the stripped base receiver's ID.
      const presetId = item.types?.includes('gun') && item.presetImageUrl
        ? /^https:\/\/assets\.tarkov\.dev\/([a-z0-9]{16,48})-(?:512|grid|icon)\.(?:webp|jpg|jpeg|png)$/.exec(item.presetImageUrl)?.[1] : undefined
      const grid = presetId ? loaded.grids.get(presetId) : undefined
      const icon = loaded.icons.get(item.id)
      return icon || grid ? { ...item, ...(icon ? { iconUrl: localUrl(icon) } : {}), ...(grid ? { presetImageUrl: localUrl(grid) } : {}) } : item
    }) })
  } catch { return sanitizeCatalogAssets(catalog) }
}
