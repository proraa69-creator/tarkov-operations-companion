/**
 * The squad of the signed-in account for one mode, shared by the «Отряд» page, the Maps highlight and the Dashboard
 * card: one cached copy per mode, refreshed on demand and every minute while something shows it.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Quest, RaidMode } from '../domain/types'
import { useServerAccount } from '../sync/serverSync'
import { fetchMySquad, fetchSquadOverview, SignedOutError, type SquadMine, type SquadOverview } from './socialClient'
import { computeSquadOverview, type SquadComputed, type SquadMemberQuests } from './squadOverview'

export const SQUAD_REFRESH_MS = 60_000

export interface SquadState { mine: SquadMine | null; overview: SquadOverview | null; loading: boolean; error: string; signedOut: boolean; loadedAt: number }
const EMPTY: SquadState = { mine: null, overview: null, loading: false, error: '', signedOut: false, loadedAt: 0 }

const states = new Map<RaidMode, SquadState>()
const inflight = new Map<RaidMode, Promise<void>>()
const listeners = new Set<() => void>()
const emit = () => { for (const listener of listeners) listener() }
const set = (mode: RaidMode, next: Partial<SquadState>) => { states.set(mode, { ...(states.get(mode) ?? EMPTY), ...next }); emit() }

export function loadSquad(mode: RaidMode): Promise<void> {
  const running = inflight.get(mode)
  if (running) return running
  set(mode, { loading: true })
  const work = (async () => {
    try {
      const mine = await fetchMySquad(mode)
      const overview = mine.squad && mine.access ? await fetchSquadOverview(mine.squad.id, mode).catch(() => null) : null
      set(mode, { mine, overview, loading: false, error: '', signedOut: false, loadedAt: Date.now() })
    } catch (error) {
      if (error instanceof SignedOutError) set(mode, { ...EMPTY, signedOut: true, loadedAt: Date.now() })
      else set(mode, { loading: false, error: error instanceof Error ? error.message : String(error), loadedAt: Date.now() })
    } finally {
      inflight.delete(mode)
    }
  })()
  inflight.set(mode, work)
  return work
}

/**
 * Marks the cached squads of every mode as stale (after an action, or when the server says something changed): the
 * shown squad stays until the reload answers. Clearing it instead dropped the page back to «Загружаем отряд…» and
 * remounted the squad view, which lost the invite code that «Пригласить» had just created (owner, 10.10.2026).
 */
export function invalidateSquads() {
  for (const [mode, state] of states) states.set(mode, { ...state, loadedAt: 0 })
  emit()
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** The squad state for this mode; loads it when signed in and refreshes it while mounted. */
export function useSquad(mode: RaidMode, { poll = true, maxAgeMs = SQUAD_REFRESH_MS }: { poll?: boolean; maxAgeMs?: number } = {}) {
  const state = useSyncExternalStore(subscribe, () => states.get(mode) ?? EMPTY, () => EMPTY)
  const { status } = useServerAccount()
  const signedIn = Boolean(status?.signedIn)
  const reload = useCallback(() => loadSquad(mode), [mode])
  useEffect(() => {
    if (!signedIn) return
    const current = states.get(mode)
    if (!current || Date.now() - current.loadedAt > maxAgeMs) void loadSquad(mode)
    if (!poll) return
    const timer = window.setInterval(() => void loadSquad(mode), SQUAD_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [mode, signedIn, poll, maxAgeMs])
  return { ...state, signedIn, reload }
}

/** The overview's computed parts: from the server, or from the app's catalog when the server had none for this mode. */
export function useSquadComputed(overview: SquadOverview | null, quests: Quest[]): (SquadComputed & { members: SquadMemberQuests[] }) | null {
  return useMemo(() => {
    if (!overview) return null
    const members = overview.squad.members.map((member) => ({ memberId: member.memberId, activeQuestIds: member.activeQuestIds ?? [], objectives: member.objectives }))
    if (overview.maps && overview.items && overview.anyMap) return { sharedQuests: overview.sharedQuests, maps: overview.maps, anyMap: overview.anyMap, items: overview.items, members }
    return { ...computeSquadOverview(members, quests), members }
  }, [overview, quests])
}

/** Quest id → how many squad members have it active (only quests shared by two or more), for light highlights. */
export function useSquadSharedQuests(mode: RaidMode) {
  const { overview } = useSquad(mode, { poll: false, maxAgeMs: 2 * SQUAD_REFRESH_MS })
  return useMemo(() => new Map((overview?.sharedQuests ?? []).map((entry) => [entry.questId, entry.memberIds.length])), [overview])
}
