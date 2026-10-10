/**
 * Binding the in-game nickname of one mode (PvP, PvE, Season) to the app. The nickname is looked up on Tarkov.dev
 * (through the desktop main process or the API server), stored locally in the mode's registration and, while a server
 * account is signed in, on the account too (PUT /v1/accounts/me/nicknames), so another install or the phone restores it.
 */
import type { RaidMode } from '../domain/types'
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

export function serviceClient() {
  if (typeof window === 'undefined') return undefined
  if (window.tarkovDesktop?.serviceRequest) return window.tarkovDesktop.serviceRequest
  return usesWebAccount() ? webServiceRequest : undefined
}

/** Saves nicknames on the signed-in server account; quietly does nothing without one. */
export async function saveNicknamesOnServer(nicknames: Partial<Record<RaidMode, string | null>>) {
  const request = serviceClient()
  if (!request) return false
  try {
    const answer = await request('PUT', '/v1/accounts/me/nicknames', nicknames)
    if (answer) void refreshServerStatus()
    return Boolean(answer)
  } catch {
    return false
  }
}
