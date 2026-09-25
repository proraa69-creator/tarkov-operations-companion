import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CRS, divIcon, type LatLngBoundsExpression } from 'leaflet'
import { ImageOverlay, MapContainer, Marker, ZoomControl } from 'react-leaflet'
import { AlertTriangle, Box, ChevronRight, CircleDot, Crosshair, DoorOpen, KeyRound, MapPin, Search, Skull, Target, TentTree } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import type { MapMarker, MarkerType } from '../domain/types'

const markerMeta: Record<MarkerType, { label: string; color: string; glyph: string; icon: typeof Target }> = {
  quest: { label: 'Задания', color: '#d5b76f', glyph: '!', icon: Target },
  extract: { label: 'Выходы', color: '#82b58d', glyph: '↗', icon: DoorOpen },
  key: { label: 'Ключи', color: '#8ea8c4', glyph: 'K', icon: KeyRound },
  boss: { label: 'Боссы', color: '#c16f62', glyph: 'B', icon: Skull },
  spawn: { label: 'Спавны', color: '#b789be', glyph: 'S', icon: CircleDot },
  cache: { label: 'Тайники', color: '#9d8c67', glyph: 'C', icon: Box },
  danger: { label: 'Опасности', color: '#d98064', glyph: '!', icon: AlertTriangle },
  landmark: { label: 'Ориентиры', color: '#7f9ca2', glyph: 'L', icon: TentTree },
}

const bounds: LatLngBoundsExpression = [[0, 0], [1000, 1000]]

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

  const mapMarkers = useMemo(() => {
    const actual = data.markers.filter((marker) => marker.mapId === activeMap.id)
    const base = actual.length ? actual : generatedMarkers(activeMap.id, data.quests.filter((quest) => quest.mapId === activeMap.id).length)
    return base.filter((marker) => !state.hiddenMarkerTypes.includes(marker.type) && `${marker.title} ${marker.description}`.toLowerCase().includes(search.toLowerCase()))
  }, [activeMap.id, data.markers, data.quests, search, state.hiddenMarkerTypes])

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
        <div><div className="map-side-title" style={{ marginTop: 20 }}>СЛОИ КАРТЫ</div>{(Object.keys(markerMeta) as MarkerType[]).map((type) => { const meta = markerMeta[type]; const visible = !state.hiddenMarkerTypes.includes(type); return <button className={`layer-button ${visible ? 'active' : ''}`} key={type} onClick={() => state.toggleMarkerType(type)}><span className="layer-dot" style={{ '--marker-color': meta.color } as React.CSSProperties} /><span>{meta.label}</span><small style={{ marginLeft: 'auto' }}>{data.markers.filter((m) => m.mapId === activeMap.id && m.type === type).length}</small></button> })}</div>
      </aside>

      <section className="map-stage">
        <div className="map-hud"><span>{activeMap.name.toUpperCase()}</span><span>{floor.toUpperCase()}</span><span>{mapMarkers.length} МАРКЕРОВ</span></div>
        <MapContainer key={activeMap.id} crs={CRS.Simple} bounds={bounds} minZoom={-1} maxZoom={3} zoomControl={false} attributionControl={true}>
          <ZoomControl position="bottomright" />
          {activeMap.imageUrl && <ImageOverlay url={activeMap.imageUrl} bounds={bounds} attribution={activeMap.attribution} />}
          {mapMarkers.map((marker) => {
            const meta = markerMeta[marker.type]
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
          <div className="detail-hero" style={{ '--marker-color': markerMeta[selectedMarker.type].color } as React.CSSProperties}><div className="detail-type">{markerMeta[selectedMarker.type].label}</div><h2>{selectedMarker.title}</h2><span className="tag">{selectedMarker.meta}</span></div>
          <div className="detail-section"><h4>Сведения</h4><p>{selectedMarker.description}</p></div>
          {relatedQuest && <div className="detail-section"><h4>Связанное задание</h4><p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>{relatedQuest.name}</strong><br />{relatedQuest.trader} · уровень {relatedQuest.level}</p><Link className="button" style={{ width: '100%' }} to={`/quests?selected=${relatedQuest.id}`}>Открыть задание <ChevronRight size={14} /></Link></div>}
          {relatedItem && <div className="detail-section"><h4>Требуемый предмет</h4><div className="item-row"><img className="item-thumb" src={relatedItem.iconUrl} alt="" /><span><strong>{relatedItem.name}</strong><small className="dim">{relatedItem.category}</small></span></div><Link className="button" style={{ width: '100%', marginTop: 10 }} to={`/items?selected=${relatedItem.id}`}>Открыть предмет <ChevronRight size={14} /></Link></div>}
          <div className="detail-section"><button className="button ghost" style={{ width: '100%' }} onClick={() => setSelectedMarker(null)}>Закрыть карточку</button></div>
        </div>}
      </aside>
    </div>
  </div>
}

function generatedMarkers(mapId: string, questCount: number): MapMarker[] {
  const seed = mapId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const types: MarkerType[] = ['extract', 'quest', 'landmark', 'cache', 'danger']
  return Array.from({ length: Math.max(6, questCount + 4) }, (_, index) => ({
    id: `${mapId}-generated-${index}`,
    mapId,
    type: types[index % types.length],
    title: index % 5 === 0 ? 'Основной выход' : index % 5 === 1 ? 'Зона задания' : index % 5 === 2 ? 'Ключевой ориентир' : index % 5 === 3 ? 'Скрытый тайник' : 'Опасная зона',
    description: 'Базовый маркер прототипа. Полное покрытие этой локации будет уточняться по открытым источникам.',
    position: [160 + ((seed * (index + 3)) % 680), 140 + ((seed * (index + 7)) % 720)] as [number, number],
    meta: 'Базовый слой',
  }))
}
