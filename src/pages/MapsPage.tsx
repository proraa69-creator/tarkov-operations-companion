import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { divIcon, point as leafletPoint, type DivIcon, type Map as LeafletMap, type Marker as LeafletMarker, type PointExpression, type Tooltip as LeafletTooltip } from 'leaflet'
import { MapContainer, Marker, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AlertTriangle, ArrowRightLeft, Box, Building2, ChevronDown, ChevronRight, CircleDot, Crosshair, Diamond, DoorOpen,
  FileText, FlaskConical, HeartPulse, KeyRound, Layers, MapPin, Search, Skull, Target, TentTree, Users, Wrench, X,
} from 'lucide-react'
import { markerImages } from '../assets/markerImages'
import { newMarkerImages } from '../assets/map-markers-new'
import { bossBust } from '../assets/bossBusts'
import { useTarkovData } from '../data/DataProvider'
import { floorBadge, floorLabel, mainFloor, markerVisibleOnFloor } from '../data/mapProjection'
import { resolveBossInfo, useBossProfiles } from '../data/bosses'
import { MapMarkerTooltip } from '../components/MapMarkerTooltip'
import { MarkerMiniMap } from '../components/MarkerMiniMap'
import { FloorSvgOverlay } from '../components/FloorSvgOverlay'
import { LivePlayerMarker } from '../components/LivePlayerMarker'
import { MapToolLayer, MapToolbar, initialMapTools, type MapToolsState } from '../components/MapTools'
import { chooseTooltipPlacement, type Box as PlacementBox } from '../components/tooltipPlacement'
import { createMapCrs, toLeafletBounds } from '../components/mapCrs'
import { mapViewSupport, planMapLayers, readMapView, saveMapView } from '../data/mapView'
import '../styles/mapView.css'
import { useAppState } from '../state/AppState'
import type { GameMap, Item, MapMarker, MapView, MarkerLayerId, ModeProgress, Quest, TaskProgressStatus } from '../domain/types'
import { calculateAvailability, currentStoryStageIndex, isCurrentTrackedQuest, isStoryQuest } from '../progression/requirementEngine'
import { questAppliesToMap } from '../progression/questLocation'
import { formatPrice } from '../shared/format'

type MarkerStyle = 'realistic' | 'minimal' | 'modern'
type MarkerShape = 'pin' | 'boss' | 'badge' | 'round' | 'loot' | 'diamond' | 'dot'

const MARKER_STYLE_KEY = 'tarkov-map-marker-style'

const markerMeta: Record<MarkerLayerId, { label: string; color: string; size: number; icon: typeof Target; shape: MarkerShape }> = {
  'extract.pmc': { label: 'Выходы ЧВК', color: '#6fb47c', size: 32, icon: DoorOpen, shape: 'badge' },
  'extract.scav': { label: 'Выходы диких', color: '#c9b463', size: 32, icon: DoorOpen, shape: 'badge' },
  'extract.coop': { label: 'Совместные выходы', color: '#70a6ba', size: 32, icon: Users, shape: 'badge' },
  transit: { label: 'Переходы', color: '#9bb2d0', size: 30, icon: ArrowRightLeft, shape: 'badge' },
  'quest.zone': { label: 'Квесты', color: '#d5b76f', size: 34, icon: Target, shape: 'pin' },
  'quest.item': { label: 'Квестовые предметы', color: '#e0c76f', size: 32, icon: Box, shape: 'pin' },
  key: { label: 'Ключи', color: '#8ea8c4', size: 26, icon: KeyRound, shape: 'round' },
  boss: { label: 'Боссы', color: '#d0584a', size: 36, icon: Skull, shape: 'boss' },
  spawn: { label: 'Спавн', color: '#b789be', size: 24, icon: CircleDot, shape: 'dot' },
  hazard: { label: 'Опасности', color: '#e07a54', size: 28, icon: AlertTriangle, shape: 'diamond' },
  'loot.valuable': { label: 'Драгоценности', color: '#cc9fe0', size: 26, icon: Diamond, shape: 'loot' },
  'loot.weapon': { label: 'Оружие/боеприпасы', color: '#c18b65', size: 26, icon: Crosshair, shape: 'loot' },
  'loot.medical': { label: 'Медицина', color: '#d97878', size: 26, icon: HeartPulse, shape: 'loot' },
  'loot.provision': { label: 'Провизия', color: '#a9b96f', size: 26, icon: FlaskConical, shape: 'loot' },
  'loot.technical': { label: 'Технический лут', color: '#8aa28f', size: 26, icon: Wrench, shape: 'loot' },
  'loot.container': { label: 'Контейнеры/тайники', color: '#9d8c67', size: 26, icon: Box, shape: 'loot' },
  'loot.documents': { label: 'Документы боевого пропуска', color: '#d9c27a', size: 28, icon: FileText, shape: 'loot' },
  landmark: { label: 'Ориентиры', color: '#7f9ca2', size: 28, icon: TentTree, shape: 'round' },
}

const shapeGeometry: Record<MarkerShape, { size: [number, number]; anchor: [number, number]; glyph: number }> = {
  pin: { size: [30, 38], anchor: [15, 37], glyph: 15 },
  boss: { size: [34, 34], anchor: [17, 17], glyph: 18 },
  badge: { size: [26, 26], anchor: [13, 13], glyph: 14 },
  round: { size: [24, 24], anchor: [12, 12], glyph: 13 },
  loot: { size: [22, 22], anchor: [11, 11], glyph: 12 },
  diamond: { size: [26, 26], anchor: [13, 13], glyph: 13 },
  dot: { size: [16, 16], anchor: [8, 8], glyph: 0 },
}

const noFloorBadgeLayers = new Set<MarkerLayerId>(['extract.pmc', 'extract.scav', 'extract.coop', 'transit'])

const markerTypeLabel: Record<MarkerLayerId, string> = {
  'extract.pmc': 'Выход ЧВК',
  'extract.scav': 'Выход дикого',
  'extract.coop': 'Совместный выход',
  transit: 'Переход',
  'quest.zone': 'Квест',
  'quest.item': 'Квестовый предмет',
  key: 'Ключ',
  boss: 'Босс',
  spawn: 'Спавн',
  hazard: 'Опасность',
  'loot.valuable': 'Драгоценности',
  'loot.weapon': 'Оружие/боеприпасы',
  'loot.medical': 'Медицина',
  'loot.provision': 'Провизия',
  'loot.technical': 'Технический лут',
  'loot.container': 'Контейнер',
  'loot.documents': 'Документы боевого пропуска',
  landmark: 'Ориентир',
}

const layerGroups: Array<{ title: string; layers: MarkerLayerId[] }> = [
  { title: 'Выходы и переходы', layers: ['extract.pmc', 'extract.scav', 'extract.coop', 'transit'] },
  { title: 'Задания', layers: ['quest.zone', 'quest.item'] },
  { title: 'Дополнительно', layers: ['key', 'boss', 'spawn', 'hazard', 'loot.valuable', 'loot.weapon', 'loot.medical', 'loot.provision', 'loot.technical', 'loot.container', 'loot.documents'] },
]

const glyphCache = new Map<MarkerLayerId, string>()
const iconCache = new Map<string, DivIcon>()

function classicGlyph(layerId: MarkerLayerId, size: number) {
  let glyph = glyphCache.get(layerId)
  if (glyph == null) {
    const Symbol = markerMeta[layerId].icon
    glyph = size ? renderToStaticMarkup(<Symbol size={size} strokeWidth={2.4} />) : ''
    glyphCache.set(layerId, glyph)
  }
  return glyph
}

function markerIcon(style: MarkerStyle, layerId: MarkerLayerId, focused: boolean, badge: string, bust?: string, shiftX = 0) {
  const cacheKey = `${style}|${layerId}|${focused ? 1 : 0}|${badge}|${bust ?? ''}|${shiftX}`
  const cached = iconCache.get(cacheKey)
  if (cached) return cached
  const meta = markerMeta[layerId]
  const badgeHtml = badge ? `<span class="map-marker-floor">${badge}</span>` : ''
  let icon: DivIcon
  if (bust) {
    // The spawn point sits under the bottom centre of the bust.
    icon = divIcon({
      className: 'marker-icon',
      html: `<div class="map-marker is-realistic is-bust${focused ? ' is-focused' : ''}" style="--marker-color:${meta.color}"><img class="map-marker-image" src="${bust}" alt="" draggable="false" />${badgeHtml}</div>`,
      iconSize: [meta.size, meta.size],
      iconAnchor: [meta.size / 2 - shiftX, meta.size],
    })
  } else if (style === 'modern') {
    // New icons: a bare silhouette without a plate, centred on the point.
    const size = Math.round(meta.size * 0.85)
    icon = divIcon({
      className: 'marker-icon',
      html: `<div class="map-marker is-modern${focused ? ' is-focused' : ''}" style="--marker-color:${meta.color}"><img class="map-marker-image" src="${newMarkerImages[layerId]}" alt="" draggable="false" />${badgeHtml}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2 - shiftX, size / 2],
    })
  } else if (style === 'minimal') {
    const geometry = shapeGeometry[meta.shape]
    icon = divIcon({
      className: 'marker-icon',
      html: `<div class="map-marker is-minimal shape-${meta.shape}${focused ? ' is-focused' : ''}" style="--marker-color:${meta.color}"><span class="map-marker-glyph">${classicGlyph(layerId, geometry.glyph)}</span>${badgeHtml}</div>`,
      iconSize: geometry.size,
      iconAnchor: [geometry.anchor[0] - shiftX, geometry.anchor[1]],
    })
  } else {
    // Realistic icons stand on a base, so the map point sits at the bottom centre of the image.
    icon = divIcon({
      className: 'marker-icon',
      html: `<div class="map-marker is-realistic layer-${layerId.replace('.', '-')}${layerId === 'boss' ? ' is-boss' : ''}${focused ? ' is-focused' : ''}" style="--marker-color:${meta.color}"><img class="map-marker-image" src="${markerImages[layerId]}" alt="" draggable="false" />${badgeHtml}</div>`,
      iconSize: [meta.size, meta.size],
      iconAnchor: [meta.size / 2 - shiftX, meta.size],
    })
  }
  iconCache.set(cacheKey, icon)
  return icon
}

/** Initial offset for a tooltip opening to the right of the icon (placeTooltip refines it). */
function tooltipOffset(style: MarkerStyle, layerId: MarkerLayerId, bust?: string): PointExpression {
  const meta = markerMeta[layerId]
  if (style === 'minimal' && !bust) {
    const geometry = shapeGeometry[meta.shape]
    return [geometry.size[0] - geometry.anchor[0] + 4, geometry.size[1] / 2 - geometry.anchor[1]]
  }
  if (style === 'modern' && !bust) return [Math.round(meta.size * 0.85) / 2 + 4, 0]
  return [meta.size / 2 + 4, -meta.size / 2]
}

/**
 * Re-places an open marker tooltip on the side where it fits: inside the map and clear of the
 * HUD, zoom buttons and the quest sheet, instead of always sitting on top of the icon.
 */
function placeTooltip(map: LeafletMap, marker: LeafletMarker, tooltip: LeafletTooltip) {
  const element = tooltip.getElement()
  const iconOptions = marker.options.icon?.options
  if (!element || !iconOptions) return
  const containerElement = map.getContainer()
  const origin = containerElement.getBoundingClientRect()
  const [width, height] = (iconOptions.iconSize as [number, number] | undefined) ?? [26, 26]
  const [ax, ay] = (iconOptions.iconAnchor as [number, number] | undefined) ?? [width / 2, height / 2]
  const stage = containerElement.closest('.map-stage')
  const reserved: PlacementBox[] = []
  stage?.querySelectorAll('.map-hud > *, .leaflet-control-zoom, .map-quest-sheet.is-open, .marker-style-list').forEach((node) => {
    const rect = (node as HTMLElement).getBoundingClientRect()
    if (rect.width && rect.height) reserved.push({ left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top })
  })
  const anchor = map.latLngToContainerPoint(marker.getLatLng())
  const choice = chooseTooltipPlacement({
    point: { x: anchor.x, y: anchor.y },
    icon: { left: -ax, top: -ay, right: width - ax, bottom: height - ay },
    tooltip: { width: element.offsetWidth, height: element.offsetHeight },
    container: { width: origin.width, height: origin.height },
    reserved,
  })
  tooltip.options.direction = choice.side
  tooltip.options.offset = leafletPoint(choice.offset[0], choice.offset[1])
  tooltip.update()
}

function readMarkerStyle(): MarkerStyle {
  try {
    const saved = localStorage.getItem(MARKER_STYLE_KEY)
    if (saved === 'classic') return 'modern'
    return saved === 'minimal' || saved === 'modern' ? saved : 'realistic'
  } catch {
    return 'realistic'
  }
}

const markerStyleOptions: Array<{ id: MarkerStyle; label: string }> = [
  { id: 'realistic', label: 'Тактические' },
  { id: 'minimal', label: 'Минимал' },
  { id: 'modern', label: 'Новые иконки' },
]
const markerStylePreview: MarkerLayerId[] = ['quest.zone']

function MarkerStyleMenu({ value, onChange }: { value: MarkerStyle; onChange: (style: MarkerStyle) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = markerStyleOptions.find((option) => option.id === value) ?? markerStyleOptions[0]

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`marker-style-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="marker-style-trigger is-icon-only"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={uiText(`Иконки на карте: ${current.label}`)}
        title={uiText(`Иконки на карте: ${current.label}`)}
        onClick={() => setOpen((state) => !state)}
      >
        <span className="marker-style-preview">
          {markerStylePreview.map((layerId) => <LayerIcon key={layerId} style={current.id} layerId={layerId} active />)}
        </span>
        <ChevronDown size={13} className="marker-style-chevron" />
      </button>
      <div className="marker-style-list" role="menu" aria-hidden={!open}>
        {uiText(markerStyleOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={option.id === value}
            tabIndex={open ? 0 : -1}
            className={`marker-style-option${option.id === value ? ' active' : ''}`}
            onClick={() => { onChange(option.id); setOpen(false) }}
          >
            <span className="marker-style-preview">
              {uiText(markerStylePreview.map((layerId) => <LayerIcon key={layerId} style={option.id} layerId={layerId} active />))}
            </span>
            <span>{uiText(option.label)}</span>
          </button>
        )))}
      </div>
    </div>
  )
}

function LayerIcon({ style, layerId, active }: { style: MarkerStyle; layerId: MarkerLayerId; active?: boolean }) {
  if (style === 'modern') return <img className={`layer-icon${active ? ' is-preview' : ''}`} src={newMarkerImages[layerId]} alt={uiText("")} />
  if (active) {
    if (style === 'realistic') return <img className="layer-icon is-preview" src={markerImages[layerId]} alt={uiText("")} />
    const { icon: Symbol, color } = markerMeta[layerId]
    return <span className="layer-glyph is-preview" style={{ background: color }}><Symbol size={11} strokeWidth={2.6} /></span>
  }
  if (style === 'realistic') return <img className="layer-icon" src={markerImages[layerId]} alt={uiText("")} />
  const { icon: Symbol, color } = markerMeta[layerId]
  return <span className="layer-glyph" style={{ background: color }}><Symbol size={11} strokeWidth={2.6} /></span>
}

/**
 * `forcedMapId` + `liveBanner`: the phone «Мини Карта» screen (mobile/LiveMapPage.tsx) shows the map the player is
 * on, with the live-position banner above it; the map list is hidden there.
 */
export function MapsPage({ forcedMapId, liveBanner }: { forcedMapId?: string; liveBanner?: ReactNode } = {}) {
  const routeParams = useParams()
  const mapId = forcedMapId ?? routeParams.mapId
  const [layersOpen, setLayersOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const progress = state.activeProfile.modes[state.raidMode]
  const activeMapId = mapId ?? state.selectedMapId
  const activeMap = data.maps.find((entry) => entry.id === activeMapId) ?? data.maps[0]
  const baseFloor = mainFloor(activeMap)
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null)
  const [markerStyle, setMarkerStyle] = useState<MarkerStyle>(readMarkerStyle)
  const chooseMarkerStyle = (style: MarkerStyle) => {
    setMarkerStyle(style)
    try { localStorage.setItem(MARKER_STYLE_KEY, style) } catch { /* storage unavailable */ }
  }
  const [mapView, setMapView] = useState<MapView>(readMapView)
  const chooseMapView = (view: MapView) => {
    setMapView(view)
    saveMapView(view)
  }
  const [floor, setFloor] = useState(baseFloor)
  const [tools, setTools] = useState<MapToolsState>(initialMapTools)
  const mapRef = useRef<LeafletMap | null>(null)
  const toolActive = tools.tool !== 'none'
  const [search, setSearch] = useState('')
  const focusedQuestId = params.get('quest')
  const focusedStage = params.get('stage')
  const activeBounds = toLeafletBounds(activeMap)
  const activeCrs = useMemo(() => createMapCrs(activeMap), [activeMap])
  const plan = planMapLayers(activeMap, mapView, floor)
  const { tileUrl, imageUrl, floorTileUrl } = plan
  const imageBounds = plan.imageBounds ? toLeafletBounds({ ...activeMap, bounds: plan.imageBounds }) : activeBounds
  const baseOpacity = plan.dimBase ? 0.45 : 1

  useEffect(() => {
    setFloor(baseFloor)
    setTools((current) => ({ ...current, rulerPoints: [], sniperCenter: null }))
  }, [activeMap.id, baseFloor])

  const itemsById = useMemo(() => new Map<string, Item>(data.items.map((item) => [item.id, item])), [data.items])

  const availability = useMemo(
    () => calculateAvailability(data.quests, progress),
    [data.quests, progress],
  )

  const currentQuests = useMemo(
    () => data.quests.filter((quest) => isCurrentTrackedQuest(quest, progress)),
    [availability, data.quests],
  )

  const visibleQuestIds = useMemo(
    () => new Set(currentQuests.map((quest) => quest.id)),
    [currentQuests],
  )

  const plottedMarkers = useMemo(
    () => data.markers.filter((marker) => marker.mapId === activeMap.id && isPlottedMarker(marker)),
    [activeMap.id, data.markers],
  )

  const mapMarkers = useMemo(() => plottedMarkers.filter((marker) => {
    const layerId = markerLayerId(marker)
    const focused = Boolean(focusedQuestId && marker.questId === focusedQuestId)
    const isQuest = marker.type === 'quest' || ['quest.zone', 'quest.item'].includes(layerId)
    const relevant = focused || !marker.questId || !isQuest || visibleQuestIds.has(marker.questId)
    const stageOk = markerMatchesStage(marker, focusedQuestId, focusedStage, progress, data.quests)
    return relevant
      && stageOk
      && (focused || !state.hiddenMarkerLayers.includes(layerId))
      && (focused || markerVisibleOnFloor(marker, floor, baseFloor))
      && (isQuest || focused || `${marker.title} ${marker.description}`.toLowerCase().includes(search.toLowerCase()))
  }), [plottedMarkers, floor, baseFloor, visibleQuestIds, search, state.hiddenMarkerLayers, focusedQuestId, focusedStage, progress, data.quests])

  const bossShifts = useMemo(() => bossFanOut(mapMarkers.filter((marker) => markerLayerId(marker) === 'boss')), [mapMarkers])

  const bossesVisible = useMemo(() => mapMarkers.some((marker) => markerLayerId(marker) === 'boss'), [mapMarkers])
  const bossProfiles = useBossProfiles(bossesVisible)

  const mapQuestEntries = useMemo(() => {
    const onMap = currentQuests.filter((quest) => {
      const stageIndex = currentStoryStageIndex(quest, progress)
      return questAppliesToMap(quest, activeMap.id, stageIndex)
    })
    return onMap.map((quest) => {
      const stageIndex = currentStoryStageIndex(quest, progress)
      const marker = plottedMarkers.find((entry) => (
        entry.questId === quest.id
        && (entry.stageIndex == null || entry.stageIndex === stageIndex)
      ))
      return { quest, marker }
    })
  }, [activeMap.id, currentQuests, plottedMarkers, progress])

  const localMapQuests = useMemo(
    () => mapQuestEntries.filter(({ quest }) => !quest.anyMap),
    [mapQuestEntries],
  )

  const anyMapQuests = useMemo(
    () => mapQuestEntries.filter(({ quest }) => quest.anyMap),
    [mapQuestEntries],
  )

  useEffect(() => {
    if (!focusedQuestId) return
    const quest = data.quests.find((entry) => entry.id === focusedQuestId)
    const stageIndex = quest ? currentStoryStageIndex(quest, progress) : Number(focusedStage ?? 0)
    const marker = mapMarkers.find((entry) => (
      entry.questId === focusedQuestId
      && (entry.stageIndex == null || entry.stageIndex === stageIndex || focusedStage == null)
    ))
      ?? plottedMarkers.find((entry) => (
        entry.questId === focusedQuestId
        && (entry.stageIndex == null || entry.stageIndex === stageIndex || (focusedStage != null && entry.stageIndex === Number(focusedStage)))
      ))
    if (marker) {
      setSelectedMarker(marker)
      return
    }
    if (quest) setSelectedMarker(questInfoMarker(quest, activeMap.id))
  }, [focusedQuestId, focusedStage, activeMap.id, mapMarkers, plottedMarkers, data.quests, progress])

  const selectMap = (id: string) => {
    state.setSelectedMapId(id)
    setSelectedMarker(null)
    const nextMap = data.maps.find((entry) => entry.id === id)
    setFloor(nextMap ? mainFloor(nextMap) : baseFloor)
    navigate(`/maps/${id}`)
  }

  const clearQuestSelection = () => {
    setSelectedMarker(null)
    const next = new URLSearchParams(params)
    next.delete('quest')
    next.delete('stage')
    setParams(next, { replace: true })
  }

  const showMarker = (marker: MapMarker) => {
    setSelectedMarker(marker)
    const next = new URLSearchParams(params)
    if (marker.questId) {
      next.set('quest', marker.questId)
      if (marker.stageIndex != null) next.set('stage', String(marker.stageIndex))
      else next.delete('stage')
    } else {
      next.delete('quest')
      next.delete('stage')
    }
    setParams(next, { replace: true })
  }

  const showQuest = (quest: Quest, marker?: MapMarker) => {
    if (marker) {
      showMarker(marker)
      return
    }
    const next = new URLSearchParams(params)
    next.set('quest', quest.id)
    next.delete('stage')
    setParams(next, { replace: true })
    setSelectedMarker(questInfoMarker(quest, activeMap.id))
  }

  const relatedQuest = selectedMarker?.questId
    ? data.quests.find((quest) => quest.id === selectedMarker.questId)
    : undefined
  const relatedAvailability = relatedQuest ? availability.get(relatedQuest.id) : undefined
  const relatedStageIndex = relatedQuest ? currentStoryStageIndex(relatedQuest, progress) : 0
  const relatedStage = relatedQuest?.stages?.[relatedStageIndex]
  const flyTarget = selectedMarker && selectedMarker.source !== 'quest-info' && hasRealCoordinates(selectedMarker)
    ? selectedMarker
    : null
  const sheetOpen = Boolean(selectedMarker)
  const selectedItem = selectedMarker?.itemId ? itemsById.get(selectedMarker.itemId) : undefined
  const sheetPoint = relatedQuest && flyTarget && flyTarget.questId === relatedQuest.id ? flyTarget : null
  const sheetFloor = sheetPoint ? floorLabel(sheetPoint, baseFloor) : null
  const sheetVisual = Boolean(sheetPoint && !sheetPoint.approximate)

  return <div className={`page map-page${liveBanner ? ' is-live' : ''}`}>
    {liveBanner}
    <div className={`map-shell${layersOpen ? ' layers-open' : ''}`}>
      <aside className="map-sidebar">
        <div>
          <div className="map-side-title">{uiText("ЛОКАЦИИ")}</div>
          {uiText(data.maps.map((map) => (
            <button key={map.id} className={`map-option ${map.id === activeMap.id ? 'active' : ''}`} onClick={() => selectMap(map.id)}>
              <span className="map-color" style={{ background: map.accent }} />
              <span>{uiText(map.name)}</span>
            </button>
          )))}
        </div>
        <div>
          <div className="map-side-title" style={{ marginTop: 20 }}>{uiText("ТОЧКИ НА КАРТЕ")}</div>
          <p className="map-layer-hint">{uiText("Включены только выходы и текущие квесты. Остальное можно открыть здесь.")}</p>
          {uiText(layerGroups.map((group) => (
            <div key={group.title} className="map-layer-group">
              <div className="map-side-title">{uiText(group.title)}</div>
              {uiText(group.layers.map((layerId) => {
                const meta = markerMeta[layerId]
                const visible = !state.hiddenMarkerLayers.includes(layerId)
                const count = plottedMarkers.filter((marker) => markerLayerId(marker) === layerId && (!marker.questId || visibleQuestIds.has(marker.questId))).length
                return <button className={`layer-button ${visible ? 'active' : ''}`} key={layerId} onClick={() => state.toggleMarkerLayer(layerId)}>
                  <LayerIcon style={markerStyle} layerId={layerId} />
                  <span>{uiText(meta.label)}</span>
                  <small>{uiText(count)}</small>
                </button>
              }))}
            </div>
          )))}
        </div>
      </aside>

      <section className={`map-stage${toolActive ? ' is-tool-active' : ''}`}>
        <div className="map-hud">
          <span>{uiText(activeMap.name.toUpperCase())}</span>
          <MapViewToggle map={activeMap} value={mapView} shown={plan.view} onChange={chooseMapView} />
          <MapToolbar value={tools} onChange={setTools} />
          <MarkerStyleMenu value={markerStyle} onChange={chooseMarkerStyle} />
          <button type="button" className={`map-layers-toggle${layersOpen ? ' active' : ''}`} aria-expanded={layersOpen} onClick={() => setLayersOpen((open) => !open)}><Layers size={14} />{uiText('Слои')}</button>
        </div>
        <div className="map-canvas-keyboard" onClickCapture={(event) => {
          const markerId = (event.target as HTMLElement).closest<HTMLElement>('[data-marker-id]')?.dataset.markerId
          const marker = markerId ? mapMarkers.find((entry) => entry.id === markerId) : undefined
          if (marker && !toolActive) { event.stopPropagation(); showMarker(marker) }
        }} onKeyDownCapture={(event) => {
          if (!['Enter', ' '].includes(event.key)) return
          const markerId = (event.target as HTMLElement).closest<HTMLElement>('[data-marker-id]')?.dataset.markerId
          const marker = markerId ? mapMarkers.find((entry) => entry.id === markerId) : undefined
          if (marker) { event.preventDefault(); showMarker(marker) }
        }}>
        <MapContainer
          key={`${activeMap.id}:${JSON.stringify(activeMap.transform)}:${JSON.stringify(activeBounds)}`}
          crs={activeCrs}
          bounds={activeBounds}
          boundsOptions={{ padding: [20, 20] }}
          zoomSnap={0.25}
          minZoom={Math.min(-5, activeMap.minZoom ?? -1)}
          maxZoom={Math.max(7, activeMap.maxZoom ?? 3)}
          zoomControl={false}
          attributionControl={false}
        >
          <ZoomControl position="topright" />
          {/* Digital: the SVG scheme with the ground level (or the selected SVG floor) shown. */}
          {plan.view === 'digital' && imageUrl && (
            <FloorSvgOverlay key={`base:${imageUrl}`} base url={imageUrl} layers={activeMap.layers ?? []} selected={plan.floorSvg ? floor : baseFloor} bounds={imageBounds} opacity={baseOpacity} />
          )}
          {/* Satellite: a floor that only exists in the SVG is drawn as a plan over the render. */}
          {plan.view === 'satellite' && imageUrl && plan.floorSvg === 'floor-only' && (
            <FloorSvgOverlay key={`floor:${imageUrl}`} url={imageUrl} layers={activeMap.layers ?? []} selected={floor} bounds={imageBounds} terrain={false} />
          )}
          {uiText(plan.view === 'satellite' && tileUrl && (
            <TileLayer
              key={tileUrl}
              url={tileUrl}
              opacity={baseOpacity}
              bounds={activeBounds}
              tileSize={activeMap.tileSize ?? 256}
              minZoom={-5}
              minNativeZoom={activeMap.minZoom}
              maxZoom={Math.max(7, activeMap.maxZoom ?? 3)}
              maxNativeZoom={activeMap.maxZoom}
              noWrap
            />
          ))}
          {uiText(floorTileUrl && (
            <TileLayer
              key={floorTileUrl}
              url={floorTileUrl}
              bounds={activeBounds}
              tileSize={activeMap.tileSize ?? 256}
              minZoom={-5}
              minNativeZoom={activeMap.minZoom}
              maxZoom={Math.max(7, activeMap.maxZoom ?? 3)}
              maxNativeZoom={activeMap.maxZoom}
              zIndex={2}
              noWrap
            />
          ))}
          <FocusOnMarker marker={flyTarget} />
          <MapRefCapture mapRef={mapRef} />
          {!toolActive && <ClearSelectionOnMapClick onClear={clearQuestSelection} />}
          <MapToolLayer value={tools} onChange={setTools} />
          <LivePlayerMarker mapId={activeMap.id} />
          {uiText(mapMarkers.map((marker) => {
            const layerId = markerLayerId(marker)
            const meta = markerMeta[layerId]
            const focused = selectedMarker?.id === marker.id || Boolean(focusedQuestId && marker.questId === focusedQuestId)
            const bust = layerId === 'boss' ? bossBust(marker) : undefined
            const icon = markerIcon(markerStyle, layerId, focused, noFloorBadgeLayers.has(layerId) ? '' : floorBadge(marker.floor, baseFloor), bust, bossShifts.get(marker.id) ?? 0)
            return (
              <Marker
                key={marker.id}
                position={marker.position}
                icon={icon}
                alt={uiText(marker.title)}
                bubblingMouseEvents={false}
                zIndexOffset={focused ? 800 : layerId === 'boss' ? 400 : 0}
                riseOnHover
                eventHandlers={{
                  add: (event) => event.target.getElement()?.setAttribute('data-marker-id', marker.id),
                  click: (event) => {
                    if (toolActive) return
                    event.originalEvent.stopPropagation()
                    showMarker(marker)
                  },
                  tooltipopen: (event) => {
                    const map = mapRef.current
                    if (!map) return
                    placeTooltip(map, event.target as LeafletMarker, event.tooltip)
                    // The React content is measured again once it has rendered into the tooltip.
                    requestAnimationFrame(() => { if (event.tooltip.isOpen()) placeTooltip(map, event.target as LeafletMarker, event.tooltip) })
                  },
                  keypress: (event) => {
                    if (['Enter', ' '].includes((event.originalEvent as KeyboardEvent).key)) {
                      event.originalEvent.preventDefault()
                      showMarker(marker)
                    }
                  },
                  keydown: (event) => {
                    if (['Enter', ' '].includes((event.originalEvent as KeyboardEvent).key)) {
                      event.originalEvent.preventDefault()
                      showMarker(marker)
                    }
                  },
                }}
              >
                <Tooltip key={markerStyle} direction="right" offset={tooltipOffset(markerStyle, layerId, bust)} opacity={1} className="map-marker-tooltip">
                  <MapMarkerTooltip
                    marker={marker}
                    typeLabel={markerTypeLabel[layerId]}
                    color={meta.color}
                    floor={floorLabel(marker, baseFloor)}
                    item={marker.itemId ? itemsById.get(marker.itemId) : undefined}
                    boss={layerId === 'boss' || marker.type === 'boss' ? resolveBossInfo(marker, bossProfiles) : undefined}
                  />
                </Tooltip>
              </Marker>
            )
          }))}
        </MapContainer>
        </div>

        <div className={`map-quest-sheet${sheetOpen ? ' is-open' : ''}`} aria-hidden={!sheetOpen}>
          {uiText(relatedQuest && (
            <div className={`map-quest-sheet-body${sheetVisual ? ' has-visual' : ''}`}>
              <div className="map-quest-sheet-copy">
                <div className="map-quest-sheet-eyebrow">{uiText(relatedQuest.trader)}</div>
                <h2 className="map-quest-sheet-title">{uiText(relatedQuest.name)}</h2>
                <div className="map-quest-sheet-meta">
                  <span className="tag brass">{uiText(questStatusLabel(relatedAvailability?.status ?? 'unknown', isStoryQuest(relatedQuest)))}</span>
                  {uiText(relatedQuest.kappa && <span className="tag brass">{uiText("капа")}</span>)}
                  <span className="tag">{uiText(activeMap.name)}</span>
                  {uiText(sheetFloor && <span className={`tag map-floor-tag${sheetFloor !== 'Основной' ? ' is-indoor' : ''}`}><Building2 size={11} /> {uiText(sheetFloor)}</span>)}
                  {uiText(relatedQuest.anyMap && <span className="tag">{uiText("Любая карта")}</span>)}
                </div>
                <div className="map-quest-sheet-section">
                  {uiText(relatedStage ? (
                    <>
                      <h4>{uiText("Текущий этап")}</h4>
                      <p><strong>{uiText(relatedStage.title)}</strong></p>
                      {uiText(relatedStage.description && <p className="dim">{uiText(relatedStage.description)}</p>)}
                    </>
                  ) : (
                    <>
                      <h4>{uiText("Цели")}</h4>
                      <ul className="map-quest-sheet-objectives">
                        {uiText((relatedQuest.objectives.length ? relatedQuest.objectives : [relatedQuest.description]).map((objective) => (
                          <li key={objective}>{uiText(objective)}</li>
                        )))}
                      </ul>
                    </>
                  ))}
                  {uiText(sheetPoint?.approximate && (
                    <p className="map-quest-sheet-note"><MapPin size={12} />{uiText(" Точное место этапа неизвестно — метка стоит приблизительно.")}</p>
                  ))}
                </div>
                <Link
                  className="button map-quest-sheet-link"
                  to={`/quests?${isStoryQuest(relatedQuest) ? 'filter=story&' : ''}selected=${relatedQuest.id}`}
                >{uiText(" Открыть задание ")}<ChevronRight size={14} />
                </Link>
              </div>
              {uiText(sheetVisual && sheetPoint && (
                <figure className="map-quest-sheet-visual">
                  <MarkerMiniMap map={activeMap} view={mapView} position={sheetPoint.position} color={markerMeta[markerLayerId(sheetPoint)].color} />
                  <figcaption>
                    <span>{uiText("Примерное место")}</span>
                    <span>{uiText(sheetFloor)}</span>
                  </figcaption>
                  {uiText(sheetPoint.description && sheetPoint.description !== relatedStage?.description && (
                    <p className="map-quest-sheet-point">{uiText(sheetPoint.description)}</p>
                  ))}
                </figure>
              ))}
            </div>
          ))}
          {uiText(selectedMarker && !relatedQuest && (
            <div className="map-quest-sheet-body map-marker-detail-card">
              <button className="icon-button map-marker-detail-close" onClick={() => setSelectedMarker(null)} aria-label={uiText('Закрыть карточку')} title={uiText('Закрыть карточку')}><X size={16} /></button>
              <div className="map-quest-sheet-eyebrow">{uiText(markerTypeLabel[markerLayerId(selectedMarker)])} · {uiText(floorLabel(selectedMarker, baseFloor))}</div>
              <h2 className="map-quest-sheet-title">{uiText(selectedMarker.title)}</h2>
              {selectedMarker.description && <p className="dim">{uiText(selectedMarker.description)}</p>}
              {selectedMarker.meta && <p>{uiText(selectedMarker.meta)}</p>}
              {selectedItem && <div className="map-marker-item-price"><span>{uiText('Барахолка')}</span><strong>{selectedItem.fleaPrice ? formatPrice(selectedItem.fleaPrice) : uiText('нет цены')}</strong></div>}
            </div>
          ))}
        </div>
      </section>

      <aside className="map-detail">
        <div className="panel-header">
          <div className="panel-title">{uiText("Квесты на карте")}</div>
        </div>
        <div className="filter-row" style={{ padding: 12, margin: 0 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 13, color: 'var(--text-dim)' }} />
            <input
              className="input"
              style={{ width: '100%', paddingLeft: 34 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={uiText("Найти точку…")}
            />
          </div>
        </div>
        {uiText(activeMap.floors && activeMap.floors.length > 1 && (
          <div className="filter-row" style={{ padding: '0 12px', margin: '0 0 12px' }}>
            {uiText(activeMap.floors.map((entry) => (
              <button key={entry} className={`button small ${floor === entry ? 'primary' : 'ghost'}`} onClick={() => setFloor(entry)}>
                {uiText(entry)}
              </button>
            )))}
          </div>
        ))}
        {uiText((localMapQuests.length > 0 || anyMapQuests.length > 0) ? (
          <div className="detail-section" style={{ padding: '0 12px 16px' }}>
            {uiText(localMapQuests.length > 0 && (
              <>
                <h4>{uiText("Актуальные квесты")}</h4>
                {uiText(localMapQuests.map(({ quest, marker }) => (
                  <QuestMapRow
                    key={quest.id}
                    quest={quest}
                    selected={selectedMarker?.questId === quest.id}
                    onSelect={() => showQuest(quest, marker)}
                  />
                )))}
              </>
            ))}
            {uiText(anyMapQuests.length > 0 && (
              <>
                <h4 style={{ marginTop: localMapQuests.length ? 16 : 0 }}>{uiText("Любая карта")}</h4>
                {uiText(anyMapQuests.map(({ quest, marker }) => (
                  <QuestMapRow
                    key={quest.id}
                    quest={quest}
                    selected={selectedMarker?.questId === quest.id}
                    onSelect={() => showQuest(quest, marker)}
                  />
                )))}
              </>
            ))}
          </div>
        ) : (
          <div className="map-detail-empty">
            <div>
              <Target size={28} />
              <h3>{uiText("Нет текущих квестов")}</h3>
              <p>{uiText("На этой карте сейчас нет активных заданий.")}</p>
            </div>
          </div>
        ))}
      </aside>
    </div>
  </div>
}

const mapViewOptions: Array<{ id: MapView; label: string; title: string; missing: string }> = [
  { id: 'satellite', label: 'Спутник', title: 'Спутник: объёмный рендер местности сверху', missing: 'Для этой карты у tarkov.dev есть только схема' },
  { id: 'digital', label: 'Схема', title: 'Схема: цифровая векторная карта', missing: 'Для этой карты у tarkov.dev нет схемы, только спутник' },
]

/**
 * «Вид карты»: one choice for all maps. Folded it is a small button with the current mode; a click unfolds the
 * modes to the right, a pick folds them back. A kind the current map doesn't have is shown disabled with a hint.
 */
function MapViewToggle({ map, value, shown, onChange }: { map: GameMap; value: MapView; shown: MapView; onChange: (view: MapView) => void }) {
  const support = mapViewSupport(map)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = mapViewOptions.find((option) => option.id === shown) ?? mapViewOptions[0]
  const only = !support.satellite && support.digital ? 'только схема' : support.satellite && !support.digital ? 'только спутник' : ''
  const onlyHint = !support.satellite ? mapViewOptions[0].missing : mapViewOptions[1].missing

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`map-view-toggle${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="map-view-trigger"
        aria-expanded={open}
        aria-label={uiText(`Вид карты: ${current.label}`)}
        title={uiText(only ? onlyHint : 'Вид карты')}
        onClick={() => setOpen((state) => !state)}
      >
        <span className="map-style-label">{uiText('ВИД')}</span>
        <span className="map-view-current">{uiText(current.label)}</span>
        <ChevronRight size={13} className="map-view-chevron" />
      </button>
      <div className="map-view-drawer" aria-hidden={!open}>
        <div className="map-view-options" role="radiogroup" aria-label={uiText('Вид карты')}>
          {mapViewOptions.map((option) => {
            const available = support[option.id]
            const hint = available ? (value !== shown && option.id === shown ? 'Выбранного вида нет у этой карты — показан этот' : option.title) : option.missing
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                tabIndex={open ? 0 : -1}
                aria-checked={shown === option.id}
                className={`map-view-option${shown === option.id ? ' active' : ''}${available ? '' : ' is-disabled'}`}
                aria-disabled={!available}
                title={uiText(hint)}
                onClick={() => { if (!available) return; onChange(option.id); setOpen(false) }}
              >{uiText(option.label)}</button>
            )
          })}
          {only && <em className="map-view-hint" title={uiText(onlyHint)}>{uiText(only)}</em>}
        </div>
      </div>
    </div>
  )
}

function QuestMapRow({ quest, selected, onSelect }: { quest: Quest; selected: boolean; onSelect: () => void }) {
  return (
    <div className={`catalog-card quest-catalog-card quest-map-row ${selected ? 'selected' : ''}`}>
      <button type="button" className="quest-map-row-main" onClick={onSelect}>
        <span className="quest-card-copy">
          <h3>{uiText(quest.name)}</h3>
          <p>{uiText(quest.anyMap ? `Любая карта · ${quest.trader} · ур. ${quest.level}` : `${quest.trader} · ур. ${quest.level}`)}{uiText(quest.kappa ? ' · капа' : '')}</p>
        </span>
      </button>
    </div>
  )
}

function MapRefCapture({ mapRef }: { mapRef: { current: LeafletMap | null } }) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
    return () => { mapRef.current = null }
  }, [map, mapRef])
  return null
}

function FocusOnMarker({ marker }: { marker: MapMarker | null }) {
  const map = useMap()
  useEffect(() => {
    if (!marker) return
    const [lat, lng] = marker.position
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const zoom = Math.min(Math.max(map.getZoom(), map.getMinZoom() + 2), map.getMaxZoom())
    map.flyTo(marker.position, zoom, { duration: 0.55 })
  }, [map, marker])
  return null
}

function ClearSelectionOnMapClick({ onClear }: { onClear: () => void }) {
  useMapEvents({
    click: () => onClear(),
  })
  return null
}

function hasRealCoordinates(marker: MapMarker) {
  const [lat, lng] = marker.position
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
}

function questStatusLabel(status: TaskProgressStatus, story?: boolean) {
  if (status === 'completed') return 'Выполнено'
  if (status === 'failed') return 'Провалено'
  if (status === 'active') return story ? 'Текущая глава' : 'Текущее'
  if (status === 'available') return 'Доступно'
  if (status === 'locked') return 'Закрыто'
  if (story) return 'Глава истории'
  return 'Неизвестно'
}

function markerMatchesStage(
  marker: MapMarker,
  focusedQuestId: string | null,
  focusedStage: string | null,
  progress: ModeProgress,
  quests: Quest[],
) {
  if (marker.stageIndex == null || !marker.questId) return true
  const quest = quests.find((entry) => entry.id === marker.questId)
  const current = quest
    ? currentStoryStageIndex(quest, progress)
    : progress.taskProgress[marker.questId]?.currentStageIndex ?? 0
  if (focusedQuestId && marker.questId === focusedQuestId) {
    const requested = focusedStage == null || focusedStage === '' ? current : Number(focusedStage)
    return marker.stageIndex === requested
  }
  return marker.stageIndex === current
}

/**
 * Bosses that spawn in (almost) the same place — e.g. the Cultist Priest and the Goons on Customs —
 * would hide each other. Each group is fanned out sideways in screen pixels around the true point.
 */
const BOSS_OVERLAP_DISTANCE = 40
const BOSS_FAN_STEP = 38

function bossFanOut(markers: MapMarker[]) {
  const shifts = new Map<string, number>()
  const groups: MapMarker[][] = []
  for (const marker of markers) {
    const group = groups.find((entry) => entry.some((other) => Math.hypot(other.position[0] - marker.position[0], other.position[1] - marker.position[1]) < BOSS_OVERLAP_DISTANCE))
    if (group) group.push(marker)
    else groups.push([marker])
  }
  for (const group of groups) {
    if (group.length < 2) continue
    const ordered = [...group].sort((a, b) => a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id))
    ordered.forEach((marker, index) => shifts.set(marker.id, (index - (ordered.length - 1) / 2) * BOSS_FAN_STEP))
  }
  return shifts
}

function isPlottedMarker(marker: MapMarker) {
  return marker.source !== 'quest-fallback' && marker.source !== 'quest-any-map' && marker.source !== 'quest-info'
}

function questInfoMarker(quest: Quest, mapId: string): MapMarker {
  return {
    id: `${mapId}-quest-info-${quest.id}`,
    mapId,
    type: 'quest',
    layerId: 'quest.zone',
    title: quest.name,
    description: quest.objectives[0] ?? quest.description,
    position: [0, 0],
    meta: quest.anyMap ? `Любая карта · ${quest.trader} · ур. ${quest.level}` : `${quest.trader} · ур. ${quest.level}`,
    questId: quest.id,
    source: 'quest-info',
  }
}

function markerLayerId(marker: MapMarker): MarkerLayerId {
  if (marker.layerId) return marker.layerId
  if (marker.type === 'extract') return 'extract.pmc'
  if (marker.type === 'quest') return marker.itemId ? 'quest.item' : 'quest.zone'
  if (marker.type === 'cache') return 'loot.container'
  if (marker.type === 'danger') return 'hazard'
  return marker.type as MarkerLayerId
}
