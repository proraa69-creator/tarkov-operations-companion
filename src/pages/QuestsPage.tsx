import { uiText } from '../i18n/renderText'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MapPin, Search, Trophy } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { collectorKeyTasks } from '../components/collectorKeyTasks'
import { calculateAvailability, completedQuestStats, currentStoryStageIndex, isLiveGameQuest, isStoryQuest } from '../progression/requirementEngine'
import type { Quest, TaskProgressStatus } from '../domain/types'
import { isMobileLayout } from '../platform'
import { QuestObjectivesPanel } from '../components/QuestObjectivesPanel'
import { belongsInQuestSection } from '../progression/questSections'
import { visibleStoryObjectives } from '../progression/storyObjectives'
import { StoryObjectivesPanel } from '../components/StoryObjectivesPanel'
import './storyObjectives.css'

const filterLabels: Record<string, string> = {
  active: 'Текущие',
  story: 'Сюжетные',
  completed: 'Выполненные',
  all: 'Все',
  kappa: 'Капа',
}

const pageTitles: Record<string, string> = {
  active: 'Текущие задания',
  story: 'Сюжетные квесты',
  completed: 'Выполненные задания',
  all: 'Все задания',
  kappa: 'Задания капы',
}

export function QuestsPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [trader, setTrader] = useState('Все торговцы')
  const initialFilter = params.get('filter')
  const statusFilter = initialFilter && initialFilter in filterLabels ? initialFilter : 'active'
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const traders = ['Все торговцы', ...new Set(data.quests.filter((quest) => statusFilter === 'story' ? isStoryQuest(quest) : isLiveGameQuest(quest)).map((quest) => quest.trader))]
  const stats = completedQuestStats(data.quests, availability)
  // the same count as the Overview Kappa card: the four key tasks for «Коллекционер»
  const kappaKeys = useMemo(() => collectorKeyTasks(data.quests, availability), [data.quests, availability])
  const storyQuests = data.quests.filter((quest) => belongsInQuestSection(quest, progress, 'story'))

  const filtered = useMemo(() => data.quests.filter((quest) => {
    const status = availability.get(quest.id)?.status ?? 'unknown'
    const matchesQuery = `${quest.name} ${quest.trader} ${quest.description} ${uiText(quest.name)} ${uiText(quest.trader)}`.toLowerCase().includes(query.toLowerCase())
    const matchesTrader = trader === 'Все торговцы' || quest.trader === trader
    return matchesQuery && matchesTrader && belongsInQuestSection(quest, progress, statusFilter, status)
  }).sort((left, right) => (left.storyOrder ?? 99) - (right.storyOrder ?? 99) || left.name.localeCompare(right.name, 'ru')), [availability, data.quests, progress, query, trader, statusFilter])
  const selectedId = params.get('selected') ?? filtered[0]?.id
  const selected = filtered.find((quest) => quest.id === selectedId) ?? filtered[0]
  const selectedAvailability = selected ? availability.get(selected.id) : undefined
  const selectedStageIndex = selected ? currentStoryStageIndex(selected, progress) : 0
  const selectedStage = selected?.stages?.[selectedStageIndex]
  const mapTarget = selectedStage?.mapIds[0] ?? selected?.mapId ?? selected?.mapIds?.[0] ?? 'customs'

  return <div className="page">
    <header className="page-header"><div><div className="eyebrow">{uiText("Прогресс операции · ")}{uiText(state.activeProfile.displayName)}</div><h1 className="page-title">{uiText(pageTitles[statusFilter] ?? 'Текущие задания')}</h1>{statusFilter !== 'story' && <p className="page-subtitle">{uiText(!isMobileLayout() ? 'Принятые в игре задания этого режима по журналам EFT.' : 'Принятые в игре задания этого режима приходят с сервера от приложения для ПК.')}</p>}</div><span className="tag brass"><Trophy size={12} /> {uiText(statusFilter === 'story' ? `Текущих: ${storyQuests.length}` : `Капа: выполнено ${kappaKeys.filter((row) => row.state === 'completed').length} из ${kappaKeys.length}`)}</span></header>
    <div className="filter-row quest-filter-bar">
      <div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-dim)' }} /><input className="input" style={{ paddingLeft: 34 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("Поиск задания…")} /></div>
      <select className="select" value={trader} onChange={(event) => setTrader(event.target.value)}>{uiText(traders.map((entry) => <option key={entry}>{uiText(entry)}</option>))}</select>
      <div className="segmented-filter">{uiText(Object.entries(filterLabels).map(([value, label]) => <button key={value} className={statusFilter === value ? 'active' : ''} onClick={() => { setParams((current) => { const next = new URLSearchParams(current); if (value === 'active') next.delete('filter'); else next.set('filter', value); return next }) }}>{uiText(label)}</button>))}</div>
      <span className="dim">{uiText("Найдено: ")}{uiText(filtered.length)}</span>
    </div>

    <div className="split-page">
      <section className="panel">
        <div className="panel-header"><div className="panel-title">{uiText(statusFilter === 'story' ? 'Главы истории' : 'Каталог заданий')}</div><span className="tag green">{uiText(stats.completed)}{uiText(" выполнено · ")}{uiText(state.raidMode.toUpperCase())}</span></div>
        <div className="panel-body catalog-list" style={{ maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }}>
          {uiText(filtered.map((quest) => {
            const info = availability.get(quest.id)
            const stageIndex = currentStoryStageIndex(quest, progress)
            const stage = quest.stages?.[stageIndex]
            const currentObjectives = isStoryQuest(quest) ? visibleStoryObjectives(quest, progress).filter(objective => !objective.completed) : []
            return <div key={quest.id} className={`catalog-card quest-catalog-card quest-map-row ${quest.id === selected?.id ? 'selected' : ''}`}>
              <button type="button" className="quest-map-row-main" onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set('selected', quest.id); return next })}>
              <span className="quest-card-copy">
                <h3>{uiText(quest.name)}</h3>
                <p>{uiText(isStoryQuest(quest)
                  ? currentObjectives.map(objective => objective.text).join(' · ') || 'Ожидаем актуальные задачи из игры.'
                  : `${quest.trader} · ур. ${quest.level} · ${quest.anyMap ? 'Любая карта' : quest.mapId ? data.maps.find((map) => map.id === quest.mapId)?.name ?? quest.mapId : 'У торговца'}`)}</p>
              </span>
              </button>
              {uiText(!isStoryQuest(quest) && (quest.anyMap || quest.mapId || quest.mapIds?.length || stage?.mapIds.length) && <Link className="quest-map-pin" to={mapLink(quest, stageIndex)} title={uiText("Показать на карте")} aria-label={uiText(`Показать ${quest.name} на карте`)} onClick={(event) => event.stopPropagation()}><MapPin size={15} /></Link>)}
              <QuestStatusTag status={info?.status ?? 'unknown'} kappa={quest.kappa} story={isStoryQuest(quest)} />
            </div>
          }))}
          {uiText(!filtered.length && <div className="empty-state"><div><Search size={26} /><p>{uiText(emptyCopy(statusFilter))}</p></div></div>)}
        </div>
      </section>

      <aside className="panel detail-panel quest-detail">
        {uiText(!selected && <div className="map-detail-empty"><div><Search size={30} /><h3>{uiText("Нет выбранного задания")}</h3><p>{uiText(emptyCopy(statusFilter))}</p></div></div>)}
        {uiText(selected && <div>
        <div className="detail-hero"><div className="eyebrow">{uiText(selected.trader)}{uiText(!isStoryQuest(selected) ? ` · уровень ${selected.level}` : '')}</div><h2 style={{ margin: '10px 0 9px', fontSize: 28 }}>{uiText(selected.name)}</h2><div className="filter-row" style={{ margin: 0 }}><QuestStatusTag status={selectedAvailability?.status ?? 'unknown'} kappa={selected.kappa} story={isStoryQuest(selected)} />{uiText(!isStoryQuest(selected) && (selected.anyMap ? <span className="tag"><MapPin size={11} />{uiText(" Любая карта")}</span> : selected.mapId && <span className="tag"><MapPin size={11} /> {uiText(data.maps.find((map) => map.id === selected.mapId)?.name ?? selected.mapId)}</span>))}</div></div>
        {isStoryQuest(selected) ? <StoryObjectivesPanel quest={selected} progress={progress} maps={data.maps} /> : <>
        <div className="detail-section"><h4>{uiText("Задача")}</h4><p>{uiText(selected.description)}</p></div>
        <QuestObjectivesPanel quest={selected} />
        {uiText(selected.requiredItems?.length ? <div className="detail-section"><h4>{uiText("Требуемые предметы")}</h4>{uiText(selected.requiredItems.slice(0, 12).map((id) => { const item = data.items.find((entry) => entry.id === id); return item ? <Link className="item-row" key={id} to={`/flea?selected=${id}`}><img className="item-thumb" src={item.iconUrl} alt={uiText("")} /><span><strong>{uiText(item.name)}</strong><small className="dim">{uiText(item.category)}</small></span></Link> : null }))}</div> : null)}
        <div className="detail-section"><h4>{uiText("Награды")}</h4>{uiText(selected.rewards.length ? selected.rewards.map((reward) => <div className="quest-objective" key={reward}><Trophy size={15} color="var(--brass)" /><span>{uiText(reward)}</span></div>) : <p className="dim">{uiText("Награды на Wiki не указаны.")}</p>)}</div>
        <div className="detail-section stack">{uiText((selected.anyMap || selected.mapId || selected.mapIds?.length || selectedStage?.mapIds.length) && <Link className="button ghost" to={`/maps/${mapTarget}?quest=${selected.id}${isStoryQuest(selected) ? `&stage=${selectedStageIndex}` : ''}`}><MapPin size={15} />{uiText(" Показать на карте")}</Link>)}{uiText(selected.wikiLink && <a className="button ghost" href={selected.wikiLink} target="_blank" rel="noreferrer">{uiText("Страница на Wiki")}</a>)}</div>
        </>}
        </div>)}
      </aside>
    </div>
  </div>
}

function mapLink(quest: Quest, stageIndex: number) {
  const stageMap = quest.stages?.[stageIndex]?.mapIds[0]
  const mapId = stageMap ?? quest.mapId ?? quest.mapIds?.[0] ?? 'customs'
  const stage = quest.kind === 'story' ? `&stage=${stageIndex}` : ''
  return `/maps/${mapId}?quest=${quest.id}${stage}`
}

function emptyCopy(filter: string) {
  if (filter === 'active') return !isMobileLayout()
    ? 'В журналах этого режима нет принятых заданий. Примите задание у торговца в игре — оно появится здесь само.'
    : 'Принятых заданий этого режима пока нет. Их присылает приложение для ПК через сервер: войдите в тот же аккаунт в настройках.'
  if (filter === 'story') return 'Сюжетные главы не найдены.'
  return 'Нет заданий с такими фильтрами.'
}

function QuestStatusTag({ status, kappa, story }: { status: TaskProgressStatus; kappa: boolean; story?: boolean }) {
  if (status === 'completed') return <span className="tag green">{uiText("Выполнено")}</span>
  if (status === 'failed') return <span className="tag danger">{uiText("Провалено")}</span>
  if (status === 'active') {
    return <>
      <span className="tag brass">{uiText(story ? 'Текущая глава' : 'Текущее')}</span>
      {uiText(kappa && <span className="tag brass">{uiText("капа")}</span>)}
    </>
  }
  if (story) return <span className="tag">{uiText("Глава истории")}</span>
  return <span className={`tag ${kappa ? 'brass' : ''}`}>{uiText(kappa ? 'капа' : 'Каталог')}</span>
}
