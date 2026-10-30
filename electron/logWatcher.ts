import type { RaidMode } from '../src/domain/types.js'
import { buildScanResult, identityScanResult, logScanSignature, type ModeLogScanResult } from '../src/import/eftLogTimeline.js'
import type { RaidState } from '../src/import/raidState.js'

/**
 * The game's logs, from the main process alone (audit steps 1–3, 13, 14): found and followed from the app's start —
 * before sign-in, whatever the page shows — so the account, the mode and the raid state are known within seconds of the
 * start (#202, «персонаж должен находиться сразу при первом запуске»), not after the app was unlocked and a page asked.
 *
 * - Discovery at the start; while nothing is found, again every minute (only the places already known, no registry or
 *   drives), and fully when the game's window appears (a first start creates the Logs folder). A game start also checks,
 *   a little later, whether another install of the game got the newer launch.
 * - Identity first: the newest launches' application logs give the mode, each mode's game account and profile, published
 *   as an identity-only scan; then every launch is read (the kept logs make that quick after the first run).
 * - Constant tracking (owner, 15.10.2026: «сделай постоянное отслеживание журналов»): the Logs folder is watched
 *   (`watchFolder`, fs.watch with new launch folders and files), and every change polls within a second — the raid state
 *   of the newest launch and, outside a raid, the scan of what was appended (the scanner reads only the new bytes, never
 *   a whole log again). A slow safety poll (LOG_SAFETY_POLL_MS) catches what a watch missed; while the watch is down
 *   (an error, EBUSY/EPERM, a rotated or deleted folder) the fast poll stands in and the watch restarts with backoff. A
 *   folder that disappears is looked for again, and followed again when it reappears or the game starts. Nothing the app
 *   does stops it: the first scan, «the logs hold the whole history», a reset, a sign-out, a hidden window.
 * - Each scan is published only when its signature changed (a PvP hand-in while a Season event was last in the list
 *   used to go unpublished). The watch state goes to the page as `logs:watch-state` (src/import/logStatus.ts).
 * - Resets count only for the catalog's trader quests (setQuestIds): before the page told them, none is detected.
 *
 * No Electron here: main.ts passes the file and window functions (unit-tested in logWatcher.test.ts).
 */

export type QuestIdsByMode = Partial<Record<RaidMode, string[]>>

/** A published scan with the Logs folder it came from (what `logs:updated` carries). */
export type PublishedLogScan = ModeLogScanResult & { folder: string }

export interface LogWatcherDeps {
  /**
   * The Logs folder the game started in last among every one found and `extra`; undefined when none. `thorough`: also the
   * registry, Steam's lists and (when nothing fresh is found) the drives; otherwise only the places known already.
   */
  discover(options: { thorough: boolean; extra: string[] }): Promise<string | undefined>
  scan(root: string, options: { trustedQuestIds?: Partial<Record<RaidMode, ReadonlySet<string>>> }): Promise<ModeLogScanResult>
  identity(root: string, options: { trustedQuestIds?: Partial<Record<RaidMode, ReadonlySet<string>>> }): Promise<ModeLogScanResult>
  raidState(root: string): Promise<RaidState>
  send(channel: 'logs:updated' | 'game:raid-state' | 'logs:watch-state', payload: unknown): void
  /**
   * Watches a Logs folder and its launch folders (fs.watch, recursive): `onChange` on any change, `onError` when the
   * watch broke. Returns the function that ends the watch. Without it the folder is polled at LOG_POLL_MS.
   */
  watchFolder?(root: string, onChange: () => void, onError: (error: unknown) => void): () => void
  /** Whether the folder still exists (a deleted or moved Logs folder is looked for again). */
  exists?(root: string): Promise<boolean>
  /** The game's window in front (its handle and process), null for any other: a value not seen before is a game start. */
  gameWindow?(): string | null
  /** A folder is followed now (it may be watched by the page's requests, and is remembered for the next start). */
  onFolder?(folder: string): void
  /** A raid ended (the raid signs of the minimap no longer hold the quest scanner back). */
  onRaidOver?(): void
  /** Whether the game runs now (false: closed; null: cannot tell). A closed game is in no raid, whatever its logs say. */
  gameRunning?(): Promise<boolean | null>
  /** What the last run kept: the logs read (into the scanner) and the quest ids, which it returns. Once per start. */
  loadKept?(): Promise<QuestIdsByMode>
  saveQuestIds?(ids: QuestIdsByMode): Promise<void>
  /** Keeps what the logs gave for the next start (electron/logScanner.ts saveLogCache). */
  saveCache?(): Promise<unknown>
}

/** The poll while the folder is not watched (no watch, or it is down): the raid state and appended lines within seconds. */
export const LOG_POLL_MS = 5_000
/** The safety poll while the folder is watched: catches what a watch missed. */
export const LOG_SAFETY_POLL_MS = 45_000
/** A burst of changes (a log written line by line) polls once, this long after the first. */
export const WATCH_DEBOUNCE_MS = 400
/** The watch restarts after an error this long later, doubled each time up to WATCH_RETRY_MAX_MS. */
export const WATCH_RETRY_MS = 1_000
export const WATCH_RETRY_MAX_MS = 60_000

/** What the page shows (src/import/logStatus.ts): followed by a watch, by polling only, or nothing followed. */
export interface LogWatchState { folder: string; mode: 'watch' | 'poll' | 'none'; changedAt?: number }
/** No Logs folder yet: looked for again this often (the places known already). */
export const LOG_RETRY_MS = 60_000
/** The game's window is looked for this often (two cheap Windows calls). */
export const GAME_CHECK_MS = 5_000
/** After a game start: whether another install got the new launch (the Logs folder of a first start appears late). */
export const GAME_START_RECHECK_MS = 45_000
/** The kept logs are written at most this often. */
export const CACHE_SAVE_MS = 60_000

const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

export interface LogWatcher {
  start(): void
  stop(): void
  /** Forget everything followed (and start again): «Очистить все данные». */
  restart(): void
  folder(): string
  raidState(): RaidState
  /** The folder and the latest scan once the first lookup (and the first identity of a found folder) is through. */
  ready(extra?: string[]): Promise<{ folder: string; notFound: boolean; result: PublishedLogScan | null }>
  /** Follow this folder (the page picked it, or asked for one it may watch). */
  watch(folder: string): void
  /** The catalog's trader quest ids of one mode; true when they changed (the logs are then summarized again). */
  setQuestIds(mode: RaidMode, ids: readonly string[]): Promise<boolean>
  /** One poll now (tests; the timer does the same). */
  poll(): Promise<void>
  /** How the folder is followed now. */
  watchState(): LogWatchState
}

export function createLogWatcher(deps: LogWatcherDeps): LogWatcher {
  let folder = ''
  let notFound = false
  let raid: RaidState = { inRaid: false }
  let latest: PublishedLogScan | null = null
  let lastSignature = ''
  /** The identity of the followed folder was published (the full scans come after). */
  let identityDone = false
  let firstPoll = true
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let gameTimer: ReturnType<typeof setInterval> | null = null
  let recheckTimer: ReturnType<typeof setTimeout> | null = null
  let polling: Promise<void> | null = null
  let pollAgain = false
  let finding: Promise<string | undefined> | null = null
  let started: Promise<void> | null = null
  let lastGameWindow: string | null = null
  let lastCacheSave = 0
  let cacheTimer: ReturnType<typeof setTimeout> | null = null
  let closeWatch: (() => void) | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let watchRetryTimer: ReturnType<typeof setTimeout> | null = null
  let watchFailures = 0
  let watchMode: LogWatchState['mode'] = 'none'
  let changedAt: number | undefined
  let pollPace = 0
  /** Who waits for the identity of the followed folder (ready): told once it is published, or the poll gave up. */
  let identityWaiters: Array<() => void> = []
  /** Per mode, the ids as the page sent them; `trusted` is the one object a scan gets (a new one = summarize again). */
  const questIds: QuestIdsByMode = {}
  let trusted: Partial<Record<RaidMode, ReadonlySet<string>>> = {}

  const scanOptions = () => ({ trustedQuestIds: trusted })

  /** The modes `ids` names take its lists (an empty one: that mode's ids are not known); the others keep theirs. */
  function takeQuestIds(ids: QuestIdsByMode) {
    for (const mode of MODES) {
      const list = ids[mode]
      if (!Array.isArray(list)) continue
      if (list.length) questIds[mode] = [...new Set(list)]
      else delete questIds[mode]
    }
    trusted = Object.fromEntries(MODES.filter((mode) => questIds[mode]?.length).map((mode) => [mode, new Set(questIds[mode])]))
  }

  function publish(result: ModeLogScanResult, root: string) {
    if (root !== folder) return
    const signature = result.signature ?? logScanSignature(result)
    if (signature === lastSignature) return
    lastSignature = signature
    latest = { ...result, signature, folder: root }
    deps.send('logs:updated', latest)
    changedAt = Date.now()
    sendWatchState()
  }

  function sendWatchState() {
    deps.send('logs:watch-state', { folder, mode: watchMode, ...(changedAt ? { changedAt } : {}) } satisfies LogWatchState)
  }

  function setWatchMode(mode: LogWatchState['mode']) {
    if (mode === watchMode) return
    watchMode = mode
    sendWatchState()
  }

  /** The poll's pace: slow while the watch works, fast while it does not. */
  function schedulePolls() {
    const pace = folder ? (watchMode === 'watch' ? LOG_SAFETY_POLL_MS : LOG_POLL_MS) : 0
    // The same pace keeps its timer: a watch failing again and again must not keep postponing the fast poll.
    if (pollTimer && pace === pollPace) return
    if (pollTimer) clearInterval(pollTimer)
    pollPace = pace
    pollTimer = pace ? setInterval(() => { void poll() }, pace) : null
  }

  function stopWatch() {
    closeWatch?.()
    closeWatch = null
    for (const timer of [debounceTimer, watchRetryTimer]) if (timer) clearTimeout(timer)
    debounceTimer = watchRetryTimer = null
  }

  /** Watches `root`; on an error the fast poll stands in and the watch starts again with backoff. */
  function startWatch(root: string) {
    stopWatch()
    if (!deps.watchFolder) { setWatchMode('poll'); schedulePolls(); return }
    try {
      closeWatch = deps.watchFolder(root, () => {
        if (root !== folder || debounceTimer) return
        debounceTimer = setTimeout(() => { debounceTimer = null; void poll() }, WATCH_DEBOUNCE_MS)
      }, () => { if (root === folder) watchBroke(root) })
      watchFailures = 0
      setWatchMode('watch')
    } catch {
      watchBroke(root)
      return
    }
    schedulePolls()
  }

  function watchBroke(root: string) {
    closeWatch?.()
    closeWatch = null
    setWatchMode('poll')
    schedulePolls()
    if (watchRetryTimer) return
    const wait = Math.min(WATCH_RETRY_MAX_MS, WATCH_RETRY_MS * 2 ** watchFailures)
    watchFailures += 1
    watchRetryTimer = setTimeout(() => {
      watchRetryTimer = null
      if (root !== folder) return
      void (deps.exists?.(root) ?? Promise.resolve(true)).catch(() => false).then((there) => {
        if (root !== folder) return
        if (there) startWatch(root)
        else folderGone(root)
      })
    }, wait)
  }

  /** The followed folder is gone (deleted, moved, a drive away): followed no more, looked for again until found. */
  function folderGone(root: string) {
    if (root !== folder) return
    stopWatch()
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    folder = ''
    latest = null
    lastSignature = ''
    setWatchMode('none')
    void find(true)
  }

  function scheduleCacheSave() {
    if (!deps.saveCache || cacheTimer) return
    const wait = Math.max(0, lastCacheSave + CACHE_SAVE_MS - Date.now())
    cacheTimer = setTimeout(() => {
      cacheTimer = null
      lastCacheSave = Date.now()
      void deps.saveCache?.().catch(() => undefined)
    }, wait)
  }

  function identityReached() {
    const waiters = identityWaiters
    identityWaiters = []
    for (const resolve of waiters) resolve()
  }

  async function pollOnce() {
    const root = folder
    if (!root) return
    if (deps.exists && !await deps.exists(root).catch(() => false)) { folderGone(root); return }
    const next = await deps.raidState(root).catch((): RaidState => ({ inRaid: false }))
    if (root !== folder) return
    const changed = next.inRaid !== raid.inRaid
    // The raid's map is named only by a later line (TRACE-NetworkGameCreate … Location:) than the one the raid starts
    // with: the window hears of it too, or it draws the screenshot's dot on whatever map is open (owner, 20.10.2026: the
    // Factory position showed on Customs).
    const moved = next.location !== raid.location || next.since !== raid.since
    raid = next
    // The raid is over: the minimap and the other raid signs no longer hold the quest scanner back.
    if (changed && !next.inRaid) deps.onRaidOver?.()
    if (changed || moved || firstPoll) deps.send('game:raid-state', { ...next, tracked: true })
    firstPoll = false
    if (!identityDone) {
      const identity = await deps.identity(root, scanOptions()).catch(() => null)
      if (root !== folder) return
      identityDone = true
      if (identity) publish(identity, root)
      identityReached()
    }
    // Quest logs are read every few seconds, but never in a raid (the game needs the computer then) — unless the game is
    // closed: its logs may still say «in a raid» (closed right after one), and a player who deletes the logs before the
    // next start would lose that session's quests for good (owner, 31.10.2026: «квесты так и не синхронизировались»).
    if (next.inRaid && (await deps.gameRunning?.().catch(() => null)) !== false) return
    const full = await deps.scan(root, scanOptions()).catch(() => null)
    if (!full || root !== folder) return
    publish(full, root)
    scheduleCacheSave()
  }

  /** One poll at a time; a poll asked for meanwhile runs right after (new quest ids must not be lost). */
  function poll(): Promise<void> {
    if (polling) {
      pollAgain = true
      return polling
    }
    polling = (async () => {
      try {
        do {
          pollAgain = false
          await pollOnce()
        } while (pollAgain && folder)
      } finally {
        polling = null
        identityReached()
      }
    })()
    return polling
  }

  /** Follows `next` from now on; the first poll (raid state, identity, then the full read) starts at once. */
  function watch(next: string) {
    if (!next || (next === folder && pollTimer)) return
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    folder = next
    notFound = false
    latest = null
    lastSignature = ''
    identityDone = false
    firstPoll = true
    deps.onFolder?.(next)
    startWatch(next)
    void poll()
  }

  /** Looks for the Logs folder; switches to another one only when the game started there last. */
  function find(thorough: boolean, extra: string[] = []): Promise<string | undefined> {
    if (finding) return finding
    finding = (async () => {
      try {
        const found = await deps.discover({ thorough, extra: [...(folder ? [folder] : []), ...extra] }).catch(() => undefined)
        if (found && found !== folder) watch(found)
        else if (!found && !folder) notFound = true
        return folder || undefined
      } finally {
        finding = null
      }
    })()
    return finding
  }

  function checkGame() {
    const id = deps.gameWindow?.() ?? null
    if (!id || id === lastGameWindow) return
    lastGameWindow = id
    // A game start: without a folder, look everywhere now (a first start creates its Logs folder in the first seconds,
    // so once more a little later too); with one, check later whether another install got the newer launch.
    if (!folder) void find(true)
    if (recheckTimer) clearTimeout(recheckTimer)
    recheckTimer = setTimeout(() => { recheckTimer = null; void find(true) }, GAME_START_RECHECK_MS)
  }

  function start() {
    if (started) return
    started = (async () => {
      const kept = await deps.loadKept?.().catch(() => ({})) ?? {}
      // The page may have sent fresher ids meanwhile: those stay.
      const fresh = { ...questIds }
      takeQuestIds({ ...kept, ...fresh })
      await find(true)
    })()
    retryTimer = setInterval(() => { if (!folder) void find(false) }, LOG_RETRY_MS)
    gameTimer = setInterval(checkGame, GAME_CHECK_MS)
  }

  function stop() {
    stopWatch()
    watchMode = 'none'
    watchFailures = 0
    changedAt = undefined
    for (const timer of [pollTimer, retryTimer, gameTimer]) if (timer) clearInterval(timer)
    for (const timer of [recheckTimer, cacheTimer]) if (timer) clearTimeout(timer)
    pollTimer = retryTimer = gameTimer = null
    recheckTimer = cacheTimer = null
    started = null
    folder = ''
    notFound = false
    latest = null
    lastSignature = ''
    identityDone = false
    firstPoll = true
    lastGameWindow = null
    raid = { inRaid: false }
    identityReached()
  }

  async function ready(extra: string[] = []) {
    if (!started) start()
    await started
    if (finding) await finding
    if (!folder) await find(false, extra)
    // The first poll of a folder publishes its identity: wait for that, not for the full read of every launch.
    if (folder && !identityDone && polling) await new Promise<void>((resolve) => { identityWaiters.push(resolve) })
    return { folder, notFound: !folder && notFound, result: latest }
  }

  async function setQuestIds(mode: RaidMode, ids: readonly string[]) {
    const next = [...new Set(ids)].sort()
    const current = [...(questIds[mode] ?? [])].sort()
    if (next.length === current.length && next.every((id, index) => id === current[index])) return false
    takeQuestIds({ ...questIds, [mode]: next })
    await deps.saveQuestIds?.({ ...questIds }).catch(() => undefined)
    // Summarized again with the new ids (a reset may count now, or no longer): published when that changes anything.
    if (folder) void poll()
    return true
  }

  return {
    start,
    stop,
    restart() { stop(); start() },
    folder: () => folder,
    raidState: () => raid,
    ready,
    watch,
    setQuestIds,
    poll,
    watchState: () => ({ folder, mode: watchMode, ...(changedAt ? { changedAt } : {}) }),
  }
}

/** What `logs:auto-find-and-scan` answers while a found folder has no scan yet: the folder and nothing known. */
export function emptyLogScan(folder: string): PublishedLogScan {
  return { ...identityScanResult(buildScanResult([], 0)), folder }
}
