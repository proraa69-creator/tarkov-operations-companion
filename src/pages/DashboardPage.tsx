import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Clock3, KeyRound, Map, PackageCheck, Route, Target, Users } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'

export function DashboardPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const selectedMap = data.maps.find((map) => map.id === state.selectedMapId) ?? data.maps[0]
  const activeQuests = data.quests.filter((quest) => state.trackedQuestIds.includes(quest.id))
  const mapQuests = data.quests.filter((quest) => quest.mapId === selectedMap.id)
  const neededItemIds = [...new Set(activeQuests.flatMap((quest) => quest.requiredItems ?? []))]
  const neededItems = neededItemIds.map((id) => data.items.find((item) => item.id === id)).filter(Boolean).slice(0, 5)
  const favorites = state.favoriteItemIds.map((id) => data.items.find((item) => item.id === id)).filter(Boolean)
  const completedCount = state.completedQuestIds.length

  const openMap = () => navigate(`/maps/${selectedMap.id}?quests=${state.trackedQuestIds.join(',')}`)

  return <div className="page">
    <header className="page-header">
      <div><div className="eyebrow">Оперативный штаб · {new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div><h1 className="page-title">Следующий рейд начинается здесь</h1><p className="page-subtitle">Соберите задачи, ключи и маршрут в одном плане. Прогресс хранится локально на этом компьютере.</p></div>
      <button className="button primary" onClick={openMap}><Map size={16} /> Открыть карту</button>
    </header>

    <section className="stat-grid">
      <div className="stat-card"><div className="stat-label">Активные задания</div><div className="stat-value">{activeQuests.length}</div><div className="stat-meta">из {data.quests.length} в справочнике</div></div>
      <div className="stat-card"><div className="stat-label">Готовность к рейду</div><div className="stat-value">74%</div><div className="stat-meta">нужно ещё {Math.max(1, neededItems.length - 2)} предмета</div></div>
      <div className="stat-card"><div className="stat-label">Квесты на карте</div><div className="stat-value">{mapQuests.length}</div><div className="stat-meta">{selectedMap.name}</div></div>
      <div className="stat-card"><div className="stat-label">Прогресс</div><div className="stat-value">{completedCount}</div><div className="stat-meta">заданий отмечено выполненными</div></div>
    </section>

    <div className="dashboard-layout">
      <div className="dashboard-column">
        <section className="panel raid-card">
          <div className="raid-card-art" style={{ backgroundImage: `url(${selectedMap.imageUrl})` }} />
          <div className="raid-content">
            <span className="tag brass">ПЛАН РЕЙДА · {state.raidMode.toUpperCase()}</span>
            <h2 className="raid-map-name">{selectedMap.name}</h2>
            <div className="raid-facts"><span><Clock3 size={13} /> {selectedMap.raidTime} мин</span><span><Users size={13} /> {selectedMap.players} игроков</span><span><Target size={13} /> {mapQuests.length} заданий</span></div>
            <div className="raid-actions"><button className="button primary" onClick={openMap}><Route size={16} /> Построить маршрут</button><Link className="button" to="/quests"><Target size={16} /> Задания</Link></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div className="panel-title">Приоритет карт</div><Link to="/maps" className="dim">Все карты <ChevronRight size={13} /></Link></div>
          <div className="panel-body">
            {data.maps.slice().sort((a, b) => data.quests.filter((q) => q.mapId === b.id).length - data.quests.filter((q) => q.mapId === a.id).length).slice(0, 5).map((map, index) => {
              const count = data.quests.filter((quest) => quest.mapId === map.id).length
              return <button key={map.id} className="priority-row" style={{ width: '100%', color: 'inherit', borderLeft: 0, borderRight: 0, borderTop: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }} onClick={() => { state.setSelectedMapId(map.id); navigate(`/maps/${map.id}`) }}><span className="mono dim">0{index + 1}</span><span><strong>{map.name}</strong><small className="dim">{map.subtitle}</small></span><span className="priority-bar"><span style={{ width: `${Math.min(100, count * 18 + 18)}%` }} /></span><span className="tag">{count} задач</span></button>
            })}
          </div>
        </section>
      </div>

      <div className="dashboard-column">
        <section className="panel">
          <div className="panel-header"><div className="panel-title">Активные задания</div><Link to="/quests" className="tag green">{activeQuests.length} в работе</Link></div>
          <div className="panel-body">
            {activeQuests.map((quest, index) => <div className="quest-row" key={quest.id}><div className="quest-index">{String(index + 1).padStart(2, '0')}</div><Link to={`/quests?selected=${quest.id}`}><strong>{quest.name}</strong><small>{quest.trader} · ур. {quest.level}</small></Link><button className={`check-circle ${state.completedQuestIds.includes(quest.id) ? 'done' : ''}`} onClick={() => state.toggleCompletedQuest(quest.id)} aria-label="Отметить выполненным"><Check size={13} /></button></div>)}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div className="panel-title">Взять с собой</div><span className="tag"><PackageCheck size={11} /> {neededItems.length}</span></div>
          <div className="panel-body">
            {neededItems.map((item) => item && <Link to={`/items?selected=${item.id}`} className="item-row" key={item.id}><img className="item-thumb" src={item.iconUrl} alt="" /><span><strong>{item.name}</strong><small className="dim">{item.category} · для задания</small></span><KeyRound size={15} className="dim" /></Link>)}
            {neededItems.length === 0 && <p className="muted">В активных заданиях нет обязательных предметов.</p>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div className="panel-title">Рынок · избранное</div><Link to="/economy" className="dim">Подробнее <ChevronRight size={13} /></Link></div>
          <div className="panel-body">
            {favorites.map((item) => item && <div className="item-row" key={item.id}><img className="item-thumb" src={item.iconUrl} alt="" /><span><strong>{item.shortName}</strong><small className="dim">лучшее предложение</small></span><strong className="mono price-up">{formatPrice(Math.max(...item.prices.filter((p) => p.mode === state.raidMode).map((p) => p.price), 0))}</strong></div>)}
          </div>
        </section>
      </div>
    </div>
  </div>
}
