import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { isPositionScreenshot, parseScreenshotPosition, type PlayerPosition } from '../../src/overlay/screenshotPosition.js'

const POLL_MS = 1000

export function screenshotsFolder() {
  if (process.env.TARKOV_SCREENSHOTS_DIR) return process.env.TARKOV_SCREENSHOTS_DIR
  return join(app.getPath('documents'), 'Escape from Tarkov', 'Screenshots')
}

/**
 * Follows the EFT screenshots folder: every new screenshot carries the player position in its name.
 * Position screenshots taken while the tracker runs are pruned to the newest three.
 */
export class PositionTracker {
  private watcher: FSWatcher | null = null
  private poll: NodeJS.Timeout | null = null
  private startedAt = 0
  private lastFile = ''
  private busy = false
  /** Screenshots that existed before the tracker started belong to the player and are never touched. */
  private preexisting = new Set<string>()

  constructor(private readonly onPosition: (position: PlayerPosition) => void) {}

  get running() {
    return this.startedAt > 0
  }

  async start() {
    if (this.running) return
    this.startedAt = Date.now()
    const folder = screenshotsFolder()
    await mkdir(folder, { recursive: true }).catch(() => {})
    this.preexisting = new Set(await readdir(folder).catch(() => [] as string[]))
    try {
      this.watcher = watch(folder, (_event, name) => {
        if (name && isPositionScreenshot(String(name))) void this.refresh()
      })
    } catch {
      this.watcher = null
    }
    // fs.watch can miss events on some drives; a slow poll keeps the tracker honest.
    this.poll = setInterval(() => void this.refresh(), POLL_MS)
    // Restore the last known point after an application restart. Existing screenshots belong to
    // the player and are read-only: cleanup below still touches only files created this session.
    await this.refresh(true)
  }

  stop() {
    this.watcher?.close()
    this.watcher = null
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    this.startedAt = 0
  }

  private async refresh(includePreexisting = false) {
    if (this.busy || !this.running) return
    this.busy = true
    try {
      const folder = screenshotsFolder()
      const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => isPositionScreenshot(name) && (includePreexisting || !this.preexisting.has(name)))
      const files = (await Promise.all(names.map(async (name) => {
        const info = await stat(join(folder, name)).catch(() => null)
        return info ? { name, time: info.mtimeMs } : null
      }))).filter((file): file is { name: string; time: number } => Boolean(file))
      files.sort((a, b) => b.time - a.time)
      const newest = files[0]
      if (newest && newest.name !== this.lastFile) {
        this.lastFile = newest.name
        const position = parseScreenshotPosition(newest.name, newest.time)
        if (position) this.onPosition(position)
      }
      // Screenshots belong to the player, including those taken while tracking. Never delete them.
    } finally {
      this.busy = false
    }
  }
}
