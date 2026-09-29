import { webServiceRequest } from '../sync/webAccount'
import { usesWebAccount } from '../sync/serverSync'
import type { PlayerProfileSnapshot, RaidMode } from '../domain/types'

export interface PlayerProfileCandidate {
  accountId: number
  nickname: string
  level: number
  faction: PlayerProfileSnapshot['faction']
  mode: RaidMode
  snapshot: PlayerProfileSnapshot
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

/** Nickname binding is available in the desktop app and, through the server, in the phone app. */
export function canResolvePlayerProfiles() {
  return Boolean(window.tarkovDesktop) || usesWebAccount()
}

export function desktopPlayerProfileGateway(): PlayerProfileGateway {
  if (!window.tarkovDesktop && usesWebAccount()) return serverPlayerProfileGateway()
  if (!window.tarkovDesktop) throw new Error('Профили Tarkov.dev доступны в desktop-приложении')
  return {
    resolveByNickname: (mode, nickname) => window.tarkovDesktop!.resolvePlayerProfile(mode, nickname),
    fetchByAccountId: (mode, accountId) => window.tarkovDesktop!.refreshPlayerProfile(mode, accountId),
  }
}
