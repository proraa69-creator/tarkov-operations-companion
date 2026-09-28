import { uiText } from '../i18n/renderText'
import { Circle, CircleMarker, Polyline, Tooltip, useMapEvents } from 'react-leaflet'
import { divIcon, type LatLngTuple } from 'leaflet'
import { Marker } from 'react-leaflet'
import { Crosshair, Ruler, Trash2, Undo2 } from 'lucide-react'

export type MapTool = 'none' | 'ruler' | 'sniper'

export const SNIPER_RANGES = [200, 400, 600, 800] as const
const RING_STEP = 100

export interface MapToolsState {
  tool: MapTool
  rulerPoints: LatLngTuple[]
  sniperCenter: LatLngTuple | null
  sniperRange: number
}

export const initialMapTools: MapToolsState = { tool: 'none', rulerPoints: [], sniperCenter: null, sniperRange: 400 }

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
      <button type="button" className={`map-tool${value.tool === 'ruler' ? ' active' : ''}`} onClick={() => pick('ruler')} title={uiText('Рулетка: кликайте по карте, чтобы измерить расстояние')}>
        <Ruler size={14} /><span>{uiText('Рулетка')}</span>{value.rulerPoints.length > 1 && <em>{uiText(formatMetres(total))}</em>}
      </button>
      <button type="button" className={`map-tool${value.tool === 'sniper' ? ' active' : ''}`} onClick={() => pick('sniper')} title={uiText('Радиус стрельбы: кликните по карте, чтобы поставить центр')}>
        <Crosshair size={14} /><span>{uiText('Снайпер')}</span>{value.sniperCenter && <em>{uiText(formatMetres(value.sniperRange))}</em>}
      </button>
      {value.tool === 'ruler' && (
        <>
          <button type="button" className="map-tool icon" disabled={!value.rulerPoints.length} onClick={() => onChange({ ...value, rulerPoints: value.rulerPoints.slice(0, -1) })} title={uiText('Убрать последнюю точку')} aria-label={uiText('Убрать последнюю точку')}><Undo2 size={14} /></button>
          <button type="button" className="map-tool icon" disabled={!value.rulerPoints.length} onClick={() => onChange({ ...value, rulerPoints: [] })} title={uiText('Очистить')} aria-label={uiText('Очистить')}><Trash2 size={14} /></button>
        </>
      )}
      {value.tool === 'sniper' && (
        <>
          <span className="map-tool-ranges">
            {SNIPER_RANGES.map((range) => (
              <button key={range} type="button" className={`map-tool small${value.sniperRange === range ? ' active' : ''}`} onClick={() => onChange({ ...value, sniperRange: range })}>{range}</button>
            ))}
          </span>
          <button type="button" className="map-tool icon" disabled={!value.sniperCenter} onClick={() => onChange({ ...value, sniperCenter: null })} title={uiText('Очистить')} aria-label={uiText('Очистить')}><Trash2 size={14} /></button>
        </>
      )}
    </div>
  )
}

const labelIcon = (text: string, className: string) => divIcon({ className: `map-tool-label ${className}`, html: `<span>${text}</span>`, iconSize: [0, 0] })

/** Draws the ruler / sniper overlays and collects clicks while a tool is active. */
export function MapToolLayer({ value, onChange }: { value: MapToolsState; onChange: (next: MapToolsState) => void }) {
  useMapEvents({
    click: (event) => {
      const point: LatLngTuple = [event.latlng.lat, event.latlng.lng]
      if (value.tool === 'ruler') onChange({ ...value, rulerPoints: [...value.rulerPoints, point] })
      else if (value.tool === 'sniper') onChange({ ...value, sniperCenter: point })
    },
  })
  const legs = rulerLegs(value.rulerPoints)
  const rings = value.sniperCenter ? Array.from({ length: Math.floor(value.sniperRange / RING_STEP) }, (_, index) => (index + 1) * RING_STEP) : []
  return (
    <>
      {value.rulerPoints.length > 1 && <Polyline positions={value.rulerPoints} pathOptions={{ color: '#f2d27a', weight: 2.5, dashArray: '7 6' }} interactive={false} />}
      {legs.map(({ point, leg, total }, index) => (
        <CircleMarker key={`${index}:${point.join(',')}`} center={point} radius={4.5} pathOptions={{ color: '#0b110d', weight: 1.5, fillColor: '#f2d27a', fillOpacity: 1 }} interactive={false}>
          {index > 0 && <Tooltip permanent direction="top" offset={[0, -6]} className="map-tool-tip">{formatMetres(total)}{legs.length > 2 && index < legs.length ? ` (+${Math.round(leg)})` : ''}</Tooltip>}
        </CircleMarker>
      ))}
      {value.sniperCenter && (
        <>
          <CircleMarker center={value.sniperCenter} radius={5} pathOptions={{ color: '#0b110d', weight: 1.5, fillColor: '#d0584a', fillOpacity: 1 }} interactive={false} />
          {rings.map((radius) => (
            <Circle key={radius} center={value.sniperCenter!} radius={radius} interactive={false} pathOptions={{ color: radius === value.sniperRange ? '#d0584a' : '#d0584a99', weight: radius === value.sniperRange ? 2.5 : 1, fill: radius === value.sniperRange, fillColor: '#d0584a', fillOpacity: 0.08, dashArray: radius === value.sniperRange ? undefined : '4 5' }} />
          ))}
          {rings.map((radius) => (
            <Marker key={`label-${radius}`} position={[value.sniperCenter![0] + radius, value.sniperCenter![1]]} icon={labelIcon(`${radius} м`, 'is-sniper')} interactive={false} keyboard={false} />
          ))}
        </>
      )}
    </>
  )
}
