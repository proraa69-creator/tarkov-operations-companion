import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import L, { CRS, divIcon, type LatLngBoundsExpression } from 'leaflet'
import { ImageOverlay, MapContainer, Marker, TileLayer, ZoomControl } from 'react-leaflet'
import { AlertTriangle, ArrowRightLeft, Box, ChevronRight, CircleDot, Crosshair, Diamond, DoorOpen, FlaskConical, HeartPulse, KeyRound, MapPin, Search, Skull, Target, TentTree, Users, Wrench } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { markerVisibleOnFloor } from '../data/mapProjection'
import { allMarkerLayers } from '../domain/mapLayers'
import { useAppState } from '../state/AppState'
import type { GameMap, MapMarker, MarkerLayerId } from '../domain/types'

const markerMeta: Record<MarkerLayerId, { label: string; color: string; glyph: string; icon: typeof Target }> = {
  'extract.pmc': { label: 'Выходы PMC', color: '#6fb47c', glyph: 'P', icon: DoorOpen },
  'extract.scav': { label: 'Выходы Scav', color: '#c9b463', glyph: 'S', icon: DoorOpen },
  'extract.coop': { label: 'Co-op выходы', color: '#70a6ba', glyph: '2', icon: Users },
  transit: { label: 'Транзиты', color: '#9bb2d0', glyph: 'T', icon: ArrowRightLeft },
  'quest.zone': { label: 'Квесты', color: '#d5b76f', glyph: '!', icon: Target },
  'quest.item': { label: 'Квестовые предметы', color: '#e0c76f', glyph: 'Q', icon: Box },
  key: { label: 'Ключи', color: '#8ea8c4', glyph: 'K', icon: KeyRound },
  boss: { label: 'Боссы', color: '#c16f62', glyph: 'B', icon: Skull },
  spawn: { label: 'Спавны', color: '#b789be', glyph: 'S', icon: CircleDot },
  hazard: { label: 'Опасности', color: '#d98064', glyph: '!', icon: AlertTriangle },
  'loot.valuable': { label: 'Ценный лут', color: '#cc9fe0', glyph: '◆', icon: Diamond },
  'loot.weapon': { label: 'Оружие/боеприпасы', color: '#c18b65', glyph: 'A', icon: Crosshair },
  'loot.medical': { label: 'Медицина', color: '#d97878', glyph: '+', icon: HeartPulse },
  'loot.provision': { label: 'Провизия', color: '#a9b96f', glyph: 'F', icon: FlaskConical },
  'loot.technical': { label: 'Технический лут', color: '#8aa28f', glyph: 'W', icon: Wrench },
  'loot.container': { label: 'Контейнеры/тайники', color: '#9d8c67', glyph: 'C', icon: Box },
  landmark: { label: 'Ориентиры', color: '#7f9ca2', glyph: 'L', icon: TentTree },
}

const defaultBounds: LatLngBoundsExpression = [[0, 0], [1000, 1000]]

export function MapsPage() {
  const { mapId } = useParams()
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const activeMapId = mapId ?? state.selectedMapId
  const activeMap = data.maps.find((entry) => entry.id === activeMapId) ?? data.maps[0]
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null)
  const [floor, setFloor] = useState(activeMap.floors?.[0] ?? 'Основной')
  const [search, setSearch] = useState('')
  const activeBounds = toLeafletBounds(activeMap)
  const activeCrs = createMapCrs(activeMap)
  const activeLayer = activeMap.layers?.find((layer) => layer.name === floor)
  const imageUrl = activeLayer?.imageUrl ?? activeMap.imageUrl
  const tileUrl = activeLayer?.tileUrl ?? activeMap.tileUrl

  const mapMarkers = useMemo(() => {
    const actual = data.markers.filter((marker) => marker.mapId === activeMap.id)
    return actual.filter((marker) => {
      const layerId = markerLayerId(marker)
      return !state.hiddenMarkerLayers.includes(layerId)
        && !state.hiddenMarkerTypes.includes(marker.type)
        && markerVisibleOnFloor(marker, floor)
        && `${marker.title} ${marker.description}`.toLowerCase().includes(search.toLowerCase())
    })
  }, [activeMap.id, data.markers, floor, search, state.hiddenMarkerLayers, state.hiddenMarkerTypes])

  const selectMap = (id: string) => {
    state.setSelectedMapId(id)
    setSelectedMarker(null)
    const nextMap = data.maps.find((entry) => entry.id === id)
    setFloor(nextMap?.floors?.[0] ?? 'Основной')
    navigate(`/maps/${id}`)
  }

  const relatedQuest = selectedMarker?.questId ? data.quests.find((quest) => quest.id === selectedMarker.questId) : undefined
  const relatedItem = selectedMarker?.itemId ? data.items.find((item) => item.id === selectedMarker.itemId) : undefined

  return <div className="page map-page">
    <div className="map-shell">
      <aside className="map-sidebar">
        <div><div className="map-side-title">ЛОКАЦИИ</div>{data.maps.map((map) => <button key={map.id} className={`map-option ${map.id === activeMap.id ? 'active' : ''}`} onClick={() => selectMap(map.id)}><span className="map-color" style={{ background: map.accent }} /><span>{map.name}</span><small>{map.markerCount}</small></button>)}</div>
        <div><div className="map-side-title" style={{ marginTop: 20 }}>СЛОИ КАРТЫ</div>{allMarkerLayers.map((layerId) => { const meta = markerMeta[layerId]; const visible = !state.hiddenMarkerLayers.includes(layerId); return <button className={`layer-button ${visible ? 'active' : ''}`} key={layerId} onClick={() => state.toggleMarkerLayer(layerId)}><span className="layer-dot" style={{ '--marker-color': meta.color } as React.CSSProperties} /><span>{meta.label}</span><small style={{ marginLeft: 'auto' }}>{data.markers.filter((m) => m.mapId === activeMap.id && markerLayerId(m) === layerId).length}</small></button> })}</div>
      </aside>

      <section className="map-stage">
        <div className="map-hud"><span>{activeMap.name.toUpperCase()}</span><span>{floor.toUpperCase()}</span><span>{mapMarkers.length} МАРКЕРОВ</span></div>
        <MapContainer key={activeMap.id} crs={activeCrs} bounds={activeBounds} minZoom={activeMap.minZoom ?? -1} maxZoom={Math.max(7, activeMap.maxZoom ?? 3)} zoomControl={false} attributionControl={true}>
          <ZoomControl position="bottomright" />
          {imageUrl && <ImageOverlay key={imageUrl} url={imageUrl} bounds={activeBounds} attribution={activeMap.attribution} />}
          {tileUrl && <TileLayer key={tileUrl} url={tileUrl} bounds={activeBounds} tileSize={activeMap.tileSize ?? 256} minZoom={activeMap.minZoom} maxZoom={Math.max(7, activeMap.maxZoom ?? 3)} maxNativeZoom={activeMap.maxZoom} noWrap attribution={activeMap.attribution} />}
          {mapMarkers.map((marker) => {
            const meta = markerMeta[markerLayerId(marker)]
            const icon = divIcon({ className: 'marker-icon', html: `<div class="map-marker" style="--marker-color:${meta.color}"><span>${meta.glyph}</span></div>`, iconSize: [28, 28], iconAnchor: [14, 27] })
            return <Marker key={marker.id} position={marker.position} icon={icon} eventHandlers={{ click: () => setSelectedMarker(marker) }} />
          })}
        </MapContainer>
      </section>

      <aside className="map-detail">
        <div className="panel-header"><div className="panel-title">Контекст карты</div><MapPin size={15} className="dim" /></div>
        <div className="filter-row" style={{ padding: 12, margin: 0 }}><div style={{ position: 'relative', width: '100%' }}><Search size={14} style={{ position: 'absolute', left: 11, top: 13, color: 'var(--text-dim)' }} /><input className="input" style={{ width: '100%', paddingLeft: 34 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти точку…" /></div></div>
        {activeMap.floors && <div className="filter-row" style={{ padding: '0 12px', margin: '0 0 12px' }}>{activeMap.floors.map((entry) => <button key={entry} className={`button small ${floor === entry ? 'primary' : 'ghost'}`} onClick={() => setFloor(entry)}>{entry}</button>)}</div>}
        {!selectedMarker && <div className="map-detail-empty"><div><Crosshair size={30} /><h3>Выберите маркер</h3><p>Нажмите на точку карты, чтобы открыть сведения, связанное задание или ключ.</p></div></div>}
        {selectedMarker && <div>
          <div className="detail-hero" style={{ '--marker-color': markerMeta[markerLayerId(selectedMarker)].color } as React.CSSProperties}><div className="detail-type">{markerMeta[markerLayerId(selectedMarker)].label}</div><h2>{selectedMarker.title}</h2><span className="tag">{selectedMarker.meta}</span></div>
          <div className="detail-section"><h4>Сведения</h4><p>{selectedMarker.description}</p></div>
          {relatedQuest && <div className="detail-section"><h4>Связанное задание</h4><p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>{relatedQuest.name}</strong><br />{relatedQuest.trader} · уровень {relatedQuest.level}</p><Link className="button" style={{ width: '100%' }} to={`/quests?selected=${relatedQuest.id}`}>Открыть задание <ChevronRight size={14} /></Link></div>}
          {relatedItem && <div className="detail-section"><h4>Требуемый предмет</h4><div className="item-row"><img className="item-thumb" src={relatedItem.iconUrl} alt="" /><span><strong>{relatedItem.name}</strong><small className="dim">{relatedItem.category}</small></span></div><Link className="button" style={{ width: '100%', marginTop: 10 }} to={`/items?selected=${relatedItem.id}`}>Открыть предмет <ChevronRight size={14} /></Link></div>}
          <div className="detail-section"><button className="button ghost" style={{ width: '100%' }} onClick={() => setSelectedMarker(null)}>Закрыть карточку</button></div>
        </div>}
      </aside>
    </div>
  </div>
}

function toLeafletBounds(map: GameMap): LatLngBoundsExpression {
  if (!map.bounds) return defaultBounds
  return [[map.bounds[0][1], map.bounds[0][0]], [map.bounds[1][1], map.bounds[1][0]]]
}

function markerLayerId(marker: MapMarker): MarkerLayerId {
  if (marker.layerId) return marker.layerId
  if (marker.type === 'extract') return 'extract.pmc'
  if (marker.type === 'quest') return marker.itemId ? 'quest.item' : 'quest.zone'
  if (marker.type === 'cache') return 'loot.container'
  if (marker.type === 'danger') return 'hazard'
  return marker.type as MarkerLayerId
}

function createMapCrs(map: GameMap) {
  if (!map.transform) return CRS.Simple
  const [scaleX, marginX, scaleY, marginY] = map.transform
  const rotation = map.coordinateRotation ?? 0
  return L.extend({}, CRS.Simple, {
    transformation: new L.Transformation(scaleX, marginX, scaleY * -1, marginY),
    projection: L.extend({}, L.Projection.LonLat, {
      project: (point: L.LatLng) => L.Projection.LonLat.project(rotate(point, rotation)),
      unproject: (point: L.Point) => rotate(L.Projection.LonLat.unproject(point), rotation * -1),
    }),
  })
}

function rotate(point: L.LatLng, rotation: number) {
  if ((!point.lng && !point.lat) || !rotation) return point
  const angle = rotation * Math.PI / 180
  const x = point.lng * Math.cos(angle) - point.lat * Math.sin(angle)
  const y = point.lng * Math.sin(angle) + point.lat * Math.cos(angle)
  return L.latLng(y, x)
}
