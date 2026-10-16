import express from 'express'
import type { GuideImageMirror } from '../services/guideImages.js'

/** The «Оружейник» guides' screenshots kept on our server (services/guideImages.ts); public, like the item images. */
export function createGuideImagesRouter(mirror?: GuideImageMirror) {
  const router = express.Router()
  router.get('/v1/guide-images/:file', async (req, res, next) => {
    const path = mirror ? await mirror.file(String(req.params.file)).catch(() => undefined) : undefined
    if (!path) { res.status(404).end(); return }
    // tarkov.help names its pictures by UUID: a name never gets other contents.
    res.set('Cache-Control', 'public, max-age=604800, immutable')
    res.sendFile(path, { dotfiles: 'deny' }, (error) => { if (error && !res.headersSent) next(error) })
  })
  return router
}
