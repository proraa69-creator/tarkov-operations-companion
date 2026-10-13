import { Bug, CalendarPlus, ChevronDown, Lightbulb, LoaderCircle, Mail, RefreshCw, RotateCcw, CheckCheck } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { Pager } from './AdminPayments'
import { dateTime, failure, numberFormat, useAdminData, type Failure } from './adminData'
import { bugReportsApi, type BugReportFile, type BugReportStatus, type ReportKind } from './bugReportsApi'

const PAGE = 50

const FILTERS: Array<{ id: BugReportStatus; label: string }> = [
  { id: 'open', label: 'Открытые' },
  { id: 'closed', label: 'Закрытые' },
]

/** «Ошибки» / «Предложения» (owner, 13.10.2026: «Ваши предложения» in the app sends ideas with photos). */
const KINDS: Array<{ id: ReportKind; label: string }> = [
  { id: 'bug', label: 'Ошибки' },
  { id: 'idea', label: 'Предложения' },
]

/** The panel's words for each kind. */
const WORDS = {
  bug: {
    hint: 'Отчёты из приложения: кнопка «Сообщить об ошибке» («Нашёл баг или ошибку? +1 день»). Каждый отчёт приходит PDF-файлом на почту. Проверьте отчёт и выдайте дни в подробностях.',
    loading: 'Загружаем отчёты…', noneOpen: 'Открытых отчётов нет.', noneClosed: 'Закрытых отчётов нет.',
    files: 'Скриншоты', file: 'Скриншот', rewarded: 'Выдано за отчёт', daysFor: 'Дней за отчёт', forIt: 'за отчёт',
  },
  idea: {
    hint: 'Предложения из приложения: кнопка «Ваши предложения» (идея и до 5 фото). Каждое приходит PDF-файлом на почту. За полезную идею можно выдать дни в подробностях.',
    loading: 'Загружаем предложения…', noneOpen: 'Открытых предложений нет.', noneClosed: 'Закрытых предложений нет.',
    files: 'Фото', file: 'Фото', rewarded: 'Выдано за предложение', daysFor: 'Дней за предложение', forIt: 'за предложение',
  },
} satisfies Record<ReportKind, Record<string, string>>

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`)

/**
 * «Отчёты» (owner, 11.10.2026): bug reports sent from the app («Сообщить об ошибке», «Нашёл баг или ошибку? +1 день»),
 * open first, with the reporter's e-mail. A row opens the description and screenshots; after checking it the owner grants
 * the reporter days of subscription right there (default 1). Each report also comes to the owner's mailbox as a PDF.
 * «Предложения» (owner, 13.10.2026): the ideas from «Ваши предложения», the same way.
 */
export function AdminBugReports() {
  const [kind, setKind] = useState<ReportKind>('bug')
  const [status, setStatus] = useState<BugReportStatus>('open')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const list = useAdminData(useCallback((token: string) => bugReportsApi.list(token, status, PAGE, page * PAGE, kind), [status, page, kind]))
  const data = list.data
  const words = WORDS[kind]

  return (
    <div className="admin-stack">
      <div className="admin-section-head">
        <div className="admin-chips">
          <div role="group" aria-label="Тип отчёта" className="admin-chips">
            {KINDS.map(({ id, label }) => {
              const count = data?.kinds?.[id]
              return (
                <button key={id} type="button" aria-pressed={kind === id} className={`button small ${kind === id ? 'primary' : 'ghost'}`} onClick={() => { setKind(id); setStatus('open'); setPage(0); setOpen(null) }}>
                  {id === 'idea' ? <Lightbulb aria-hidden="true" /> : <Bug aria-hidden="true" />}{label}{count ? <span className="mono" title="Открытые"> · {numberFormat.format(count)}</span> : null}
                </button>
              )
            })}
          </div>
          <div role="group" aria-label="Статус отчёта" className="admin-chips">
            {FILTERS.map(({ id, label }) => {
              const count = data?.counts[id]
              return (
                <button key={id} type="button" aria-pressed={status === id} className={`button small ${status === id ? 'primary' : 'ghost'}`} onClick={() => { setStatus(id); setPage(0); setOpen(null) }}>
                  {label}{count !== undefined ? <span className="mono"> · {numberFormat.format(count)}</span> : null}
                </button>
              )
            })}
          </div>
        </div>
        <button type="button" className="button ghost small" disabled={list.loading} onClick={() => void list.refresh()}>
          {list.loading ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Обновить
        </button>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {words.hint} E-mail — адрес аккаунта на момент отправки; у удалённых аккаунтов его нет.
      </p>
      {list.error && <Notice tone={list.error.offline ? 'offline' : 'error'}>{list.error.message}</Notice>}
      {!data && !list.error && <Loading text={words.loading} />}
      {data && data.reports.length === 0 && <div className="muted admin-empty">{status === 'open' ? words.noneOpen : words.noneClosed}</div>}
      {data && data.reports.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table admin-bug-table">
            <thead>
              <tr>
                <th scope="col">Дата</th><th scope="col">E-mail</th><th scope="col">Тема</th><th scope="col">Версия</th>
                <th scope="col" className="num">{words.files}</th><th scope="col">Награда</th><th scope="col"><span className="visually-hidden">Подробнее</span></th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((report) => {
                const expanded = open === report.id
                return (
                  <Fragment key={report.id}>
                    <tr className={expanded ? 'is-open' : undefined}>
                      <td className="mono">{dateTime.format(new Date(report.createdAt))}</td>
                      <td className="admin-email">{report.email ?? <span className="dim">аккаунт удалён</span>}</td>
                      <th scope="row" className="admin-wrap">{report.topic}</th>
                      <td className="mono">{report.appVersion || '—'}</td>
                      <td className="num mono">{report.files || '—'}</td>
                      <td>{report.rewardDays ? <span className="tag green admin-mini">+{report.rewardDays} дн.</span> : <span className="dim">—</span>}</td>
                      <td className="admin-row-action">
                        <button type="button" className="button ghost small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : report.id)}>
                          <ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />{expanded ? 'Скрыть' : 'Открыть'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="owner-detail">
                        <td colSpan={7}><BugReportDetails id={report.id} onChange={() => { setOpen(null); void list.reload() }} onUpdate={() => void list.reload()} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} size={PAGE} onPage={(next) => { setPage(next); setOpen(null) }} />}
    </div>
  )
}

function BugReportDetails({ id, onChange, onUpdate }: { id: number; onChange: () => void; onUpdate: () => void }) {
  const detail = useAdminData(useCallback((token: string) => bugReportsApi.get(token, id), [id]))
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<Failure | null>(null)
  const [days, setDays] = useState('1')
  const [done, setDone] = useState('')
  const report = detail.data?.report
  const words = WORDS[report?.kind === 'idea' ? 'idea' : 'bug']

  /** Grants the reporter days of subscription (owner, 11.10.2026: «+1 день я буду выдавать сам»). */
  async function reward() {
    const n = Number(days)
    if (!detail.token || !report) return
    if (!Number.isInteger(n) || n < 1 || n > 365) { setActionError({ message: 'Число дней: от 1 до 365.', offline: false }); return }
    if (!window.confirm(`Выдать ${n} дн. подписки ${report.email ?? 'отправителю'} ${words.forIt} №${report.id}?`)) return
    setBusy(true); setActionError(null); setDone('')
    try {
      const result = await bugReportsApi.reward(detail.token, id, n)
      detail.setData(result)
      setDone(`Выдано +${n} дн. ${result.report.email ?? ''}`.trim())
      onUpdate()
    } catch (reason) {
      setActionError(failure(reason))
    } finally {
      setBusy(false)
    }
  }

  async function mail() {
    if (!detail.token) return
    setBusy(true); setActionError(null); setDone('')
    try {
      const result = await bugReportsApi.mail(detail.token, id)
      detail.setData(result)
      setDone(result.report.mailError ? '' : 'PDF отправлен на почту')
      if (result.report.mailError) setActionError({ message: result.report.mailError, offline: false })
    } catch (reason) {
      setActionError(failure(reason))
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(next: BugReportStatus) {
    if (!detail.token) return
    setBusy(true)
    setActionError(null)
    try {
      await bugReportsApi.setStatus(detail.token, id, next)
      onChange()
    } catch (reason) {
      setActionError(failure(reason))
      setBusy(false)
    }
  }

  if (!report) return detail.error ? <Notice tone={detail.error.offline ? 'offline' : 'error'}>{detail.error.message}</Notice> : <Loading />
  return (
    <div className="admin-bug-detail">
      <dl className="admin-facts">
        <div><dt>Статус</dt><dd><span className={`tag ${report.status === 'open' ? 'brass' : 'green'}`}>{report.status === 'open' ? 'Открыт' : 'Закрыт'}</span>{report.closedAt ? <span className="dim mono"> · {dateTime.format(new Date(report.closedAt))}</span> : null}</dd></div>
        <div><dt>Версия приложения</dt><dd className="mono">{report.appVersion || '—'}</dd></div>
        <div><dt>Система</dt><dd className="mono">{report.platform || '—'}</dd></div>
        <div><dt>E-mail</dt><dd>{report.email ?? <span className="dim">аккаунт удалён</span>}</dd></div>
        <div><dt>{words.rewarded}</dt><dd>{report.rewardDays ? <><span className="tag green">+{report.rewardDays} дн.</span>{report.rewardedAt ? <span className="dim mono"> · {dateTime.format(new Date(report.rewardedAt))}</span> : null}</> : <span className="dim">ещё нет</span>}</dd></div>
        <div><dt>PDF на почту</dt><dd>{report.mailedAt ? <span className="mono">{dateTime.format(new Date(report.mailedAt))}</span> : report.mailError ? <span className="admin-danger-text">{report.mailError}</span> : <span className="dim">ещё не отправлен</span>}</dd></div>
      </dl>
      <div>
        <div className="field-label">Описание</div>
        <p className="admin-bug-text">{report.description}</p>
      </div>
      {report.files.length > 0 && (
        <div>
          <div className="field-label">{words.files} · {report.files.length}</div>
          <ul className="admin-bug-shots">
            {report.files.map((file) => <Screenshot key={file.idx} reportId={report.id} file={file} label={`${words.file} ${file.idx + 1}`} />)}
          </ul>
        </div>
      )}
      {actionError && <Notice tone={actionError.offline ? 'offline' : 'error'}>{actionError.message}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      <div className="admin-bug-actions">
        {report.accountId
          ? <div className="inline-form admin-bug-reward">
            <input className="input mono admin-days" inputMode="numeric" aria-label={words.daysFor} value={days} disabled={busy} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
            <button type="button" className="button primary small" disabled={busy} onClick={() => void reward()}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}Выдать +{Number(days) || 1} дн.</button>
          </div>
          : <span className="field-hint">Аккаунт отправителя удалён: выдать дни некому.</span>}
        <button type="button" className="button ghost small" disabled={busy} onClick={() => void mail()}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Mail aria-hidden="true" />}{report.mailedAt ? 'Отправить PDF ещё раз' : 'Отправить PDF на почту'}</button>
        {report.status === 'open'
          ? <button type="button" className="button primary small" disabled={busy} onClick={() => void setStatus('closed')}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}Закрыть</button>
          : <button type="button" className="button ghost small" disabled={busy} onClick={() => void setStatus('open')}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}Открыть снова</button>}
      </div>
    </div>
  )
}

/** One screenshot or photo: fetched with the owner's token as a blob → object URL (revoked when the row closes). */
function Screenshot({ reportId, file, label }: { reportId: number; file: BugReportFile; label: string }) {
  const { token } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!token) return
    let active = true
    let objectUrl: string | null = null
    bugReportsApi.file(token, reportId, file.idx).then((blob) => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }, () => { if (active) setError(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [token, reportId, file.idx])
  return (
    <li>
      {url
        ? <a href={url} target="_blank" rel="noopener noreferrer" title="Открыть в полном размере"><img src={url} alt={label} /></a>
        : <div className="admin-bug-shot-placeholder">{error ? <Bug aria-hidden="true" /> : <LoaderCircle className="spinner" aria-hidden="true" />}</div>}
      <small className="mono dim">{label} · {sizeText(file.size)}</small>
    </li>
  )
}

