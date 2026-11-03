import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import type { BuildTier } from './tieredBuilds'

/**
 * The weapon builds the owner set by hand and what his edits taught (server/src/routes/ownerBuilds.ts; owner, 02.11.2026:
 * «сделай в админ приложении ручное редактирование сборок 100к 200к и топ сборка, что бы я мог настраивать каждое оружие…
 * должен запоминать что я меняю и делать выводы, как лучше собирать в будущем»). Every player's app shows the owner's
 * build of a weapon and tier instead of the solved one, and its solver leans toward the parts he put in and away from
 * the ones he took out, on every weapon (src/arsenal/tieredBuilds.ts LEARNED_POINTS). Read every 10 minutes and at once
 * after the owner's own save; nothing without a server.
 */
export interface OwnerBuildEntry { weaponId: string; tier: BuildTier; code: string; updatedAt: string }
export interface OwnerBuilds {
  builds: OwnerBuildEntry[]
  /** Part id → times the owner put it in (+) or took it out (−). */
  learned: ReadonlyMap<string, number>
}

const KEY = ['owner-builds']
const TIERS: readonly BuildTier[] = ['budget', 'middle', 'top']
const EMPTY: OwnerBuilds = { builds: [], learned: new Map() }

export function parseOwnerBuilds(answer: unknown): OwnerBuilds {
  const root = answer && typeof answer === 'object' ? answer as { builds?: unknown; lessons?: unknown } : {}
  const builds = (Array.isArray(root.builds) ? root.builds : []).flatMap((value): OwnerBuildEntry[] => {
    const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const tier = TIERS.find((name) => name === entry.tier)
    return typeof entry.weaponId === 'string' && tier && typeof entry.code === 'string'
      ? [{ weaponId: entry.weaponId, tier, code: entry.code, updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '' }] : []
  })
  const lessons = root.lessons && typeof root.lessons === 'object' ? root.lessons as Record<string, { chosen?: unknown; rejected?: unknown }> : {}
  const learned = new Map(Object.entries(lessons).flatMap(([id, lesson]) => {
    const net = (typeof lesson?.chosen === 'number' ? lesson.chosen : 0) - (typeof lesson?.rejected === 'number' ? lesson.rejected : 0)
    return net ? [[id, net] as const] : []
  }))
  return { builds, learned }
}

export function useOwnerBuilds(): OwnerBuilds {
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const request = serviceClient()
      if (!request) return EMPTY
      try { return parseOwnerBuilds(await request('GET', '/v1/owner-builds')) } catch { return EMPTY /* an older server without the route */ }
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  })
  return query.data ?? EMPTY
}

/** The parts of one build that are not in another: what the owner put in (or took out) against the app's build. */
export function partsMissingFrom(ids: readonly string[], others: readonly string[]) {
  const there = new Set(others)
  return [...new Set(ids.filter((id) => !there.has(id)))]
}

/** Owner app only: set a weapon's build of a tier, or give it back to the solver. The server refuses everybody else. */
export function useOwnerBuildWriter() {
  const client = useQueryClient()
  const send = () => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    return request
  }
  const save = useCallback(async (input: { weaponId: string; tier: BuildTier; code: string; added: string[]; removed: string[] }) => {
    client.setQueryData(KEY, parseOwnerBuilds(await send()('PUT', '/v1/accounts/me/admin/owner-builds', input)))
  }, [client])
  const remove = useCallback(async (weaponId: string, tier: BuildTier) => {
    client.setQueryData(KEY, parseOwnerBuilds(await send()('POST', '/v1/accounts/me/admin/owner-builds/remove', { weaponId, tier })))
  }, [client])
  return { save, remove }
}
