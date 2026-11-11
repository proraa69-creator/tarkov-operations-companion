import { uiText, uiLabel } from '../i18n/renderText'
import { featureEnabled } from '../app/archivedFeatures'
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Clock3, LayoutDashboard, Map as MapIcon, MapPinned, RotateCcw, Route, Users, X } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { useOwnedKeys } from '../quests/ownedKeys'
import { formatPrice } from '../shared/format'
import { displayPrice, favoritePriceLabel } from '../domain/itemPrices'
import { currentStoryStageIndex, isCurrentTrackedQuest, isStoryQuest, isLiveGameQuest } from '../progression/requirementEngine'
import { questAvailabilityOf } from '../quests/questReadModel'
import { questAppliesToMap } from '../progression/questLocation'
import { mapObjectivesDone, markerObjectiveDone } from '../progression/mapObjectives'
import { keyUsed, objectiveDone, objectiveItemsLeft, requirementObjectiveIds } from '../raidprep/objectives'
import { aggregateRaidNeeds, ammoPackGroupLabel, groupAlternatives } from '../shared/raidNeeds'
import { storyStageRaidNeeds } from '../progression/storyRaidNeeds'
import { deferralTermText, questRaidItems, useDeferredQuests } from '../progression/deferredQuests'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { gearObjectives } from '../overview/questConditions'
import { DeferItemMenu, QuestDeferDialog, type DeferMenuState, type DeferRequest } from '../components/QuestDeferDialog'
import { FavoriteQuestLine, useFavoriteActions } from '../components/FavoriteQuests'
import { sortQuestsChronologically } from '../progression/questChronology'
import { MapPicker } from '../components/MapPicker'
import { GoonCard } from '../components/GoonCard'
import { MapPriority } from '../components/MapPriority'
import { SquadRaidCard } from '../squad/RaidPlanner'
import { BossFigures } from '../components/BossFigures'
import { RaidSmoke } from '../components/RaidSmoke'
import { useLocale } from '../i18n/LocaleProvider'
import { CurrentTasksPanel } from '../components/CurrentTasksPanel'
import { QuestInlineCard } from '../components/QuestInlineCard'
import { RaidRequirementsPanel, type RaidNeedRow } from '../components/RaidRequirementsPanel'
import { KappaBreakdownPanel, KappaStatCard } from '../components/KappaProgress'
import { collectorKeyTasks } from '../components/collectorKeyTasks'
import { GunsmithPanel } from '../gunsmith/GunsmithPanel'
import { gunsmithSteps, isGunsmithQuest } from '../gunsmith/gunsmith'
import { CountUp } from '../components/CountUp'
import { QuestConditionsCard } from '../overview/QuestConditionsCard'
import { conditionQuestsForMap } from '../overview/questConditions'
import { OverviewBlock } from '../overview/OverviewBlock'
import { useCurrentTasksView } from '../overview/currentTasksView'
import { useOverviewEditor } from '../overview/useOverviewEditor'
import { PhoneOverviewBlock } from '../overview/PhoneOverviewBlock'
import { BlockChooser, type BlockChoice } from '../overview/BlockChooser'
import { PHONE_BLOCKS } from '../overview/phoneLayout'
import { ScreenStatCard } from '../screen/ScreenStatCard'
import { usePhoneOverview } from '../overview/usePhoneOverview'
import { useOverviewDefaults } from '../overview/overviewDefaultsStore'
import { ownBlockTitle } from '../overview/overviewDefaults'
import { BlockTitleProvider } from '../overview/blockTitle'
import { useMobileLayout } from '../platform'
import { PositionSetupNotice } from '../overlay/PositionSetupCard'
import { ScourgeEventButton } from '../events/ScourgeEventButton'
import { HalloweenEventButton } from '../events/HalloweenEventButton'
import { PromoCodesButton } from '../promo/PromoCodesButton'
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
  const tasksView = useCurrentTasksView()
  // The phone: one column where every block moves up or down (overview/phoneLayout.ts).
  const mobile = useMobileLayout()
  const phone = usePhoneOverview()
  const layoutEditor = mobile ? phone : editor
  // «Админ панель» → «Блоки»: the owner's own headings (RU / EN) for every player; hidden blocks are not in the layouts.
  const defaults = useOverviewDefaults()
  const ownTitle = (id: string) => ownBlockTitle(defaults, id, locale)
  const selectedMap = data.maps.find((map) => map.id === state.selectedMapId) ?? data.maps[0]
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => questAvailabilityOf(data.quests, progress), [data.quests, progress])
  const currentQuests = data.quests.filter((quest) => isLiveGameQuest(quest) && isCurrentTrackedQuest(quest, progress))
  // «Оружейник» parts go to their own block below «Текущие задания», not into the task lists (owner, 10.10.2026).
  const taskQuests = currentQuests.filter((quest) => !isGunsmithQuest(quest))
  const gunsmith = useMemo(() => gunsmithSteps(data.quests, (id) => availability.get(id)?.status), [availability, data.quests])
  const onMap = (quest: typeof currentQuests[number], id: string) => {
    const stageIndex = currentStoryStageIndex(quest, progress)
    return questAppliesToMap(quest, id, stageIndex) && !quest.anyMap
  }
  // A quest whose objectives on this map are all ticked leaves its list here; it stays current for its other maps.
  const planQuests = taskQuests.filter((quest) => onMap(quest, selectedMap.id) && !mapObjectivesDone(quest, selectedMap.id, progress))
  const anyMapCurrent = taskQuests.filter((quest) => quest.anyMap)
  // Earliest tasks first, so the three rows of the collapsed list are the ones the game handed out first.
  const mapQuests = sortQuestsChronologically(planQuests, data.quests)
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  // A current task opens on the map of this raid plan, focused on its point (a story chapter on its current stage);
  // `objectiveId`: on the point of that objective.
  const questOnMap = (quest: typeof currentQuests[number], objectiveId?: string) => {
    const stage = isStoryQuest(quest) ? `&stage=${currentStoryStageIndex(quest, progress)}` : ''
    const objective = objectiveId ? `&objective=${encodeURIComponent(objectiveId)}` : ''
    return `/maps/${selectedMap.id}?quest=${encodeURIComponent(quest.id)}${stage}${objective}`
  }
  const questPointsHere = useMemo(() => data.markers.filter((marker) => marker.mapId === selectedMap.id && marker.questId), [data.markers, selectedMap.id])
  // The quest's own points on this raid's map (current stage, objective not ticked done); approximate «somewhere on the
  // map» entries do not count.
  const ownPoints = (quest: typeof currentQuests[number]) => {
    const stage = currentStoryStageIndex(quest, progress)
    return questPointsHere.filter((marker) => marker.questId === quest.id
      && marker.source !== 'quest-fallback' && marker.source !== 'quest-any-map' && marker.source !== 'quest-info'
      && (marker.stageIndex == null || marker.stageIndex === stage) && !markerObjectiveDone(marker, progress))
  }
  // Only the keys, the items to plant or mark (owner, 15.10.2026: the weapons and gear of the quests are in «Сбор на рейд») and what
  // an objective or its exit has the player fire or use (owner, 06.11.2026: a flare).
  const raidPrepPurposes = new Set(['place', 'mark', 'key', 'signal', 'use'])
  // What is planted or marked stays so in the game, so an objective ticked on the map takes its items off, after the raid
  // too (owner, 04.11.2026: «нужно что бы в требованиях писалось актуальное количество»; «это касается не только маркеров,
  // но и всех предметов если их несколько»). A key goes once every objective it opens is ticked (owner, 06.11.2026), and its row
  // opens on the next of them.
  const raidPrep = (quest: typeof currentQuests[number]) => (quest.raidRequirements ?? [])
    .filter((requirement) => raidPrepPurposes.has(requirement.purpose) && (!requirement.mapIds.length || requirement.mapIds.includes(selectedMap.id)))
    .flatMap((requirement) => {
      // an item the owner tied to a point in the quest constructor goes with that point's objective
      const objectiveId = requirement.objectiveId ?? questPointsHere.find((marker) => marker.id === requirement.curated?.pointId)?.objectiveId
      if (requirement.purpose === 'key') {
        const opens = { objectiveId, objectiveIds: requirement.objectiveIds }
        if (keyUsed(progress, quest.id, opens)) return []
        const next = requirementObjectiveIds(opens).find((id) => !objectiveDone(progress, quest.id, id))
        return [next ? { ...requirement, objectiveId: next } : requirement]
      }
      const count = objectiveItemsLeft(progress, quest.id, objectiveId, requirement.count)
      return count > 0 ? [{ ...requirement, count }] : []
    })
  // A quest put aside in «Отложенные квесты» (progression/deferredQuests.ts; this profile and mode) brings nothing here
  // until it is returned or its term comes (bug report №30: «Если я отложил тот или иной квест … он все равно требует Wifi
  // камеры на рейд»).
  const traderLoyalty = useTraderLoyalty()
  const deferred = useDeferredQuests(state.activeProfile.id, state.raidMode, progress.playerLevel, traderLoyalty)
  const raidQuests = [...planQuests, ...anyMapCurrent]
  // The current stage of each story chapter in progress (owner, 06.11.2026): its keys, what it plants or uses, where it applies.
  const storyRaid = data.quests.filter((quest) => quest.kind === 'story' && isCurrentTrackedQuest(quest, progress) && !deferred.has(quest.id))
    .map((quest) => ({ quest, ...storyStageRaidNeeds(quest, currentStoryStageIndex(quest, progress), itemById, locale === 'en' ? 'en' : 'ru') }))
  const storyItems = new Map(storyRaid.flatMap(({ items }) => items.map((item) => [item.id, item] as const)))
  const raidItem = (id: string) => itemById.get(id) ?? storyItems.get(id)
  const requirements = [
    ...raidQuests.filter((quest) => !deferred.has(quest.id)).flatMap((quest) => raidPrep(quest).map((requirement) => ({ ...requirement, questName: quest.name, questId: quest.id, quest }))),
    ...storyRaid.flatMap(({ quest, requirements: needs }) => needs.filter((need) => !need.mapIds.length || need.mapIds.includes(selectedMap.id)).map((requirement) => ({ ...requirement, questName: quest.name, questId: quest.id, quest }))),
  ]
  // Named under the list with their term, so an item that left with its quest is no surprise.
  const deferredHere = raidQuests.filter((quest) => deferred.has(quest.id) && raidPrep(quest).length > 0)
    .map((quest) => ({ name: quest.name, term: deferralTermText(deferred.get(quest.id), locale) }))
  // A right click on an item of «Требования рейда» or on the gear of «Сбор на рейд»: «Отложить квест», then its window.
  const [deferMenu, setDeferMenu] = useState<DeferMenuState | null>(null)
  const closeDeferMenu = useCallback(() => setDeferMenu(null), [setDeferMenu])
  const [deferRequest, setDeferRequest] = useState<DeferRequest | null>(null)
  const closeDeferRequest = useCallback(() => setDeferRequest(null), [setDeferRequest])
  // «Текущие задания» without the quests put aside; the right click on a row puts its quest aside, «До уровня» telling
  // where its first key or item opens, else its weapon.
  const listedQuests = mapQuests.filter((quest) => !deferred.has(quest.id))
  const listedAnyMap = anyMapCurrent.filter((quest) => !deferred.has(quest.id))
  const deferredTasks = mapQuests.length + anyMapCurrent.length - listedQuests.length - listedAnyMap.length
  const deferTask = (quest: typeof currentQuests[number], at: { x: number; y: number }) => {
    const item = questRaidItems(quest, itemById, progress)[0] ?? itemById.get(gearObjectives(quest)[0]?.conditions?.weapons?.[0]?.id ?? '')
    setDeferMenu({ ...at, title: quest.name, request: { item: item ? { id: item.id, name: item.name, iconUrl: item.iconUrl } : undefined, quests: [{ id: quest.id, name: quest.name }] } })
  }
  // «Любая пачка патронов 7.62x51» instead of every pack an objective accepts.
  const grouped = groupAlternatives(requirements, raidItem)
  // A row opens its quest on this map at the point of its objective (owner, 03.11.2026: «при нажатии на предмет в
  // требованиях рейда, открываться должен квест на карте. в то место где нужно заложить предмет»), and so does the line of
  // each quest under it: per quest, a point of that objective here first, then any point of the quest here; planting or
  // marking before a key. The row takes the best of its quests.
  const targetsOf = (itemId: string) => {
    const targets = new Map<string, { href: string; rank: number }>()
    for (const requirement of grouped.requirements) {
      if (requirement.itemId !== itemId) continue
      const points = ownPoints(requirement.quest)
      // the point the owner tied the requirement to in the quest constructor, else a point of its objective
      const objectiveId = points.find((marker) => marker.id === requirement.curated?.pointId && marker.objectiveId)?.objectiveId
        ?? (requirement.objectiveId && points.some((marker) => marker.objectiveId === requirement.objectiveId) ? requirement.objectiveId : undefined)
      const rank = (objectiveId ? 0 : points.length ? 2 : 4) + (requirement.purpose === 'key' ? 1 : 0)
      const known = targets.get(requirement.quest.id)
      if (!known || rank < known.rank) targets.set(requirement.quest.id, { href: questOnMap(requirement.quest, objectiveId), rank })
    }
    return targets
  }
  // The keys the player has (owner, 07.11.2026: «если он у меня есть… пишется «Есть в схроне». Если нету, то пишется «Нет в наличии»»);
  // nothing said before the first scan or key added by hand, so a player who never scanned is not told every key is missing.
  const ownedKeys = useOwnedKeys(state.activeProfile.id, state.raidMode)
  const keyStock = (row: { lines: Array<{ purpose: string }> }, ids: readonly string[]): RaidNeedRow['stock'] => (
    ownedKeys.size && row.lines.some((line) => line.purpose === 'key') ? (ids.some((id) => ownedKeys.has(id)) ? 'owned' : 'missing') : undefined)
  const neededRows: RaidNeedRow[] = aggregateRaidNeeds(grouped.requirements, state.raidItemIds, (itemId) => raidItem(itemId)?.keyUses).flatMap((row): RaidNeedRow[] => {
    const targets = targetsOf(row.itemId)
    const best = [...targets.values()].sort((a, b) => a.rank - b.rank)[0]
    // An item added from the flea market by hand (no quest) opens on the flea market.
    const link = (fleaId: string) => best?.href ?? `/flea?selected=${fleaId}`
    // Each quest's count under the total, opening that quest (bug report №30: «показывал что нужно допустим 4 камеры на
    // 1 квест, и 3 камеры на 2 квест, а то он все эти камеры миксует в одно»).
    const lines = row.lines.map((line) => ({ ...line, quests: line.quests.map((quest) => ({ ...quest, href: targets.get(quest.id)?.href })) }))
    const group = grouped.groups.get(row.itemId)
    if (group) {
      const options = group.itemIds.flatMap((id) => raidItem(id) ?? [])
      // The row opens on the cheapest accepted item: any of them will do; a key the player already has comes first.
      const cheapest = [...options].sort((a, b) => Number(ownedKeys.has(b.id)) - Number(ownedKeys.has(a.id)) || (a.fleaPrice || Infinity) - (b.fleaPrice || Infinity))[0]
      if (!cheapest) return []
      const card = (items: typeof options) => items.map((item) => ({ id: item.id, name: item.name, iconUrl: item.iconUrl }))
      // «Любая пачка патронов 7.62x51»: every pack in the card. Anything else: one item in the list, the others in the card.
      if (group.kind === 'ammo-pack' && group.caliber) {
        return [{ ...row, lines, key: row.itemId, itemId: cheapest.id, name: ammoPackGroupLabel(group.caliber, locale), iconUrl: cheapest.iconUrl, href: link(cheapest.id), alternatives: { title: 'Подходит любая', items: card(options) } }]
      }
      const others = options.filter((item) => item.id !== cheapest.id)
      // Either key opens the door (report №90: «ключ 219 или ключ 220», «что бы не брать с собой сразу два ключа»): one key, «+1»,
      // the other in the hover card, the picture turning between them (owner, 07.11.2026: «каждые 3 секунды менялась картинка»).
      const keys = row.lines.every((line) => line.purpose === 'key')
      const title = keys ? (others.length > 1 ? 'Можно и этими ключами' : 'Можно и этим ключом') : 'Подходит и'
      return [{ ...row, lines, key: row.itemId, itemId: cheapest.id, name: cheapest.name, iconUrl: cheapest.iconUrl, href: link(cheapest.id), alternatives: { title, items: card(others), badge: `+${others.length}`, ...(keys ? { turn: true } : {}) }, stock: keyStock(row, group.itemIds) }]
    }
    const item = raidItem(row.itemId)
    return item ? [{ ...row, lines, key: item.id, itemId: item.id, name: item.name, iconUrl: item.iconUrl, href: link(item.id), stock: keyStock(row, [item.id]) }] : []
  })
  const favorites = state.favoriteItemIds.map((id) => data.items.find((item) => item.id === id)).filter(Boolean)
  const favoriteActions = useFavoriteActions()
  // «Условия квестов» (owner, 15.10.2026) in the place of «Прогресс»: the quests of this map with a weapon or gear condition;
  // a quest put aside leaves it too (owner, 03.11.2026: «И со снаряжением для квестов тоже самое»).
  const mapConditions = useMemo(() => conditionQuestsForMap(data.quests, availability, selectedMap.id), [availability, data.quests, selectedMap.id])
  const conditionQuests = useMemo(() => {
    const quests = mapConditions.quests.filter((entry) => !deferred.has(entry.quest.id))
    return quests.length === mapConditions.quests.length ? mapConditions : { tier: quests.length ? 'active' as const : 'none' as const, quests }
  }, [deferred, mapConditions])
  // «Задания для Капы»: the four key tasks Fence wants for «Коллекционер» (an alternative closes its step).
  const kappaRows = useMemo(() => collectorKeyTasks(data.quests, availability), [data.quests, availability])
  const kappaDone = kappaRows.filter((row) => row.state === 'completed').length
  const openKappa = () => setKappaOpen(true)
  const mapName = (id: string) => data.maps.find((map) => map.id === id)?.name ?? id

  const openMap = () => navigate(`/maps/${selectedMap.id}?quests=${state.trackedQuestIds.join(',')}`)

  // «Геопозиция» in the phone's quest card: only a quest with a point of its own on this raid's map.
  const pointLink = (quest: typeof currentQuests[number]) => (ownPoints(quest).length ? questOnMap(quest) : undefined)
  const questCard = mobile ? (quest: typeof currentQuests[number]) => <QuestInlineCard quest={quest} progress={progress} maps={data.maps} pointLink={pointLink(quest)} /> : undefined

  // A map here chooses the raid plan's map, it does not open the map (owner, 10.10.2026).
  const priorityStrip = <MapPriority inline maps={data.maps} countFor={(id) => taskQuests.filter((quest) => onMap(quest, id) && !mapObjectivesDone(quest, id, progress)).length} onOpen={(id) => { state.setSelectedMapId(id); setMapPickerOpen(false) }} />
  const statCards: Blocks = {
    // «Экран» in the place of «Текущие задания» (owner, 11.11.2026); the tasks' count stands in the map's block now.
    'stat-screen': { label: 'Экран', node: <ScreenStatCard /> },
    'stat-conditions': { label: 'Сбор на рейд', node: <QuestConditionsCard result={conditionQuests} map={selectedMap} mapName={mapName} items={data.items} pickKey={`${state.raidMode}:${selectedMap.id}`}
      deferredCount={mapConditions.quests.length - conditionQuests.quests.length} onDefer={setDeferMenu} /> },
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
          {/* Owner, 11.11.2026: «слева наверху будет писаться текущие задания, количество, и сразу справа… колонка, которая листается,
              влево-вправо, с приоритетом карт»; «Сверху… план рейда сезон, это убери» — no «ПЛАН РЕЙДА · PVP» line any more. */}
          <div className="raid-top">
            <div className="raid-tasks"><span>{uiText('Текущие задания')}</span><strong><CountUp value={taskQuests.length} /></strong></div>
            {priorityStrip}
          </div>
          <div className="raid-main">
            <h2 className="raid-map-name">{uiText(selectedMap.name)}</h2>
            <div className="raid-facts"><span><Clock3 size={13} /> {uiText(selectedMap.raidTime)}{uiText(" мин")}</span><span><Users size={13} /> {uiText(selectedMap.players)}{uiText(" игроков")}</span></div>

          </div>
          <MapPicker open={mapPickerOpen} maps={data.maps} firstMapId={selectedMap.id}
            onPick={(id) => { state.setSelectedMapId(id); setMapPickerOpen(false) }} />
            <div className="raid-actions">{featureEnabled('raidRoute') && <button className="button primary" onClick={openMap}><Route size={16} />{uiText(" Построить маршрут")}</button>}<button className="button" onClick={() => setMapPickerOpen((value) => !value)}><MapIcon size={16} />{uiText(" Выбрать карту")}</button><button className="button" onClick={() => navigate(`/maps/${selectedMap.id}`)}><MapPinned size={16} />{uiText(" Карта")}</button></div>
        </div>
      </section>,
    },
    squad: { label: 'Отряд', node: <SquadRaidCard mode={state.raidMode} data={data} selectedMapId={selectedMap.id} onPickMap={(id) => state.setSelectedMapId(id)} /> },
    requirements: { label: 'Требования рейда', node: <RaidRequirementsPanel rows={neededRows} deferredQuests={deferredHere} onDefer={setDeferMenu} compactRows={mobile ? 2 : undefined} /> },
  }
  const rightBlocks: Blocks = {
    tasks: { label: 'Список текущих заданий', node: <CurrentTasksPanel map={selectedMap} quests={listedQuests} anyMapQuests={listedAnyMap} questLink={questOnMap} details={questCard} compactRows={mobile ? 4 : undefined}
      onDefer={deferTask} deferredCount={deferredTasks} scrollable={!mobile && tasksView === 'scroll'} layoutKey={`${layoutEditor.editing}|${layout.left.join()}|${layout.right.join()}`} /> },
    gunsmith: { label: 'Оружейник', node: <GunsmithPanel steps={gunsmith} playerLevel={progress.playerLevel} /> },
    favorites: {
      label: 'Рынок · избранное',
      node: <section className="panel market-favorites">
        <div className="panel-header"><div className="panel-title">{ownTitle('favorites') ?? uiText("Рынок · избранное")}</div><Link to="/flea" className="dim">{uiText("Подробнее ")}<ChevronRight size={13} /></Link></div>
        <div className="panel-body">
          {uiText(favorites.map((item) => {
            if (!item) return null
            // The flea price of THIS mode (current lowest offer), else the best trader: not the highest of all quotes.
            const price = displayPrice(item, state.raidMode)
            return <div className="item-row" key={item.id} onContextMenu={(event) => favoriteActions.open(item, event)}><img className="item-thumb" src={item.iconUrl} alt={uiText("")} /><span><strong>{uiText(item.shortName)}</strong><small className="dim">{uiText(favoritePriceLabel(price))}</small><FavoriteQuestLine rows={favoriteActions.questsOf(item.id)} onOpen={(event) => favoriteActions.open(item, event)} /></span><span className="market-favorite-side"><strong className="mono price-up">{uiText(price ? formatPrice(price.price) : '—')}</strong><button type="button" className="icon-button market-favorite-remove" title={uiText('Убрать из избранного')} aria-label={uiText('Убрать из избранного')} onClick={() => state.toggleFavoriteItem(item.id)}><X size={13} aria-hidden="true" /></button></span></div>
          }))}
        </div>
      </section>,
    },
  }
  const labelOf = (id: string, blocks: Blocks) => ownTitle(id) ?? blocks[id]?.label ?? id
  const titled = (id: string, node: ReactNode) => <BlockTitleProvider title={defaults?.titles[id]}>{node}</BlockTitleProvider>
  const block = (zone: 'stats' | 'rows' | 'left' | 'right', blocks: Blocks) => (id: string) =>
    <OverviewBlock key={id} editor={editor} zone={zone} id={id} label={labelOf(id, blocks)}>{titled(id, blocks[id]?.node)}</OverviewBlock>
  const rows: Blocks = {
    stats: { label: 'Карточки', node: <section className="stat-grid">{layout.stats.map(block('stats', statCards))}</section> },
    columns: {
      label: '',
      node: <div className="dashboard-layout">
        <div className="dashboard-column">{layout.left.map(block('left', leftBlocks))}</div>
        <div className="dashboard-column">{layout.right.map(block('right', rightBlocks))}</div>
      </div>,
    },
  }

  const phoneBlocks: Blocks = { ...statCards, ...leftBlocks, ...rightBlocks }
  const order = phone.layout.order
  // «Заменить блок» (owner, 11.11.2026): the phone offers every block (one off the screen comes back), the PC the cards of the top row.
  const phoneChoices = (here: string): BlockChoice[] => PHONE_BLOCKS.filter((id) => phoneBlocks[id]).map((id) => ({ id, label: labelOf(id, phoneBlocks), state: id === here ? 'here' : order.includes(id) ? 'shown' : 'hidden' }))
  const pcChoosing = editor.choosing
  const pcChoices = (here: string): BlockChoice[] => layout.stats.map((id) => ({ id, label: labelOf(id, statCards), state: id === here ? 'here' : 'shown' }))
  return <div className={`page${layoutEditor.editing ? ' overview-editing' : ''}${mobile ? ' overview-phone' : ''}`}>
    <header className="page-header">
      <div><div className="eyebrow">{uiText("Оперативный штаб · ")}{uiText(new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long' }))} · {uiText(state.raidMode.toUpperCase())}</div><div className="overview-title-row"><h1 className="page-title">{uiText("Следующий рейд начинается здесь")}</h1>{!layoutEditor.editing && <><ScourgeEventButton /><HalloweenEventButton /></>}</div></div>
      <div className="overview-header-actions">
        <div className="overview-layout-actions">
          {layoutEditor.editing && <button type="button" className="button" onClick={layoutEditor.reset} disabled={layoutEditor.isDefault}><RotateCcw size={16} />{uiText(' Сбросить')}</button>}
          {/* «Настроить блоки» and «Открыть карту» look the same (owner, 28.10.2026: «вид кнопки должен быть одинаковый»). */}
          <button type="button" className={`button overview-blocks-button${layoutEditor.editing ? ' primary' : ''}`} aria-pressed={layoutEditor.editing} aria-label={uiLabel(layoutEditor.editing ? 'Готово' : 'Настроить блоки')} title={uiLabel(layoutEditor.editing ? 'Готово' : 'Настроить блоки')} onClick={layoutEditor.toggleEditing}>{layoutEditor.editing ? <Check size={16} /> : <LayoutDashboard size={16} />}</button>
        </div>
        <PromoCodesButton />
        <button type="button" className="button" onClick={openMap}><MapIcon size={16} />{uiText(" Открыть карту")}</button>
      </div>
    </header>
    {!mobile && <PositionSetupNotice />}
    {layoutEditor.editing && <p className="overview-edit-hint" role="status">{uiText(mobile
      ? 'Удерживайте блок пальцем и перенесите на место другого — они поменяются местами. Шестерёнка — заменить блок.'
      : 'Перетащите блок мышью — остальные плавно подвинутся. Блок встаёт только туда, где сохраняет свою форму. Esc — готово.')}</p>}

    {mobile
      ? <div className="overview-phone-grid">{order.map((id, index) => phoneBlocks[id] && <PhoneOverviewBlock key={id} overview={phone} id={id} label={labelOf(id, phoneBlocks)} index={index} count={order.length}>{titled(id, phoneBlocks[id].node)}</PhoneOverviewBlock>)}</div>
      : <div className="overview-rows">{layout.rows.filter((id) => id !== 'stats' || layout.stats.length > 0).map(block('rows', rows))}</div>}
    {mobile && phone.choosing && <BlockChooser title={labelOf(phone.choosing, phoneBlocks)} choices={phoneChoices(phone.choosing)} onPick={(id) => phone.replace(phone.choosing!, id)} onClose={() => phone.setChoosing(null)} />}
    {!mobile && pcChoosing && <BlockChooser title={labelOf(pcChoosing.id, statCards)} choices={pcChoices(pcChoosing.id)} onPick={(id) => editor.replace(pcChoosing.zone, pcChoosing.id, id)} onClose={() => editor.setChoosing(null)} />}
    <KappaBreakdownPanel id={kappaListId} open={kappaOpen} rows={kappaRows} completed={kappaDone} total={kappaRows.length} onClose={() => setKappaOpen(false)} />
    <DeferItemMenu menu={deferMenu} onOpen={setDeferRequest} onClose={closeDeferMenu} />
    {favoriteActions.menu}
    {deferRequest && <QuestDeferDialog request={deferRequest} onClose={closeDeferRequest} />}
  </div>
}
