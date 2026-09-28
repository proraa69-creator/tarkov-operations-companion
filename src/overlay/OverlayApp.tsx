import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useState } from 'react'
import { divIcon, type LatLngExpression } from 'leaflet'
import { ImageOverlay, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { markerImages } from '../assets/markerImages'
import { createMapCrs, toLeafletBounds } from '../components/mapCrs'
import { mainFloor } from '../data/mapProjection'
import type { GameMap } from '../domain/types'
import type { PlayerPosition } from './screenshotPosition'
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
    return <div className="ov-card ov-item is-loading"><span className="ov-spinner" />{uiText("Распознаю предмет…")}</div>
  }
  if (payload.state === 'not-found') {
    return (
      <div className="ov-card ov-item">
        <p className="ov-title">{uiText("Предмет не распознан")}</p>
        <p className="ov-muted">{uiText("Наведите курсор на предмет, дождитесь подсказки с названием и нажмите «Ж» ещё раз.")}</p>
      </div>
    )
  }
  const trader = payload.bestTrader
  return (
    <div className="ov-card ov-item">
      <div className="ov-item-head">
        {payload.iconUrl && <img className="ov-item-icon" src={payload.iconUrl} alt="" />}
        <div className="ov-item-title">
          <p className="ov-title">{uiText(payload.shortName || payload.name)}</p>
          {payload.shortName && payload.shortName !== payload.name && <p className="ov-muted">{uiText(payload.name)}</p>}
        </div>
      </div>
      <div className="ov-tags">
        {payload.collector && <span className="ov-tag is-collector">{uiText('Коллекционер')}</span>}
        {payload.kappa && <span className="ov-tag is-kappa">{uiText('Капа')}</span>}
        {payload.quests.length > 0 && <span className="ov-tag is-warn">{uiText(`Заданий: ${payload.quests.length}`)}</span>}
        {!payload.collector && !payload.kappa && payload.quests.length === 0 && <span className="ov-tag is-ok">{uiText('Для заданий не нужен')}</span>}
      </div>
      <div className="ov-prices">
        <div><span>{uiText('Барахолка')}</span><strong>{uiText(payload.fleaPrice ? rub(payload.fleaPrice) : 'нет цены')}</strong></div>
        <div><span>{uiText(trader ? `Торговец · ${trader.name}` : 'Торговец')}</span><strong>{uiText(trader ? rub(trader.price) : 'нет цены')}</strong></div>
      </div>
      {payload.quests.length > 0 && (
        <ul className="ov-quests">
          {payload.quests.slice(0, 3).map((quest) => <li key={quest.questId}><span>{uiText(quest.name)}</span><em>{uiText(`${quest.purpose} ×${quest.count}`)}</em></li>)}
        </ul>
      )}
    </div>
  )
}

function MinimapOverlay() {
  const [payload, setPayload] = useState<MinimapPayload | null>(null)
  const [position, setPosition] = useState<PlayerPosition | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const offMap = window.tarkovDesktop?.onOverlay?.('overlay:minimap', setPayload)
    const offPosition = window.tarkovDesktop?.onOverlay?.('overlay:position', setPosition)
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { offMap?.(); offPosition?.(); window.clearInterval(timer) }
  }, [])

  if (!payload) return <div className="ov-card ov-minimap-empty"><span className="ov-spinner" />{uiText("Загрузка карты…")}</div>
  if (payload.state === 'no-data') {
    return (
      <div className="ov-card ov-minimap-empty">
        <p className="ov-title">{uiText("Мини-карта")}</p>
        <p className="ov-muted">{uiText(payload.reason ?? 'Нет данных карты.')}</p>
      </div>
    )
  }
  const age = position ? Math.max(0, Math.round((now - position.at) / 1000)) : null
  return (
    <div className="ov-minimap">
      <div className="ov-minimap-head">
        <strong>{uiText(payload.map.name)}</strong>
        <span>{uiText(payload.questCount ? `квестов: ${payload.questCount}` : 'нет квестов')}</span>
        <span className={age != null && age < 6 ? 'is-live' : ''}>{uiText(age == null ? 'позиция: нет' : age < 6 ? '● live' : `${age} с назад`)}</span>
      </div>
      <MinimapMap map={payload.map} markers={payload.markers} position={position} />
    </div>
  )
}

function MinimapMap({ map, markers, position }: { map: GameMap; markers: MinimapMarker[]; position: PlayerPosition | null }) {
  const crs = useMemo(() => createMapCrs(map), [map])
  const bounds = toLeafletBounds(map)
  const base = map.layers?.find((layer) => layer.name === mainFloor(map))
  const tileUrl = base?.tileUrl ?? map.tileUrl
  const imageUrl = base?.imageUrl ?? map.imageUrl
  return (
    <MapContainer
      key={map.id}
      className="ov-minimap-map"
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
      keyboard={false}
    >
      {uiText(imageUrl && !tileUrl ? <ImageOverlay url={imageUrl} bounds={bounds} /> : null)}
      {uiText(tileUrl ? (
        <TileLayer url={tileUrl} bounds={bounds} tileSize={map.tileSize ?? 256} minZoom={-5} minNativeZoom={map.minZoom} maxZoom={Math.max(7, map.maxZoom ?? 3)} maxNativeZoom={map.maxZoom} noWrap />
      ) : null)}
      {uiText(markers.map((marker) => (
        <Marker key={marker.id} position={marker.position} icon={minimapIcon(marker.layerId)} interactive={false} />
      )))}
      <PlayerMarker position={position} />
    </MapContainer>
  )
}

const iconCache = new Map<string, ReturnType<typeof divIcon>>()

function minimapIcon(layerId: MinimapMarker['layerId']) {
  let icon = iconCache.get(layerId)
  if (!icon) {
    const size = layerId.startsWith('quest') ? 24 : 20
    icon = divIcon({ className: 'ov-marker', html: `<img src="${markerImages[layerId]}" alt="" />`, iconSize: [size, size], iconAnchor: [size / 2, size] })
    iconCache.set(layerId, icon)
  }
  return icon
}

function PlayerMarker({ position }: { position: PlayerPosition | null }) {
  const map = useMap()
  const [angle, setAngle] = useState(0)
  const latLng: LatLngExpression | null = position ? [position.z, position.x] : null

  useEffect(() => {
    if (!position) return
    map.setView([position.z, position.x], Math.max(map.getZoom(), (map.getMaxZoom() ?? 5) - 3), { animate: true })
  }, [map, position])

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

  const icon = useMemo(() => divIcon({
    className: 'ov-player',
    html: `<svg viewBox="0 0 40 40" style="transform:rotate(${angle.toFixed(1)}deg)"><circle cx="20" cy="20" r="9" /><path d="M20 3 L27 17 L20 14 L13 17 Z" /></svg>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  }), [angle])

  return latLng ? <Marker position={latLng} icon={icon} interactive={false} zIndexOffset={1000} /> : null
}
