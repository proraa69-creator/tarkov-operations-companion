import express from 'express'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { activeItemImageDirectory } from '../services/itemImageDirectory.js'

const FILE = /^[a-z0-9]{16,48}-(?:icon|grid|base)\.(?:webp|jpg|jpeg|png)$/

interface ImageManifest { items?: Record<string, { images?: Record<string, { file?: string }> }> }
let cached = { path: '', mtime: 0, files: new Set<string>() }

async function allowedFiles(directory: string) {
  const path = join(activeItemImageDirectory(directory), 'manifest.json')
  const mtime = (await stat(path)).mtimeMs
  if (cached.path === path && cached.mtime === mtime) return cached.files
  const manifest = JSON.parse(await readFile(path, 'utf8')) as ImageManifest
  const files = new Set<string>()
  for (const row of Object.values(manifest.items ?? {})) for (const image of Object.values(row.images ?? {})) if (typeof image.file === 'string' && FILE.test(image.file)) files.add(image.file)
  cached = { path, mtime, files }
  return files
}

export function createItemImagesRouter(directory?: string) {
  const router = express.Router()
  router.get('/v1/item-images/:file', async (req, res, next) => {
    try {
      const file = String(req.params.file)
      if (!directory || !FILE.test(file) || !(await allowedFiles(directory)).has(file)) { res.status(404).end(); return }
      res.set('Cache-Control', 'public, max-age=86400, immutable')
      res.sendFile(file, { root: activeItemImageDirectory(directory), dotfiles: 'deny' }, (error) => { if (error && !res.headersSent) next(error) })
    } catch { res.status(404).end() }
  })
  return router
}
