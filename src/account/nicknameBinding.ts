/**
 * Binding the Escape from Tarkov nickname to the app — one nickname for PvP, PvE and «Сезон» (owner, 10.10.2026: a
 * character has the same nickname in every mode). It is looked up on Tarkov.dev in every mode (through the desktop main
 * process or the API server): each mode where the profile is found gets its registration (its own account id and
 * progress), and the nickname is saved on the signed-in server account (PUT /v1/accounts/me/nicknames), so another
 * install or the phone restores it.
 */
import type { LocalProfile, RaidMode } from '../domain/types'
import type { PlayerProfileCandidate } from '../profile/playerProfileGateway'
import { desktopPlayerProfileGateway } from '../profile/playerProfileGateway'
import { cleanIpcError, refreshServerStatus, usesWebAccount } from '../sync/serverSync'
import { webServiceRequest } from '../sync/webAccount'

export const RAID_MODE_ORDER: RaidMode[] = ['pvp', 'pve', 'seasonal']
export const NICKNAME_PATTERN = /^[a-zA-Z0-9_-]{3,15}$/

export function modeTitle(mode: RaidMode) {
  return mode === 'pvp' ? 'PvP' : mode === 'pve' ? 'PvE' : 'Сезон'
}

export function cleanNickname(raw: string) {
  return raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '')
}

/** Finds the Tarkov.dev profile of `nickname` in `mode`; throws a readable Russian message. */
export async function findNickname(mode: RaidMode, raw: string): Promise<PlayerProfileCandidate> {
  const nickname = cleanNickname(raw)
  if (!NICKNAME_PATTERN.test(nickname)) throw new Error('Введите корректный ник Escape from Tarkov (3–15 латиница/цифры/_/-)')
  try {
    return await desktopPlayerProfileGateway().resolveByNickname(mode, nickname)
  } catch (error) {
    throw new Error(cleanIpcError(error).replace(/^TimeoutError:\s*/i, '').replace(/^Error:\s*/i, '') || 'Профиль не найден', { cause: error })
  }
}

/** Finds the profile of `nickname` in every mode, `first` mode first; throws (that mode's message) when no mode has it. */
export async function findNicknameInModes(raw: string, first: RaidMode): Promise<Array<{ mode: RaidMode; candidate: PlayerProfileCandidate }>> {
  const order = [first, ...RAID_MODE_ORDER.filter((mode) => mode !== first)]
  const answers = await Promise.allSettled(order.map((mode) => findNickname(mode, raw)))
  const found = answers.flatMap((answer, index) => (answer.status === 'fulfilled' ? [{ mode: order[index], candidate: answer.value }] : []))
  if (!found.length) throw (answers.find((answer): answer is PromiseRejectedResult => answer.status === 'rejected')?.reason ?? new Error('Профиль не найден'))
  return found
}

/** The account's nickname (one for all modes; a server before that kept one per mode — the first of PvP → PvE → «Сезон»). */
export function accountNickname(nicknames: Partial<Record<RaidMode, string>> | undefined | null): string | undefined {
  return RAID_MODE_ORDER.map((mode) => nicknames?.[mode]).find((nickname): nickname is string => Boolean(nickname))
}

/** The nickname bound in this app: of `prefer` mode when it is bound, else of the first bound mode. */
export function profileNickname(profile: LocalProfile, prefer?: RaidMode): string | undefined {
  const order = prefer ? [prefer, ...RAID_MODE_ORDER.filter((mode) => mode !== prefer)] : RAID_MODE_ORDER
  for (const mode of order) {
    const registration = profile.modes[mode].registration
    if (registration.status === 'registered' && (registration.nickname || registration.enteredNickname)) return registration.nickname ?? registration.enteredNickname
  }
  return undefined
}

export function serviceClient() {
  if (typeof window === 'undefined') return undefined
  if (window.tarkovDesktop?.serviceRequest) return window.tarkovDesktop.serviceRequest
  return usesWebAccount() ? webServiceRequest : undefined
}

/**
 * Saves the one nickname on the signed-in server account (null removes it); quietly does nothing without one. The
 * per-mode keys carry the same value for a server from before the single nickname.
 */
export async function saveNicknameOnServer(nickname: string | null) {
  const request = serviceClient()
  if (!request) return false
  const value = nickname ?? ''
  try {
    const answer = await request('PUT', '/v1/accounts/me/nicknames', { nickname: value, pvp: value, pve: value, seasonal: value })
    if (answer) void refreshServerStatus()
    return Boolean(answer)
  } catch {
    return false
  }
}
