import { lstat, readdir, realpath, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isPositionScreenshot } from '../../src/overlay/screenshotPosition.js'

interface Request { folder: string; before: Set<string>; sentAt: number }
interface OwnedFile { path: string; folder: string; size: number; mtimeMs: number; birthtimeMs: number }

/** Only one unambiguous coordinate image following a successful app keypress can be owned. */
export class MapScreenshotRetention {
  private requests: Request[] = []
  private latest: OwnedFile | null = null
  private queue: Promise<void> = Promise.resolve()

  async prepare(folder: string): Promise<Request | null> {
    try {
      const resolved = await realpath(folder)
      return { folder: resolved, before: new Set(await readdir(resolved)), sentAt: 0 }
    } catch { return null }
  }

  sent(request: Request | null, successful: boolean, now = Date.now()) {
    if (!request || !successful) return
    request.sentAt = now
    this.requests = [...this.requests.filter(entry => now - entry.sentAt <= 3000), request].slice(-8)
  }

  observe(file: { folder: string; name: string; withCoordinates: boolean; at: number }): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!file.withCoordinates || basename(file.name) !== file.name || !isPositionScreenshot(file.name)) return
      const folder = await realpath(file.folder)
      const request = this.requests.find(entry => entry.folder === folder && !entry.before.has(file.name)
        && file.at >= entry.sentAt - 50 && file.at <= entry.sentAt + 3000)
      if (!request) return
      this.requests = this.requests.filter(entry => entry !== request)
      // A simultaneous user screenshot makes ownership ambiguous: retain both.
      const added = (await readdir(folder)).filter(name => !request.before.has(name) && /\.(png|jpe?g|bmp)$/i.test(name))
      if (added.length !== 1 || added[0] !== file.name) return
      const path = join(folder, file.name)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) return
      const previous = this.latest
      this.latest = { path, folder, size: info.size, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs }
      if (!previous || previous.path === path || previous.folder !== folder || dirname(previous.path) !== folder) return
      const old = await lstat(previous.path).catch(() => null)
      if (old?.isFile() && !old.isSymbolicLink() && old.size === previous.size
        && old.mtimeMs === previous.mtimeMs && old.birthtimeMs === previous.birthtimeMs) await unlink(previous.path)
    }).catch(() => {})
    return this.queue
  }
}
