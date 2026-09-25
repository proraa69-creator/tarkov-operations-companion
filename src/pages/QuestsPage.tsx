import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Circle, MapPin, Search, Target, Trophy } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'

export function QuestsPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [trader, setTrader] = useState('Все торговцы')
  const [trackedOnly, setTrackedOnly] = useState(false)
  const selectedId = params.get('selected') ?? state.trackedQuestIds[0] ?? data.quests[0]?.id
  const selected = data.quests.find((quest) => quest.id === selectedId) ?? data.quests[0]
  const traders = ['Все торговцы', ...new Set(data.quests.map((quest) => quest.trader))]

  const filtered = useMemo(() => data.quests.filter((quest) => {
    const matchesQuery = `${quest.name} ${quest.trader} ${quest.description}`.toLowerCase().includes(query.toLowerCase())
    const matchesTrader = trader === 'Все торговцы' || quest.trader === trader
    const matchesTracked = !trackedOnly || state.trackedQuestIds.includes(quest.id)
    return matchesQuery && matchesTrader && matchesTracked
  }).slice(0, 120), [data.quests, query, trader, trackedOnly, state.trackedQuestIds])

  if (!selected) return null

  return <div className="page">
    <header className="page-header"><div><div className="eyebrow">Прогресс операции</div><h1 className="page-title">Задания</h1><p className="page-subtitle">Отслеживайте цепочки, требования и цели на карте. Все отметки остаются только на этом компьютере.</p></div><span className="tag brass"><Trophy size={12} /> Kappa: {data.quests.filter((quest) => quest.kappa).length}</span></header>
    <div className="filter-row">
      <div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-dim)' }} /><input className="input" style={{ paddingLeft: 34 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск задания…" /></div>
      <select className="select" value={trader} onChange={(event) => setTrader(event.target.value)}>{traders.map((entry) => <option key={entry}>{entry}</option>)}</select>
      <button className={`button ${trackedOnly ? 'primary' : 'ghost'}`} onClick={() => setTrackedOnly((value) => !value)}><Target size={15} /> Только активные</button>
      <span className="dim">Найдено: {filtered.length}</span>
    </div>

    <div className="split-page">
      <section className="panel">
        <div className="panel-header"><div className="panel-title">Каталог заданий</div><span className="tag">{state.completedQuestIds.length} выполнено</span></div>
        <div className="panel-body catalog-list" style={{ maxHeight: 'calc(100vh - 235px)', overflow: 'auto' }}>
          {filtered.map((quest) => {
            const done = state.completedQuestIds.includes(quest.id)
            const tracked = state.trackedQuestIds.includes(quest.id)
            return <button key={quest.id} className={`catalog-card ${quest.id === selected.id ? 'selected' : ''}`} onClick={() => setParams({ selected: quest.id })}><div className="quest-index" style={done ? { color: '#b9d3bc', background: '#243829' } : undefined}>{done ? <Check size={14} /> : quest.level}</div><span><h3>{quest.name}</h3><p>{quest.trader} · {quest.mapId ? data.maps.find((map) => map.id === quest.mapId)?.name ?? quest.mapId : 'Любая карта'}</p></span><span className={`tag ${tracked ? 'brass' : ''}`}>{tracked ? 'В работе' : quest.kappa ? 'Kappa' : 'Побочное'}</span></button>
          })}
          {!filtered.length && <div className="empty-state"><div><Search size={26} /><p>Нет заданий с такими фильтрами.</p></div></div>}
        </div>
      </section>

      <aside className="panel detail-panel">
        <div className="detail-hero"><div className="eyebrow">{selected.trader} · уровень {selected.level}</div><h2 style={{ margin: '10px 0 9px', fontSize: 28 }}>{selected.name}</h2><div className="filter-row" style={{ margin: 0 }}><span className={`tag ${selected.kappa ? 'brass' : ''}`}>{selected.kappa ? 'Нужно для Kappa' : 'Побочное'}</span>{selected.mapId && <span className="tag"><MapPin size={11} /> {data.maps.find((map) => map.id === selected.mapId)?.name ?? selected.mapId}</span>}</div></div>
        <div className="detail-section"><h4>Задача</h4><p>{selected.description}</p></div>
        <div className="detail-section"><h4>Цели</h4>{selected.objectives.length ? selected.objectives.map((objective, index) => <div className="quest-objective" key={`${objective}-${index}`}><span className="objective-dot" /><span>{objective}</span></div>) : <p>Подробные цели временно недоступны.</p>}</div>
        {selected.requiredItems?.length ? <div className="detail-section"><h4>Требуемые предметы</h4>{selected.requiredItems.map((id) => { const item = data.items.find((entry) => entry.id === id); return item ? <Link className="item-row" key={id} to={`/items?selected=${id}`}><img className="item-thumb" src={item.iconUrl} alt="" /><span><strong>{item.name}</strong><small className="dim">{item.category}</small></span></Link> : null })}</div> : null}
        <div className="detail-section"><h4>Награды</h4>{selected.rewards.map((reward) => <div className="quest-objective" key={reward}><Trophy size={15} color="var(--brass)" /><span>{reward}</span></div>)}</div>
        <div className="detail-section stack">
          <button className={`button ${state.trackedQuestIds.includes(selected.id) ? 'primary' : ''}`} onClick={() => state.toggleTrackedQuest(selected.id)}><Target size={15} /> {state.trackedQuestIds.includes(selected.id) ? 'Убрать из активных' : 'Добавить в активные'}</button>
          <button className="button" onClick={() => state.toggleCompletedQuest(selected.id)}>{state.completedQuestIds.includes(selected.id) ? <Check size={15} /> : <Circle size={15} />} {state.completedQuestIds.includes(selected.id) ? 'Отмечено выполненным' : 'Отметить выполненным'}</button>
          {selected.mapId && <Link className="button ghost" to={`/maps/${selected.mapId}?quest=${selected.id}`}><MapPin size={15} /> Показать на карте</Link>}
        </div>
      </aside>
    </div>
  </div>
}
