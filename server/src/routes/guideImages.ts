import express from 'express'
import type { GuideImageMirror } from '../services/guideImages.js'
import type { VersionedPictureFolder } from './buildScreenshots.js'

/**
 * The «Оружейник» guides' screenshots and the photos of places kept on our server (services/guideImages.ts); public, like the
 * item images. `replacements`: the owner's own pictures under a photo's name (owner, 13.11.2026: «если у нас на сервере
 * происходит замена, то приложение берет один раз от туда новую картинку и сам меняет… ко всем картинкам, которые фото мест
 * показывают»): served instead of the stored one, and listed with their versions at /v1/guide-image-versions, which the apps
 * add to the photo's address (src/data/guidePhotoUrl.ts), so each app takes a replaced photo once.
 */
export function createGuideImagesRouter(mirror?: GuideImageMirror, replacements?: VersionedPictureFolder) {
  const router = express.Router()
  router.get('/v1/guide-image-versions', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ versions: replacements ? Object.fromEntries(await replacements.versionsByName()) : {} })
  })
  router.get('/v1/guide-images/:file', async (req, res, next) => {
    const name = String(req.params.file)
    const path = (replacements ? await replacements.file(name) : undefined)
      ?? (mirror ? await mirror.file(name).catch(() => undefined) : undefined)
    if (!path) { res.status(404).end(); return }
    // A name keeps its contents; when the pictures do change, the apps ask at another address (src/data/guidePhotoUrl.ts).
    res.set('Cache-Control', 'public, max-age=604800, immutable')
    res.sendFile(path, { dotfiles: 'deny' }, (error) => { if (error && !res.headersSent) next(error) })
  })
  return router
}
