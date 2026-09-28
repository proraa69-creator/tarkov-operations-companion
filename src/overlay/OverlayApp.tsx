import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { divIcon, latLng, type LatLngBoundsExpression, type LatLngExpression } from 'leaflet'
import { ImageOverlay, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { newMarkerImages } from '../assets/map-markers-new'
import { createMapCrs, toLeafletBounds } from '../components/mapCrs'
import { mainFloor } from '../data/mapProjection'
import type { GameMap } from '../domain/types'
import type { PlayerPosition } from './screenshotPosition'
import { playerMarkerSvg, type PlayerMarkerStyle } from './playerMarker'
import type { ItemOverlayPayload, MinimapMarker, MinimapPayload } from './types'
import './overlay.css'

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
  useEffect(() => window.tarkovDesktop?.onOverlay?.('overlay:item', setPayload), [])

  if (payload.state === 'loading') {
    return (
      <div className="eft-card">
        <div className="eft-card-head"><span>{uiText('Поиск предмета')}</span></div>
        <div className="eft-card-body is-loading"><span className="ov-spinner" />{uiText('Распознаю…')}</div>
      </div>
    )
  }
  if (payload.state === 'not-found') {
    return (
      <div className="eft-card">
        <div className="eft-card-head"><span>{uiText('Предмет не распознан')}</span></div>
        <div className="eft-card-body"><p className="eft-hint">{uiText('Дождитесь подсказки с названием и нажмите клавишу ещё раз.')}</p></div>
      </div>
    )
  }
  const trader = payload.bestTrader
  return (
    <div className="eft-card">
      <div className="eft-card-head"><span>{uiText(payload.name)}</span></div>
      <div className="eft-card-body">
        {payload.iconUrl && <div className="eft-card-icon"><img src={payload.iconUrl} alt="" /></div>}
        <dl className="eft-prices">
          <div><dt>{uiText('Барахолка')}</dt><dd>{uiText(payload.fleaPrice ? rub(payload.fleaPrice) : '—')}</dd></div>
          <div><dt>{uiText(trader ? trader.name : 'Торговец')}</dt><dd>{uiText(trader ? rub(trader.price) : '—')}</dd></div>
        </dl>
      </div>
    </div>
  )
}

function MinimapOverlay() {
  const [payload, setPayload] = useState<MinimapPayload | null>(null)
  const [position, setPosition] = useState<PlayerPosition | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [opacity, setOpacity] = useState(0.9)
  const [selectedQuest, setSelectedQuest] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offMap = window.tarkovDesktop?.onOverlay?.('overlay:minimap', (next) => {
      setPayload(next)
      setSelectedQuest(null)
      if (next.state === 'ready' && typeof next.opacity === 'number') setOpacity(next.opacity)
    })
    const offPosition = window.tarkovDesktop?.onOverlay?.('overlay:position', setPosition)
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { offMap?.(); offPosition?.(); window.clearInterval(timer) }
  }, [])

  // The overlay is click-through except over its controls.
  useInteractiveZones(rootRef)
  // The window follows the content: no empty frame around a wide or tall map.
  useFitWindow(rootRef)

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
  const changeOpacity = (value: number) => {
    setOpacity(value)
    void window.tarkovDesktop?.experimental?.updateSettings({ minimapOpacity: value })
  }
  return (
    <div ref={rootRef} className="ov-minimap" style={{ '--ov-opacity': opacity } as CSSProperties}>
      <div className="ov-minimap-head">
        <strong>{uiText(payload.map.name)}</strong>
        <span className={age != null && age < 6 ? 'is-live' : ''}>{uiText(age == null ? 'позиция: нет' : age < 6 ? '● live' : `${formatAge(age)} назад`)}</span>
        <label className="ov-opacity ov-interactive" title={uiText('Прозрачность')}>
          <span aria-hidden="true">◐</span>
          <input type="range" min={30} max={100} step={5} value={Math.round(opacity * 100)} onChange={(event) => changeOpacity(Number(event.target.value) / 100)} />
        </label>
      </div>
      <MinimapMap map={payload.map} markers={payload.markers} position={position} playerMarker={payload.playerMarker ?? 'arrow'} selectedQuest={selectedQuest} />
      {quests.length > 0 && (
        <ul className="ov-quest-list ov-interactive">
          {quests.map((quest) => (
            <li key={quest.questId}>
              <button type="button" className={selectedQuest === quest.questId ? 'active' : ''} onClick={() => setSelectedQuest((current) => current === quest.questId ? null : quest.questId)} title={uiText(`${quest.name} · ${quest.trader}`)}>
                {uiText(quest.name)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatAge(seconds: number) {
  return seconds < 90 ? `${seconds} с` : `${Math.round(seconds / 60)} мин`
}

function useInteractiveZones(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const api = window.tarkovDesktop?.overlaySetInteractive
    if (!api) return
    let inside = false
    const onMove = (event: MouseEvent) => {
      const over = Boolean((event.target as HTMLElement | null)?.closest?.('.ov-interactive'))
      if (over !== inside) { inside = over; api(over) }
    }
    document.addEventListener('mousemove', onMove)
    return () => { document.removeEventListener('mousemove', onMove); api(false) }
  }, [rootRef])
}

function useFitWindow(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const resize = window.tarkovDesktop?.overlayResize
    const element = rootRef.current
    if (!resize || !element) return
    const observer = new ResizeObserver(() => resize(Math.ceil(element.offsetWidth + 8), Math.ceil(element.offsetHeight + 8)))
    observer.observe(element)
    return () => observer.disconnect()
  })
}

const MINIMAP_WIDTH = 420

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

function MinimapMap({ map, markers, position, playerMarker, selectedQuest }: { map: GameMap; markers: MinimapMarker[]; position: PlayerPosition | null; playerMarker: PlayerMarkerStyle; selectedQuest: string | null }) {
  const crs = useMemo(() => createMapCrs(map), [map])
  const bounds = toLeafletBounds(map)
  const height = Math.round(Math.min(560, Math.max(180, MINIMAP_WIDTH * mapAspect(map))))
  const base = map.layers?.find((layer) => layer.name === mainFloor(map))
  const tileUrl = base?.tileUrl ?? map.tileUrl
  const imageUrl = base?.imageUrl ?? map.imageUrl
  return (
    <MapContainer
      key={map.id}
      className="ov-minimap-map"
      style={{ width: MINIMAP_WIDTH, height }}
      crs={crs}
      bounds={bounds}
      boundsOptions={{ padding: [0, 0] }}
      zoomSnap={0}
      minZoom={Math.min(-5, map.minZoom ?? -1)}
      maxZoom={Math.max(7, map.maxZoom ?? 3)}
      zoomControl={false}
      attributionControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      keyboard={false}
    >
      {imageUrl && !tileUrl ? <ImageOverlay url={imageUrl} bounds={bounds} /> : null}
      {tileUrl ? (
        <TileLayer url={tileUrl} bounds={bounds} tileSize={map.tileSize ?? 256} minZoom={-5} minNativeZoom={map.minZoom} maxZoom={Math.max(7, map.maxZoom ?? 3)} maxNativeZoom={map.maxZoom} noWrap />
      ) : null}
      {markers.map((marker) => (
        <Marker key={marker.id} position={marker.position} icon={minimapIcon(marker.layerId, Boolean(selectedQuest && marker.questId === selectedQuest))} interactive={false} zIndexOffset={marker.questId === selectedQuest ? 500 : 0} />
      ))}
      <FocusQuest markers={markers} questId={selectedQuest} bounds={bounds} />
      <PlayerMarker position={position} style={playerMarker} followDisabled={Boolean(selectedQuest)} />
    </MapContainer>
  )
}

function FocusQuest({ markers, questId, bounds }: { markers: MinimapMarker[]; questId: string | null; bounds: LatLngBoundsExpression }) {
  const map = useMap()
  useEffect(() => {
    if (!questId) { map.fitBounds(bounds, { padding: [0, 0], animate: true }); return }
    const points = markers.filter((marker) => marker.questId === questId).map((marker) => marker.position)
    if (!points.length) return
    if (points.length === 1) map.flyTo(points[0]!, Math.max(map.getZoom(), map.getMaxZoom() - 3), { duration: 0.5 })
    else map.flyToBounds(points, { padding: [40, 40], maxZoom: map.getMaxZoom() - 3, duration: 0.5 })
  }, [map, markers, questId, bounds])
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

function PlayerMarker({ position, style, followDisabled }: { position: PlayerPosition | null; style: PlayerMarkerStyle; followDisabled: boolean }) {
  const map = useMap()
  const [angle, setAngle] = useState(0)
  const latLngValue: LatLngExpression | null = position ? [position.z, position.x] : null

  useEffect(() => {
    if (!position || followDisabled) return
    map.setView([position.z, position.x], Math.max(map.getZoom(), (map.getMaxZoom() ?? 5) - 3), { animate: true })
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

  const icon = useMemo(() => divIcon({ className: 'ov-player', html: playerMarkerSvg(style, angle), iconSize: [40, 40], iconAnchor: [20, 20] }), [angle, style])

  return latLngValue ? <Marker position={latLngValue} icon={icon} interactive={false} zIndexOffset={1000} /> : null
}
