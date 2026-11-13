import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import express from 'express'

/**
 * The «Оружейник» build screenshots kept on the server (owner, 13.11.2026: «научи приложение сохранять все картинки у себя, а
 * если у нас на сервере происходит замена, то приложение берет один раз от туда новую картинку и сам меняет»).
 *
 *   GET /v1/build-screenshots              -> { screenshots: [{ task, weapon, version }] }  (public, no store)
 *   GET /v1/build-screenshots/<task>_<weapon>.webp?v=<version>  -> the picture, cached by the apps for good
 *
 * A file named «<task id>_<weapon id>.webp» in the folder is the build of that task's weapon; its version is a hash of its
 * bytes, so a file replaced under the same name gets a new address and every app takes the new picture once. The apps
 * show their own copy (src/gunsmith/buildScreenshots.ts) where the server has none.
 */
export const BUILD_SCREENSHOT_FILE = /^([0-9a-f]{24})_([0-9a-f]{24})\.webp$/

export interface BuildScreenshotEntry { task: string; weapon: string; version: string }

/**
 * A folder of pictures the apps keep: each file named by `pattern` with a version that is a hash of its bytes (worked out
 * again only when the file's time or size changes). A file replaced under its name gets a new version, so a new address.
 */
export class VersionedPictureFolder {
  private readonly versions = new Map<string, { mtimeMs: number; size: number; version: string }>()

  constructor(readonly dir: string, private readonly pattern: RegExp) {}

  /** Every picture of the folder and its version. */
  async versionsByName(): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    let names: string[]
    try { names = await readdir(this.dir) } catch { return found }
    for (const name of names.sort()) {
      if (!this.pattern.test(name)) continue
      const version = await this.version(name).catch(() => undefined)
      if (version) found.set(name, version)
    }
    return found
  }

  /** The file's path when the folder has it, else undefined. */
  async file(name: string): Promise<string | undefined> {
    if (!this.pattern.test(name)) return undefined
    const path = join(this.dir, name)
    try { return (await stat(path)).isFile() ? path : undefined } catch { return undefined }
  }

  private async version(name: string) {
    const path = join(this.dir, name)
    const info = await stat(path)
    const known = this.versions.get(name)
    if (known && known.mtimeMs === info.mtimeMs && known.size === info.size) return known.version
    const version = createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 16)
    this.versions.set(name, { mtimeMs: info.mtimeMs, size: info.size, version })
    return version
  }
}

export class BuildScreenshotFolder extends VersionedPictureFolder {
  constructor(dir: string) { super(dir, BUILD_SCREENSHOT_FILE) }

  async list(): Promise<BuildScreenshotEntry[]> {
    return [...(await this.versionsByName())].map(([name, version]) => {
      const match = BUILD_SCREENSHOT_FILE.exec(name)!
      return { task: match[1]!, weapon: match[2]!, version }
    })
  }
}

export function createBuildScreenshotsRouter(folder?: BuildScreenshotFolder) {
  const router = express.Router()
  router.get('/v1/build-screenshots', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ screenshots: folder ? await folder.list() : [] })
  })
  router.get('/v1/build-screenshots/:file', async (req, res, next) => {
    const path = folder ? await folder.file(String(req.params.file)) : undefined
    if (!path) { res.status(404).end(); return }
    // The address carries the version: a replaced picture is asked for at another one.
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(path, { dotfiles: 'deny' }, (error) => { if (error && !res.headersSent) next(error) })
  })
  return router
}
