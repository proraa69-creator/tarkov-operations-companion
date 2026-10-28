import { Link } from 'react-router-dom'
import { LocateFixed, ScrollText } from 'lucide-react'
import type { GameMap, ModeProgress, Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { isStoryQuest } from '../progression/requirementEngine'
import { QuestObjectivesPanel } from './QuestObjectivesPanel'
import { QuestGuidePhotos } from './QuestGuidePhotos'
import { StoryObjectivesPanel } from './StoryObjectivesPanel'

interface QuestInlineCardProps {
  quest: Quest
  progress: ModeProgress
  maps: GameMap[]
  /** The map focused on the quest's point; only when the quest has a point of its own on this map. */
  pointLink?: string
}

/**
 * The quest card that slides down under a task of «Текущие задания» on the phone (components/CurrentTasksPanel.tsx):
 * the task, its objectives with the ticks, and «Геопозиция» when the quest has a concrete point on the raid's map
 * (owner, 17.10.2026).
 */
export function QuestInlineCard({ quest, progress, maps, pointLink }: QuestInlineCardProps) {
  const story = isStoryQuest(quest)
  return <div className="quest-inline-card">
    <div className="quest-inline-actions">
      {pointLink && <Link className="button small primary" to={pointLink}><LocateFixed size={15} />{uiText(' Геопозиция')}</Link>}
      <Link className="button small ghost" to={`/quests?${story ? 'filter=story&' : ''}selected=${encodeURIComponent(quest.id)}`}><ScrollText size={15} />{uiText(' Весь квест')}</Link>
    </div>
    {story
      ? <StoryObjectivesPanel quest={quest} progress={progress} maps={maps} />
      : <>
        {quest.description && <div className="detail-section quest-inline-task"><h4>{uiText('Задача')}</h4><p>{uiText(quest.description)}</p></div>}
        <QuestObjectivesPanel quest={quest} />
        <QuestGuidePhotos quest={quest} />
      </>}
  </div>
}
