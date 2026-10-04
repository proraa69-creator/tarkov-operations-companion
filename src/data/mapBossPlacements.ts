import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import type { MapMarker } from '../domain/types'
import { STATIC_BOSSES } from './bosses'

/**
 * Bosses the owner placed on the maps by hand (server/src/routes/mapBosses.ts). Every player's map shows them; a boss
 * placed by hand on a map replaces the automatic markers of that boss on that map (the owner's word wins).
 * Positions are game metres: the marker sits at [z, x], like every catalog marker (src/data/mapProjection.ts).
 */
export interface MapBossPlacement {
  id: string
  mapId: string
  bossKey: string
  bossName: string
  x: number
  z: number
  floor?: string
  /** A deleted automatic boss: hides that boss's automatic markers on the map and draws nothing. */
  hidden?: boolean
  createdAt: string
}

export type NewMapBossPlacement = Pick<MapBossPlacement, 'mapId' | 'bossKey' | 'bossName' | 'x' | 'z' | 'floor' | 'hidden'>

export const OWNER_BOSS_SOURCE = 'owner-placed'
const PLACEMENTS_KEY = ['map-boss-placements'] as const
/** One shared empty list, so the dataset keeps its identity while nothing is placed. */
const NONE: MapBossPlacement[] = []

/** Bosses the owner can pick: the profiles the app knows, plus the boss groups of the maps. */
export const PLACEABLE_BOSSES: Array<{ key: string; name: string }> = [
  ...STATIC_BOSSES.map((boss) => ({ key: boss.key, name: boss.name })),
  { key: 'cultist-priest', name: 'Жрец культа' },
  { key: 'rogue', name: 'Отступники' },
  { key: 'raider', name: 'Рейдеры' },
]

function parsePlacements(answer: unknown): MapBossPlacement[] {
  const list = (answer as { placements?: unknown } | null)?.placements
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    const row = entry as Partial<MapBossPlacement>
    if (typeof row.id !== 'string' || typeof row.mapId !== 'string' || typeof row.bossKey !== 'string' || typeof row.bossName !== 'string') return []
    if (!Number.isFinite(row.x) || !Number.isFinite(row.z)) return []
    return [{ id: row.id, mapId: row.mapId, bossKey: row.bossKey, bossName: row.bossName, x: Number(row.x), z: Number(row.z), ...(typeof row.floor === 'string' && row.floor ? { floor: row.floor } : {}), ...(row.hidden === true ? { hidden: true } : {}), createdAt: String(row.createdAt ?? '') }]
  })
}

export function placementMarker(placement: MapBossPlacement): MapMarker {
  return {
    id: `owner-boss-${placement.id}`,
    mapId: placement.mapId,
    type: 'boss',
    layerId: 'boss',
    title: placement.bossName,
    description: 'Место появления отмечено вручную.',
    position: [placement.z, placement.x],
    ...(placement.floor ? { floor: placement.floor } : {}),
    boss: { key: placement.bossKey, name: placement.bossName },
    source: OWNER_BOSS_SOURCE,
  }
}

export const bossKeyOf = (marker: MapMarker) => (marker.boss?.key ?? marker.boss?.name ?? marker.title).toLowerCase()

/** The catalog markers with the owner's bosses: automatic markers of a boss placed by hand on that map are dropped. */
export function withOwnerBosses(markers: MapMarker[], placements: MapBossPlacement[]): MapMarker[] {
  if (!placements.length) return markers
  const placed = new Set(placements.flatMap((entry) => [`${entry.mapId}:${entry.bossKey.toLowerCase()}`, `${entry.mapId}:${entry.bossName.toLowerCase()}`]))
  const names = (marker: MapMarker) => [bossKeyOf(marker), (marker.boss?.name ?? marker.title).toLowerCase()]
  const kept = markers.filter((marker) => marker.type !== 'boss' || !names(marker).some((name) => placed.has(`${marker.mapId}:${name}`)))
  return [...kept, ...placements.filter((entry) => !entry.hidden).map(placementMarker)]
}

/** The owner's placements (refreshed every 10 minutes); an empty list without a server. */
export function useMapBossPlacements(enabled = true) {
  const query = useQuery({
    queryKey: PLACEMENTS_KEY,
    queryFn: async () => {
      const request = serviceClient()
      return request ? parsePlacements(await request('GET', '/v1/map-bosses')) : []
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  })
  return query.data ?? NONE
}

/** Owner app only: place / remove a boss. The server refuses everybody but the owner's account. */
export function useMapBossEditor() {
  const client = useQueryClient()
  const store = useCallback((placements: MapBossPlacement[]) => client.setQueryData(PLACEMENTS_KEY, placements), [client])
  const place = useCallback(async (placement: NewMapBossPlacement) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    store(parsePlacements(await request('POST', '/v1/accounts/me/admin/map-bosses', placement)))
  }, [store])
  const remove = useCallback(async (id: string) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    store(parsePlacements(await request('POST', `/v1/accounts/me/admin/map-bosses/${id}/remove`)))
  }, [store])
  return { place, remove }
}

/** The placement behind a marker drawn from it, if any. */
export const placementIdOf = (marker: MapMarker) => (marker.source === OWNER_BOSS_SOURCE ? marker.id.replace(/^owner-boss-/, '') : undefined)
