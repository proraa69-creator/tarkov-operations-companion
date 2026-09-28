import { useEffect, useState } from 'react'
import type { RaidMode } from '../domain/types'

export const GOON_MAPS = ['customs', 'woods', 'shoreline', 'lighthouse'] as const
const MAP_IDS: Record<string, string> = {
  '56f40101d2720b2a4d8b45d6': 'customs', '5704e3c2d2720bac5b8b4567': 'woods',
  '5704e554d2720bac5b8b456e': 'shoreline', '5704e4dad2720bb55b8b4567': 'lighthouse',
}
export interface GoonLocation { mapId: string; reportedAt: string; source: 'community' | 'local' }
export function parseGoonReport(value: unknown): GoonLocation | null {
  const reports = Array.isArray(value) ? value : [value]
  const valid = reports.flatMap((entry): GoonLocation[] => {
    if (!entry || typeof entry !== 'object') return []
    const report = entry as { map?: string | { normalizedName?: string; id?: string }; timestamp?: string | number }
    const rawMap = typeof report.map === 'string' ? report.map : report.map?.normalizedName ?? report.map?.id ?? ''
    const mapId = MAP_IDS[rawMap] ?? rawMap
    const numeric = Number(report.timestamp)
    const time = Number.isFinite(numeric) && numeric > 0 ? numeric * (numeric < 1e12 ? 1000 : 1) : Date.parse(String(report.timestamp))
    if (!GOON_MAPS.includes(mapId as typeof GOON_MAPS[number]) || !Number.isFinite(time)) return []
    return [{ mapId, reportedAt: new Date(time).toISOString(), source: 'community' }]
  })
  return valid.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0] ?? null
}
const key = (mode: RaidMode) => `goon-sighting-v1-${mode}`
function readLocal(mode: RaidMode): GoonLocation | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key(mode)) ?? 'null') as GoonLocation | null
    const valid = raw && parseGoonReport({ map: raw.mapId, timestamp: raw.reportedAt })
    return valid ? { ...valid, source: 'local' } : null
  } catch { return null }
}

export function useGoonLocation(mode: RaidMode) {
  const [reports, setReports] = useState<{ mode: RaidMode; community: GoonLocation | null; local: GoonLocation | null }>({ mode, community: null, local: readLocal(mode) })
  useEffect(() => {
    let alive = true
    setReports({ mode, community: null, local: readLocal(mode) })
    const update = async () => {
      try {
        const upstream = mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular'
        const response = await fetch(`https://json.tarkov.dev/${upstream}/maps`, { signal: AbortSignal.timeout(15_000) })
        if (!response.ok) return
        const root = await response.json() as { data?: { goonReports?: unknown } }
        const community = parseGoonReport(root.data?.goonReports)
        if (alive) setReports((current) => ({ ...current, mode, community }))
      } catch { /* Keep the last verified report when the public tracker is unavailable. */ }
    }
    void update()
    const timer = window.setInterval(update, 60_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [mode])
  const location = reports.mode === mode ? [reports.community, reports.local].filter((r): r is GoonLocation => Boolean(r)).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0] ?? null : readLocal(mode)
  const reportSighting = (mapId: string) => {
    if (!GOON_MAPS.includes(mapId as typeof GOON_MAPS[number])) return
    const local: GoonLocation = { mapId, reportedAt: new Date().toISOString(), source: 'local' }
    localStorage.setItem(key(mode), JSON.stringify(local))
    setReports((current) => ({ ...current, mode, local }))
  }
  return { location, reportSighting }
}
