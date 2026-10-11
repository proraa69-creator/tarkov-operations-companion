import { useMemo } from 'react'
import { Pane, TileLayer } from 'react-leaflet'
import { FloorSvgOverlay } from './FloorSvgOverlay'
import { toLeafletBounds } from './mapCrs'
import { mainFloor } from '../data/mapProjection'
import type { MapLayerPlan } from '../data/mapView'
import type { GameMap, MapFloorLayer } from '../domain/types'

/** One array for maps without layers: a new `[]` on every render would make FloorSvgOverlay redo its picture. */
const NO_LAYERS: MapFloorLayer[] = []

/**
 * The drawing of a map with one floor shown, as planMapLayers plans it: the render tiles («Спутник») or the SVG scheme
 * («Схема»), with the floor's own tiles or its plan on top. Shared by the Maps page and the in-game minimap, so a floor
 * looks the same in both.
 */
export function MapFloorLayers({ map, plan, floor }: { map: GameMap; plan: MapLayerPlan; floor: string }) {
  const baseFloor = mainFloor(map)
  const layers = map.layers ?? NO_LAYERS
  // Stable between renders (the minimap re-renders every second): new bounds would reposition the picture each time.
  const bounds = useMemo(() => toLeafletBounds(map), [map])
  const imageBounds = useMemo(() => (plan.imageBounds ? toLeafletBounds({ ...map, bounds: plan.imageBounds }) : bounds), [map, plan.imageBounds, bounds])
  const baseOpacity = plan.dimBase ? 0.45 : 1
  const { tileUrl, imageUrl, floorTileUrl } = plan
  return (
    <>
      {/* Digital: the SVG scheme with the ground level (or the selected SVG floor) shown. */}
      {plan.view === 'digital' && imageUrl && (
        <FloorSvgOverlay key={`base:${imageUrl}`} base url={imageUrl} layers={layers} selected={plan.floorSvg ? floor : baseFloor} bounds={imageBounds} opacity={baseOpacity} />
      )}
      {/* Satellite: the scheme under the render tiles, so a gap in a tile shows the plan instead of black. */}
      {plan.view === 'satellite' && imageUrl && plan.underlay && (
        <Pane name="satellite-underlay" style={{ zIndex: 150 }}>
          <FloorSvgOverlay key={`under:${imageUrl}`} base url={imageUrl} layers={layers} selected={baseFloor} bounds={imageBounds} opacity={baseOpacity} />
        </Pane>
      )}
      {/* Satellite, main level: the buildings' ground-floor rooms from the scheme (the render leaves them black). */}
      {plan.view === 'satellite' && imageUrl && plan.groundInteriors && (
        <FloorSvgOverlay key={`rooms:${imageUrl}`} url={imageUrl} layers={layers} selected={baseFloor} bounds={imageBounds} interiors />
      )}
      {/* Satellite: a floor that only exists in the SVG is drawn as a plan over the render. */}
      {plan.view === 'satellite' && imageUrl && plan.floorSvg === 'floor-only' && (
        <FloorSvgOverlay key={`floor:${imageUrl}`} url={imageUrl} layers={layers} selected={floor} bounds={imageBounds} terrain={false} />
      )}
      {plan.view === 'satellite' && tileUrl && (
        <TileLayer
          key={tileUrl}
          url={tileUrl}
          opacity={baseOpacity}
          bounds={bounds}
          tileSize={map.tileSize ?? 256}
          minZoom={-5}
          minNativeZoom={map.minZoom}
          maxZoom={Math.max(7, map.maxZoom ?? 3)}
          maxNativeZoom={map.maxZoom}
          noWrap
        />
      )}
      {floorTileUrl && (
        <TileLayer
          key={floorTileUrl}
          url={floorTileUrl}
          bounds={bounds}
          tileSize={map.tileSize ?? 256}
          minZoom={-5}
          minNativeZoom={map.minZoom}
          maxZoom={Math.max(7, map.maxZoom ?? 3)}
          maxNativeZoom={map.maxZoom}
          zIndex={2}
          noWrap
        />
      )}
    </>
  )
}
