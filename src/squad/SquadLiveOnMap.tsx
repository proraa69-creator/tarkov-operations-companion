import { useEffect, useMemo, useState } from 'react'
import { divIcon } from 'leaflet'
import { Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { startActivePolling } from '../app/activePolling'
import { useOwnMarkerStyle, useScreenAngle } from '../components/LivePlayerMarker'
import { uiText } from '../i18n/renderText'
import { SKETCH_DEFAULT_COLOR, sketchLineWidth } from '../maps/mapSketch'
import { playerMarkerSvg, type PlayerMarkerStyle } from '../overlay/playerMarker'
import type { SquadMate, SquadMateSketch } from './squadLive'
import './squadLive.css'

/** Older than this, a mate's marker fades: the place is from a while ago. */
const STALE_MS = 2 * 60_000

/**
 * The squad's mates on the map (owner, 14.11.2026: «Маркер у каждого должен показываться тот, который выбран в настройках… все
 * остальные его тиммейты… должны отображаться с таким же маркером»): the marker this player chose, in each mate's colour, with the
 * mate's name under it. Only on the map of the mate's raid.
 */
export function SquadMateMarkers({ mates, mapId }: { mates: SquadMate[]; mapId: string }) {
  const style = useOwnMarkerStyle()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => startActivePolling(() => setNow(Date.now()), { activeEveryMs: 10_000 }), [])
  return <>{mates.filter((mate) => mate.position.map === mapId).map((mate) => <MateMarker key={mate.memberId} mate={mate} style={style} now={now} />)}</>
}

function MateMarker({ mate, style, now }: { mate: SquadMate; style: PlayerMarkerStyle; now: number }) {
  const angle = useScreenAngle(mate.position)
  const stale = now - mate.position.at > STALE_MS
  const icon = useMemo(() => divIcon({
    className: `ov-player squad-mate${stale ? ' is-stale' : ''}`,
    html: `<span class="squad-mate-mark" style="--mate:${mate.color}">${playerMarkerSvg(style, angle)}</span>`,
    iconSize: [24, 24], iconAnchor: [12, 12],
  }), [angle, mate.color, stale, style])
  const seconds = Math.max(0, Math.round((now - mate.position.at) / 1000))
  return <Marker position={[mate.position.z, mate.position.x]} icon={icon} zIndexOffset={1100} keyboard={false}>
    <Tooltip permanent direction="bottom" offset={[0, 10]} opacity={1} className="squad-mate-name">
      <span style={{ color: mate.color }}>{mate.nickname}</span>{seconds >= 60 ? <small> · {Math.round(seconds / 60)} {uiText('мин')}</small> : null}
    </Tooltip>
  </Marker>
}

/** The mates' drawings of this map, under the player's own, in the colours they drew with. Never takes a click. */
export function SquadSketchLines({ sketches, mapId }: { sketches: SquadMateSketch[]; mapId: string }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const here = sketches.filter((sketch) => sketch.mapId === mapId)
  if (!here.length) return null
  return <Pane name="map-sketch-squad" style={{ zIndex: 449, pointerEvents: 'none' }}>
    {here.flatMap((sketch) => sketch.strokes.map((stroke, index) => <Polyline
      key={`${sketch.memberId}:${index}`}
      positions={stroke.points}
      interactive={false}
      pathOptions={{ color: stroke.color ?? SKETCH_DEFAULT_COLOR, weight: sketchLineWidth(map.getZoomScale(zoom, stroke.zoom)), lineCap: 'round', lineJoin: 'round', opacity: 0.9 }}
    />))}
  </Pane>
}
