import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import type { Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { mapLocativePhrase } from '../shared/mapLocative'

interface CurrentTasksPanelProps {
  map: { id: string; name: string }
  /** Current-stage tasks on this map, in display order. */
  quests: Quest[]
  /** Current tasks that can be done on any map. */
  anyMapQuests: Quest[]
  questLink: (quest: Quest) => string
  /** Tasks shown while the list is collapsed. */
  collapsedCount?: number
}

type Entry = { kind: 'quest'; quest: Quest; index: string; anyMap: boolean } | { kind: 'group' }

function tasksWord(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'заданий'
  return last === 1 ? 'задание' : last >= 2 && last <= 4 ? 'задания' : 'заданий'
}

/**
 * «Текущие задания» of the Overview: the first three tasks, the rest behind «Ещё N заданий». The rest opens and
 * closes slowly (grid rows 0fr ↔ 1fr, pages.css) — the owner asked for a calm, not a snappy, reveal.
 */
export function CurrentTasksPanel({ map, quests, anyMapQuests, questLink, collapsedCount = 3 }: CurrentTasksPanelProps) {
  const { locale } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const moreId = useId()

  const entries: Entry[] = [
    ...quests.map((quest, index): Entry => ({ kind: 'quest', quest, index: String(index + 1).padStart(2, '0'), anyMap: false })),
    ...(anyMapQuests.length ? [{ kind: 'group' } as Entry] : []),
    ...anyMapQuests.map((quest): Entry => ({ kind: 'quest', quest, index: '∞', anyMap: true })),
  ]
  // The «Любая карта» heading goes with the first task under it, so it never dangles above the «Ещё» button.
  const visible: Entry[] = []
  const hidden: Entry[] = []
  let shown = 0
  for (const entry of entries) {
    if (shown < collapsedCount) {
      visible.push(entry)
      if (entry.kind === 'quest') shown += 1
    } else hidden.push(entry)
  }
  const hiddenCount = hidden.filter((entry) => entry.kind === 'quest').length

  const render = (entry: Entry) => entry.kind === 'group'
    ? <div className="stat-label current-tasks-group" key="any-map">{uiText('Любая карта · ')}{anyMapQuests.length}</div>
    : <div className="quest-row" key={entry.quest.id}>
      <div className="quest-index">{entry.index}</div>
      <Link to={questLink(entry.quest)} title={uiText('Показать на карте')}>
        <strong>{uiText(entry.quest.name)}</strong>
        <small>{uiText(entry.quest.trader)}{!entry.anyMap && <>{uiText(' · ур. ')}{entry.quest.level}</>}{uiText(entry.quest.kappa ? ' · капа' : '')}</small>
      </Link>
    </div>

  const moreLabel = locale === 'en' ? `${hiddenCount} more ${hiddenCount === 1 ? 'task' : 'tasks'}` : `Ещё ${hiddenCount} ${tasksWord(hiddenCount)}`

  return <section className="panel current-tasks">
    <div className="panel-header">
      <div className="panel-title">{uiText('Текущие задания')}</div>
      {/* Same type as the heading: the count of this map's tasks is the second half of the title, not a footnote. */}
      <Link to={`/maps/${map.id}`} className="panel-title current-tasks-where" title={uiText('Открыть карту')}>
        <span className="current-tasks-where-count">{quests.length}</span> {uiText(mapLocativePhrase(map, locale))}
      </Link>
    </div>
    <div className="panel-body">
      {!quests.length && <p className="muted">{uiText('На карте «')}{uiText(map.name)}{uiText('» нет заданий текущего этапа. Они появятся, когда вы примете в игре задание с этой локации.')}</p>}
      {visible.map(render)}
      {hiddenCount > 0 && <>
        <div id={moreId} className={`current-tasks-more${expanded ? ' is-open' : ''}`} inert={!expanded}>
          <div className="current-tasks-more-inner">{hidden.map(render)}</div>
        </div>
        <button type="button" className="button small current-tasks-toggle" aria-expanded={expanded} aria-controls={moreId} onClick={() => setExpanded((value) => !value)}>
          {expanded ? uiText('Свернуть') : moreLabel}<ChevronDown size={14} aria-hidden="true" />
        </button>
      </>}
    </div>
  </section>
}
