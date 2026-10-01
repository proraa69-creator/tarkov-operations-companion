import { uiText } from '../../i18n/renderText'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Backpack, ClipboardList, KeyRound, ListChecks, MapPin, Route, Search } from 'lucide-react'
import { useTarkovData } from '../../data/DataProvider'
import { useAppState } from '../../state/AppState'
import { buildRaidBriefing, type BriefingItem, type BriefingObjective } from '../../raidprep/briefing'
import { objectiveTypeLabel } from '../../raidprep/objectives'
import { mainFloor } from '../../data/mapProjection'
import { stepNumber, type RoutePlan } from '../../raidprep/route'
import { isStoryQuest } from '../../progression/requirementEngine'
import '../../styles/raidPrep.css'

interface Props {
  mapId: string
  /** Route of the Maps page, listed as ①→②→… when given. */
  route?: RoutePlan | null
  /** Narrow side-panel layout (Maps page). */
  compact?: boolean
  /** The map comes from the game logs (current raid). */
  fromRaid?: boolean
}

/** «Брифинг рейда»: current quests of the map by trader, what to do there, what to find, bring and which keys. */
export function RaidBriefingPanel({ mapId, route, compact, fromRaid }: Props) {
  const { data } = useTarkovData()
  const state = useAppState()
  const progress = state.activeProfile.modes[state.raidMode]
  const briefing = useMemo(
    () => buildRaidBriefing({ mapId, quests: data.quests, items: data.items, markers: data.markers, progress }),
    [mapId, data.quests, data.items, data.markers, progress],
  )
  const map = data.maps.find((entry) => entry.id === mapId)
  const questName = (questId?: string) => data.quests.find((quest) => quest.id === questId)?.name
  const baseFloor = map ? mainFloor(map) : undefined

  return (
    <section className={`raid-briefing${compact ? ' is-compact' : ' panel'}`} aria-label={uiText('Брифинг рейда')}>
      <header className="raid-briefing-head">
        <ClipboardList size={15} />
        <div>
          <div className="raid-briefing-title">{uiText('Брифинг рейда')}{map && !compact ? <> · {uiText(map.name)}</> : null}</div>
          <small className="dim">{fromRaid ? uiText('Карта текущего рейда — по журналам игры') : <>{uiText('Текущие задания')}: {briefing.questCount}</>}</small>
        </div>
      </header>

      {briefing.questCount === 0 ? (
        <p className="muted raid-briefing-empty">{uiText('На этой карте нет текущих заданий. Примите задание в игре — оно появится здесь по журналам.')}</p>
      ) : (
        <div className="raid-briefing-body">
          {briefing.groups.map((group) => (
            <div className="raid-briefing-trader" key={group.trader}>
              <div className="raid-briefing-trader-name">{uiText(group.trader)}</div>
              {group.quests.map(({ quest, points, checklist, anyMap }) => (
                <div className="raid-briefing-quest" key={quest.id}>
                  <Link to={`/maps/${mapId}?quest=${encodeURIComponent(quest.id)}`} className="raid-briefing-quest-name">
                    {uiText(quest.name)}
                    {anyMap && <span className="tag">{uiText('Любая карта')}</span>}
                    {quest.kappa && !isStoryQuest(quest) && <span className="tag brass">{uiText('капа')}</span>}
                  </Link>
                  <ul>
                    {points.slice(0, compact ? 4 : 8).map((objective) => <ObjectiveLine key={objective.id} objective={objective} point />)}
                    {checklist.slice(0, compact ? 3 : 8).map((objective) => <ObjectiveLine key={objective.id} objective={objective} />)}
                  </ul>
                </div>
              ))}
            </div>
          ))}

          <ItemSection icon={<Search size={13} />} title="Найти на этой карте" rows={briefing.find} />
          <ItemSection icon={<Backpack size={13} />} title="Взять с собой" rows={briefing.bring} />
          <ItemSection icon={<KeyRound size={13} />} title="Ключи" rows={briefing.keys} />

          {route && (
            <div className="raid-briefing-section">
              <h4><Route size={13} />{uiText('Маршрут')}</h4>
              <p className="raid-briefing-note">
                {route.startIsCustom
                  ? uiText('Старт выбран вами на карте.')
                  : <>{uiText('Старт: ')}{uiText(route.startExtract ?? 'первая точка')}. {uiText('Приложение не знает, где вы появились, — укажите старт на карте.')}</>}
              </p>
              {route.steps.length ? (
                <>
                  <p className="raid-route-chain">{route.steps.map((_, index) => stepNumber(index)).join(' → ')}</p>
                  <ol className="raid-route-list">
                    {route.steps.map((step, index) => (
                      <li key={step.id}>
                        <span className="raid-route-num">{stepNumber(index)}</span>
                        <span>
                          {uiText(step.title)}
                          {step.floor && step.floor !== baseFloor ? <span className="tag raid-route-floor">{uiText(step.floor)}</span> : null}
                          {questName(step.questId) && questName(step.questId) !== step.title ? <small className="dim"> · {uiText(questName(step.questId)!)}</small> : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {route.length > 0 && <small className="dim">≈ {Math.round(route.length)}{uiText(' м по прямой между точками')}</small>}
                </>
              ) : <p className="muted">{uiText('У текущих заданий нет точек на этой карте.')}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** One objective: a map point (zone on this map) or a checklist step (kill, hand over, skill…). */
function ObjectiveLine({ objective, point }: { objective: BriefingObjective; point?: boolean }) {
  const label = objectiveTypeLabel(objective.type)
  return (
    <li className={point ? 'is-point' : 'is-check'} title={uiText(point ? 'Точка на карте' : 'Без точки на карте — отмечается по заданию')}>
      {point ? <MapPin size={11} /> : <ListChecks size={11} />}
      {label && <span className="raid-objective-type">{uiText(label)}</span>}
      {uiText(objective.description)}
      {objective.count ? <span className="dim"> · {objective.count}</span> : null}
    </li>
  )
}

function ItemSection({ icon, title, rows }: { icon: ReactNode; title: string; rows: BriefingItem[] }) {
  if (!rows.length) return null
  return (
    <div className="raid-briefing-section">
      <h4>{icon}{uiText(title)}</h4>
      {rows.map((row) => (
        <Link to={`/flea?selected=${row.itemId}`} className="raid-briefing-item" key={row.itemId} title={uiText(row.questNames.join(', '))}>
          {row.item?.iconUrl ? <img src={row.item.iconUrl} alt="" loading="lazy" /> : <span className="raid-briefing-item-blank" />}
          <span>
            <strong>{uiText(row.item?.name ?? row.itemId)}{row.count > 1 ? ` ×${row.count}` : ''}</strong>
            {row.foundInRaid && <span className="keep-fir">{uiText('FIR')}</span>}
            <small className="dim">{uiText(row.questNames.join(', '))}</small>
          </span>
        </Link>
      ))}
    </div>
  )
}
