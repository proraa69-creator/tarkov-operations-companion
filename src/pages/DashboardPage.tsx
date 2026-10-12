import { uiText } from '../i18n/renderText'
import { featureEnabled } from '../app/archivedFeatures'
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Clock3, LayoutDashboard, Map as MapIcon, MapPinned, RotateCcw, Route, Users } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'
import { displayPrice, favoritePriceLabel } from '../domain/itemPrices'
import { calculateAvailability, completedQuestStats, currentStoryStageIndex, isCurrentTrackedQuest, isStoryQuest, isLiveGameQuest } from '../progression/requirementEngine'
import { calculateMapAccess } from '../progression/mapAccess'
import { questAppliesToMap } from '../progression/questLocation'
import { aggregateRaidNeeds, ammoPackGroupLabel, groupAlternatives } from '../shared/raidNeeds'
import { sortQuestsChronologically } from '../progression/questChronology'
import { MapPicker } from '../components/MapPicker'
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
import { GunsmithPanel } from '../gunsmith/GunsmithPanel'
import { gunsmithSteps, isGunsmithQuest } from '../gunsmith/gunsmith'
import { CountUp } from '../components/CountUp'
import { OverviewBlock } from '../overview/OverviewBlock'
import { useOverviewEditor } from '../overview/useOverviewEditor'
import '../styles/overviewEdit.css'

type Blocks = Record<string, { label: string; node: ReactNode }>

export function DashboardPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const raidCardRef = useRef<HTMLElement>(null)
  const [kappaOpen, setKappaOpen] = useState(false)
  const kappaListId = useId()
  const { locale } = useLocale()
  // «Настроить блоки» (owner, 12.10.2026): every block but the big map can be moved, each keeps its shape.
  const editor = useOverviewEditor()
  const { layout } = editor
  const selectedMap = data.maps.find((map) => map.id === state.selectedMapId) ?? data.maps[0]
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const currentQuests = data.quests.filter((quest) => isLiveGameQuest(quest) && isCurrentTrackedQuest(quest, progress))
  // «Оружейник» parts go to their own block below «Текущие задания», not into the task lists (owner, 10.10.2026).
  const taskQuests = currentQuests.filter((quest) => !isGunsmithQuest(quest))
  const gunsmith = useMemo(() => gunsmithSteps(data.quests, (id) => availability.get(id)?.status), [availability, data.quests])
  const onMap = (quest: typeof currentQuests[number], id: string) => {
    const stageIndex = currentStoryStageIndex(quest, progress)
    return questAppliesToMap(quest, id, stageIndex) && !quest.anyMap
  }
  const planQuests = taskQuests.filter((quest) => onMap(quest, selectedMap.id))
  const anyMapCurrent = taskQuests.filter((quest) => quest.anyMap)
  // Earliest tasks first, so the three rows of the collapsed list are the ones the game handed out first.
  const mapQuests = sortQuestsChronologically(planQuests, data.quests)
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const raidPrepPurposes = new Set(['place', 'mark', 'key', 'bring'])
  const requirements = [...planQuests, ...anyMapCurrent].flatMap((quest) => (quest.raidRequirements ?? []).filter((requirement) => raidPrepPurposes.has(requirement.purpose) && (!requirement.mapIds.length || requirement.mapIds.includes(selectedMap.id))).map((requirement) => ({ ...requirement, questName: quest.name })))
  // «Любая пачка патронов 7.62x51» instead of every pack an objective accepts.
  const grouped = groupAlternatives(requirements, (id) => itemById.get(id))
  const neededRows: RaidNeedRow[] = aggregateRaidNeeds(grouped.requirements, state.raidItemIds).flatMap((row) => {
    const group = grouped.groups.get(row.itemId)
    if (group) {
      const options = group.itemIds.flatMap((id) => itemById.get(id) ?? [])
      // The row opens on the cheapest accepted item: any of them will do.
      const cheapest = [...options].sort((a, b) => (a.fleaPrice || Infinity) - (b.fleaPrice || Infinity))[0]
      if (!cheapest) return []
      const card = (items: typeof options) => items.map((item) => ({ id: item.id, name: item.name, iconUrl: item.iconUrl }))
      // «Любая пачка патронов 7.62x51»: every pack in the card. Anything else: one item in the list, the others in the card.
      if (group.kind === 'ammo-pack' && group.caliber) {
        return [{ ...row, key: row.itemId, name: ammoPackGroupLabel(group.caliber, locale), iconUrl: cheapest.iconUrl, href: `/flea?selected=${cheapest.id}`, alternatives: { title: 'Подходит любая', items: card(options) } }]
      }
      const others = options.filter((item) => item.id !== cheapest.id)
      return [{ ...row, key: row.itemId, name: cheapest.name, iconUrl: cheapest.iconUrl, href: `/flea?selected=${cheapest.id}`, alternatives: { title: 'Подходит и', items: card(others), badge: `+${others.length}` } }]
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

  const statCards: Blocks = {
    'stat-tasks': { label: 'Текущие задания', node: <div className="stat-card"><div className="stat-label">{uiText("Текущие задания")}</div><div className="stat-value"><CountUp value={taskQuests.length} /></div></div> },
    'stat-progress': { label: 'Прогресс', node: <div className="stat-card"><div className="stat-label">{uiText("Прогресс")}</div><div className="stat-value"><CountUp value={stats.completed} /></div></div> },
    'stat-kappa': { label: 'Задания для Капы', node: <KappaStatCard completed={kappaDone} total={kappaRows.length} open={kappaOpen} onOpen={openKappa} controlsId={kappaListId} /> },
    'stat-goons': { label: 'Кочевники', node: <GoonCard mode={state.raidMode} mapName={mapName} /> },
  }
  const leftBlocks: Blocks = {
    // The big raid map moves like the other blocks (owner, 12.10.2026), within its wide column.
    raid: {
      label: 'План рейда',
      node: <section ref={raidCardRef} className={`panel raid-card${mapPickerOpen ? ' is-picking' : ''}`}>
        <div className="raid-card-art" style={{ backgroundImage: `url(${selectedMap.imageUrl})` }} />
        <RaidSmoke mapId={selectedMap.id} />
        <BossFigures mapId={selectedMap.id} />
        <div className="raid-content">
          <div className="raid-main">
            <span className="tag brass">{uiText("ПЛАН РЕЙДА · ")}{uiText(state.raidMode.toUpperCase())}</span>
            <h2 className="raid-map-name">{uiText(selectedMap.name)}</h2>
            <div className="raid-facts"><span><Clock3 size={13} /> {uiText(selectedMap.raidTime)}{uiText(" мин")}</span><span><Users size={13} /> {uiText(selectedMap.players)}{uiText(" игроков")}</span></div>

          </div>
          <MapPicker open={mapPickerOpen} maps={data.maps} firstMapId={selectedMap.id}
            lockedOf={(map) => { const access = calculateMapAccess(map, data.quests, availability); return { locked: access.locked, title: access.quest?.name } }}
            onPick={(id) => { state.setSelectedMapId(id); setMapPickerOpen(false) }} />
            <div className="raid-actions">{featureEnabled('raidRoute') && <button className="button primary" onClick={openMap}><Route size={16} />{uiText(" Построить маршрут")}</button>}<button className="button" onClick={() => setMapPickerOpen((value) => !value)}><MapIcon size={16} />{uiText(" Выбрать карту")}</button><button className="button" onClick={() => navigate(`/maps/${selectedMap.id}`)}><MapPinned size={16} />{uiText(" Карта")}</button></div>
        </div>
      </section>,
    },
    squad: { label: 'Отряд', node: <SquadRaidCard mode={state.raidMode} data={data} selectedMapId={selectedMap.id} onPickMap={(id) => state.setSelectedMapId(id)} /> },
    requirements: { label: 'Требования рейда', node: <RaidRequirementsPanel rows={neededRows} /> },
  }
  const rightBlocks: Blocks = {
    tasks: { label: 'Список текущих заданий', node: <CurrentTasksPanel map={selectedMap} quests={mapQuests} anyMapQuests={anyMapCurrent} questLink={questOnMap} /> },
    gunsmith: { label: 'Оружейник', node: <GunsmithPanel steps={gunsmith} playerLevel={progress.playerLevel} /> },
    favorites: {
      label: 'Рынок · избранное',
      node: <section className="panel market-favorites">
        <div className="panel-header"><div className="panel-title">{uiText("Рынок · избранное")}</div><Link to="/flea" className="dim">{uiText("Подробнее ")}<ChevronRight size={13} /></Link></div>
        <div className="panel-body">
          {uiText(favorites.map((item) => {
            if (!item) return null
            // The flea price of THIS mode (current lowest offer), else the best trader: not the highest of all quotes.
            const price = displayPrice(item, state.raidMode)
            return <div className="item-row" key={item.id}><img className="item-thumb" src={item.iconUrl} alt={uiText("")} /><span><strong>{uiText(item.shortName)}</strong><small className="dim">{uiText(favoritePriceLabel(price))}</small></span><strong className="mono price-up">{uiText(price ? formatPrice(price.price) : '—')}</strong></div>
          }))}
        </div>
      </section>,
    },
  }
  const block = (zone: 'stats' | 'rows' | 'left' | 'right', blocks: Blocks) => (id: string) =>
    <OverviewBlock key={id} editor={editor} zone={zone} id={id} label={blocks[id]?.label ?? id}>{blocks[id]?.node}</OverviewBlock>
  const rows: Blocks = {
    stats: { label: 'Карточки', node: <section className="stat-grid">{layout.stats.map(block('stats', statCards))}</section> },
    // A map here chooses the raid plan's map below, it does not open the map (owner, 10.10.2026).
    priority: { label: 'Приоритет карт', node: <MapPriority maps={data.maps} countFor={(id) => taskQuests.filter((quest) => onMap(quest, id)).length} onOpen={(id) => { state.setSelectedMapId(id); setMapPickerOpen(false); raidCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }} /> },
    columns: {
      label: '',
      node: <div className="dashboard-layout">
        <div className="dashboard-column">{layout.left.map(block('left', leftBlocks))}</div>
        <div className="dashboard-column">{layout.right.map(block('right', rightBlocks))}</div>
      </div>,
    },
  }

  return <div className={`page${editor.editing ? ' overview-editing' : ''}`}>
    <header className="page-header">
      <div><div className="eyebrow">{uiText("Оперативный штаб · ")}{uiText(new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long' }))} · {uiText(state.raidMode.toUpperCase())}</div><h1 className="page-title">{uiText("Следующий рейд начинается здесь")}</h1></div>
      <div className="overview-header-actions">
        <div className="overview-layout-actions">
          {editor.editing && <button type="button" className="button small ghost" onClick={editor.reset} disabled={editor.isDefault}><RotateCcw size={14} />{uiText(' Сбросить')}</button>}
          <button type="button" className={`button small ${editor.editing ? 'primary' : 'ghost'}`} aria-pressed={editor.editing} onClick={editor.toggleEditing}>{editor.editing ? <Check size={14} /> : <LayoutDashboard size={14} />}{uiText(editor.editing ? ' Готово' : ' Настроить блоки')}</button>
        </div>
        <button className="button primary" onClick={openMap}><MapIcon size={16} />{uiText(" Открыть карту")}</button>
      </div>
    </header>
    {editor.editing && <p className="overview-edit-hint" role="status">{uiText('Перетащите блок мышью — остальные плавно подвинутся. Блок встаёт только туда, где сохраняет свою форму. Esc — готово.')}</p>}

    <div className="overview-rows">{layout.rows.map(block('rows', rows))}</div>
    <KappaBreakdownPanel id={kappaListId} open={kappaOpen} rows={kappaRows} completed={kappaDone} total={kappaRows.length} onClose={() => setKappaOpen(false)} />
  </div>
}
