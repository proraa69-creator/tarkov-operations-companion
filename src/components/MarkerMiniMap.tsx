import { uiText } from '../i18n/renderText'
import { useEffect, useMemo } from 'react'
import { divIcon } from 'leaflet'
import { MapContainer, Marker, useMap } from 'react-leaflet'
import type { GameMap, MapView } from '../domain/types'
import { createMapCrs, toLeafletBounds } from './mapCrs'
import { planMapLayers } from '../data/mapView'
import { MapFloorLayers } from './MapFloorLayers'
import { mainFloor } from '../data/mapProjection'

interface MarkerMiniMapProps {
  map: GameMap
  /** The player's «Вид карты» choice (falls back to what the map has). */
  view?: MapView
  /**
   * The point's floor (MapMarker.floor). The preview draws that floor exactly as the main map does — the floor's own
   * render or plan — so a point on «3 этаж» is not shown on the ground floor (owner, 12.10.2026: «на этих маленьких
   * картах… должен быть правильный этаж как указано в квесте»). The ground level without one.
   */
  floor?: string
  position: [number, number]
  color: string
}

/** The preview shows the spot as close as the main map can: the map's most detailed tiles. */
function previewZoom(map: Pick<GameMap, 'maxZoom'>) {
  return map.maxZoom ?? 3
}

export function MarkerMiniMap({ map, view = 'satellite', floor, position, color }: MarkerMiniMapProps) {
  const bounds = toLeafletBounds(map)
  const level = floor && map.layers?.some((layer) => layer.name === floor) ? floor : mainFloor(map)
  const plan = useMemo(() => planMapLayers(map, view, level), [map, view, level])
  const crs = useMemo(() => createMapCrs(map), [map])
  const icon = useMemo(() => divIcon({
    className: 'marker-icon',
    html: `<div class="mini-map-pin" style="--marker-color:${color}"><span></span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  }), [color])

  return (
    <div className="mini-map" aria-label={uiText("Примерное место на карте")}>
      <MapContainer
        key={`${map.id}:${level}:${position.join(',')}`}
        crs={crs}
        bounds={bounds}
        zoomSnap={0.25}
        minZoom={Math.min(-5, map.minZoom ?? -1)}
        maxZoom={Math.max(7, map.maxZoom ?? 3)}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
      >
        <MapFloorLayers map={map} plan={plan} floor={level} />
        <CenterOn position={position} zoom={previewZoom(map)} />
        <Marker position={position} icon={icon} interactive={false} keyboard={false} />
      </MapContainer>
    </div>
  )
}

function CenterOn({ position, zoom }: { position: [number, number]; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView(position, Math.min(zoom, map.getMaxZoom()), { animate: false })
  }, [map, position, zoom])
  return null
}
