import { webServiceRequest } from '../sync/webAccount'
import { usesWebAccount } from '../sync/serverSync'
import type { PlayerProfileSnapshot, RaidMode } from '../domain/types'

/**
 * A character's tarkov.dev profile by its game account id. (Finding one by nickname went with its desktop channel, which
 * had no handler since 14.10.2026: security review, 27.11.2026.)
 */
export interface PlayerProfileGateway {
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
    fetchByAccountId: async (mode, accountId) => answer<PlayerProfileSnapshot>(await webServiceRequest('GET', `/v1/players/${mode}/${accountId}`)),
  }
}

/**
 * Tarkov.dev player profiles are asked for by the desktop app only, from the player's own computer (owner, 13.10.2026:
 * Cloudflare refuses our server on players.tarkov.dev, so the phone, which would ask through it, does not ask).
 */
export function canResolvePlayerProfiles() {
  return Boolean(window.tarkovDesktop)
}

export function desktopPlayerProfileGateway(): PlayerProfileGateway {
  if (!window.tarkovDesktop && usesWebAccount()) return serverPlayerProfileGateway()
  if (!window.tarkovDesktop) throw new Error('Профили игроков доступны в desktop-приложении')
  return {
    fetchByAccountId: async (mode, accountId) => {
      const snapshot = await window.tarkovDesktop!.refreshPlayerProfile(mode, accountId)
      if (!snapshot) throw new Error('Сервер не вернул профиль персонажа. Повторите позже.')
      return snapshot
    },
  }
}
