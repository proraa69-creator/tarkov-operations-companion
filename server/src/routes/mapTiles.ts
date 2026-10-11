/**
 * Our copy of tarkov.dev's maps (services/mapMirror.ts), public like tarkov.dev itself:
 *
 *   GET /v1/map-tiles/status                       -> mirror progress (sets, tiles, bytes)
 *   GET /v1/map-tiles/maps.json                    -> tarkov.dev's maps.json as last mirrored
 *   GET /v1/map-tiles/maps/<set>/<z>/<x>/<y>.png   -> a tile («Спутник»)
 *   GET /v1/map-tiles/maps/svg/<Name>.svg          -> a scheme
 *
 * Only these shapes of path are served, from the mirror folder only; anything missing is 404 (the app then keeps
 * tarkov.dev's copy).
 */
import express from 'express'
import { join } from 'node:path'
import { SVG_PATH, TILE_PATH, type MapMirror } from '../services/mapMirror.js'

export function createMapTilesRouter(mirror: MapMirror | undefined) {
  const router = express.Router()

  router.get('/v1/map-tiles/status', (_req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json(mirror ? mirror.status() : { state: 'off' })
  })

  router.get(/^\/v1\/map-tiles\/(.+)$/, async (req, res, next) => {
    const path = String((req.params as Record<string, string>)[0] ?? '')
    const kind = path === 'maps.json' ? 'json' : TILE_PATH.test(path) ? 'tile' : SVG_PATH.test(path) ? 'svg' : null
    if (!mirror || !kind) { res.status(404).end(); return }
    res.set({
      'Cache-Control': kind === 'json' ? 'public, max-age=3600' : 'public, max-age=604800',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      ...(kind === 'svg' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
    })
    res.type(kind === 'json' ? 'application/json' : kind === 'svg' ? 'image/svg+xml' : 'image/png')
    if (kind === 'tile') {
      res.sendFile(join(mirror.dir, path), { dotfiles: 'deny' }, (error) => { if (error && !res.headersSent) res.status(404).end() })
      return
    }
    try {
      const bytes = await mirror.read(path)
      if (!bytes) { res.status(404).end(); return }
      res.send(bytes)
    } catch (error) { next(error) }
  })

  return router
}
