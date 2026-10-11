import express from 'express'
import type { MapMirror } from '../services/mapMirror.js'
import type { MirrorStorage } from '../services/mirrorStorage.js'
import type { PriceMirror } from '../services/priceMirror.js'
import type { TarkovDataMirror } from '../services/tarkovDataMirror.js'

export interface DataMirrorRouteOptions {
  storage?: MirrorStorage
  datasets?: TarkovDataMirror
  prices?: PriceMirror
  maps?: MapMirror
}

/** Public operational status. It intentionally exposes no local paths, upstream URLs or credentials. */
export function createDataMirrorRouter(options: DataMirrorRouteOptions = {}) {
  const router = express.Router()
  router.get('/v1/data/mirror/status', async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store').json({
        enabled: Boolean(options.storage),
        disk: options.storage ? await options.storage.info() : { mounted: false, required: false, freeBytes: null },
        datasets: options.datasets?.status() ?? { state: 'idle' },
        prices: options.prices?.status() ?? { state: 'idle' },
        maps: options.maps?.status() ?? { state: 'idle' },
      })
    } catch (error) { next(error) }
  })
  return router
}
