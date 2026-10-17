/**
 * «Избранное» of «Сборка оружия» (owner, 17.10.2026): a weapon with one of its builds (бюджетная / средняя / топ), kept
 * on this device per mode (PvP, PvE and Season prices differ). The build is computed again from the current data every
 * time, so it is always up to date; the saved snapshot (parts, stats, price) only tells the player what changed since —
 * a game update changed a part's stats, a price moved — until they accept the new build.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import type { BuildTier, TieredBuild } from './tieredBuilds'
import { installedParts } from './buildModel'
import type { GunCatalog } from './gunTypes'

const KEY_PREFIX = 'raidos-build-favorites-v1:'
const EVENT = 'raidos-build-favorites-changed'
const TIERS: BuildTier[] = ['budget', 'middle', 'top']

export interface FavoriteBuild {
  weaponId: string
  tier: BuildTier
  savedAt: string
  /** Installed part ids, sorted. */
  parts: string[]
  price: number
  ergonomics: number
  recoilVertical: number
  recoilHorizontal: number
}

export interface FavoriteChange {
  added: string[]
  removed: string[]
  priceDelta: number
  ergonomicsDelta: number
  recoilDelta: number
}

const snapshots = new Map<string, { raw: string | null; list: FavoriteBuild[] }>()
const NONE: FavoriteBuild[] = []

function key(mode: RaidMode) { return `${KEY_PREFIX}${mode}` }

export function readFavorites(mode: RaidMode): FavoriteBuild[] {
  let raw: string | null = null
  try { raw = localStorage.getItem(key(mode)) } catch { /* storage unavailable */ }
  const cached = snapshots.get(mode)
  if (cached && cached.raw === raw) return cached.list
  let list = NONE
  try {
    const value: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(value)) list = value.filter((entry): entry is FavoriteBuild => Boolean(entry && typeof entry.weaponId === 'string' && TIERS.includes(entry.tier) && Array.isArray(entry.parts)))
  } catch { /* a damaged value reads as none */ }
  snapshots.set(mode, { raw, list })
  return list
}

function write(mode: RaidMode, list: FavoriteBuild[]) {
  try {
    if (list.length) localStorage.setItem(key(mode), JSON.stringify(list))
    else localStorage.removeItem(key(mode))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function snapshotOf(build: TieredBuild, catalog: Pick<GunCatalog, 'mods'>, now = new Date().toISOString()): FavoriteBuild {
  return {
    weaponId: build.build.weaponId, tier: build.tier, savedAt: now,
    parts: installedParts(build.build, catalog).map((entry) => entry.part.id).sort(),
    price: build.cost.total, ergonomics: build.stats.ergonomics, recoilVertical: build.stats.recoilVertical, recoilHorizontal: build.stats.recoilHorizontal,
  }
}

const same = (a: Pick<FavoriteBuild, 'weaponId' | 'tier'>, b: Pick<FavoriteBuild, 'weaponId' | 'tier'>) => a.weaponId === b.weaponId && a.tier === b.tier

/** Saved, or removed when already saved. */
export function toggleFavorite(mode: RaidMode, snapshot: FavoriteBuild) {
  const list = readFavorites(mode)
  write(mode, list.some((entry) => same(entry, snapshot)) ? list.filter((entry) => !same(entry, snapshot)) : [snapshot, ...list])
}

/** «Принять»: the current build becomes the saved one. */
export function acceptFavorite(mode: RaidMode, snapshot: FavoriteBuild) {
  write(mode, readFavorites(mode).map((entry) => same(entry, snapshot) ? snapshot : entry))
}

/**
 * What changed since the build was saved; undefined when nothing that matters did (prices move a little every day:
 * under 5 % or 2 000 ₽ is not a change).
 */
export function favoriteChange(saved: FavoriteBuild, current: FavoriteBuild): FavoriteChange | undefined {
  const added = current.parts.filter((id) => !saved.parts.includes(id))
  const removed = saved.parts.filter((id) => !current.parts.includes(id))
  const priceDelta = current.price - saved.price
  const ergonomicsDelta = current.ergonomics - saved.ergonomics
  const recoilDelta = current.recoilVertical - saved.recoilVertical
  const priceMoved = Math.abs(priceDelta) >= Math.max(2_000, saved.price * 0.05)
  if (!added.length && !removed.length && !priceMoved && !ergonomicsDelta && !recoilDelta) return undefined
  return { added, removed, priceDelta, ergonomicsDelta, recoilDelta }
}

export function useFavorites(mode: RaidMode) {
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener(EVENT, notify)
    window.addEventListener('storage', notify)
    return () => { window.removeEventListener(EVENT, notify); window.removeEventListener('storage', notify) }
  }, [])
  return useSyncExternalStore(subscribe, () => readFavorites(mode), () => NONE)
}
