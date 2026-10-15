import { Check, ChevronRight, Lock } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { ModeProgress, Quest, TaskProgressStatus } from '../domain/types'
import { provenCompleted, type TaskAvailability } from '../progression/requirementEngine'
import type { ChronologyGroup } from '../progression/chronologyView'
import { questStatusText } from '../shared/questStatus'
import { chronologyNote, chronologyTag } from '../progression/chronologyText'
import './traderQuests.css'

interface QuestChronologyProps {
  groups: ChronologyGroup[]
  availability: Map<string, TaskAvailability>
  progress: ModeProgress
  questsById: Map<string, Quest>
  selectedId?: string
  onOpen: (questId: string) => void
}

const closed = (status: TaskProgressStatus) => status === 'completed' || status === 'failed'

/** A trader's quests by stage and line level, each with what dates its status (the logs, a chain, the chronology). */
export function QuestChronology({ groups, availability, progress, questsById, selectedId, onOpen }: QuestChronologyProps) {
  return <div className="quest-chronology">
    {groups.map((group) => {
      const quests = group.steps.flatMap((step) => step.quests)
      // Counted as the game reported them; the dated ones stay marked in the list (src/quests/questEngine.ts).
      const done = quests.filter((quest) => provenCompleted(availability.get(quest.id))).length
      return <section key={group.key} className={`quest-chronology-group is-${group.kind}`}>
        <header>
          <strong>{uiText(groupTitle(group))}</strong>
          <small>{uiText(groupHint(group))}</small>
          <span className="quest-chronology-count">{uiText(`${done} из ${quests.length}`)}</span>
        </header>
        {group.steps.map((step) => <div key={step.level ?? 'all'} className="quest-chronology-step">
          {step.level !== undefined && <span className="quest-chronology-level">{uiText(`Уровень ${step.level}`)}</span>}
          <ol>
            {step.quests.map((quest) => {
              const info = availability.get(quest.id)
              const status = info?.status ?? 'unknown'
              const tag = chronologyTag(quest, info, progress)
              const note = chronologyNote(quest, info, progress, questsById)
              return <li key={quest.id}>
                <button type="button" className={`trader-quest-row quest-chronology-row is-${status}${quest.id === selectedId ? ' is-selected' : ''}`} title={note ? uiText(note) : undefined} aria-current={quest.id === selectedId ? 'true' : undefined} onClick={() => onOpen(quest.id)}>
                  <span className="trader-quest-index">{closed(status) ? <Check size={13} /> : status === 'locked' ? <Lock size={12} /> : '•'}</span>
                  <span className="trader-quest-copy">
                    <strong>{uiText(quest.name)}</strong>
                    <small>{uiText(`ур. ${quest.level}`)}{quest.kappa ? ` · ${uiText('капа')}` : ''}{tag ? <> · <span className={`quest-chronology-basis is-${tag.kind}`}>{uiText(tag.text)}</span></> : null}</small>
                  </span>
                  {questStatusText(status) && <span className={`trader-quest-status is-${status}`}>{uiText(questStatusText(status))}</span>}
                  <ChevronRight size={15} className="trader-quest-chevron" />
                </button>
              </li>
            })}
          </ol>
        </div>)}
      </section>
    })}
  </div>
}

function groupTitle(group: ChronologyGroup) {
  if (group.kind === 'start') return 'Старт'
  if (group.kind === 'line') return `Ветка ${group.order ?? ''}${group.ll ? ` · LL${group.ll}` : ''}`.replace('  ', ' ')
  if (group.kind === 'stage') return `Лояльность ${group.ll}`
  return 'Вне веток'
}

function groupHint(group: ChronologyGroup) {
  if (group.kind === 'start') return 'первые задания, выдаются в диалоге'
  if (group.kind === 'line') return 'задания открываются по уровням ветки'
  if (group.kind === 'stage') return 'по цепочкам и лояльности'
  return 'сюжет, события, задания других торговцев'
}
