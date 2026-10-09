/* eslint-disable react-refresh/only-export-components */
import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useRef, useState } from 'react'
import { divIcon, latLng } from 'leaflet'
import { Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { canonicalMapId } from '../data/mapIds'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import type { RaidState } from '../import/raidState'
import { playerMarkerSvg, type PlayerMarkerStyle } from '../overlay/playerMarker'
import { useLivePositionContext, type LivePositionValue } from '../mobile/livePosition'

/**
 * Where the player is, for a map page: on the phone the position the desktop app pushed to the server
 * (mobile/livePosition.ts), on the desktop the latest EFT screenshot. `onThisMap`: the position belongs to this map
 * (on the desktop also to the current raid), so the map draws it and shows its floor.
 */
export type LivePlayer =
  | { source: 'server'; live: LivePositionValue; position: LivePositionValue['position']; onThisMap: boolean }
  | { source: 'desktop'; position: PlayerPosition | null; onThisMap: boolean }

/** Read by the map page itself (not by the marker), so the shown floor can follow the player (data/useAutoFloor.ts). */
export function useLivePlayer(mapId: string): LivePlayer {
  const live = useLivePositionContext()
  const desktop = useDesktopPosition(!live)
  if (live) return { source: 'server', live, position: live.position, onThisMap: Boolean(live.position?.map && live.position.map === mapId) }
  const { position, raid } = desktop
  const onThisMap = Boolean(position && raid.inRaid && canonicalMapId(raid.location ?? '') === mapId && !(raid.since && position.at < raid.since))
  return { source: 'desktop', position, onThisMap }
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
 * The player's position from the latest EFT screenshot on the app's own map. This is the fallback
 * for exclusive full screen, where no overlay is visible: keep the app on a second monitor.
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

function DesktopPlayerMarker({ player }: { player: Extract<LivePlayer, { source: 'desktop' }> }) {
  const { position, onThisMap } = player
  const [now, setNow] = useState(() => Date.now())
  const [style, setStyle] = useState<PlayerMarkerStyle>('arrow')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const experimental = window.tarkovDesktop?.experimental
    if (!experimental) return
    void experimental.getSettings().then((settings) => setStyle(settings.playerMarker)).catch(() => {})
  }, [])

  const angle = useScreenAngle(position)
  const icon = useMemo(() => divIcon({ className: 'ov-player live-player', html: playerMarkerSvg(style, angle), iconSize: [20, 20], iconAnchor: [10, 10] }), [angle, style])

  if (!position || !onThisMap) return null
  return (
    <Marker position={[position.z, position.x]} icon={icon} interactive zIndexOffset={1200}>
      <Tooltip direction="top" offset={[0, -18]}>{uiText(`Вы · ${Math.max(0, Math.round((now - position.at) / 1000))} с назад`)}</Tooltip>
    </Marker>
  )
}
