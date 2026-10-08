import { MapPin, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import type { GameMap, ModeProgress, Quest } from '../domain/types'
import { storyObjectiveMapLinks, visibleStoryObjectives } from '../progression/storyObjectives'

export function StoryObjectivesPanel({ quest, progress, maps }: { quest: Quest; progress: ModeProgress; maps: GameMap[] }) {
  const objectives = visibleStoryObjectives(quest, progress)
  if (!objectives.length) return <div className="detail-section"><p className="dim">{uiText('Ожидаем актуальные задачи из игры.')}</p></div>
  return <>{[false, true].map(optional => {
    const group = objectives.filter(objective => objective.optional === optional)
    if (!group.length) return null
    return <section className="detail-section" key={String(optional)}>
      <h4>{uiText(optional ? 'Дополнительные задачи' : 'Главные задачи')}</h4>
      <ul className="story-objectives">{group.map(objective => {
        const links = storyObjectiveMapLinks(quest, objective)
        return <li key={objective.id} className={objective.completed ? 'is-done' : ''}>
          <div className="story-objective-copy">{objective.completed && <Check size={15} aria-label={uiText('Выполнено')} />}<span>{uiText(objective.text)}</span>
            {objective.total != null && <span className="tag">{objective.current}/{objective.total}</span>}</div>
          {objective.hint && <p className="story-objective-hint">{uiText(objective.hint)}</p>}
          {links.length > 0 && <div className="story-objective-maps">{links.map(({ mapId, to }) =>
            <Link className="button ghost" key={mapId} to={to} title={uiText(objective.text)}><MapPin size={14} />
              {uiText('Показать на карте')}{' · '}{uiText(maps.find(map => map.id === mapId)?.name ?? mapId)}</Link>)}</div>}
        </li>
      })}</ul>
    </section>
  })}</>
}
