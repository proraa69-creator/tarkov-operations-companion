import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import type { RaidMode } from '../domain/types'
import type { SketchStroke } from '../maps/mapSketch'
import { friendColors } from './friendColors'
import { memberLabel } from './squadLabels'
import { SQUAD_SKETCH_HIDDEN_SYNC, useSquadSettings } from './squadSettings'
import { useSquad } from './useSquad'

/**
 * The squad's places and drawings on the map (server/src/routes/squadLive.ts; owner, 14.11.2026): the mates' latest screenshot
 * positions and their kept drawings, pushed through a wait like the PC→phone relay. Only while «Настройки отряда» has
 * «Местоположение» or «Зарисовки» on (squad/squadSettings.ts), and only what is on is shown.
 */
export interface SquadMatePosition { x: number; y: number; z: number; yaw: number; at: number; map?: string }
export interface SquadMate { memberId: string; nickname: string; color: string; position: SquadMatePosition }
/** `at`: when the mate kept it (server time); a newer drawing of the same map shows again after «Убрать». */
export interface SquadMateSketch { memberId: string; nickname: string; color: string; mapId: string; strokes: SketchStroke[]; at: number }

const HEX24 = /^[a-f0-9]{24}$/
const MAP_ID = /^[A-Za-z0-9_-]{1,40}$/
const COLOR = /^#[0-9a-f]{6}$/i
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
/** A refused or failed wait: again after this long. */
const RETRY_MS = 5_000
/** An answer that came at once with nothing new (the server had no room to wait): not again before this. */
const MIN_ROUND_MS = 2_000

export const squadLivePath = (squadId: string, mode: RaidMode) => `/v1/squad-live/${squadId}/${mode}`

interface LiveAnswer { version: number; positions: Array<SquadMatePosition & { memberId: string }>; sketches: Array<{ memberId: string; mapId: string; strokes: SketchStroke[]; at: number }> }

/** The server's answer, shape-checked; null when it is not one. */
export function cleanSquadLive(raw: unknown): LiveAnswer | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!value || !finite(value.version)) return null
  const positions = (Array.isArray(value.positions) ? value.positions : []).flatMap((entry): LiveAnswer['positions'] => {
    const item = entry as Record<string, unknown>
    if (typeof item?.memberId !== 'string' || !HEX24.test(item.memberId) || ![item.x, item.y, item.z, item.yaw, item.at].every(finite)) return []
    return [{ memberId: item.memberId, x: item.x as number, y: item.y as number, z: item.z as number, yaw: item.yaw as number, at: item.at as number, ...(typeof item.map === 'string' && MAP_ID.test(item.map) ? { map: item.map } : {}) }]
  })
  const sketches = (Array.isArray(value.sketches) ? value.sketches : []).flatMap((entry): LiveAnswer['sketches'] => {
    const item = entry as Record<string, unknown>
    if (typeof item?.memberId !== 'string' || !HEX24.test(item.memberId) || typeof item.mapId !== 'string' || !MAP_ID.test(item.mapId) || !Array.isArray(item.strokes)) return []
    const strokes = item.strokes.flatMap((raw): SketchStroke[] => {
      const stroke = raw as Record<string, unknown>
      if (!finite(stroke?.zoom) || !Array.isArray(stroke.points)) return []
      const points = stroke.points.filter((point): point is [number, number] => Array.isArray(point) && point.length === 2 && finite(point[0]) && finite(point[1]))
      return points.length ? [{ zoom: stroke.zoom, points, ...(typeof stroke.color === 'string' && COLOR.test(stroke.color) ? { color: stroke.color } : {}) }] : []
    })
    return strokes.length ? [{ memberId: item.memberId, mapId: item.mapId, strokes, at: finite(item.at) ? item.at : 0 }] : []
  })
  return { version: value.version, positions, sketches }
}

/**
 * A mate's drawing taken off this player's map (owner, 14.11.2026: «тиммейт может нажать крестик… удалить именно его рисунок»):
 * `memberId:mapId` → the `at` of the drawing taken off, on every device of the account; the mate's next drawing of that map shows again.
 */
const HIDDEN_KEY = SQUAD_SKETCH_HIDDEN_SYNC.key
const HIDDEN_EVENT = SQUAD_SKETCH_HIDDEN_SYNC.event
const NO_HIDDEN: Record<string, number> = {}
let hiddenCache: { raw: string | null; value: Record<string, number> } | undefined
function readHiddenSketches(): Record<string, number> {
  let raw: string | null = null
  try { raw = localStorage.getItem(HIDDEN_KEY) } catch { /* storage unavailable */ }
  if (hiddenCache?.raw === raw) return hiddenCache.value
  let value: Record<string, number> = {}
  try {
    const stored: unknown = raw ? JSON.parse(raw) : {}
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) value = Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, number] => finite(entry[1])))
  } catch { /* broken: nothing hidden */ }
  hiddenCache = { raw, value }
  return value
}
export function hideSquadSketch(memberId: string, mapId: string, at: number) {
  const next = { ...readHiddenSketches(), [`${memberId}:${mapId}`]: at }
  // Only the latest thirty: older ones have run out on the server anyway, and the account's sync takes a short value.
  const kept = Object.fromEntries(Object.entries(next).slice(-30))
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(kept)) } catch { /* storage unavailable: hidden until the page is left */ }
  window.dispatchEvent(new Event(HIDDEN_EVENT))
}
const subscribeHidden = (listener: () => void) => {
  window.addEventListener(HIDDEN_EVENT, listener)
  return () => window.removeEventListener(HIDDEN_EVENT, listener)
}

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
})

/**
 * The squad of this mode, for the map: the mates on the map and their drawings (what is turned on), and `shareSketch` for a drawing
 * kept here. Waits on the server only while something is on, the player is in a squad and has access.
 */
export function useSquadLive(mode: RaidMode) {
  const settings = useSquadSettings()
  const squad = useSquad(mode, { poll: false })
  const info = squad.overview?.squad ?? squad.mine?.squad ?? null
  const squadId = squad.mine?.access ? info?.id ?? '' : ''
  const active = Boolean(squadId && (settings.location || settings.sketches))
  const [answer, setAnswer] = useState<{ key: string; live: LiveAnswer } | null>(null)
  const key = `${squadId}:${mode}`

  useEffect(() => {
    if (!active) return
    const stop = new AbortController()
    void (async () => {
      let since: number | undefined
      while (!stop.signal.aborted) {
        const request = serviceClient()
        if (!request) { await pause(RETRY_MS, stop.signal); continue }
        const began = Date.now()
        try {
          const live = cleanSquadLive(await request('GET', `${squadLivePath(squadId, mode)}${since === undefined ? '' : `?since=${since}`}`))
          if (stop.signal.aborted) return
          if (!live) { await pause(RETRY_MS, stop.signal); continue }
          const same = live.version === since
          since = live.version
          setAnswer({ key, live })
          if (same && Date.now() - began < MIN_ROUND_MS) await pause(MIN_ROUND_MS, stop.signal)
        } catch {
          await pause(RETRY_MS, stop.signal)
        }
      }
    })()
    return () => stop.abort()
  }, [active, squadId, mode, key])

  const members = useMemo(() => info?.members ?? [], [info])
  const mates = useMemo(() => {
    const others = members.filter((member) => !member.isYou)
    const colors = friendColors(others.map((member) => member.memberId))
    return new Map(others.map((member) => [member.memberId, { nickname: memberLabel(member.nickname, members.indexOf(member)), color: colors.get(member.memberId) ?? '#c4a665' }]))
  }, [members])
  const live = active && answer?.key === key ? answer.live : null
  const hidden = useSyncExternalStore(subscribeHidden, readHiddenSketches, () => NO_HIDDEN)

  const positions = useMemo<SquadMate[]>(() => (settings.location && live ? live.positions.flatMap(({ memberId, ...position }) => {
    const mate = mates.get(memberId)
    return mate ? [{ memberId, ...mate, position }] : []
  }) : []), [settings.location, live, mates])
  const sketches = useMemo<SquadMateSketch[]>(() => (settings.sketches && live ? live.sketches.flatMap((sketch) => {
    const mate = mates.get(sketch.memberId)
    return mate && hidden[`${sketch.memberId}:${sketch.mapId}`] !== sketch.at ? [{ ...sketch, ...mate }] : []
  }) : []), [settings.sketches, live, mates, hidden])

  /** A drawing kept with ✓ (or closed: no strokes) goes to the squad, when «Зарисовки» is on. */
  const shareSketch = useCallback((mapId: string, strokes: SketchStroke[]) => {
    if (!squadId || !settings.sketches || !MAP_ID.test(mapId)) return
    void serviceClient()?.('PUT', `${squadLivePath(squadId, mode)}/sketch/${mapId}`, { strokes }).catch(() => {})
  }, [squadId, settings.sketches, mode])

  return { positions, sketches, shareSketch, inSquad: Boolean(squadId) }
}

export type SquadLive = ReturnType<typeof useSquadLive>
