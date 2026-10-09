import { useCallback, useEffect, useRef, useState } from 'react'
import { tarkovJson } from './tarkovApi'
import { serviceClient } from '../account/nicknameBinding'
import { LIVE_UPDATE_EVENT } from './mapUpdates'
import type { RaidMode } from '../domain/types'

export const GOON_MAPS = ['customs', 'woods', 'shoreline', 'lighthouse'] as const
export type GoonMapId = typeof GOON_MAPS[number]
export const isGoonMap = (value: unknown): value is GoonMapId => typeof value === 'string' && GOON_MAPS.includes(value as GoonMapId)

/** Our server is polled this often; the tarkov.dev community feed is an extra, slower source. */
export const GOON_REFRESH_MS = 30_000
const COMMUNITY_REFRESH_MS = 60_000
export const GOON_STATS_WINDOW_MS = 5 * 60 * 60 * 1000
/** Unsent own sightings are retried on every refresh while they are still this fresh. */
const RETRY_UNSENT_MS = 15 * 60_000
const KEEP_OWN_MS = 24 * 60 * 60 * 1000

const MAP_IDS: Record<string, string> = {
  '56f40101d2720b2a4d8b45d6': 'customs', '5704e3c2d2720bac5b8b4567': 'woods',
  '5704e554d2720bac5b8b456e': 'shoreline', '5704e4dad2720bb55b8b4567': 'lighthouse',
}

export interface GoonLocation {
  mapId: string
  reportedAt: string
  source: 'server' | 'community' | 'local'
  /** Own sighting that has not reached our server yet. */
  unsent?: boolean
  /** Escape from Tarkov nickname of who saw them (server sightings of signed-in accounts). */
  nickname?: string
}
export interface GoonMapStat { mapId: GoonMapId; count: number; lastAt: string }
export interface GoonSightingView { mapId: GoonMapId; reportedAt: string; nickname?: string }
export interface GoonSnapshot { latest: GoonSightingView | null; last5h: GoonMapStat[]; recent: GoonSightingView[] }
export interface OwnGoonSighting { mapId: GoonMapId; reportedAt: string; sent: boolean }
/** server: our API answered · offline: API configured but unreachable · local-only: no API configured. */
export type GoonConnection = 'server' | 'offline' | 'local-only'
/** signin: no account session · nickname: the account has no Tarkov nickname for this mode. */
export type GoonReportResult = 'sent' | 'duplicate' | 'unsent' | 'local' | 'signin' | 'nickname'

export function parseGoonReport(value: unknown): GoonLocation | null {
  const reports = Array.isArray(value) ? value : [value]
  const valid = reports.flatMap((entry): GoonLocation[] => {
    if (!entry || typeof entry !== 'object') return []
    const report = entry as { map?: string | { normalizedName?: string; id?: string }; timestamp?: string | number }
    const rawMap = typeof report.map === 'string' ? report.map : report.map?.normalizedName ?? report.map?.id ?? ''
    const mapId = MAP_IDS[rawMap] ?? rawMap
    const numeric = Number(report.timestamp)
    const time = Number.isFinite(numeric) && numeric > 0 ? numeric * (numeric < 1e12 ? 1000 : 1) : Date.parse(String(report.timestamp))
    if (!isGoonMap(mapId) || !Number.isFinite(time)) return []
    return [{ mapId, reportedAt: new Date(time).toISOString(), source: 'community' }]
  })
  return valid.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0] ?? null
}

const isoTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
/** EFT nicknames: letters, digits, «_» and «-»; anything else from the server is not shown. */
const NICKNAME = /^[\p{L}\p{N}_-]{2,32}$/u

function parseSighting(value: unknown): GoonSightingView | null {
  const raw = value as { mapId?: unknown; reportedAt?: unknown; nickname?: unknown } | null | undefined
  if (!raw || !isGoonMap(raw.mapId) || !isoTime(raw.reportedAt)) return null
  return { mapId: raw.mapId, reportedAt: new Date(raw.reportedAt).toISOString(), ...(typeof raw.nickname === 'string' && NICKNAME.test(raw.nickname) ? { nickname: raw.nickname } : {}) }
}

/** Validates GET /v1/goons/:mode (and the `snapshot` field of the POST answer). */
export function parseGoonSnapshot(value: unknown): GoonSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const root = value as { latest?: unknown; last5h?: unknown; recent?: unknown }
  if (!Array.isArray(root.last5h)) return null
  const latest = parseSighting(root.latest)
  // Older servers send no list: no names then.
  const recent = Array.isArray(root.recent) ? root.recent.slice(0, 20).flatMap((entry) => parseSighting(entry) ?? []) : []
  const last5h = root.last5h.flatMap((entry): GoonMapStat[] => {
    const row = entry as { mapId?: unknown; count?: unknown; lastAt?: unknown } | null
    if (!row || !isGoonMap(row.mapId) || !isoTime(row.lastAt) || typeof row.count !== 'number' || !Number.isFinite(row.count) || row.count < 1) return []
    return [{ mapId: row.mapId, count: Math.floor(row.count), lastAt: new Date(row.lastAt).toISOString() }]
  })
  return { latest, last5h: sortStats(last5h), recent }
}

const sortStats = (rows: GoonMapStat[]) => rows.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))

/**
 * Combines our server snapshot, the community feed and this user's own sightings.
 * Own sightings only count when the server does not already have them (unsent) or when no server is reachable.
 */
export function mergeGoonView(input: { server: GoonSnapshot | null; community: GoonLocation | null; own: OwnGoonSighting[]; now: number }) {
  const { server, community, own, now } = input
  const ownShown = server ? own.filter((entry) => !entry.sent) : own
  const candidates: GoonLocation[] = [
    ...(server?.latest ? [{ ...server.latest, source: 'server' as const }] : []),
    ...(community ? [community] : []),
    ...ownShown.map((entry) => ({ mapId: entry.mapId, reportedAt: entry.reportedAt, source: 'local' as const, ...(entry.sent ? {} : { unsent: true }) })),
  ]
  const location = candidates.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0] ?? null
  const stats = new Map<GoonMapId, GoonMapStat>((server?.last5h ?? []).map((row) => [row.mapId, { ...row }]))
  for (const entry of ownShown) {
    if (now - Date.parse(entry.reportedAt) > GOON_STATS_WINDOW_MS) continue
    const row = stats.get(entry.mapId)
    if (!row) stats.set(entry.mapId, { mapId: entry.mapId, count: 1, lastAt: entry.reportedAt })
    else { row.count += 1; if (entry.reportedAt > row.lastAt) row.lastAt = entry.reportedAt }
  }
  return { location, stats: sortStats([...stats.values()]) }
}

type Transport = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown | null>

/**
 * Desktop: IPC service gateway. Phone / browser: the account's web transport (sends the session with a sighting, so the
 * server knows the nickname). A build with VITE_SERVICE_URL only: plain requests. Otherwise null (local-only mode).
 */
export function resolveGoonTransport(): Transport | null {
  const desktop = typeof window === 'undefined' ? undefined : window.tarkovDesktop
  if (desktop?.serviceRequest) return (method, path, body) => desktop.serviceRequest(method, path, body)
  const account = serviceClient()
  if (account) return (method, path, body) => account(method, path, body)
  const base = String(import.meta.env.VITE_SERVICE_URL ?? '').trim().replace(/\/$/, '')
  if (!base) return null
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method, signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const result = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) throw new Error(result?.error ?? `Сервис недоступен: ${response.status}`)
    return result
  }
}

const ownKey = (mode: RaidMode) => `goon-sightings-v2-${mode}`
const legacyKey = (mode: RaidMode) => `goon-sighting-v1-${mode}`

export function readOwnSightings(mode: RaidMode, now = Date.now()): OwnGoonSighting[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ownKey(mode)) ?? 'null') as unknown
    const list = Array.isArray(raw) ? raw : []
    if (!Array.isArray(raw)) {
      // Sightings from 0.5.x were stored one per mode and never left this computer.
      const legacy = JSON.parse(localStorage.getItem(legacyKey(mode)) ?? 'null') as { mapId?: unknown; reportedAt?: unknown } | null
      if (legacy) list.push({ mapId: legacy.mapId, reportedAt: legacy.reportedAt, sent: false })
    }
    return list.flatMap((entry): OwnGoonSighting[] => {
      const row = entry as { mapId?: unknown; reportedAt?: unknown; sent?: unknown } | null
      if (!row || !isGoonMap(row.mapId) || !isoTime(row.reportedAt) || now - Date.parse(row.reportedAt) > KEEP_OWN_MS) return []
      return [{ mapId: row.mapId, reportedAt: new Date(row.reportedAt).toISOString(), sent: row.sent === true }]
    }).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)).slice(0, 30)
  } catch { return [] }
}

function writeOwnSightings(mode: RaidMode, list: OwnGoonSighting[]) {
  try { localStorage.setItem(ownKey(mode), JSON.stringify(list.slice(0, 30))) } catch { /* Storage full or blocked: the sighting still lives in memory. */ }
}

async function postSighting(transport: Transport, mode: RaidMode, mapId: GoonMapId) {
  const answer = await transport('POST', `/v1/goons/${mode}/sightings`, { mapId }) as { accepted?: unknown; reason?: unknown; snapshot?: unknown } | null
  if (!answer) return null
  const refused = answer.accepted === false ? answer.reason : undefined
  const rejected: 'signin' | 'nickname' | undefined = refused === 'signin' ? 'signin' : refused === 'nickname' ? 'nickname' : undefined
  return { duplicate: refused === 'duplicate', rejected, snapshot: parseGoonSnapshot(answer.snapshot) }
}

interface TrackerState { mode: RaidMode; server: GoonSnapshot | null; community: GoonLocation | null; own: OwnGoonSighting[]; connection: GoonConnection }

/** Shared Goons sightings for the selected mode. Never throws: without the server it keeps working locally. */
export function useGoonTracker(mode: RaidMode) {
  const [state, setState] = useState<TrackerState>(() => ({ mode, server: null, community: null, own: readOwnSightings(mode), connection: resolveGoonTransport() ? 'server' : 'local-only' }))
  const [now, setNow] = useState(() => Date.now())
  const modeRef = useRef(mode)
  useEffect(() => { modeRef.current = mode }, [mode])
  // Mode switched (PvP / PvE / Seasonal): start from that mode's own data, never mix them.
  if (state.mode !== mode) setState({ mode, server: null, community: null, own: readOwnSightings(mode), connection: state.connection })
  const current = state.mode === mode ? state : { ...state, mode, server: null, community: null, own: [] }

  const markSent = useCallback((targetMode: RaidMode, sighting: OwnGoonSighting) => {
    const list = readOwnSightings(targetMode).map((entry) => entry.reportedAt === sighting.reportedAt && entry.mapId === sighting.mapId ? { ...entry, sent: true } : entry)
    writeOwnSightings(targetMode, list)
    return list
  }, [])
  /** A sighting the server refused (no session / no nickname) is not kept as «not sent»: it would never go. */
  const dropOwn = useCallback((targetMode: RaidMode, sighting: OwnGoonSighting) => {
    const list = readOwnSightings(targetMode).filter((entry) => !(entry.reportedAt === sighting.reportedAt && entry.mapId === sighting.mapId))
    writeOwnSightings(targetMode, list)
    return list
  }, [])

  const refreshServer = useCallback(async (targetMode: RaidMode) => {
    const transport = resolveGoonTransport()
    if (!transport) { setState((previous) => previous.mode === targetMode ? { ...previous, connection: 'local-only' } : previous); return }
    try {
      let own = readOwnSightings(targetMode)
      for (const pending of own.filter((entry) => !entry.sent && Date.now() - Date.parse(entry.reportedAt) < RETRY_UNSENT_MS).reverse()) {
        try {
          const answer = await postSighting(transport, targetMode, pending.mapId)
          if (answer?.rejected) own = dropOwn(targetMode, pending)
          else if (answer) own = markSent(targetMode, pending)
        } catch { break }
      }
      const answer = await transport('GET', `/v1/goons/${targetMode}`)
      const snapshot = answer === null ? null : parseGoonSnapshot(answer)
      if (modeRef.current !== targetMode) return
      setState((previous) => previous.mode !== targetMode ? previous : answer === null
        ? { ...previous, own, connection: 'local-only' }
        : { ...previous, own, server: snapshot ?? previous.server, connection: snapshot ? 'server' : 'offline' })
    } catch {
      if (modeRef.current === targetMode) setState((previous) => previous.mode === targetMode ? { ...previous, connection: 'offline' } : previous)
    }
  }, [markSent, dropOwn])

  useEffect(() => {
    let alive = true
    let lastCommunity = 0
    const updateCommunity = async () => {
      lastCommunity = Date.now()
      try {
        const upstream = mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular'
        // Through the server's data gateway in the players' app (src/data/tarkovApi.ts).
        const root = await tarkovJson<{ data?: { goonReports?: unknown } }>(`${upstream}/maps`, undefined, 15_000)
        const community = parseGoonReport(root.data?.goonReports)
        if (alive) setState((previous) => previous.mode === mode ? { ...previous, community } : previous)
      } catch { /* The public feed is optional; keep the last verified report. */ }
    }
    const tick = () => {
      if (!alive) return
      setNow(Date.now())
      void refreshServer(mode)
      if (Date.now() - lastCommunity >= COMMUNITY_REFRESH_MS) void updateCommunity()
    }
    tick()
    const timer = window.setInterval(tick, GOON_REFRESH_MS)
    // Somebody reported them (the server told every app, data/mapUpdates.ts): refresh now, not in up to 30 s.
    const onLive = () => { if (alive) { setNow(Date.now()); void refreshServer(mode) } }
    window.addEventListener(LIVE_UPDATE_EVENT, onLive)
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener(LIVE_UPDATE_EVENT, onLive) }
  }, [mode, refreshServer])

  const reportSighting = useCallback(async (mapId: string): Promise<GoonReportResult> => {
    if (!isGoonMap(mapId)) return 'local'
    const targetMode = mode
    const sighting: OwnGoonSighting = { mapId, reportedAt: new Date().toISOString(), sent: false }
    const own = [sighting, ...readOwnSightings(targetMode)]
    writeOwnSightings(targetMode, own)
    setNow(Date.now())
    setState((previous) => previous.mode === targetMode ? { ...previous, own } : previous)
    const transport = resolveGoonTransport()
    if (!transport) { setState((previous) => previous.mode === targetMode ? { ...previous, connection: 'local-only' } : previous); return 'local' }
    try {
      const answer = await postSighting(transport, targetMode, mapId)
      if (!answer) {
        // The phone / browser transport answers nothing for a sighting while signed out.
        if (!window.tarkovDesktop?.serviceRequest && serviceClient()) {
          const updated = dropOwn(targetMode, sighting)
          setState((previous) => previous.mode === targetMode ? { ...previous, own: updated } : previous)
          return 'signin'
        }
        setState((previous) => previous.mode === targetMode ? { ...previous, connection: 'local-only' } : previous)
        return 'local'
      }
      if (answer.rejected) {
        const updated = dropOwn(targetMode, sighting)
        setState((previous) => previous.mode === targetMode ? { ...previous, own: updated, server: answer.snapshot ?? previous.server, connection: 'server' } : previous)
        return answer.rejected
      }
      const updated = markSent(targetMode, sighting)
      setState((previous) => previous.mode === targetMode ? { ...previous, own: updated, server: answer.snapshot ?? previous.server, connection: 'server' } : previous)
      if (!answer.snapshot) void refreshServer(targetMode)
      return answer.duplicate ? 'duplicate' : 'sent'
    } catch {
      setState((previous) => previous.mode === targetMode ? { ...previous, connection: previous.connection === 'local-only' ? 'local-only' : 'offline' } : previous)
      return 'unsent'
    }
  }, [mode, markSent, dropOwn, refreshServer])

  const view = mergeGoonView({ server: current.server, community: current.community, own: current.own, now })
  return { ...view, recent: current.server?.recent ?? [], connection: current.connection, now, reportSighting }
}
