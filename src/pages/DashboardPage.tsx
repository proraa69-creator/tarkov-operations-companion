import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Clock3, KeyRound, LockKeyhole, Map, PackageCheck, Route, Target, Users } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'
import { calculateAvailability } from '../progression/requirementEngine'
import { calculateMapAccess } from '../progression/mapAccess'

export function DashboardPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const selectedMap = data.maps.find((map) => map.id === state.selectedMapId) ?? data.maps[0]
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const actionableQuests = data.quests.filter((quest) => ['available', 'active'].includes(availability.get(quest.id)?.status ?? ''))
  const availableQuests = data.quests.filter((quest) => availability.get(quest.id)?.status === 'available')
  const mapQuests = actionableQuests.filter((quest) => quest.mapId === selectedMap.id)
  const neededItemIds = [...new Set(mapQuests.flatMap((quest) => quest.requiredItems ?? []))]
  const neededItems = neededItemIds.map((id) => data.items.find((item) => item.id === id)).filter(Boolean).slice(0, 5)
  const favorites = state.favoriteItemIds.map((id) => data.items.find((item) => item.id === id)).filter(Boolean)
  const completedCount = data.quests.filter((quest) => availability.get(quest.id)?.status === 'completed').length
  const kappaTasks = data.quests.filter((quest) => quest.kappa)
  const kappaRemaining = kappaTasks.filter((quest) => availability.get(quest.id)?.status !== 'completed').length

  const openMap = () => navigate(`/maps/${selectedMap.id}?quests=${state.trackedQuestIds.join(',')}`)

  return <div className="page">
    <header className="page-header">
      <div><div className="eyebrow">Оперативный штаб · {new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div><h1 className="page-title">Следующий рейд начинается здесь</h1><p className="page-subtitle">Соберите задачи, ключи и маршрут в одном плане. Прогресс хранится локально на этом компьютере.</p></div>
      <button className="button primary" onClick={openMap}><Map size={16} /> Открыть карту</button>
    </header>

    <section className="stat-grid">
      <div className="stat-card"><div className="stat-label">Доступные задания</div><div className="stat-value">{availableQuests.length}</div><div className="stat-meta">по текущему уровню и цепочкам</div></div>
      <div className="stat-card"><div className="stat-label">Квесты на карте</div><div className="stat-value">{mapQuests.length}</div><div className="stat-meta">{selectedMap.name}</div></div>
      <div className="stat-card"><div className="stat-label">Прогресс</div><div className="stat-value">{completedCount}</div><div className="stat-meta">выполнено заданий</div></div>
      <div className="stat-card"><div className="stat-label">До Kappa</div><div className="stat-value">{kappaRemaining}</div><div className="stat-meta">из {kappaTasks.length} заданий осталось</div></div>
    </section>

    <div className="dashboard-layout">
      <div className="dashboard-column">
        <section className="panel raid-card">
          <div className="raid-card-art" style={{ backgroundImage: `url(${selectedMap.imageUrl})` }} />
          <div className="raid-content">
            <span className="tag brass">ПЛАН РЕЙДА · {state.raidMode.toUpperCase()}</span>
            <h2 className="raid-map-name">{selectedMap.name}</h2>
            <div className="raid-facts"><span><Clock3 size={13} /> {selectedMap.raidTime} мин</span><span><Users size={13} /> {selectedMap.players} игроков</span><span><Target size={13} /> {mapQuests.length} заданий</span></div>
            <div className="raid-actions"><button className="button primary" onClick={openMap}><Route size={16} /> Построить маршрут</button><Link className="button" to="/quests"><Target size={16} /> Задания</Link><button className="button" onClick={() => setMapPickerOpen((value) => !value)}><Map size={16} /> Выбрать карту</button></div>
            {mapPickerOpen && <div className="raid-map-picker">{data.maps.map((map) => { const access = calculateMapAccess(map, data.quests, availability); return <button key={map.id} disabled={access.locked} title={access.locked ? access.quest?.name : map.name} onClick={() => { state.setSelectedMapId(map.id); setMapPickerOpen(false) }}><span className="map-color" style={{ background: map.accent }} />{map.name}{access.locked && <LockKeyhole size={13} />}</button> })}</div>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div className="panel-title">Приоритет карт</div><Link to="/maps" className="dim">Все карты <ChevronRight size={13} /></Link></div>
          <div className="panel-body">
            {data.maps.slice().sort((a, b) => actionableQuests.filter((q) => q.mapId === b.id).length - actionableQuests.filter((q) => q.mapId === a.id).length).slice(0, 5).map((map, index) => {
              const count = actionableQuests.filter((quest) => quest.mapId === map.id).length
              return <button key={map.id} className="priority-row" style={{ width: '100%', color: 'inherit', borderLeft: 0, borderRight: 0, borderTop: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }} onClick={() => { state.setSelectedMapId(map.id); navigate(`/maps/${map.id}`) }}><span className="mono dim">0{index + 1}</span><span><strong>{map.name}</strong><small className="dim">{map.subtitle}</small></span><span className="priority-bar"><span style={{ width: `${Math.min(100, count * 18 + 18)}%` }} /></span><span className="tag">{count} задач</span></button>
            })}
          </div>
        </section>
      </div>

      <div className="dashboard-column">
        <section className="panel">
          <div className="panel-header"><div className="panel-title">Доступные задания</div><Link to="/quests" className="tag green">{availableQuests.length} доступно</Link></div>
          <div className="panel-body">
            {availableQuests.slice(0, 8).map((quest, index) => <div className="quest-row" key={quest.id}><div className="quest-index">{String(index + 1).padStart(2, '0')}</div><Link to={`/quests?selected=${quest.id}`}><strong>{quest.name}</strong><small>{quest.trader} · ур. {quest.level}</small></Link><button className="check-circle" onClick={() => state.toggleCompletedQuest(quest.id)} aria-label={`Отметить выполненным: ${quest.name}`}><Check size={13} /></button></div>)}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div className="panel-title">Требования плана</div><span className="tag"><PackageCheck size={11} /> {neededItems.length}</span></div>
          <div className="panel-body">
            {neededItems.map((item) => item && <Link to={`/items?selected=${item.id}`} className="item-row" key={item.id}><img className="item-thumb" src={item.iconUrl} alt="" /><span><strong>{item.name}</strong><small className="dim">{item.category} · для задания</small></span><KeyRound size={15} className="dim" /></Link>)}
            {neededItems.length === 0 && <p className="muted">Для доступных заданий на этой карте обязательные предметы не найдены.</p>}
            {neededItems.length > 0 && <p className="muted" style={{ marginTop: 12 }}>Это список для подготовки, а не проверка содержимого вашего рюкзака.</p>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div className="panel-title">Рынок · избранное</div><Link to="/flea" className="dim">Подробнее <ChevronRight size={13} /></Link></div>
          <div className="panel-body">
            {favorites.map((item) => item && <div className="item-row" key={item.id}><img className="item-thumb" src={item.iconUrl} alt="" /><span><strong>{item.shortName}</strong><small className="dim">лучшее предложение</small></span><strong className="mono price-up">{formatPrice(Math.max(...item.prices.filter((p) => p.mode === state.raidMode).map((p) => p.price), 0))}</strong></div>)}
          </div>
        </section>
      </div>
    </div>
  </div>
}
