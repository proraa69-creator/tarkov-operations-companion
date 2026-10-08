import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { divIcon, latLng, type FitBoundsOptions, type LatLngBoundsExpression, type Map as LeafletMap } from 'leaflet'
import { MapContainer, Marker, useMap } from 'react-leaflet'
import { newMarkerImages } from '../assets/map-markers-new'
import { createMapCrs, toLeafletBounds } from '../components/mapCrs'
import { MapFloorLayers } from '../components/MapFloorLayers'
import { mainFloor } from '../data/mapProjection'
import { planMapLayers, resolveMapView } from '../data/mapView'
import { PLAYER_FLOOR_HINT, useAutoFloor } from '../data/useAutoFloor'
import type { GameMap, MapView } from '../domain/types'
import type { PlayerPosition } from './screenshotPosition'
import { playerMarkerSvg, type PlayerMarkerStyle } from './playerMarker'
import type { ItemOverlayInfo, ItemOverlayPayload, MinimapMarker, MinimapPayload } from './types'
import './overlay.css'
import { MateBadge } from './MateBadge'
import { minimapWidth } from './minimapSize'
import { NO_QUEST, clearQuest, gameLatLng, pressQuest, questClusters, questStepLabel, questTarget, readMinimapView, saveMinimapView, stablePayload, type QuestCycle, type QuestTarget } from './minimapView'
import { Grip, X, Scaling, Contrast, Crosshair } from 'lucide-react'

export type OverlayKind = 'item' | 'minimap'

export function overlayKind(hash: string): OverlayKind | null {
  const match = /^#\/overlay\/(item|minimap)/.exec(hash)
  return match ? match[1] as OverlayKind : null
}

export function OverlayApp({ kind }: { kind: OverlayKind }) {
  useEffect(() => {
    document.documentElement.classList.add('overlay-root', `overlay-${kind}`)
  }, [kind])
  return kind === 'item' ? <ItemOverlay /> : <MinimapOverlay />
}

const rub = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`

function ItemOverlay() {
  const [payload, setPayload] = useState<ItemOverlayPayload>({ state: 'loading' })
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => window.tarkovDesktop?.onOverlay?.('overlay:item', setPayload), [])
  // The window takes the size of the card: long names wrap instead of running off the edge.
  useFitWindow(rootRef)

  if (payload.state === 'loading') {
    return (
      <div ref={rootRef} className="eft-card">
        <div className="eft-card-head"><span>{uiText('Поиск предмета')}</span></div>
        <div className="eft-card-body is-loading"><span className="ov-spinner" />{uiText('Распознаю…')}</div>
      </div>
    )
  }
  if (payload.state === 'not-found') {
    return (
      <div ref={rootRef} className="eft-card">
        <div className="eft-card-head"><span>{uiText('Предмет не распознан')}</span></div>
        <div className="eft-card-body"><p className="eft-hint">{uiText('Наведите курсор на предмет, дождитесь подсказки игры с названием и нажмите клавишу ещё раз.')}</p></div>
      </div>
    )
  }
  const trader = payload.bestTrader
  return (
    <div ref={rootRef} className="eft-card">
      <div className="eft-card-head">
        <span>{uiText(payload.name)}</span>
        {payload.collector && <em className="eft-kappa" title={uiText('Нужен для задания «Коллекционер»')}>{uiText('Каппа')}</em>}
        <MateBadge show={payload.mate === true} />
      </div>
      {payload.keep && <KeepBadgeLine keep={payload.keep} />}
      <div className="eft-card-body">
        {payload.iconUrl && <div className={`eft-card-icon${payload.weaponPreset ? ' is-weapon' : ''}`}><img src={payload.iconUrl} alt={payload.weaponPreset ? uiText('Стандартная сборка оружия') : ''} title={payload.weaponPreset ? uiText('Стандартная сборка: обвесы и цвет могут отличаться') : undefined} /></div>}
        <dl className="eft-prices">
          <div><dt>{uiText('Барахолка')}</dt><dd>{uiText(payload.fleaPrice ? rub(payload.fleaPrice) : '—')}</dd></div>
          <div><dt>{uiText(trader ? trader.name : 'Торговец')}</dt><dd>{uiText(trader ? rub(trader.price) : '—')}</dd></div>
        </dl>
      </div>
    </div>
  )
}

/** «НЕ ПРОДАВАТЬ · нужно N · квест X (FIR)»: the item is on the keep list of the current mode. */
function KeepBadgeLine({ keep }: { keep: NonNullable<ItemOverlayInfo['keep']> }) {
  const source = keep.kind === 'hideout' ? 'убежище' : keep.kind === 'kappa' ? 'капа' : 'квест'
  return (
    <div className="eft-keep" role="note">
      <strong>{uiText('НЕ ПРОДАВАТЬ')}</strong>
      <span>· {uiText(`нужно ${keep.remaining}`)}{keep.remaining < keep.need ? ` / ${keep.need}` : ''}</span>
      <span>· {uiText(source)} {uiText(keep.reason)}{keep.foundInRaid ? ' (FIR)' : ''}{keep.more > 0 ? uiText(` +${keep.more}`) : ''}</span>
    </div>
  )
}

/** A slider moved here wins over the values in a payload that arrives within this time (sent before the move was saved). */
const LOCAL_EDIT_HOLD_MS = 1500

function MinimapOverlay() {
  const [payload, setPayload] = useState<MinimapPayload | null>(null)
  const [position, setPosition] = useState<PlayerPosition | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [opacity, setOpacity] = useState(0.9)
  const [width, setWidth] = useState(420)
  /** The chosen quest and which of its rooms (or the whole map) its button showed last. */
  const [questCycle, setQuestCycle] = useState<QuestCycle>(NO_QUEST)
  const [visibilityRevision, setVisibilityRevision] = useState(0)
  /** The floor shown, for the map it was chosen on: the next raid's map starts on its main level. */
  const [floorChoice, setFloorChoice] = useState<{ mapId: string; floor: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  /** When a slider here was last moved: a payload sent meanwhile carries older values and must not move it back. */
  const localEditAt = useRef(0)

  useEffect(() => {
    const offMap = window.tarkovDesktop?.onOverlay?.('overlay:minimap', (next) => {
      setPayload((current) => stablePayload(current, next))
      if (next.state !== 'ready' || Date.now() - localEditAt.current < LOCAL_EDIT_HOLD_MS) return
      if (typeof next.opacity === 'number') setOpacity(next.opacity)
      setWidth(minimapWidth(next.minimapWidth))
    })
    const offPosition = window.tarkovDesktop?.onOverlay?.('overlay:position', setPosition)
    const offVisibility = window.tarkovDesktop?.onOverlay?.('overlay:visibility', visible => {
      if (visible) setVisibilityRevision(value => value + 1)
    })
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { offMap?.(); offPosition?.(); offVisibility?.(); window.clearInterval(timer) }
  }, [])

  // «Этаж по скриншоту»: each new screenshot shows the player's floor; a floor clicked here stays until the next one
  // (opening the minimap again re-sends the same position, which changes nothing).
  const readyMap = payload?.state === 'ready' ? payload.map : undefined
  const readyMapId = readyMap?.id
  const chooseFloor = useCallback((floor: string) => { if (readyMapId) setFloorChoice({ mapId: readyMapId, floor }) }, [readyMapId])
  const playerOnFloor = useAutoFloor(readyMap, position, chooseFloor)

  // The overlay is click-through except over its controls.
  useInteractiveZones(rootRef, visibilityRevision, payload?.state)
  // The window follows the content: no empty frame around a wide or tall map.
  useFitWindow(rootRef, visibilityRevision)

  if (!payload) return <div ref={rootRef} className="ov-card ov-minimap-empty"><span className="ov-spinner" />{uiText("Загрузка карты…")}</div>
  if (payload.state === 'no-data') {
    return (
      <div ref={rootRef} className="ov-card ov-minimap-empty">
        <p className="ov-title">{uiText("Мини-карта")}</p>
        <p className="ov-muted">{uiText(payload.reason ?? 'Нет данных карты.')}</p>
      </div>
    )
  }
  const age = position ? Math.max(0, Math.round((now - position.at) / 1000)) : null
  const quests = payload.quests ?? []
  // A quest that left the list (done, or another map) is not selected any more: the map follows the player again.
  const selected = quests.find((quest) => quest.questId === questCycle.questId)
  const selectedQuest = selected?.questId ?? null
  const clusters = questClusters(payload.markers, selectedQuest)
  const target = selectedQuest ? questTarget(clusters, questCycle.step) : null
  // «Точка 2 из 3» while stepping through the stops of a quest, «Все точки задания» / «Вся карта» after the last one.
  const stepLabel = questStepLabel(target)
  const floors = payload.map.floors ?? []
  const floor = floorChoice?.mapId === payload.map.id ? floorChoice.floor : mainFloor(payload.map)
  // The map comes with only the drawing chosen on the Maps page left in it (mapForView): tiles when it has them.
  const view = payload.view ?? resolveMapView(payload.map, 'satellite')
  const changeOpacity = (value: number) => {
    localEditAt.current = Date.now()
    setOpacity(value)
    void window.tarkovDesktop?.experimental?.updateSettings({ minimapOpacity: value })?.catch(() => undefined)
  }
  const changeWidth = (value: number) => {
    localEditAt.current = Date.now()
    setWidth(value)
    void window.tarkovDesktop?.experimental?.updateSettings({ minimapWidth: value })?.catch(() => undefined)
  }
  return (
    <div ref={rootRef} className="ov-minimap" style={{ '--ov-opacity': opacity, width } as CSSProperties}>
      <div
        className="ov-minimap-head ov-interactive ov-drag"
        title={uiText('Перетащите, чтобы передвинуть мини-карту')}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          if ((event.target as HTMLElement).closest('input, button, label')) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          window.tarkovDesktop?.overlayDrag?.(true)
        }}
        onPointerUp={() => window.tarkovDesktop?.overlayDrag?.(false)}
        onPointerCancel={() => window.tarkovDesktop?.overlayDrag?.(false)}
        onLostPointerCapture={() => window.tarkovDesktop?.overlayDrag?.(false)}
      >
        <Grip className="ov-drag-grip" size={14} aria-hidden="true" />
        <strong title={uiText(payload.map.name)}>{uiText(payload.map.name)}</strong>
        <span className={age != null && age < 6 ? 'is-live' : ''}>{uiText(age == null ? 'позиция: нет' : age < 6 ? '● live' : `${formatAge(age)} назад`)}</span>
        <button className="ov-icon-button" type="button" title={uiText('Скрыть мини-карту')} aria-label={uiText('Скрыть мини-карту')} onClick={() => void window.tarkovDesktop?.experimental?.toggleMinimap()}><X size={14} /></button>
      </div>
      <MinimapMap width={width} visibilityRevision={visibilityRevision} map={payload.map} view={view} floor={floor} markers={payload.markers} position={position} playerMarker={payload.playerMarker ?? 'arrow'} questId={selectedQuest} questSeq={questCycle.seq} target={target} />
      {floors.length > 1 && (
        <div className="ov-floor-list ov-interactive" role="group" aria-label={uiText('Этаж карты')}>
          {floors.map((entry) => (
            <button key={entry} type="button" className={entry === floor ? 'active' : ''} aria-pressed={entry === floor} onClick={() => chooseFloor(entry)} title={entry === playerOnFloor ? uiText(PLAYER_FLOOR_HINT) : undefined}>
              {entry === playerOnFloor && <Crosshair size={11} aria-hidden="true" />}
              {uiText(entry)}
            </button>
          ))}
        </div>
      )}
      <div className="ov-minimap-controls ov-interactive">
        <label className="ov-opacity" title={uiText('Прозрачность')}><Contrast size={14} aria-hidden="true" />
          <input aria-label={uiText('Прозрачность')} type="range" min={30} max={100} step={5} value={Math.round(opacity * 100)} onChange={(event) => changeOpacity(Number(event.target.value) / 100)} />
        </label>
        <label className="ov-opacity" title={uiText('Размер мини-карты')}><Scaling size={14} aria-hidden="true" />
          <input aria-label={uiText('Размер мини-карты')} type="range" min={280} max={720} step={20} value={width} onChange={(event) => changeWidth(minimapWidth(Number(event.target.value)))} />
        </label>
      </div>
      {quests.length > 0 && (
        <ul className="ov-quest-list ov-interactive">
          {quests.map((quest) => (
            <li key={quest.questId}>
              {/* Each press moves to the quest's next stop; after the last one all its points, then the first again. */}
              <button type="button" className={selectedQuest === quest.questId ? 'active' : ''} aria-pressed={selectedQuest === quest.questId} onClick={() => setQuestCycle((current) => pressQuest(current, quest.questId, questClusters(payload.markers, quest.questId).length))} title={uiText(`${quest.name} · ${quest.trader}`)}>
                {uiText(quest.name)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="ov-quest-task ov-interactive">
          <div className="ov-quest-task-head">
            <strong>{uiText(selected.name)}</strong><span>{uiText(selected.trader)}</span>
            {stepLabel && <em className="ov-quest-step">{uiText(stepLabel)}</em>}
            {/* The quest button now cycles, so taking the quest off the map (and following the player again) is here. */}
            <button className="ov-icon-button" type="button" title={uiText('Снять выбор задания')} aria-label={uiText('Снять выбор задания')} onClick={() => setQuestCycle(clearQuest)}><X size={12} /></button>
          </div>
          <ul>{selected.objectives.map((objective) => <li key={objective}>{uiText(objective)}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

function formatAge(seconds: number) {
  return seconds < 90 ? `${seconds} с` : `${Math.round(seconds / 60)} мин`
}

function useInteractiveZones(rootRef: RefObject<HTMLDivElement | null>, visibilityRevision: number, state: string | undefined) {
  useEffect(() => {
    const report = window.tarkovDesktop?.overlayZones
    if (!report) return
    let last = ''
    let sentAt = 0
    // The main process hit-tests the cursor against these rectangles (see watchMinimapHits). They are sent
    // again every few seconds even unchanged, so the main process never keeps stale zones (window re-shown).
    const send = () => {
      const zones = [...document.querySelectorAll<HTMLElement>('.ov-interactive')].map((element) => {
        const rect = element.getBoundingClientRect()
        return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
      }).filter((zone) => zone.width > 0 && zone.height > 0)
      const key = JSON.stringify(zones)
      if (key !== last || Date.now() - sentAt > 2000) { last = key; sentAt = Date.now(); report(zones) }
    }
    send()
    const timer = window.setInterval(send, 400)
    const observer = new ResizeObserver(send)
    if (rootRef.current) observer.observe(rootRef.current)
    // While a button is held over a control (dragging the slider or the map) the window must keep the mouse,
    // even when the cursor slides off the control, or the release is lost and the page stays "pressed".
    const hold = window.tarkovDesktop?.overlayHold
    const down = (event: PointerEvent) => { if ((event.target as HTMLElement | null)?.closest('.ov-interactive')) hold?.(true) }
    const up = () => hold?.(false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('blur', up)
    return () => {
      window.clearInterval(timer)
      observer.disconnect()
      report([])
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', up)
      hold?.(false)
    }
  }, [rootRef, visibilityRevision, state])
}

function useFitWindow(rootRef: RefObject<HTMLDivElement | null>, visibilityRevision = 0) {
  useEffect(() => {
    const resize = window.tarkovDesktop?.overlayResize
    const element = rootRef.current
    if (!resize || !element) return
    const fit = () => resize(Math.ceil(element.offsetWidth + 8), Math.ceil(element.offsetHeight + 8))
    // A hidden window may reopen with unchanged content, so ResizeObserver alone is not enough.
    const frame = requestAnimationFrame(fit)
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [rootRef, visibilityRevision])
}


/** Height the map needs at this width, from the projected map bounds (rotation included). */
function mapAspect(map: GameMap) {
  const crs = createMapCrs(map)
  const [[a0, a1], [b0, b1]] = toLeafletBounds(map) as [[number, number], [number, number]]
  const p1 = crs.latLngToPoint(latLng(a0, a1), 0)
  const p2 = crs.latLngToPoint(latLng(b0, b1), 0)
  const width = Math.abs(p2.x - p1.x)
  const height = Math.abs(p2.y - p1.y)
  return width > 0 && height > 0 ? height / width : 1
}

function MinimapMap({ width, visibilityRevision, map, view, floor, markers, position, playerMarker, questId, questSeq, target }: {
  width: number; visibilityRevision: number; map: GameMap; view: MapView; floor: string; markers: MinimapMarker[]; position: PlayerPosition | null; playerMarker: PlayerMarkerStyle
  /** The quest whose button was pressed last (null: none), the press counter and where that press sends the map. */
  questId: string | null; questSeq: number; target: QuestTarget | null
}) {
  const selectedQuest = questId
  const crs = useMemo(() => createMapCrs(map), [map])
  // Stable between renders: the overlay re-renders every second (the «live» age), and a new bounds object
  // used to re-run the fit below — the map jumped back to the whole map and lost the player's zoom.
  const bounds = useMemo(() => toLeafletBounds(map), [map])
  const height = Math.round(Math.min(560, Math.max(180, width * mapAspect(map))))
  // The chosen floor is drawn as on the Maps page: its own render tiles or its plan from the scheme.
  const plan = useMemo(() => planMapLayers(map, view, floor), [map, view, floor])
  // The view the player left by hand on this map, read once when the map is created (it is keyed by map id).
  const savedView = useMemo(() => readMinimapView(map.id), [map.id])
  // The points the map shows now (the stop, or all of them on the overview) pulse; the quest's other points stay
  // marked; everything else fades while a quest is chosen.
  const focus = new Set((target?.points ?? []).map((point) => point.join(',')))
  const markerState = (marker: MinimapMarker): MarkerState => {
    if (!selectedQuest) return 'normal'
    if (marker.questId !== selectedQuest) return 'dim'
    return focus.has(marker.position.join(',')) ? 'focus' : 'quest'
  }
  return (
    <MapContainer
      key={map.id}
      className="ov-minimap-map ov-interactive"
      style={{ width, height }}
      crs={crs}
      {...(savedView ? { center: savedView.center, zoom: savedView.zoom } : { bounds, boundsOptions: { padding: [0, 0] } })}
      zoomSnap={0}
      minZoom={Math.min(-5, map.minZoom ?? -1)}
      maxZoom={Math.max(7, map.maxZoom ?? 3)}
      zoomControl={false}
      attributionControl={false}
      dragging
      scrollWheelZoom
      wheelPxPerZoomLevel={90}
      doubleClickZoom
      keyboard={false}
    >
      <MapFloorLayers map={map} plan={plan} floor={floor} />
      {markers.map((marker) => {
        const state = markerState(marker)
        return <Marker key={marker.id} position={marker.position} icon={minimapIcon(marker.layerId, state)} interactive={false} zIndexOffset={MARKER_Z[state]} />
      })}
      <MapSize width={width} height={height} visibilityRevision={visibilityRevision} />
      <FocusQuest questId={selectedQuest} seq={questSeq} target={target} mapBounds={bounds} mapId={map.id} hasPlayer={Boolean(position)} />
      <ViewMemory mapId={map.id} enabled={!selectedQuest} />
      <PlayerMarker position={position} style={playerMarker} followDisabled={Boolean(selectedQuest)} keepZoom={Boolean(savedView)} />
    </MapContainer>
  )
}

function MapSize({ width, height, visibilityRevision }: { width: number; height: number; visibilityRevision: number }) {
  const map = useMap()
  useEffect(() => {
    // MapContainer only applies its style prop on mount.
    const container = map.getContainer()
    container.style.width = `${width}px`
    container.style.height = `${height}px`
    map.invalidateSize({ animate: false })
  }, [map, width, height, visibilityRevision])
  return null
}

/** How long the map glides to a quest stop or the overview (seconds). */
const FLY_S = 0.6

/**
 * Moves the map once per press of a quest button (or the clear button) — never on an ordinary re-render or a new
 * payload. Every move glides (flyTo / flyToBounds: pan and zoom together, from where the map is): no teleport and no
 * zoom-animation jump. A stop is centred at a readable zoom (deeper if the player zoomed in further), the overview fits
 * every point of the quest (a single-stop quest: the whole map). Clearing the quest leaves the map to the player
 * marker, or goes back to the remembered view.
 */
function FocusQuest({ questId, seq, target, mapBounds, mapId, hasPlayer }: { questId: string | null; seq: number; target: QuestTarget | null; mapBounds: LatLngBoundsExpression; mapId: string; hasPlayer: boolean }) {
  const map = useMap()
  const shownSeq = useRef(seq)
  useEffect(() => {
    if (shownSeq.current === seq) return
    shownSeq.current = seq
    if (!questId) {
      if (hasPlayer) return
      const home = readMinimapView(mapId)
      if (home) glide(map, { center: home.center, zoom: home.zoom })
      else glide(map, { bounds: mapBounds, options: { padding: [0, 0] } })
      return
    }
    if (!target) return
    // Stops and the overview are a few levels out from the deepest zoom: rooms readable, the area around them in view.
    const stopZoom = map.getMaxZoom() - 3
    if (target.kind === 'stop') {
      glide(map, { bounds: target.bounds, options: { padding: [36, 36], maxZoom: Math.max(stopZoom, Math.min(map.getZoom(), map.getMaxZoom())) } })
    } else if (target.wholeMap) {
      glide(map, { bounds: mapBounds, options: { padding: [0, 0] } })
    } else {
      glide(map, { bounds: target.bounds, options: { padding: [40, 40], maxZoom: stopZoom - 1 } })
    }
  }, [map, questId, seq, target, mapBounds, mapId, hasPlayer])
  return null
}

type GlideTo = { center: [number, number]; zoom: number } | { bounds: LatLngBoundsExpression; options: FitBoundsOptions }

function glide(map: LeafletMap, to: GlideTo) {
  // The container may have changed size since Leaflet last measured it (size slider, window shown again): a stale size
  // centres the target off to one side.
  map.invalidateSize({ pan: false, animate: false })
  const size = map.getSize()
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // A hidden or zero-sized map cannot fly (Leaflet's flight maths divides by the size): it is placed directly.
  const instant = reduced || size.x <= 0 || size.y <= 0
  if ('center' in to) {
    if (instant) map.setView(to.center, to.zoom, { animate: false })
    else map.flyTo(to.center, to.zoom, { duration: FLY_S, easeLinearity: 0.25 })
    return
  }
  if (instant) map.fitBounds(to.bounds, { ...to.options, animate: false })
  else map.flyToBounds(to.bounds, { ...to.options, duration: FLY_S, easeLinearity: 0.25 })
}

/**
 * Remembers the centre and zoom the player set by hand (drag, wheel, double click) for this map, so the
 * minimap opens the same way next time. Moves made by the app (following the player, quest buttons) are not saved,
 * nor moves made while a quest is chosen: the remembered view is the player's own view of the map.
 */
function ViewMemory({ mapId, enabled }: { mapId: string; enabled: boolean }) {
  const map = useMap()
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])
  useEffect(() => {
    let manual = false
    const touch = () => { manual = true }
    const save = () => {
      if (!manual) return
      manual = false
      if (!enabledRef.current) return
      const center = map.getCenter()
      saveMinimapView(mapId, { center: [center.lat, center.lng], zoom: map.getZoom() })
    }
    const container = map.getContainer()
    map.on('dragstart', touch)
    map.on('dblclick', touch)
    map.on('moveend', save)
    container.addEventListener('wheel', touch, { passive: true })
    return () => {
      map.off('dragstart', touch)
      map.off('dblclick', touch)
      map.off('moveend', save)
      container.removeEventListener('wheel', touch)
    }
  }, [map, mapId])
  return null
}

const iconCache = new Map<string, ReturnType<typeof divIcon>>()

/** normal: no quest chosen; dim: not the chosen quest's; quest: the chosen quest's; focus: what the map shows now. */
type MarkerState = 'normal' | 'dim' | 'quest' | 'focus'
const MARKER_Z: Record<MarkerState, number> = { normal: 0, dim: 0, quest: 500, focus: 600 }
const MARKER_CLASS: Record<MarkerState, string> = { normal: '', dim: ' is-dim', quest: ' is-selected', focus: ' is-selected is-focus' }

function minimapIcon(layerId: MinimapMarker['layerId'], state: MarkerState) {
  const key = `${layerId}|${state}`
  let icon = iconCache.get(key)
  if (!icon) {
    const size = state === 'focus' ? 28 : state === 'quest' ? 24 : layerId.startsWith('quest') ? 18 : 15
    icon = divIcon({ className: `ov-marker${MARKER_CLASS[state]}`, html: `<img src="${newMarkerImages[layerId]}" alt="" />`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
    iconCache.set(key, icon)
  }
  return icon
}

function PlayerMarker({ position, style, followDisabled, keepZoom }: { position: PlayerPosition | null; style: PlayerMarkerStyle; followDisabled: boolean; keepZoom: boolean }) {
  const map = useMap()
  const [angle, setAngle] = useState(0)
  const latLngValue = position ? gameLatLng(position) : null
  /** When the player last zoomed or dragged the map by hand. */
  const touchedAt = useRef(0)

  useEffect(() => {
    const touch = () => { touchedAt.current = Date.now() }
    const container = map.getContainer()
    map.on('dragstart', touch)
    container.addEventListener('wheel', touch, { passive: true })
    return () => { map.off('dragstart', touch); container.removeEventListener('wheel', touch) }
  }, [map])

  // A view restored from the last time keeps its zoom: following then only pans, as after a reopen.
  const zoomedIn = useRef(keepZoom)
  useEffect(() => {
    // Follow the player without jumping: the zoom is set once (then it stays as the player leaves it), and the
    // map pans smoothly only when the marker comes near the edge of the window.
    if (!position || followDisabled || Date.now() - touchedAt.current < 10_000) return
    const target = latLng(gameLatLng(position))
    if (!zoomedIn.current) {
      zoomedIn.current = true
      map.setView(target, Math.max(map.getZoom(), (map.getMaxZoom() ?? 5) - 3), { animate: false })
      return
    }
    const size = map.getSize()
    const point = map.latLngToContainerPoint(target)
    const margin = { x: size.x * 0.22, y: size.y * 0.22 }
    const inside = point.x > margin.x && point.x < size.x - margin.x && point.y > margin.y && point.y < size.y - margin.y
    if (!inside) map.panTo(target, { animate: true, duration: 0.8, easeLinearity: 0.2 })
  }, [map, position, followDisabled])

  useEffect(() => {
    if (!position) return
    const update = () => {
      // Project a point a few metres ahead so the arrow follows the map's own rotation.
      const rad = (position.yaw * Math.PI) / 180
      const from = map.latLngToContainerPoint(gameLatLng(position))
      const to = map.latLngToContainerPoint(gameLatLng({ z: position.z + Math.cos(rad) * 10, x: position.x + Math.sin(rad) * 10 }))
      setAngle((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 90)
    }
    update()
    map.on('zoomend moveend', update)
    return () => { map.off('zoomend moveend', update) }
  }, [map, position])

  const icon = useMemo(() => divIcon({ className: 'ov-player', html: playerMarkerSvg(style, angle), iconSize: [20, 20], iconAnchor: [10, 10] }), [angle, style])

  return latLngValue ? <Marker position={latLngValue} icon={icon} interactive={false} zIndexOffset={1000} /> : null
}
