import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Crosshair } from 'lucide-react'
import type { Item, Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { mapLocativePhrase } from '../shared/mapLocative'
import { GearStrip, QuestConditionsDialog } from '../overview/QuestConditionsCard'
import { usePictures } from '../overview/usePictures'
import { GearSectionHeading } from '../overview/GearQuestSection'
import type { ConditionQuest } from '../overview/questConditions'

interface CurrentTasksPanelProps {
  map: { id: string; name: string }
  /** Current-stage tasks on this map, in display order. */
  quests: Quest[]
  /** Current tasks that can be done on any map. */
  anyMapQuests: Quest[]
  questLink: (quest: Quest) => string
  /** Tasks shown while the list is collapsed. */
  collapsedCount?: number
  /**
   * The tasks of `quests` / `anyMapQuests` with a gear condition on this map, in display order: they leave the list for
   * the section «С условиями на снаряжение» at its bottom, and a click shows their build. The counts stay as they are.
   */
  gear?: { quests: ConditionQuest[]; items: Item[]; mapName: (id: string) => string }
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
export function CurrentTasksPanel({ map, quests, anyMapQuests, questLink, collapsedCount = 3, gear }: CurrentTasksPanelProps) {
  const { locale } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const moreId = useId()
  const [build, setBuild] = useState<ConditionQuest | undefined>()
  const pictures = usePictures(gear?.items ?? NO_ITEMS)

  const gearIds = new Set(gear?.quests.map((entry) => entry.quest.id))
  const ordinary = quests.filter((quest) => !gearIds.has(quest.id))
  const ordinaryAnyMap = anyMapQuests.filter((quest) => !gearIds.has(quest.id))
  const gearQuests = gear?.quests ?? []
  const entries: Entry[] = [
    ...ordinary.map((quest, index): Entry => ({ kind: 'quest', quest, index: String(index + 1).padStart(2, '0'), anyMap: false })),
    ...(ordinaryAnyMap.length ? [{ kind: 'group' } as Entry] : []),
    ...ordinaryAnyMap.map((quest): Entry => ({ kind: 'quest', quest, index: '∞', anyMap: true })),
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
    ? <div className="stat-label current-tasks-group" key="any-map">{uiText('Любая карта · ')}{ordinaryAnyMap.length}</div>
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
      {gear && gearQuests.length > 0 && <div className="gear-section current-tasks-gear">
        <GearSectionHeading count={gearQuests.length} />
        {gearQuests.map((entry) => {
          const first = entry.objectives[0]
          const anyMap = !quests.includes(entry.quest)
          return <div className="quest-row is-gear" key={entry.quest.id}>
            <div className="quest-index" aria-hidden="true"><Crosshair size={13} /></div>
            <button type="button" className="gear-quest-button" aria-haspopup="dialog" title={uiText('Снаряжение для рейда')} onClick={() => setBuild(entry)}>
              <span className="gear-quest-copy">
                <strong>{uiText(entry.quest.name)}</strong>
                <small>{uiText(entry.quest.trader)}{anyMap ? uiText(' · Любая карта') : <>{uiText(' · ур. ')}{entry.quest.level}</>}{uiText(entry.quest.kappa ? ' · капа' : '')}</small>
              </span>
              {first?.conditions && <GearStrip conditions={first.conditions} pictures={pictures} tiny />}
            </button>
          </div>
        })}
      </div>}
    </div>
    {gear && build && <QuestConditionsDialog entry={build} mapId={map.id} mapName={gear.mapName} pictures={pictures} mapLink={questLink(build.quest)} onClose={() => setBuild(undefined)} />}
  </section>
}

const NO_ITEMS: Item[] = []
