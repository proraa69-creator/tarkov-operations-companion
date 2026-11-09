import { uiLabel, uiText } from '../i18n/renderText'
import { featureEnabled } from '../app/archivedFeatures'
import { DocumentGlyph } from '../components/DocumentGlyph'
import { SwitchGlyph } from '../components/SwitchGlyph'
import { BtrGlyph } from '../components/BtrGlyph'
import { RunnerGlyph } from '../components/RunnerGlyph'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { divIcon, point as leafletPoint, type DivIcon, type Map as LeafletMap, type Marker as LeafletMarker, type PointExpression, type Tooltip as LeafletTooltip } from 'leaflet'
import { MapContainer, Marker, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AlertTriangle, ArrowLeft, BadgeCheck, BadgeQuestionMark, Key, ArrowRightLeft, Box, Building2, ChevronDown, ChevronRight, ChevronUp, CircleDot, Crosshair, Diamond, DoorOpen,
  FlaskConical, HeartPulse, KeyRound, Layers, MapPin, Maximize2, Minimize2, Search, Skull, Target, TentTree, Users, Wrench, X, CircleHelp,
} from 'lucide-react'
import { prefersReducedMotion } from '../shared/motion'
import { PhoneMapFloors, PhoneMapPicker, PhoneMapQuests } from '../mobile/PhoneMapPanels'
import { markerImages } from '../assets/markerImages'
import { newMarkerImages } from '../assets/map-markers-new'
import { bossBust } from '../assets/bossBusts'
import { useTarkovData } from '../data/DataProvider'
import { floorBadge, floorLabel, isOnRoof, mainFloor, markerVisibleOnFloor, floorsBottomUp, ROOF_FLOOR } from '../data/mapProjection'
import { keyDoorFocusCard } from '../data/keyDoors'
import { useLocale } from '../i18n/LocaleProvider'
import { resolveBossInfo, useBossProfiles } from '../data/bosses'
import { MapMarkerTooltip } from '../components/MapMarkerTooltip'
import { ExtractGuideCard } from '../components/ExtractGuideCard'
import { BattlePassDocumentCard, BattlePassDocumentGallery, BattlePassDocumentTitle, DocumentLayerDetails } from '../components/BattlePassDocuments'
import { DOCUMENT_PICTURES } from '../assets/documentMarkers'
import { LOOT_CONTAINER_PICTURES } from '../assets/containerMarkers'
import { LootContainerRows } from '../components/LootContainerRows'
import { lootContainerKindOf, type LootContainerKind } from '../data/lootContainerKinds'
import { battlePassDocumentKindsOf, battlePassDocumentTitle, type BattlePassDocumentKind } from '../data/battlePassDocuments'
import { clearFoundDocuments, markDocumentFound, useFoundDocuments } from '../progression/foundDocuments'
import { extractFloor, extractGuideOf } from '../data/extractGuide'
import { exitNames, exitShortName } from '../data/exitShortNames'
import { exitHighlights, useRaidExtracts } from '../maps/raidExtracts'
import { MarkerCanvasLayer, type CanvasPoint } from '../maps/MarkerCanvasLayer'
import { wasCanvasPick } from '../maps/canvasPick'
import { canvasMarkers, type SpriteSpec } from '../maps/markerSprites'
import { useRaidState } from '../app/useRaidState'
import { GUARANTEED_SPAWN_TEXT, POSSIBLE_SPAWN_LABEL, isPossibleSpawnSpot, usesPossibleSpawnBadge } from '../data/mapMarkerAdapter'
import possibleSpawnPicture from '../assets/map-markers-new/loot-guaranteed-maybe.svg'
import { MarkerMiniMap } from '../components/MarkerMiniMap'
import { STATIONARY_WEAPONS, StationaryWeaponZone, stationaryWeaponIcon, stationaryWeaponKind } from '../components/StationaryWeaponZones'
import { MapFloorLayers } from '../components/MapFloorLayers'
import { MapSketchLayer, MapSketchToolbar } from '../components/MapSketch'
import { useMapSketch } from '../maps/mapSketch'
import { MapRoomButtons, MapRoomMarks } from '../components/MapRoomMarks'
import { exitFanOut } from '../maps/exitFan'
import { LivePlayerMarker, useFollowRaidMap, useLivePlayer } from '../components/LivePlayerMarker'
import { MapItemCard } from '../components/MapItemCard'
import { MapToolLayer, MapToolbar, initialMapTools, type MapToolsState } from '../components/MapTools'
import { BossPlacementControls, BossPlacementLayer, BossPlacementRemove, useBossPlacement } from '../components/BossPlacement'
import { firstQuestPoint, QuestEditorButton, QuestEditorPanel, QuestPointCardActions, QuestPointEditorLayer, useQuestPointEditor } from '../components/QuestPointEditor'
import { PointMenu, PointSettingsWindow, type PointEmblem } from '../components/PointConstructor'
import { EditableText, QuestSheetEditProvider, SheetPencil } from '../components/QuestSheetEditing'
import { QUEST_POINT_ICONS } from '../shared/questPointConstructor'
import { chooseTooltipPlacement, type Box as PlacementBox } from '../components/tooltipPlacement'
import { createMapCrs, toLeafletBounds } from '../components/mapCrs'
import { mapViewSupport, planMapLayers, readMapView, saveMapView } from '../data/mapView'
import { PLAYER_FLOOR_HINT, useAutoFloor } from '../data/useAutoFloor'
import '../styles/mapView.css'
import { useAppState } from '../state/AppState'
import type { GameMap, Item, MapMarker, MapView, MarkerLayerId, ModeProgress, Quest, TaskProgressStatus } from '../domain/types'
import { currentStoryStageIndex, isCurrentTrackedQuest, isStoryQuest } from '../progression/requirementEngine'
import { questCardHref } from '../quests/questCardLink'
import { questAvailabilityOf } from '../quests/questReadModel'
import { visibleStoryObjectives } from '../progression/storyObjectives'
import { questAppliesToMap } from '../progression/questLocation'
import { mapObjectivesDone, markerObjectiveDone } from '../progression/mapObjectives'
import { pairedFindDef } from '../progression/objectivePairs'
import { manualObjectiveValue, questObjectiveDefs } from '../progression/objectiveProgress'
import { sheetObjectives } from '../progression/sheetObjectives'
import { QuestSheetObjectives } from '../components/QuestSheetObjectives'
import { PointHintLine, QuestCuratedRequirements, QuestGuideImages, QuestPointHints } from '../components/QuestCuratedInfo'
import { QuestGuidePhotoStrip } from '../components/QuestGuidePhotos'
import { ReportDialog } from '../components/SupportButtons'
import { questReportFromMap, type QuestReportDraft } from '../components/QuestReportSection'
import { formatPrice } from '../shared/format'
import { RaidRouteControls, RaidRouteHint, RaidRouteLayer } from '../components/raidprep/RaidRoute'
import { RaidBriefingPanel } from '../components/raidprep/RaidBriefingPanel'
import { useRaidRoute } from '../raidprep/useRaidPrep'
import { useSquadSharedQuests } from '../squad/useSquad'
import { FriendQuestMarkers, FriendQuestToggle } from '../squad/FriendQuestsOnMap'
import { useFriendQuestLayer } from '../squad/friendQuestLayer'
import { SquadQuestTag } from '../squad/SquadQuestTag'
import { clearQuestChecks, orderByChecks, toggleQuestCheck, useQuestChecks } from '../progression/questChecks'
import { QuestRaidCheck, QuestRaidChecksNote } from '../components/QuestRaidCheck'
import { deferredQuestRows, restoreDeferredQuests, useDeferredQuests } from '../progression/deferredQuests'
import { questKeyRows } from '../quests/questKeys'
import { useOwnedKeys } from '../quests/ownedKeys'
import { NeededKeysButton } from '../maps/NeededKeysButton'
import { KeySpotKeys } from '../maps/KeySpotKeys'
import { SpotPhotos } from '../maps/SpotPhotos'
import { behindLockedDoor, lockedRooms } from '../data/mapRoomSigns'
import { keysOfPoint, neededKeysOf, questKeysOnMap, setNeededKeysOnly, useNeededKeysOnly } from '../maps/neededKeys'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { QuestDeferDialog, type DeferRequest } from '../components/QuestDeferDialog'
import { DeferredQuestsButton, DeferredQuestsDialog, QuestDeferMenu, type QuestDeferMenuState } from '../components/DeferredQuests'
import { KillZonesLayerButton, MapDetailTabs, MapKillsButton, MapKillsPanel, MapKillsWindow, MapKillZones, type MapDetailTab } from '../components/MapKills'
import { killRows, killSummary, killZones, movesToKills, type KillRow, type KillZone } from '../maps/killObjectives'
import { setKillZonesShown, useKillsWindow, useKillZonesShown } from '../maps/killZones'
import { MapDragGuard } from '../maps/mapDragGuard'
import { MapFloorWheel, useGameFloorWheel } from '../maps/mapFloorWheel'
import { repeatsTitle } from '../maps/repeatsTitle'
import { useMapFloorWheel } from '../account/trialFeatures'
import { isDesktopShell, useMobileLayout } from '../platform'

type MarkerStyle = 'realistic' | 'minimal' | 'modern'
type MarkerShape = 'pin' | 'boss' | 'badge' | 'round' | 'loot' | 'diamond' | 'dot'

const MARKER_STYLE_KEY = 'tarkov-map-marker-style'

const markerMeta: Record<MarkerLayerId, { label: string; color: string; size: number; icon: typeof Target | typeof DocumentGlyph; shape: MarkerShape }> = {
  'extract.pmc': { label: 'Выходы ЧВК', color: '#6fb47c', size: 32, icon: DoorOpen, shape: 'badge' },
  'extract.scav': { label: 'Выходы диких', color: '#c9b463', size: 32, icon: DoorOpen, shape: 'badge' },
  'extract.coop': { label: 'Совместные выходы', color: '#70a6ba', size: 32, icon: Users, shape: 'badge' },
  transit: { label: 'Переходы', color: '#9bb2d0', size: 30, icon: ArrowRightLeft, shape: 'badge' },
  switch: { label: 'Рубильники', color: '#d9a441', size: 28, icon: SwitchGlyph, shape: 'round' },
  btr: { label: 'Остановки БТР', color: '#9fb07a', size: 30, icon: BtrGlyph, shape: 'round' },
  'quest.zone': { label: 'Квесты', color: '#d5b76f', size: 34, icon: Target, shape: 'pin' },
  'quest.item': { label: 'Квестовые предметы', color: '#e0c76f', size: 32, icon: Box, shape: 'pin' },
  key: { label: 'Двери', color: '#8ea8c4', size: 26, icon: KeyRound, shape: 'round' },
  boss: { label: 'Боссы', color: '#d0584a', size: 36, icon: Skull, shape: 'boss' },
  spawn: { label: 'Спавн', color: '#b789be', size: 24, icon: CircleDot, shape: 'dot' },
  'spawn.pmc': { label: 'Спавны ЧВК', color: '#6fb47c', size: 26, icon: RunnerGlyph, shape: 'round' },
  'spawn.scav': { label: 'Спавны диких', color: '#e8923a', size: 26, icon: RunnerGlyph, shape: 'round' },
  hazard: { label: 'Опасности', color: '#e07a54', size: 28, icon: AlertTriangle, shape: 'diamond' },
  'loot.valuable': { label: 'Драгоценности', color: '#cc9fe0', size: 26, icon: Diamond, shape: 'loot' },
  'loot.weapon': { label: 'Станковое оружие', color: '#c18b65', size: 26, icon: Crosshair, shape: 'loot' },
  'loot.medical': { label: 'Медицина', color: '#d97878', size: 26, icon: HeartPulse, shape: 'loot' },
  'loot.provision': { label: 'Провизия', color: '#a9b96f', size: 26, icon: FlaskConical, shape: 'loot' },
  'loot.technical': { label: 'Технический лут', color: '#8aa28f', size: 26, icon: Wrench, shape: 'loot' },
  'loot.container': { label: 'Контейнеры/тайники', color: '#9d8c67', size: 26, icon: Box, shape: 'loot' },
  'loot.documents': { label: 'Документы боевого пропуска', color: '#7fa3bf', size: 28, icon: DocumentGlyph, shape: 'loot' },
  'loot.guaranteed': { label: 'Спавн 100 %', color: '#e8c547', size: 28, icon: BadgeCheck, shape: 'loot' },
  'loot.key': { label: 'Ключи', color: '#e3c15f', size: 26, icon: Key, shape: 'loot' },
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


const markerTypeLabel: Record<MarkerLayerId, string> = {
  'extract.pmc': 'Выход ЧВК',
  'extract.scav': 'Выход дикого',
  'extract.coop': 'Совместный выход',
  transit: 'Переход',
  switch: 'Рубильник',
  btr: 'Остановка БТР',
  'quest.zone': 'Квест',
  'quest.item': 'Квестовый предмет',
  key: 'Запертая дверь',
  boss: 'Босс',
  spawn: 'Спавн',
  'spawn.pmc': 'Спавн ЧВК',
  'spawn.scav': 'Спавн дикого',
  hazard: 'Опасность',
  'loot.valuable': 'Драгоценности',
  'loot.weapon': 'Станковое оружие',
  'loot.medical': 'Медицина',
  'loot.provision': 'Провизия',
  'loot.technical': 'Технический лут',
  'loot.container': 'Контейнер',
  'loot.documents': 'Документы боевого пропуска',
  'loot.guaranteed': 'Спавн 100 %',
  'loot.key': 'Ключ или инструмент',
  landmark: 'Ориентир',
}

const layerGroups: Array<{ title: string; layers: MarkerLayerId[] }> = [
  { title: 'Выходы и переходы', layers: ['extract.pmc', 'extract.scav', 'extract.coop', 'transit', 'switch', 'btr'] },
  { title: 'Спавны', layers: ['spawn.pmc', 'spawn.scav'] },
  { title: 'Задания', layers: ['quest.zone', 'quest.item'] },
  // Battle pass documents first; «Станковое оружие» = mounted AGS / Utyos only.
  // Report №108: the keys and keycards that lie loose, and the doors they open, on a tab of their own.
  { title: 'Ключи', layers: ['loot.key', 'key'] },
  { title: 'Дополнительно', layers: ['loot.guaranteed', 'loot.documents', 'boss', 'hazard', 'loot.valuable', 'loot.weapon', 'loot.medical', 'loot.provision', 'loot.technical', 'loot.container'] },
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

/** «Возможная точка спавна» in «Минимализм»: the badge with a question mark instead of the tick. */
function possibleSpawnGlyph(size: number) {
  return size ? renderToStaticMarkup(<BadgeQuestionMark size={size} strokeWidth={2.4} />) : ''
}

/** Report №114: a point behind a locked door gets a very small padlock at the icon's corner. */
const LOCK_HTML = '<span class="map-marker-lock" aria-hidden="true"><svg viewBox="0 0 10 12" width="9" height="11"><path d="M2.6 5V3.6a2.4 2.4 0 0 1 4.8 0V5" fill="none" stroke="#1a1a12" stroke-width="1.6"/><rect x="1" y="5" width="8" height="6.2" rx="1.2" fill="#f2d27a" stroke="#1a1a12" stroke-width="1"/></svg></span>'

/** A battle pass document in every style: its kind's silhouette, cut out; «+1» for a second kind at the same spot. */
const DOCUMENT_MARKER_SIZE = 24
function documentIcon(kinds: readonly BattlePassDocumentKind[], focused: boolean, badge: string, locked = false) {
  const cacheKey = `document|${kinds.join('+')}|${focused ? 1 : 0}|${badge}|${locked ? 1 : 0}`
  const cached = iconCache.get(cacheKey)
  if (cached) return cached
  const kind = kinds[0]!
  const more = kinds.length > 1 ? `<span class="map-document-more">+${kinds.length - 1}</span>` : ''
  const badgeHtml = badge ? `<span class="map-marker-floor">${badge}</span>` : ''
  const icon = divIcon({
    className: 'marker-icon',
    html: `<div class="map-marker is-document${focused ? ' is-focused' : ''}"><img class="map-marker-image" src="${DOCUMENT_PICTURES[kind]}" alt="" draggable="false" />${more}${badgeHtml}${locked ? LOCK_HTML : ''}</div>`,
    iconSize: [DOCUMENT_MARKER_SIZE, DOCUMENT_MARKER_SIZE],
    iconAnchor: [DOCUMENT_MARKER_SIZE / 2, DOCUMENT_MARKER_SIZE / 2],
  })
  iconCache.set(cacheKey, icon)
  return icon
}

/** Whose icon carries its short name under it: the exits' and the transits' (data/exitShortNames.ts). */
const NAMED_LAYERS: ReadonlySet<MarkerLayerId> = new Set<MarkerLayerId>(['extract.pmc', 'extract.scav', 'extract.coop', 'transit'])
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function markerIcon(style: MarkerStyle, layerId: MarkerLayerId, focused: boolean, badge: string, bust?: string, shiftX = 0, possible = false, name = '', nameStyle = '', exit: '' | 'lit' | 'dim' = '', maybe = false, locked = false) {
  const cacheKey = `${style}|${layerId}|${focused ? 1 : 0}|${badge}|${bust ?? ''}|${shiftX}|${possible ? 1 : 0}|${name}|${nameStyle}|${exit}|${maybe ? 1 : 0}|${locked ? 1 : 0}`
  const cached = iconCache.get(cacheKey)
  if (cached) return cached
  const meta = markerMeta[layerId]
  // a quest's point: the others fade while a quest is chosen (report №91)
  // the exits the game lists for this raid, and the others (report №105)
  const quest = (layerId === 'quest.zone' ? ' is-quest' : '') + (exit ? ` is-exit-${exit}` : '')
  const badgeHtml = `${badge ? `<span class="map-marker-floor">${badge}</span>` : ''}${name ? `<span class="map-marker-name"${nameStyle ? ` style="${nameStyle}"` : ''}>${escapeHtml(name)}</span>` : ''}${locked ? LOCK_HTML : ''}`
  let icon: DivIcon
  if (bust) {
    // The spawn point sits under the bottom centre of the bust.
    icon = divIcon({
      className: 'marker-icon',
      html: `<div class="map-marker is-realistic is-bust${focused ? ' is-focused' : ''}${quest}${possible ? ' is-possible' : ''}" style="--marker-color:${meta.color}"><img class="map-marker-image" src="${bust}" alt="" draggable="false" />${badgeHtml}</div>`,
      iconSize: [meta.size, meta.size],
      iconAnchor: [meta.size / 2 - shiftX, meta.size],
    })
  } else if (style === 'modern') {
    // New icons: a bare silhouette without a plate, centred on the point.
    const size = Math.round(meta.size * 0.85)
    icon = divIcon({
      className: 'marker-icon',
      html: `<div class="map-marker is-modern${focused ? ' is-focused' : ''}${quest}${possible ? ' is-possible' : ''}" style="--marker-color:${meta.color}"><img class="map-marker-image" src="${maybe ? possibleSpawnPicture : newMarkerImages[layerId]}" alt="" draggable="false" />${badgeHtml}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2 - shiftX, size / 2],
    })
  } else if (style === 'minimal') {
    const geometry = shapeGeometry[meta.shape]
    icon = divIcon({
      className: 'marker-icon',
      html: `<div class="map-marker is-minimal shape-${meta.shape}${focused ? ' is-focused' : ''}${quest}${possible ? ' is-possible' : ''}" style="--marker-color:${meta.color}"><span class="map-marker-glyph">${maybe ? possibleSpawnGlyph(geometry.glyph) : classicGlyph(layerId, geometry.glyph)}</span>${badgeHtml}</div>`,
      iconSize: geometry.size,
      iconAnchor: [geometry.anchor[0] - shiftX, geometry.anchor[1]],
    })
  } else {
    // Realistic icons stand on a base, so the map point sits at the bottom centre of the image.
    icon = divIcon({
      className: 'marker-icon',
      html: `<div class="map-marker is-realistic layer-${layerId.replace('.', '-')}${layerId === 'boss' ? ' is-boss' : ''}${focused ? ' is-focused' : ''}${quest}${possible ? ' is-possible' : ''}" style="--marker-color:${meta.color}"><img class="map-marker-image" src="${maybe ? possibleSpawnPicture : markerImages[layerId]}" alt="" draggable="false" />${badgeHtml}</div>`,
      iconSize: [meta.size, meta.size],
      iconAnchor: [meta.size / 2 - shiftX, meta.size],
    })
  }
  iconCache.set(cacheKey, icon)
  return icon
}

/** A loot container in «Стандартные»: its own drawing, no plate; each point of the map its own, so two jackets side by side are two. */
const CONTAINER_MARKER_SIZE = 26
function containerIcon(kind: LootContainerKind, focused: boolean, badge: string, locked = false) {
  const cacheKey = `container|${kind}|${focused ? 1 : 0}|${badge}|${locked ? 1 : 0}`
  const cached = iconCache.get(cacheKey)
  if (cached) return cached
  const badgeHtml = badge ? `<span class="map-marker-floor">${badge}</span>` : ''
  const icon = divIcon({
    className: 'marker-icon',
    html: `<div class="map-marker is-cutout${focused ? ' is-focused' : ''}"><img class="map-marker-image" src="${LOOT_CONTAINER_PICTURES[kind]}" alt="" draggable="false" />${badgeHtml}${locked ? LOCK_HTML : ''}</div>`,
    iconSize: [CONTAINER_MARKER_SIZE, CONTAINER_MARKER_SIZE],
    iconAnchor: [CONTAINER_MARKER_SIZE / 2, CONTAINER_MARKER_SIZE / 2],
  })
  iconCache.set(cacheKey, icon)
  return icon
}

/**
 * A key spot as the key itself (owner, 09.11.2026: «на карте спавны ключей должны показываться вот такой моделькой. Без
 * рамок, без ничего, просто ключ»): the game's picture of the dearest key that lies there, cut out, no plate, no name.
 */
const KEY_MARKER_SIZE = 30
/** The item's picture without its inventory square (tarkov.dev «-base-image», our server's «-base»). */
const itemCutout = (iconUrl: string | undefined) => iconUrl && /-icon\.webp$/.test(iconUrl)
  ? iconUrl.replace(/-icon\.webp$/, iconUrl.includes('assets.tarkov.dev') ? '-base-image.webp' : '-base.webp')
  : iconUrl
function keyPictureIcon(url: string, focused: boolean, badge: string, locked = false) {
  const cacheKey = `key-picture|${url}|${focused ? 1 : 0}|${badge}|${locked ? 1 : 0}`
  const cached = iconCache.get(cacheKey)
  if (cached) return cached
  const badgeHtml = badge ? `<span class="map-marker-floor">${badge}</span>` : ''
  const icon = divIcon({
    className: 'marker-icon',
    html: `<div class="map-marker is-cutout is-key-picture${focused ? ' is-focused' : ''}"><img class="map-marker-image" src="${escapeHtml(url)}" alt="" draggable="false" />${badgeHtml}${locked ? LOCK_HTML : ''}</div>`,
    iconSize: [KEY_MARKER_SIZE, KEY_MARKER_SIZE],
    iconAnchor: [KEY_MARKER_SIZE / 2, KEY_MARKER_SIZE / 2],
  })
  iconCache.set(cacheKey, icon)
  return icon
}

/**
 * The layers drawn on one canvas (report №104): the many small points (loot, containers, documents, doors, spawns,
 * hazards). Exits, quests, bosses, switches and the stationary weapons stay DOM icons (few, with names and states).
 */
const NO_IDS: ReadonlySet<string> = new Set()
/** The items a locked door can keep: loot, containers, documents, keys (report №114). */
const LOCK_BADGE_LAYERS: ReadonlySet<MarkerLayerId> = new Set<MarkerLayerId>(['loot.guaranteed', 'loot.valuable', 'loot.medical', 'loot.provision', 'loot.technical', 'loot.container', 'loot.documents', 'loot.key', 'loot.weapon'])
const CANVAS_LAYERS: ReadonlySet<MarkerLayerId> = new Set<MarkerLayerId>(['loot.guaranteed', 'loot.valuable', 'loot.medical', 'loot.provision', 'loot.technical', 'loot.container', 'loot.documents', 'loot.key', 'key', 'spawn', 'spawn.pmc', 'spawn.scav', 'hazard', 'landmark'])
const SHADOW_REALISTIC = 'drop-shadow(0 1px 2px rgb(0 0 0 / 75%)) drop-shadow(0 0 1px rgb(0 0 0 / 90%))'
const SHADOW_CUTOUT = 'drop-shadow(0 1px 2px rgb(0 0 0 / 85%)) drop-shadow(0 0 1px rgb(0 0 0 / 90%))'
const SHADOW_MODERN = 'drop-shadow(0 2px 3px rgb(0 0 0 / 80%))'
/** The game's pictures of things (keys, realistic loot): a faint light rim keeps a dark item visible on a dark map. */
const SHADOW_ITEM = 'drop-shadow(0 0 1px rgb(255 240 210 / 85%)) drop-shadow(0 0 1px rgb(255 240 210 / 45%)) drop-shadow(0 1px 2px rgb(0 0 0 / 80%))'
const ITEM_PICTURE_LAYERS: ReadonlySet<MarkerLayerId> = new Set<MarkerLayerId>(['loot.key', 'loot.medical', 'loot.valuable', 'loot.technical', 'loot.provision', 'loot.container'])
const SHADOW_MINIMAL = 'drop-shadow(0 2px 2px rgb(0 0 0 / 85%))'

/** color-mix(in srgb, colour 72%, #111 28%) at .88, as the minimal plate. */
function plateColor(color: string) {
  const value = Number.parseInt(color.slice(1), 16)
  const mix = (channel: number) => Math.round(channel * 0.72 + 0x11 * 0.28)
  return `rgba(${mix((value >> 16) & 255)}, ${mix((value >> 8) & 255)}, ${mix(value & 255)}, .88)`
}
const glyphUrlCache = new Map<MarkerLayerId, string>()
function glyphUrl(layerId: MarkerLayerId, size: number) {
  let url = glyphUrlCache.get(layerId)
  if (!url) {
    url = `data:image/svg+xml,${encodeURIComponent(classicGlyph(layerId, size).replace(/currentColor/g, '#f5ead0').replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'))}`
    glyphUrlCache.set(layerId, url)
  }
  return url
}

let possibleGlyphUrl = ''
function possibleSpawnGlyphUrl(size: number) {
  if (!possibleGlyphUrl) possibleGlyphUrl = `data:image/svg+xml,${encodeURIComponent(possibleSpawnGlyph(size).replace(/currentColor/g, '#f5ead0').replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'))}`
  return possibleGlyphUrl
}

/** The name under a key point: its key's short name, «+N» for the other keys that may lie there (report №108). */
function keySpotName(marker: MapMarker, itemsById: ReadonlyMap<string, { shortName?: string }>) {
  const name = (marker.itemId ? itemsById.get(marker.itemId)?.shortName : undefined) ?? ''
  return name && marker.keyCount ? `${name} +${marker.keyCount - 1}` : name
}

/** The canvas picture of a point: the same picture, size, anchor and shadow as its DOM icon. */
function canvasSpec(style: MarkerStyle, layerId: MarkerLayerId, badge: string, possible: boolean, name: string, documentKinds: readonly BattlePassDocumentKind[], containerKind: LootContainerKind | undefined, maybe = false, locked = false): SpriteSpec {
  const extra = { ...(badge ? { badge } : {}), ...(name ? { name } : {}), ...(possible ? { possible: markerMeta[layerId].color } : {}), ...(locked ? { lock: true } : {}) }
  if (documentKinds.length && style !== 'minimal') {
    const size = DOCUMENT_MARKER_SIZE
    return { src: DOCUMENT_PICTURES[documentKinds[0]!], size: [size, size], anchor: [size / 2, size / 2], filter: SHADOW_CUTOUT, ...(documentKinds.length > 1 ? { more: `+${documentKinds.length - 1}` } : {}), ...extra }
  }
  if (containerKind) return { src: LOOT_CONTAINER_PICTURES[containerKind], size: [CONTAINER_MARKER_SIZE, CONTAINER_MARKER_SIZE], anchor: [CONTAINER_MARKER_SIZE / 2, CONTAINER_MARKER_SIZE / 2], filter: SHADOW_CUTOUT, ...extra }
  const meta = markerMeta[layerId]
  if (style === 'modern') {
    const size = Math.round(meta.size * 0.85)
    return { src: maybe ? possibleSpawnPicture : newMarkerImages[layerId], size: [size, size], anchor: [size / 2, size / 2], filter: SHADOW_MODERN, ...extra }
  }
  if (style === 'minimal') {
    const geometry = shapeGeometry[meta.shape]
    const shape = meta.shape === 'diamond' ? 'diamond' : meta.shape === 'badge' ? 'rounded' : 'circle'
    return { ...(geometry.glyph ? { src: maybe ? possibleSpawnGlyphUrl(geometry.glyph) : glyphUrl(layerId, geometry.glyph) } : {}), size: geometry.size, anchor: geometry.anchor, filter: SHADOW_MINIMAL, plate: { color: plateColor(meta.color), shape }, ...extra }
  }
  return { src: maybe ? possibleSpawnPicture : markerImages[layerId], size: [meta.size, meta.size], anchor: [meta.size / 2, meta.size], filter: ITEM_PICTURE_LAYERS.has(layerId) ? SHADOW_ITEM : SHADOW_REALISTIC, ...extra }
}

/** Initial offset for a tooltip opening to the right of the icon (placeTooltip refines it). */
function tooltipOffset(style: MarkerStyle, layerId: MarkerLayerId, bust?: string): PointExpression {
  if (layerId === 'loot.documents') return [DOCUMENT_MARKER_SIZE / 2 + 4, 0]
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
  stage?.querySelectorAll('.map-hud > *, .leaflet-control-zoom, .map-quest-sheet.is-open, .marker-style-list, .map-kills-window').forEach((node) => {
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
    return saved === 'minimal' || saved === 'realistic' ? saved : 'modern'
  } catch {
    return 'modern'
  }
}

/** «Стандартные» (the former «Новые иконки») is the default for everyone who has not picked a style. */
const markerStyleOptions: Array<{ id: MarkerStyle; label: string }> = [
  { id: 'modern', label: 'Стандартные' },
  { id: 'realistic', label: 'Реалистичные' },
  // owner, 07.11.2026: «Комплект меток на карте который называется компактный, переименуй в минималистичный. Или просто минимализм»
  { id: 'minimal', label: 'Минимализм' },
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
  // The key is the game's picture of a key in every style (owner, 09.11.2026: «Картинка ключа везде»).
  if (style === 'modern' || layerId === 'loot.key') return <img className={`layer-icon${active ? ' is-preview' : ''}`} src={newMarkerImages[layerId]} alt={uiText("")} />
  if (active) {
    if (style === 'realistic') return <img className="layer-icon is-preview" src={markerImages[layerId]} alt={uiText("")} />
    const { icon: Symbol, color } = markerMeta[layerId]
    return <span className="layer-glyph is-preview" style={{ background: color }}><Symbol size={11} strokeWidth={2.6} /></span>
  }
  if (style === 'realistic') return <img className="layer-icon" src={markerImages[layerId]} alt={uiText("")} />
  const { icon: Symbol, color } = markerMeta[layerId]
  return <span className="layer-glyph" style={{ background: color }}><Symbol size={11} strokeWidth={2.6} /></span>
}

/** On the phone it runs inside mobile/PhoneMapsPage.tsx, which adds the player's position from the server. */
export function MapsPage() {
  const routeParams = useParams()
  const mapId = routeParams.mapId
  const mobile = useMobileLayout()
  const [layersOpen, setLayersOpen] = useState(false)
  const closeLayers = () => {
    setLayersOpen(false)
    requestAnimationFrame(() => shellRef.current?.querySelector('.map-stage')?.scrollIntoView({ block: 'start' }))
  }
  const [expanded, setExpanded] = useDesktopMapFullscreen(!mobile)
  const shellRef = useMapFitsWindow(!mobile)
  const [fullscreen, setFullscreen] = usePhoneMapFullscreen(mobile)
  const [params, setParams] = useSearchParams()
  const { locale } = useLocale()
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const progress = state.activeProfile.modes[state.raidMode]
  const activeMapId = mapId ?? state.selectedMapId
  const activeMap = data.maps.find((entry) => entry.id === activeMapId) ?? data.maps[0]
  const baseFloor = mainFloor(activeMap)
  const route = useRaidRoute(activeMap.id, data.markers, data.quests, progress)
  const [pickedMarker, setSelectedMarker] = useState<MapMarker | null>(null)
  // The picked point as the map has it now: a point the quest constructor just changed (its objective / stage, text,
  // emblem) shows its new state in the quest window at once.
  const selectedMarker = useMemo(() => (pickedMarker ? data.markers.find((marker) => marker.id === pickedMarker.id && marker.mapId === pickedMarker.mapId) ?? pickedMarker : null), [pickedMarker, data.markers])
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
  /** «Нашли неточность?» on the quest window (owner, 04.11.2026): the report it opened. */
  const [questReport, setQuestReport] = useState<QuestReportDraft | null>(null)
  const closeQuestReport = useCallback(() => setQuestReport(null), [])
  const [tools, setTools] = useState<MapToolsState>(initialMapTools)
  const plottedMarkersForBosses = useMemo(() => data.markers.filter((marker) => marker.mapId === activeMap.id && marker.type === 'boss'), [activeMap.id, data.markers])
  const allBossMarkers = useMemo(() => data.markers.filter((marker) => marker.type === 'boss'), [data.markers])
  const bossPlacement = useBossPlacement(activeMap.id, floor, baseFloor, plottedMarkersForBosses, allBossMarkers, state.raidMode)
  // «Квесты: правка точек» (owner app): one editing mode at a time with «Расставить боссов».
  // «Заявки» → «Открыть в конструкторе» (owner app): ?quest=<id>&edit=1 opens the constructor on that quest, and
  // &proposal=<x>,<z> shows where the players say the point is.
  // ?edit=1 alone («Админ панель» → «Открыть конструктор на карте») opens the constructor with no quest picked.
  const editRequested = params.get('edit') === '1'
  const editQuestId = editRequested ? params.get('quest') ?? undefined : undefined
  const proposal = proposalOf(params.get('proposal'))
  const questEditor = useQuestPointEditor({ mapId: activeMap.id, floor, baseFloor, quests: data.quests, markers: data.markers, initialQuestId: editQuestId, initialActive: editRequested })
  const editingQuest = questEditor.editingQuest
  const questEditorShows = questEditor.shows
  const setBossActive = bossPlacement.setActive
  const setQuestEditorActive = questEditor.setActive
  useEffect(() => { if (bossPlacement.active) setQuestEditorActive(false) }, [bossPlacement.active]) // eslint-disable-line react-hooks/exhaustive-deps
  const mapRef = useRef<LeafletMap | null>(null)
  // Report №97: the map dragged since the last press — a point's click then is the end of a drag (maps/mapDragGuard.tsx).
  const mapDragged = useRef(false)
  // «Зарисовка» (a player's proposal №80): while it is drawn the points do not take a press, as with the ruler.
  const sketch = useMapSketch(state.activeProfile.id, state.raidMode, activeMap.id)
  const toolActive = tools.tool !== 'none' || sketch.editing
  const [search, setSearch] = useState('')
  const focusedQuestId = params.get('quest')
  const focusedStage = params.get('stage')
  // «Требования рейда» on the Overview (?quest=…&objective=<id>): the point of that objective, e.g. where to plant the item.
  const focusedObjectiveId = params.get('objective')
  // «Барахолка» → a key's «Показать дверь на карте» (?lock=<marker id>): that door, on its floor, even with «Двери» off.
  const focusedLockId = params.get('lock')
  // ?key=<item id>: the key whose curated lock that marker stands for (data/keyDoors.ts keyDoorFocusCard).
  const focusedLockKey = params.get('key')
  const activeBounds = toLeafletBounds(activeMap)
  const activeCrs = useMemo(() => createMapCrs(activeMap), [activeMap])
  const plan = planMapLayers(activeMap, mapView, floor)
  const floorOrder = useMemo(() => floorsBottomUp(activeMap), [activeMap])
  // Alt + the wheel steps the floors: only for the accounts the owner gave it to (src/maps/mapFloorWheel.tsx)
  const floorWheel = useMapFloorWheel()
  // …and from the game on the other monitor, the app not focused (owner, 08.11.2026)
  useGameFloorWheel(floorWheel && !mobile && floorOrder.length > 1, floorOrder, floor, setFloor)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a newly opened map starts on its main level; useAutoFloor below may move it in the same commit
    setFloor(baseFloor)
    setTools((current) => ({ ...current, rulerPoints: [], sniperCenter: null }))
  }, [activeMap.id, baseFloor])
  // «Этаж по скриншоту»: the floor the player is on. Declared after the reset above — effects run in order, so on
  // opening the map (or a new screenshot) the player's floor wins; a floor picked by hand stays until the next one.
  const player = useLivePlayer(activeMap.id, activeMap.bounds)
  // The PC: the map of the current raid opens by itself with each new position (the phone does it in PhoneMapsPage).
  useFollowRaidMap(player, activeMap.id, !bossPlacement.active && !questEditor.active)
  const playerOnFloor = useAutoFloor(activeMap, player.onThisMap ? player.position : null, setFloor, !bossPlacement.active && !questEditor.active)

  const itemsById = useMemo(() => new Map<string, Item>(data.items.map((item) => [item.id, item])), [data.items])

  const availability = useMemo(
    () => questAvailabilityOf(data.quests, progress),
    [data.quests, progress],
  )

  const currentQuests = useMemo(
    () => data.quests.filter((quest) => isCurrentTrackedQuest(quest, progress)),
    [data.quests, progress],
  )

  // «Сделал в этом рейде»: the player's own checks (this profile and mode, not progress); checked quests go last
  // in «Квесты на карте» and their points leave the map, so they stop getting in the way (a selected one still shows).
  const profileId = state.activeProfile.id
  const raidMode = state.raidMode
  const questChecks = useQuestChecks(profileId, raidMode)
  // «Нашёл» on a battle pass document: it leaves the map until this raid ends (progression/foundDocuments.ts).
  const foundDocuments = useFoundDocuments(profileId, raidMode)
  const [documentGallery, setDocumentGallery] = useState(false)
  const hiddenContainerKinds = state.hiddenContainerKinds
  const closeDocumentGallery = useCallback(() => setDocumentGallery(false), [])
  // «Отложенные квесты» (progression/deferredQuests.ts): put aside with a right click, they leave «Квесты на карте» and
  // their points leave the map until they are returned in that window; a selected one still shows, like a checked one.
  const traderLoyalty = useTraderLoyalty()
  const deferred = useDeferredQuests(profileId, raidMode, state.activeProfile.modes[raidMode].playerLevel, traderLoyalty)
  // Reports №112 and №113: the keys quests open now or put aside need and the player lacks; each quest's keys on this map.
  const ownedKeys = useOwnedKeys(profileId, raidMode)
  const questKeys = useMemo(() => questKeyRows(data.quests, itemsById, progress, availability, deferred), [data.quests, itemsById, progress, availability, deferred])
  const neededKeys = useMemo(() => neededKeysOf(questKeys, ownedKeys), [questKeys, ownedKeys])
  const keysByQuest = useMemo(() => questKeysOnMap(questKeys, activeMap.id), [questKeys, activeMap.id])
  const neededKeysOnly = useNeededKeysOnly()
  // Put aside with its keys and items into «Избранное», unless that is switched off (progression/questDeferral.ts).
  const [deferRequest, setDeferRequest] = useState<DeferRequest | null>(null)

  const visibleQuestIds = useMemo(
    () => new Set(currentQuests.filter((quest) => !questChecks.has(quest.id) && !deferred.has(quest.id) && !mapObjectivesDone(quest, activeMap.id, progress)).map((quest) => quest.id)),
    [currentQuests, questChecks, deferred, activeMap.id, progress],
  )

  const plottedMarkers = useMemo(
    // a layer this app has no icon for (a newer server's) is left out rather than taking the page down
    () => data.markers.filter((marker) => marker.mapId === activeMap.id && isPlottedMarker(marker) && markerLayerId(marker) in markerMeta),
    [activeMap.id, data.markers],
  )

  /** The quest is on the open map (a story chapter: its current stage). */
  const onThisMap = useCallback((quest: Quest) => questAppliesToMap(quest, activeMap.id, currentStoryStageIndex(quest, progress)), [activeMap.id, progress])

  const mapQuestEntries = useMemo(() => {
    const onMap = currentQuests.filter((quest) => !deferred.has(quest.id) && onThisMap(quest))
    return onMap.map((quest) => {
      const stageIndex = currentStoryStageIndex(quest, progress)
      const marker = plottedMarkers.find((entry) => (
        entry.questId === quest.id
        && (entry.stageIndex == null || entry.stageIndex === stageIndex)
      ))
      return { quest, marker }
    })
  }, [currentQuests, deferred, onThisMap, plottedMarkers, progress])

  // «Устранения» (owner, 08.11.2026; maps/killObjectives.ts): every kill of the current quests on this map — a tab of the right
  // panel on the PC, a window under the HUD on the phone — and their zones on the map. A quest that on this map only asks to kill
  // leaves «Актуальные квесты» for it.
  const mapName = useCallback((id: string) => data.maps.find((map) => map.id === id)?.name ?? id, [data.maps])
  const killList = useMemo(
    () => killRows({ quests: mapQuestEntries.map(({ quest }) => quest), mapId: activeMap.id, progress, items: itemsById, points: plottedMarkers, checked: questChecks, mapName }),
    [mapQuestEntries, activeMap.id, progress, itemsById, plottedMarkers, questChecks, mapName],
  )
  const killTotals = useMemo(() => killSummary(killList), [killList])
  // the map's own points give its size: a zone over half of it is no place to kill in (maps/killObjectives.ts MAX_ZONE_SHARE)
  const killZoneList = useMemo(() => killZones(killList, plottedMarkers.map((marker) => marker.position)), [killList, plottedMarkers])
  const bothKillZones = killZoneList.some((zone) => zone.kind === 'both')
  const killsOpenCount = killList.filter((row) => !row.settled).length
  const killZonesShown = useKillZonesShown()
  const [killsOpen, setKillsOpen, closeKills] = useKillsWindow(activeMap.id, killList.length === 0)
  const killsButtonRef = useRef<HTMLButtonElement>(null)
  /** The PC's right panel: «Актуальные квесты» or «Устранения» (owner, 08.11.2026). */
  const [detailTab, setDetailTab] = useState<MapDetailTab>('quests')
  // The kill quest opened from «Устранения» or its zone: it dims no points (owner, 08.11.2026: «когда нажимаешь на квест
  // «Устранение» во вкладке «Устранение», то точки на карте не должны приглушаться»).
  const [killFocus, setKillFocus] = useState<string | null>(null)
  const killOnly = useMemo(
    () => new Set(mapQuestEntries.filter(({ quest }) => movesToKills(quest, activeMap.id, progress, plottedMarkers)).map(({ quest }) => quest.id)),
    [mapQuestEntries, activeMap.id, progress, plottedMarkers],
  )
  // Owner, 08.11.2026: «При наведении в эту зону должны быть не точки… а именно нарисованные зоны»: while the zones are drawn,
  // the points of those kill objectives leave the map (the zone shows the quest on hover instead).
  const killZonesDrawn = killZonesShown && !questEditor.active
  const killZonePoints = useMemo(() => new Set(killList.filter((row) => !row.settled && row.zones.length).map((row) => `${row.quest.id}|${row.objective.id}`)), [killList])

  const mapMarkers = useMemo(() => plottedMarkers.filter((marker) => {
    const layerId = markerLayerId(marker)
    if (layerId === 'loot.documents' && foundDocuments.has(marker.id)) return false
    if (neededKeysOnly && layerId === 'loot.key' && !keysOfPoint(marker).some((id) => neededKeys.has(id))) return false
    const focused = Boolean(focusedQuestId && marker.questId === focusedQuestId) || marker.id === focusedLockId
    const isQuest = marker.type === 'quest' || ['quest.zone', 'quest.item'].includes(layerId)
    // «Квесты: правка точек»: only the edited quest's points (of the chosen objective / stage), on every floor.
    if (editingQuest && isQuest && marker.questId) return marker.questId === editingQuest && questEditorShows(marker)
    // An objective ticked as done (by hand or from the game): its points leave the map.
    if (isQuest && markerObjectiveDone(marker, progress)) return false
    if (killZonesDrawn && isQuest && killZonePoints.has(`${marker.questId}|${marker.objectiveId}`)) return false
    const relevant = focused || !marker.questId || !isQuest || visibleQuestIds.has(marker.questId)
    const stageOk = markerMatchesStage(marker, focusedQuestId, focusedStage, progress, data.quests)
    return relevant
      && stageOk
      && layerId !== 'spawn'
      && (focused || (bossPlacement.active && layerId === 'boss') || !state.hiddenMarkerLayers.includes(layerId))
      && (focused || layerId !== 'loot.container' || !hiddenContainerKinds.includes(lootContainerKindOf(marker) ?? ''))
      && (focused || markerVisibleOnFloor(marker, floor, baseFloor))
      && (isQuest || focused || `${marker.title} ${marker.description}`.toLowerCase().includes(search.toLowerCase()))
  }), [plottedMarkers, floor, baseFloor, visibleQuestIds, search, state.hiddenMarkerLayers, hiddenContainerKinds, focusedQuestId, focusedLockId, focusedStage, progress, data.quests, bossPlacement.active, editingQuest, questEditorShows, foundDocuments, killZonesDrawn, killZonePoints, neededKeysOnly, neededKeys])

  const bossShifts = useMemo(() => bossFanOut(mapMarkers.filter((marker) => markerLayerId(marker) === 'boss')), [mapMarkers])
  const exitFan = useMemo(() => exitFanOut(mapMarkers.filter((marker) => marker.type === 'extract')), [mapMarkers])
  // Report №104: the many small points on one canvas; the one under the pointer becomes its DOM icon (tooltip, click, menu).
  const [hoveredCanvasId, setHoveredCanvasId] = useState<string | null>(null)
  // Report №105: the exits the game listed after a double O, lit until the raid ends; the others dimmed.
  const raidState = useRaidState()
  const raidExtracts = useRaidExtracts()
  const exitStates = useMemo(() => exitHighlights(raidExtracts, raidState?.inRaid ? raidState.since : undefined,
    mapMarkers.filter((marker) => marker.type === 'extract').map((marker) => ({ id: marker.id, title: marker.title, titles: exitNames(marker.title) }))), [raidExtracts, raidState, mapMarkers])

  const bossesVisible = useMemo(() => mapMarkers.some((marker) => markerLayerId(marker) === 'boss'), [mapMarkers])
  const bossProfiles = useBossProfiles(bossesVisible)

  // Quests whose objectives on this map are all ticked close by themselves: they look and go last like the ones checked for
  // this raid, without a second tick (a player, 04.11.2026: «слишком неудобно ставить все галочки и еще ставить галочку о
  // закрытии квеста»), and stay so after the raid, as their ticks do. They stay current until the game completes them.
  const doneHere = useMemo(() => new Set(mapQuestEntries.filter(({ quest }) => mapObjectivesDone(quest, activeMap.id, progress)).map(({ quest }) => quest.id)), [activeMap.id, mapQuestEntries, progress])
  const settledHere = useMemo(() => {
    const done = [...doneHere].filter((id) => !questChecks.has(id))
    return done.length ? new Map([...questChecks, ...done.map((id) => [id, 0] as const)]) : questChecks
  }, [doneHere, questChecks])

  const localMapQuests = useMemo(
    () => orderByChecks(mapQuestEntries.filter(({ quest }) => !quest.anyMap && !killOnly.has(quest.id)), settledHere),
    [mapQuestEntries, settledHere, killOnly],
  )

  const anyMapQuests = useMemo(
    () => orderByChecks(mapQuestEntries.filter(({ quest }) => quest.anyMap && !killOnly.has(quest.id)), settledHere),
    [mapQuestEntries, settledHere, killOnly],
  )
  const anyQuestChecked = mapQuestEntries.some(({ quest }) => questChecks.has(quest.id))
  // «Отряд»: quests shared with squad mates get a light mark in «Квесты на карте».
  const squadShared = useSquadSharedQuests(state.raidMode)
  // «Квесты друзей»: friends' quest points in their colours (squad/FriendQuestsOnMap.tsx).
  const friendQuests = useFriendQuestLayer(state.raidMode, activeMap.id, data.quests, data.markers)
  // «Отложенные квесты»: the quests of this map first in the window; the button is the PC's (a right click puts one aside).
  const deferredRows = useMemo(() => deferredQuestRows(currentQuests, deferred, { maps: data.maps, itemsById, first: onThisMap, progress }), [currentQuests, deferred, data.maps, itemsById, onThisMap, progress])
  const deferredHere = deferredRows.some(({ quest }) => onThisMap(quest))
  const [deferredOpen, setDeferredOpen] = useState(false)
  const closeDeferred = useCallback(() => setDeferredOpen(false), [setDeferredOpen])
  const [questMenu, setQuestMenu] = useState<QuestDeferMenuState | null>(null)
  const closeQuestMenu = useCallback(() => setQuestMenu(null), [setQuestMenu])
  const questMenuOf = (quest: Quest) => (mobile ? undefined : (event: ReactMouseEvent) => {
    event.preventDefault()
    setQuestMenu({ questId: quest.id, title: quest.name, x: event.clientX, y: event.clientY, ...(isStoryQuest(quest) ? { chapter: 'change' as const } : { held: isCurrentTrackedQuest(quest, progress) }) })
  })

  useEffect(() => {
    if (!focusedQuestId) return
    const quest = data.quests.find((entry) => entry.id === focusedQuestId)
    // «Показать на карте» of a story chapter names its stage (?stage=N); without it the chapter's current stage is shown.
    const requestedStage = focusedStage != null && focusedStage !== '' && Number.isFinite(Number(focusedStage)) ? Number(focusedStage) : null
    const stageIndex = requestedStage ?? (quest ? currentStoryStageIndex(quest, progress) : 0)
    const ofQuest = (entry: MapMarker) => entry.questId === focusedQuestId && (entry.stageIndex == null || entry.stageIndex === stageIndex)
    const ofObjective = (entry: MapMarker) => ofQuest(entry) && entry.objectiveId === focusedObjectiveId
    const marker = (focusedObjectiveId ? mapMarkers.find(ofObjective) : undefined)
      ?? mapMarkers.find(ofQuest)
      ?? (focusedObjectiveId ? plottedMarkers.find(ofObjective) : undefined)
      ?? plottedMarkers.find(ofQuest)
    if (marker) {
      // A point picked on the map that already answers the address stays picked, not the quest's first point.
      const answers = (current: MapMarker) => current.source !== 'quest-info' && ofQuest(current)
        && (!focusedObjectiveId || current.objectiveId === focusedObjectiveId) && mapMarkers.some((entry) => entry.id === current.id)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- «Показать на карте» (?quest=…) selects its marker once the map's markers are known
      setSelectedMarker((current) => (current && answers(current) ? current : marker))
      return
    }
    if (quest) setSelectedMarker(questInfoMarker(quest, activeMap.id))
  }, [focusedQuestId, focusedStage, focusedObjectiveId, activeMap.id, mapMarkers, plottedMarkers, data.quests, progress])

  // ?lock=<marker id>: select the door and switch to its floor once, when the map's markers are known.
  const focusedLock = useMemo(() => (focusedLockId ? plottedMarkers.find((marker) => marker.id === focusedLockId) : undefined), [focusedLockId, plottedMarkers])
  useEffect(() => {
    if (!focusedLock) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the door from «Барахолка» is selected once its marker is known
    setSelectedMarker(keyDoorFocusCard(focusedLock, focusedLockKey, locale))
    setFloor(focusedLock.floor ?? baseFloor)
  }, [focusedLock, focusedLockKey, locale, baseFloor])

  /** `questId`: open that quest on the new map (the quest constructor jumps to the map a picked quest is plotted on). */
  const selectMap = (id: string, questId?: string) => {
    state.setSelectedMapId(id)
    setSelectedMarker(null)
    const nextMap = data.maps.find((entry) => entry.id === id)
    setFloor(nextMap ? mainFloor(nextMap) : baseFloor)
    navigate(questId ? `/maps/${id}?quest=${encodeURIComponent(questId)}` : `/maps/${id}`)
  }

  // The pin at an objective of the quest card: its own point, on this map first. An objective with several points goes through
  // them; one on another map opens that map (?objective= picks the point there).
  const objectivePoints = (questId: string, objectiveId: string) => {
    const own = data.markers.filter((marker) => marker.questId === questId && marker.objectiveId === objectiveId && hasRealCoordinates(marker))
    return [...own.filter((marker) => marker.mapId === activeMap.id), ...own.filter((marker) => marker.mapId !== activeMap.id)]
  }
  const goToObjectivePoint = (questId: string, objectiveId: string) => {
    const points = objectivePoints(questId, objectiveId)
    const at = points.findIndex((marker) => marker.id === selectedMarker?.id)
    const marker = points[(at + 1) % points.length]
    if (!marker) return
    if (marker.mapId !== activeMap.id) {
      state.setSelectedMapId(marker.mapId)
      setSelectedMarker(null)
      setFloor(marker.floor ?? mainFloor(data.maps.find((entry) => entry.id === marker.mapId) ?? activeMap))
      navigate(`/maps/${marker.mapId}?quest=${encodeURIComponent(questId)}&objective=${encodeURIComponent(objectiveId)}`)
      return
    }
    setFloor(marker.floor ?? baseFloor)
    showMarker(marker)
  }

  // Checking a quest takes its points off the map; if it is the selected one, the selection goes too.
  const toggleRaidCheck = (questId: string) => {
    const checking = !questChecks.has(questId)
    toggleQuestCheck(profileId, raidMode, questId)
    if (checking && (focusedQuestId === questId || selectedMarker?.questId === questId)) clearQuestSelection()
  }

  // «Добавить в отложенные»: the row and the points go; if it is the selected one, the selection goes too.
  const deferMapQuest = (questId: string) => {
    const quest = data.quests.find((entry) => entry.id === questId)
    if (quest) setDeferRequest({ quests: [{ id: quest.id, name: quest.name }], chosen: [quest.id] })
  }

  const dismissMapQuest = (questId: string) => {
    state.setManualQuestMark(state.raidMode, questId, 'absent')
    if (focusedQuestId === questId || selectedMarker?.questId === questId) clearQuestSelection()
  }

  const clearQuestSelection = () => {
    setSelectedMarker(null)
    const next = new URLSearchParams(params)
    next.delete('quest')
    next.delete('stage')
    next.delete('objective')
    next.delete('lock')
    next.delete('key')
    setParams(next, { replace: true })
  }

  // Report №114: the items behind a locked door (in a door's room box on its floor) carry a very small padlock.
  const roomsBehindDoors = useMemo(() => lockedRooms(activeMap, plottedMarkers), [activeMap, plottedMarkers])
  const lockedPoint = (marker: MapMarker) => LOCK_BADGE_LAYERS.has(markerLayerId(marker)) && behindLockedDoor(roomsBehindDoors, marker.position, marker.floor ?? baseFloor)
  // The key a key spot shows: the dearest of its keys, or of the needed ones while «Нужные ключи» is on.
  const keysShown = (marker: MapMarker) => {
    const all = keysOfPoint(marker)
    return neededKeysOnly ? all.filter((id) => neededKeys.has(id)) : all
  }
  const keyPictureOf = (marker: MapMarker) => {
    const top = keysShown(marker)[0]
    return itemCutout(top ? itemsById.get(top)?.iconUrl : undefined)
  }
  // Which points go on the canvas (report №104) and their pictures; the rest, the chosen ones and the hovered one are DOM icons.
  const draggableMarker = (marker: MapMarker) => (bossPlacement.active && markerLayerId(marker) === 'boss' && !bossPlacement.busy) || questEditor.canDrag(marker)
  const canvasIds = new Set<string>()
  const canvasPoints: CanvasPoint[] = []
  for (const marker of mapMarkers) {
    const layerId = markerLayerId(marker)
    if (!canvasMarkers || !CANVAS_LAYERS.has(layerId) || stationaryWeaponKind(marker)) continue
    const focused = selectedMarker?.id === marker.id || Boolean(focusedQuestId && marker.questId === focusedQuestId) || Boolean(editingQuest && marker.questId === editingQuest) || marker.id === focusedLockId
    if (focused || marker.questId || draggableMarker(marker)) continue
    const documentKinds = layerId === 'loot.documents' ? battlePassDocumentKindsOf(marker) : []
    const containerKind = layerId === 'loot.container' && markerStyle === 'modern' ? lootContainerKindOf(marker) : undefined
    const badge = documentKinds.length || containerKind ? floorBadge(marker.floor, baseFloor) : floorBadge(isOnRoof(marker) ? uiLabel(ROOF_FLOOR) : marker.floor, baseFloor)
    const name = layerId === 'loot.key' ? keySpotName(marker, itemsById) : ''
    canvasIds.add(marker.id)
    const keyPicture = layerId === 'loot.key' ? keyPictureOf(marker) : undefined
    const spec: SpriteSpec = keyPicture
      ? { src: keyPicture, size: [KEY_MARKER_SIZE, KEY_MARKER_SIZE], anchor: [KEY_MARKER_SIZE / 2, KEY_MARKER_SIZE / 2], filter: SHADOW_ITEM, ...(badge ? { badge } : {}), ...(lockedPoint(marker) ? { lock: true } : {}) }
      : canvasSpec(markerStyle, layerId, badge, Boolean(marker.possibleSpot), name, documentKinds, containerKind, usesPossibleSpawnBadge(marker), lockedPoint(marker))
    canvasPoints.push({ id: marker.id, latlng: marker.position, spec })
  }
  const canvasHidden = hoveredCanvasId && canvasIds.has(hoveredCanvasId) ? new Set([hoveredCanvasId]) : NO_IDS
  const domMarkers = mapMarkers.filter((marker) => !canvasIds.has(marker.id) || marker.id === hoveredCanvasId)

  const showMarker = (marker: MapMarker) => {
    setSelectedMarker(marker)
    const next = new URLSearchParams(params)
    next.delete('objective')
    if (marker.id !== focusedLockId) {
      next.delete('lock')
      next.delete('key')
    }
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
    next.delete('objective')
    setParams(next, { replace: true })
    setSelectedMarker(questInfoMarker(quest, activeMap.id))
  }

  /**
   * The quest constructor's list (owner, 13.10.2026: «нахожу в поиске, открывается карта с этим квестом»): a quest plotted
   * on this map opens at its first point; one plotted elsewhere opens on the map with most of its points; one without
   * points opens its window here (to add points and edit its texts).
   */
  const pickEditorQuest = (quest: Quest) => {
    questEditor.pick(quest.id)
    const here = firstQuestPoint(data.markers, quest.id, activeMap.id)
    if (here) { showMarker(here); return }
    const elsewhere = [...(questEditor.pointCounts.get(quest.id) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (elsewhere && elsewhere !== activeMap.id) { selectMap(elsewhere, quest.id); return }
    showQuest(quest)
  }

  // The quest list on the right: a second click on the open quest closes its window (owner, 10.10.2026).
  const toggleQuest = (quest: Quest, marker?: MapMarker) => {
    if (selectedMarker?.questId === quest.id) clearQuestSelection()
    else showQuest(quest, marker)
  }

  /** A row of «Устранения»: its quest, as from «Актуальные квесты», with the points left bright. */
  const openKillRow = (row: KillRow) => {
    setKillFocus(row.quest.id)
    toggleQuest(row.quest, row.marker)
  }

  /**
   * A press on a kill zone (report №98): «Устранения» on the PC with the zone's quest picked and its window below; a zone of
   * several quests gives the next one at the next press. The map stays where it is.
   */
  const pickKillZone = (zone: KillZone) => {
    const at = zone.rows.findIndex((row) => row.quest.id === selectedMarker?.questId)
    const row = zone.rows[(at + 1) % zone.rows.length]
    if (!row) return
    if (!mobile) setDetailTab('kills')
    setKillFocus(row.quest.id)
    if (selectedMarker?.questId !== row.quest.id) showQuest(row.quest)
  }

  const relatedQuest = selectedMarker?.questId
    ? data.quests.find((quest) => quest.id === selectedMarker.questId)
    : undefined
  const relatedAvailability = relatedQuest ? availability.get(relatedQuest.id) : undefined
  // The constructor's chosen stage of the edited quest is the one its window shows.
  const editorStage = questEditor.active && relatedQuest && questEditor.questId === relatedQuest.id && questEditor.goal.startsWith('s:') ? Number(questEditor.goal.slice(2)) : null
  const relatedStageIndex = relatedQuest ? (editorStage ?? selectedMarker?.stageIndex ?? currentStoryStageIndex(relatedQuest, progress)) : 0
  const relatedStage = relatedQuest?.stages?.[relatedStageIndex]
  const flyTarget = selectedMarker && selectedMarker.source !== 'quest-info' && hasRealCoordinates(selectedMarker)
    ? selectedMarker
    : null
  const sheetOpen = Boolean(selectedMarker)
  const selectedItem = selectedMarker?.itemId ? itemsById.get(selectedMarker.itemId) : undefined
  const sheetPoint = relatedQuest && flyTarget && flyTarget.questId === relatedQuest.id ? flyTarget : null
  // «Цели» grouped (в рейде / заложить / найти / сдать торговцу) with the map of each one when they are on several maps
  const relatedSheet = relatedQuest ? sheetObjectives(relatedQuest, { mapId: activeMap.id, maps: data.maps, itemsById, progress }) : null
  // «Галочка» on an objective of a current quest: done by hand (src/progression/mapObjectives.ts); the quest stays current.
  const toggleSheetObjective = relatedQuest && isCurrentTrackedQuest(relatedQuest, progress) && !questEditor.active
    ? (objectiveId: string, done: boolean) => {
      const def = questObjectiveDefs(relatedQuest).find((entry) => entry.id === objectiveId)
      if (!def) return
      state.setObjectiveValue(def, done ? def.target : 0)
      // «Пометить» closes the «Найти» at its place too (progression/objectivePairs.ts); taken back, it stays found.
      const found = done ? pairedFindDef(relatedQuest, def.id, data.markers) : undefined
      if (found) state.setObjectiveValue(found, found.target)
      // The last one on this map: the quest closes, its window with it, as a quest checked for the raid does.
      const ticked = Object.fromEntries([def, ...(found ? [found] : [])].map((entry) => [entry.id, manualObjectiveValue(entry, entry.target)]))
      if (done && mapObjectivesDone(relatedQuest, activeMap.id, { ...progress, objectiveProgress: { ...progress.objectiveProgress, ...ticked } })) clearQuestSelection()
    }
    : undefined
  const sheetFloor = sheetPoint ? floorLabel(sheetPoint, baseFloor) : null
  const selectedExit = selectedMarker ? extractGuideOf(selectedMarker.id) : undefined
  const selectedDocument = selectedMarker ? markerLayerId(selectedMarker) === 'loot.documents' : false
  const selectedWeapon = selectedMarker ? stationaryWeaponKind(selectedMarker) : undefined
  // The mini-map «Примерное место»: the PC only (owner, 07.11.2026: «в телефоне не так много места и нужно чем-то жертвовать»).
  // On the satellite view only (owner, 07.11.2026: «Если схема, примерное местоположение не нужно показывать»); the point's own text stays.
  const sheetMiniMap = plan.view === 'satellite'
  // the point's text, unless the window already says it (the stage's or an objective's own words)
  const sheetPointText = sheetPoint?.description && sheetPoint.description !== relatedStage?.description
    && !(sheetPoint.description === relatedQuest?.objectiveDetails?.find((objective) => objective.id === sheetPoint.objectiveId)?.description) ? sheetPoint.description : ''
  const sheetVisual = Boolean(!mobile && sheetPoint && !sheetPoint.approximate && (sheetMiniMap || sheetPointText))
  // The quest constructor: every text line of the quest window gets a pencil (components/QuestSheetEditing.tsx).
  const editingTexts = Boolean(questEditor.active && relatedQuest)
  /** The pencil of a point line / the right click «Редактировать»: the point's window (components/PointConstructor.tsx). */
  const editPoint = (markerId: string) => {
    const marker = data.markers.find((entry) => entry.id === markerId)
    if (marker) questEditor.openSettings({ marker })
  }
  /** The pencil of the requirements: the constructor's «Требования» of that quest. */
  const editRequirements = (quest: Quest) => {
    questEditor.setActive(true)
    if (questEditor.questId !== quest.id) questEditor.pick(quest.id)
    questEditor.setTab('requirements')
  }
  // Every emblem the map knows, drawn in the chosen marker style, for the point menu and window.
  const pointEmblems = useMemo<PointEmblem[]>(() => QUEST_POINT_ICONS.map((id) => ({ id, label: markerTypeLabel[id], icon: <LayerIcon style={markerStyle} layerId={id} active /> })), [markerStyle])

  return <div className="page map-page">
    <div ref={shellRef} className={`map-shell${layersOpen ? ' layers-open' : ''}${expanded ? ' is-map-fullscreen' : ''}`}>
      <aside className="map-sidebar">
        {expanded && <button type="button" className="button map-fullscreen-back" onClick={() => setExpanded(false)}><ArrowLeft size={14} aria-hidden="true" />{uiText('Назад')}</button>}
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
          {/* The phone's list is long: a way back to the map without scrolling past it (owner, 07.11.2026). */}
          {mobile && <button type="button" className="map-layers-close" aria-label={uiText('Закрыть')} title={uiText('Закрыть')} onClick={closeLayers}><X size={20} aria-hidden="true" /></button>}
          {uiText(layerGroups.filter((group) => group.title !== 'Спавны' || plottedMarkers.some((marker) => group.layers.includes(markerLayerId(marker)))).map((group) => (
            <div key={group.title} className="map-layer-group">
              <div className="map-side-title">{uiText(group.title)}</div>
              {uiText(group.layers.map((layerId) => {
                const meta = markerMeta[layerId]
                const visible = !state.hiddenMarkerLayers.includes(layerId)
                const onLayer = plottedMarkers.filter((marker) => markerLayerId(marker) === layerId && (!marker.questId || visibleQuestIds.has(marker.questId)) && !foundDocuments.has(marker.id))
                if ((layerId === 'loot.key' || layerId === 'btr' || layerId === 'spawn.pmc' || layerId === 'spawn.scav') && !onLayer.length) return null
                return <Fragment key={layerId}>
                  <button className={`layer-button ${visible ? 'active' : ''}`} onClick={() => layerId === 'loot.container' ? state.setContainerKinds([], !visible) : state.toggleMarkerLayer(layerId)}>
                    {/* The documents' row is only their common name: each kind has its picture on the map (owner, 05.11.2026). */}
                    {/* Owner, 09.11.2026: «у документов боевого пропуска нет картинки» — the first kind's own picture. */}
                    {layerId === 'loot.documents' ? <img className="layer-doc-picture" src={DOCUMENT_PICTURES.financial} alt="" width={18} height={18} /> : <LayerIcon style={markerStyle} layerId={layerId} />}
                    <span>{uiText(meta.label)}</span>
                    <small>{uiText(onLayer.length)}</small>
                  </button>
                  {layerId === 'loot.container' && <LootContainerRows markers={onLayer} layerVisible={visible} hidden={hiddenContainerKinds} onChange={state.setContainerKinds} />}
                  {layerId === 'loot.documents' && <DocumentLayerDetails mapId={activeMap.id} hasPoints={onLayer.length > 0 || foundDocuments.size > 0} foundCount={plottedMarkers.filter((marker) => foundDocuments.has(marker.id)).length} onAllPlaces={() => setDocumentGallery(true)} onBringBack={() => clearFoundDocuments(profileId, raidMode)} />}
                </Fragment>
              }))}
              {/* Owner, 08.11.2026: «добавь на точки на карте. И назови их места устранения… по нажатию они включаются и выключаются». */}
              {group.title === 'Ключи' && <NeededKeysButton count={plottedMarkers.filter((marker) => markerLayerId(marker) === 'loot.key' && keysOfPoint(marker).some((id) => neededKeys.has(id))).length} on={neededKeysOnly && !state.hiddenMarkerLayers.includes('loot.key')}
                onToggle={() => {
                  // lit only with the keys' layer on: off with the layer hidden turns both on, as the other rows do
                  const layerHidden = state.hiddenMarkerLayers.includes('loot.key')
                  if (neededKeysOnly && !layerHidden) { setNeededKeysOnly(false); return }
                  setNeededKeysOnly(true)
                  if (layerHidden) state.toggleMarkerLayer('loot.key')
                }} />}
              {group.title === 'Задания' && killZoneList.length > 0 && <KillZonesLayerButton count={killZoneList.length} shown={killZonesShown} onToggle={() => setKillZonesShown(!killZonesShown)} />}
            </div>
          )))}
          <MapRoomButtons map={activeMap} markers={plottedMarkers} />
        </div>
      </aside>

      <section className={`map-stage${(focusedQuestId && focusedQuestId !== killFocus && !killOnly.has(focusedQuestId)) || editingQuest ? ' has-quest-focus' : ''}${fullscreen ? ' is-fullscreen' : ''}${toolActive ? ' is-tool-active' : ''}${sketch.editing ? ' is-sketching' : ''}${route.picking ? ' is-route-picking' : ''}${bossPlacement.active || questEditor.adding ? ' is-boss-placing' : ''}`}>
        <div className="map-hud">
          {mobile ? <PhoneMapPicker maps={data.maps} activeId={activeMap.id} onPick={(id) => selectMap(id)} /> : <span>{uiText(activeMap.name.toUpperCase())}</span>}
          <MapViewToggle map={activeMap} value={mapView} shown={plan.view} onChange={chooseMapView} />
          <MapToolbar value={tools} onChange={setTools} />
          <MarkerStyleMenu value={markerStyle} onChange={chooseMarkerStyle} />
          {/* Beside the icons whether or not «Квесты друзей» is there: that button comes after it (owner, 06.11.2026). */}
          <MapSketchToolbar sketch={sketch} onBegin={() => setTools((current) => ({ ...current, tool: 'none' }))} />
          <button type="button" className={`map-layers-toggle${layersOpen ? ' active' : ''}`} aria-expanded={layersOpen} onClick={() => setLayersOpen((open) => !open)}><Layers size={14} />{uiText('Слои')}</button>
          {/* The phone has no «Отложенные квесты» over the map: «Устранения» stands in the HUD, after «Слои». */}
          {mobile && killList.length > 0 && <MapKillsButton count={killsOpenCount} open={killsOpen} onToggle={() => setKillsOpen((open) => !open)} buttonRef={killsButtonRef} />}
          <FriendQuestToggle layer={friendQuests} />
          {featureEnabled('raidRoute') && <RaidRouteControls route={route} />}
          <BossPlacementControls state={bossPlacement} />
          <QuestEditorButton state={questEditor} onToggle={(on) => { if (on) setBossActive(false) }} />
          {/* The recognised item under «Вид» (owner, 15.10.2026), on a line of its own below the controls. */}
          <MapItemCard />
        </div>
        {!mobile && <div className="map-deferred"><DeferredQuestsButton className="map-tool" count={deferredRows.length} onOpen={() => setDeferredOpen(true)} /></div>}
        {/* The phone: «Устранения» under its HUD button (the PC has it as a tab of the right panel). */}
        {mobile && killsOpen && killList.length > 0 && (
          <MapKillsWindow
            rows={killList}
            summary={killTotals}
            zoneCount={killZoneList.length} bothZones={bothKillZones}
            zonesShown={killZonesShown}
            onZones={setKillZonesShown}
            onOpen={(row: KillRow) => { openKillRow(row); setKillsOpen(false) }}
            selectedQuestId={selectedMarker?.questId}
            anchorRef={killsButtonRef}
            onClose={closeKills}
          />
        )}
        <div className="map-canvas-keyboard" onClickCapture={(event) => {
          const markerId = (event.target as HTMLElement).closest<HTMLElement>('[data-marker-id]')?.dataset.markerId
          const marker = markerId ? mapMarkers.find((entry) => entry.id === markerId) : undefined
          // a press on a point that dragged the map is no click on it (report №97): Leaflet drops that click itself
          if (marker && !toolActive && !mapDragged.current) { event.stopPropagation(); showMarker(marker) }
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
          <MapFloorLayers map={activeMap} plan={plan} floor={floor} />
          <MapRoomMarks map={activeMap} floor={floor} markers={plottedMarkers} items={itemsById} />
          <FocusOnMarker marker={flyTarget} closer={Boolean(flyTarget && flyTarget.id === focusedLockId)} />
          <MapRefCapture mapRef={mapRef} />
          {floorWheel && !mobile && floorOrder.length > 1 && <MapFloorWheel floors={floorOrder} floor={floor} onPick={setFloor} />}
          <MapDragGuard draggedRef={mapDragged} />
          <FollowContainerSize />
          {!toolActive && !route.picking && !bossPlacement.active && !questEditor.active && <ClearSelectionOnMapClick onClear={clearQuestSelection} />}
          {bossPlacement.active && !toolActive && <BossPlacementLayer state={bossPlacement} />}
          {questEditor.active && !toolActive && <QuestPointEditorLayer state={questEditor} />}
          {questEditor.active && proposal && <Marker position={[proposal.z, proposal.x]} icon={PROPOSAL_ICON} interactive={false} keyboard={false}><Tooltip permanent direction="top">{uiText('Место из заявок игроков')}</Tooltip></Marker>}
          <MapToolLayer value={tools} onChange={setTools} />
          <MapSketchLayer sketch={sketch} />
          {featureEnabled('raidRoute') && <RaidRouteLayer route={route} />}
          <LivePlayerMarker player={player} />
          <FriendQuestMarkers points={friendQuests.points} />
          {/* «Места устранения»: the kill quests' zones in the mines' dashes, orange for Scavs and any target, green for PMCs. */}
          {killZonesDrawn && <MapKillZones zones={killZoneList} focusedQuestId={selectedMarker?.questId ?? focusedQuestId} onPick={pickKillZone} />}
          {/* report №89: the sector of the stationary weapon pressed (owner: «нажал на какой-либо станочное оружие, там показывается радиус») */}
          <StationaryWeaponZone marker={selectedMarker && mapMarkers.some((marker) => marker.id === selectedMarker.id) ? selectedMarker : null} />
          {canvasMarkers && <MarkerCanvasLayer points={canvasPoints} hidden={canvasHidden} interactive={!toolActive}
            onHover={setHoveredCanvasId}
            onPick={(id) => { const marker = mapMarkers.find((entry) => entry.id === id); if (marker && !mapDragged.current) showMarker(marker) }} />}
          {uiText(domMarkers.map((marker) => {
            const layerId = markerLayerId(marker)
            const meta = markerMeta[layerId]
            const focused = selectedMarker?.id === marker.id || Boolean(focusedQuestId && marker.questId === focusedQuestId) || Boolean(editingQuest && marker.questId === editingQuest) || marker.id === focusedLockId
            const bust = layerId === 'boss' ? bossBust(marker) : undefined
            // Every point of a quest (zone, item, approximate spot) looks the same: one quest icon, no dashed «maybe» ring.
            const isQuestPoint = layerId === 'quest.zone' || layerId === 'quest.item'
            // «Минимализм»: every point a plate with its glyph, the documents and the mounted weapons too (owner, 09.11.2026).
            const documentKinds = layerId === 'loot.documents' && markerStyle !== 'minimal' ? battlePassDocumentKindsOf(marker) : []
            // Only in «Стандартные» for now (owner, 06.11.2026); the other styles keep the layer's own mark.
            const containerKind = layerId === 'loot.container' && markerStyle === 'modern' ? lootContainerKindOf(marker) : undefined
            const weaponKind = markerStyle === 'minimal' ? undefined : stationaryWeaponKind(marker)
            const keyPicture = layerId === 'loot.key' ? keyPictureOf(marker) : undefined
            const icon = keyPicture ? keyPictureIcon(keyPicture, focused, floorBadge(marker.floor, baseFloor), lockedPoint(marker)) : weaponKind ? stationaryWeaponIcon(weaponKind, focused, floorBadge(marker.floor, baseFloor)) : documentKinds.length
              ? documentIcon(documentKinds, focused, floorBadge(marker.floor, baseFloor), lockedPoint(marker))
              : containerKind ? containerIcon(containerKind, focused, floorBadge(marker.floor, baseFloor), lockedPoint(marker)) : markerIcon(markerStyle, isQuestPoint ? 'quest.zone' : layerId, focused, floorBadge(extractFloor(marker.id, 'ru') ?? (isOnRoof(marker) ? uiLabel(ROOF_FLOOR) : marker.floor), baseFloor), bust, bossShifts.get(marker.id) ?? exitFan.get(marker.id)?.shift ?? 0, !isQuestPoint && Boolean(marker.possibleSpot), exitFan.get(marker.id)?.noName ? '' : NAMED_LAYERS.has(layerId) ? exitShortName(marker.title, locale === 'en' ? 'en' : 'ru') : layerId === 'loot.key' ? keySpotName(marker, itemsById) : '', exitFan.get(marker.id)?.nameStyle, exitStates?.lit.has(marker.id) ? 'lit' : exitStates?.dim.has(marker.id) ? 'dim' : '', usesPossibleSpawnBadge(marker), lockedPoint(marker))
            return (
              <Marker
                key={marker.id}
                position={marker.position}
                icon={icon}
                alt={documentKinds.length ? battlePassDocumentTitle(documentKinds, locale) : uiText(marker.title)}
                bubblingMouseEvents={false}
                zIndexOffset={focused ? 800 : layerId === 'boss' ? 400 : 0}
                riseOnHover
                draggable={(bossPlacement.active && layerId === 'boss' && !bossPlacement.busy) || questEditor.canDrag(marker)}
                eventHandlers={{
                  add: (event) => {
                    event.target.getElement()?.setAttribute('data-marker-id', marker.id)
                    // a canvas point under the pointer: its tooltip at once, as if the pointer had come onto it
                    if (marker.id === hoveredCanvasId) (event.target as LeafletMarker).openTooltip()
                  },
                  mouseout: () => { if (marker.id === hoveredCanvasId) setHoveredCanvasId(null) },
                  // «Расставить боссов»: a boss dragged to a new place is saved at once (components/BossPlacement.tsx).
                  // «Квесты: правка точек»: a quest point dragged to the right place is saved at once (components/QuestPointEditor.tsx).
                  dragend: (event) => {
                    const point = (event.target as LeafletMarker).getLatLng()
                    if (questEditor.canDrag(marker)) { void questEditor.move(marker, point.lng, point.lat); return }
                    if (!bossPlacement.active || layerId !== 'boss') return
                    void bossPlacement.move(marker, point.lng, point.lat)
                  },
                  click: (event) => {
                    if (toolActive) return
                    event.originalEvent.stopPropagation()
                    // a press on the point that dragged the map is no click on it (report №97)
                    if (mapDragged.current) return
                    showMarker(marker)
                  },
                  // A right click on a point of a current quest: «Добавить в отложенные» (components/DeferredQuests.tsx).
                  // Owner app: a quest point or a point the owner added opens its menu (components/PointConstructor.tsx)
                  // while the constructor is on; off, the deferral menu has «Редактировать точку», which turns the
                  // constructor on and opens the point's quest window with its pencils and the menu, as before.
                  contextmenu: (event) => {
                    if (toolActive) return
                    const original = event.originalEvent
                    const editable = questEditor.canEdit(marker)
                    const isQuestPoint = marker.type === 'quest' || layerId === 'quest.zone' || layerId === 'quest.item'
                    const quest = !mobile && !questEditor.active && isQuestPoint && marker.questId && !deferred.has(marker.questId)
                      ? currentQuests.find((entry) => entry.id === marker.questId)
                      : undefined
                    if (!quest && !editable) return
                    original.preventDefault()
                    original.stopPropagation()
                    const editPoint = () => {
                      if (!questEditor.active) { setBossActive(false); questEditor.setActive(true) }
                      showMarker(marker)
                      questEditor.openMenu({ marker }, original.clientX, original.clientY)
                    }
                    if (!quest) { editPoint(); return }
                    setQuestMenu({ questId: quest.id, title: quest.name, x: original.clientX, y: original.clientY, ...(isStoryQuest(quest) ? {} : { held: isCurrentTrackedQuest(quest, progress) }), ...(editable ? { onEdit: editPoint } : {}) })
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
                {/* Phone: a tap on a quest point opens its quest window with the objective lit, ready to tick, as on the PC,
                    so the point has no card of its own over the map (owner, 02.11.2026: «Сделай более удобную отметку в
                    телефонах» — a player had to scroll down to the quest; before, 17.10.2026, the tap showed only that card). */}
                {!(mobile && marker.questId) && (
                  <Tooltip key={markerStyle} direction="right" offset={tooltipOffset(markerStyle, layerId, bust)} opacity={1} className="map-marker-tooltip">
                    <MapMarkerTooltip
                      marker={weaponKind ? { ...marker, title: STATIONARY_WEAPONS[weaponKind].name } : marker}
                      typeLabel={isPossibleSpawnSpot(marker) ? POSSIBLE_SPAWN_LABEL : markerTypeLabel[layerId]}
                      color={meta.color}
                      floor={floorLabel(marker, baseFloor)}
                      item={marker.itemId ? itemsById.get(marker.itemId) : undefined}
                      boss={layerId === 'boss' || marker.type === 'boss' ? resolveBossInfo(marker, bossProfiles) : undefined}
                      keys={marker.questId ? keysByQuest.get(marker.questId)?.map((key) => ({ item: key, owned: ownedKeys.has(key.id) })) : undefined}
                      spotKeys={layerId === 'loot.key' && (marker.keyCount ?? 1) > 1 ? <KeySpotKeys keyIds={keysShown(marker)} items={itemsById} owned={ownedKeys} compact /> : undefined}
                    />
                  </Tooltip>
                )}
              </Marker>
            )
          }))}
        </MapContainer>
        </div>
        {mobile && !fullscreen && <MapScrollRail />}
        {mobile && <PhoneMapFullscreenToggle fullscreen={fullscreen} onToggle={() => setFullscreen(!fullscreen)} />}
        {!mobile && <MapExpandToggle expanded={expanded} onToggle={() => setExpanded(!expanded)} />}
        {mobile && <PhoneMapQuests entries={[...localMapQuests, ...anyMapQuests]} mapId={activeMap.id} maps={data.maps} itemsById={itemsById} progress={progress} hidden={Boolean(relatedQuest)} onOpen={(entry) => showQuest(entry.quest, entry.marker)} {...(killOnly.size ? { emptyText: 'Квесты на устранение — в окне «Устранения».' } : {})}
          checks={{ checked: (questId) => questChecks.has(questId), settled: (questId) => doneHere.has(questId), onToggle: toggleRaidCheck, any: anyQuestChecked, autoReset: isDesktopShell(), onClear: () => clearQuestChecks(profileId, raidMode) }} />}
        {/* the phone has no panel under the map (owner, 08.11.2026): its floors are a button on the map */}
        {mobile && !relatedQuest && <PhoneMapFloors floors={floorOrder} floor={floor} playerFloor={playerOnFloor}
          {...(plan.floorWithoutScheme ? { note: 'У этого этажа нет своей схемы: показана общая схема и метки этажа. План этажа есть на «Спутнике».' } : plan.floorWithoutRender ? { note: 'У этого этажа нет своего снимка: показан общий «Спутник» и метки этажа. План этажа — в режиме «Схема».' } : {})}
          onPick={setFloor} />}
        {featureEnabled('raidRoute') && <RaidRouteHint route={route} />}

        <div className={`map-quest-sheet${sheetOpen ? ' is-open' : ''}${editingTexts ? ' is-editing' : ''}`} aria-hidden={!sheetOpen}>
          <QuestSheetEditProvider questId={relatedQuest?.id ?? ''} enabled={editingTexts}>
          {uiText(relatedQuest && (
            <div className={`map-quest-sheet-body${sheetVisual ? ' has-visual' : ''}${mobile ? ' has-close' : ''}`}>
              {mobile && <button className="icon-button map-marker-detail-close" onClick={clearQuestSelection} aria-label={uiText('Закрыть карточку')} title={uiText('Закрыть карточку')}><X size={16} /></button>}
              {/* Owner, 04.11.2026: «Справа сверху в этом окне нижнем с квестом будет кнопка "Чего-то не хватает" и знак вопроса». Named «Нашли неточность?» since 05.11.2026, by the owner. */}
              <button type="button" className="button small ghost map-quest-sheet-report" onClick={() => {
                const point = selectedMarker?.questId === relatedQuest.id ? selectedMarker : null
                setQuestReport(questReportFromMap(relatedQuest.id, activeMap.id, { ...(floor !== baseFloor ? { floor } : {}), ...(point?.objectiveId ? { objectiveId: point.objectiveId } : {}), ...(point?.stageIndex != null ? { stageIndex: point.stageIndex } : {}) }))
              }}><CircleHelp size={13} aria-hidden="true" />{uiText('Нашли неточность?')}</button>
              <div className="map-quest-sheet-copy">
                <div className="map-quest-sheet-eyebrow">{uiText(relatedQuest.trader)}</div>
                <h2 className="map-quest-sheet-title"><EditableText field="name" value={relatedQuest.name} /></h2>
                <div className="map-quest-sheet-meta">
                  <span className="tag brass">{uiText(questStatusLabel(relatedAvailability?.status ?? 'unknown', isStoryQuest(relatedQuest)))}</span>
                  {uiText(relatedQuest.kappa && <span className="tag brass">{uiText("капа")}</span>)}
                  <span className="tag">{uiText(activeMap.name)}</span>
                  {uiText(sheetFloor && <span className={`tag map-floor-tag${sheetFloor !== 'Основной' ? ' is-indoor' : ''}`}><Building2 size={11} /> {uiText(sheetFloor)}</span>)}
                  {uiText(relatedQuest.anyMap && <span className="tag">{uiText("Любая карта")}</span>)}
                  {uiText(sheetPoint?.guaranteedSpawn && <span className="tag brass">{uiText(GUARANTEED_SPAWN_TEXT)}</span>)}
                </div>
                <div className="map-quest-sheet-section">
                  {editingTexts && <p className="dim map-quest-sheet-description"><EditableText field="description" value={relatedQuest.description} /></p>}
                  {uiText(relatedStage ? (
                    <>
                      <h4>{uiText('Задача')}</h4>
                      <p><strong><EditableText field="stage-title" target={String(relatedStageIndex)} value={relatedStage.title} /></strong></p>
                      {uiText((relatedStage.description || editingTexts) && <p className="dim"><EditableText field="stage-description" target={String(relatedStageIndex)} value={relatedStage.description ?? ''} /></p>)}
                    </>
                  ) : (
                    <>
                      <h4>{uiText("Цели")}</h4>
                      {relatedSheet ? <QuestSheetObjectives key={relatedQuest.id} questId={relatedQuest.id} sheet={relatedSheet} trader={relatedQuest.trader} onEditPoint={editingTexts ? editPoint : undefined} onToggle={toggleSheetObjective}
                        focusObjectiveId={selectedMarker?.questId === relatedQuest.id ? selectedMarker.objectiveId : undefined}
                        pointOf={(objectiveId) => objectivePoints(relatedQuest.id, objectiveId).length > 0} onGoToPoint={(objectiveId) => goToObjectivePoint(relatedQuest.id, objectiveId)} /> : (
                        <ul className="map-quest-sheet-objectives">
                          {uiText((relatedQuest.objectives.length ? relatedQuest.objectives : [relatedQuest.description]).map((objective, index) => {
                            const objectiveId = relatedQuest.objectives.length ? relatedQuest.objectiveIds?.[index] : undefined
                            return <li key={`${relatedQuest.id}:${index}`}>{objectiveId ? <EditableText field="objective" target={objectiveId} value={objective} /> : uiText(objective)}</li>
                          }))}
                        </ul>
                      )}
                    </>
                  ))}
                  {uiText(sheetPoint?.approximate && (
                    <p className="map-quest-sheet-note"><MapPin size={12} />{uiText(" Точное место этапа неизвестно — метка стоит приблизительно.")}</p>
                  ))}
                  {/* The quest constructor's «Где искать» and «Требуется» (src/components/QuestCuratedInfo.tsx). */}
                  <QuestPointHints quest={relatedQuest} stageIndex={relatedStage ? relatedStageIndex : null} unattached={Boolean(relatedSheet && !relatedStage)} mapId={activeMap.id} onEditPoint={editingTexts ? editPoint : undefined} />
                  <QuestGuideImages quest={relatedQuest} />
                  <QuestCuratedRequirements quest={relatedQuest} items={data.items} progress={progress} onEdit={editingTexts ? () => editRequirements(relatedQuest) : undefined} />
                </div>
                {/* «Фото мест»: under the title on the PC, after the objectives on the phone (the DOM order). */}
                <QuestGuidePhotoStrip key={relatedQuest.id} questId={relatedQuest.id} focusObjectiveId={selectedMarker?.questId === relatedQuest.id ? selectedMarker.objectiveId : undefined}
                  {...(relatedSheet?.onlyHere ? { objectives: relatedSheet.groups.flatMap((group) => group.objectives) } : {})} />
                <Link
                  className="button map-quest-sheet-link"
                  to={questCardHref(relatedQuest)}
                >{uiText(" Открыть задание ")}<ChevronRight size={14} />
                </Link>
                <QuestPointCardActions state={questEditor} marker={selectedMarker} onDone={() => setSelectedMarker(null)} />
              </div>
              {uiText(sheetVisual && sheetPoint && (
                <figure className="map-quest-sheet-visual">
                  {sheetMiniMap && <MarkerMiniMap map={activeMap} view={plan.view} floor={sheetPoint.floor} position={sheetPoint.position} color={markerMeta[markerLayerId(sheetPoint)].color} />}
                  {sheetMiniMap && <figcaption>
                    <span>{uiText("Примерное место")}</span>
                    <span>{uiText(sheetFloor)}</span>
                  </figcaption>}
                  {uiText(sheetPointText && (
                    <p className="map-quest-sheet-point">{uiText(sheetPointText)}{editingTexts && questEditor.canEdit(sheetPoint) && <SheetPencil label="Изменить точку" onClick={() => editPoint(sheetPoint.id)} />}</p>
                  ))}
                </figure>
              ))}
            </div>
          ))}
          {uiText(selectedMarker && !relatedQuest && (
            <div className="map-quest-sheet-body map-marker-detail-card">
              <button className="icon-button map-marker-detail-close" onClick={() => setSelectedMarker(null)} aria-label={uiText('Закрыть карточку')} title={uiText('Закрыть карточку')}><X size={16} /></button>
              <div className="map-quest-sheet-eyebrow">{!selectedDocument && <>{uiText(isPossibleSpawnSpot(selectedMarker) ? POSSIBLE_SPAWN_LABEL : markerTypeLabel[markerLayerId(selectedMarker)])} · </>}{extractFloor(selectedMarker.id, locale) ?? uiText(floorLabel(selectedMarker, baseFloor))}</div>
              <h2 className="map-quest-sheet-title">{selectedDocument ? <BattlePassDocumentTitle marker={selectedMarker} /> : selectedWeapon ? uiText(STATIONARY_WEAPONS[selectedWeapon].name) : uiText(selectedMarker.title)}{questEditor.canEdit(selectedMarker) && <SheetPencil label="Изменить точку" onClick={() => questEditor.openSettings({ marker: selectedMarker })} />}</h2>
              {selectedExit
                ? <ExtractGuideCard key={selectedMarker.id} guide={selectedExit} />
                : selectedDocument
                  ? <BattlePassDocumentCard key={selectedMarker.id} marker={selectedMarker} onAllPlaces={() => setDocumentGallery(true)} onFound={() => { markDocumentFound(profileId, raidMode, selectedMarker.id); setSelectedMarker(null) }} />
                  : markerLayerId(selectedMarker) === 'loot.key' && !selectedMarker.possibleSpawn && keysOfPoint(selectedMarker).length > 1
                    ? <KeySpotKeys key={selectedMarker.id} keyIds={keysShown(selectedMarker)} items={itemsById} owned={ownedKeys} />
                    : selectedMarker.description && !repeatsTitle(selectedMarker.description, selectedMarker.title) && <p className="dim">{uiText(selectedMarker.description)}</p>}
              {selectedMarker.spotPhotos?.length ? <SpotPhotos key={`${selectedMarker.id}-photos`} photos={selectedMarker.spotPhotos} /> : null}
              {selectedMarker.hint && (selectedMarker.hint.items?.length || selectedMarker.hint.photoIds?.length) ? <PointHintLine hint={{ items: selectedMarker.hint.items, photoIds: selectedMarker.hint.photoIds }} /> : null}
              {selectedMarker.meta && !selectedExit && !selectedDocument && markerLayerId(selectedMarker) !== 'loot.container' && !(markerLayerId(selectedMarker) === 'loot.key' && (selectedMarker.keyCount ?? 1) > 1) && !repeatsTitle(selectedMarker.meta, selectedMarker.title) && <p>{uiText(selectedMarker.meta)}</p>}
              {selectedItem && !selectedDocument && <div className="map-marker-item-price"><span>{uiText('Барахолка')}</span><strong>{selectedItem.fleaPrice ? formatPrice(selectedItem.fleaPrice) : uiText('нет цены')}</strong></div>}
              <BossPlacementRemove state={bossPlacement} marker={selectedMarker} onRemoved={() => setSelectedMarker(null)} />
            </div>
          ))}
          </QuestSheetEditProvider>
        </div>
        <PointMenu state={questEditor} emblems={pointEmblems} />
        {documentGallery && <BattlePassDocumentGallery mapId={activeMap.id} onClose={closeDocumentGallery} />}
        {deferRequest && <QuestDeferDialog request={deferRequest} onClose={() => setDeferRequest(null)} onDeferred={(questIds) => { if (questIds.some((questId) => focusedQuestId === questId || selectedMarker?.questId === questId)) clearQuestSelection() }} />}
        <QuestDeferMenu menu={questMenu} onDefer={deferMapQuest} onAdd={(questId) => state.addManualQuests(state.raidMode, [questId])} onDismiss={dismissMapQuest} onChapter={(questId) => navigate(`/quests?filter=story&selected=${encodeURIComponent(questId)}&change=1`)} onClose={closeQuestMenu} />
        {questReport && <ReportDialog kind="bug" quest={questReport} onClose={closeQuestReport} />}
        {deferredOpen && <DeferredQuestsDialog rows={deferredRows} onRestore={(questIds) => { restoreDeferredQuests(profileId, raidMode, questIds); setDeferredOpen(false) }} onClose={closeDeferred} />}
        <PointSettingsWindow state={questEditor} emblems={pointEmblems} quests={data.quests} items={data.items} markers={data.markers} />
      </section>

      {/* The phone has no panel under the map (owner, 08.11.2026: «Найти точку… этажи… ниже идут актуальные квесты. Вот это убери
          все, потому что у нас есть на самой карте кнопка квест»): its quests, ticks and floors are on the map; only the quest
          constructor still opens here. */}
      {(!mobile || questEditor.active) && <aside className="map-detail">
        {/* Owner, 08.11.2026: «справа, где актуальные квесты, и там будет вот кнопка актуальные квесты и устранение». */}
        {questEditor.active
          ? <div className="panel-header"><div className="panel-title">{uiText('Конструктор квестов')}</div></div>
          : <MapDetailTabs tab={detailTab} onTab={setDetailTab} quests={localMapQuests.length + anyMapQuests.length} kills={killsOpenCount} />}
        {questEditor.active ? (
          <QuestEditorPanel state={questEditor} maps={data.maps} markers={data.markers} quests={data.quests} items={data.items} traders={data.traders} onPick={pickEditorQuest} onFocus={showMarker} onSelectMap={selectMap} />
        ) : (
          <>
          {featureEnabled('raidBriefing') && route.enabled && <RaidBriefingPanel mapId={activeMap.id} route={route.plan} compact />}
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
              {uiText(floorOrder.map((entry) => (
                <button key={entry} className={`button small ${floor === entry ? 'primary' : 'ghost'}`} onClick={() => setFloor(entry)} title={entry === playerOnFloor ? uiText(PLAYER_FLOOR_HINT) : undefined}>
                  {entry === playerOnFloor && <Crosshair size={12} aria-hidden="true" />}
                  {uiText(entry)}
                </button>
              )))}
              {plan.floorWithoutScheme && <small className="dim map-floor-note">{uiText('У этого этажа нет своей схемы: показана общая схема и метки этажа. План этажа есть на «Спутнике».')}</small>}
              {plan.floorWithoutRender && <small className="dim map-floor-note">{uiText('У этого этажа нет своего снимка: показан общий «Спутник» и метки этажа. План этажа — в режиме «Схема».')}</small>}
            </div>
          ))}
          {detailTab === 'kills' ? (
            <MapKillsPanel
              rows={killList}
              summary={killTotals}
              zoneCount={killZoneList.length} bothZones={bothKillZones}
              zonesShown={killZonesShown}
              onZones={setKillZonesShown}
              onOpen={openKillRow}
              onMenu={(row: KillRow) => questMenuOf(row.quest)}
              selectedQuestId={selectedMarker?.questId}
            />
          ) : uiText((localMapQuests.length > 0 || anyMapQuests.length > 0) ? (
            <div className="detail-section" style={{ padding: '0 12px 16px' }}>
              {/* The tab above says «Актуальные квесты»: no heading of their own, only «Любая карта» under them. */}
              {uiText(localMapQuests.length > 0 && (
                <>
                  {uiText(localMapQuests.map(({ quest, marker }) => (
                    <QuestMapRow
                      key={quest.id}
                      quest={quest}
                      selected={selectedMarker?.questId === quest.id}
                      onSelect={() => toggleQuest(quest, marker)}
                      squad={squadShared.get(quest.id)}
                      checked={questChecks.has(quest.id)}
                      settled={doneHere.has(quest.id)}
                      onToggleCheck={() => toggleRaidCheck(quest.id)}
                      onMenu={questMenuOf(quest)}
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
                      onSelect={() => toggleQuest(quest, marker)}
                      squad={squadShared.get(quest.id)}
                      checked={questChecks.has(quest.id)}
                      settled={doneHere.has(quest.id)}
                      onToggleCheck={() => toggleRaidCheck(quest.id)}
                      onMenu={questMenuOf(quest)}
                    />
                  )))}
                </>
              ))}
              {anyQuestChecked &&<QuestRaidChecksNote autoReset={isDesktopShell()} onClear={() => clearQuestChecks(profileId, raidMode)} />}
            </div>
          ) : (
            <div className="map-detail-empty">
              <div>
                <Target size={28} />
                {/* The quests that only ask to kill are under «Устранения», not gone. */}
                <h3>{uiText(killOnly.size ? 'Остались квесты на устранение' : deferredHere ? 'Квесты этой карты отложены' : 'Нет текущих квестов')}</h3>
                <p>{uiText(killOnly.size ? 'Они на вкладке «Устранения».' : deferredHere ? 'Вернуть их — кнопка «Отложенные квесты» над картой.' : 'На этой карте сейчас нет активных заданий.')}</p>
              </div>
            </div>
          ))}
          {featureEnabled('raidBriefing') && !route.enabled && detailTab === 'quests' && (localMapQuests.length > 0 || anyMapQuests.length > 0) && <RaidBriefingPanel mapId={activeMap.id} compact />}
          </>
        )}
      </aside>}
    </div>
  </div>
}

const mapViewOptions: Array<{ id: MapView; label: string; title: string; missing: string }> = [
  { id: 'satellite', label: 'Спутник', title: 'Спутник: объёмный рендер местности сверху', missing: 'Для этой карты есть только схема' },
  { id: 'digital', label: 'Схема', title: 'Схема: цифровая векторная карта', missing: 'Для этой карты нет схемы, только спутник' },
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

/** `onMenu`: the right click's menu («Добавить в отложенные»), on the PC. `settled`: every objective of the quest on this map is ticked. */
function QuestMapRow({ quest, selected, onSelect, squad, checked, settled, onToggleCheck, onMenu }: { quest: Quest; selected: boolean; onSelect: () => void; squad?: number; checked: boolean; settled: boolean; onToggleCheck: () => void; onMenu?: (event: ReactMouseEvent) => void }) {
  return (
    <div className={`catalog-card quest-catalog-card quest-map-row has-raid-check ${selected ? 'selected' : ''}${checked || settled ? ' is-raid-checked' : ''}`} onContextMenu={onMenu}>
      <button type="button" className="quest-map-row-main" onClick={onSelect}>
        <span className="quest-card-copy">
          <h3>{uiText(quest.name)}<SquadQuestTag count={squad} /></h3>
          <p>{uiText(quest.anyMap ? `Любая карта · ${quest.trader} · ур. ${quest.level}` : `${quest.trader} · ур. ${quest.level}`)}{uiText(quest.kappa ? ' · капа' : '')}</p>
        </span>
      </button>
      <QuestRaidCheck questName={quest.name} checked={checked} settled={settled} onToggle={onToggleCheck} />
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

/**
 * The map's box changes without a window resize: the owner's notice above the page arrives or goes (the phone's map
 * gives it its height), a sheet or the iPhone keyboard opens. Leaflet keeps the old size until told, and then centres
 * on and loads the pictures for a box that is no longer there.
 */
function FollowContainerSize() {
  const map = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  return null
}

/** `closer`: a door opened from «Барахолка» (?lock=) is shown two zoom steps closer (once), so the door can be told apart. */
function FocusOnMarker({ marker, closer = false }: { marker: MapMarker | null; closer?: boolean }) {
  const map = useMap()
  // The zoom picked for the door: a repeated focus on the same door (its marker rebuilt) keeps it instead of the mid-flight zoom.
  const closerZoom = useRef<{ id: string; zoom: number } | null>(null)
  useEffect(() => {
    if (!marker) return
    const [lat, lng] = marker.position
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    let zoom = Math.max(map.getZoom(), map.getMinZoom() + 2)
    if (closer) {
      if (closerZoom.current?.id !== marker.id) closerZoom.current = { id: marker.id, zoom: map.getZoom() + 2 }
      zoom = closerZoom.current.zoom
    }
    map.flyTo(marker.position, Math.min(zoom, map.getMaxZoom()), { duration: 0.55 })
  }, [map, marker, closer])
  return null
}

function ClearSelectionOnMapClick({ onClear }: { onClear: () => void }) {
  useMapEvents({
    click: (event) => { if (!wasCanvasPick(event)) onClear() },
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
  if (quest?.kind === 'story' && progress.taskProgress[quest.id]?.storyObjectives) {
    return visibleStoryObjectives(quest, progress).some(objective => !objective.completed && objective.stageIndex === marker.stageIndex)
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

/** «Заявки» → «Открыть в конструкторе»: the place the players agree on (?proposal=<x>,<z>, game metres). */
function proposalOf(raw: string | null): { x: number; z: number } | null {
  const [x, z] = (raw ?? '').split(',').map(Number)
  return raw && Number.isFinite(x) && Number.isFinite(z) && Math.abs(x!) <= 5000 && Math.abs(z!) <= 5000 ? { x: x!, z: z! } : null
}

const PROPOSAL_ICON = divIcon({ className: 'marker-icon', html: '<div class="quest-report-pin"><span></span></div>', iconSize: [24, 24], iconAnchor: [12, 12] })

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

/** Leaflet fills a new size on a window resize: once now and once the layout has settled. */
function resizeMapSoon() {
  window.dispatchEvent(new Event('resize'))
  // The page may be gone by then (a test's window torn down, CI 31.10.2026: «window is not defined»).
  window.setTimeout(() => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize')) }, 120)
}

/**
 * PC: the map on the whole window of the app (owner, 01.11.2026: «при полноэкранном режиме открывается в весь экран
 * приложения, все кнопки скрываются, по кнопке ESC отмена. или кнопка назад… должны оставаться квесты справа… и окно
 * локаций и меток слева»). The app's menu and top bar hide; Esc or «Назад» bring them back. Not remembered: the map opens
 * in the window each time.
 */
function useDesktopMapFullscreen(enabled: boolean) {
  const [on, setOn] = useState(false)
  const active = enabled && on
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    root.setAttribute('data-map-fullscreen-pc', '')
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setOn(false) }
    window.addEventListener('keydown', onKey)
    resizeMapSoon()
    return () => {
      root.removeAttribute('data-map-fullscreen-pc')
      window.removeEventListener('keydown', onKey)
      resizeMapSoon()
    }
  }, [active])
  return [active, setOn] as const
}

/**
 * PC: the map's window exactly as tall as the room left under the top bar, «Назад» and any notice, and the page itself never
 * scrolls (owner, 01.11.2026: «окно карты… уезжает вниз и половину карты не видно… должна быть всегда на месте»). The fixed
 * height in CSS did not count «Назад», so the page was taller than the window and the map slid down with it.
 */
function useMapFitsWindow(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.setAttribute('data-map-page', '')
    window.scrollTo(0, 0)
    let last = ''
    const fit = () => {
      const shell = ref.current
      if (!shell) return
      const top = shell.getBoundingClientRect().top + window.scrollY
      const height = `${Math.max(420, Math.floor(window.innerHeight - top - 14))}px`
      if (height === last) return
      last = height
      shell.style.setProperty('--map-fit-height', height)
      resizeMapSoon()
    }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    const content = document.querySelector('.content')
    if (observer && content) observer.observe(content)
    window.addEventListener('resize', fit)
    return () => {
      root.removeAttribute('data-map-page')
      observer?.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [enabled])
  return ref
}

/** PC: the four corners at the bottom right of the map — the map on the whole window, and back (useDesktopMapFullscreen). */
function MapExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const label = uiText(expanded ? 'Выйти из полноэкранного режима (Esc)' : 'Карта на весь экран')
  return <button type="button" className={`map-expand-toggle${expanded ? ' is-expanded' : ''}`} aria-pressed={expanded} aria-label={label} title={label} onClick={onToggle}>
    {expanded ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
  </button>
}

/**
 * Phone: a strip at the right edge of the map that scrolls the page, not the map (owner, 17.10.2026: «когда на весь
 * экран карта, а меню нету в кадре, то невозможно листнуть вниз или вверх, потому что листается карта»). A finger drags
 * the page natively (touch-action: pan-y, outside Leaflet); the arrows move it by most of a screen. 20.10.2026 («сделай
 * аккуратнее, приятнее, чтобы человек понимал, что туда можно нажать и пролистать… мимо неё»): a slim pill that says
 * «Листать» between the arrows.
 */
function MapScrollRail() {
  const scrollBy = (direction: 1 | -1) => window.scrollBy({ top: direction * Math.round(window.innerHeight * 0.6), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  return <div className="map-scroll-rail" title={uiText('Здесь страница листается мимо карты')}>
    <button type="button" className="map-scroll-rail-arrow" onClick={() => scrollBy(-1)} aria-label={uiText('Прокрутить страницу вверх')}><ChevronUp size={16} /></button>
    <span className="map-scroll-rail-grip" aria-hidden="true"><span className="map-scroll-rail-label">{uiText('Листать')}</span></span>
    <button type="button" className="map-scroll-rail-arrow" onClick={() => scrollBy(1)} aria-label={uiText('Прокрутить страницу вниз')}><ChevronDown size={16} /></button>
  </div>
}

/**
 * Phone: «Карта на весь экран» (owner, 20.10.2026: «сделай карту в весь экран кнопку, прям что бы на всю открывалась и
 * можно было поворачивать»; 20.10.2026: «там будут тапаться квесты и появляться окна все»). The map itself covers the
 * screen, the top and bottom bars included; «Квесты», the map list and the quest window keep working inside it, and a
 * turned phone gets the map fitted to the new screen (Leaflet follows the container's size). The same button (top right)
 * or Escape brings the page back; leaving the page leaves the full screen too.
 */
function usePhoneMapFullscreen(mobile: boolean) {
  const [fullscreen, setFullscreen] = useState(false)
  const on = mobile && fullscreen
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    root.setAttribute('data-map-fullscreen', '')
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      root.removeAttribute('data-map-fullscreen')
      window.removeEventListener('keydown', onKey)
    }
  }, [on])
  return [on, setFullscreen] as const
}

function PhoneMapFullscreenToggle({ fullscreen, onToggle }: { fullscreen: boolean; onToggle: () => void }) {
  const label = uiText(fullscreen ? 'Свернуть карту' : 'Карта на весь экран')
  return <button type="button" className={`phone-map-fullscreen${fullscreen ? ' is-on' : ''}`} aria-pressed={fullscreen} aria-label={label} title={label} onClick={onToggle}>
    {fullscreen ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
  </button>
}
