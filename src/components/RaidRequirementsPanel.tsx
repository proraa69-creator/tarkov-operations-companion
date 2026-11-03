import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useBlockTitle } from '../overview/blockTitle'
import { PackageCheck } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { formatItemCountLabel } from '../shared/raidNeeds'
import { useHoverCard } from './useHoverCard'

export interface RaidNeedRow {
  key: string
  name: string
  iconUrl?: string
  href: string
  count: number
  /** One line per purpose; `quests`: how many each quest takes and where its line under the total opens. */
  lines: Array<{ purpose: string; questNames: string[]; quests?: Array<{ id: string; name: string; count: number; href?: string }> }>
  /** Added from the flea market by hand, not by a task. */
  fromRaidListOnly: boolean
  /** The other items the row's objective accepts, shown in its hover card (any 7.62x51 pack, the other ELCAN colour). */
  alternatives?: { title: string; items: Array<{ id: string; name: string; iconUrl?: string }>; badge?: string }
}

const PURPOSES: Record<string, string> = {
  place: 'Взять и заложить', mark: 'Взять для маркировки', key: 'Взять ключ', bring: 'Взять с собой', handover: 'Передать торговцу', find: 'Найти в рейде',
}

/**
 * «Требования рейда» across the left column of the Overview: items in a grid of as many columns as fit,
 * instead of one long list that stretched the right column. `deferredQuests`: the quests of this map put aside in
 * «Отложенные квесты», whose items are not counted.
 */
export function RaidRequirementsPanel({ rows, deferredQuests = [] }: { rows: RaidNeedRow[]; deferredQuests?: string[] }) {
  const title = useBlockTitle('Требования рейда')
  return <section className="panel raid-needs">
    <div className="panel-header"><div className="panel-title">{title}</div><span className="tag"><PackageCheck size={11} /> {rows.length}</span></div>
    <div className="panel-body">
      {rows.length > 0 && <div className="raid-needs-grid">
        {rows.map((row) => <RaidNeed row={row} key={row.key} />)}
      </div>}
      {!rows.length && <p className="muted">{uiText('Для текущих заданий на этой карте нет предметов, которые нужно взять с собой или заложить.')}</p>}
      {rows.length > 0 && <p className="muted raid-needs-note">{uiText('Только ключи и предметы, которые нужно заложить или пометить. Оружие и снаряжение квестов — в «Сбор на рейд».')}</p>}
      {deferredQuests.length > 0 && <p className="muted raid-needs-note raid-needs-deferred">{uiText('Не учтены отложенные квесты:')} {deferredQuests.map((name) => uiText(name)).join(', ')}</p>}
    </div>
  </section>
}

function RaidNeed({ row }: { row: RaidNeedRow }) {
  const { anchorProps, card } = useHoverCard(row.alternatives && <>
    <p className="hover-card-title">{uiText(row.alternatives.title)}</p>
    <ul className="hover-card-items">
      {row.alternatives.items.map((item) => <li key={item.id}><img src={item.iconUrl} alt="" /><span>{uiText(item.name)}</span></li>)}
    </ul>
  </>)
  // Two quests or more: each one's count under the total, opening that quest at its point (bug report №30: «показывал
  // что нужно допустим 4 камеры на 1 квест, и 3 камеры на 2 квест, а то он все эти камеры миксует в одно»).
  const split = new Set(row.lines.flatMap((line) => line.quests?.map((quest) => quest.id) ?? [])).size > 1
  // The item's link covers the whole card (.raid-need-link::after); the quests' lines sit above it.
  return <>
    <div className={`raid-need${row.alternatives ? ' has-alternatives' : ''}`} {...anchorProps}>
      <img className="item-thumb" src={row.iconUrl} alt="" />
      <span className="raid-need-copy">
        <Link to={row.href} className="raid-need-link"><strong>{uiText(formatItemCountLabel(row.name, row.count))}{row.alternatives?.badge && <span className="tag raid-need-badge">{row.alternatives.badge}</span>}</strong></Link>
        {row.fromRaidListOnly
          ? <small>{uiText('Добавлено с барахолки')}</small>
          : row.lines.map((line) => (split && line.quests?.length
            ? <Fragment key={line.purpose}>
              <small>{uiText(PURPOSES[line.purpose] ?? line.purpose)}</small>
              {line.quests.map((quest) => <Link key={quest.id} to={quest.href ?? row.href} className="raid-need-quest"><b>{quest.count}</b> — {uiText(quest.name)}</Link>)}
            </Fragment>
            : <small key={line.purpose}>{uiText(PURPOSES[line.purpose] ?? line.purpose)}{uiText(line.questNames.length ? ` · ${line.questNames.join(', ')}` : '')}</small>))}
      </span>
    </div>
    {card}
  </>
}
