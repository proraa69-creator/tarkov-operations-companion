/* eslint-disable react-refresh/only-export-components */
import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startActivePolling } from '../app/activePolling'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { divIcon, latLng } from 'leaflet'
import { Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { canonicalMapId } from '../data/mapIds'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import type { RaidState } from '../import/raidState'
import { playerMarkerSvg, type PlayerMarkerStyle } from '../overlay/playerMarker'
import { useLivePositionContext, type LivePositionValue } from '../mobile/livePosition'
import '../styles/playerMarker.css'

/**
 * Where the player is, for a map page: on the phone the position the desktop app pushed to the server
 * (mobile/livePosition.ts), on the desktop the latest EFT screenshot. `onThisMap`: the position belongs to this map
 * (on the desktop also to the current raid), so the map draws it and shows its floor.
 */
export type LivePlayer =
  | { source: 'server'; live: LivePositionValue; position: LivePositionValue['position']; onThisMap: boolean }
  /** `raidMapId`: the map of the current raid from the game's logs ('' outside a raid). */
  | { source: 'desktop'; position: PlayerPosition | null; onThisMap: boolean; raidMapId: string }

/** Read by the map page itself (not by the marker), so the shown floor can follow the player (data/useAutoFloor.ts). */
export function useLivePlayer(mapId: string): LivePlayer {
  const live = useLivePositionContext()
  const desktop = useDesktopPosition(!live)
  if (live) return { source: 'server', live, position: live.position, onThisMap: Boolean(live.position?.map && live.position.map === mapId) }
  const { position, raid } = desktop
  const raidMapId = raid.inRaid ? canonicalMapId(raid.location ?? '') : ''
  const onThisMap = Boolean(position && raidMapId && raidMapId === mapId && !(raid.since && position.at < raid.since))
  return { source: 'desktop', position, onThisMap, raidMapId }
}

/**
 * The PC's «Карты» follow the raid (owner, 15.10.2026: «Точка местоположения будет появляться на основной карте»): each
 * new position of the current raid — and the raid's start — opens that raid's map once; another map can be looked at
 * in between, until the next screenshot. Not while the owner edits the map (`enabled`).
 */
export function useFollowRaidMap(player: LivePlayer, mapId: string, enabled = true) {
  const { data } = useTarkovData()
  const { setSelectedMapId } = useAppState()
  const navigate = useNavigate()
  const handled = useRef<string | null>(null)
  const raidMapId = player.source === 'desktop' ? player.raidMapId : ''
  const at = player.source === 'desktop' ? player.position?.at ?? 0 : 0
  useEffect(() => {
    if (!enabled || !raidMapId) return
    const key = `${raidMapId}:${at}`
    if (handled.current === key) return
    handled.current = key
    if (raidMapId === mapId || !data.maps.some((map) => map.id === raidMapId)) return
    setSelectedMapId(raidMapId)
    navigate(`/maps/${raidMapId}`, { replace: true })
  }, [at, data.maps, enabled, mapId, navigate, raidMapId, setSelectedMapId])
}

/** Desktop: the latest screenshot position and the raid state from the game logs. */
function useDesktopPosition(enabled: boolean) {
  const [position, setPosition] = useState<PlayerPosition | null>(null)
  const [raid, setRaid] = useState<RaidState>({ inRaid: false })
  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!enabled || !desktop?.experimental) return
    // The stored position can answer after a newer screenshot already arrived: keep the newer one.
    const take = (next: PlayerPosition) => setPosition((current) => (current && current.at > next.at ? current : next))
    void desktop.experimental.getStatus().then((status) => { if (status.lastPosition) take(status.lastPosition) }).catch(() => {})
    void desktop.getRaidState().then(setRaid).catch(() => {})
    const offPosition = desktop.experimental.onPosition(take)
    const offRaid = desktop.onRaidStateChanged(setRaid)
    return () => { offPosition(); offRaid() }
  }, [enabled])
  return { position, raid }
}

/**
 * The player's position on the app's own map, with the direction the player looks (yaw): on the PC from the latest EFT
 * screenshot, on the phone as the PC sent it. There is no map over the game any more (owner, 15.10.2026): keep the app on
 * a second monitor, or the phone next to the keyboard.
 */
export function LivePlayerMarker({ player }: { player: LivePlayer }) {
  return player.source === 'server' ? <ServerPlayerMarker player={player} /> : <DesktopPlayerMarker player={player} />
}

/** Heading on screen: project a point a few metres ahead so the arrow follows the map's own rotation. */
function useScreenAngle(position: PlayerPosition | null) {
  const map = useMap()
  return useMemo(() => {
    if (!position) return 0
    const rad = (position.yaw * Math.PI) / 180
    const from = map.options.crs!.latLngToPoint(latLng(position.z, position.x), 0)
    const to = map.options.crs!.latLngToPoint(latLng(position.z + Math.cos(rad) * 10, position.x + Math.sin(rad) * 10), 0)
    return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 90
  }, [map, position])
}

/** Phone: the position the desktop app pushed to the server (see mobile/livePosition.ts). */
function ServerPlayerMarker({ player }: { player: Extract<LivePlayer, { source: 'server' }> }) {
  const { position, onThisMap, live: { fresh, follow, setFollow } } = player
  const map = useMap()
  const angle = useScreenAngle(position)
  const icon = useMemo(() => divIcon({ className: `ov-player live-player${fresh ? '' : ' is-stale'}`, html: playerMarkerSvg('arrow', angle), iconSize: [22, 22], iconAnchor: [11, 11] }), [angle, fresh])
  // Dragging the map means the user wants to look around: stop following until «Ко мне» is tapped.
  useMapEvents({ dragstart: () => setFollow(false) })
  const centred = useRef(false)
  const wasFollowing = useRef(follow)
  useEffect(() => {
    const resumed = follow && !wasFollowing.current
    wasFollowing.current = follow
    if (!position || !onThisMap || !follow) return
    const target = latLng(position.z, position.x)
    // First fix on this map: zoom in on the player; afterwards only pan when they get near the edge.
    if (!centred.current) { centred.current = true; map.setView(target, Math.min(map.getMaxZoom(), map.getZoom() + 1.5), { animate: false }); return }
    if (resumed || !map.getBounds().pad(-0.25).contains(target)) map.panTo(target, { animate: true, duration: 0.6 })
  }, [follow, map, onThisMap, position])
  if (!position || !onThisMap) return null
  return (
    <Marker position={[position.z, position.x]} icon={icon} interactive={false} zIndexOffset={1200} />
  )
}

/**
 * Keeps the PC's player in view: the first position on this map centres on it, a later one pans only when the player
 * nears the edge. Dragging the map does not stop it: the next screenshot is the player's own request to see the dot.
 */
function useFollowPlayer(position: PlayerPosition | null, onThisMap: boolean) {
  const map = useMap()
  const centred = useRef(false)
  const at = position?.at
  useEffect(() => {
    if (!position || !onThisMap) return
    const target = latLng(position.z, position.x)
    if (!centred.current) { centred.current = true; map.setView(target, map.getZoom(), { animate: false }); return }
    if (!map.getBounds().pad(-0.2).contains(target)) map.panTo(target, { animate: true, duration: 0.5 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per new screenshot, not per render of the same one
  }, [at, map, onThisMap])
}

function DesktopPlayerMarker({ player }: { player: Extract<LivePlayer, { source: 'desktop' }> }) {
  const { position, onThisMap } = player
  const [now, setNow] = useState(() => Date.now())
  const [style, setStyle] = useState<PlayerMarkerStyle>('arrow')

  // «Вы · N с назад» is read on hover: it ticks while the window is in use, not behind the game (src/app/activePolling.ts).
  useEffect(() => startActivePolling(() => setNow(Date.now()), { activeEveryMs: 5000 }), [])

  useEffect(() => {
    const experimental = window.tarkovDesktop?.experimental
    if (!experimental) return
    void experimental.getSettings().then((settings) => setStyle(settings.playerMarker)).catch(() => {})
  }, [])

  const angle = useScreenAngle(position)
  const icon = useMemo(() => divIcon({ className: 'ov-player live-player is-desktop', html: playerMarkerSvg(style, angle), iconSize: [26, 26], iconAnchor: [13, 13] }), [angle, style])
  useFollowPlayer(position, onThisMap)

  if (!position || !onThisMap) return null
  return (
    <Marker position={[position.z, position.x]} icon={icon} interactive zIndexOffset={1200}>
      <Tooltip direction="top" offset={[0, -18]}>{uiText(`Вы · ${Math.max(0, Math.round((now - position.at) / 1000))} с назад`)}</Tooltip>
    </Marker>
  )
}
