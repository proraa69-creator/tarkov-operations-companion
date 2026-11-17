import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CRS, divIcon, latLngBounds, type LatLngBoundsExpression, type Map as LeafletMap } from 'leaflet'
import { MapContainer, Marker, Pane, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { useQuestChecks } from '../progression/questChecks'
import { useDeferredQuests } from '../progression/deferredQuests'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { floorBadge, floorsBottomUp, mainFloor } from '../data/mapProjection'
import { mapViewSupport } from '../data/mapView'
import { removedMineGroups } from '../data/removedMines'
import { markerImages } from '../assets/markerImages'
import { MarkerCanvasLayer, type CanvasPoint } from './MarkerCanvasLayer'
import { canvasMarkers, type SpriteSpec } from './markerSprites'
import { UNDERGROUND_LOCATIONS, WORLD_SIZE, labelPoint, locationAt, openingRect, pictureSize, rectsMeet, worldBounds, worldLatLng, worldTiles, type WorldPlacement, type WorldPoint } from './worldMap'
import { useSchemePicture, useStitchedTiles } from './worldMapPictures'
import { WorldPicturesLayer, type WorldPicture } from './WorldPicturesLayer'
import { worldPlacements, worldQuestPoints, type WorldQuestPoint } from './worldMapQuests'
import regionPicture from '../assets/world-map/region.webp'
import regionSatellite from '../assets/world-map/region-satellite.webp'
import type { GameMap, MapView } from '../domain/types'
import '../styles/worldMap.css'

/** The route of «Все локации» inside «Карты»: `/maps/world`. */
export const WORLD_MAP_ID = 'world'

const PIN_SIZE = 26
const PIN_SHADOW = 'drop-shadow(0 1px 2px rgb(0 0 0 / 75%)) drop-shadow(0 0 1px rgb(0 0 0 / 90%))'
const WORLD_RECT: [WorldPoint, WorldPoint] = [[0, 0], [WORLD_SIZE, WORLD_SIZE]]
const NO_IDS: ReadonlySet<string> = new Set()
/** How far past the whole map's zoom the close-up starts: the detailed pictures of what is in sight, and the floors. */
const CLOSE_UP = 0.75
/** Owner, 15.11.2026: «меня как будто отдаляет быстро»; «начинает приближаться к резерву». */
const ZOOM_OUT_SECONDS = 0.9
const ZOOM_IN_SECONDS = 0.8

const isItemPoint = (point: WorldQuestPoint) => point.marker.layerId === 'quest.item' || Boolean(point.marker.itemId)
const pinIcon = (item: boolean) => divIcon({
  className: 'world-quest-pin',
  html: `<img src="${item ? markerImages['quest.item'] : markerImages['quest.zone']}" alt="" width="${PIN_SIZE}" height="${PIN_SIZE}" draggable="false" />`,
  iconSize: [PIN_SIZE, PIN_SIZE],
  iconAnchor: [PIN_SIZE / 2, PIN_SIZE],
  tooltipAnchor: [0, -PIN_SIZE],
})
const PIN_ICONS = { zone: pinIcon(false), item: pinIcon(true) }

interface View { zoom: number; fitZoom: number; rect: [WorldPoint, WorldPoint] }
const isCloseUp = (view: View | null) => Boolean(view && view.zoom >= view.fitZoom + CLOSE_UP)
type LocationPictures = { light?: WorldPicture; detailed?: WorldPicture }

/**
 * «Все локации» (owner, 15.11.2026: «общая карта должна называться все локации… просто в этом же окне, ничего не меняя, должна
 * включиться вся локация Таркова»): our drawing of the region with our schemes laid into it, their edges faded into it, and the
 * current quests' points (src/maps/worldMap.ts), inside «Карты» in the place of a location's map.
 *
 * - From a location (`from`) it opens on that location and zooms out to the whole region («меня как будто отдаляет быстро»).
 * - A location to open (`target`, the list on the left or a name on the map) is flown to and handed back (`onArrive`); «Карты»
 *   then opens its own map («начинает приближаться к резерву, и включается… карта резерва»).
 * - «Схема» or «Спутник» (`view`): the schemes or the locations' renders on our drawing in the matching colours.
 * - The drawing and every picture are on one canvas (WorldPicturesLayer), so they never move apart while zooming.
 * - Close up, a press on a location shows its floors while it is in sight; the points are on one canvas glued to the map.
 */
export function WorldMapView({ from, target, view, phone, onArrive, onOpenLocation, onOpenPoint }: {
  from?: string | null
  target?: string | null
  view: MapView
  phone: boolean
  onArrive: (mapId: string) => void
  onOpenLocation: (mapId: string) => void
  onOpenPoint: (href: string) => void
}) {
  const { data } = useTarkovData()
  const state = useAppState()
  useLocale()
  const progress = state.activeProfile.modes[state.raidMode]
  const checked = useQuestChecks(state.activeProfile.id, state.raidMode)
  const loyalty = useTraderLoyalty()
  const deferred = useDeferredQuests(state.activeProfile.id, state.raidMode, progress.playerLevel, loyalty)
  const placements = useMemo(() => worldPlacements(data.maps), [data.maps])
  const points = useMemo(
    () => worldQuestPoints({ quests: data.quests, markers: data.markers, maps: data.maps, progress, checked, deferred, placements }),
    [data.quests, data.markers, data.maps, progress, checked, deferred, placements],
  )
  const placedMaps = useMemo(() => data.maps.filter((map) => placements.has(map.id)), [data.maps, placements])
  // the big locations drawn first, so a small one (Factory on Customs, Ground Zero on Streets) lies over them
  const drawOrder = useMemo(() => [...placedMaps].sort((a, b) => area(placements.get(b.id)!) - area(placements.get(a.id)!)), [placedMaps, placements])
  const [mapView, setMapView] = useState<View | null>(null)
  const [active, setActive] = useState<{ id: string; floor: string | null } | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [pictures, setPictures] = useState<Record<string, LocationPictures>>({})
  const mapName = (id: string) => uiText(data.maps.find((map) => map.id === id)?.name ?? id)

  // Close up: the detailed pictures of the locations in sight; a pressed one is on, with its floors, while it is in sight.
  const closeUp = isCloseUp(mapView)
  const onView = useCallback((next: View) => {
    setMapView(next)
    setActive((current) => {
      const placement = current ? placements.get(current.id) : undefined
      return current && isCloseUp(next) && placement && rectsMeet(placement.rect, next.rect) ? current : null
    })
  }, [placements])
  const activeMap = active ? data.maps.find((map) => map.id === active.id) : undefined
  const activeFloors = useMemo(() => (activeMap && (activeMap.floors?.length ?? 0) > 1 ? floorsBottomUp(activeMap) : []), [activeMap])
  const floorOf = (map: GameMap) => (map.id === active?.id && active.floor && map.floors?.includes(active.floor) ? active.floor : mainFloor(map))
  const pressAt = useCallback((at: WorldPoint) => {
    if (!closeUp) return
    const id = locationAt(placements.values(), at)
    setActive((current) => (current?.id === id ? current : id ? { id, floor: null } : null))
  }, [closeUp, placements])

  // The drawing first, then each location's light picture and its detailed one, the big locations under the small.
  const setLocationPictures = useCallback((id: string, next: LocationPictures) => {
    setPictures((current) => (current[id]?.light === next.light && current[id]?.detailed === next.detailed ? current : { ...current, [id]: next }))
  }, [])
  const drawn = useMemo<WorldPicture[]>(() => [
    { key: 'region', source: view === 'satellite' ? regionSatellite : regionPicture, rect: WORLD_RECT },
    ...drawOrder.flatMap((map) => [pictures[map.id]?.light, pictures[map.id]?.detailed].filter((picture): picture is WorldPicture => Boolean(picture))),
  ], [view, drawOrder, pictures])

  // The points on one canvas; the one under the pointer becomes a DOM pin with its tooltip and click.
  const pointId = (point: WorldQuestPoint) => `${point.mapId}:${point.marker.id}`
  const pointsById = useMemo(() => new Map(points.map((point) => [pointId(point), point])), [points])
  const canvasPoints = useMemo<CanvasPoint[]>(() => (canvasMarkers ? points.map((point) => {
    const map = data.maps.find((entry) => entry.id === point.mapId)
    const badge = map ? floorBadge(point.marker.floor, mainFloor(map)) : ''
    const spec: SpriteSpec = { src: isItemPoint(point) ? markerImages['quest.item'] : markerImages['quest.zone'], size: [PIN_SIZE, PIN_SIZE], anchor: [PIN_SIZE / 2, PIN_SIZE], filter: PIN_SHADOW, ...(badge ? { badge } : {}) }
    return { id: pointId(point), latlng: worldLatLng(point.world), spec }
  }) : []), [points, data.maps])
  const domPoints = canvasMarkers ? (hovered && pointsById.has(hovered) ? [pointsById.get(hovered)!] : []) : points
  const hiddenOnCanvas = useMemo(() => (hovered ? new Set([hovered]) : NO_IDS), [hovered])
  const openPoint = useCallback((id: string) => { const point = pointsById.get(id); if (point) onOpenPoint(point.href) }, [pointsById, onOpenPoint])

  const allBounds = useMemo(() => boundsOf(WORLD_RECT), [])
  const fromPlacement = from ? placements.get(from) : undefined
  const fromReady = !fromPlacement || Boolean(pictures[fromPlacement.mapId]?.light)
  // the flight into a location ends where its own map opens; the flight out starts there too
  const opening = useCallback((id: string) => {
    const placement = placements.get(id)
    const map = data.maps.find((entry) => entry.id === id)
    return placement && map ? { mapId: id, rect: openingRect(placement, map) } : undefined
  }, [placements, data.maps])
  const targetRect = useMemo(() => (target ? opening(target) : undefined), [target, opening])
  const startBounds = useMemo(() => { const start = from ? opening(from) : undefined; return start ? boundsOf(start.rect) : allBounds }, [from, opening, allBounds])

  return <div className="world-map-view">
    <MapContainer
      crs={CRS.Simple}
      bounds={startBounds}
      boundsOptions={{ padding: [20, 20] }}
      zoomSnap={0.25}
      minZoom={-3}
      maxZoom={2}
      maxBounds={worldBounds([[-400, -400], [WORLD_SIZE + 400, WORLD_SIZE + 400]])}
      maxBoundsViscosity={0.8}
      zoomControl={false}
      attributionControl={false}
      className="world-map-canvas"
    >
      <ZoomControl position={phone ? 'bottomright' : 'topright'} />
      <Flights all={allBounds} zoomOut={Boolean(fromPlacement)} ready={fromReady} targetId={target ?? null} target={targetRect} onArrive={onArrive} />
      <ViewWatch onChange={onView} onPress={pressAt} />
      <DevHandle />
      <Pane name="world-pictures" style={{ zIndex: 250 }}>
        <WorldPicturesLayer pictures={drawn} pane="world-pictures" />
      </Pane>
      {drawOrder.map((map) => {
        const placement = placements.get(map.id)!
        return <LocationPicturesOf key={map.id} map={map} placement={placement} floor={floorOf(map)} view={view} phone={phone}
          close={closeUp && Boolean(mapView) && rectsMeet(placement.rect, mapView!.rect)} onChange={setLocationPictures} />
      })}
      {canvasMarkers && <MarkerCanvasLayer points={canvasPoints} hidden={hiddenOnCanvas} interactive onHover={setHovered} onPick={openPoint} />}
      {domPoints.map((point) => (
        <Marker key={pointId(point)} position={worldLatLng(point.world)} icon={isItemPoint(point) ? PIN_ICONS.item : PIN_ICONS.zone} zIndexOffset={1000}
          eventHandlers={{ click: () => onOpenPoint(point.href), add: (event) => { if (canvasMarkers) event.target.openTooltip() } }}>
          <Tooltip direction="top" opacity={1}>
            <strong>{uiText(point.quest.name)}</strong>
            <br />
            <span>{mapName(point.mapId)}{point.marker.title && point.marker.title !== point.quest.name ? ` · ${uiText(point.marker.title)}` : ''}</span>
          </Tooltip>
        </Marker>
      ))}
      {/* the names over the quest points; a press flies to the location and opens its map */}
      <Pane name="world-labels" style={{ zIndex: 640 }}>
        {placedMaps.map((map) => <LocationLabel key={map.id} map={map} placement={placements.get(map.id)!} onOpen={() => onOpenLocation(map.id)} />)}
      </Pane>
    </MapContainer>
    {activeMap && activeFloors.length > 1 && (
      <div className="world-map-floors" role="group" aria-label={uiText('Этажи')}>
        <span className="world-map-floors-title">{uiText(activeMap.name)}</span>
        {activeFloors.map((entry) => (
          <button key={entry} type="button" className={`button small ${floorOf(activeMap) === entry ? 'primary' : 'ghost'}`}
            onClick={() => setActive({ id: activeMap.id, floor: entry })}>
            {uiText(entry)}
          </button>
        ))}
      </div>
    )}
  </div>
}

/**
 * One location's pictures for the canvas: its scheme («Схема»), or its render tiles in one picture («Спутник», and Labs, which
 * have no scheme), edges faded — a light picture always, a detailed one while it is close up and in sight (owner: «карта лагает»).
 */
function LocationPicturesOf({ map, placement, floor, view, close, phone, onChange }: {
  map: GameMap; placement: WorldPlacement; floor: string; view: MapView; close: boolean; phone: boolean
  onChange: (mapId: string, pictures: LocationPictures) => void
}) {
  const layers = useMemo(() => map.layers ?? [], [map.layers])
  const removed = removedMineGroups(map.id)
  const support = mapViewSupport(map)
  const tiles = view === 'satellite' ? support.satellite : !support.digital
  const [lightWidth, lightHeight] = pictureSize(placement, false, phone)
  const [closeWidth, closeHeight] = pictureSize(placement, true, phone)
  const scheme = tiles ? undefined : map.imageUrl
  // a location with no render on «Спутник» (Terminal) shows its scheme in the renders' colours
  const light = useSchemePicture(scheme, layers, floor, removed, lightWidth, lightHeight, view === 'satellite')
  const detailed = useSchemePicture(scheme, layers, floor, removed, close ? closeWidth : 0, closeHeight, view === 'satellite')
  // the floor's own render tiles, else the main render
  const tileMap = useMemo(() => ({ ...map, tileUrl: map.layers?.find((layer) => layer.name === floor)?.tileUrl ?? map.tileUrl }), [map, floor])
  const lightTiles = useMemo(() => (tiles ? worldTiles(tileMap, placement, Math.max(lightWidth, lightHeight)) : []), [tiles, tileMap, placement, lightWidth, lightHeight])
  const closeTiles = useMemo(() => (tiles && close ? worldTiles(tileMap, placement, Math.max(closeWidth, closeHeight)) : []), [tiles, close, tileMap, placement, closeWidth, closeHeight])
  const lightStitched = useStitchedTiles(lightTiles, map.tileSize ?? 256)
  const closeStitched = useStitchedTiles(closeTiles, map.tileSize ?? 256)
  const lightPicture = useMemo<WorldPicture | undefined>(() => (tiles
    ? lightStitched ? { key: `${map.id}:tiles-light`, source: lightStitched.canvas, rect: lightStitched.rect } : undefined
    : light ? { key: `${map.id}:light`, source: light, rect: placement.rect } : undefined), [tiles, lightStitched, light, map.id, placement.rect])
  const detailedPicture = useMemo<WorldPicture | undefined>(() => (tiles
    ? closeStitched ? { key: `${map.id}:tiles-close`, source: closeStitched.canvas, rect: closeStitched.rect } : undefined
    : detailed ? { key: `${map.id}:close`, source: detailed, rect: placement.rect } : undefined), [tiles, closeStitched, detailed, map.id, placement.rect])
  useEffect(() => { onChange(map.id, { ...(lightPicture ? { light: lightPicture } : {}), ...(detailedPicture ? { detailed: detailedPicture } : {}) }) }, [map.id, lightPicture, detailedPicture, onChange])
  return null
}

/** The location's name on the map; a press flies to it and opens its own map. */
function LocationLabel({ map, placement, onOpen }: { map: GameMap; placement: WorldPlacement; onOpen: () => void }) {
  const label = useMemo(() => divIcon({
    className: 'world-map-label',
    html: `<span style="--accent:${escapeAttr(map.accent)}">${escapeHtml(uiText(map.name))}${UNDERGROUND_LOCATIONS.has(map.id) ? ` <small>${escapeHtml(uiText('под землёй'))}</small>` : ''}</span>`,
    iconSize: [0, 0],
  }), [map.accent, map.name, map.id])
  return <Marker position={worldLatLng(labelPoint(placement))} icon={label} pane="world-labels" eventHandlers={{ click: onOpen }} title={uiText('Открыть карту локации')} />
}

/** The zoom and the part of the map in sight, once a move or zoom ends; a press on the map, as a point of the drawing. */
function ViewWatch({ onChange, onPress }: { onChange: (view: View) => void; onPress: (at: WorldPoint) => void }) {
  const report = (map: LeafletMap) => {
    const bounds = map.getBounds()
    onChange({
      zoom: map.getZoom(),
      fitZoom: map.getBoundsZoom(worldBounds(WORLD_RECT)),
      rect: [[bounds.getWest(), -bounds.getNorth()], [bounds.getEast(), -bounds.getSouth()]],
    })
  }
  const map = useMapEvents({
    moveend: () => report(map), zoomend: () => report(map), resize: () => report(map),
    click: (event) => onPress([event.latlng.lng, -event.latlng.lat]),
  })
  useEffect(() => { report(map) }, [map]) // eslint-disable-line react-hooks/exhaustive-deps -- once, as the map is made
  return null
}

/**
 * The flights: from a location out to the whole region once its picture is there (at most a moment later), and into a location
 * asked for, handed back when there. A new size of the map (the window, the panes) fits the whole region again.
 */
/** The dev build only: the map for checks from the console and the recording scripts. */
function DevHandle() {
  const map = useMap()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __worldMap?: LeafletMap }).__worldMap = map
  }, [map])
  return null
}

function Flights({ all, zoomOut, ready, targetId, target, onArrive }: { all: LatLngBoundsExpression; zoomOut: boolean; ready: boolean; targetId: string | null; target?: { mapId: string; rect: [WorldPoint, WorldPoint] }; onArrive: (mapId: string) => void }) {
  const map = useMap()
  const zoomedOut = useRef(!zoomOut)
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    if (zoomedOut.current) return
    const timer = window.setTimeout(() => setWaited(true), 600)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (zoomedOut.current || target || !(ready || waited)) return
    zoomedOut.current = true
    map.flyToBounds(all, { padding: [20, 20], duration: ZOOM_OUT_SECONDS, maxZoom: 2 })
  }, [map, all, ready, waited, target])
  const arrive = useRef(onArrive)
  useEffect(() => { arrive.current = onArrive }, [onArrive])
  // a location with no place on the drawing (Ледокол) opens at once
  useEffect(() => {
    if (targetId && !target) arrive.current(targetId)
  }, [targetId, target])
  useEffect(() => {
    if (!target) return
    zoomedOut.current = true
    let done = false
    const finish = () => { if (!done) { done = true; arrive.current(target.mapId) } }
    map.once('moveend', finish)
    map.flyToBounds(boundsOf(target.rect), { padding: [20, 20], duration: ZOOM_IN_SECONDS, maxZoom: 2 })
    // a flight to where the map already is fires no move: open it anyway
    const timer = window.setTimeout(finish, ZOOM_IN_SECONDS * 1000 + 400)
    return () => { map.off('moveend', finish); window.clearTimeout(timer) }
  }, [map, target])
  useEffect(() => {
    const element = map.getContainer()
    if (typeof ResizeObserver === 'undefined') return
    let size = `${element.clientWidth}x${element.clientHeight}`
    const observer = new ResizeObserver(() => {
      const next = `${element.clientWidth}x${element.clientHeight}`
      if (next === size || !element.clientWidth || !element.clientHeight) return
      size = next
      map.invalidateSize()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [map])
  return null
}

const area = ({ rect: [[x1, y1], [x2, y2]] }: WorldPlacement) => (x2 - x1) * (y2 - y1)

function boundsOf(world: readonly WorldPoint[], pad = 0): LatLngBoundsExpression {
  if (!world.length) return [[0, 0], [1, 1]]
  const xs = world.map(([x]) => x)
  const ys = world.map(([, y]) => y)
  const box: [WorldPoint, WorldPoint] = [[Math.min(...xs) - pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.max(...ys) + pad]]
  return latLngBounds(worldBounds(box))
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
const escapeAttr = (text: string) => escapeHtml(text).replace(/[;{}]/g, '')
