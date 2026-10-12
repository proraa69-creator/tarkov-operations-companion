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
  folderCache = null
}

/** Where EFT may write screenshots: Documents (possibly redirected to OneDrive) under the user profile. */
export function screenshotFolderCandidates() {
  const home = homedir()
  const documents = [app.getPath('documents'), join(home, 'Documents'), join(home, 'OneDrive', 'Documents'), join(home, 'OneDrive', 'Документы')]
  if (process.env.OneDrive) documents.push(join(process.env.OneDrive, 'Documents'), join(process.env.OneDrive, 'Документы'))
  return [...new Set(documents.map((folder) => join(folder, 'Escape from Tarkov', 'Screenshots')))]
}

/** EFT names screenshots by the time they were taken: `2024-06-13[11-05]_…`. */
const TAKEN_AT = /^\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\]/

/**
 * When the game last wrote a coordinate screenshot here (0: never, −1: no folder). The names give the minute, so only
 * the newest minute's files are looked at, not each of the thousands a player keeps (this runs every 15 seconds).
 */
function newestScreenshotTime(folder: string) {
  try {
    let minute = ''
    let latest: string[] = []
    const undated: string[] = []
    for (const name of readdirSync(folder)) {
      if (!isPositionScreenshot(name)) continue
      const taken = TAKEN_AT.exec(name)?.[0]
      if (!taken) undated.push(name)
      else if (taken > minute) { minute = taken; latest = [name] }
      else if (taken === minute) latest.push(name)
    }
    let newest = 0
    for (const name of [...latest, ...undated]) newest = Math.max(newest, statSync(join(folder, name)).mtimeMs)
    return newest
  } catch {
    return -1
  }
}

function autoFolder() {
  const candidates = screenshotFolderCandidates()
  const existing = candidates.filter((folder) => existsSync(folder))
  // Prefer the folder EFT wrote coordinate screenshots to most recently.
  const best = existing.map((folder) => ({ folder, time: newestScreenshotTime(folder) })).sort((a, b) => b.time - a.time)[0]
  return best ?? { folder: candidates[0]!, time: -1 }
}

let folderCache: { at: number; folder: string } | null = null

/**
 * The folder to watch. A folder picked by hand wins only while it actually holds the game's screenshots: a
 * wrong pick (e.g. Pictures\Screenshots) must not hide the game's own folder that has them.
 */
export function screenshotsFolder() {
  if (process.env.TARKOV_SCREENSHOTS_DIR) return process.env.TARKOV_SCREENSHOTS_DIR
  if (folderCache && Date.now() - folderCache.at < 5000) return folderCache.folder
  let folder: string
  if (override && newestScreenshotTime(override) > 0) folder = override
  else {
    const auto = autoFolder()
    folder = override && auto.time <= 0 ? override : auto.folder
  }
  folderCache = { at: Date.now(), folder }
  return folder
}

/**
 * Follows the EFT screenshots folder: every new screenshot carries the player position in its name.
 * Reading does not delete files; separately verified app screenshots have their own retention policy.
 */
export class PositionTracker {
  private watcher: FSWatcher | null = null
  private poll: NodeJS.Timeout | null = null
  private startedAt = 0
  private lastFile = ''
  /** Newest image in the folder (with or without coordinates), for the diagnostics in the Mini Map page. */
  lastSeen: { folder: string; name: string; withCoordinates: boolean; at: number } | null = null
  private folder = ''
  private lastFolderCheck = 0
  private busy = false
  /** Screenshots that existed before the tracker started belong to the player and are never touched. */
  private preexisting = new Set<string>()
  /** When each new file was written: a screenshot never changes, so it is looked up once, not every second. */
  private written = new Map<string, number>()

  constructor(
    private readonly onPosition: (position: PlayerPosition) => void,
    /** Every new image in the folder, after its position (if any) was reported. */
    private readonly onFile?: (file: { folder: string; name: string; withCoordinates: boolean; at: number }) => void,
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
    this.written = new Map()
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

  private async writtenAt(folder: string, name: string) {
    const known = this.written.get(name)
    if (known !== undefined) return known
    const info = await stat(join(folder, name)).catch(() => null)
    // A file still being written may have no size yet: looked up again next time.
    if (info?.size) this.written.set(name, info.mtimeMs)
    return info?.mtimeMs ?? null
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
        const stats = await Promise.all(fresh.map(async (name) => ({ name, time: await this.writtenAt(folder, name) ?? 0 })))
        const newest = stats.sort((a, b) => b.time - a.time)[0]
        if (newest && newest.name !== this.lastSeen?.name) {
          this.lastSeen = { folder, name: newest.name, withCoordinates: isPositionScreenshot(newest.name), at: newest.time }
          newFile = this.lastSeen
        }
      }
      const names = all.filter((name) => isPositionScreenshot(name) && (includePreexisting || !this.preexisting.has(name)))
      const files = (await Promise.all(names.map(async (name) => {
        const time = await this.writtenAt(folder, name)
        return time == null ? null : { name, time }
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
