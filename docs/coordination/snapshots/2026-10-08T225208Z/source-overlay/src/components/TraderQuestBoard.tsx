import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ChevronRight, ListChecks, Lock, ScrollText } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { calculateAvailability, isLiveGameQuest } from '../progression/requirementEngine'
import { sortQuestsChronologically } from '../progression/questChronology'
import { QuestFullView } from './QuestFullView'
import { questStatusText } from '../shared/questStatus'
import type { Quest, TaskProgressStatus, Trader } from '../domain/types'
import './traderQuests.css'

type QuestList = 'all' | 'available' | 'completed'

const LISTS: Array<{ id: QuestList; label: string }> = [
  { id: 'all', label: 'Общий список' },
  { id: 'available', label: 'Доступные' },
  { id: 'completed', label: 'Завершённые' },
]

const closed = (status: TaskProgressStatus) => status === 'completed' || status === 'failed'
const open = (status: TaskProgressStatus) => status === 'available' || status === 'active'

/**
 * A trader's quests in the order the game gives them out. Finished quests are struck through and cannot be
 * opened; every other quest opens its full description on the right.
 */
export function TraderQuestBoard({ trader }: { trader: Trader }) {
  const { data } = useTarkovData()
  const state = useAppState()
  const [params, setParams] = useSearchParams()
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const list = (LISTS.some((entry) => entry.id === params.get('list')) ? params.get('list') : 'all') as QuestList
  const detailRef = useRef<HTMLElement>(null)

  const quests = useMemo(() => sortQuestsChronologically(
    data.quests.filter((quest) => isLiveGameQuest(quest) && quest.trader === trader.name),
    data.quests,
  ), [data.quests, trader.name])
  const statusOf = (quest: Quest) => availability.get(quest.id)?.status ?? 'unknown'
  const counts = {
    all: quests.length,
    available: quests.filter((quest) => open(statusOf(quest))).length,
    // «Выполнено» is handed-in quests only; failed ones stay in the «Завершённые» list but are not done.
    completed: quests.filter((quest) => statusOf(quest) === 'completed').length,
  }
  const shown = quests.filter((quest) => list === 'all' || (list === 'available' ? open(statusOf(quest)) : closed(statusOf(quest))))
  const position = new Map(quests.map((quest, index) => [quest.id, index + 1]))

  const selectedId = params.get('quest')
  const selected = selectedId ? data.quests.find((quest) => quest.id === selectedId) : undefined

  const update = (change: (next: URLSearchParams) => void) => setParams((current) => {
    const next = new URLSearchParams(current)
    change(next)
    return next
  })
  const openQuest = (questId: string) => update((next) => {
    const quest = data.quests.find((entry) => entry.id === questId)
    const owner = quest ? data.traders.find((entry) => entry.name === quest.trader) : undefined
    if (owner) next.set('trader', owner.id)
    next.set('quest', questId)
  })

  // A newly opened quest starts at the top of its description.
  useEffect(() => { if (detailRef.current) detailRef.current.scrollTop = 0 }, [selectedId])

  return <div className="trader-quests">
    <section className="panel trader-quests-list">
      <div className="panel-header">
        <div className="panel-title"><ScrollText size={15} /> {uiText('Задания торговца')} · {uiText(trader.name)}</div>
        <span className="tag green">{uiText('Выполнено')}: {counts.completed}/{counts.all}</span>
      </div>
      <div className="trader-quests-tabs segmented-filter" role="tablist" aria-label={uiText('Список заданий')}>
        {LISTS.map((entry) => <button type="button" role="tab" aria-selected={list === entry.id} key={entry.id} className={list === entry.id ? 'active' : ''} onClick={() => update((next) => { if (entry.id === 'all') next.delete('list'); else next.set('list', entry.id) })}>
          {uiText(entry.label)} <small>{counts[entry.id]}</small>
        </button>)}
      </div>
      <ol className="trader-quests-rows">
        {shown.map((quest) => {
          const status = statusOf(quest)
          const done = closed(status)
          const body = <>
            <span className="trader-quest-index">{done ? <Check size={13} /> : status === 'locked' ? <Lock size={12} /> : position.get(quest.id)}</span>
            <span className="trader-quest-copy">
              <strong>{uiText(quest.name)}</strong>
              <small>{uiText(`ур. ${quest.level}`)}{quest.kappa ? ` · ${uiText('капа')}` : ''}{quest.anyMap ? ` · ${uiText('Любая карта')}` : quest.mapId ? ` · ${uiText(data.maps.find((map) => map.id === quest.mapId)?.name ?? quest.mapId)}` : ''}</small>
            </span>
            <span className={`trader-quest-status is-${status}`}>{uiText(questStatusText(status))}</span>
          </>
          return <li key={quest.id}>
            {/* Completed quests stay struck through but open like the rest (the owner reads them back). */}
            <button type="button" className={`trader-quest-row is-${status}${quest.id === selected?.id ? ' is-selected' : ''}`} aria-current={quest.id === selected?.id ? 'true' : undefined} title={done ? uiText(questStatusText(status)) : undefined} onClick={() => openQuest(quest.id)}>{body}<ChevronRight size={15} className="trader-quest-chevron" /></button>
          </li>
        })}
      </ol>
      {!shown.length && <div className="empty-state trader-quests-empty"><div><ListChecks size={26} /><p>{uiText(list === 'completed' ? 'Завершённых заданий у этого торговца пока нет.' : list === 'available' ? 'Сейчас нет доступных заданий у этого торговца.' : 'У этого торговца нет заданий.')}</p></div></div>}
    </section>

    <aside ref={detailRef} className="panel detail-panel quest-detail trader-quest-detail">
      {selected
        ? <QuestFullView quest={selected} availability={availability} onOpenQuest={openQuest} />
        : <div className="map-detail-empty"><div><ScrollText size={30} /><h3>{uiText('Выберите задание')}</h3><p>{uiText('Нажмите на доступное задание слева — здесь откроется его полное описание: цели, условия, предметы, места на карте и награды.')}</p></div></div>}
    </aside>
  </div>
}
