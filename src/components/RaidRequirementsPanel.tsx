import { Fragment, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useBlockTitle } from '../overview/blockTitle'
import { PackageCheck } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { formatItemCountLabel } from '../shared/raidNeeds'
import { useHoverCard } from './useHoverCard'
import { ThumbScroll } from './ThumbScroll'
import type { DeferMenuState } from './QuestDeferDialog'
import { TakenCheck, useItemTaken, useTakenItemsMarks } from '../overview/TakenItems'

export interface RaidNeedRow {
  key: string
  name: string
  iconUrl?: string
  /** The catalog item the row stands for (the cheapest of «any of»): where it opens for «Отложить квест» → «До уровня». */
  itemId?: string
  href: string
  count: number
  /** One line per purpose; `quests`: how many each quest takes and where its line under the total opens. */
  lines: Array<{ purpose: string; questNames: string[]; shared?: boolean; quests?: Array<{ id: string; name: string; count: number; href?: string }> }>
  /** Added from the flea market by hand, not by a task. */
  fromRaidListOnly: boolean
  /** The other items the row's objective accepts, shown in its hover card (any 7.62x51 pack, the other ELCAN colour). */
  /** `turn`: either key opens the door — the picture and the name take turns every few seconds (report №90). */
  alternatives?: { title: string; items: Array<{ id: string; name: string; iconUrl?: string }>; badge?: string; turn?: boolean }
  /** A key: the player has it («Есть в схроне») or not («Нет в наличии»); none before any key is found or added. */
  stock?: 'owned' | 'missing'
}

/** How long each key of «either key» stays on its card (owner, 07.11.2026: «каждые 3 секунды менялась картинка, тот и тот ключ»). */
export const KEY_TURN_MS = 3_000

/** Which of a row's items shows now: the row's own (0), then each alternative in turn; never with reduced motion. */
function useTurn(count: number, on: boolean) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!on || count < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), KEY_TURN_MS)
    return () => window.clearInterval(timer)
  }, [count, on])
  return on && count > 1 ? index % count : 0
}

const PURPOSES: Record<string, string> = {
  place: 'Взять и заложить', mark: 'Взять для маркировки', key: 'Взять ключ', bring: 'Взять с собой', handover: 'Передать торговцу', find: 'Найти в рейде', signal: 'Подать сигнал', use: 'Использовать в рейде',
}

/**
 * «Требования рейда» across the left column of the Overview: items in a grid of as many columns as fit,
 * instead of one long list that stretched the right column. `deferredQuests`: the quests of this map put aside in
 * «Отложенные квесты», whose items are not counted, with the term they come back at. `onDefer`: a right click on an item
 * of a quest — «Отложить квест» (components/QuestDeferDialog.tsx).
 */
export function RaidRequirementsPanel({ rows, deferredQuests = [], onDefer, compactRows }: { rows: RaidNeedRow[]; deferredQuests?: Array<{ name: string; term?: string }>; onDefer?: (menu: DeferMenuState) => void; compactRows?: number }) {
  const title = useBlockTitle('Требования рейда')
  // The phone (owner, 11.11.2026: «два ряда по два предмета… справа будет ползунок»): two columns, `compactRows` rows in sight.
  return <section className={`panel raid-needs${compactRows ? ' is-compact' : ''}`}>
    <div className="panel-header"><div className="panel-title">{title}</div><span className="tag"><PackageCheck size={11} /> {rows.length}</span></div>
    <div className="panel-body">
      {rows.length > 0 && <ThumbScroll rows={compactRows}><div className="raid-needs-grid">
        {rows.map((row) => <RaidNeed row={row} key={row.key} onDefer={onDefer} compact={Boolean(compactRows)} />)}
      </div></ThumbScroll>}
      {!rows.length && <p className="muted">{uiText('Для текущих заданий на этой карте нет предметов, которые нужно взять с собой или заложить.')}</p>}
      {rows.length > 0 && <p className="muted raid-needs-note">{uiText('Только ключи, сигналы и предметы, которые нужно заложить или пометить. Оружие и снаряжение квестов — в «Сбор на рейд».')}</p>}
      {deferredQuests.length > 0 && <p className="muted raid-needs-note raid-needs-deferred">{uiText('Не учтены отложенные квесты:')} {deferredQuests.map(({ name, term }) => `${uiText(name)}${term ? ` (${term})` : ''}`).join(', ')}</p>}
    </div>
  </section>
}

/** The quests of a row, each once, with how many it takes. */
function rowQuests(row: RaidNeedRow) {
  const quests = new Map<string, { id: string; name: string; count: number }>()
  for (const quest of row.lines.flatMap((line) => line.quests ?? [])) {
    const known = quests.get(quest.id)
    quests.set(quest.id, { id: quest.id, name: quest.name, count: (known?.count ?? 0) + quest.count })
  }
  return [...quests.values()]
}

function RaidNeed({ row, onDefer, compact = false }: { row: RaidNeedRow; onDefer?: (menu: DeferMenuState) => void; compact?: boolean }) {
  // «Either key»: the key on the card now, the others in its hover card.
  const shownItems = [{ id: row.itemId ?? row.key, name: row.name, iconUrl: row.iconUrl }, ...(row.alternatives?.turn ? row.alternatives.items : [])]
  const turn = useTurn(shownItems.length, Boolean(row.alternatives?.turn))
  const shown = shownItems[turn] ?? shownItems[0]
  const others = row.alternatives?.turn ? shownItems.filter((_, index) => index !== turn) : row.alternatives?.items ?? []
  const { anchorProps, card } = useHoverCard(row.alternatives && <>
    <p className="hover-card-title">{uiText(row.alternatives.title)}</p>
    <ul className="hover-card-items">
      {others.map((item) => <li key={item.id}><img src={item.iconUrl} alt="" /><span>{uiText(item.name)}</span></li>)}
    </ul>
  </>)
  // Two quests or more: each one's count under the total, opening that quest at its point (bug report №30: «показывал
  // что нужно допустим 4 камеры на 1 квест, и 3 камеры на 2 квест, а то он все эти камеры миксует в одно»).
  // compact: the quests in one line after the purpose, never a line each
  const split = !compact && new Set(row.lines.flatMap((line) => line.quests?.map((quest) => quest.id) ?? [])).size > 1
  const quests = rowQuests(row)
  // A right click puts its quests aside (owner, 03.11.2026: «нажать на любой предмет ПКМ и отложить квест не открывая и не
  // запоминая каждый квест»); on a quest's line, that quest is the one ticked. Not for an item added by hand, nor while a
  // held finger shows the hover card (its handler cancels the event then).
  const holdMenu = 'onContextMenu' in anchorProps ? anchorProps.onContextMenu : undefined
  // «Взял» (report 157) is offered on every item, an item added by hand too.
  const marks = useTakenItemsMarks()
  const taken = useItemTaken(row.itemId)
  const openMenu = onDefer && (quests.length || (marks && row.itemId)) ? (event: ReactMouseEvent<HTMLDivElement>) => {
    holdMenu?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    const line = (event.target as Element).closest?.('[data-quest-id]')?.getAttribute('data-quest-id')
    onDefer({
      x: event.clientX, y: event.clientY,
      request: { item: row.itemId ? { id: row.itemId, name: row.name, iconUrl: row.iconUrl } : undefined, quests, ...(line ? { chosen: [line] } : {}) },
    })
  } : holdMenu
  // The item's link covers the whole card (.raid-need-link::after); the quests' lines sit above it.
  return <>
    <div className={`raid-need${row.alternatives ? ' has-alternatives' : ''}${taken ? ' is-taken' : ''}`} {...anchorProps} onContextMenu={openMenu}>
      {taken && <TakenCheck />}
      <img className={`item-thumb${row.alternatives?.turn ? ' raid-need-turn' : ''}`} key={turn} src={shown.iconUrl} alt="" />
      <span className="raid-need-copy">
        <Link to={row.href} className="raid-need-link"><strong>{uiText(formatItemCountLabel(shown.name, row.count))}{row.alternatives?.badge && <span className="tag raid-need-badge">{row.alternatives.badge}</span>}</strong></Link>
        {row.stock && <small className={`raid-need-stock is-${row.stock}`}>{uiText(row.stock === 'owned' ? 'Есть в схроне' : 'Нет в наличии')}</small>}
        {row.fromRaidListOnly
          ? <small>{uiText('Добавлено с барахолки')}</small>
          : row.lines.map((line) => (split && line.quests?.length
            ? <Fragment key={line.purpose}>
              <small>{uiText(PURPOSES[line.purpose] ?? line.purpose)}</small>
              {line.quests.map((quest) => <Link key={quest.id} to={quest.href ?? row.href} className="raid-need-quest" data-quest-id={quest.id}>{!line.shared && <><b>{quest.count}</b> — </>}{uiText(quest.name)}</Link>)}
            </Fragment>
            : <small key={line.purpose}>{uiText(PURPOSES[line.purpose] ?? line.purpose)}{uiText(line.questNames.length ? ` · ${line.questNames.join(', ')}` : '')}</small>))}
      </span>
    </div>
    {card}
  </>
}
