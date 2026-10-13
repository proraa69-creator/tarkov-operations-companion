/**
 * The Escape from Tarkov nickname of the app — typed by the player (owner, 13.10.2026: «делай ручной ввод, не обращаясь к
 * тарков дев», «возвращай кнопку сменить ник»). Tarkov.dev is not asked any more: Cloudflare refuses our server there,
 * and the owner chose not to depend on it. One nickname for PvP, PvE and «Сезон»; each mode the logs of this PC show is
 * bound to its own game account (from the logs) under that nickname, and the nickname is saved on the signed-in account.
 */
import { useSyncExternalStore } from 'react'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import type { LocalProfile, RaidMode } from '../domain/types'
import { currentServerStatus } from '../sync/serverSync'
import { accountNickname, cleanNickname, NICKNAME_PATTERN, profileNickname, RAID_MODE_ORDER, renameBoundModes, saveNicknameOnServer } from './nicknameBinding'

/** The app state (read when needed, so a fresh one). */
export interface LogNicknameTarget {
  activeProfile: LocalProfile
  registerModeProfile: (mode: RaidMode, registration: { accountId: number; enteredNickname: string; nickname: string; verifiedAt: string }) => void
}

/** The game account of each mode the logs of this PC showed last. */
let accounts: Partial<Record<RaidMode, number>> = {}
let typed: string | undefined
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

/** The nickname typed in this session (AccountController saves it on an account signed in later). */
export function logNickname() {
  return typed
}

/** The game accounts of the logs, by mode (Settings → «Журналы игры», the nickname form). */
export function useLogAccounts() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => accounts)
}

/** The nickname this app knows: typed now, the signed-in account's, or a bound mode's. */
function knownNickname(profile: LocalProfile) {
  return typed ?? accountNickname(currentServerStatus()?.nicknames) ?? profileNickname(profile)
}

/** Binds each mode the logs show to its game account under `nickname` (unless it is bound so already). */
function bindModes(state: () => LogNicknameTarget, nickname: string, verifiedAt: string) {
  for (const mode of RAID_MODE_ORDER) {
    const accountId = accounts[mode]
    if (!accountId) continue
    const registration = state().activeProfile.modes[mode].registration
    if (registration.status === 'registered' && registration.accountId === accountId && (registration.enteredNickname || registration.nickname) === nickname) continue
    state().registerModeProfile(mode, { accountId, enteredNickname: nickname, nickname, verifiedAt })
  }
}

/**
 * Called with every log scan (AppShell): remembers each mode's game account and, when a nickname is known, binds the
 * modes to their accounts under it. Returns that nickname, or null while none is typed yet.
 */
export function bindNicknameFromLogs(result: Pick<ModeLogScanResult, 'latestAccountIdByMode'>, state: () => LogNicknameTarget) {
  const next = { ...accounts, ...Object.fromEntries(Object.entries(result.latestAccountIdByMode ?? {}).filter(([, id]) => typeof id === 'number' && id > 0)) }
  if (RAID_MODE_ORDER.some((mode) => next[mode] !== accounts[mode])) {
    accounts = next
    notify()
  }
  const nickname = knownNickname(state().activeProfile)
  if (!nickname) return null
  bindModes(state, nickname, new Date().toISOString())
  return nickname
}

/**
 * «Сменить ник» / the first nickname: checked like the game's (3–15 Latin letters, digits, «_» or «-»), bound to the game
 * accounts the logs of this PC show, given to every other bound mode, saved on the signed-in account.
 */
export async function setTypedNickname(raw: string, state: () => LogNicknameTarget) {
  const nickname = cleanNickname(raw)
  if (!NICKNAME_PATTERN.test(nickname)) throw new Error('Ник в игре: 3–15 символов, латиница, цифры, «_» или «-».')
  const verifiedAt = new Date().toISOString()
  typed = nickname
  bindModes(state, nickname, verifiedAt)
  renameBoundModes(state(), nickname, RAID_MODE_ORDER.filter((mode) => accounts[mode]), verifiedAt)
  notify()
  const status = currentServerStatus()
  if (status?.signedIn && (accountNickname(status.nicknames) ?? '') !== nickname) await saveNicknameOnServer(nickname)
  return nickname
}
