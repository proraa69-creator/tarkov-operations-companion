import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bug, Check, ChevronDown, Copy, Gift, ImageOff, Lightbulb, LoaderCircle, MapPin, RefreshCw, Users } from 'lucide-react'
import { ImageViewerBase } from '../components/ImageViewerBase'
import { REPORT_CATEGORY_LABELS, type ReportCategory } from '../shared/reportCategories'
import {
  REPORT_WORK_ACTIONS, REPORT_WORK_CLOSED, REPORT_WORK_LABELS, REPORT_WORK_WORKING, reportKindLabel,
  type ReportTableView, type ReportWorkAction, type ReportWorkStatus,
} from '../shared/reportWork'
import { copyText, reportClipboardText } from './reportClipboard'
import { isQuestPointIcon } from '../shared/questPointConstructor'
import { pointSuggestionLabel } from '../shared/pointSuggestion'
import './reportsTable.css'

/** A line of the table, as GET /v1/accounts/me/admin/bug-reports/table answers it (server/src/routes/bugReports.ts). */
export interface ReportRow {
  id: number
  kind: 'bug' | 'idea'
  topic: string
  description: string
  createdAt: string
  files: number
  matches?: number
  category?: string
  email?: string
  /** The Escape from Tarkov nickname, when the PC app has found it. */
  nickname?: string
  appVersion?: string
  platform?: string
  quest?: { questId?: string; issue?: string; mode?: string; mapId?: string; point?: { x: number; z: number; floor?: string }; pointNote?: string; questNote?: string }
  /** «Добавить точку»: the map point the player proposes, its place read from the game screenshot; `pointId` once accepted. */
  suggest?: { icon: string; name: string; mapId: string; x: number; y?: number; z: number; floor?: string; shot?: string; pointId?: string }
  triage?: { summary?: string; plan?: string; at?: string }
  work: { status: ReportWorkStatus; note?: string; commit?: string }
  /** Subscription days the owner gave for this report (0: none). */
  rewardDays?: number
}
export interface ReportPage<Row extends ReportRow = ReportRow> {
  rows: Row[]
  total: number
  /** `working`: absent from a server before «В процессе». */
  counts: { active: number; working?: number; closed: number; awaiting: number }
  agentSeenAt?: string
}

type Translate = (text: string) => string

interface ReportsTableProps<Row extends ReportRow> {
  /** null until the first answer. */
  page: ReportPage<Row> | null
  view: ReportTableView
  onView: (view: ReportTableView) => void
  /** The owner's buttons; a refusal of the server comes back as a rejected promise and is shown on the row. */
  onAct: (id: number, action: ReportWorkAction) => Promise<unknown>
  /**
   * Days of subscription to the report's author. Given, «Готово» first asks «Выдать 1 день?» (owner, 08.11.2026: «по нажатию
   * «Готово» у меня будет вылезать окно «Выдать 1 день», да, нет. Чтобы я не забывал»).
   */
  onReward?: (id: number, days: number) => Promise<unknown>
  /** «Принять точку»: the proposed point goes on the map, the report closes and its author gets the day (one press). */
  onAcceptPoint?: (id: number) => Promise<unknown>
  /** A report's picture by its index, as an address an image can show; a `blob:` one is released when the row goes. */
  loadImage?: (row: Row, index: number) => Promise<string>
  /** The app's dictionary (uiText); the site's panel is in Russian. */
  t?: Translate
  /** A report to show at once: from a notification. */
  focusId?: number | null
  loading?: boolean
  error?: string
  onRefresh?: () => void
  /** What else a report holds, in its row: answer, days, chat. */
  detail?: (row: Row, rows: Row[]) => ReactNode
  /** The same in a window of its own (the phone); takes the place of `detail`. */
  onOpen?: (row: Row) => void
  footer?: ReactNode
}

const same: Translate = (text) => text
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const format = (formatter: Intl.DateTimeFormat, iso: string) => { try { return formatter.format(new Date(iso)) } catch { return '' } }

const VIEWS: Array<{ id: ReportTableView; label: string; empty: string }> = [
  { id: 'active', label: 'Активные', empty: 'Активных отчётов и предложений нет.' },
  { id: 'working', label: 'В процессе', empty: 'Отчётов в процессе нет.' },
  { id: 'closed', label: 'Закрытые', empty: 'Закрытых отчётов и предложений нет.' },
]

/** A quest correction may have no description: its notes are its text. */
const textOf = (row: ReportRow) => row.description.trim() || [row.quest?.pointNote, row.quest?.questNote].filter(Boolean).join('\n')

/** What the owner can press on this status. */
function actionsOf(status: ReportWorkStatus) {
  const buttons: ReportWorkAction[] = REPORT_WORK_WORKING.includes(status) ? ['implemented', 'reopen'] : REPORT_WORK_CLOSED.includes(status) ? ['reopen'] : ['take', 'already', 'reject']
  return buttons.filter((action) => REPORT_WORK_ACTIONS[action].from.includes(status))
}

/**
 * «Отчёты» (owner, 05.11.2026): the one table of reports and ideas, the same on the site, in the owner app and on the phone. In a row:
 * the number and the time, the kind, the title with the screenshots right under it (a click opens them) and the text, who wrote it,
 * and the owner's buttons (owner: «не пишется ни почта, кто написал, ни ник… Скриншот тоже сразу должен показываться»). «Подробнее»
 * grows the same row (owner: «Оно не должно открываться ниже»). Three lists: «Активные», «В процессе» and «Закрытые». On a narrow
 * screen every row becomes a card (reportsTable.css).
 */
export function ReportsTable<Row extends ReportRow>({ page, view, onView, onAct, onReward, onAcceptPoint, loadImage, t = same, focusId, loading, error, onRefresh, detail, onOpen, footer }: ReportsTableProps<Row>) {
  const rows = page?.rows ?? []
  return (
    <div className="rt-wrap">
      <div className="rt-head">
        <div className="rt-views" role="group" aria-label={t('Какие отчёты показать')}>
          {VIEWS.map(({ id, label }) => (
            <button key={id} type="button" className={`button small ${view === id ? 'primary' : 'ghost'}`} aria-pressed={view === id} onClick={() => onView(id)}>
              {t(label)}{page ? <span className="rt-count"> · {page.counts[id] ?? 0}</span> : null}
            </button>
          ))}
        </div>
        {onRefresh && <button type="button" className="button small ghost rt-refresh" disabled={loading} aria-label={t('Обновить')} title={t('Обновить')} onClick={onRefresh}>{loading ? <LoaderCircle size={14} className="spin spinner" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}</button>}
      </div>
      {error && <p className="rt-error" role="alert">{t(error)}</p>}
      {!page && !error && <p className="rt-empty"><LoaderCircle size={14} className="spin spinner" aria-hidden="true" /> {t('Загружаем отчёты…')}</p>}
      {page && rows.length === 0 && <p className="rt-empty">{t(VIEWS.find(({ id }) => id === view)!.empty)}</p>}
      {rows.length > 0 && (
        <table className="rt-table">
          <colgroup><col className="rt-col-number" /><col className="rt-col-kind" /><col /><col className="rt-col-author" /><col className="rt-col-status" /></colgroup>
          <thead><tr><th scope="col">№</th><th scope="col">{t('Тип')}</th><th scope="col">{t('Отчёт')}</th><th scope="col">{t('Автор')}</th><th scope="col">{t('Статус')}</th></tr></thead>
          <tbody>
            {rows.map((row) => <ReportLine key={row.id} row={row} rows={rows} onAct={onAct} onReward={onReward} onAcceptPoint={onAcceptPoint} loadImage={loadImage} t={t} focused={focusId === row.id} detail={detail} onOpen={onOpen} />)}
          </tbody>
        </table>
      )}
      {footer}
    </div>
  )
}

function ReportLine<Row extends ReportRow>({ row, rows, onAct, onReward, onAcceptPoint, loadImage, t, focused, detail, onOpen }: {
  row: Row; rows: Row[]; onAct: ReportsTableProps<Row>['onAct']; onReward?: ReportsTableProps<Row>['onReward']; onAcceptPoint?: ReportsTableProps<Row>['onAcceptPoint']; loadImage: ReportsTableProps<Row>['loadImage']; t: Translate; focused: boolean
  detail?: ReportsTableProps<Row>['detail']; onOpen?: ReportsTableProps<Row>['onOpen']
}) {
  const status = row.work.status
  const [busy, setBusy] = useState<ReportWorkAction | 'point' | null>(null)
  const [failure, setFailure] = useState('')
  // A notification's report opens by itself; after that it is the owner's to close.
  const [open, setOpen] = useState(focused)
  const [copied, setCopied] = useState(false)
  const line = useRef<HTMLTableRowElement>(null)
  const text = textOf(row)
  const expandable = Boolean(detail || onOpen)
  const category = row.category ? REPORT_CATEGORY_LABELS[row.category as ReportCategory] ?? row.category : ''
  useEffect(() => {
    if (focused) line.current?.scrollIntoView?.({ block: 'center' })
  }, [focused])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const fail = (reason: unknown) => setFailure(reason instanceof Error && reason.message ? reason.message : 'Сервер недоступен')
  const copy = async () => {
    setFailure('')
    if (await copyText(reportClipboardText(row))) setCopied(true)
    else setFailure('Не удалось скопировать')
  }
  const act = async (action: ReportWorkAction) => {
    setBusy(action); setFailure('')
    try { await onAct(row.id, action) } catch (reason) { fail(reason) } finally { setBusy(null) }
  }
  const suggest = row.suggest
  const canAccept = Boolean(suggest && !suggest.pointId && onAcceptPoint && !REPORT_WORK_CLOSED.includes(status))
  const accept = async () => {
    setBusy('point'); setFailure('')
    try { await onAcceptPoint!(row.id) } catch (reason) { fail(reason) } finally { setBusy(null) }
  }
  // «Готово» with an author to reward: the window «Выдать 1 день?» first; «Да» closes the report and gives the day, «Нет» only closes it.
  const [asking, setAsking] = useState(false)
  const press = (action: ReportWorkAction) => {
    if (action === 'implemented' && onReward && row.email) setAsking(true)
    else void act(action)
  }
  const finish = async (give: boolean) => {
    setAsking(false); setBusy('implemented'); setFailure('')
    try {
      await onAct(row.id, 'implemented')
      if (give) await onReward!(row.id, 1)
    } catch (reason) { fail(reason) } finally { setBusy(null) }
  }

  return (
    <>
      <tr ref={line} className={`rt-row${focused ? ' is-focus' : ''}`}>
        <td className="rt-number" data-label="№"><strong>{row.id}</strong><small>{format(DATE_TIME, row.createdAt)}</small></td>
        <td className="rt-kind">
          <div className="rt-stack">
            <span className={`rt-kind-tag is-${row.kind}`}>{row.kind === 'idea' ? <Lightbulb size={12} aria-hidden="true" /> : <Bug size={12} aria-hidden="true" />}{t(reportKindLabel(row.kind))}</span>
            {category && <small className="rt-dim">{t(category)}</small>}
            {row.matches && row.matches > 1 ? <small className="rt-matches" title={t('Сколько игроков указали одно и то же')}><Users size={11} aria-hidden="true" />{row.matches}</small> : null}
          </div>
        </td>
        <td className="rt-main">
          <div className="rt-title">{row.topic}</div>
          {suggest && <div className={`rt-point${suggest.pointId ? ' is-placed' : ''}`}>
            <MapPin size={12} aria-hidden="true" />
            <span>{t(isQuestPointIcon(suggest.icon) ? pointSuggestionLabel(suggest.icon) : suggest.icon)} — {suggest.name}</span>
            <small className="rt-dim">{suggest.mapId} · x {Math.round(suggest.x)}, z {Math.round(suggest.z)}{suggest.floor ? ` · ${t(suggest.floor)}` : ''}</small>
            {suggest.pointId && <strong>{t('Точка принята')}</strong>}
          </div>}
          {row.files > 0 && loadImage && <ReportShots row={row} load={loadImage} t={t} />}
          <p className={`rt-text${open ? '' : ' is-folded'}`}>{text || <span className="rt-dim">—</span>}</p>
          {detail && !onOpen && open && <div className="rt-detail">{detail(row, rows)}</div>}
        </td>
        <td className="rt-author" data-label={t('Автор')}>
          <div className="rt-stack">
            {row.email ? <span className="rt-email">{row.email}</span> : <span className="rt-dim">{t('аккаунт удалён')}</span>}
            {row.nickname && <span className="rt-nickname">{row.nickname}</span>}
            {row.appVersion && <small className="rt-dim">{row.appVersion}</small>}
            {row.platform && <small className="rt-dim">{row.platform}</small>}
          </div>
        </td>
        <td className="rt-status-cell" data-label={t('Статус')}>
          <div className="rt-stack">
            {/* The list itself says «Активные» and «В процессе». */}
            {status !== 'review' && status !== 'taken' && <span className={`rt-status is-${status}`}>{t(REPORT_WORK_LABELS[status])}</span>}
            {row.work.note && <small className="rt-note">{row.work.note}</small>}
            {/* Owner, 09.11.2026: «пиши, выдавал ли я в этой заявке дни или нет… И сколько дней». */}
            {row.rewardDays ? <small className="rt-reward-given"><Gift size={11} aria-hidden="true" />{t('Выдано дней')}: {row.rewardDays}</small>
              : REPORT_WORK_CLOSED.includes(status) && row.email ? <small className="rt-dim">{t('Дни не выдавались')}</small> : null}
            {(actionsOf(status).length > 0 || canAccept) && (
              <div className="rt-actions">
                {canAccept && <button type="button" className="button small primary" disabled={busy !== null} onClick={() => void accept()}>
                  {busy === 'point' ? <LoaderCircle size={13} className="spin spinner" aria-hidden="true" /> : <MapPin size={13} aria-hidden="true" />}{t('Принять точку')}
                </button>}
                {actionsOf(status).map((action) => (
                  <button key={action} type="button" className={`button small ${action === 'take' || action === 'implemented' ? 'primary' : 'ghost'}`} disabled={busy !== null} onClick={() => press(action)}>
                    {busy === action && <LoaderCircle size={13} className="spin spinner" aria-hidden="true" />}{t(REPORT_WORK_ACTIONS[action].label)}
                  </button>
                ))}
              </div>
            )}
            {failure && <small className="rt-failure" role="alert">{t(failure)}</small>}
            <div className="rt-links">
              <button type="button" className="rt-link rt-more" title={t('Данные этого отчёта: почта, ник, система, версия, тема и текст')} onClick={() => void copy()}>
                {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{t(copied ? 'Скопировано' : 'Копировать')}
              </button>
              {expandable && <button type="button" className="rt-link rt-more" aria-expanded={onOpen ? undefined : open} onClick={() => (onOpen ? onOpen(row) : setOpen(!open))}>{t('Подробнее')}{!onOpen && <ChevronDown size={13} className={open ? 'is-flipped' : undefined} aria-hidden="true" />}</button>}
            </div>
          </div>
        </td>
      </tr>
      {asking && <RewardQuestion row={row} t={t} onAnswer={(give) => void finish(give)} onCancel={() => setAsking(false)} />}
    </>
  )
}

/**
 * A report's screenshots right under its title (owner, 05.11.2026: «И под ним сразу скриншот, который можно нажать и открыть»), read when
 * the row comes into view, so a long list asks the server only for what is seen. A click opens them full size.
 */
function ReportShots<Row extends ReportRow>({ row, load, t }: { row: Row; load: (row: Row, index: number) => Promise<string>; t: Translate }) {
  const box = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined')
  const [urls, setUrls] = useState<Record<number, string>>({})
  const [failed, setFailed] = useState<Record<number, boolean>>({})
  const [viewing, setViewing] = useState<number | null>(null)
  const latest = useRef({ row, load })
  useEffect(() => { latest.current = { row, load } })
  const id = row.id
  const count = row.files

  useEffect(() => {
    if (seen || !box.current) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setSeen(true) }, { rootMargin: '300px' })
    observer.observe(box.current)
    return () => observer.disconnect()
  }, [seen])
  useEffect(() => {
    if (!seen) return
    let alive = true
    const made: string[] = []
    const free = (url: string) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url) }
    for (let index = 0; index < count; index += 1) {
      Promise.resolve().then(() => latest.current.load(latest.current.row, index)).then(
        (url) => { if (alive) { made.push(url); setUrls((current) => ({ ...current, [index]: url })) } else free(url) },
        () => { if (alive) setFailed((current) => ({ ...current, [index]: true })) },
      )
    }
    return () => { alive = false; made.forEach(free) }
  }, [seen, id, count])

  const indexes = Array.from({ length: count }, (_, index) => index)
  const shown = indexes.filter((index) => urls[index])
  return (
    <div ref={box} className="rt-shots">
      {indexes.map((index) => (
        <button key={index} type="button" className="rt-shot" disabled={!urls[index]} onClick={() => setViewing(shown.indexOf(index))} aria-label={`${t('Открыть изображение')} ${index + 1}`} title={t(urls[index] ? 'Открыть во весь размер' : failed[index] ? 'Скриншот недоступен' : 'Загружаем скриншот…')}>
          {urls[index] ? <img src={urls[index]} alt={`${t('Скриншот')} ${index + 1}`} /> : failed[index] ? <ImageOff size={18} aria-hidden="true" /> : <LoaderCircle size={16} className="spin spinner" aria-hidden="true" />}
        </button>
      ))}
      {viewing !== null && viewing >= 0 && viewing < shown.length && <ImageViewerBase t={t} images={shown.map((index) => urls[index]!)} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

/** «Выдать 1 день?» — Да / Нет; Escape, the cross or a press beside the window: neither, the report stays as it was. */
function RewardQuestion({ row, t, onAnswer, onCancel }: { row: ReportRow; t: Translate; onAnswer: (give: boolean) => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return createPortal(<div className="registration-overlay rt-reward-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section className="panel registration-dialog rt-reward-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`rt-reward-${row.id}`} onMouseDown={(event) => event.stopPropagation()}>
      <span className="rt-reward-icon" aria-hidden="true"><Gift size={20} /></span>
      <h2 id={`rt-reward-${row.id}`}>{t('Выдать 1 день?')}</h2>
      <p className="rt-reward-what">№{row.id} · {row.topic}</p>
      <div className="rt-reward-buttons">
        <button type="button" className="button primary" autoFocus onClick={() => onAnswer(true)}>{t('Да')}</button>
        <button type="button" className="button ghost" onClick={() => onAnswer(false)}>{t('Нет')}</button>
      </div>
    </section>
  </div>, document.body)
}
