import { CalendarPlus, LoaderCircle, Mail } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { Pager } from './AdminPayments'
import { dateTime, failure, useAdminData, type Failure } from './adminData'
import { bugReportsApi, type BugReportQuest, type BugReportRow } from './bugReportsApi'
import { QUEST_ISSUE_LABELS, type QuestIssue } from '../../../../src/shared/reportCategories'
import { ReportsTable } from '../../../../src/reports/ReportsTable'
import { watchReportEvents } from '../../../../src/reports/reportEvents'
import type { ReportTableView, ReportWorkAction } from '../../../../src/shared/reportWork'

/** A player's quest correction as «label: value» rows (the owner applies them in the app's «Отчёты»). */
function questFacts(quest: BugReportQuest, matches?: number): Array<[string, string]> {
  return [
    ['Квест (id)', quest.questId], ['Что не так', QUEST_ISSUE_LABELS[quest.issue as QuestIssue] ?? quest.issue],
    ...(quest.mode ? [['Режим', quest.mode === 'seasonal' ? 'Сезон' : quest.mode.toUpperCase()] as [string, string]] : []),
    ...(quest.mapId ? [['Карта', quest.mapId] as [string, string]] : []),
    ...(quest.markerId ? [['Неверная точка', quest.markerId] as [string, string]] : []),
    ...(quest.point ? [['Предложенное место', `x ${Math.round(quest.point.x)}, z ${Math.round(quest.point.z)}${quest.point.floor ? ` · ${quest.point.floor}` : ''}`] as [string, string]] : []),
    ...(quest.pointNote ? [['Заметка к точке', quest.pointNote] as [string, string]] : []),
    ...(quest.questNote ? [['Заметка к квесту', quest.questNote] as [string, string]] : []),
    ...(matches && matches > 1 ? [['Совпадает с отчётами', String(matches - 1)] as [string, string]] : []),
  ]
}

const PAGE = 50

/** The panel's words for each kind. */
const WORDS = {
  bug: { rewarded: 'Выдано за отчёт', daysFor: 'Дней за отчёт', forIt: 'за отчёт' },
  idea: { rewarded: 'Выдано за предложение', daysFor: 'Дней за предложение', forIt: 'за предложение' },
}

/**
 * «Отчёты» (owner, 05.11.2026: «убери из отчетов все и сделай там таблицу»): the one table of reports and ideas
 * (src/reports/ReportsTable.tsx), filling by itself while the tab is open: one request waits on the server for the next
 * change (src/reports/reportEvents.ts). «Подробнее», in the row: the quest's details, the owner's days for it
 * (owner, 11.10.2026: «+1 день я буду выдавать сам»), the PDF of the report in the mailbox.
 */
export function AdminBugReports() {
  const { token } = useAuth()
  const [view, setView] = useState<ReportTableView>('active')
  const [page, setPage] = useState(0)
  const list = useAdminData(useCallback((owner: string) => bugReportsApi.table(owner, view, PAGE, page * PAGE), [view, page]))
  const { reload } = list

  useEffect(() => {
    if (!token) return
    const stop = new AbortController()
    void watchReportEvents((path) => bugReportsApi.events(token, path), (_event, changed) => { if (changed) void reload() }, stop.signal)
    return () => stop.abort()
  }, [token, reload])

  const act = async (id: number, action: ReportWorkAction) => {
    if (!token) return
    await bugReportsApi.work(token, id, action)
    await reload()
  }
  // The picture's bytes with the owner's token, never an address with the token in it; ReportsTable releases the blob: address.
  const loadImage = async (row: BugReportRow, index: number) => {
    if (!token) throw new Error('Нет входа')
    return URL.createObjectURL(await bugReportsApi.file(token, row.id, index))
  }

  return (
    <div className="admin-stack">
      <ReportsTable
        page={list.data}
        view={view}
        onView={(next) => { setView(next); setPage(0) }}
        onAct={act}
        onReward={async (id, days) => { if (!token) return; await bugReportsApi.reward(token, id, days); await reload() }}
        loadImage={loadImage}
        error={list.error?.message}
        loading={list.loading}
        onRefresh={() => void list.refresh()}
        detail={(row) => <ReportDetails row={row} onUpdate={() => void reload()} />}
        footer={list.data ? <Pager page={page} total={list.data.total} size={PAGE} onPage={setPage} /> : null}
      />
    </div>
  )
}

function ReportDetails({ row, onUpdate }: { row: BugReportRow; onUpdate: () => void }) {
  const id = row.id
  const detail = useAdminData(useCallback((token: string) => bugReportsApi.get(token, id), [id]))
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<Failure | null>(null)
  const [days, setDays] = useState('1')
  const [done, setDone] = useState('')
  const report = detail.data?.report
  const words = WORDS[row.kind]

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

  if (!report) return detail.error ? <Notice tone={detail.error.offline ? 'offline' : 'error'}>{detail.error.message}</Notice> : <Loading />
  return (
    <div className="admin-bug-detail">
      <dl className="admin-facts">
        {report.quest ? questFacts(report.quest, report.matches).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>) : null}
        <div><dt>{words.rewarded}</dt><dd>{report.rewardDays ? <><span className="tag green">+{report.rewardDays} дн.</span>{report.rewardedAt ? <span className="dim mono"> · {dateTime.format(new Date(report.rewardedAt))}</span> : null}</> : <span className="dim">ещё нет</span>}</dd></div>
        <div><dt>PDF на почту</dt><dd>{report.mailedAt ? <span className="mono">{dateTime.format(new Date(report.mailedAt))}</span> : report.mailError ? <span className="admin-danger-text">{report.mailError}</span> : <span className="dim">ещё не отправлен</span>}</dd></div>
      </dl>
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
      </div>
    </div>
  )
}

