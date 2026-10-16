import { existsSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { readdir, stat } from 'node:fs/promises'
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

/**
 * Where EFT may write screenshots: Documents under the user profile. `app.getPath('documents')` is Windows' own answer
 * (the «Documents» known folder, wherever it was moved: OneDrive, another drive); the rest are the usual places for a
 * profile whose Documents moved after the game was installed (the game may still write to the old one).
 */
export function screenshotFolderCandidates() {
  const home = homedir()
  let known = ''
  try { known = app.getPath('documents') } catch { /* no known folder: the usual places below */ }
  const documents = [known, join(home, 'Documents'), join(home, 'OneDrive', 'Documents'), join(home, 'OneDrive', 'Документы')]
  for (const variable of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = process.env[variable]
    if (root) documents.push(join(root, 'Documents'), join(root, 'Документы'))
  }
  return [...new Set(documents.filter(Boolean).map((folder) => join(folder, 'Escape from Tarkov', 'Screenshots')))]
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
 * Every folder the tracker follows: the one picked by hand, the one found by the lookup above and each candidate. The
 * game writes to exactly one of them, but which one cannot be known before its first screenshot (Documents moved to
 * OneDrive after the game was installed, a folder the game creates only at its first screenshot): following all of them
 * shows the dot from the very first screenshot instead of after the next lookup (up to FOLDER_CACHE_MS).
 */
export function watchedScreenshotFolders() {
  if (process.env.TARKOV_SCREENSHOTS_DIR) return [process.env.TARKOV_SCREENSHOTS_DIR]
  return [...new Set([override, folderCache?.folder ?? '', ...screenshotFolderCandidates()].filter(Boolean))]
}

const IMAGE = /\.(png|jpe?g|bmp)$/i

/** A new image in a followed folder, with the position its name carries (null: none, e.g. a menu screenshot). */
export interface SeenScreenshot { folder: string; name: string; withCoordinates: boolean; at: number; position: PlayerPosition | null }

/** One followed folder: its watch, and the names that were there when the tracking started (never reported as new). */
interface Followed {
  folder: string
  watcher: FSWatcher | null
  exists: boolean
  preexisting: Set<string>
  /** The folder's time at the last full listing: adding a file changes it, so an unchanged folder is not listed again. */
  listedFolderTime: number
  listedAt: number
  /** When each new file was written: a screenshot never changes, so it is looked up once, not every second. */
  written: Map<string, number>
}

/**
 * Follows the EFT screenshots folders: every new screenshot carries the player position in its name (the name is all
 * that is read, so a file the game is still writing counts at once). fs.watch answers at once; a poll every second
 * catches what it misses (network and synced drives, a folder created after the start).
 * Reading does not delete files; screenshots belong to the player.
 */
export class PositionTracker {
  private poll: NodeJS.Timeout | null = null
  private startedAt = 0
  /** Each start and stop: an answer of a start that was stopped meanwhile is dropped (no watch left behind). */
  private generation = 0
  private lastFile = ''
  private followed: Followed[] = []
  private lastFolderCheck = 0
  private busy = false
  private again = false
  /** Newest new image in the folders (with or without coordinates), for the diagnostics in the settings. */
  lastSeen: SeenScreenshot | null = null

  constructor(
    private readonly onPosition: (position: PlayerPosition, file: SeenScreenshot) => void,
    /** Every new image in the folders, after its position (if any) was reported. */
    private readonly onFile?: (file: SeenScreenshot) => void,
  ) {}

  get running() {
    return this.startedAt > 0
  }

  /** The folders followed now and whether each exists and is watched (the poll covers the others). */
  get folders() {
    return this.followed.map(({ folder, exists, watcher }) => ({ folder, exists, watching: Boolean(watcher) }))
  }

  async start() {
    if (this.running) return
    const generation = ++this.generation
    this.startedAt = Date.now()
    this.lastFolderCheck = Date.now()
    await findScreenshotsFolder().catch(() => '')
    const followed = await Promise.all(watchedScreenshotFolders().map((folder) => this.follow(folder)))
    if (generation !== this.generation) { for (const entry of followed) entry.watcher?.close(); return }
    this.followed = followed
    this.poll = setInterval(() => void this.refresh(), POLL_MS)
    // The last known point after an application restart (the main process sends it only while it is fresh).
    await this.refresh(true)
  }

  stop() {
    this.generation += 1
    for (const entry of this.followed) entry.watcher?.close()
    this.followed = []
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    this.startedAt = 0
  }

  private async follow(folder: string): Promise<Followed> {
    const names = await readdir(folder).catch(() => null)
    const entry: Followed = { folder, watcher: null, exists: names !== null, preexisting: new Set(names ?? []), listedFolderTime: -1, listedAt: 0, written: new Map() }
    this.watch(entry)
    return entry
  }

  private watch(entry: Followed) {
    if (entry.watcher || !entry.exists) return
    try {
      entry.watcher = watch(entry.folder, { persistent: false }, (_event, name) => {
        // A rename or a new file: listed now, not at the next poll.
        if (!name || IMAGE.test(String(name))) void this.refresh()
      })
      entry.watcher.on('error', () => { entry.watcher?.close(); entry.watcher = null })
    } catch {
      entry.watcher = null
    }
  }

  private async writtenAt(entry: Followed, name: string) {
    const known = entry.written.get(name)
    if (known !== undefined) return known
    const info = await stat(join(entry.folder, name)).catch(() => null)
    if (info) entry.written.set(name, info.mtimeMs)
    return info?.mtimeMs ?? null
  }

  private async refresh(includePreexisting = false): Promise<void> {
    if (!this.running) return
    // A change while a listing runs is listed again right after it (a watch event is never lost to «busy»).
    if (this.busy) { this.again = true; return }
    this.busy = true
    const generation = this.generation
    try {
      // The folder picked by hand or found by the lookup may change: followed too from now on.
      if (Date.now() - this.lastFolderCheck > 15_000) {
        this.lastFolderCheck = Date.now()
        screenshotsFolder()
        for (const folder of watchedScreenshotFolders()) {
          if (!this.followed.some((entry) => entry.folder === folder)) {
            const entry = await this.follow(folder)
            if (generation !== this.generation) { entry.watcher?.close(); return }
            this.followed.push(entry)
          }
        }
      }
      const images: Array<{ entry: Followed; name: string; time: number }> = []
      for (const entry of this.followed) {
        const folderTime = (await stat(entry.folder).catch(() => null))?.mtimeMs ?? -1
        // A folder created after the start (the game's first screenshot): everything in it is new, and it is watched now.
        if (!entry.exists && folderTime >= 0) { entry.exists = true; this.watch(entry) }
        if (!includePreexisting && folderTime === entry.listedFolderTime && Date.now() - entry.listedAt < RELIST_MS) continue
        entry.listedFolderTime = folderTime
        entry.listedAt = Date.now()
        const all = await readdir(entry.folder).catch(() => [] as string[])
        const fresh = all.filter((name) => IMAGE.test(name) && !entry.preexisting.has(name))
        // After a restart: the newest coordinate screenshots kept from before (only the newest minute's, by name).
        if (includePreexisting) fresh.push(...newestMinute(all.filter((name) => entry.preexisting.has(name) && isPositionScreenshot(name))))
        for (const name of fresh) {
          const time = await this.writtenAt(entry, name)
          if (time != null) images.push({ entry, name, time })
        }
      }
      if (generation !== this.generation) return
      images.sort((a, b) => b.time - a.time)
      const newestImage = images.find((image) => !image.entry.preexisting.has(image.name))
      let newFile: SeenScreenshot | null = null
      if (newestImage && (newestImage.name !== this.lastSeen?.name || newestImage.entry.folder !== this.lastSeen.folder)) {
        const position = parseScreenshotPosition(newestImage.name, newestImage.time)
        newFile = { folder: newestImage.entry.folder, name: newestImage.name, withCoordinates: Boolean(position), at: newestImage.time, position }
        this.lastSeen = newFile
      }
      const newest = images.find((image) => isPositionScreenshot(image.name))
      const key = newest ? `${newest.entry.folder}\n${newest.name}` : ''
      if (newest && key !== this.lastFile) {
        this.lastFile = key
        const position = parseScreenshotPosition(newest.name, newest.time)
        if (position) this.onPosition(position, { folder: newest.entry.folder, name: newest.name, withCoordinates: true, at: newest.time, position })
      }
      if (newFile) this.onFile?.(newFile)
    } finally {
      this.busy = false
      if (this.again) { this.again = false; void this.refresh() }
    }
  }
}

/** The names of the newest minute by the game's naming (`2024-06-13[11-05]_…`), and those without such a time. */
function newestMinute(names: string[]) {
  let minute = ''
  let latest: string[] = []
  const undated: string[] = []
  for (const name of names) {
    const taken = TAKEN_AT.exec(name)?.[0]
    if (!taken) undated.push(name)
    else if (taken > minute) { minute = taken; latest = [name] }
    else if (taken === minute) latest.push(name)
  }
  return [...latest, ...undated.slice(-20)]
}
