import { uiText } from '../i18n/renderText'
import { useEffect, useMemo } from 'react'
import { divIcon } from 'leaflet'
import { ImageOverlay, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import type { GameMap } from '../domain/types'
import { createMapCrs, toLeafletBounds } from './mapCrs'

interface MarkerMiniMapProps {
  map: GameMap
  position: [number, number]
  color: string
}

const ZOOM_IN_STEPS = 2.5

export function MarkerMiniMap({ map, position, color }: MarkerMiniMapProps) {
  const bounds = toLeafletBounds(map)
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
        {uiText(map.imageUrl && !map.tileUrl && <ImageOverlay url={map.imageUrl} bounds={bounds} />)}
        {uiText(map.tileUrl && (
          <TileLayer
            url={map.tileUrl}
            bounds={bounds}
            tileSize={map.tileSize ?? 256}
            minZoom={-5}
            minNativeZoom={map.minZoom}
            maxZoom={Math.max(7, map.maxZoom ?? 3)}
            maxNativeZoom={map.maxZoom}
            noWrap
          />
        ))}
        <CenterOn position={position} />
        <Marker position={position} icon={icon} interactive={false} keyboard={false} />
      </MapContainer>
    </div>
  )
}

function CenterOn({ position }: { position: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    const zoom = Math.min(map.getZoom() + ZOOM_IN_STEPS, map.getMaxZoom())
    map.setView(position, zoom, { animate: false })
  }, [map, position])
  return null
}
