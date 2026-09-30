import { uiText } from '../i18n/renderText'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Clock3, KeyRound, LockKeyhole, Map, PackageCheck, Route, Users } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'
import { calculateAvailability, completedQuestStats, currentStoryStageIndex, isCurrentTrackedQuest, isStoryQuest } from '../progression/requirementEngine'
import { calculateMapAccess } from '../progression/mapAccess'
import { questAppliesToMap } from '../progression/questLocation'
import { aggregateRaidNeeds, formatItemCountLabel } from '../shared/raidNeeds'
import { MapSlideshow } from '../components/MapSlideshow'
import { GoonCard } from '../components/GoonCard'
import { MapPriority } from '../components/MapPriority'
import { BossFigures } from '../components/BossFigures'
import { RaidSmoke } from '../components/RaidSmoke'
import { useLocale } from '../i18n/LocaleProvider'

export function DashboardPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const { locale } = useLocale()
  const selectedMap = data.maps.find((map) => map.id === state.selectedMapId) ?? data.maps[0]
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const currentQuests = data.quests.filter((quest) => isCurrentTrackedQuest(quest, progress))
  const onMap = (quest: typeof currentQuests[number], id: string) => {
    const stageIndex = currentStoryStageIndex(quest, progress)
    return questAppliesToMap(quest, id, stageIndex) && !quest.anyMap
  }
  const planQuests = currentQuests.filter((quest) => onMap(quest, selectedMap.id))
  const anyMapCurrent = currentQuests.filter((quest) => quest.anyMap)
  const mapQuests = planQuests
  const raidPrepPurposes = new Set(['place', 'mark', 'key', 'bring'])
  const requirements = [...planQuests, ...anyMapCurrent].flatMap((quest) => (quest.raidRequirements ?? []).filter((requirement) => raidPrepPurposes.has(requirement.purpose) && (!requirement.mapIds.length || requirement.mapIds.includes(selectedMap.id))).map((requirement) => ({ ...requirement, questName: quest.name })))
  const neededRows = aggregateRaidNeeds(requirements, state.raidItemIds)
    .map((row) => ({ ...row, item: data.items.find((entry) => entry.id === row.itemId) }))
    .filter((row) => row.item)
  const favorites = state.favoriteItemIds.map((id) => data.items.find((item) => item.id === id)).filter(Boolean)
  const stats = completedQuestStats(data.quests, availability)
  const mapName = (id: string) => data.maps.find((map) => map.id === id)?.name ?? id

  const openMap = () => navigate(`/maps/${selectedMap.id}?quests=${state.trackedQuestIds.join(',')}`)
  // A current task opens on the map of this raid plan, focused on its point (a story chapter on its current stage).
  const questOnMap = (quest: typeof currentQuests[number]) => {
    const stage = isStoryQuest(quest) ? `&stage=${currentStoryStageIndex(quest, progress)}` : ''
    return `/maps/${selectedMap.id}?quest=${encodeURIComponent(quest.id)}${stage}`
  }

  return <div className="page">
    <header className="page-header">
      <div><div className="eyebrow">{uiText("Оперативный штаб · ")}{uiText(new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long' }))} · {uiText(state.raidMode.toUpperCase())}</div><h1 className="page-title">{uiText("Следующий рейд начинается здесь")}</h1></div>
      <button className="button primary" onClick={openMap}><Map size={16} />{uiText(" Открыть карту")}</button>
    </header>

    <section className="stat-grid">
      <div className="stat-card"><div className="stat-label">{uiText("Текущие задания")}</div><div className="stat-value">{uiText(currentQuests.length)}</div></div>
      <div className="stat-card"><div className="stat-label">{uiText("Прогресс")}</div><div className="stat-value">{uiText(stats.completed)}</div><div className="stat-meta">{uiText("выполнено из ")}{uiText(stats.total)} · {uiText(state.raidMode.toUpperCase())}</div></div>
      <div className="stat-card kappa-card"><Link className="button small kappa-items-button" to="/kappa-items">{uiText("Предметы")}</Link><div className="stat-label">{uiText("Капа")}</div><div className="stat-value">{uiText(stats.kappaCompleted)}</div><div className="stat-meta">{uiText("Выполнено ")}{uiText(stats.kappaCompleted)}{uiText(" из ")}{uiText(stats.kappaTotal)}</div></div>
      <GoonCard mode={state.raidMode} mapName={mapName} />
    </section>

    <div className="dashboard-layout">
      <div className="dashboard-column">
        <section className="panel raid-card">
          <div className="raid-card-art" style={{ backgroundImage: `url(${selectedMap.imageUrl})` }} />
          <RaidSmoke mapId={selectedMap.id} />
          <BossFigures mapId={selectedMap.id} />
          <div className="raid-content">
            <div className="raid-main">
              <span className="tag brass">{uiText("ПЛАН РЕЙДА · ")}{uiText(state.raidMode.toUpperCase())}</span>
              <h2 className="raid-map-name">{uiText(selectedMap.name)}</h2>
              <div className="raid-facts"><span><Clock3 size={13} /> {uiText(selectedMap.raidTime)}{uiText(" мин")}</span><span><Users size={13} /> {uiText(selectedMap.players)}{uiText(" игроков")}</span></div>

            </div>
            <div className={`raid-map-picker ${mapPickerOpen ? 'is-open' : ''}`} aria-hidden={!mapPickerOpen}>
              <MapSlideshow active={mapPickerOpen} firstMapId={selectedMap.id} />
              <div className="raid-map-picker-grid">
                {uiText(data.maps.map((map) => {
                  const access = calculateMapAccess(map, data.quests, availability)
                  return <button key={map.id} tabIndex={mapPickerOpen ? 0 : -1} aria-disabled={access.locked} title={uiText(access.locked ? access.quest?.name : map.name)} onClick={() => { if (!access.locked) { state.setSelectedMapId(map.id); setMapPickerOpen(false) } }}><span className="map-color" style={{ background: map.accent }} />{uiText(map.name)}{uiText(access.locked && <LockKeyhole size={13} />)}</button>
                }))}
              </div>
            </div>
              <div className="raid-actions"><button className="button primary" onClick={openMap}><Route size={16} />{uiText(" Построить маршрут")}</button><button className="button" onClick={() => setMapPickerOpen((value) => !value)}><Map size={16} />{uiText(" Выбрать карту")}</button></div>
          </div>
        </section>

        <MapPriority maps={data.maps} countFor={(id) => currentQuests.filter((quest) => onMap(quest, id)).length} onOpen={(id) => { state.setSelectedMapId(id); navigate(`/maps/${id}`) }} />
      </div>

      <div className="dashboard-column">
        <section className="panel">
          <div className="panel-header"><div className="panel-title">{uiText("Текущие задания")}</div><Link to={`/maps/${selectedMap.id}`} className="tag brass">{uiText(mapQuests.length)}{uiText(" на ")}{uiText(selectedMap.name)}</Link></div>
          <div className="panel-body">
            {uiText(mapQuests.slice(0, 10).map((quest, index) => <div className="quest-row" key={quest.id}><div className="quest-index">{uiText(String(index + 1).padStart(2, '0'))}</div><Link to={questOnMap(quest)} title={uiText("Показать на карте")}><strong>{uiText(quest.name)}</strong><small>{uiText(quest.trader)}{uiText(" · ур. ")}{uiText(quest.level)}{uiText(quest.kappa ? ' · капа' : '')}</small></Link></div>))}
            {uiText(!mapQuests.length && <p className="muted">{uiText("На карте «")}{uiText(selectedMap.name)}{uiText("» нет заданий текущего этапа. Они появятся, когда вы примете в игре задание с этой локации.")}</p>)}
            {uiText(anyMapCurrent.length > 0 && <div style={{ marginTop: 14 }}><div className="stat-label" style={{ marginBottom: 8 }}>{uiText("Любая карта · ")}{uiText(anyMapCurrent.length)}</div>{uiText(anyMapCurrent.slice(0, 4).map((quest) => <div className="quest-row" key={quest.id}><div className="quest-index">∞</div><Link to={questOnMap(quest)} title={uiText("Показать на карте")}><strong>{uiText(quest.name)}</strong><small>{uiText(quest.trader)}{uiText(quest.kappa ? ' · капа' : '')}</small></Link></div>))}</div>)}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div className="panel-title">{uiText("Требования рейда")}</div><span className="tag"><PackageCheck size={11} /> {uiText(neededRows.length)}</span></div>
          <div className="panel-body">
            {uiText(neededRows.map((row) => {
              if (!row.item) return null
              const purposes = { place: 'Взять и заложить', mark: 'Взять для маркировки', key: 'Взять ключ', bring: 'Взять с собой', handover: 'Передать торговцу', find: 'Найти в рейде' }
              return <Link to={`/flea?selected=${row.item.id}`} className="item-row" key={row.item.id}>
                <img className="item-thumb" src={row.item.iconUrl} alt={uiText("")} />
                <span>
                  <strong>{uiText(formatItemCountLabel(row.item.name, row.count))}</strong>
                  {uiText(row.fromRaidListOnly
                    ? <small className="dim" style={{ display: 'block' }}>{uiText("Добавлено с барахолки")}</small>
                    : row.lines.map((line) => (
                      <small className="dim" style={{ display: 'block' }} key={line.purpose}>
                        {uiText(purposes[line.purpose as keyof typeof purposes] ?? line.purpose)}
                        {uiText(line.questNames.length ? ` · ${line.questNames.join(', ')}` : '')}
                      </small>
                    )))}
                </span>
                <KeyRound size={15} className="dim" />
              </Link>
            }))}
            {uiText(neededRows.length === 0 && <p className="muted">{uiText("Для текущих заданий на этой карте нет предметов, которые нужно взять с собой или заложить.")}</p>)}
            {uiText(neededRows.length > 0 && <p className="muted" style={{ marginTop: 12 }}>{uiText("Только то, что нужно взять в рейд: заложить, пометить или открыть дверь. Предметы «найти и вынести» сюда не входят.")}</p>)}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div className="panel-title">{uiText("Рынок · избранное")}</div><Link to="/flea" className="dim">{uiText("Подробнее ")}<ChevronRight size={13} /></Link></div>
          <div className="panel-body">
            {uiText(favorites.map((item) => item && <div className="item-row" key={item.id}><img className="item-thumb" src={item.iconUrl} alt={uiText("")} /><span><strong>{uiText(item.shortName)}</strong><small className="dim">{uiText("лучшее предложение")}</small></span><strong className="mono price-up">{uiText(formatPrice(Math.max(...item.prices.filter((p) => p.mode === state.raidMode).map((p) => p.price), 0)))}</strong></div>))}
          </div>
        </section>
      </div>
    </div>
  </div>
}
