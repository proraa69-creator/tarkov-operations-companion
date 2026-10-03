import { uiText } from '../i18n/renderText'
import { useState } from 'react'
import { Circle, CircleMarker, Marker, Polyline, Tooltip, useMapEvents } from 'react-leaflet'
import { divIcon, type LatLngTuple } from 'leaflet'
import { Crosshair, Ruler, Trash2 } from 'lucide-react'

export type MapTool = 'none' | 'ruler' | 'sniper'

/** Like the mapgenie sniper tool: solid rings every 100 m, dashed ones every 50 m, up to 500 m. */
export const SNIPER_MAX = 500
const SNIPER_STEP = 50

export interface MapToolsState {
  tool: MapTool
  rulerPoints: LatLngTuple[]
  sniperCenter: LatLngTuple | null
}

export const initialMapTools: MapToolsState = { tool: 'none', rulerPoints: [], sniperCenter: null }

/** Coordinates are game metres, so plain Euclidean distance is the real distance. */
export function distance(a: LatLngTuple, b: LatLngTuple) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export function rulerLegs(points: LatLngTuple[]) {
  let total = 0
  return points.map((point, index) => {
    const leg = index === 0 ? 0 : distance(points[index - 1]!, point)
    total += leg
    return { point, leg, total }
  })
}

export const formatMetres = (value: number) => `${Math.round(value)} м`

export function MapToolbar({ value, onChange }: { value: MapToolsState; onChange: (next: MapToolsState) => void }) {
  const pick = (tool: MapTool) => onChange({ ...value, tool: value.tool === tool ? 'none' : tool })
  const total = rulerLegs(value.rulerPoints).at(-1)?.total ?? 0
  return (
    <div className="map-tools" role="toolbar" aria-label={uiText('Инструменты карты')}>
      <button type="button" className={`map-tool${value.tool === 'ruler' ? ' active' : ''}`} onClick={() => pick('ruler')} title={uiText('Рулетка: левая кнопка ставит точку, правая отменяет последний участок')}>
        <Ruler size={14} /><span>{uiText('Рулетка')}</span>{value.rulerPoints.length > 1 && <em>{uiText(formatMetres(total))}</em>}
      </button>
      <button type="button" className={`map-tool${value.tool === 'sniper' ? ' active' : ''}`} onClick={() => pick('sniper')} title={uiText('Радиус снайперской стрельбы: кликните по карте и перетаскивайте прицел; правая кнопка мыши — убрать')}>
        <Crosshair size={14} /><span>{uiText('Снайпер')}</span>
      </button>
      {(value.tool === 'ruler' && value.rulerPoints.length > 0) || (value.tool === 'sniper' && value.sniperCenter) ? (
        <button type="button" className="map-tool icon" onClick={() => onChange(value.tool === 'ruler' ? { ...value, rulerPoints: [] } : { ...value, sniperCenter: null })} title={uiText('Очистить')} aria-label={uiText('Очистить')}><Trash2 size={14} /></button>
      ) : null}
    </div>
  )
}

const labelIcon = (text: string) => divIcon({ className: 'map-tool-label', html: `<span>${text}</span>`, iconSize: [0, 0] })
const targetIcon = divIcon({
  className: 'sniper-target',
  html: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="15" /><circle cx="22" cy="22" r="7" /><path d="M22 1v13M22 30v13M1 22h13M30 22h13" /><path d="M22 4l3 6h-6z" class="n" /></svg>',
  iconSize: [44, 44],
  iconAnchor: [22, 22],
})

/** Draws the ruler / sniper overlays and collects clicks while a tool is active. */
export function MapToolLayer({ value, onChange }: { value: MapToolsState; onChange: (next: MapToolsState) => void }) {
  const [cursor, setCursor] = useState<LatLngTuple | null>(null)
  // Right click anywhere on the map (or on the scope) while the sniper tool is on: the grid goes away and the tool is off.
  const cancelSniper = () => onChange({ ...value, tool: 'none', sniperCenter: null })
  useMapEvents({
    click: (event) => {
      const point: LatLngTuple = [event.latlng.lat, event.latlng.lng]
      if (value.tool === 'ruler') onChange({ ...value, rulerPoints: [...value.rulerPoints, point] })
      else if (value.tool === 'sniper' && !value.sniperCenter) onChange({ ...value, sniperCenter: point })
    },
    contextmenu: (event) => {
      if (value.tool === 'sniper') { event.originalEvent.preventDefault(); cancelSniper(); return }
      if (value.tool !== 'ruler') return
      event.originalEvent.preventDefault()
      onChange({ ...value, rulerPoints: value.rulerPoints.slice(0, -1) })
    },
    mousemove: (event) => { if (value.tool === 'ruler') setCursor([event.latlng.lat, event.latlng.lng]) },
    mouseout: () => setCursor(null),
  })
  const legs = rulerLegs(value.rulerPoints)
  const last = value.rulerPoints.at(-1)
  const preview = value.tool === 'ruler' && last && cursor ? [last, cursor] as LatLngTuple[] : null
  const previewTotal = preview ? (legs.at(-1)?.total ?? 0) + distance(preview[0]!, preview[1]!) : 0
  const center = value.sniperCenter
  const rings = Array.from({ length: SNIPER_MAX / SNIPER_STEP }, (_, index) => (index + 1) * SNIPER_STEP)
  return (
    <>
      {value.rulerPoints.length > 1 && <Polyline positions={value.rulerPoints} pathOptions={{ color: '#f2d27a', weight: 2.5, dashArray: '7 6' }} interactive={false} />}
      {preview && (
        <Polyline positions={preview} pathOptions={{ color: '#f2d27a', weight: 2, dashArray: '4 6', opacity: 0.8 }} interactive={false}>
          <Tooltip permanent direction="right" offset={[10, 0]} className="map-tool-tip">{formatMetres(previewTotal)}</Tooltip>
        </Polyline>
      )}
      {legs.map(({ point, total }, index) => (
        <CircleMarker key={`${index}:${point.join(',')}`} center={point} radius={4.5} pathOptions={{ color: '#0b110d', weight: 1.5, fillColor: '#f2d27a', fillOpacity: 1 }} interactive={false}>
          {index > 0 && <Tooltip permanent direction="top" offset={[0, -6]} className="map-tool-tip">{formatMetres(total)}</Tooltip>}
        </CircleMarker>
      ))}
      {center && (
        <>
          {rings.map((radius) => (
            <Circle key={radius} center={center} radius={radius} interactive={false} pathOptions={{ color: '#161a17', weight: radius % 100 === 0 ? 1.4 : 1, opacity: 0.85, fill: false, dashArray: radius % 100 === 0 ? undefined : '3 5' }} />
          ))}
          {rings.filter((radius) => radius % 100 === 0).flatMap((radius) => [
            [center[0] + radius, center[1]], [center[0] - radius, center[1]], [center[0], center[1] + radius], [center[0], center[1] - radius],
          ].map((position, index) => (
            <Marker key={`label-${radius}-${index}`} position={position as LatLngTuple} icon={labelIcon(String(radius))} interactive={false} keyboard={false} />
          )))}
          <Marker
            position={center}
            icon={targetIcon}
            draggable
            zIndexOffset={2000}
            eventHandlers={{
              dragend: (event) => { const next = event.target.getLatLng(); onChange({ ...value, sniperCenter: [next.lat, next.lng] }) },
              contextmenu: (event) => { event.originalEvent.preventDefault(); cancelSniper() },
            }}
          />
        </>
      )}
    </>
  )
}
