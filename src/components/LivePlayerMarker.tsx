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
 * The player's position from the latest EFT screenshot on the app's own map. This is the fallback
 * for exclusive full screen, where no overlay is visible: keep the app on a second monitor.
 */
export function LivePlayerMarker({ mapId }: { mapId: string }) {
  const live = useLivePositionContext()
  return live ? <ServerPlayerMarker mapId={mapId} live={live} /> : <DesktopPlayerMarker mapId={mapId} />
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
function ServerPlayerMarker({ mapId, live }: { mapId: string; live: LivePositionValue }) {
  const { position, fresh, follow, setFollow } = live
  const map = useMap()
  const angle = useScreenAngle(position)
  const onThisMap = Boolean(position?.map && position.map === mapId)
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

function DesktopPlayerMarker({ mapId }: { mapId: string }) {
  const [position, setPosition] = useState<PlayerPosition | null>(null)
  const [raid, setRaid] = useState<RaidState>({ inRaid: false })
  const [now, setNow] = useState(() => Date.now())
  const [style, setStyle] = useState<PlayerMarkerStyle>('arrow')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop?.experimental) return
    void desktop.experimental.getStatus().then((status) => { if (status.lastPosition) setPosition(status.lastPosition) }).catch(() => {})
    void desktop.getRaidState().then(setRaid).catch(() => {})
    void desktop.experimental.getSettings().then((settings) => setStyle(settings.playerMarker)).catch(() => {})
    const offPosition = desktop.experimental.onPosition(setPosition)
    const offRaid = desktop.onRaidStateChanged(setRaid)
    return () => { offPosition(); offRaid() }
  }, [])

  const angle = useScreenAngle(position)
  const icon = useMemo(() => divIcon({ className: 'ov-player live-player', html: playerMarkerSvg(style, angle), iconSize: [20, 20], iconAnchor: [10, 10] }), [angle, style])

  const onThisMap = raid.inRaid && canonicalMapId(raid.location ?? '') === mapId
  if (!position || !onThisMap || (raid.since && position.at < raid.since)) return null
  return (
    <Marker position={[position.z, position.x]} icon={icon} interactive zIndexOffset={1200}>
      <Tooltip direction="top" offset={[0, -18]}>{uiText(`Вы · ${Math.max(0, Math.round((now - position.at) / 1000))} с назад`)}</Tooltip>
    </Marker>
  )
}
