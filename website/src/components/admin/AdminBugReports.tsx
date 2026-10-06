import { Bug, ChevronDown, LoaderCircle, RefreshCw, RotateCcw, CheckCheck } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { Pager } from './AdminPayments'
import { dateTime, failure, numberFormat, useAdminData, type Failure } from './adminData'
import { bugReportsApi, type BugReportFile, type BugReportStatus } from './bugReportsApi'

const PAGE = 50

const FILTERS: Array<{ id: BugReportStatus; label: string }> = [
  { id: 'open', label: 'Открытые' },
  { id: 'closed', label: 'Закрытые' },
]

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`)

/** «Баг-репорты»: reports sent from the app («Сообщить об ошибке»), open first; a row opens the description and screenshots. */
export function AdminBugReports() {
  const [status, setStatus] = useState<BugReportStatus>('open')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const list = useAdminData(useCallback((token: string) => bugReportsApi.list(token, status, PAGE, page * PAGE), [status, page]))
  const data = list.data

  return (
    <div className="admin-stack">
      <div className="admin-section-head">
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
        <button type="button" className="button ghost small" disabled={list.loading} onClick={() => void list.refresh()}>
          {list.loading ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Обновить
        </button>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        Отчёты из приложения: кнопка «Сообщить об ошибке». E-mail — адрес аккаунта на момент отправки; у удалённых аккаунтов его нет.
      </p>
      {list.error && <Notice tone={list.error.offline ? 'offline' : 'error'}>{list.error.message}</Notice>}
      {!data && !list.error && <Loading text="Загружаем отчёты…" />}
      {data && data.reports.length === 0 && <div className="muted admin-empty">{status === 'open' ? 'Открытых отчётов нет.' : 'Закрытых отчётов нет.'}</div>}
      {data && data.reports.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table admin-bug-table">
            <thead>
              <tr>
                <th scope="col">Дата</th><th scope="col">E-mail</th><th scope="col">Тема</th><th scope="col">Версия</th>
                <th scope="col" className="num">Скриншоты</th><th scope="col"><span className="visually-hidden">Подробнее</span></th>
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
                      <td className="admin-row-action">
                        <button type="button" className="button ghost small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : report.id)}>
                          <ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />{expanded ? 'Скрыть' : 'Открыть'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="owner-detail">
                        <td colSpan={6}><BugReportDetails id={report.id} onChange={() => { setOpen(null); void list.reload() }} /></td>
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

function BugReportDetails({ id, onChange }: { id: number; onChange: () => void }) {
  const detail = useAdminData(useCallback((token: string) => bugReportsApi.get(token, id), [id]))
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<Failure | null>(null)
  const report = detail.data?.report

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
      </dl>
      <div>
        <div className="field-label">Описание</div>
        <p className="admin-bug-text">{report.description}</p>
      </div>
      {report.files.length > 0 && (
        <div>
          <div className="field-label">Скриншоты · {report.files.length}</div>
          <ul className="admin-bug-shots">
            {report.files.map((file) => <Screenshot key={file.idx} reportId={report.id} file={file} />)}
          </ul>
        </div>
      )}
      {actionError && <Notice tone={actionError.offline ? 'offline' : 'error'}>{actionError.message}</Notice>}
      <div className="admin-bug-actions">
        {report.status === 'open'
          ? <button type="button" className="button primary small" disabled={busy} onClick={() => void setStatus('closed')}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}Закрыть</button>
          : <button type="button" className="button ghost small" disabled={busy} onClick={() => void setStatus('open')}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}Открыть снова</button>}
      </div>
    </div>
  )
}

/** One screenshot: fetched with the owner's token as a blob → object URL (revoked when the row closes). */
function Screenshot({ reportId, file }: { reportId: number; file: BugReportFile }) {
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
  const label = `Скриншот ${file.idx + 1}`
  return (
    <li>
      {url
        ? <a href={url} target="_blank" rel="noopener noreferrer" title="Открыть в полном размере"><img src={url} alt={label} /></a>
        : <div className="admin-bug-shot-placeholder">{error ? <Bug aria-hidden="true" /> : <LoaderCircle className="spinner" aria-hidden="true" />}</div>}
      <small className="mono dim">{label} · {sizeText(file.size)}</small>
    </li>
  )
}

