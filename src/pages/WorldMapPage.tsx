import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CRS, divIcon, latLngBounds, type LatLngBoundsExpression } from 'leaflet'
import { ImageOverlay, MapContainer, Marker, Pane, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import { ArrowLeft } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { useQuestChecks } from '../progression/questChecks'
import { useDeferredQuests } from '../progression/deferredQuests'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { floorBadge, floorsBottomUp, mainFloor } from '../data/mapProjection'
import { removedMineGroups } from '../data/removedMines'
import { markerImages } from '../assets/markerImages'
import { MarkerCanvasLayer, type CanvasPoint } from '../maps/MarkerCanvasLayer'
import { canvasMarkers, type SpriteSpec } from '../maps/markerSprites'
import { UNDERGROUND_LOCATIONS, WORLD_SIZE, labelPoint, locationAt, pictureSize, rectsMeet, worldBounds, worldLatLng, worldTiles, type WorldPlacement, type WorldPoint } from '../maps/worldMap'
import { useSchemePicture, useStitchedTiles } from '../maps/worldMapPictures'
import regionPicture from '../assets/world-map/region.webp'
import { worldPlacements, worldQuestPoints, type WorldQuestPoint } from '../maps/worldMapQuests'
import type { GameMap } from '../domain/types'
import '../styles/worldMap.css'

const PIN_SIZE = 26
const PIN_SHADOW = 'drop-shadow(0 1px 2px rgb(0 0 0 / 75%)) drop-shadow(0 0 1px rgb(0 0 0 / 90%))'
const WORLD_RECT: [WorldPoint, WorldPoint] = [[0, 0], [WORLD_SIZE, WORLD_SIZE]]
const NO_IDS: ReadonlySet<string> = new Set()
/** How far past the whole map's zoom the close-up starts: the detailed pictures of what is in sight, and the floors. */
const CLOSE_UP = 0.75

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

/**
 * «Общая карта»: our drawing of the region with our schemes laid into it, their edges faded into the drawing (owner:
 * «плавный переход карт, чтобы не было резких границ»), and the current quests' points (src/maps/worldMap.ts).
 * The points are drawn on one canvas glued to the map (owner, 15.11.2026: «при увеличении, чтобы маркеры не прыгали»);
 * close up, the location in the middle of the view gets its floors (owner: «если открыта вся карта, этажи не переключаются…
 * как только приближаешь чуть-чуть… появляется кнопка этажей»).
 */
export function WorldMapPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  useLocale()
  const navigate = useNavigate()
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
  const [mapFilter, setMapFilter] = useState<string | null>(null)
  const [questFilter, setQuestFilter] = useState<string | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [floors, setFloors] = useState<Record<string, string>>({})
  const [hovered, setHovered] = useState<string | null>(null)

  const questRows = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; maps: Set<string> }>()
    for (const point of points) {
      if (mapFilter && point.mapId !== mapFilter) continue
      const row = rows.get(point.quest.id) ?? { id: point.quest.id, name: point.quest.name, maps: new Set<string>() }
      row.maps.add(point.mapId)
      rows.set(point.quest.id, row)
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [points, mapFilter])
  const shownPoints = useMemo(() => points.filter((point) => (!mapFilter || point.mapId === mapFilter) && (!questFilter || point.quest.id === questFilter)), [points, mapFilter, questFilter])
  const mapName = (id: string) => uiText(data.maps.find((map) => map.id === id)?.name ?? id)

  // Close up: the detailed pictures of the locations in sight, and the floors of the one in the middle.
  const closeUp = Boolean(view && view.zoom >= view.fitZoom + CLOSE_UP)
  const centre: WorldPoint | null = view ? [(view.rect[0][0] + view.rect[1][0]) / 2, (view.rect[0][1] + view.rect[1][1]) / 2] : null
  const focusId = closeUp && centre ? locationAt(placements.values(), centre) : null
  const focusMap = focusId ? data.maps.find((map) => map.id === focusId) : undefined
  const focusFloors = useMemo(() => (focusMap && (focusMap.floors?.length ?? 0) > 1 ? floorsBottomUp(focusMap) : []), [focusMap])
  const floorOf = (map: GameMap) => (map.id === focusId && floors[map.id] && map.floors?.includes(floors[map.id]!) ? floors[map.id]! : mainFloor(map))

  // The points on one canvas; the one under the pointer becomes a DOM pin with its tooltip and click.
  const pointId = (point: WorldQuestPoint) => `${point.mapId}:${point.marker.id}`
  const pointsById = useMemo(() => new Map(shownPoints.map((point) => [pointId(point), point])), [shownPoints])
  const canvasPoints = useMemo<CanvasPoint[]>(() => (canvasMarkers ? shownPoints.map((point) => {
    const map = data.maps.find((entry) => entry.id === point.mapId)
    const badge = map ? floorBadge(point.marker.floor, mainFloor(map)) : ''
    const spec: SpriteSpec = { src: isItemPoint(point) ? markerImages['quest.item'] : markerImages['quest.zone'], size: [PIN_SIZE, PIN_SIZE], anchor: [PIN_SIZE / 2, PIN_SIZE], filter: PIN_SHADOW, ...(badge ? { badge } : {}) }
    return { id: pointId(point), latlng: worldLatLng(point.world), spec }
  }) : []), [shownPoints, data.maps])
  const domPoints = canvasMarkers ? (hovered && pointsById.has(hovered) ? [pointsById.get(hovered)!] : []) : shownPoints
  const hiddenOnCanvas = useMemo(() => (hovered ? new Set([hovered]) : NO_IDS), [hovered])
  const openPoint = useCallback((id: string) => { const point = pointsById.get(id); if (point) navigate(point.href) }, [pointsById, navigate])

  // The whole canvas, and what the filters leave to fly to.
  const allBounds = useMemo(() => boundsOf(WORLD_RECT), [])
  const focusBounds = useMemo(() => {
    if (questFilter) return boundsOf(points.filter((point) => point.quest.id === questFilter && (!mapFilter || point.mapId === mapFilter)).map((point) => point.world), 120)
    if (mapFilter) {
      const placement = placements.get(mapFilter)
      return placement ? boundsOf(placement.rect) : undefined
    }
    return undefined
  }, [questFilter, mapFilter, points, placements])

  const pickMap = (id: string | null) => {
    setMapFilter(id)
    if (id && questFilter && !points.some((point) => point.quest.id === questFilter && point.mapId === id)) setQuestFilter(null)
  }

  return <div className="page map-page world-map-page">
    <div className="map-shell world-map-shell">
      <aside className="map-sidebar world-map-sidebar">
        <Link to="/maps" className="button world-map-back"><ArrowLeft size={14} aria-hidden="true" /><span>{uiText('Карты')}</span></Link>
        <div className="map-side-title">{uiText('ЛОКАЦИИ')}</div>
        <button type="button" className={`map-option${mapFilter ? '' : ' active'}`} onClick={() => pickMap(null)}>
          <span className="map-color" style={{ background: '#d5b76f' }} />
          <span>{uiText('Все локации')}</span>
        </button>
        {placedMaps.map((map) => (
          <button key={map.id} type="button" className={`map-option${mapFilter === map.id ? ' active' : ''}`} onClick={() => pickMap(mapFilter === map.id ? null : map.id)}>
            <span className="map-color" style={{ background: map.accent }} />
            <span>{uiText(map.name)}</span>
          </button>
        ))}
        <div className="map-side-title world-map-quests-title">{uiText('ТЕКУЩИЕ ЗАДАНИЯ')}</div>
        {questRows.length === 0 && <p className="world-map-note">{uiText('Нет точек текущих заданий')}</p>}
        <div className="world-map-quests">
          {questRows.map((row) => (
            <button key={row.id} type="button" className={`world-map-quest${questFilter === row.id ? ' active' : ''}`} onClick={() => setQuestFilter(questFilter === row.id ? null : row.id)}>
              <span className="world-map-quest-name">{uiText(row.name)}</span>
              <small>{[...row.maps].map(mapName).join(', ')}</small>
            </button>
          ))}
        </div>
      </aside>
      <section className="map-stage world-map-stage">
        <MapContainer
          crs={CRS.Simple}
          bounds={allBounds}
          boundsOptions={{ padding: [20, 20] }}
          zoomSnap={0.25}
          minZoom={-3}
          maxZoom={2}
          zoomDelta={0.5}
          wheelPxPerZoomLevel={120}
          maxBounds={worldBounds([[-400, -400], [WORLD_SIZE + 400, WORLD_SIZE + 400]])}
          maxBoundsViscosity={0.8}
          zoomControl={false}
          attributionControl={false}
          className="world-map-canvas"
        >
          <ZoomControl position="topright" />
          <FlyTo bounds={focusBounds ?? allBounds} />
          <ViewWatch onChange={setView} />
          <Pane name="world-drawing" style={{ zIndex: 250 }}>
            <ImageOverlay url={regionPicture} bounds={worldBounds(WORLD_RECT)} className="world-map-drawing" />
          </Pane>
          {drawOrder.map((map, index) => {
            const placement = placements.get(map.id)!
            return <Pane key={map.id} name={`world-${map.id}`} style={{ zIndex: 300 + index }}>
              <LocationLayer map={map} placement={placement} floor={floorOf(map)} close={closeUp && Boolean(view) && rectsMeet(placement.rect, view!.rect)} />
            </Pane>
          })}
          {canvasMarkers && <MarkerCanvasLayer points={canvasPoints} hidden={hiddenOnCanvas} interactive onHover={setHovered} onPick={openPoint} />}
          {domPoints.map((point) => (
            <Marker key={pointId(point)} position={worldLatLng(point.world)} icon={isItemPoint(point) ? PIN_ICONS.item : PIN_ICONS.zone} zIndexOffset={1000}
              eventHandlers={{ click: () => navigate(point.href), add: (event) => { if (canvasMarkers) event.target.openTooltip() } }}>
              <Tooltip direction="top" opacity={1}>
                <strong>{uiText(point.quest.name)}</strong>
                <br />
                <span>{mapName(point.mapId)}{point.marker.title && point.marker.title !== point.quest.name ? ` · ${uiText(point.marker.title)}` : ''}</span>
              </Tooltip>
            </Marker>
          ))}
          {/* the names over the quest points */}
          <Pane name="world-labels" style={{ zIndex: 640 }}>
            {placedMaps.map((map) => <LocationLabel key={map.id} map={map} placement={placements.get(map.id)!} onOpen={() => navigate(`/maps/${map.id}`)} />)}
          </Pane>
        </MapContainer>
        {focusMap && focusFloors.length > 1 && (
          <div className="world-map-floors" role="group" aria-label={uiText('Этажи')}>
            <span className="world-map-floors-title">{uiText(focusMap.name)}</span>
            {focusFloors.map((entry) => (
              <button key={entry} type="button" className={`button small ${floorOf(focusMap) === entry ? 'primary' : 'ghost'}`}
                onClick={() => setFloors((current) => ({ ...current, [focusMap.id]: entry }))}>
                {uiText(entry)}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  </div>
}

/**
 * One location in the drawing: its scheme (a location without one: its tiles in one picture), edges faded — a light picture
 * always, a detailed one on top while it is close up and in sight (owner: «карта лагает»).
 */
function LocationLayer({ map, placement, floor, close }: { map: GameMap; placement: WorldPlacement; floor: string; close: boolean }) {
  const bounds = useMemo(() => worldBounds(placement.rect), [placement])
  const layers = useMemo(() => map.layers ?? [], [map.layers])
  const removed = removedMineGroups(map.id)
  const [lightWidth, lightHeight] = pictureSize(placement, false)
  const [closeWidth, closeHeight] = pictureSize(placement, true)
  const light = useSchemePicture(map.imageUrl, layers, floor, removed, lightWidth, lightHeight)
  const detailed = useSchemePicture(map.imageUrl, layers, floor, removed, close ? closeWidth : 0, closeHeight)
  // a scheme-less location (Labs): the floor's own tiles
  const tileMap = useMemo(() => ({ ...map, tileUrl: map.layers?.find((layer) => layer.name === floor)?.tileUrl ?? map.tileUrl }), [map, floor])
  const lightTiles = useMemo(() => (map.imageUrl ? [] : worldTiles(tileMap, placement, Math.max(lightWidth, lightHeight))), [map.imageUrl, tileMap, placement, lightWidth, lightHeight])
  const closeTiles = useMemo(() => (map.imageUrl || !close ? [] : worldTiles(tileMap, placement, Math.max(closeWidth, closeHeight))), [map.imageUrl, close, tileMap, placement, closeWidth, closeHeight])
  const lightStitched = useStitchedTiles(lightTiles, map.tileSize ?? 256)
  const closeStitched = useStitchedTiles(closeTiles, map.tileSize ?? 256)
  if (map.imageUrl) {
    return <>
      {light && <ImageOverlay url={light} bounds={bounds} />}
      {detailed && <ImageOverlay url={detailed} bounds={bounds} />}
    </>
  }
  return <>
    {lightStitched && <ImageOverlay url={lightStitched.url} bounds={worldBounds(lightStitched.rect)} />}
    {closeStitched && <ImageOverlay url={closeStitched.url} bounds={worldBounds(closeStitched.rect)} />}
  </>
}

/** The location's name on the map; a press opens its own map. */
function LocationLabel({ map, placement, onOpen }: { map: GameMap; placement: WorldPlacement; onOpen: () => void }) {
  const label = useMemo(() => divIcon({
    className: 'world-map-label',
    html: `<span style="--accent:${escapeAttr(map.accent)}">${escapeHtml(uiText(map.name))}${UNDERGROUND_LOCATIONS.has(map.id) ? ` <small>${escapeHtml(uiText('под землёй'))}</small>` : ''}</span>`,
    iconSize: [0, 0],
  }), [map.accent, map.name, map.id])
  return <Marker position={worldLatLng(labelPoint(placement))} icon={label} pane="world-labels" eventHandlers={{ click: onOpen }} title={uiText('Открыть карту локации')} />
}

/** The zoom and the part of the map in sight, once a move or zoom ends. */
function ViewWatch({ onChange }: { onChange: (view: View) => void }) {
  const report = (map: ReturnType<typeof useMap>) => {
    const bounds = map.getBounds()
    onChange({
      zoom: map.getZoom(),
      fitZoom: map.getBoundsZoom(worldBounds(WORLD_RECT)),
      rect: [[bounds.getWest(), -bounds.getNorth()], [bounds.getEast(), -bounds.getSouth()]],
    })
  }
  const map = useMapEvents({ moveend: () => report(map), zoomend: () => report(map), resize: () => report(map) })
  useEffect(() => { report(map) }, [map]) // eslint-disable-line react-hooks/exhaustive-deps -- once, as the map is made
  return null
}

/** Flies to what the filters leave; a new size of the map (the window, the panes) fits it again. */
function FlyTo({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap()
  const key = JSON.stringify(bounds)
  const latest = useRef(bounds)
  useEffect(() => {
    latest.current = bounds
    map.flyToBounds(bounds, { padding: [40, 40], duration: 0.5, maxZoom: 2 })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` stands for `bounds`
  useEffect(() => {
    const element = map.getContainer()
    if (typeof ResizeObserver === 'undefined') return
    let size = `${element.clientWidth}x${element.clientHeight}`
    const observer = new ResizeObserver(() => {
      const next = `${element.clientWidth}x${element.clientHeight}`
      if (next === size || !element.clientWidth || !element.clientHeight) return
      size = next
      map.invalidateSize()
      map.fitBounds(latest.current, { padding: [40, 40], maxZoom: 2 })
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
