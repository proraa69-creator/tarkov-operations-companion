import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { isPositionScreenshot, parseScreenshotPosition, type PlayerPosition } from '../../src/overlay/screenshotPosition.js'

const POLL_MS = 1000

let override = ''

/** A folder the player picked by hand in the Mini Map section; empty means auto-detect. */
export function setScreenshotsOverride(folder: string) {
  override = folder
}

/** Where EFT may write screenshots: Documents (possibly redirected to OneDrive) under the user profile. */
export function screenshotFolderCandidates() {
  const home = homedir()
  const documents = [app.getPath('documents'), join(home, 'Documents'), join(home, 'OneDrive', 'Documents'), join(home, 'OneDrive', 'Документы')]
  if (process.env.OneDrive) documents.push(join(process.env.OneDrive, 'Documents'), join(process.env.OneDrive, 'Документы'))
  return [...new Set(documents.map((folder) => join(folder, 'Escape from Tarkov', 'Screenshots')))]
}

function newestScreenshotTime(folder: string) {
  try {
    let newest = 0
    for (const name of readdirSync(folder)) {
      if (!isPositionScreenshot(name)) continue
      newest = Math.max(newest, statSync(join(folder, name)).mtimeMs)
    }
    return newest
  } catch {
    return -1
  }
}

export function screenshotsFolder() {
  if (override) return override
  if (process.env.TARKOV_SCREENSHOTS_DIR) return process.env.TARKOV_SCREENSHOTS_DIR
  const candidates = screenshotFolderCandidates()
  const existing = candidates.filter((folder) => existsSync(folder))
  // Prefer the folder EFT wrote coordinate screenshots to most recently.
  const best = existing.map((folder) => ({ folder, time: newestScreenshotTime(folder) })).sort((a, b) => b.time - a.time)[0]
  return best?.folder ?? candidates[0]!
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
  /** Newest image in the folder (with or without coordinates), for the diagnostics in the Mini Map page. */
  lastSeen: { name: string; withCoordinates: boolean; at: number } | null = null
  private folder = ''
  private lastFolderCheck = 0
  private busy = false
  /** Screenshots that existed before the tracker started belong to the player and are never touched. */
  private preexisting = new Set<string>()

  constructor(
    private readonly onPosition: (position: PlayerPosition) => void,
    /** Every new image in the folder, after its position (if any) was reported. */
    private readonly onFile?: (file: { name: string; withCoordinates: boolean; at: number }) => void,
  ) {}

  get running() {
    return this.startedAt > 0
  }

  async start() {
    if (this.running) return
    this.startedAt = Date.now()
    const folder = screenshotsFolder()
    this.folder = folder
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
      // EFT may start writing to another candidate folder (e.g. Documents moved to OneDrive).
      if (Date.now() - this.lastFolderCheck > 15_000) {
        this.lastFolderCheck = Date.now()
        const detected = screenshotsFolder()
        if (detected !== this.folder) { this.stop(); await this.start(); return }
      }
      const folder = this.folder
      const all = await readdir(folder).catch(() => [] as string[])
      const fresh = all.filter((name) => /\.(png|jpe?g|bmp)$/i.test(name) && !this.preexisting.has(name))
      let newFile: PositionTracker['lastSeen'] = null
      if (fresh.length) {
        const stats = await Promise.all(fresh.map(async (name) => ({ name, time: (await stat(join(folder, name)).catch(() => null))?.mtimeMs ?? 0 })))
        const newest = stats.sort((a, b) => b.time - a.time)[0]
        if (newest && newest.name !== this.lastSeen?.name) {
          this.lastSeen = { name: newest.name, withCoordinates: isPositionScreenshot(newest.name), at: newest.time }
          newFile = this.lastSeen
        }
      }
      const names = all.filter((name) => isPositionScreenshot(name) && (includePreexisting || !this.preexisting.has(name)))
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
      if (newFile) this.onFile?.(newFile)
      // Screenshots belong to the player, including those taken while tracking. Never delete them.
    } finally {
      this.busy = false
    }
  }
}
