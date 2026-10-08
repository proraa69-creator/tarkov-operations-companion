import { Link } from 'react-router-dom'
import { Check, ChevronDown, Circle } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import type { KappaCountSource, KappaQuestRow } from './kappaBreakdown'

const SOURCE_LABELS: Record<KappaCountSource, string> = {
  'eft-log': 'по логам', 'screen-scan': 'по экрану', manual: 'вручную', inferred: 'по цепочке',
}

/**
 * Third Overview stat card. The number counts tasks tarkov.dev marks `kappaRequired`, not Collector items, so the
 * label says so, and «Выполнено N из M» opens the list of those tasks (KappaBreakdownPanel below the cards).
 */
export function KappaStatCard({ completed, total, open, onToggle, controlsId }: { completed: number; total: number; open: boolean; onToggle: () => void; controlsId: string }) {
  return <div className="stat-card kappa-card">
    <Link className="button small kappa-items-button" to="/kappa-items">{uiText('Предметы')}</Link>
    <div className="stat-label">{uiText('Задания для Капы')}</div>
    <div className="stat-value">{completed}</div>
    <button type="button" className="stat-meta kappa-card-toggle" aria-expanded={open} aria-controls={controlsId} onClick={onToggle}>
      <span>{uiText(`Выполнено ${completed} из ${total}`)}</span>
      <span className="kappa-card-toggle-hint">{uiText(open ? 'Скрыть' : 'Список')}<ChevronDown size={12} aria-hidden="true" /></span>
    </button>
  </div>
}

/** The Kappa tasks with their state and where «done» came from (logs, screen, manual mark, or a later task of the chain). */
export function KappaBreakdownPanel({ id, open, rows, completed, total, onClose }: { id: string; open: boolean; rows: KappaQuestRow[]; completed: number; total: number; onClose: () => void }) {
  const { locale } = useLocale()
  const counted = rows.filter((row) => row.counted)
  const rest = rows.filter((row) => !row.counted)

  // «взято «Охота на крыс»»: the later task the engine used, and whether it is accepted or already done.
  const reason = (row: KappaQuestRow) => {
    if (!row.via) return null
    const name = uiText(row.via.name)
    const accepted = row.viaStatus === 'active'
    if (locale === 'en') return `${accepted ? 'accepted' : 'completed'} “${name}”`
    return `${accepted ? 'взято' : 'выполнено'} «${name}»`
  }
  const state = (row: KappaQuestRow) => row.source ? SOURCE_LABELS[row.source] : row.status === 'active' ? 'текущее' : row.status === 'failed' ? 'провалено' : 'не выполнено'

  const item = (row: KappaQuestRow) => <Link to={`/quests?filter=kappa&selected=${encodeURIComponent(row.quest.id)}`} className={`kappa-quest${row.counted ? ' is-counted' : ''}`} key={row.quest.id}>
    <span className="kappa-quest-mark" aria-hidden="true">{row.counted ? <Check size={13} /> : <Circle size={9} />}</span>
    <span className="kappa-quest-copy">
      <strong>{uiText(row.quest.name)}</strong>
      <small>{uiText(row.quest.trader)}{uiText(' · ур. ')}{row.quest.level}{row.via && <span className="kappa-quest-via"> · {reason(row)}</span>}</small>
    </span>
    <span className={`kappa-quest-state${row.source === 'inferred' ? ' tag brass' : row.counted ? ' tag green' : ''}`}>{uiText(state(row))}</span>
  </Link>

  return <div id={id} className={`kappa-breakdown${open ? ' is-open' : ''}`} inert={!open}>
    <div className="kappa-breakdown-inner">
      <section className="panel kappa-breakdown-panel" aria-label={uiText('Задания для Капы')}>
        <div className="panel-header">
          <div className="panel-title">{uiText('Задания для Капы')}</div>
          <div className="kappa-breakdown-actions">
            <span className="tag brass">{uiText(`Выполнено ${completed} из ${total}`)}</span>
            <button type="button" className="button small" onClick={onClose}>{uiText('Свернуть')}</button>
          </div>
        </div>
        <div className="panel-body">
          <p className="muted kappa-breakdown-note">{uiText('Это задания, которые tarkov.dev отмечает обязательными для Капы, а не предметы для «Коллекционера». Задание засчитано, если оно выполнено по логам игры, распознано с экрана, отмечено вручную или следует из цепочки: в игре взято или выполнено более позднее задание, которому оно нужно.')}</p>
          {counted.length > 0 && <>
            <div className="stat-label kappa-breakdown-group">{uiText('Засчитаны · ')}{counted.length}</div>
            <div className="kappa-breakdown-grid">{counted.map(item)}</div>
          </>}
          {rest.length > 0 && <>
            <div className="stat-label kappa-breakdown-group">{uiText('Не выполнены · ')}{rest.length}</div>
            <div className="kappa-breakdown-grid">{rest.map(item)}</div>
          </>}
          {!rows.length && <p className="muted">{uiText('В данных нет заданий, отмеченных для Капы.')}</p>}
        </div>
      </section>
    </div>
  </div>
}
