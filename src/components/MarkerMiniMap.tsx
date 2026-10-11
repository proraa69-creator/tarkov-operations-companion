import { uiText } from '../i18n/renderText'
import { useEffect, useMemo } from 'react'
import { divIcon } from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import type { GameMap, MapView } from '../domain/types'
import { createMapCrs, toLeafletBounds } from './mapCrs'
import { planMapLayers } from '../data/mapView'
import { FloorSvgOverlay } from './FloorSvgOverlay'
import { mainFloor } from '../data/mapProjection'

interface MarkerMiniMapProps {
  map: GameMap
  /** The player's «Вид карты» choice (falls back to what the map has). */
  view?: MapView
  position: [number, number]
  color: string
}

/** The preview shows the spot as close as the main map can: the map's most detailed tiles. */
function previewZoom(map: Pick<GameMap, 'maxZoom'>) {
  return map.maxZoom ?? 3
}

export function MarkerMiniMap({ map, view = 'satellite', position, color }: MarkerMiniMapProps) {
  const bounds = toLeafletBounds(map)
  const plan = planMapLayers(map, view, mainFloor(map))
  const imageBounds = plan.imageBounds ? toLeafletBounds({ ...map, bounds: plan.imageBounds }) : bounds
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
        key={`${map.id}:${position.join(',')}`}
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
        {plan.view === 'digital' && plan.imageUrl && <FloorSvgOverlay key={plan.imageUrl} base url={plan.imageUrl} layers={map.layers ?? []} selected={mainFloor(map)} bounds={imageBounds} />}
        {plan.view === 'satellite' && plan.tileUrl && (
          <TileLayer
            key={plan.tileUrl}
            url={plan.tileUrl}
            bounds={bounds}
            tileSize={map.tileSize ?? 256}
            minZoom={-5}
            minNativeZoom={map.minZoom}
            maxZoom={Math.max(7, map.maxZoom ?? 3)}
            maxNativeZoom={map.maxZoom}
            noWrap
          />
        )}
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
