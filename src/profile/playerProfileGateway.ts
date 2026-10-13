import { webServiceRequest } from '../sync/webAccount'
import { usesWebAccount } from '../sync/serverSync'
import type { PlayerProfileSnapshot, RaidMode } from '../domain/types'

export interface PlayerProfileCandidate {
  accountId: number
  nickname: string
  level: number
  faction: PlayerProfileSnapshot['faction']
  mode: RaidMode
  /** Missing while `pending`. */
  snapshot?: PlayerProfileSnapshot
  /**
   * The account is known (game logs or tarkov.dev's live search) but tarkov.dev has not published its profile yet —
   * a new character after a wipe or a renamed one. The nickname is bound; usePlayerProfileSync fills the level in later.
   */
  pending?: boolean
}

export interface PlayerProfileGateway {
  resolveByNickname(mode: RaidMode, nickname: string): Promise<PlayerProfileCandidate>
  fetchByAccountId(mode: RaidMode, accountId: number): Promise<PlayerProfileSnapshot>
}

export const upstreamModeByRaidMode: Record<RaidMode, 'regular' | 'pve' | 'pvp-season'> = {
  pvp: 'regular',
  pve: 'pve',
  seasonal: 'pvp-season',
}

/** The phone app resolves nicknames through the API server (its shared Tarkov.dev cache). */
function serverPlayerProfileGateway(): PlayerProfileGateway {
  const answer = <T,>(value: unknown) => {
    if (!value) throw new Error('Сервер недоступен')
    return value as T
  }
  return {
    resolveByNickname: async (mode, nickname) => answer<PlayerProfileCandidate>(await webServiceRequest('POST', '/v1/players/resolve', { mode, nickname })),
    fetchByAccountId: async (mode, accountId) => answer<PlayerProfileSnapshot>(await webServiceRequest('GET', `/v1/players/${mode}/${accountId}`)),
  }
}

/**
 * Tarkov.dev player profiles are not asked for any more (owner, 13.10.2026: Cloudflare refuses our server on
 * players.tarkov.dev — «делай ручной ввод, не обращаясь к тарков дев»): the nickname is typed by the player
 * (account/NicknameEditor.tsx), the level is to come from the game's screen. usePlayerProfileSync stays idle.
 */
export function canResolvePlayerProfiles() {
  return false
}

export function desktopPlayerProfileGateway(): PlayerProfileGateway {
  if (!window.tarkovDesktop && usesWebAccount()) return serverPlayerProfileGateway()
  if (!window.tarkovDesktop) throw new Error('Профили игроков доступны в desktop-приложении')
  return {
    resolveByNickname: async (mode, nickname) => {
      const candidate = await window.tarkovDesktop!.resolvePlayerProfile(mode, nickname)
      if (!candidate?.accountId || (!candidate.snapshot && !candidate.pending)) throw new Error('Сервер не вернул профиль персонажа. Повторите позже.')
      return candidate
    },
    fetchByAccountId: async (mode, accountId) => {
      const snapshot = await window.tarkovDesktop!.refreshPlayerProfile(mode, accountId)
      if (!snapshot) throw new Error('Сервер не вернул профиль персонажа. Повторите позже.')
      return snapshot
    },
  }
}
