/**
 * The desktop app as a shell of the API server (docs/local-server.md).
 *
 * When a server account is signed in (Profile → «Аккаунт сервера»), the app sends what only it can capture —
 * quest events from the EFT logs, the Collector checklist and a few preferences — to `/v1/me/*` and applies the
 * server's copy back. The latest screenshot position and the recognised item go to the live relay (`/v1/live/*`, stored
 * nowhere) for the phone of the account. Without a server or an account everything keeps working
 * locally; nothing here ever throws into the UI. PvP, PvE and Seasonal are always sent and applied separately.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ModeProgress, ModeRegistration, ObjectiveProgress, ProgressEvent, RaidMode } from '../domain/types'
import { ENTITY_ID_PATTERN, EVENT_ID_PATTERN, OBJECTIVE_TYPE_PATTERN } from '../progression/objectiveProgress'
import type { ServerAccountStatus, ServerRegistrationResult } from '../electron.d'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import { logEventsForMode } from '../import/logApply'
import type { ParsedTaskEvent } from '../import/logParser'
import { clearCollectorDirty, COLLECTOR_CHANGED_EVENT, isCollectorDirty, loadCollected, saveCollected } from '../kappa/collector'
import { clearHideoutDirty, HIDEOUT_FOUND_EVENT, isHideoutDirty, readHideoutFound, writeHideoutFound } from '../hideout/hideoutFound'
import { canonicalMapId } from '../data/mapIds'
import { currentTheme, saveAppearance, THEME_CHANGED_EVENT, THEMES } from '../theme/theme'
import type { ExperimentalSettings } from '../overlay/types'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import { isDesktopShell, isMobileLayout, isNative } from '../platform'
import { featureEnabled } from '../app/archivedFeatures'
import { liveItemBody, onRecognisedItem, parseLiveItem } from '../items/recognisedItem'
import type { ItemOverlayInfo } from '../overlay/types'
import { parseStoryAnswer, type StoryRecord } from './storyRecords'
import { webAccountEmailSignIn, webAccountLogin, webAccountLogout, webAccountPhoneSignIn, webAccountRegister, webAccountRegisterConfirm, webAccountStatus, webServiceRequest } from './webAccount'

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

const webAccountApi = { status: webAccountStatus, login: webAccountLogin, logout: webAccountLogout, phoneSignIn: webAccountPhoneSignIn, emailSignIn: webAccountEmailSignIn, register: webAccountRegister, registerConfirm: webAccountRegisterConfirm }

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

/** Sign-in or password reset by e-mail code; the session is kept like after a password sign-in. */
export async function emailSignInToServer(kind: 'login' | 'reset', challengeId: string, code: string, password?: string) {
  const api = accountApi()
  if (!api?.emailSignIn) throw new Error('Обновите приложение: вход по коду из письма появился в новой версии')
  try {
    const status = await api.emailSignIn(kind, challengeId, code, password)
    setState({ status })
    void runFullSync()
    return status
  } catch (error) {
    throw new Error(cleanIpcError(error), { cause: error })
  }
}

/**
 * Registration in the app's account window. `pending`: the server sends e-mail codes — finish with
 * confirmRegistrationOnServer(). Otherwise the new account is signed in like after a password sign-in.
 * `country`: the ISO 3166-1 alpha-2 code from the form (src/shared/countries.ts).
 */
export async function registerOnServer(email: string, password: string, referralCode?: string, country?: string): Promise<ServerRegistrationResult> {
  const api = accountApi()
  if (!api?.register) throw new Error('Обновите приложение: регистрация в приложении появилась в новой версии')
  try {
    const result = await api.register(email, password, referralCode, country)
    if (result.status) { setState({ status: result.status }); void runFullSync() }
    return result
  } catch (error) {
    throw new Error(cleanIpcError(error), { cause: error })
  }
}

/** The code from the registration e-mail: the account appears and is signed in. */
export async function confirmRegistrationOnServer(challengeId: string, code: string) {
  const api = accountApi()
  if (!api?.registerConfirm) throw new Error('Обновите приложение: регистрация в приложении появилась в новой версии')
  try {
    const result = await api.registerConfirm(challengeId, code)
    setState({ status: result.status })
    void runFullSync()
    return result
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

/** The account status as the store has it, without asking the server again (unlike `useServerAccount`). */
export function useServerStatus() {
  return useSyncExternalStore(subscribe, () => state.status, () => state.status)
}

const connected = () => Boolean(state.status?.signedIn && state.status.online)

/** The server account status as last read (outside React). */
export function currentServerStatus() {
  return state.status
}

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
/** Who the server's records of a mode belong to, and the last trusted reset it knows of that character. */
export interface ServerScope { characterId: string; resetAt?: string }
type ApplyServerEvents = (mode: RaidMode, events: ParsedTaskEvent[], characterId: string, resetAt?: string) => void

let lastLogPush: { result: ModeLogScanResult; registrationOf: (mode: RaidMode) => ModeRegistration; apply: ApplyServerEvents } | null = null
const progressBusy = new Set<RaidMode>()
/** P15: a push asked for while one of the mode was running goes right after it, with the newest scan. */
const pushAgain = new Set<RaidMode>()
/**
 * The server's character scope of each mode, as its last answer told (a push of events without a profile line uses it),
 * for the account signed in then.
 */
let serverScopes: Partial<Record<RaidMode, ServerScope & { account: string }>> = {}
/**
 * Per mode, the events the server confirmed for one account, character and reset: only the others are sent again (the
 * server answers with every record of the character either way). Forgotten when any of the three changes.
 */
let confirmed: Partial<Record<RaidMode, { key: string; events: Set<string> }>> = {}
/** The signed-in account the remembered scopes and confirmations belong to. */
const accountKey = () => state.status?.email ?? ''
/**
 * What this desktop's logs tell (P10): 'none' — no Logs folder found; 'scan' — a full scan was applied. A mode its logs
 * say nothing about is pulled from the server like on the phone (another PC's progress).
 */
let desktopLogs: 'unknown' | 'none' | 'scan' = 'unknown'

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

/** The character scope of a server answer (GET /progress/:mode, POST …/events), checked; null without one. */
export function parseServerScope(value: unknown): ServerScope | null {
  const scope = (value as { scope?: unknown } | null)?.scope as { characterId?: unknown; resetAt?: unknown } | null | undefined
  if (!scope || typeof scope.characterId !== 'string' || !HEX_ID.test(scope.characterId)) return null
  const resetAt = typeof scope.resetAt === 'string' ? isoTime(scope.resetAt) : null
  return { characterId: scope.characterId, ...(resetAt ? { resetAt } : {}) }
}

const eventKey = (event: { taskId: string; status: string; timestamp: string }) => `${event.taskId}|${event.status}|${event.timestamp}`

/**
 * Sends each mode's log events to the server after a log scan and applies the merged server records back
 * (source 'eft-log'), so progress read before the game rotated its logs is not lost. The answer carries the server's
 * character scope and its last trusted reset, which drop older local records the same way a scan does (AppState).
 */
export async function pushLogProgress(result: ModeLogScanResult, registrationOf: (mode: RaidMode) => ModeRegistration, apply: ApplyServerEvents) {
  if (result.identityOnly) return
  lastLogPush = { result, registrationOf, apply }
  desktopLogs = 'scan'
  if (!connected()) return
  for (const mode of RAID_MODES) await pushMode(mode)
}

async function pushMode(mode: RaidMode): Promise<void> {
  const push = lastLogPush
  if (!push || !connected()) return
  if (progressBusy.has(mode)) { pushAgain.add(mode); return }
  progressBusy.add(mode)
  try {
    const { result, registrationOf, apply } = push
    const summary = result.summaryByMode?.[mode]
    // A mode the logs say nothing about is pulled instead (pullServerProgress).
    if (!summary?.lastActivityAt) return
    let characterId = result.latestCharacterIdByMode?.[mode]
    if (!characterId || !HEX_ID.test(characterId)) {
      // P17: no profile line in the logs. The events still go to the character the server keeps for this mode, if any.
      characterId = (knownScope(mode) ?? await fetchServerScope(mode))?.characterId
      if (!characterId) return
    }
    const registration = registrationOf(mode)
    const accountId = registration.status === 'registered' ? registration.accountId : result.latestAccountIdByMode?.[mode]
    // The game's own last reset as the logs prove it — never a reset press in the app (owner, 15.10.2026: a press is no
    // floor; the mode is found again from every log).
    const resetAt = summary.resetAt ? isoTime(summary.resetAt) : null
    const key = `${accountKey()}|${characterId}|${resetAt ?? ''}`
    if (confirmed[mode]?.key !== key) confirmed[mode] = { key, events: new Set() }
    const known = confirmed[mode]!.events
    const events = serverEventsForMode(result, mode, registration).filter((event) => !known.has(eventKey(event)))
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
    if (!merged) return
    for (const event of events) known.add(eventKey(event))
    const scope = parseServerScope(answer)
    if (scope) rememberScope(mode, scope)
    apply(mode, merged, scope?.characterId ?? characterId, scope?.resetAt)
  } finally {
    progressBusy.delete(mode)
    if (pushAgain.delete(mode)) await pushMode(mode)
  }
}

function rememberScope(mode: RaidMode, scope: ServerScope) {
  serverScopes = { ...serverScopes, [mode]: { ...scope, account: accountKey() } }
}

/** The scope the server told for this mode, while the same account is signed in. */
function knownScope(mode: RaidMode): ServerScope | undefined {
  const scope = serverScopes[mode]
  return scope && scope.account === accountKey() ? scope : undefined
}

/** The server's character scope of a mode (GET /progress/:mode), remembered. */
async function fetchServerScope(mode: RaidMode) {
  const scope = parseServerScope(await meRequest('GET', `/v1/me/progress/${mode}`))
  if (scope) rememberScope(mode, scope)
  return scope
}

// ------------------------------------------------------------------------------------------------------------
// The reset of a whole mode («Престиж +», «Вайп», «Сброс», a nickname change: src/state/modeReset.ts): the server's
// copy of the mode is wiped, then every event of this PC's logs is sent again (no floor at the press)
// ------------------------------------------------------------------------------------------------------------

/**
 * Per signed-in server account (accountIdentity), per mode: the newest reset done in this app while that account was
 * signed in, and whether the server still has to hear of it (queued offline). A reset goes only to the account it was
 * made under — never to another account signed in later (it would wipe that account's mode); it stays queued for its
 * own account. A reset made signed out stays local (the mode is rebuilt from this PC's logs) and is never sent.
 */
const MODE_RESETS_KEY = 'raidos-mode-resets-v1'
type ModeResetEntry = { at: string; pending?: boolean }
type ModeResets = Record<string, Partial<Record<RaidMode, ModeResetEntry>>>
/** Accounts whose resets are kept (the newest first): a few, never a growing list. */
const MODE_RESET_ACCOUNTS_KEPT = 5
let modeResetsBusy = false

/**
 * Which server account is signed in now: the server and its e-mail (or, for an account without one, its masked phone
 * and registration time). null when signed out or when the status does not tell the account apart.
 */
export function accountIdentity(status: ServerAccountStatus | null | undefined = state.status): string | null {
  if (!status?.signedIn) return null
  const who = status.email ? `e:${status.email.trim().toLowerCase()}` : status.phone && status.createdAt ? `p:${status.phone}|${status.createdAt}` : null
  return who ? `${status.serverUrl ?? ''}|${who}` : null
}

function readModeResets(): ModeResets {
  try {
    const parsed = JSON.parse(localStorage.getItem(MODE_RESETS_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const resets: ModeResets = {}
    for (const [account, modes] of Object.entries(parsed as Record<string, unknown>)) {
      if (!account.includes('|') || !modes || typeof modes !== 'object') continue
      const kept: Partial<Record<RaidMode, ModeResetEntry>> = {}
      for (const mode of RAID_MODES) {
        const entry = (modes as Record<string, { at?: unknown; pending?: unknown } | undefined>)[mode]
        const at = typeof entry?.at === 'string' ? isoTime(entry.at) : null
        if (at) kept[mode] = { at, ...(entry?.pending === true ? { pending: true } : {}) }
      }
      if (Object.keys(kept).length) resets[account] = kept
    }
    return resets
  } catch {
    return {}
  }
}

function writeModeResets(resets: ModeResets) {
  const newest = (modes: Partial<Record<RaidMode, ModeResetEntry>>) => Object.values(modes).reduce((latest, entry) => entry && entry.at > latest ? entry.at : latest, '')
  const kept = Object.entries(resets).sort(([, a], [, b]) => newest(b).localeCompare(newest(a))).slice(0, MODE_RESET_ACCOUNTS_KEPT)
  try { localStorage.setItem(MODE_RESETS_KEY, JSON.stringify(Object.fromEntries(kept))) } catch { /* storage full: the pushes still carry it this session */ }
}

/**
 * The mode's newest reset made under the account signed in now, sent or not (the log pushes carry it as their reset,
 * pushMode). Another account's reset, or one made signed out, is never sent to this account.
 */
export function modeResetFloor(mode: RaidMode): string | undefined {
  const account = accountIdentity()
  return account ? readModeResets()[account]?.[mode]?.at : undefined
}

/** A reset of the mode made under the account signed in now that its server has not answered yet. */
export function modeResetPending(mode: RaidMode) {
  const account = accountIdentity()
  return Boolean(account && readModeResets()[account]?.[mode]?.pending)
}

/**
 * A mode was reset in this app at `at`: the signed-in account's server copy is told now (POST
 * /v1/me/progress/:mode/reset) or, offline, as soon as that same account is online again (runFullSync). Signed out:
 * nothing is queued — the reset stays local. An older reset than the one kept changes nothing.
 */
export function queueModeReset(mode: RaidMode, at: string) {
  const time = isoTime(at)
  const account = accountIdentity()
  if (!time || !account) return
  const resets = readModeResets()
  const forAccount = { ...(resets[account] ?? {}) }
  const kept = forAccount[mode]
  if (kept && kept.at >= time && !kept.pending) return
  forAccount[mode] = { at: kept && kept.at > time ? kept.at : time, pending: true }
  writeModeResets({ ...resets, [account]: forAccount })
  // The mode's records the server confirmed belong to the time before: sent again only if newer (pushMode).
  delete confirmed[mode]
  delete storySent[mode]
  delete manualSent[mode]
  void sendModeResets().catch(() => {})
}

/** Sends the queued resets of the account signed in now (only its own); each stays queued until the server answered it. */
export async function sendModeResets() {
  if (modeResetsBusy || !connected()) return
  const account = accountIdentity()
  if (!account) return
  modeResetsBusy = true
  try {
    for (const mode of RAID_MODES) {
      const entry = readModeResets()[account]?.[mode]
      if (!entry?.pending) continue
      if (accountIdentity() !== account) return
      const answer = await meRequest<{ resetAt?: unknown; scope?: unknown }>('POST', `/v1/me/progress/${mode}/reset`, { at: entry.at })
      // Another account signed in meanwhile: its answer is not this reset's.
      if (accountIdentity() !== account) return
      if (!answer || typeof answer.resetAt !== 'string') continue
      const scope = parseServerScope(answer)
      if (scope) rememberScope(mode, scope)
      const now = readModeResets()
      // A newer reset queued meanwhile is sent on the next round.
      if (now[account]?.[mode]?.at === entry.at) { now[account] = { ...now[account], [mode]: { at: entry.at } }; writeModeResets(now) }
      // The server's copy of the mode is empty now: every event of the logs goes to it again (the rebuild).
      delete confirmed[mode]
      await pushMode(mode)
    }
  } finally {
    modeResetsBusy = false
  }
}

/** Tests: everything this module remembers about the logs and the server's progress goes. */
export function forgetProgressSync() {
  lastLogPush = null
  serverScopes = {}
  confirmed = {}
  storySent = {}
  manualSent = {}
  desktopLogs = 'unknown'
  pushAgain.clear()
}

/** AppShell: the main process found no Logs folder on this PC — its quest progress comes from the server (P10). */
export function noteDesktopLogsMissing() {
  if (desktopLogs !== 'scan') desktopLogs = 'none'
}

/**
 * Whether this app takes a mode's quest progress from the server instead of its own logs: the phone always; the desktop
 * when its logs say nothing about that mode (no Logs folder, or no activity of the mode in them: a second PC).
 */
export function pullsServerProgress(mode: RaidMode) {
  if (usesWebAccount()) return true
  if (!isDesktopShell()) return false
  if (desktopLogs === 'none') return true
  return desktopLogs === 'scan' && !lastLogPush?.result.summaryByMode?.[mode]?.lastActivityAt
}

// ------------------------------------------------------------------------------------------------------------
// Objective progress and its history (progress events)
// ------------------------------------------------------------------------------------------------------------

export const OBJECTIVES_PER_SYNC = 2000
export const EVENTS_PER_SYNC = 1000
const OBJECTIVE_SOURCES = new Set(['log', 'ocr', 'manual', 'sync'])
const EVENT_TYPES = new Set(['objective', 'task-status', 'undo', 'conflict-resolved'])
const TASK_STATUSES = new Set(['active', 'completed', 'failed'])

export interface ObjectiveSyncBinding {
  read: (mode: RaidMode) => Pick<ModeProgress, 'objectiveProgress' | 'progressEvents'>
  apply: (mode: RaidMode, remote: { objectives: ObjectiveProgress[]; events: ProgressEvent[] }) => void
}

let objectiveBinding: ObjectiveSyncBinding | null = null
/** An event of an objective (a tick, its undo or a conflict answer), not a quest status change. */
export const objectiveEvent = (event: Pick<ProgressEvent, 'eventType'>) => event.eventType !== 'task-status'
const objectiveBusy = new Set<RaidMode>()

/** Mounted once (AppShell): how the background sync reads and updates the active profile. */
export function bindObjectiveSync(binding: ObjectiveSyncBinding | null) {
  objectiveBinding = binding
}

const utc = (value: string | undefined) => {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}
const count = (value: unknown, min: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 100_000
const eventValue = (value: unknown) => value === null || count(value, 0) || (typeof value === 'string' && TASK_STATUSES.has(value))

/**
 * What the server accepts (same limits as server/src/routes/me.ts): the newest objectives and the events the server
 * has not confirmed yet. Rows it would reject (e.g. a wiki id with brackets) stay local instead of failing the batch.
 */
export function objectiveSyncPayload(progress: Pick<ModeProgress, 'objectiveProgress' | 'progressEvents'>) {
  const objectives = Object.values(progress.objectiveProgress).flatMap((record): ObjectiveProgress[] => {
    const observedAt = utc(record.observedAt)
    if (!observedAt || !ENTITY_ID_PATTERN.test(record.objectiveId) || !ENTITY_ID_PATTERN.test(record.taskId) || !OBJECTIVE_TYPE_PATTERN.test(record.type)) return []
    if (!count(record.target, 1) || !count(record.current, 0) || !OBJECTIVE_SOURCES.has(record.source)) return []
    const completedAt = utc(record.completedAt)
    return [{
      objectiveId: record.objectiveId, taskId: record.taskId, type: record.type, target: record.target, current: record.current,
      ...(completedAt ? { completedAt } : {}), source: record.source, confidence: Math.min(1, Math.max(0, record.confidence)), observedAt,
    }]
  }).sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, OBJECTIVES_PER_SYNC)
  const events = progress.progressEvents.filter((event) => !event.synced).flatMap((event): Array<Omit<ProgressEvent, 'synced' | 'mode'>> => {
    const observedAt = utc(event.observedAt)
    if (!observedAt || !EVENT_ID_PATTERN.test(event.id) || !ENTITY_ID_PATTERN.test(event.taskId) || (event.objectiveId && !ENTITY_ID_PATTERN.test(event.objectiveId))) return []
    if (!EVENT_TYPES.has(event.eventType) || !OBJECTIVE_SOURCES.has(event.source) || !eventValue(event.oldValue) || !eventValue(event.newValue)) return []
    if (event.refersTo && !EVENT_ID_PATTERN.test(event.refersTo)) return []
    const undoneAt = utc(event.undoneAt)
    return [{
      id: event.id, taskId: event.taskId, ...(event.objectiveId ? { objectiveId: event.objectiveId } : {}), eventType: event.eventType,
      oldValue: event.oldValue, newValue: event.newValue, source: event.source, confidence: Math.min(1, Math.max(0, event.confidence)), observedAt,
      reversible: Boolean(event.reversible), ...(undoneAt ? { undoneAt } : {}), ...(event.refersTo ? { refersTo: event.refersTo } : {}),
    }]
  }).slice(-EVENTS_PER_SYNC)
  return { objectives, events }
}

/** The server's merged copy, checked field by field (nothing from the network is trusted as is). */
export function parseObjectiveSnapshot(value: unknown, mode: RaidMode): { objectives: ObjectiveProgress[]; events: ProgressEvent[] } | null {
  const root = value as { objectives?: unknown; events?: unknown } | null
  if (!root || !Array.isArray(root.objectives) || !Array.isArray(root.events)) return null
  const objectives = root.objectives.flatMap((entry): ObjectiveProgress[] => {
    const record = entry as Partial<ObjectiveProgress> | null
    if (!record || typeof record.objectiveId !== 'string' || typeof record.taskId !== 'string' || typeof record.type !== 'string') return []
    const observedAt = utc(record.observedAt)
    if (!observedAt || !count(record.target, 1) || !count(record.current, 0) || !OBJECTIVE_SOURCES.has(String(record.source))) return []
    const completedAt = utc(record.completedAt)
    return [{
      objectiveId: record.objectiveId, taskId: record.taskId, type: record.type, target: record.target!, current: record.current!,
      ...(completedAt ? { completedAt } : {}), source: record.source!, confidence: typeof record.confidence === 'number' ? record.confidence : 0.5, observedAt,
    }]
  })
  const events = root.events.flatMap((entry): ProgressEvent[] => {
    const event = entry as Partial<ProgressEvent> | null
    if (!event || typeof event.id !== 'string' || typeof event.taskId !== 'string' || !EVENT_TYPES.has(String(event.eventType)) || !OBJECTIVE_SOURCES.has(String(event.source))) return []
    const observedAt = utc(event.observedAt)
    if (!observedAt || !eventValue(event.oldValue) || !eventValue(event.newValue)) return []
    const undoneAt = utc(event.undoneAt)
    return [{
      id: event.id, mode, taskId: event.taskId, ...(typeof event.objectiveId === 'string' ? { objectiveId: event.objectiveId } : {}),
      eventType: event.eventType!, oldValue: event.oldValue ?? null, newValue: event.newValue ?? null, source: event.source!,
      confidence: typeof event.confidence === 'number' ? event.confidence : 0.5, observedAt, reversible: event.reversible === true,
      ...(undoneAt ? { undoneAt } : {}), ...(typeof event.refersTo === 'string' ? { refersTo: event.refersTo } : {}), synced: true,
    }]
  })
  return { objectives, events }
}

/**
 * Pushes this mode's objective state and new events and merges the server copy back (other PC, phone, website): the
 * objectives ticked by hand (owner, 17.10.2026) reach the player's other devices. While counters and the history stay
 * archived (src/app/archivedFeatures.ts) the quest status changes of the logs are not pushed as events (P21): nothing
 * shows them and the logs already reach the server their own way.
 */
export async function syncObjectives(mode: RaidMode) {
  const binding = objectiveBinding
  if (!binding || !connected() || objectiveBusy.has(mode)) return
  objectiveBusy.add(mode)
  try {
    const local = binding.read(mode)
    const progress = featureEnabled('manualObjectives') ? local : { ...local, progressEvents: local.progressEvents.filter(objectiveEvent) }
    const answer = await meRequest('POST', `/v1/me/objectives/${mode}/sync`, objectiveSyncPayload(progress))
    const snapshot = parseObjectiveSnapshot(answer, mode)
    if (snapshot) binding.apply(mode, snapshot)
  } finally {
    objectiveBusy.delete(mode)
  }
}

// ------------------------------------------------------------------------------------------------------------
// Story chapters (the screen reads them; the game does not log them)
// ------------------------------------------------------------------------------------------------------------

export interface StorySyncBinding {
  /**
   * This app's chapter readings of a mode and the mode's character (undefined while not known); null while the catalog
   * of that mode is not loaded (its chapters and stages are needed to read and apply them).
   */
  read: (mode: RaidMode) => { characterId?: string; records: StoryRecord[] } | null
  /** The server's chapters of that character: other PCs' readings among them. */
  apply: (mode: RaidMode, records: StoryRecord[], characterId: string) => void
}

let storyBinding: StorySyncBinding | null = null
const storyBusy = new Set<RaidMode>()
/** Per mode, the readings the server has (account and character → chapter → time): only newer ones are sent. */
let storySent: Partial<Record<RaidMode, { key: string; chapters: Map<string, string> }>> = {}

/** Mounted once (AppShell): how the story sync reads and updates the active profile. */
export function bindStorySync(binding: StorySyncBinding | null) {
  storyBinding = binding
}

/**
 * P9: sends this mode's new chapter readings (only with a character this app knows: its logs, or the server's scope it
 * pulled) and applies every chapter the server keeps for that character — a second PC and the phone show them too.
 */
export async function syncStory(mode: RaidMode) {
  const binding = storyBinding
  if (!binding || !connected() || storyBusy.has(mode)) return
  const local = binding.read(mode)
  if (!local) return
  storyBusy.add(mode)
  try {
    const key = `${accountKey()}|${local.characterId ?? ''}`
    if (storySent[mode]?.key !== key) storySent[mode] = { key, chapters: new Map() }
    const sent = storySent[mode]!.chapters
    const records = local.characterId ? local.records.filter((record) => sent.get(record.chapterId) !== record.updatedAt) : []
    const answer = parseStoryAnswer(await meRequest('POST', `/v1/me/story/${mode}`, { ...(local.characterId ? { characterId: local.characterId } : {}), records }))
    if (!answer) return
    for (const record of [...records, ...answer.records]) sent.set(record.chapterId, record.updatedAt)
    binding.apply(mode, answer.records, answer.characterId)
  } finally {
    storyBusy.delete(mode)
  }
}

// ------------------------------------------------------------------------------------------------------------
// «Ручная отметка» (src/quests/questEngine.ts: a mark beats older log events, loses to newer ones)
// ------------------------------------------------------------------------------------------------------------

export interface ManualMarkEntry { taskId: string; status: 'active' | 'completed' | 'cleared'; at: string }
export interface ManualSyncBinding {
  /** This app's marks of the mode (with «Снять отметку» as `cleared`). */
  read: (mode: RaidMode) => ManualMarkEntry[]
  /** Every mark the server keeps for the account and mode: other devices' among them. */
  apply: (mode: RaidMode, marks: ManualMarkEntry[]) => void
}

let manualBinding: ManualSyncBinding | null = null
const manualBusy = new Set<RaidMode>()
/** Per mode, what the server has (account → quest → time): only newer marks are sent. */
let manualSent: Partial<Record<RaidMode, { key: string; marks: Map<string, string> }>> = {}

/** Mounted once (AppShell): how the manual marks are read from and applied to the active profile. */
export function bindManualSync(binding: ManualSyncBinding | null) {
  manualBinding = binding
}

/** The server's answer (GET/POST /v1/me/progress/:mode/manual), checked: null when it is not one. */
export function parseManualMarks(value: unknown): ManualMarkEntry[] | null {
  const marks = (value as { marks?: unknown } | null)?.marks
  if (!Array.isArray(marks)) return null
  return marks.flatMap((entry): ManualMarkEntry[] => {
    const mark = entry as Partial<ManualMarkEntry> | null
    if (!mark || typeof mark.taskId !== 'string' || !ENTITY_ID_PATTERN.test(mark.taskId) || typeof mark.at !== 'string') return []
    const at = isoTime(mark.at)
    if (!at || (mark.status !== 'active' && mark.status !== 'completed' && mark.status !== 'cleared')) return []
    return [{ taskId: mark.taskId, status: mark.status, at }]
  })
}

/** Sends this mode's new marks and applies every mark the server keeps (another PC's or the phone's among them). */
export async function syncManualMarks(mode: RaidMode) {
  const binding = manualBinding
  if (!binding || !connected() || manualBusy.has(mode)) return
  manualBusy.add(mode)
  try {
    const key = accountKey()
    if (manualSent[mode]?.key !== key) manualSent[mode] = { key, marks: new Map() }
    const sent = manualSent[mode]!.marks
    const marks = binding.read(mode).filter((mark) => ENTITY_ID_PATTERN.test(mark.taskId) && isoTime(mark.at) && sent.get(mark.taskId) !== mark.at).slice(0, 1000)
    const answer = parseManualMarks(await meRequest('POST', `/v1/me/progress/${mode}/manual`, { marks }))
    if (!answer) return
    for (const mark of [...marks, ...answer]) sent.set(mark.taskId, mark.at)
    binding.apply(mode, answer)
  } finally {
    manualBusy.delete(mode)
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
  // A reset of the mode the server has not heard of yet (sendModeResets): its list there is the one from before.
  if (modeResetPending(mode)) return
  const answer = await meRequest<{ itemIds?: unknown }>('GET', `/v1/me/collector/${mode}`)
  if (!answer || !Array.isArray(answer.itemIds) || modeResetPending(mode)) return
  const remote = answer.itemIds.filter((id): id is string => typeof id === 'string')
  if (!isCollectorDirty(mode) && !sameSet(remote, loadCollected(mode))) saveCollected(mode, remote, { fromServer: true })
}

// ------------------------------------------------------------------------------------------------------------
// «Убежище»: items found for the hideout (per account and mode on the server, per profile on the device)
// ------------------------------------------------------------------------------------------------------------

/** squad/useSocialEvents.ts SOCIAL_UPDATE_EVENT (not imported: that module imports this one). */
const SOCIAL_UPDATE_EVENT = 'raidos:social-update'

let hideoutProfile: (() => string) | null = null
/** The profile whose hideout list this device syncs (AppShell: the active one). */
export function bindHideoutSync(profile: (() => string) | null) { hideoutProfile = profile }

const sameCounts = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) => a.size === b.size && [...a].every(([id, count]) => b.get(id) === count)

/** Like the Collector checklist: a local change goes up first; otherwise the account's copy replaces the device's. */
export async function syncHideout(mode: RaidMode) {
  const profileId = hideoutProfile?.()
  if (!profileId || !connected()) return
  if (isHideoutDirty(profileId, mode)) {
    const local = readHideoutFound(profileId, mode)
    const found = Object.fromEntries([...local].filter(([id]) => ITEM_ID.test(id)))
    const answer = await meRequest<{ found?: unknown }>('PUT', `/v1/me/hideout/${mode}`, { found })
    if (answer && sameCounts(readHideoutFound(profileId, mode), local)) clearHideoutDirty(profileId, mode)
    return
  }
  if (modeResetPending(mode)) return
  const answer = await meRequest<{ found?: unknown }>('GET', `/v1/me/hideout/${mode}`)
  if (!answer || !answer.found || typeof answer.found !== 'object' || Array.isArray(answer.found) || modeResetPending(mode)) return
  const remote = new Map(Object.entries(answer.found as Record<string, unknown>).filter((entry): entry is [string, number] => ITEM_ID.test(entry[0]) && Number.isInteger(entry[1]) && (entry[1] as number) > 0))
  if (!isHideoutDirty(profileId, mode) && !sameCounts(remote, readHideoutFound(profileId, mode))) writeHideoutFound(profileId, mode, remote, { fromServer: true })
}

// ------------------------------------------------------------------------------------------------------------
// Settings (theme, overlay and hotkey preferences)
// ------------------------------------------------------------------------------------------------------------

const SETTINGS_META_KEY = 'tarkov-server-settings-sync-v1'
/** Machine-specific values (like the screenshots folder) never leave this computer. */
// The in-game minimap's key and opacity went with the overlays (15.10.2026): an older PC of the account keeps its own.
const SYNCED_EXPERIMENTAL_KEYS = ['itemLookup', 'minimap', 'tracking', 'autoScreenshot', 'screenshotIntervalMs', 'itemKey', 'collectorKey', 'playerMarker'] as const

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

/** What the live relay holds for this account and mode (server/src/routes/live.ts). */
export interface LiveState {
  version: number
  position: ServerPosition | null
  item: { payload: ItemOverlayInfo; at: number } | null
}

/** The live relay's answer, shape-checked; null when it is not one. */
export function parseLiveState(value: unknown): LiveState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { version?: unknown; position?: unknown; item?: unknown }
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version)) return null
  return { version: raw.version, position: parseServerPosition({ position: raw.position }), item: parseLiveItem(raw.item) }
}

/**
 * The phone: the PC's position and recognised item for this mode, pushed (server/src/routes/live.ts). With `since` (the
 * version the phone has) the server answers the moment something new comes, or after ~25 s. Null when signed out, offline,
 * without access or on a server from before the relay: the caller falls back to polling the stored position.
 */
export async function fetchLiveState(mode: RaidMode, since?: number) {
  const answer = await meRequest<unknown>('GET', `/v1/live/${mode}${since === undefined ? '' : `?since=${Math.trunc(since)}`}`)
  return answer ? parseLiveState(answer) : null
}

/**
 * The phone, and a desktop whose logs say nothing about this mode (pullsServerProgress): the merged task records the
 * desktop apps uploaded for this mode, applied like a log scan — with the server's character and its last trusted reset,
 * so a wipe or a prestige drops the older records here too (P16).
 */
export async function pullServerProgress(mode: RaidMode, apply: ApplyServerEvents) {
  if (!connected() || !pullsServerProgress(mode) || progressBusy.has(mode)) return
  progressBusy.add(mode)
  try {
    const answer = await meRequest<{ records?: unknown; scope?: unknown }>('GET', `/v1/me/progress/${mode}`)
    const scope = parseServerScope(answer)
    if (scope) rememberScope(mode, scope)
    const records = parseServerRecords(answer)
    if (records && scope) apply(mode, records, scope.characterId, scope.resetAt)
  } finally {
    progressBusy.delete(mode)
  }
}

// ------------------------------------------------------------------------------------------------------------
// Background loop (mounted once in AppShell)
// ------------------------------------------------------------------------------------------------------------

let fullSyncRunning = false
/** Kept across mounts: AppShell mounts again when the interface language changes, which is no new connection (P20). */
let wasConnected = false
let lastStatusTick = 0
let lastModeSync: { mode: RaidMode; at: number } | null = null

/** Everything that may have waited for the server: Collector (all modes), settings and the last log scan. */
export async function runFullSync() {
  if (fullSyncRunning || !connected()) return
  fullSyncRunning = true
  try {
    // A reset made offline first: what follows must not bring back what it removed.
    await sendModeResets()
    for (const mode of RAID_MODES) await syncCollector(mode)
    for (const mode of RAID_MODES) await syncHideout(mode)
    for (const mode of RAID_MODES) await syncObjectives(mode)
    await syncSettings()
    if (lastLogPush) await pushLogProgress(lastLogPush.result, lastLogPush.registrationOf, lastLogPush.apply)
    for (const mode of RAID_MODES) await syncStory(mode)
    for (const mode of RAID_MODES) await syncManualMarks(mode)
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

  // Status poll; when the server comes back (or the user signs in) everything cached offline is pushed. A remount (the
  // interface language changed) keeps the pace: the next poll comes when it is due, and it is no new connection.
  useEffect(() => {
    if (!accountApi()) return
    let alive = true
    let timer = 0
    const tick = async () => {
      lastStatusTick = Date.now()
      await refreshServerStatus()
      if (!alive) return
      const now = connected()
      if (now && !wasConnected) await runFullSync()
      else if (now) { await sendModeResets(); await syncCollector(modeRef.current); await syncHideout(modeRef.current); await syncObjectives(modeRef.current); await syncSettings(); await syncStory(modeRef.current); await syncManualMarks(modeRef.current) }
      if (now) pullProgress(modeRef.current)
      wasConnected = now
    }
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => { void tick().finally(() => { if (alive) schedule(STATUS_REFRESH_MS) }) }, delay)
    }
    schedule(Math.max(0, lastStatusTick + STATUS_REFRESH_MS - Date.now()))
    const onCollector = () => { void syncCollector(modeRef.current) }
    const onHideout = () => { void syncHideout(modeRef.current) }
    const onTheme = () => { void syncSettings() }
    // Something of this account changed on the server — another of its devices ticked a quest, the Collector or the
    // hideout (GET /v1/me/social-events): this one reloads the mode it shows at once instead of on the next 30 s poll.
    let reloadTimer = 0
    const onAccountChange = () => {
      window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(() => {
        if (!connected()) return
        const mode = modeRef.current
        void syncCollector(mode).catch(() => {}); void syncHideout(mode).catch(() => {}); void syncObjectives(mode).catch(() => {})
        void syncStory(mode).catch(() => {}); void syncManualMarks(mode).catch(() => {}); pullProgress(mode)
      }, 400)
    }
    window.addEventListener(COLLECTOR_CHANGED_EVENT, onCollector)
    window.addEventListener(HIDEOUT_FOUND_EVENT, onHideout)
    window.addEventListener(THEME_CHANGED_EVENT, onTheme)
    window.addEventListener(SOCIAL_UPDATE_EVENT, onAccountChange)
    return () => {
      alive = false
      window.clearTimeout(timer)
      window.clearTimeout(reloadTimer)
      window.removeEventListener(COLLECTOR_CHANGED_EVENT, onCollector)
      window.removeEventListener(HIDEOUT_FOUND_EVENT, onHideout)
      window.removeEventListener(THEME_CHANGED_EVENT, onTheme)
      window.removeEventListener(SOCIAL_UPDATE_EVENT, onAccountChange)
    }
  }, [pullProgress])

  // Screenshot positions → the live relay /v1/live/:mode/position (the mode the app is on when the screenshot arrives):
  // the phone of the account gets it within a second; the server keeps it in memory for a few minutes only.
  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop?.experimental?.onPosition) return
    let location = ''
    void desktop.getRaidState?.().then((raid) => { location = raid?.location ?? '' }).catch(() => {})
    const offRaid = desktop.onRaidStateChanged?.((raid) => { location = raid.inRaid ? raid.location ?? '' : '' })
    const throttle = createPositionThrottle((position) => {
      const map = location ? canonicalMapId(location) : ''
      void meRequest('POST', `/v1/live/${modeRef.current}/position`, {
        x: position.x, y: position.y, z: position.z, yaw: position.yaw, at: Math.round(position.at),
        ...(map && /^[A-Za-z0-9_-]{1,40}$/.test(map) ? { map } : {}),
      })
    })
    const offPosition = desktop.experimental.onPosition((position) => {
      if (position && connected() && validPosition(position)) throttle.push(position)
    })
    return () => { throttle.cancel(); offPosition(); offRaid?.() }
  }, [])

  // The recognised item → /v1/live/:mode/item: the phone of the account shows the same card at once.
  useEffect(() => {
    if (!window.tarkovDesktop?.experimental) return
    let sentAt = 0
    return onRecognisedItem((item) => {
      if (!item || item.from !== 'pc' || item.payload.state !== 'found' || item.at === sentAt || !connected()) return
      sentAt = item.at
      void meRequest('POST', `/v1/live/${item.mode ?? modeRef.current}/item`, liveItemBody(item.payload, item.at))
    })
  }, [])

  // Switching mode pulls that mode's Collector checklist, objective progress and (on the phone, or for a mode this PC's
  // logs do not show) its task progress — not again for a remount on the same mode.
  useEffect(() => {
    if (lastModeSync?.mode === raidMode && Date.now() - lastModeSync.at < STATUS_REFRESH_MS) return
    lastModeSync = { mode: raidMode, at: Date.now() }
    void syncCollector(raidMode); void syncHideout(raidMode).catch(() => {}); void syncObjectives(raidMode).catch(() => {}); pullProgress(raidMode); void syncStory(raidMode).catch(() => {}); void syncManualMarks(raidMode).catch(() => {})
  }, [raidMode, pullProgress])
}
