import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Compass, Crosshair, LoaderCircle, Map as MapIcon, Route as RouteIcon, Users } from 'lucide-react'
import type { AppDataset, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { mapDisplayName } from '../data/mapIds'
import { fetchPlannerPeople, type Friend, type PlannerPerson } from './socialClient'
import { planMapRoute, rankMaps } from './raidPlanner'
import { sharedQuestsOf, type SquadMemberQuests } from './squadOverview'
import { useSquad } from './useSquad'
import { MemberChips } from './squadUi'
import { friendLabel, memberLabel, modeLabel } from './squadLabels'
import './squad.css'

type Data = Pick<AppDataset, 'quests' | 'maps' | 'markers'>
const MAX_FRIENDS = 4

interface Group { members: SquadMemberQuests[]; names: Map<string, { label: string; index: number }>; hidden: string[] }

/** «План рейда»: map priority for the squad or chosen friends, the same quests, and a route on the chosen map. */
export function RaidPlanner({ mode, data, friends, initialMapId }: { mode: RaidMode; data: Data; friends: Friend[]; initialMapId?: string }) {
  const { mine, overview } = useSquad(mode)
  const inSquad = Boolean(mine?.squad && mine.access && overview)
  const [chosen, setSource] = useState<'squad' | 'friends' | null>(null)
  const source = chosen === 'friends' || !inSquad ? 'friends' : 'squad'
  const [selected, setSelected] = useState<string[]>([])
  const key = `${mode}:${selected.join(',')}`
  const [result, setResult] = useState<{ key: string; people: PlannerPerson[] | null; error: string }>({ key: '', people: null, error: '' })
  const people = result.people
  const error = result.key === key ? result.error : ''
  const loading = source === 'friends' && result.key !== key
  const [mapId, setMapId] = useState(initialMapId ?? '')
  const shareable = friends.filter((friend) => friend.sharesProgress)

  useEffect(() => {
    if (source !== 'friends') return
    let active = true
    fetchPlannerPeople(mode, selected).then(
      (list) => { if (active) setResult({ key, people: list, error: '' }) },
      (reason: unknown) => { if (active) setResult((current) => ({ key, people: current.people, error: reason instanceof Error ? reason.message : String(reason) })) },
    )
    return () => { active = false }
  }, [source, mode, selected, key])

  const group: Group | null = useMemo(() => {
    if (source === 'squad' && overview) {
      const names = new Map(overview.squad.members.map((member, index) => [member.memberId, { label: memberLabel(member.nickname, index), index }]))
      return {
        members: overview.squad.members.filter((member) => !member.hidden).map((member) => ({ memberId: member.memberId, activeQuestIds: member.activeQuestIds ?? [], objectives: member.objectives })),
        names,
        hidden: overview.squad.members.filter((member) => member.hidden).map((member) => names.get(member.memberId)?.label ?? ''),
      }
    }
    if (source === 'friends' && people) {
      const label = (person: PlannerPerson) => (person.isYou ? `${person.nickname ?? uiText('Вы')} (${uiText('вы')})` : person.nickname ?? friendLabel(friends.find((friend) => friend.friendId === person.id)?.nicknames ?? {}, mode))
      const names = new Map(people.map((person, index) => [person.id, { label: label(person), index }]))
      return {
        members: people.filter((person) => !person.hidden).map((person) => ({ memberId: person.id, activeQuestIds: person.activeQuestIds, objectives: person.objectives })),
        names,
        hidden: people.filter((person) => person.hidden).map((person) => names.get(person.id)?.label ?? ''),
      }
    }
    return null
  }, [source, overview, people, friends, mode])

  const ranks = useMemo(() => (group ? rankMaps(group.members, data.quests, data.markers) : []), [group, data.quests, data.markers])
  const shared = useMemo(() => (group ? sharedQuestsOf(group.members) : []), [group])
  const activeMap = ranks.find((rank) => rank.mapId === mapId)?.mapId ?? ranks[0]?.mapId ?? ''
  const plan = useMemo(() => (group && activeMap ? planMapRoute(group.members, data.quests, data.markers, activeMap) : null), [group, activeMap, data.quests, data.markers])
  const questName = (id: string) => data.quests.find((quest) => quest.id === id)?.name ?? id
  const top = ranks[0]?.score || 1

  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((entry) => entry !== id) : list.length >= MAX_FRIENDS ? list : [...list, id]))

  return (
    <div className="stack squad-planner">
      <section className="panel">
        <div className="panel-header"><div className="panel-title">{uiText('С кем идём')} · {modeLabel(mode)}</div><Users size={15} className="dim" /></div>
        <div className="panel-body stack">
          <div className="segmented-filter" role="tablist">
            <button role="tab" aria-selected={source === 'squad'} className={source === 'squad' ? 'active' : ''} disabled={!inSquad} onClick={() => setSource('squad')}>{uiText('Отряд')}</button>
            <button role="tab" aria-selected={source === 'friends'} className={source === 'friends' ? 'active' : ''} onClick={() => setSource('friends')}>{uiText('Друзья')}</button>
          </div>
          {source === 'friends' && (
            shareable.length ? (
              <div className="squad-chips" aria-label={uiText('Друзья в рейд')}>
                {shareable.map((friend) => (
                  <label key={friend.friendId} className={`squad-pick${selected.includes(friend.friendId) ? ' active' : ''}`}>
                    <input type="checkbox" checked={selected.includes(friend.friendId)} onChange={() => toggle(friend.friendId)} disabled={!selected.includes(friend.friendId) && selected.length >= MAX_FRIENDS} />
                    {friendLabel(friend.nicknames, mode)}
                  </label>
                ))}
              </div>
            ) : <p className="muted">{uiText('Добавьте друзей, чтобы планировать рейд вместе. Пока план строится только по вашим заданиям.')}</p>
          )}
          {group && group.hidden.length > 0 && <small className="muted">{uiText('Скрыли прогресс')}: {group.hidden.join(', ')}</small>}
          {loading && <span className="muted"><LoaderCircle className="spin" size={14} /> {uiText('Загружаем задания…')}</span>}
          {error && <p className="squad-error" role="alert">{uiText(error)}</p>}
        </div>
      </section>

      {group && (
        <div className="grid-2 squad-planner-grid">
          <section className="panel">
            <div className="panel-header"><div className="panel-title">{uiText('Приоритет карт')}</div><Compass size={15} className="dim" /></div>
            <div className="panel-body squad-list">
              {ranks.length ? ranks.slice(0, 8).map((rank, index) => (
                <button key={rank.mapId} className={`squad-rank${rank.mapId === activeMap ? ' active' : ''}`} onClick={() => setMapId(rank.mapId)}>
                  <span className="squad-rank-index mono">{String(index + 1).padStart(2, '0')}</span>
                  <span className="squad-row-main">
                    <strong>{uiText(mapDisplayName(rank.mapId, data.maps))}</strong>
                    <small className="muted">{uiText('целей')}: {rank.objectives} · {uiText('заданий')}: {rank.quests}{rank.sharedQuests > 0 && <> · <span className="squad-shared-label">{uiText('общих')}: {rank.sharedQuests}</span></>}</small>
                    <span className="squad-rank-bar"><span style={{ width: `${Math.max(6, (rank.score / top) * 100)}%` }} /></span>
                  </span>
                </button>
              )) : <p className="muted">{uiText('Нет активных заданий с картой.')}</p>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-header"><div className="panel-title">{uiText('Одинаковые квесты')}</div><span className="tag brass">{shared.length}</span></div>
            <div className="panel-body squad-list">
              {shared.length ? shared.map((entry) => (
                <div key={entry.questId} className="squad-row is-shared">
                  <span className="squad-row-main"><strong>{uiText(questName(entry.questId))}</strong></span>
                  <MemberChips ids={entry.memberIds} names={group.names} />
                </div>
              )) : <p className="muted">{uiText('Общих активных заданий нет.')}</p>}
            </div>
          </section>
        </div>
      )}

      {group && plan && (
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">{uiText('План на карте')} · {uiText(mapDisplayName(plan.mapId, data.maps))}</div>
            <Link className="button small ghost" to={`/maps/${plan.mapId}`}><MapIcon size={14} />{uiText('Открыть карту')}</Link>
          </div>
          <div className="panel-body">
            {plan.steps.length > 0 && (
              <ol className="squad-route">
                {plan.steps.map((step) => (
                  <li key={`${step.questId}:${step.objectiveId}`} className={step.memberIds.length >= 2 ? 'is-shared' : ''}>
                    <span className="squad-row-main">
                      <strong>{uiText(step.label)}</strong>
                      <small className="muted">{uiText(questName(step.questId))}</small>
                    </span>
                    <MemberChips ids={step.memberIds} names={group.names} />
                  </li>
                ))}
              </ol>
            )}
            {plan.unplaced.length > 0 && (
              <div className="squad-anymap">
                <span className="stat-label"><Crosshair size={11} /> {uiText('Без точки на карте')}</span>
                {plan.unplaced.map((entry) => (
                  <div key={entry.questId} className={`squad-row${entry.memberIds.length >= 2 ? ' is-shared' : ''}`}>
                    <span className="squad-row-main"><strong>{uiText(questName(entry.questId))}</strong>{entry.anyMap && <small className="muted">{uiText('Любая карта')}</small>}</span>
                    <MemberChips ids={entry.memberIds} names={group.names} />
                  </div>
                ))}
              </div>
            )}
            {!plan.steps.length && !plan.unplaced.length && <p className="muted">{uiText('На этой карте у группы нет заданий.')}</p>}
            <small className="muted squad-route-note"><RouteIcon size={11} /> {uiText('Порядок — по ближайшим точкам заданий, без учёта опасностей и выходов.')}</small>
          </div>
        </section>
      )}
    </div>
  )
}

/** Dashboard: under the map choice, the squad's best maps for this mode (only when the account is in a squad). */
export function SquadRaidCard({ mode, data, selectedMapId, onPickMap }: { mode: RaidMode; data: Data; selectedMapId: string; onPickMap: (mapId: string) => void }) {
  const { mine, overview } = useSquad(mode, { poll: false })
  const members = useMemo(() => (overview ? overview.squad.members.filter((member) => !member.hidden).map((member) => ({ memberId: member.memberId, activeQuestIds: member.activeQuestIds ?? [], objectives: member.objectives })) : []), [overview])
  const ranks = useMemo(() => rankMaps(members, data.quests, data.markers).slice(0, 3), [members, data.quests, data.markers])
  if (!mine?.squad || !mine.access || !overview) return null
  const here = rankMaps(members, data.quests, data.markers).find((rank) => rank.mapId === selectedMapId)
  return (
    <section className="panel squad-dash">
      <div className="panel-header"><div className="panel-title"><Users size={13} /> {uiText('Отряд')} · {overview.squad.members.length} / {overview.squad.maxMembers}</div><Link className="tag brass" to={`/squad?tab=plan&map=${encodeURIComponent(selectedMapId)}`}>{uiText('План рейда')}</Link></div>
      <div className="panel-body">
        <small className="muted">{uiText('На выбранной карте')}: {here ? <>{uiText('целей')} {here.objectives}, {uiText('общих заданий')} {here.sharedQuests}</> : uiText('у отряда нет заданий')}</small>
        <div className="squad-dash-ranks">
          {ranks.map((rank, index) => (
            <button key={rank.mapId} className={`squad-rank compact${rank.mapId === selectedMapId ? ' active' : ''}`} onClick={() => onPickMap(rank.mapId)}>
              <span className="squad-rank-index mono">{index + 1}</span>
              <span className="squad-row-main"><strong>{uiText(mapDisplayName(rank.mapId, data.maps))}</strong><small className="muted">{uiText('общих')}: {rank.sharedQuests} · {uiText('целей')}: {rank.objectives}</small></span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
