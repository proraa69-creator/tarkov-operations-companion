/**
 * The nickname straight from the game logs (owner, 10.10.2026: «читать ник из логов, очень быстро»). The EFT logs give the
 * game AccountId of every mode the player started; its Tarkov.dev profile gives the nickname. Each such mode is bound to
 * its account at once — nothing to type, there is no manual binding — and the account gets the nickname. When the
 * modes' Tarkov.dev names differ (one lags behind a rename), the most recently updated profile's name is the nickname;
 * every other bound mode takes it too.
 */
import { useSyncExternalStore } from 'react'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import type { LocalProfile, PlayerProfileSnapshot, RaidMode } from '../domain/types'
import { desktopPlayerProfileGateway, upstreamModeByRaidMode } from '../profile/playerProfileGateway'
import { currentServerStatus } from '../sync/serverSync'
import { accountNickname, cleanNickname, NICKNAME_PATTERN, RAID_MODE_ORDER, renameBoundModes, saveNicknameOnServer } from './nicknameBinding'

/** The app state (read when the lookups finish, so a fresh one). */
export interface LogNicknameTarget {
  activeProfile: LocalProfile
  registerModeProfile: (mode: RaidMode, registration: { accountId: number; enteredNickname: string; nickname: string; verifiedAt: string }) => void
  updatePlayerSnapshot: (mode: RaidMode, snapshot: PlayerProfileSnapshot) => void
}

/**
 * Each (mode, AccountId) the logs show: when its Tarkov.dev profile was last asked for and whether it was there. A found
 * one is not asked again in this session (log scans come often); a missing one again after NICKNAME_RETRY_MS — Tarkov.dev
 * publishes a profile only once somebody has opened it on tarkov.dev (owner, 13.10.2026: a player's nickname was «not
 * found» with his logs read: his profile had never been opened there).
 */
const lookups = new Map<string, { at: number; found: boolean }>()
export const NICKNAME_RETRY_MS = 10 * 60_000
let lastBind: { result: Pick<ModeLogScanResult, 'latestAccountIdByMode'>; state: () => LogNicknameTarget } | undefined

/** The game accounts of the logs whose Tarkov.dev profile was not there at the last look (Profile → «Ник ещё не найден»). */
let missing: Array<{ mode: RaidMode; accountId: number }> = []
const listeners = new Set<() => void>()
function setMissing(next: typeof missing) {
  if (JSON.stringify(next) === JSON.stringify(missing)) return
  missing = next
  for (const listener of listeners) listener()
}
export function useMissingNicknameAccounts() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => missing)
}

/** The player's own profile on tarkov.dev: opening it once in the browser makes Tarkov.dev publish it. */
export function tarkovDevProfileUrl(mode: RaidMode, accountId: number) {
  return `https://tarkov.dev/players/${upstreamModeByRaidMode[mode]}/${accountId}`
}

/** The nickname the player typed for the game account of the logs (until Tarkov.dev gives the real one). */
let typed: string | undefined
export function typedNickname() {
  return typed
}

/**
 * The nickname typed by the player while Tarkov.dev gives no profile for the game account the logs show (owner,
 * 13.10.2026: «вернуть ручной ввод ника»). It is bound to that account — the one of the logs of this PC, never another —
 * in every mode the logs showed, and saved on the signed-in account. Tarkov.dev's real name replaces it as soon as
 * Tarkov.dev answers (the lookups go on).
 */
export async function bindTypedNickname(raw: string, state: () => LogNicknameTarget) {
  const nickname = cleanNickname(raw)
  if (!NICKNAME_PATTERN.test(nickname)) throw new Error('Ник в игре: 3–15 символов, латиница, цифры, «_» или «-».')
  if (!missing.length) throw new Error('В логах этого компьютера нет аккаунта игры без ника.')
  const verifiedAt = new Date().toISOString()
  for (const { mode, accountId } of missing) state().registerModeProfile(mode, { accountId, enteredNickname: nickname, nickname, verifiedAt })
  renameBoundModes(state(), nickname, missing.map((entry) => entry.mode), verifiedAt)
  typed = nickname
  fromLogs = nickname
  await saveNicknameOnServer(nickname)
  return nickname
}

/** Asks Tarkov.dev again now for every account whose profile was missing (after «Открыть мой профиль на tarkov.dev»). */
export async function retryNicknameLookups() {
  for (const [key, lookup] of lookups) if (!lookup.found) lookups.delete(key)
  return lastBind ? bindNicknameFromLogs(lastBind.result, lastBind.state) : null
}

const updatedAt = (snapshot: PlayerProfileSnapshot) => snapshot.upstreamUpdatedAt ?? snapshot.fetchedAt

let fromLogs: string | undefined

/** The nickname the game logs gave in this session (AccountController saves it on an account signed in later). */
export function logNickname() {
  return fromLogs
}

export async function bindNicknameFromLogs(result: Pick<ModeLogScanResult, 'latestAccountIdByMode'>, state: () => LogNicknameTarget) {
  lastBind = { result, state }
  const byMode = result.latestAccountIdByMode ?? {}
  const now = Date.now()
  const asked = RAID_MODE_ORDER.flatMap((mode) => {
    const accountId = byMode[mode]
    if (!accountId) return []
    const key = `${mode}:${accountId}`
    const last = lookups.get(key)
    if (last && (last.found || now - last.at < NICKNAME_RETRY_MS)) return []
    lookups.set(key, { at: now, found: false })
    return [desktopPlayerProfileGateway().fetchByAccountId(mode, accountId).then((snapshot) => ({ mode, accountId, snapshot }), () => null)]
  })
  if (!asked.length) return null
  const found = (await Promise.all(asked)).filter((entry): entry is { mode: RaidMode; accountId: number; snapshot: PlayerProfileSnapshot } => Boolean(entry?.snapshot?.nickname))
  for (const { mode, accountId } of found) lookups.set(`${mode}:${accountId}`, { at: now, found: true })
  setMissing(RAID_MODE_ORDER.flatMap((mode) => {
    const accountId = byMode[mode]
    return accountId && !lookups.get(`${mode}:${accountId}`)?.found ? [{ mode, accountId }] : []
  }))
  if (!found.length) return null
  const nickname = [...found].sort((a, b) => updatedAt(b.snapshot).localeCompare(updatedAt(a.snapshot)))[0].snapshot.nickname
  fromLogs = nickname
  typed = undefined
  const verifiedAt = new Date().toISOString()
  for (const { mode, accountId, snapshot } of found) {
    state().registerModeProfile(mode, { accountId, enteredNickname: nickname, nickname: snapshot.nickname, verifiedAt })
    state().updatePlayerSnapshot(mode, snapshot)
  }
  // A bound mode the logs did not show this time takes the same nickname (its own game account and progress stay).
  renameBoundModes(state(), nickname, found.map((entry) => entry.mode), verifiedAt)
  const status = currentServerStatus()
  if (status?.signedIn && (accountNickname(status.nicknames) ?? '').toLowerCase() !== nickname.toLowerCase()) void saveNicknameOnServer(nickname)
  return nickname
}
