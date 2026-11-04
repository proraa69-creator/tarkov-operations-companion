import { Fragment, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { Bug, Check, ChevronDown, Copy, Lightbulb, LoaderCircle, Paperclip, RefreshCw, Users } from 'lucide-react'
import {
  REPORT_AGENT_SILENT_MS, REPORT_PLAN_EDITABLE, REPORT_TEXT_LIMITS, REPORT_WORK_ACTIONS, REPORT_WORK_LABELS, reportKindLabel,
  type ReportTableView, type ReportWorkAction, type ReportWorkStatus,
} from '../shared/reportWork'
import { copyText, reportClipboardText } from './reportClipboard'
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
  /** Not shown in the table: they go into «Копировать» (reportClipboard.ts). */
  email?: string
  appVersion?: string
  platform?: string
  quest?: { questId?: string; issue?: string; mode?: string; mapId?: string; point?: { x: number; z: number; floor?: string }; pointNote?: string; questNote?: string }
  triage?: { summary?: string; plan?: string; at?: string }
  work: { status: ReportWorkStatus; note?: string; commit?: string }
}
export interface ReportPage<Row extends ReportRow = ReportRow> {
  rows: Row[]
  total: number
  counts: { active: number; closed: number; awaiting: number }
  agentSeenAt?: string
}

type Translate = (text: string) => string

interface ReportsTableProps<Row extends ReportRow> {
  /** null until the first answer. */
  page: ReportPage<Row> | null
  view: ReportTableView
  onView: (view: ReportTableView) => void
  /** The owner's buttons; a refusal of the server comes back as a rejected promise and is shown on the row. */
  onAct: (id: number, action: ReportWorkAction, plan?: string) => Promise<unknown>
  onPlan: (id: number, plan: string) => Promise<unknown>
  /** The app's dictionary (uiText); the site's panel is in Russian. */
  t?: Translate
  /** A report to show at once: from a notification. */
  focusId?: number | null
  loading?: boolean
  error?: string
  onRefresh?: () => void
  /** What else a report holds, under its row: images, answer, days, chat. */
  detail?: (row: Row, rows: Row[]) => ReactNode
  /** The same in a window of its own (the phone); takes the place of `detail`. */
  onOpen?: (row: Row) => void
  footer?: ReactNode
}

const same: Translate = (text) => text
const DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const format = (formatter: Intl.DateTimeFormat, iso: string) => { try { return formatter.format(new Date(iso)) } catch { return '' } }
/** Longer than this is folded to a few lines. */
const FOLD_TEXT = 240
const ACTION_ORDER: ReportWorkAction[] = ['approve', 'reject', 'already', 'reopen']

/** A quest correction may have no description: its notes are its text. */
const textOf = (row: ReportRow) => row.description.trim() || [row.quest?.pointNote, row.quest?.questNote].filter(Boolean).join('\n')

/** Tall enough for the plan, so it reads without scrolling inside the box. */
const planRows = (plan: string) => Math.max(3, Math.min(10, plan.split(/\r?\n/).reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 44)), 0)))

/** What the owner can press on this status. Given away and not taken yet: only back to the check. */
function actionsOf(status: ReportWorkStatus) {
  return status === 'queued' ? (['reopen'] as ReportWorkAction[]) : ACTION_ORDER.filter((action) => REPORT_WORK_ACTIONS[action].from.includes(status))
}

/**
 * «Отчёты» (owner, 05.11.2026: «аккуратная, компактная, понятная таблица, без лишнего»): the one table of reports and ideas,
 * the same on the site, in the owner app and on the phone. A number, the kind, the title, the text, what Claude drew from
 * it and the plan, which the owner corrects right here, the status and his three buttons. System details are not shown:
 * they are for Claude's analysis. On a narrow screen every row becomes a card (reportsTable.css).
 */
export function ReportsTable<Row extends ReportRow>({ page, view, onView, onAct, onPlan, t = same, focusId, loading, error, onRefresh, detail, onOpen, footer }: ReportsTableProps<Row>) {
  const rows = page?.rows ?? []
  return (
    <div className="rt-wrap">
      <div className="rt-head">
        <div className="rt-views" role="group" aria-label={t('Какие отчёты показать')}>
          {(['active', 'closed'] as const).map((id) => (
            <button key={id} type="button" className={`button small ${view === id ? 'primary' : 'ghost'}`} aria-pressed={view === id} onClick={() => onView(id)}>
              {t(id === 'active' ? 'Активные' : 'Закрытые')}{page ? <span className="rt-count"> · {page.counts[id]}</span> : null}
            </button>
          ))}
        </div>
        {page && page.counts.awaiting > 0 && <span className="rt-awaiting">{t('Ждут проверки')}: {page.counts.awaiting}</span>}
        {page && <AgentLine seenAt={page.agentSeenAt} t={t} />}
        {onRefresh && <button type="button" className="button small ghost rt-refresh" disabled={loading} aria-label={t('Обновить')} title={t('Обновить')} onClick={onRefresh}>{loading ? <LoaderCircle size={14} className="spin spinner" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}</button>}
      </div>
      {error && <p className="rt-error" role="alert">{t(error)}</p>}
      {!page && !error && <p className="rt-empty"><LoaderCircle size={14} className="spin spinner" aria-hidden="true" /> {t('Загружаем отчёты…')}</p>}
      {page && rows.length === 0 && <p className="rt-empty">{t(view === 'active' ? 'Активных отчётов и предложений нет.' : 'Закрытых отчётов и предложений нет.')}</p>}
      {rows.length > 0 && (
        <table className="rt-table">
          <colgroup><col className="rt-col-number" /><col className="rt-col-kind" /><col className="rt-col-title" /><col /><col className="rt-col-plan" /><col className="rt-col-status" /></colgroup>
          <thead><tr><th scope="col">№</th><th scope="col">{t('Тип')}</th><th scope="col">{t('Заголовок')}</th><th scope="col">{t('Текст')}</th><th scope="col">{t('Вывод и план')}</th><th scope="col">{t('Статус')}</th></tr></thead>
          <tbody>
            {rows.map((row) => <ReportLine key={row.id} row={row} rows={rows} onAct={onAct} onPlan={onPlan} t={t} focused={focusId === row.id} detail={detail} onOpen={onOpen} />)}
          </tbody>
        </table>
      )}
      {footer}
    </div>
  )
}

/** Honest about the computer: Claude works only while it is on. */
function AgentLine({ seenAt, t }: { seenAt?: string; t: Translate }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const at = seenAt ? Date.parse(seenAt) : NaN
  if (Number.isFinite(at) && now - at < REPORT_AGENT_SILENT_MS) return <span className="rt-agent">{t('Claude проверял')}: {format(DATE_TIME, seenAt!)}</span>
  return <span className="rt-agent is-silent">{t('Claude сейчас не работает: компьютер выключен?')}{seenAt ? ` ${t('Последний раз')}: ${format(DATE_TIME, seenAt)}` : ''}</span>
}

function ReportLine<Row extends ReportRow>({ row, rows, onAct, onPlan, t, focused, detail, onOpen }: {
  row: Row; rows: Row[]; onAct: ReportsTableProps<Row>['onAct']; onPlan: ReportsTableProps<Row>['onPlan']; t: Translate; focused: boolean
  detail?: ReportsTableProps<Row>['detail']; onOpen?: ReportsTableProps<Row>['onOpen']
}) {
  const stored = row.triage?.plan ?? ''
  const status = row.work.status
  const editable = REPORT_PLAN_EDITABLE.includes(status)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReportWorkAction | null>(null)
  const [failure, setFailure] = useState('')
  const [wholeText, setWholeText] = useState(false)
  // A notification's report opens by itself; after that it is the owner's to close.
  const [open, setOpen] = useState(focused)
  const [copied, setCopied] = useState(false)
  const saving = useRef<Promise<unknown> | null>(null)
  const line = useRef<HTMLTableRowElement>(null)
  // The owner's words stay on screen until the server holds them.
  const plan = draft ?? stored
  const text = textOf(row)
  const expandable = Boolean(detail || onOpen)
  useEffect(() => {
    if (focused) line.current?.scrollIntoView?.({ block: 'center' })
  }, [focused])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const fail = (reason: unknown) => setFailure(reason instanceof Error && reason.message ? reason.message : 'Сервер недоступен')
  const save = (event: FocusEvent<HTMLTextAreaElement>) => {
    const words = event.currentTarget.value
    if (!words.trim() || words.trim() === stored) return
    setFailure('')
    const sent = onPlan(row.id, words).then(() => setDraft((current) => (current === words ? null : current)), fail)
    saving.current = sent
    void sent.finally(() => { if (saving.current === sent) saving.current = null })
  }
  const copy = async () => {
    setFailure('')
    if (await copyText(reportClipboardText(row))) setCopied(true)
    else setFailure('Не удалось скопировать')
  }
  const act = async (action: ReportWorkAction) => {
    setBusy(action); setFailure('')
    try {
      // The plan just saved on leaving the box goes first; «Отдать в работу» carries what is on the screen anyway.
      await saving.current
      await onAct(row.id, action, action === 'approve' ? plan : undefined)
      setDraft(null)
    } catch (reason) { fail(reason) } finally { setBusy(null) }
  }

  return (
    <Fragment>
      <tr ref={line} className={`rt-row${focused ? ' is-focus' : ''}`}>
        <td className="rt-number" data-label="№"><strong>{row.id}</strong><small>{format(DATE, row.createdAt)}</small></td>
        <td className="rt-kind">
          <div className="rt-stack">
            <span className={`rt-kind-tag is-${row.kind}`}>{row.kind === 'idea' ? <Lightbulb size={12} aria-hidden="true" /> : <Bug size={12} aria-hidden="true" />}{t(reportKindLabel(row.kind))}</span>
            {row.matches && row.matches > 1 ? <small className="rt-matches" title={t('Сколько игроков указали одно и то же')}><Users size={11} aria-hidden="true" />{row.matches}</small> : null}
          </div>
        </td>
        <td className="rt-title">{row.topic}</td>
        <td className="rt-text">
          <p className={wholeText ? undefined : 'is-folded'}>{text || <span className="rt-dim">—</span>}</p>
          <span className="rt-text-more">
            {text.length > FOLD_TEXT && <button type="button" className="rt-link" onClick={() => setWholeText(!wholeText)}>{t(wholeText ? 'Свернуть' : 'Показать всё')}</button>}
            {row.files > 0 && <small className="rt-files"><Paperclip size={11} aria-hidden="true" />{row.files}</small>}
          </span>
        </td>
        <td className="rt-plan" data-label={t('Вывод и план')}>
          <div className="rt-stack">
            {row.triage?.summary
              ? <p className="rt-summary">{row.triage.summary}</p>
              : status === 'review' && <p className="rt-waiting">{t('Разбор ещё не готов: Claude напишет его, когда компьютер включён.')}</p>}
            {editable
              ? <textarea className="input rt-plan-box" rows={planRows(plan)} maxLength={REPORT_TEXT_LIMITS.plan} value={plan} aria-label={t('План действий')} placeholder={t('План действий')} onChange={(event) => setDraft(event.target.value)} onBlur={save} />
              : plan && <p className="rt-plan-text">{plan}</p>}
          </div>
        </td>
        <td className="rt-status-cell" data-label={t('Статус')}>
          <div className="rt-stack">
          <span className={`rt-status is-${status}`}>{t(REPORT_WORK_LABELS[status])}</span>
          {status === 'queued' && <small className="rt-dim">{t('Claude возьмёт его, когда компьютер включён.')}</small>}
          {row.work.note && <small className="rt-note">{row.work.note}</small>}
          {actionsOf(status).length > 0 && (
            <div className="rt-actions">
              {actionsOf(status).map((action) => (
                <button key={action} type="button" className={`button small ${action === 'approve' ? 'primary' : 'ghost'}`} disabled={busy !== null || (action === 'approve' && !plan.trim())} title={action === 'approve' && !plan.trim() ? t('Сначала напишите план') : undefined} onClick={() => void act(action)}>
                  {busy === action && <LoaderCircle size={13} className="spin spinner" aria-hidden="true" />}{t(REPORT_WORK_ACTIONS[action].label)}
                </button>
              ))}
            </div>
          )}
          {failure && <small className="rt-failure" role="alert">{t(failure)}</small>}
          <div className="rt-links">
            <button type="button" className="rt-link rt-more" title={t('Данные этого отчёта для Claude: почта, Windows, Steam, версия, тема и текст')} onClick={() => void copy()}>
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{t(copied ? 'Скопировано' : 'Копировать')}
            </button>
            {expandable && <button type="button" className="rt-link rt-more" aria-expanded={onOpen ? undefined : open} onClick={() => (onOpen ? onOpen(row) : setOpen(!open))}>{t('Подробнее')}{!onOpen && <ChevronDown size={13} className={open ? 'is-flipped' : undefined} aria-hidden="true" />}</button>}
          </div>
          </div>
        </td>
      </tr>
      {detail && !onOpen && open && <tr className="rt-detail-row"><td colSpan={6}>{detail(row, rows)}</td></tr>}
    </Fragment>
  )
}
