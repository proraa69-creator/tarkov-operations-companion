import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Check, Circle, Clock, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import type { CollectorTaskRow, CollectorTaskState } from './collectorKeyTasks'

const STATE_LABELS: Record<CollectorTaskState, string> = { completed: 'выполнено', active: 'текущее', open: 'не выполнено' }

/**
 * Third Overview stat card: how many of the four key tasks for «Коллекционер» are done (not Collector items), so the
 * label says so. «Квесты» opens what Fence wants for «Коллекционер» in a dialog (KappaBreakdownPanel below),
 * «Предметы» the Collector items page; the card itself keeps the plain layout of the other stat cards.
 */
export function KappaStatCard({ completed, total, open, onOpen, controlsId }: { completed: number; total: number; open: boolean; onOpen: () => void; controlsId: string }) {
  return <div className="stat-card kappa-card">
    <div className="kappa-card-actions">
      <button type="button" className="button small kappa-quests-button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? controlsId : undefined} onClick={onOpen}>{uiText('Квесты')}</button>
      <Link className="button small kappa-items-button" to="/kappa-items">{uiText('Предметы')}</Link>
    </div>
    <div className="stat-label">{uiText('Задания для Капы')}</div>
    <div className="stat-value">{completed}</div>
    <div className="stat-meta">{uiText(`Выполнено ${completed} из ${total}`)}</div>
  </div>
}

/**
 * What Fence wants before he hands out «Коллекционер»: loyalty 4 with the main traders, reputation +3.0 with him, and the
 * four key tasks with their state in this profile. Esc, «×» or a click outside closes it and gives the focus back to
 * «Квесты». Loyalty and reputation are not in the game logs, so those two lines are plain text.
 */
export function KappaBreakdownPanel({ id, open, rows, completed, total, onClose }: { id: string; open: boolean; rows: CollectorTaskRow[]; completed: number; total: number; onClose: () => void }) {
  const { locale } = useLocale()
  const quoted = (name: string) => locale === 'en' ? `“${uiText(name)}”` : `«${uiText(name)}»`
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeLatest = useRef(onClose)
  useEffect(() => { closeLatest.current = onClose })
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeLatest.current() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus() }
  }, [open])
  if (!open) return null

  const task = (row: CollectorTaskRow) => {
    const content = <>
      <span className="kappa-quest-mark" aria-hidden="true">{row.state === 'completed' ? <Check size={13} /> : row.state === 'active' ? <Clock size={11} /> : <Circle size={9} />}</span>
      <span className="kappa-quest-copy">
        <strong>{uiText(row.name)}</strong>
        <small>{uiText(row.trader)}{row.alternatives.length > 0 && <>{uiText(' · или ')}{row.alternatives.map((quest, index) => <span key={quest.id}>{index > 0 && ', '}{quoted(quest.name)} ({uiText(quest.trader)})</span>)}</>}</small>
      </span>
      <span className={`kappa-quest-state${row.state === 'completed' ? ' tag green' : row.state === 'active' ? ' tag brass' : ''}`}>{uiText(STATE_LABELS[row.state])}</span>
    </>
    const className = `kappa-quest${row.state === 'completed' ? ' is-counted' : ''}`
    return <li key={row.key}>{row.quest
      ? <Link to={`/quests?selected=${encodeURIComponent(row.quest.id)}`} className={className}>{content}</Link>
      : <div className={className}>{content}</div>}</li>
  }

  return createPortal(<div className="registration-overlay kappa-breakdown-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section id={id} className="panel kappa-breakdown-panel" role="dialog" aria-modal="true" aria-label={uiText('Задания для Капы')}>
      <div className="panel-header">
        <div className="panel-title">{uiText('Задания для Капы')}</div>
        <div className="kappa-breakdown-actions">
          <span className="tag brass">{uiText(`Выполнено ${completed} из ${total}`)}</span>
          <button ref={closeRef} type="button" className="icon-button kappa-breakdown-close" aria-label={uiText('Закрыть')} title={uiText('Закрыть')} onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className="panel-body">
        <p className="kappa-conditions-lead">{uiText('Скупщик выдаёт «Коллекционера», когда выполнены три условия:')}</p>
        <ol className="kappa-conditions">
          <li><strong>{uiText('Лояльность 4 (корона)')}</strong> <span>{uiText('у Прапора, Терапевта, Лыжника, Миротворца, Механика, Барахольщика и Егеря')}</span></li>
          <li><strong>{uiText('Репутация у Скупщика от +3,0')}</strong> <span>{uiText('(карма Дикого)')}</span></li>
          <li><strong>{uiText('4 ключевых задания')}</strong>
            <ul className="kappa-breakdown-grid">{rows.map(task)}</ul>
          </li>
        </ol>
      </div>
    </section>
  </div>, document.body)
}
