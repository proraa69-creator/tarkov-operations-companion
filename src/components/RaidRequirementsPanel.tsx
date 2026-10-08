import { Link } from 'react-router-dom'
import { PackageCheck } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { formatItemCountLabel } from '../shared/raidNeeds'

export interface RaidNeedRow {
  key: string
  name: string
  iconUrl?: string
  href: string
  count: number
  lines: Array<{ purpose: string; questNames: string[] }>
  /** Added from the flea market by hand, not by a task. */
  fromRaidListOnly: boolean
  /** Tooltip, e.g. the packs a merged «Любая пачка патронов» row accepts. */
  title?: string
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
        {rows.map((row) => <Link to={row.href} className="raid-need" key={row.key} title={row.title}>
          <img className="item-thumb" src={row.iconUrl} alt="" />
          <span className="raid-need-copy">
            <strong>{uiText(formatItemCountLabel(row.name, row.count))}</strong>
            {row.fromRaidListOnly
              ? <small>{uiText('Добавлено с барахолки')}</small>
              : row.lines.map((line) => <small key={line.purpose}>{uiText(PURPOSES[line.purpose] ?? line.purpose)}{uiText(line.questNames.length ? ` · ${line.questNames.join(', ')}` : '')}</small>)}
          </span>
        </Link>)}
      </div>}
      {!rows.length && <p className="muted">{uiText('Для текущих заданий на этой карте нет предметов, которые нужно взять с собой или заложить.')}</p>}
      {rows.length > 0 && <p className="muted raid-needs-note">{uiText('Только то, что нужно взять в рейд: заложить, пометить или открыть дверь. Предметы «найти и вынести» сюда не входят.')}</p>}
    </div>
  </section>
}
