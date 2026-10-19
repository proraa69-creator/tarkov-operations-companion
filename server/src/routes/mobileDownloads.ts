/**
 * The phone apps from the site (services/mobileDownloads.ts keeps the copy):
 *   GET /v1/downloads/android/version.json   the Android app's update description (src/mobile/androidUpdate.ts):
 *                                            { versionCode, versionName, url, sha256, size }
 *   GET /v1/downloads/android/<file>.apk     that APK (the updater asks for it by name)
 *   GET /v1/downloads/android                the newest APK (the site's «Скачать для Android»)
 *   GET /v1/downloads/iphone                 the iPhone archive: IPA, the PDF guide, links to Sideloadly and iTunes
 *   GET /v1/downloads/mobile.json            { version, android?: { versionName, size }, iphone?: { size } } for the site
 * 404 while nothing is published. Public: the apps themselves ask for an account and a subscription.
 */
import express from 'express'
import type { MobileDownloads } from '../services/mobileDownloads.js'

/** The address the Android updater accepts (UpdateDownload.java, androidUpdate.ts): HTTPS raidos.app/v1/downloads/android/. */
export const ANDROID_DOWNLOAD_BASE = 'https://raidos.app/v1/downloads/android/'

export function createMobileDownloadsRouter(downloads?: MobileDownloads) {
  const router = express.Router()
  const send = (kind: 'android' | 'iphone', name?: string): express.RequestHandler => async (req, res, next) => {
    try {
      void downloads?.refresh()
      const found = await downloads?.path(kind)
      if (!found || (name !== undefined && String(req.params[name]) !== found.file.file)) { res.status(404).end(); return }
      res.set('Cache-Control', name ? 'public, max-age=3600' : 'no-store')
      res.set('X-Content-Type-Options', 'nosniff')
      res.type(kind === 'android' ? 'application/vnd.android.package-archive' : 'application/zip')
      res.attachment(found.file.file)
      res.sendFile(found.path, { dotfiles: 'deny' }, (error) => { if (error && !res.headersSent) next(error) })
    } catch { if (!res.headersSent) res.status(404).end() }
  }

  router.get('/v1/downloads/android/version.json', async (_req, res) => {
    void downloads?.refresh()
    const found = await downloads?.path('android').catch(() => undefined)
    res.set('Cache-Control', 'no-store')
    if (!found) { res.status(404).json({ error: 'not_published' }); return }
    const android = found.release.android!
    res.json({ versionCode: android.versionCode, versionName: android.versionName, url: `${ANDROID_DOWNLOAD_BASE}${android.file}`, sha256: android.sha256, size: android.size })
  })
  router.get('/v1/downloads/mobile.json', async (_req, res) => {
    void downloads?.refresh()
    const release = await downloads?.release().catch(() => null)
    res.set('Cache-Control', 'no-store')
    if (!release) { res.status(404).json({ error: 'not_published' }); return }
    res.json({
      version: release.version,
      ...(release.android ? { android: { versionName: release.android.versionName, size: release.android.size } } : {}),
      ...(release.iphone ? { iphone: { size: release.iphone.size } } : {}),
    })
  })
  router.get('/v1/downloads/android/:file', send('android', 'file'))
  router.get('/v1/downloads/android', send('android'))
  router.get('/v1/downloads/iphone', send('iphone'))
  return router
}
