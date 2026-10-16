import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { ModeProgress, Quest } from '../domain/types'
import type { TaskAvailability } from '../progression/requirementEngine'
import { isLiveGameQuest } from '../progression/requirementEngine'
import { chronologyStages } from '../progression/chronology'
import { traderChronologyGroups } from '../progression/chronologyView'
import { sortQuestsChronologically } from '../progression/questChronology'
import { questGridSnapshotDate } from '../data/questGrid'
import { QuestChronology } from './QuestChronology'

const TRACKED = new Set(['eft-log', 'manual', 'screen-scan'])
const LOG_PREVIEW = 8

interface QuestChronologyPanelProps {
  quests: Quest[]
  /** Quests to show (search and trader filter applied). */
  shown: Quest[]
  availability: Map<string, TaskAvailability>
  progress: ModeProgress
  selectedId?: string
  onOpen: (questId: string) => void
}

/**
 * «Хронология» on the Quests page: what the logs show for this mode (the latest event of each quest), how many quests are
 * dated by the logs, by a chain or by the chronology, and every trader's quests by stage and line level.
 */
export function QuestChronologyPanel({ quests, shown, availability, progress, selectedId, onOpen }: QuestChronologyPanelProps) {
  const [allEvents, setAllEvents] = useState(false)
  const stages = useMemo(() => chronologyStages(quests), [quests])
  const questsById = useMemo(() => new Map(quests.map((quest) => [quest.id, quest])), [quests])
  const traders = useMemo(() => {
    const byTrader = new Map<string, Quest[]>()
    for (const quest of shown) if (isLiveGameQuest(quest)) byTrader.set(quest.trader, [...(byTrader.get(quest.trader) ?? []), quest])
    // traders with lines first (the seven main ones), the rest after
    return [...byTrader].sort(([, a], [, b]) => Number(b.some((quest) => quest.unlock?.lines?.length)) - Number(a.some((quest) => quest.unlock?.lines?.length)))
      .map(([trader, own]) => ({ trader, groups: traderChronologyGroups(sortQuestsChronologically(own, quests), stages, quests) }))
  }, [quests, shown, stages])
  const events = useMemo(() => Object.values(progress.taskProgress)
    .filter((record) => TRACKED.has(record.source) && questsById.has(record.taskId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [progress.taskProgress, questsById])
  const counts = useMemo(() => {
    const live = quests.filter((quest) => isLiveGameQuest(quest))
    const of = (test: (info: TaskAvailability | undefined, quest: Quest) => boolean) => live.filter((quest) => test(availability.get(quest.id), quest)).length
    return {
      logs: of((_info, quest) => TRACKED.has(progress.taskProgress[quest.id]?.source ?? '')),
      chain: of((info) => info?.basis === 'chain'),
      chronology: of((info) => info?.basis === 'line' || info?.basis === 'stage' || info?.basis === 'start'),
    }
  }, [availability, progress.taskProgress, quests])

  return <div className="quest-chronology-panel">
    <div className="quest-chronology-summary">
      <span className="tag brass">{uiText(`По логам: ${counts.logs}`)}</span>
      <span className="tag green">{uiText(`По цепочке: ${counts.chain}`)}</span>
      <span className="tag green">{uiText(`По хронологии: ${counts.chronology}`)}</span>
      <small className="dim">{uiText(`Сетка квестов: tarkov.dev и tarkov.help · снимок ${new Date(questGridSnapshotDate).toLocaleDateString('ru-RU')}`)}</small>
    </div>
    {events.length > 0 && <section className="quest-chronology-log">
      <header><History size={14} /> <strong>{uiText('История из логов')}</strong> <small>{uiText('последнее событие каждого задания')}</small></header>
      <ol>
        {(allEvents ? events : events.slice(0, LOG_PREVIEW)).map((record) => {
          const quest = questsById.get(record.taskId)!
          return <li key={record.taskId}>
            <button type="button" onClick={() => onOpen(quest.id)}>
              <time>{new Date(record.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
              <span className={`quest-chronology-event is-${record.status}`}>{uiText(record.status === 'completed' ? 'сдано' : record.status === 'failed' ? 'провалено' : 'взято')}</span>
              <span className="quest-chronology-event-name">{uiText(quest.name)}</span>
              <small>{uiText(quest.trader)}</small>
            </button>
          </li>
        })}
      </ol>
      {events.length > LOG_PREVIEW && <button type="button" className="button ghost small" onClick={() => setAllEvents((value) => !value)}>{uiText(allEvents ? 'Свернуть' : `Показать все (${events.length})`)}</button>}
    </section>}
    {traders.map(({ trader, groups }) => <section key={trader} className="quest-chronology-trader">
      <h3>{uiText(trader)}</h3>
      <QuestChronology groups={groups} availability={availability} progress={progress} questsById={questsById} selectedId={selectedId} onOpen={onOpen} />
    </section>)}
  </div>
}
