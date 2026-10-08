import { uiText } from '../i18n/renderText'
import { featureEnabled } from '../app/archivedFeatures'
import { useId, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Clock3, LockKeyhole, Map as MapIcon, Route, Users } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'
import { calculateAvailability, completedQuestStats, currentStoryStageIndex, isCurrentTrackedQuest, isStoryQuest, isLiveGameQuest } from '../progression/requirementEngine'
import { calculateMapAccess } from '../progression/mapAccess'
import { questAppliesToMap } from '../progression/questLocation'
import { aggregateRaidNeeds, ammoPackGroupLabel, groupAmmoPackAlternatives } from '../shared/raidNeeds'
import { sortQuestsChronologically } from '../progression/questChronology'
import { MapSlideshow } from '../components/MapSlideshow'
import { GoonCard } from '../components/GoonCard'
import { MapPriority } from '../components/MapPriority'
import { SquadRaidCard } from '../squad/RaidPlanner'
import { BossFigures } from '../components/BossFigures'
import { RaidSmoke } from '../components/RaidSmoke'
import { useLocale } from '../i18n/LocaleProvider'
import { CurrentTasksPanel } from '../components/CurrentTasksPanel'
import { RaidRequirementsPanel, type RaidNeedRow } from '../components/RaidRequirementsPanel'
import { KappaBreakdownPanel, KappaStatCard } from '../components/KappaProgress'
import { collectorKeyTasks } from '../components/collectorKeyTasks'

export function DashboardPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const [kappaOpen, setKappaOpen] = useState(false)
  const kappaListId = useId()
  const { locale } = useLocale()
  const selectedMap = data.maps.find((map) => map.id === state.selectedMapId) ?? data.maps[0]
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const currentQuests = data.quests.filter((quest) => isLiveGameQuest(quest) && isCurrentTrackedQuest(quest, progress))
  const onMap = (quest: typeof currentQuests[number], id: string) => {
    const stageIndex = currentStoryStageIndex(quest, progress)
    return questAppliesToMap(quest, id, stageIndex) && !quest.anyMap
  }
  const planQuests = currentQuests.filter((quest) => onMap(quest, selectedMap.id))
  const anyMapCurrent = currentQuests.filter((quest) => quest.anyMap)
  // Earliest tasks first, so the three rows of the collapsed list are the ones the game handed out first.
  const mapQuests = sortQuestsChronologically(planQuests, data.quests)
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const raidPrepPurposes = new Set(['place', 'mark', 'key', 'bring'])
  const requirements = [...planQuests, ...anyMapCurrent].flatMap((quest) => (quest.raidRequirements ?? []).filter((requirement) => raidPrepPurposes.has(requirement.purpose) && (!requirement.mapIds.length || requirement.mapIds.includes(selectedMap.id))).map((requirement) => ({ ...requirement, questName: quest.name })))
  // «Любая пачка патронов 7.62x51» instead of every pack an objective accepts.
  const grouped = groupAmmoPackAlternatives(requirements, (id) => itemById.get(id))
  const neededRows: RaidNeedRow[] = aggregateRaidNeeds(grouped.requirements, state.raidItemIds).flatMap((row) => {
    const group = grouped.groups.get(row.itemId)
    if (group) {
      const packs = group.itemIds.flatMap((id) => itemById.get(id) ?? [])
      // The card opens on the cheapest accepted pack: any of them will do.
      const cheapest = [...packs].sort((a, b) => (a.fleaPrice || Infinity) - (b.fleaPrice || Infinity))[0]
      if (!cheapest) return []
      return [{ ...row, key: row.itemId, name: ammoPackGroupLabel(group.caliber, locale), iconUrl: cheapest.iconUrl, href: `/flea?selected=${cheapest.id}`, title: [locale === 'en' ? 'Any of:' : 'Подходит любая:', ...packs.map((pack) => uiText(pack.name))].join('\n') }]
    }
    const item = itemById.get(row.itemId)
    return item ? [{ ...row, key: item.id, name: item.name, iconUrl: item.iconUrl, href: `/flea?selected=${item.id}` }] : []
  })
  const favorites = state.favoriteItemIds.map((id) => data.items.find((item) => item.id === id)).filter(Boolean)
  const stats = completedQuestStats(data.quests, availability)
  // «Задания для Капы»: the four key tasks Fence wants for «Коллекционер» (an alternative closes its step).
  const kappaRows = useMemo(() => collectorKeyTasks(data.quests, availability), [data.quests, availability])
  const kappaDone = kappaRows.filter((row) => row.state === 'completed').length
  const openKappa = () => setKappaOpen(true)
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
      <button className="button primary" onClick={openMap}><MapIcon size={16} />{uiText(" Открыть карту")}</button>
    </header>

    <section className="stat-grid">
      <div className="stat-card"><div className="stat-label">{uiText("Текущие задания")}</div><div className="stat-value">{uiText(currentQuests.length)}</div></div>
      <div className="stat-card"><div className="stat-label">{uiText("Прогресс")}</div><div className="stat-value">{uiText(stats.completed)}</div><div className="stat-meta">{uiText("выполнено из ")}{uiText(stats.total)} · {uiText(state.raidMode.toUpperCase())}</div></div>
      <KappaStatCard completed={kappaDone} total={kappaRows.length} open={kappaOpen} onOpen={openKappa} controlsId={kappaListId} />
      <GoonCard mode={state.raidMode} mapName={mapName} />
    </section>
    <MapPriority maps={data.maps} countFor={(id) => currentQuests.filter((quest) => onMap(quest, id)).length} onOpen={(id) => { state.setSelectedMapId(id); navigate(`/maps/${id}`) }} />
    <KappaBreakdownPanel id={kappaListId} open={kappaOpen} rows={kappaRows} completed={kappaDone} total={kappaRows.length} onClose={() => setKappaOpen(false)} />

    <div className="dashboard-layout">
      <div className="dashboard-column">
        <section className={`panel raid-card${mapPickerOpen ? ' is-picking' : ''}`}>
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
              <div className="raid-actions">{featureEnabled('raidRoute') && <button className="button primary" onClick={openMap}><Route size={16} />{uiText(" Построить маршрут")}</button>}<button className="button" onClick={() => setMapPickerOpen((value) => !value)}><MapIcon size={16} />{uiText(" Выбрать карту")}</button></div>
          </div>
        </section>

        <SquadRaidCard mode={state.raidMode} data={data} selectedMapId={selectedMap.id} onPickMap={(id) => state.setSelectedMapId(id)} />
        <RaidRequirementsPanel rows={neededRows} />
      </div>

      <div className="dashboard-column">
        <CurrentTasksPanel map={selectedMap} quests={mapQuests} anyMapQuests={anyMapCurrent} questLink={questOnMap} />

        <section className="panel market-favorites">
          <div className="panel-header"><div className="panel-title">{uiText("Рынок · избранное")}</div><Link to="/flea" className="dim">{uiText("Подробнее ")}<ChevronRight size={13} /></Link></div>
          <div className="panel-body">
            {uiText(favorites.map((item) => item && <div className="item-row" key={item.id}><img className="item-thumb" src={item.iconUrl} alt={uiText("")} /><span><strong>{uiText(item.shortName)}</strong><small className="dim">{uiText("лучшее предложение")}</small></span><strong className="mono price-up">{uiText(formatPrice(Math.max(...item.prices.filter((p) => p.mode === state.raidMode).map((p) => p.price), 0)))}</strong></div>))}
          </div>
        </section>
      </div>
    </div>
  </div>
}
