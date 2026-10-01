import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { canonicalMapId } from '../data/mapIds'
import type { MapMarker, ModeProgress, Quest } from '../domain/types'
import type { RaidState } from '../import/raidState'
import { planRoute, type Point, type RoutePlan } from './route'

/**
 * The map of the raid the game logs report right now (desktop app only), or null outside a raid.
 * Only the map is known from the logs — never the spawn point or the position in the raid.
 */
export function useRaidMapId(): string | null {
  const [raid, setRaid] = useState<RaidState>({ inRaid: false })
  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop?.getRaidState) return
    let active = true
    void desktop.getRaidState().then((state) => { if (active) setRaid(state) }).catch(() => {})
    const off = desktop.onRaidStateChanged?.((state) => { if (active) setRaid(state) })
    return () => { active = false; off?.() }
  }, [])
  return raid.inRaid ? canonicalMapId(raid.location ?? '') || null : null
}

export interface RaidRouteState {
  enabled: boolean
  toggle: () => void
  plan: RoutePlan
  /** Waiting for a click on the map that sets the start. */
  picking: boolean
  setPicking: (value: boolean) => void
  setStart: (point: Point) => void
  resetStart: () => void
}

/** «Маршрут» of the Maps page: on/off in the URL (`?route=1`), the start chosen by the user per map. */
export function useRaidRoute(mapId: string, markers: MapMarker[], quests: Quest[], progress: ModeProgress): RaidRouteState {
  const [params, setParams] = useSearchParams()
  const enabled = params.get('route') === '1'
  const [start, setStartPoint] = useState<{ mapId: string; point: Point } | null>(null)
  const [picking, setPicking] = useState(false)
  const customStart = start?.mapId === mapId ? start.point : null
  const plan = useMemo(
    () => enabled ? planRoute(markers, quests, progress, mapId, customStart) : { startIsCustom: false, steps: [], length: 0 },
    [enabled, markers, quests, progress, mapId, customStart],
  )
  return {
    enabled,
    plan,
    picking: enabled && picking,
    setPicking,
    toggle: () => {
      setPicking(false)
      setParams((current) => {
        const next = new URLSearchParams(current)
        if (enabled) next.delete('route')
        else next.set('route', '1')
        return next
      }, { replace: true })
    },
    setStart: (point) => { setStartPoint({ mapId, point }); setPicking(false) },
    resetStart: () => { setStartPoint(null); setPicking(false) },
  }
}
