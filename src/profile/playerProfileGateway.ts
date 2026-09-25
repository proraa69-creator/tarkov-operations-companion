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

export function desktopPlayerProfileGateway(): PlayerProfileGateway {
  if (!window.tarkovDesktop) throw new Error('Профили Tarkov.dev доступны в desktop-приложении')
  return {
    resolveByNickname: (mode, nickname) => window.tarkovDesktop!.resolvePlayerProfile(mode, nickname),
    fetchByAccountId: (mode, accountId) => window.tarkovDesktop!.refreshPlayerProfile(mode, accountId),
  }
}
