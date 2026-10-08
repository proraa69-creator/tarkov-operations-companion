import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Check, Circle, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import type { KappaCountSource, KappaQuestRow } from './kappaBreakdown'

const SOURCE_LABELS: Record<KappaCountSource, string> = {
  'eft-log': 'по логам', 'screen-scan': 'по экрану', manual: 'вручную', inferred: 'по цепочке',
}

/**
 * Third Overview stat card. The number counts tasks tarkov.dev marks `kappaRequired`, not Collector items, so the
 * label says so. «Квесты» opens the list of those tasks in a dialog (KappaBreakdownPanel below), «Предметы» the
 * Collector items page; the card itself keeps the plain layout of the other stat cards.
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
 * The Kappa tasks with their state and where «done» came from (logs, screen, manual mark, or a later task of the chain),
 * in a dialog over the Overview: Esc, «×» or a click outside closes it and gives the focus back to «Квесты».
 */
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
  </div>, document.body)
}
