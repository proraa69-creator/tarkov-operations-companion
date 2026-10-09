import { Link } from 'react-router-dom'
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
  lines: Array<{ purpose: string; questNames: string[] }>
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
 * instead of one long list that stretched the right column.
 */
export function RaidRequirementsPanel({ rows }: { rows: RaidNeedRow[] }) {
  return <section className="panel raid-needs">
    <div className="panel-header"><div className="panel-title">{uiText('Требования рейда')}</div><span className="tag"><PackageCheck size={11} /> {rows.length}</span></div>
    <div className="panel-body">
      {rows.length > 0 && <div className="raid-needs-grid">
        {rows.map((row) => <RaidNeed row={row} key={row.key} />)}
      </div>}
      {!rows.length && <p className="muted">{uiText('Для текущих заданий на этой карте нет предметов, которые нужно взять с собой или заложить.')}</p>}
      {rows.length > 0 && <p className="muted raid-needs-note">{uiText('Только то, что нужно взять в рейд: заложить, пометить или открыть дверь. Предметы «найти и вынести» сюда не входят.')}</p>}
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
  return <>
    <Link to={row.href} className={`raid-need${row.alternatives ? ' has-alternatives' : ''}`} {...anchorProps}>
      <img className="item-thumb" src={row.iconUrl} alt="" />
      <span className="raid-need-copy">
        <strong>{uiText(formatItemCountLabel(row.name, row.count))}{row.alternatives?.badge && <span className="tag raid-need-badge">{row.alternatives.badge}</span>}</strong>
        {row.fromRaidListOnly
          ? <small>{uiText('Добавлено с барахолки')}</small>
          : row.lines.map((line) => <small key={line.purpose}>{uiText(PURPOSES[line.purpose] ?? line.purpose)}{uiText(line.questNames.length ? ` · ${line.questNames.join(', ')}` : '')}</small>)}
      </span>
    </Link>
    {card}
  </>
}
