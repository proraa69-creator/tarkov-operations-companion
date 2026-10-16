import { existsSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { isPositionScreenshot, parseScreenshotPosition, type PlayerPosition } from '../../src/overlay/screenshotPosition.js'

const POLL_MS = 1000
/** An unchanged folder is listed again after this long anyway (a file system that does not update folder times). */
const RELIST_MS = 5000

let override = ''

/** A folder the player picked by hand in the Mini Map section; empty means auto-detect. */
export function setScreenshotsOverride(folder: string) {
  if (folder === override && folderCache) return
  override = folder
  folderCache = null
  finding = null
  void findScreenshotsFolder().catch(() => {})
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
 * the newest minute's files are looked at, not each of the thousands a player keeps.
 */
async function newestScreenshotTime(folder: string) {
  try {
    let minute = ''
    let latest: string[] = []
    const undated: string[] = []
    for (const name of await readdir(folder)) {
      if (!isPositionScreenshot(name)) continue
      const taken = TAKEN_AT.exec(name)?.[0]
      if (!taken) undated.push(name)
      else if (taken > minute) { minute = taken; latest = [name] }
      else if (taken === minute) latest.push(name)
    }
    const times = await Promise.all([...latest, ...undated].map(async (name) => (await stat(join(folder, name))).mtimeMs))
    return Math.max(0, ...times)
  } catch {
    return -1
  }
}

async function autoFolder() {
  const candidates = screenshotFolderCandidates()
  // Prefer the folder EFT wrote coordinate screenshots to most recently (−1: no such folder).
  const found = await Promise.all(candidates.map(async (folder) => ({ folder, time: await newestScreenshotTime(folder) })))
  const best = found.filter((entry) => entry.time >= 0).sort((a, b) => b.time - a.time)[0]
  return best ?? { folder: candidates[0]!, time: -1 }
}

/**
 * A folder found is trusted this long, then looked for again in the background (the one found last is used meanwhile).
 * The lookup lists every candidate folder — players keep thousands of screenshots, often on OneDrive — and used to do it
 * synchronously on the main process's thread twice a minute (the status of the Mini Map page, the tracker, the scanner).
 */
export const FOLDER_CACHE_MS = 2 * 60_000

let folderCache: { at: number; folder: string } | null = null
let finding: Promise<string> | null = null

/**
 * Looks for the folder to watch, off the main thread's way (file listing in the background). A folder picked by hand
 * wins only while it actually holds the game's screenshots: a wrong pick (e.g. Pictures\Screenshots) must not hide the
 * game's own folder that has them. One lookup at a time; a fresh answer is given at once.
 */
export function findScreenshotsFolder(): Promise<string> {
  if (process.env.TARKOV_SCREENSHOTS_DIR) return Promise.resolve(process.env.TARKOV_SCREENSHOTS_DIR)
  if (folderCache && Date.now() - folderCache.at < FOLDER_CACHE_MS) return Promise.resolve(folderCache.folder)
  if (finding) return finding
  const picked = override
  const lookup: Promise<string> = (async () => {
    let folder: string
    if (picked && await newestScreenshotTime(picked) > 0) folder = picked
    else {
      const auto = await autoFolder()
      folder = picked && auto.time <= 0 ? picked : auto.folder
    }
    // A folder picked by hand meanwhile makes this answer out of date: not kept.
    if (picked === override) folderCache = { at: Date.now(), folder }
    return folder
  })().finally(() => { if (finding === lookup) finding = null })
  finding = lookup
  return lookup
}

/**
 * The folder to watch, at once and without listing anything: the one found last (looked for again in the background once
 * it is FOLDER_CACHE_MS old). Before the first lookup has answered, the folder picked by hand or the first candidate that
 * exists.
 */
export function screenshotsFolder() {
  if (process.env.TARKOV_SCREENSHOTS_DIR) return process.env.TARKOV_SCREENSHOTS_DIR
  if (!folderCache || Date.now() - folderCache.at >= FOLDER_CACHE_MS) void findScreenshotsFolder().catch(() => {})
  if (folderCache) return folderCache.folder
  if (override) return override
  const candidates = screenshotFolderCandidates()
  return candidates.find((folder) => existsSync(folder)) ?? candidates[0]!
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
  /** The folder's time at the last full listing: adding a file changes it, so an unchanged folder is not listed again. */
  private listedFolderTime = -1
  private listedAt = 0
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
    const folder = await findScreenshotsFolder()
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
      // The poll runs every second: list the folder only when something was added (or now and then all the same).
      const folderTime = (await stat(folder).catch(() => null))?.mtimeMs ?? -1
      if (!includePreexisting && folderTime === this.listedFolderTime && Date.now() - this.listedAt < RELIST_MS) return
      this.listedFolderTime = folderTime
      this.listedAt = Date.now()
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
