import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Circle, Info, LockKeyhole, MapPin, Search, Trophy } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { calculateAvailability } from '../progression/requirementEngine'
import type { TaskProgressStatus } from '../domain/types'

const filterLabels: Record<string, string> = {
  available: 'Доступные', all: 'Все', locked: 'Закрытые', completed: 'Выполненные', kappa: 'Kappa',
}

export function QuestsPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [trader, setTrader] = useState('Все торговцы')
  const [statusFilter, setStatusFilter] = useState('available')
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const selectedId = params.get('selected') ?? data.quests.find((quest) => availability.get(quest.id)?.status === 'available')?.id ?? data.quests[0]?.id
  const selected = data.quests.find((quest) => quest.id === selectedId) ?? data.quests[0]
  const traders = ['Все торговцы', ...new Set(data.quests.map((quest) => quest.trader))]
  const kappaTasks = data.quests.filter((quest) => quest.kappa)
  const kappaCompleted = kappaTasks.filter((quest) => availability.get(quest.id)?.status === 'completed').length

  const filtered = useMemo(() => data.quests.filter((quest) => {
    const status = availability.get(quest.id)?.status ?? 'unknown'
    const matchesQuery = `${quest.name} ${quest.trader} ${quest.description}`.toLowerCase().includes(query.toLowerCase())
    const matchesTrader = trader === 'Все торговцы' || quest.trader === trader
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'kappa' ? quest.kappa : status === statusFilter)
    return matchesQuery && matchesTrader && matchesStatus
  }).slice(0, 500), [availability, data.quests, query, trader, statusFilter])

  if (!selected) return null
  const selectedAvailability = availability.get(selected.id)

  return <div className="page">
    <header className="page-header"><div><div className="eyebrow">Прогресс операции · {state.activeProfile.displayName}</div><h1 className="page-title">Задания</h1><p className="page-subtitle">Сначала показаны доступные задания. Доступность пересчитывается по уровню и цепочкам автоматически.</p></div><span className="tag brass"><Trophy size={12} /> Kappa: {kappaCompleted} / {kappaTasks.length} · осталось {Math.max(0, kappaTasks.length - kappaCompleted)}</span></header>
    <div className="filter-row quest-filter-bar">
      <div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-dim)' }} /><input className="input" style={{ paddingLeft: 34 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск задания…" /></div>
      <select className="select" value={trader} onChange={(event) => setTrader(event.target.value)}>{traders.map((entry) => <option key={entry}>{entry}</option>)}</select>
      <div className="segmented-filter">{Object.entries(filterLabels).map(([value, label]) => <button key={value} className={statusFilter === value ? 'active' : ''} onClick={() => setStatusFilter(value)}>{label}</button>)}</div>
      <span className="dim">Найдено: {filtered.length}</span>
    </div>

    <div className="split-page">
      <section className="panel">
        <div className="panel-header"><div className="panel-title">Каталог заданий</div><span className="tag green">{state.completedQuestIds.length} выполнено</span></div>
        <div className="panel-body catalog-list" style={{ maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }}>
          {filtered.map((quest) => {
            const info = availability.get(quest.id)
            const done = info?.status === 'completed'
            return <div key={quest.id} className={`catalog-card quest-catalog-card ${quest.id === selected.id ? 'selected' : ''}`}>
              <button className={`quest-complete-left ${done ? 'done' : ''}`} onClick={() => state.toggleCompletedQuest(quest.id)} aria-label={done ? `Снять выполнение: ${quest.name}` : `Отметить выполненным: ${quest.name}`} title={done ? 'Снять отметку' : 'Отметить выполненным'}>{done ? <Check size={17} /> : <Circle size={17} />}</button>
              <button className="quest-card-main" onClick={() => setParams({ selected: quest.id })}>
                <span><h3>{quest.name}</h3><p>{quest.trader} · ур. {quest.level} · {quest.mapId ? data.maps.find((map) => map.id === quest.mapId)?.name ?? quest.mapId : 'Любая карта'}</p></span>
                <QuestStatusTag status={info?.status ?? 'unknown'} inferred={info?.inferred} kappa={quest.kappa} />
              </button>
            </div>
          })}
          {!filtered.length && <div className="empty-state"><div><Search size={26} /><p>Нет заданий с такими фильтрами.</p></div></div>}
        </div>
      </section>

      <aside className="panel detail-panel">
        <div className="detail-hero"><div className="eyebrow">{selected.trader} · уровень {selected.level}</div><h2 style={{ margin: '10px 0 9px', fontSize: 28 }}>{selected.name}</h2><div className="filter-row" style={{ margin: 0 }}><QuestStatusTag status={selectedAvailability?.status ?? 'unknown'} inferred={selectedAvailability?.inferred} kappa={selected.kappa} />{selected.mapId && <span className="tag"><MapPin size={11} /> {data.maps.find((map) => map.id === selected.mapId)?.name ?? selected.mapId}</span>}</div></div>
        {selectedAvailability?.inferred && <div className="detail-section import-note"><Info size={14} /> Выполнение выведено из подтверждённой последующей цепочки.</div>}
        {selectedAvailability?.blockers.length ? <div className="detail-section blocker-box"><h4><LockKeyhole size={14} /> Почему закрыто</h4>{selectedAvailability.blockers.map((blocker) => <p key={blocker}>{resolveBlocker(blocker, data.quests)}</p>)}</div> : null}
        <div className="detail-section"><h4>Задача</h4><p>{selected.description}</p></div>
        <div className="detail-section"><h4>Цели</h4>{selected.objectives.length ? selected.objectives.map((objective, index) => <div className="quest-objective" key={`${objective}-${index}`}><span className="objective-dot" /><span>{objective}</span></div>) : <p>Подробные цели временно недоступны.</p>}</div>
        {selected.requiredItems?.length ? <div className="detail-section"><h4>Требуемые предметы</h4>{selected.requiredItems.slice(0, 12).map((id) => { const item = data.items.find((entry) => entry.id === id); return item ? <Link className="item-row" key={id} to={`/items?selected=${id}`}><img className="item-thumb" src={item.iconUrl} alt="" /><span><strong>{item.name}</strong><small className="dim">{item.category}</small></span></Link> : null })}</div> : null}
        <div className="detail-section"><h4>Награды</h4>{selected.rewards.map((reward) => <div className="quest-objective" key={reward}><Trophy size={15} color="var(--brass)" /><span>{reward}</span></div>)}</div>
        <div className="detail-section stack">{selected.mapId && <Link className="button ghost" to={`/maps/${selected.mapId}?quest=${selected.id}`}><MapPin size={15} /> Показать на карте</Link>}</div>
      </aside>
    </div>
  </div>
}

function QuestStatusTag({ status, inferred, kappa }: { status: TaskProgressStatus; inferred?: boolean; kappa: boolean }) {
  if (status === 'completed') return <span className="tag green">{inferred ? 'Выполнено по цепочке' : 'Выполнено'}</span>
  if (status === 'failed') return <span className="tag danger">Провалено</span>
  if (status === 'active') return <span className="tag brass">Начато</span>
  if (status === 'available') return <span className="tag green">Доступно</span>
  if (status === 'locked') return <span className="tag"><LockKeyhole size={11} /> Закрыто</span>
  return <span className={`tag ${kappa ? 'brass' : ''}`}>{kappa ? 'Kappa' : 'Неизвестно'}</span>
}

function resolveBlocker(blocker: string, quests: Array<{ id: string; name: string }>) {
  const id = blocker.match(/[a-f0-9]{24}$/i)?.[0]
  return id ? blocker.replace(id, quests.find((quest) => quest.id === id)?.name ?? id) : blocker
}
