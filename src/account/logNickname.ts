/**
 * The nickname straight from the game logs (owner, 10.10.2026: «читать ник из логов, очень быстро»). The EFT logs give the
 * game AccountId of every mode the player started; its Tarkov.dev profile gives the nickname. Each such mode is bound to
 * its account at once — nothing to type, there is no manual binding — and the account gets the nickname. When the
 * modes' Tarkov.dev names differ (one lags behind a rename), the most recently updated profile's name is the nickname;
 * every other bound mode takes it too.
 */
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import type { LocalProfile, PlayerProfileSnapshot, RaidMode } from '../domain/types'
import { desktopPlayerProfileGateway } from '../profile/playerProfileGateway'
import { currentServerStatus } from '../sync/serverSync'
import { accountNickname, RAID_MODE_ORDER, renameBoundModes, saveNicknameOnServer } from './nicknameBinding'

/** The app state (read when the lookups finish, so a fresh one). */
export interface LogNicknameTarget {
  activeProfile: LocalProfile
  registerModeProfile: (mode: RaidMode, registration: { accountId: number; enteredNickname: string; nickname: string; verifiedAt: string }) => void
  updatePlayerSnapshot: (mode: RaidMode, snapshot: PlayerProfileSnapshot) => void
}

/** Each (mode, AccountId) is looked up once per session: log scans come often. */
const looked = new Set<string>()

const updatedAt = (snapshot: PlayerProfileSnapshot) => snapshot.upstreamUpdatedAt ?? snapshot.fetchedAt

let fromLogs: string | undefined

/** The nickname the game logs gave in this session (AccountController saves it on an account signed in later). */
export function logNickname() {
  return fromLogs
}

export async function bindNicknameFromLogs(result: Pick<ModeLogScanResult, 'latestAccountIdByMode'>, state: () => LogNicknameTarget) {
  const byMode = result.latestAccountIdByMode ?? {}
  const lookups = RAID_MODE_ORDER.flatMap((mode) => {
    const accountId = byMode[mode]
    if (!accountId || looked.has(`${mode}:${accountId}`)) return []
    looked.add(`${mode}:${accountId}`)
    return [desktopPlayerProfileGateway().fetchByAccountId(mode, accountId).then((snapshot) => ({ mode, accountId, snapshot }), () => null)]
  })
  if (!lookups.length) return null
  const found = (await Promise.all(lookups)).filter((entry): entry is { mode: RaidMode; accountId: number; snapshot: PlayerProfileSnapshot } => Boolean(entry?.snapshot?.nickname))
  if (!found.length) return null
  const nickname = [...found].sort((a, b) => updatedAt(b.snapshot).localeCompare(updatedAt(a.snapshot)))[0].snapshot.nickname
  fromLogs = nickname
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
