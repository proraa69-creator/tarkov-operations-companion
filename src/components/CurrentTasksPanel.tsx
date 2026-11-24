import { useId, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useBlockTitle } from '../overview/blockTitle'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import type { Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { mapLocativePhrase } from '../shared/mapLocative'
import { useAlignedListHeight } from '../overview/useAlignedListHeight'
import { ThumbScroll } from './ThumbScroll'

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
   * Phone: a tap on a task slides its card down right under it instead of opening the map (owner, 17.10.2026: «при
   * нажатии в текущих квестах на окно квеста, оно должно выезжать вниз прям там без перехода»).
   */
  details?: (quest: Quest) => ReactNode
  /**
   * A right click on a task: «Отложить квест» (owner, 03.11.2026: «в этом блоке тоже нужно что бы правая кнопка мыши
   * работала и можно было добавить отложеные»; components/QuestDeferDialog.tsx).
   */
  onDefer?: (quest: Quest, at: { x: number; y: number }) => void
  /** Tasks of this map put aside in «Отложенные квесты»: not listed, only counted under the list. */
  deferredCount?: number
  /**
   * The PC (owner, 07.11.2026): the whole list in a window the wheel scrolls, as tall as it takes to bring «Рынок» level with «Требования
   * рейда», with no «Ещё N заданий». Without it: the first tasks and the button.
   */
  scrollable?: boolean
  /** Changes whenever the blocks may have moved. */
  layoutKey?: string
  /** The phone (owner, 11.11.2026: «текущее задание… тоже компактней»): the whole list, this many rows in sight, the rest under a thumb. */
  compactRows?: number
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
export function CurrentTasksPanel({ map, quests, anyMapQuests, questLink, collapsedCount = 3, details, onDefer, deferredCount = 0, scrollable = false, layoutKey = '', compactRows }: CurrentTasksPanelProps) {
  const { locale } = useLocale()
  const title = useBlockTitle('Текущие задания')
  const [expanded, setExpanded] = useState(false)
  const moreId = useId()
  const [openId, setOpenId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listHeight = useAlignedListHeight(listRef, scrollable, `${layoutKey}|${quests.length}|${anyMapQuests.length}`)
  /** Cards once opened stay mounted, so closing slides them up instead of cutting them off. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) => {
    setOpenId((current) => current === id ? null : id)
    setOpened((current) => current.has(id) ? current : new Set(current).add(id))
  }

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

  const caption = (entry: Extract<Entry, { kind: 'quest' }>) => <>
    <strong>{uiText(entry.quest.name)}</strong>
    <small>{uiText(entry.quest.trader)}{!entry.anyMap && <>{uiText(' · ур. ')}{entry.quest.level}</>}{uiText(entry.quest.kappa ? ' · капа' : '')}</small>
  </>
  const menuOf = (quest: Quest) => (onDefer ? (event: ReactMouseEvent) => {
    event.preventDefault()
    onDefer(quest, { x: event.clientX, y: event.clientY })
  } : undefined)
  const render = (entry: Entry) => {
    if (entry.kind === 'group') return <div className="stat-label current-tasks-group" key="any-map">{uiText('Любая карта · ')}{anyMapQuests.length}</div>
    if (!details) {
      return <div className="quest-row" key={entry.quest.id} onContextMenu={menuOf(entry.quest)}>
        <div className="quest-index">{entry.index}</div>
        <Link to={questLink(entry.quest)} title={uiText('Показать на карте')}>{caption(entry)}</Link>
      </div>
    }
    const id = entry.quest.id
    const open = openId === id
    const cardId = `${moreId}-${id}`
    return <div className={`quest-row-wrap${open ? ' is-open' : ''}`} key={id}>
      <button type="button" className="quest-row quest-row-button" aria-expanded={open} aria-controls={cardId} onClick={() => toggle(id)} onContextMenu={menuOf(entry.quest)}>
        <span className="quest-index">{entry.index}</span>
        <span className="quest-row-caption">{caption(entry)}</span>
        <ChevronDown size={16} className="quest-row-chevron" aria-hidden="true" />
      </button>
      <div id={cardId} className={`quest-inline${open ? ' is-open' : ''}`} inert={!open}>
        <div className="quest-inline-inner">{opened.has(id) && details(entry.quest)}</div>
      </div>
    </div>
  }

  const moreLabel = locale === 'en' ? `${hiddenCount} more ${hiddenCount === 1 ? 'task' : 'tasks'}` : `Ещё ${hiddenCount} ${tasksWord(hiddenCount)}`

  return <section className={`panel current-tasks${compactRows ? ' is-compact' : ''}`}>
    <div className="panel-header">
      <div className="panel-title">{title}</div>
      {/* Same type as the heading: the count of this map's tasks is the second half of the title, not a footnote. */}
      <Link to={`/maps/${map.id}`} className="panel-title current-tasks-where" title={uiText('Открыть карту')}>
        <span className="current-tasks-where-count">{quests.length}</span> {uiText(mapLocativePhrase(map, locale))}
      </Link>
    </div>
    <div className="panel-body">
      {!quests.length && !deferredCount && <p className="muted">{uiText('На карте «')}{uiText(map.name)}{uiText('» нет заданий текущего этапа. Они появятся, когда вы примете в игре задание с этой локации.')}</p>}
      {compactRows && entries.length > 0 && <ThumbScroll rows={compactRows}><div className="current-tasks-list">{entries.map(render)}</div></ThumbScroll>}
      {!compactRows && scrollable && entries.length > 0 && <div ref={listRef} className="current-tasks-scroll" style={listHeight === null ? undefined : { maxHeight: listHeight }}>{entries.map(render)}</div>}
      {!compactRows && !scrollable && visible.map(render)}
      {!compactRows && !scrollable && hiddenCount > 0 && <>
        <div id={moreId} className={`current-tasks-more${expanded ? ' is-open' : ''}`} inert={!expanded}>
          <div className="current-tasks-more-inner">{hidden.map(render)}</div>
        </div>
        <button type="button" className="button small current-tasks-toggle" aria-expanded={expanded} aria-controls={moreId} onClick={() => setExpanded((value) => !value)}>
          {expanded ? uiText('Свернуть') : moreLabel}<ChevronDown size={14} aria-hidden="true" />
        </button>
      </>}
      {deferredCount > 0 && <p className="muted current-tasks-deferred">{locale === 'en'
        ? `Deferred tasks not listed: ${deferredCount}. Bring them back with «Deferred quests» on the map.`
        : `Не показаны отложенные квесты: ${deferredCount}. Вернуть их — кнопка «Отложенные квесты» на карте.`}</p>}
    </div>
  </section>
}
