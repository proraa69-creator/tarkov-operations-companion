import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDataset } from '../../../src/domain/types'

let loaded = { path: '', mtime: 0, icons: new Map<string, string>(), grids: new Map<string, string>() }

/** Only verified, locally cached assets replace upstream links. Prices and game modes are untouched. */
export function withCachedItemImages(catalog: AppDataset): AppDataset {
  const directory = process.env.RAIDOS_ITEM_IMAGE_DIR
  const base = process.env.RAIDOS_ITEM_IMAGE_URL
  if (!directory || !base || !/^https:\/\/[^\s?#]+$/.test(base)) return catalog
  try {
    const path = join(directory, 'manifest.json')
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
    return { ...catalog, items: catalog.items.map(item => {
      // Match the preset's asset ID, never the stripped base receiver's ID.
      const presetId = item.types?.includes('gun') && item.presetImageUrl
        ? /^https:\/\/assets\.tarkov\.dev\/([a-z0-9]{16,48})-(?:512|grid|icon)\.(?:webp|jpg|jpeg|png)$/.exec(item.presetImageUrl)?.[1] : undefined
      const grid = presetId ? loaded.grids.get(presetId) : undefined
      const icon = loaded.icons.get(item.id)
      return icon || grid ? { ...item, ...(icon ? { iconUrl: localUrl(icon) } : {}), ...(grid ? { presetImageUrl: localUrl(grid) } : {}) } : item
    }) }
  } catch { return catalog }
}
