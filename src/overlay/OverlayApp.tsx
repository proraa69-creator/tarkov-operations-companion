import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { divIcon, latLng, type LatLngBoundsExpression, type LatLngExpression } from 'leaflet'
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
import { NO_QUEST, clearQuest, pressQuest, questClusters, questTarget, readMinimapView, saveMinimapView, type QuestCycle } from './minimapView'
import { Grip, X, Scaling, Contrast, Crosshair } from 'lucide-react'

export type OverlayKind = 'item' | 'minimap'

export function overlayKind(hash: string): OverlayKind | null {
  const match = /^#\/overlay\/(item|minimap)/.exec(hash)
  return match ? match[1] as OverlayKind : null
}

export function OverlayApp({ kind }: { kind: OverlayKind }) {
  useEffect(() => {
    document.documentElement.classList.add('overlay-root')
  }, [])
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

  useEffect(() => {
    const offMap = window.tarkovDesktop?.onOverlay?.('overlay:minimap', (next) => {
      setPayload(next)
      if (next.state === 'ready' && typeof next.opacity === 'number') setOpacity(next.opacity)
      if (next.state === 'ready') setWidth(minimapWidth(next.minimapWidth))
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
  const selectedQuest = questCycle.questId
  const selected = quests.find((quest) => quest.questId === selectedQuest)
  const roomCount = selected ? questClusters(payload.markers, selected.questId).length : 0
  // «Точка 2 из 3» while stepping through the rooms of a quest, «Вся карта» after the last one.
  const stepLabel = !selected || !roomCount ? '' : questCycle.step >= roomCount ? 'Вся карта' : roomCount > 1 ? `Точка ${questCycle.step + 1} из ${roomCount}` : ''
  const floors = payload.map.floors ?? []
  const floor = floorChoice?.mapId === payload.map.id ? floorChoice.floor : mainFloor(payload.map)
  // The map comes with only the drawing chosen on the Maps page left in it (mapForView): tiles when it has them.
  const view = payload.view ?? resolveMapView(payload.map, 'satellite')
  const changeOpacity = (value: number) => {
    setOpacity(value)
    void window.tarkovDesktop?.experimental?.updateSettings({ minimapOpacity: value })
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
      <MinimapMap width={width} visibilityRevision={visibilityRevision} map={payload.map} view={view} floor={floor} markers={payload.markers} position={position} playerMarker={payload.playerMarker ?? 'arrow'} questCycle={questCycle} />
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
          <input aria-label={uiText('Размер мини-карты')} type="range" min={280} max={720} step={20} value={width} onChange={(event) => {
            const value = minimapWidth(Number(event.target.value))
            setWidth(value)
            void window.tarkovDesktop?.experimental?.updateSettings({ minimapWidth: value })
          }} />
        </label>
      </div>
      {quests.length > 0 && (
        <ul className="ov-quest-list ov-interactive">
          {quests.map((quest) => (
            <li key={quest.questId}>
              {/* Each press moves to the quest's next room; after the last one the whole map, then the first again. */}
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

function MinimapMap({ width, visibilityRevision, map, view, floor, markers, position, playerMarker, questCycle }: { width: number; visibilityRevision: number; map: GameMap; view: MapView; floor: string; markers: MinimapMarker[]; position: PlayerPosition | null; playerMarker: PlayerMarkerStyle; questCycle: QuestCycle }) {
  const selectedQuest = questCycle.questId
  const crs = useMemo(() => createMapCrs(map), [map])
  // Stable between renders: the overlay re-renders every second (the «live» age), and a new bounds object
  // used to re-run the fit below — the map jumped back to the whole map and lost the player's zoom.
  const bounds = useMemo(() => toLeafletBounds(map), [map])
  const height = Math.round(Math.min(560, Math.max(180, width * mapAspect(map))))
  // The chosen floor is drawn as on the Maps page: its own render tiles or its plan from the scheme.
  const plan = useMemo(() => planMapLayers(map, view, floor), [map, view, floor])
  const clusters = useMemo(() => questClusters(markers, selectedQuest), [markers, selectedQuest])
  // The view the player left by hand on this map, read once when the map is created (it is keyed by map id).
  const savedView = useMemo(() => readMinimapView(map.id), [map.id])
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
      {markers.map((marker) => (
        <Marker key={marker.id} position={marker.position} icon={minimapIcon(marker.layerId, Boolean(selectedQuest && marker.questId === selectedQuest))} interactive={false} zIndexOffset={marker.questId === selectedQuest ? 500 : 0} />
      ))}
      <MapSize width={width} height={height} visibilityRevision={visibilityRevision} />
      <FocusQuest clusters={clusters} cycle={questCycle} bounds={bounds} />
      <ViewMemory mapId={map.id} />
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

function FocusQuest({ clusters, cycle, bounds }: { clusters: MinimapMarker[][]; cycle: QuestCycle; bounds: LatLngBoundsExpression }) {
  const map = useMap()
  const shownSeq = useRef(cycle.seq)
  useEffect(() => {
    // Only on a press of a quest button (or the clear button) — never on an ordinary re-render or a new payload.
    if (shownSeq.current === cycle.seq) return
    shownSeq.current = cycle.seq
    const target = cycle.questId ? questTarget(clusters, cycle.step) : { kind: 'map' as const }
    if (!target) return
    if (target.kind === 'map') { map.fitBounds(bounds, { padding: [0, 0], animate: true }); return }
    const points = target.points
    if (points.length === 1) map.flyTo(points[0]!, Math.max(map.getZoom(), map.getMaxZoom() - 3), { duration: 0.5 })
    else map.flyToBounds(points, { padding: [40, 40], maxZoom: map.getMaxZoom() - 3, duration: 0.5 })
  }, [map, clusters, cycle, bounds])
  return null
}

/**
 * Remembers the centre and zoom the player set by hand (drag, wheel, double click) for this map, so the
 * minimap opens the same way next time. Moves made by the app (following the player, quest buttons) are not saved.
 */
function ViewMemory({ mapId }: { mapId: string }) {
  const map = useMap()
  useEffect(() => {
    let manual = false
    const touch = () => { manual = true }
    const save = () => {
      if (!manual) return
      manual = false
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

function minimapIcon(layerId: MinimapMarker['layerId'], selected: boolean) {
  const key = `${layerId}|${selected ? 1 : 0}`
  let icon = iconCache.get(key)
  if (!icon) {
    const size = selected ? 26 : layerId.startsWith('quest') ? 18 : 15
    icon = divIcon({ className: `ov-marker${selected ? ' is-selected' : ''}`, html: `<img src="${newMarkerImages[layerId]}" alt="" />`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
    iconCache.set(key, icon)
  }
  return icon
}

function PlayerMarker({ position, style, followDisabled, keepZoom }: { position: PlayerPosition | null; style: PlayerMarkerStyle; followDisabled: boolean; keepZoom: boolean }) {
  const map = useMap()
  const [angle, setAngle] = useState(0)
  const latLngValue: LatLngExpression | null = position ? [position.z, position.x] : null
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
    const target = latLng(position.z, position.x)
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
      const from = map.latLngToContainerPoint([position.z, position.x])
      const to = map.latLngToContainerPoint([position.z + Math.cos(rad) * 10, position.x + Math.sin(rad) * 10])
      setAngle((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 90)
    }
    update()
    map.on('zoomend moveend', update)
    return () => { map.off('zoomend moveend', update) }
  }, [map, position])

  const icon = useMemo(() => divIcon({ className: 'ov-player', html: playerMarkerSvg(style, angle), iconSize: [20, 20], iconAnchor: [10, 10] }), [angle, style])

  return latLngValue ? <Marker position={latLngValue} icon={icon} interactive={false} zIndexOffset={1000} /> : null
}
