/**
 * The desktop app as a shell of the API server (docs/local-server.md).
 *
 * When a server account is signed in (Profile → «Аккаунт сервера»), the app sends what only it can capture —
 * quest events from the EFT logs, the Collector checklist, the latest screenshot position and a few preferences —
 * to `/v1/me/*` and applies the server's copy back. Without a server or an account everything keeps working
 * locally; nothing here ever throws into the UI. PvP, PvE and Seasonal are always sent and applied separately.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ModeRegistration, RaidMode } from '../domain/types'
import type { ServerAccountStatus } from '../electron.d'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import { logEventsForMode } from '../import/logApply'
import type { ParsedTaskEvent } from '../import/logParser'
import { clearCollectorDirty, COLLECTOR_CHANGED_EVENT, isCollectorDirty, loadCollected, saveCollected } from '../kappa/collector'
import { canonicalMapId } from '../data/mapIds'
import { currentTheme, saveAppearance, THEME_CHANGED_EVENT, THEMES } from '../theme/theme'
import type { ExperimentalSettings } from '../overlay/types'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import { isDesktopShell, isMobileLayout, isNative } from '../platform'
import { webAccountLogin, webAccountLogout, webAccountPhoneSignIn, webAccountStatus, webServiceRequest } from './webAccount'

export const RAID_MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']
export const STATUS_REFRESH_MS = 30_000
export const POSITION_THROTTLE_MS = 2_000
const HEX_ID = /^[a-f0-9]{24}$/i
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_EVENTS_PER_BATCH = 2000

// ------------------------------------------------------------------------------------------------------------
// Account status store (shared by the Profile page and the background sync)
// ------------------------------------------------------------------------------------------------------------

export type ServerState = { status: ServerAccountStatus | null; checking: boolean }
let state: ServerState = { status: null, checking: false }
const listeners = new Set<() => void>()
const setState = (next: Partial<ServerState>) => { state = { ...state, ...next }; for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/**
 * The phone app (and the browser preview at phone width) talks to the server over fetch (sync/webAccount.ts);
 * the desktop app through the Electron main process. A desktop browser tab without the shell stays local.
 */
export function usesWebAccount() {
  return typeof window !== 'undefined' && !isDesktopShell() && (isNative() || isMobileLayout())
}

const webAccountApi = { status: webAccountStatus, login: webAccountLogin, logout: webAccountLogout, phoneSignIn: webAccountPhoneSignIn }

const accountApi = () => (typeof window === 'undefined' ? undefined : window.tarkovDesktop?.account ?? (usesWebAccount() ? webAccountApi : undefined))

const serviceClient = () => {
  if (typeof window === 'undefined') return undefined
  if (window.tarkovDesktop?.serviceRequest) return window.tarkovDesktop.serviceRequest
  return usesWebAccount() ? webServiceRequest : undefined
}

/** Electron prefixes errors from the main process; keep only the human message. */
export function cleanIpcError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') || 'Сервер недоступен'
}

export async function refreshServerStatus(): Promise<ServerAccountStatus | null> {
  const api = accountApi()
  if (!api) return null
  setState({ checking: true })
  try {
    const status = await api.status()
    setState({ status, checking: false })
    return status
  } catch {
    const offline: ServerAccountStatus = { signedIn: state.status?.signedIn ?? false, email: state.status?.email, kind: state.status?.kind, online: false, serverUrl: state.status?.serverUrl ?? '', persistent: state.status?.persistent ?? false }
    setState({ status: offline, checking: false })
    return offline
  }
}

export async function loginToServer(email: string, password: string) {
  const api = accountApi()
  if (!api) throw new Error('Вход доступен только в приложении для Windows')
  try {
    const status = await api.login(email, password)
    setState({ status })
    void runFullSync()
    return status
  } catch (error) {
    throw new Error(cleanIpcError(error), { cause: error })
  }
}

/** Sign-in or password reset by phone after the SMS code; the session is kept like after a password sign-in. */
export async function phoneSignInToServer(kind: 'login' | 'reset', challengeId: string, code: string, password?: string) {
  const api = accountApi()
  if (!api?.phoneSignIn) throw new Error('Обновите приложение: вход по SMS появился в новой версии')
  try {
    const status = await api.phoneSignIn(kind, challengeId, code, password)
    setState({ status })
    void runFullSync()
    return status
  } catch (error) {
    throw new Error(cleanIpcError(error), { cause: error })
  }
}

export async function logoutFromServer() {
  const api = accountApi()
  if (!api) return
  try { setState({ status: await api.logout() }) } catch { void refreshServerStatus() }
}

export function useServerAccount() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state)
  useEffect(() => { void refreshServerStatus() }, [])
  return { ...snapshot, available: Boolean(accountApi()), refresh: refreshServerStatus, login: loginToServer, logout: logoutFromServer }
}

const connected = () => Boolean(state.status?.signedIn && state.status.online)

/** `/v1/me/*` through the main-process gateway. null = no desktop, not signed in or server offline. */
async function meRequest<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T | null> {
  const request = serviceClient()
  if (!request || !state.status?.signedIn) return null
  try {
    return await request(method, path, body) as T | null
  } catch (error) {
    const message = cleanIpcError(error)
    // Server stopped or the session expired: refresh the status so Profile shows it; retried on reconnect.
    if (/недоступен|Сессия истекла/i.test(message)) void refreshServerStatus()
    return null
  }
}

// ------------------------------------------------------------------------------------------------------------
// Quest progress from the logs
// ------------------------------------------------------------------------------------------------------------

interface ServerRecord { taskId: string; status: 'active' | 'completed' | 'failed'; updatedAt: string }
type ApplyServerEvents = (mode: RaidMode, events: ParsedTaskEvent[], characterId: string) => void

let lastLogPush: { result: ModeLogScanResult; registrationOf: (mode: RaidMode) => ModeRegistration; apply: ApplyServerEvents } | null = null
const progressBusy = new Set<RaidMode>()

function isoTime(value: string) {
  const time = Date.parse(value)
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null
}

/** Events of one mode in the shape the server validates (24-hex ids, ISO UTC timestamps). */
export function serverEventsForMode(result: ModeLogScanResult, mode: RaidMode, registration: ModeRegistration) {
  return logEventsForMode(result, mode, registration).flatMap((event) => {
    const timestamp = isoTime(event.timestamp)
    return HEX_ID.test(event.taskId) && timestamp && ['active', 'completed', 'failed'].includes(event.status)
      ? [{ taskId: event.taskId, status: event.status, timestamp }]
      : []
  })
}

export function parseServerRecords(value: unknown): ParsedTaskEvent[] | null {
  const records = (value as { records?: unknown } | null)?.records
  if (!Array.isArray(records)) return null
  return records.flatMap((entry): ParsedTaskEvent[] => {
    const record = entry as Partial<ServerRecord> | null
    if (!record || typeof record.taskId !== 'string' || !HEX_ID.test(record.taskId) || typeof record.updatedAt !== 'string' || !isoTime(record.updatedAt)) return []
    if (record.status !== 'active' && record.status !== 'completed' && record.status !== 'failed') return []
    return [{ taskId: record.taskId, status: record.status, timestamp: record.updatedAt }]
  })
}

/**
 * Sends each mode's log events to the server after a log scan and applies the merged server records back
 * (source 'eft-log'), so progress read before the game rotated its logs is not lost.
 */
export async function pushLogProgress(result: ModeLogScanResult, registrationOf: (mode: RaidMode) => ModeRegistration, apply: ApplyServerEvents) {
  lastLogPush = { result, registrationOf, apply }
  if (!connected()) return
  for (const mode of RAID_MODES) {
    const summary = result.summaryByMode?.[mode]
    if (!summary?.lastActivityAt || progressBusy.has(mode)) continue
    const characterId = result.latestCharacterIdByMode?.[mode]
    if (!characterId || !HEX_ID.test(characterId)) continue
    progressBusy.add(mode)
    try {
      const registration = registrationOf(mode)
      const accountId = registration.status === 'registered' ? registration.accountId : result.latestAccountIdByMode?.[mode]
      const events = serverEventsForMode(result, mode, registration)
      const resetAt = summary.resetAt ? isoTime(summary.resetAt) : null
      let answer: unknown = null
      for (let start = 0; start === 0 || start < events.length; start += MAX_EVENTS_PER_BATCH) {
        answer = await meRequest('POST', `/v1/me/progress/${mode}/events`, {
          ...(accountId && Number.isSafeInteger(accountId) && accountId > 0 ? { accountId } : {}),
          characterId,
          ...(resetAt && start === 0 ? { resetAt } : {}),
          events: events.slice(start, start + MAX_EVENTS_PER_BATCH),
        })
        if (!answer) break
      }
      const merged = parseServerRecords(answer)
      if (merged) apply(mode, merged, characterId)
    } finally {
      progressBusy.delete(mode)
    }
  }
}

// ------------------------------------------------------------------------------------------------------------
// Collector checklist
// ------------------------------------------------------------------------------------------------------------

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((entry) => b.includes(entry))

/** Local edits made offline are pushed first; otherwise the server copy replaces the local cache. */
export async function syncCollector(mode: RaidMode) {
  if (!connected()) return
  if (isCollectorDirty(mode)) {
    const local = loadCollected(mode).filter((id) => ITEM_ID.test(id))
    const answer = await meRequest<{ itemIds?: unknown }>('PUT', `/v1/me/collector/${mode}`, { itemIds: local })
    if (answer && sameSet(loadCollected(mode).filter((id) => ITEM_ID.test(id)), local)) clearCollectorDirty(mode)
    return
  }
  const answer = await meRequest<{ itemIds?: unknown }>('GET', `/v1/me/collector/${mode}`)
  if (!answer || !Array.isArray(answer.itemIds)) return
  const remote = answer.itemIds.filter((id): id is string => typeof id === 'string')
  if (!isCollectorDirty(mode) && !sameSet(remote, loadCollected(mode))) saveCollected(mode, remote, { fromServer: true })
}

// ------------------------------------------------------------------------------------------------------------
// Settings (theme, overlay and hotkey preferences)
// ------------------------------------------------------------------------------------------------------------

const SETTINGS_META_KEY = 'tarkov-server-settings-sync-v1'
/** Machine-specific values (like the screenshots folder) never leave this computer. */
const SYNCED_EXPERIMENTAL_KEYS = ['itemLookup', 'minimap', 'tracking', 'autoScreenshot', 'screenshotIntervalMs', 'itemKey', 'minimapKey', 'collectorKey', 'minimapOpacity', 'playerMarker'] as const

interface SyncedSettings { theme: string; experimental?: Partial<ExperimentalSettings> }

function readMeta(): { hash?: string; serverUpdatedAt?: string } {
  try { return JSON.parse(localStorage.getItem(SETTINGS_META_KEY) ?? '{}') as { hash?: string; serverUpdatedAt?: string } } catch { return {} }
}
function writeMeta(meta: { hash: string; serverUpdatedAt?: string }) {
  try { localStorage.setItem(SETTINGS_META_KEY, JSON.stringify(meta)) } catch { /* storage unavailable */ }
}

async function collectLocalSettings(): Promise<SyncedSettings> {
  const settings: SyncedSettings = { theme: currentTheme() }
  const experimental = await window.tarkovDesktop?.experimental?.getSettings().catch(() => null)
  if (experimental) settings.experimental = Object.fromEntries(SYNCED_EXPERIMENTAL_KEYS.map((key) => [key, experimental[key]])) as Partial<ExperimentalSettings>
  return settings
}

async function applyServerSettings(remote: Record<string, unknown>) {
  const theme = typeof remote.theme === 'string' && THEMES.some((entry) => entry.id === remote.theme) ? remote.theme : currentTheme()
  if (theme !== currentTheme()) {
    saveAppearance(theme)
    window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
  }
  const experimental = remote.experimental
  if (experimental && typeof experimental === 'object' && window.tarkovDesktop?.experimental) {
    const patch = Object.fromEntries(Object.entries(experimental as Record<string, unknown>).filter(([key]) => (SYNCED_EXPERIMENTAL_KEYS as readonly string[]).includes(key)))
    // The main process sanitizes every value (hotkeys, ranges) before saving.
    await window.tarkovDesktop.experimental.updateSettings(patch as Partial<ExperimentalSettings>).catch(() => null)
  }
}

/** Local changes since the last sync win; otherwise a newer server copy (another PC, the website) is applied. */
let settingsBusy = false

export async function syncSettings() {
  // The phone keeps its own theme (its default is «Чёрный мультикам») and has no overlay/hotkey settings, so it
  // neither overwrites the desktop's synced settings nor takes the desktop theme.
  if (!connected() || settingsBusy || !isDesktopShell()) return
  settingsBusy = true
  try { await syncSettingsOnce() } finally { settingsBusy = false }
}

async function syncSettingsOnce() {
  const local = await collectLocalSettings()
  const hash = JSON.stringify(local)
  const meta = readMeta()
  const remote = await meRequest<{ settings?: Record<string, unknown>; updatedAt?: string | null }>('GET', '/v1/me/settings')
  if (!remote) return
  const serverUpdatedAt = remote.updatedAt ?? undefined
  const localChanged = meta.hash !== undefined && meta.hash !== hash
  const serverChanged = Boolean(serverUpdatedAt) && serverUpdatedAt !== meta.serverUpdatedAt
  if (serverChanged && !localChanged && remote.settings) {
    await applyServerSettings(remote.settings)
    writeMeta({ hash: JSON.stringify(await collectLocalSettings()), serverUpdatedAt })
    return
  }
  if (localChanged || !serverUpdatedAt || meta.hash === undefined) {
    const saved = await meRequest<{ updatedAt?: string }>('PUT', '/v1/me/settings', { settings: local })
    if (saved) writeMeta({ hash, serverUpdatedAt: saved.updatedAt })
  }
}

// ------------------------------------------------------------------------------------------------------------
// Position from the screenshot tracker
// ------------------------------------------------------------------------------------------------------------

/** Posts at most one position every `POSITION_THROTTLE_MS`; the newest one always gets through. */
export function createPositionThrottle(send: (position: PlayerPosition) => void, intervalMs = POSITION_THROTTLE_MS, now = () => Date.now()) {
  let lastSent = 0
  let pending: PlayerPosition | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    if (!pending) return
    lastSent = now()
    const next = pending
    pending = null
    send(next)
  }
  return {
    push(position: PlayerPosition) {
      pending = position
      const wait = intervalMs - (now() - lastSent)
      if (wait <= 0) flush()
      else if (!timer) timer = setTimeout(flush, wait)
    },
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = null },
  }
}

function validPosition(position: PlayerPosition) {
  return [position.x, position.y, position.z, position.yaw, position.at].every((value) => typeof value === 'number' && Number.isFinite(value))
    && Math.abs(position.x) <= 100_000 && Math.abs(position.y) <= 100_000 && Math.abs(position.z) <= 100_000 && position.at > 0
}

// ------------------------------------------------------------------------------------------------------------
// Phone: progress and the live position come from the server (the desktop app reads the logs and screenshots)
// ------------------------------------------------------------------------------------------------------------

/** A position older than this is shown as «нет свежей позиции» on the phone. */
export const POSITION_FRESH_MS = 3 * 60_000
export const POSITION_POLL_MS = 3_000

export interface ServerPosition extends PlayerPosition { map?: string; receivedAt?: string }

export function parseServerPosition(value: unknown): ServerPosition | null {
  const position = (value as { position?: unknown } | null)?.position as Partial<ServerPosition> | null | undefined
  if (!position || typeof position !== 'object') return null
  const candidate = { x: position.x, y: position.y, z: position.z, yaw: position.yaw, at: position.at } as PlayerPosition
  if (!validPosition(candidate)) return null
  const map = typeof position.map === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(position.map) ? canonicalMapId(position.map) : undefined
  return { ...candidate, ...(map ? { map } : {}), ...(typeof position.receivedAt === 'string' ? { receivedAt: position.receivedAt } : {}) }
}

/**
 * How current the desktop-reported position is. The newer of the capture time and the server receive time counts
 * (a PC clock that runs slow must not hide a live position); a position without a map cannot be drawn.
 */
export function positionFreshness(position: ServerPosition | null, now = Date.now(), maxAgeMs = POSITION_FRESH_MS) {
  if (!position) return { state: 'none' as const, ageMs: null }
  const received = position.receivedAt ? Date.parse(position.receivedAt) : NaN
  const latest = Math.max(position.at, Number.isFinite(received) ? received : 0)
  const ageMs = Math.max(0, now - latest)
  if (!position.map) return { state: 'no-map' as const, ageMs }
  return { state: ageMs <= maxAgeMs ? 'fresh' as const : 'stale' as const, ageMs }
}

/** The latest position the desktop app pushed for this mode; null when signed out, offline or none yet. */
export async function fetchServerPosition(mode: RaidMode) {
  const answer = await meRequest<{ position?: unknown }>('GET', `/v1/me/position/${mode}`)
  return answer ? parseServerPosition(answer) : null
}

/** Phone: the merged task records the desktop app uploaded for this mode, applied like a log scan. */
export async function pullServerProgress(mode: RaidMode, apply: ApplyServerEvents) {
  if (!connected() || !usesWebAccount() || progressBusy.has(mode)) return
  progressBusy.add(mode)
  try {
    const answer = await meRequest<{ records?: unknown; scope?: { characterId?: unknown } | null }>('GET', `/v1/me/progress/${mode}`)
    const characterId = typeof answer?.scope?.characterId === 'string' && HEX_ID.test(answer.scope.characterId) ? answer.scope.characterId : null
    const records = parseServerRecords(answer)
    if (records && characterId) apply(mode, records, characterId)
  } finally {
    progressBusy.delete(mode)
  }
}

// ------------------------------------------------------------------------------------------------------------
// Background loop (mounted once in AppShell)
// ------------------------------------------------------------------------------------------------------------

let fullSyncRunning = false

/** Everything that may have waited for the server: Collector (all modes), settings and the last log scan. */
export async function runFullSync() {
  if (fullSyncRunning || !connected()) return
  fullSyncRunning = true
  try {
    for (const mode of RAID_MODES) await syncCollector(mode)
    await syncSettings()
    if (lastLogPush) await pushLogProgress(lastLogPush.result, lastLogPush.registrationOf, lastLogPush.apply)
  } finally {
    fullSyncRunning = false
  }
}

export function useServerSync(raidMode: RaidMode, applyProgress?: ApplyServerEvents) {
  const modeRef = useRef(raidMode)
  useEffect(() => { modeRef.current = raidMode }, [raidMode])
  const applyRef = useRef(applyProgress)
  useEffect(() => { applyRef.current = applyProgress })
  const pullProgress = useCallback((mode: RaidMode) => {
    const apply = applyRef.current
    if (apply) void pullServerProgress(mode, apply).catch(() => {})
  }, [])

  // Status poll; when the server comes back (or the user signs in) everything cached offline is pushed.
  useEffect(() => {
    if (!accountApi()) return
    let alive = true
    let wasConnected = false
    const tick = async () => {
      await refreshServerStatus()
      if (!alive) return
      const now = connected()
      if (now && !wasConnected) await runFullSync()
      else if (now) { await syncCollector(modeRef.current); await syncSettings() }
      if (now) pullProgress(modeRef.current)
      wasConnected = now
    }
    void tick()
    const timer = window.setInterval(() => void tick(), STATUS_REFRESH_MS)
    const onCollector = () => { void syncCollector(modeRef.current) }
    const onTheme = () => { void syncSettings() }
    window.addEventListener(COLLECTOR_CHANGED_EVENT, onCollector)
    window.addEventListener(THEME_CHANGED_EVENT, onTheme)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(COLLECTOR_CHANGED_EVENT, onCollector)
      window.removeEventListener(THEME_CHANGED_EVENT, onTheme)
    }
  }, [pullProgress])

  // Screenshot positions → /v1/me/position/:mode (the mode the app is on when the screenshot arrives).
  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop?.experimental?.onPosition) return
    let location = ''
    void desktop.getRaidState?.().then((raid) => { location = raid?.location ?? '' }).catch(() => {})
    const offRaid = desktop.onRaidStateChanged?.((raid) => { location = raid.inRaid ? raid.location ?? '' : '' })
    const throttle = createPositionThrottle((position) => {
      const map = location ? canonicalMapId(location) : ''
      void meRequest('POST', `/v1/me/position/${modeRef.current}`, {
        x: position.x, y: position.y, z: position.z, yaw: position.yaw, at: Math.round(position.at),
        ...(map && /^[A-Za-z0-9_-]{1,40}$/.test(map) ? { map } : {}),
      })
    })
    const offPosition = desktop.experimental.onPosition((position) => {
      if (connected() && validPosition(position)) throttle.push(position)
    })
    return () => { throttle.cancel(); offPosition(); offRaid?.() }
  }, [])

  // Switching mode pulls that mode's Collector checklist (and, on the phone, its task progress).
  useEffect(() => { void syncCollector(raidMode); pullProgress(raidMode) }, [raidMode, pullProgress])
}
