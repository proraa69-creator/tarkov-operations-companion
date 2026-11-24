import type { MouseEvent as ReactMouseEvent } from 'react'
import { BookOpen, Plus } from 'lucide-react'
import type { ModeProgress, Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { visibleStoryObjectives } from '../progression/storyObjectives'
import { currentStoryStageIndex } from '../progression/requirementEngine'
import './storyChapterColumns.css'

/**
 * «Главы истории» in two blocks (owner, 11.11.2026: «кнопки одинаковые по размеру и по форме. И непонятно, где какая… все,
 * которые начаты, они в левом блоке в текущих, а все, которые остались, они в правом блоке»): on the left «Текущие», the
 * chapters the player has taken, each with where he is; on the right «Начать новую», the chapters neither taken nor
 * finished — a tap opens its stages to start it («Начать главу»). Finished ones stand in «Показать все».
 */
export function StoryChapterColumns({ current, remaining, progress, selectedId, onOpen, onStart, menuOf }: {
  current: readonly Quest[]
  remaining: readonly Quest[]
  progress: ModeProgress
  selectedId?: string
  onOpen: (questId: string) => void
  onStart: (questId: string) => void
  menuOf: (quest: Quest) => ((event: ReactMouseEvent) => void) | undefined
}) {
  return <div className="story-columns">
    <section className="story-column" aria-labelledby="story-column-current">
      <h4 id="story-column-current"><BookOpen size={14} aria-hidden="true" />{uiText('Текущие')}<span className="story-column-count">{current.length}</span></h4>
      {current.length ? current.map((quest) => {
        const stage = quest.stages?.[currentStoryStageIndex(quest, progress)]
        const goals = visibleStoryObjectives(quest, progress).filter((objective) => !objective.completed).map((objective) => objective.text).join(' · ')
        return <button key={quest.id} type="button" className={`story-chapter-row is-current${quest.id === selectedId ? ' selected' : ''}`} onClick={() => onOpen(quest.id)} onContextMenu={menuOf(quest)}>
          <strong>{uiText(quest.name)}</strong>
          {(goals || stage?.title) && <small>{uiText(goals || stage?.title || '')}</small>}
        </button>
      }) : <p className="story-column-empty">{uiText('Взятых глав нет')}</p>}
    </section>
    <section className="story-column is-new" aria-labelledby="story-column-new">
      <h4 id="story-column-new"><Plus size={14} aria-hidden="true" />{uiText('Начать новую')}<span className="story-column-count">{remaining.length}</span></h4>
      {remaining.length ? remaining.map((quest) => <button key={quest.id} type="button" className={`story-chapter-row is-new${quest.id === selectedId ? ' selected' : ''}`} onClick={() => onStart(quest.id)} onContextMenu={menuOf(quest)}>
        <strong>{uiText(quest.name)}</strong>
        <Plus size={15} aria-hidden="true" />
      </button>) : <p className="story-column-empty">{uiText('Все главы начаты')}</p>}
    </section>
  </div>
}
