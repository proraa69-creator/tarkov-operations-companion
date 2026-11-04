/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, FileText, Gift, LoaderCircle, MapPinned, MessagesSquare, PencilRuler, Reply, Users } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isOwnerApp } from '../app/buildEdition'
import { useOptionalTarkovData } from '../data/DataProvider'
import { useQuestPointWriter } from '../data/questPointOverrides'
import { useOwnerChatActions, useOwnerChats, useOwnerReportActions, useOwnerReportTable, type OwnerReport, type OwnerReportRow } from '../data/ownerRequests'
import { OwnerChats } from '../support/OwnerChats'
import { SupportComposer, SupportReportCard } from '../support/SupportChat'
import { ClaudeAccessPanel } from '../requests/ClaudeAccessPanel'
import { ImageViewer } from '../components/ImageViewer'
import { ReportsTable } from '../reports/ReportsTable'
import { cleanIpcError } from '../sync/serverSync'
import { MATCHES_CONFIRMED, QUEST_ISSUE_LABELS } from '../shared/reportCategories'
import { REPORT_WORK_ACTIONS, type ReportTableView } from '../shared/reportWork'
import type { GameMap, Quest } from '../domain/types'
import '../styles/requests.css'

/** Reports of one quest that agree (server/src/services/bugReportStore.ts `questGroups`), with the place they agree on. */
export interface RequestGroup<Report extends OwnerReport | OwnerReportRow = OwnerReport> {
  key: string
  reports: Report[]
  matches: number
  questId: string
  issue: NonNullable<OwnerReport['quest']>['issue']
  mapId?: string
  markerId?: string
  objectiveId?: string
  stageIndex?: number
  /** The average of the proposed places; the most common floor. */
  point?: { x: number; z: number; floor?: string }
  latest: string
}

/** Groups the open quest reports the server marked as agreeing; most agreed first, then the newest. */
export function groupQuestReports<Report extends OwnerReport | OwnerReportRow>(reports: Report[]): RequestGroup<Report>[] {
  const byKey = new Map<string, Report[]>()
  for (const report of reports) {
    if (!report.quest) continue
    const key = report.group ?? `report:${report.id}`
    byKey.set(key, [...(byKey.get(key) ?? []), report])
  }
  const groups = [...byKey].map(([key, members]): RequestGroup<Report> => {
    const first = members[0]!.quest!
    const placed = members.flatMap((report) => (report.quest?.point ? [report.quest.point] : []))
    const floors = new Map<string, number>()
    for (const point of placed) if (point.floor) floors.set(point.floor, (floors.get(point.floor) ?? 0) + 1)
    const floor = [...floors].sort((a, b) => b[1] - a[1])[0]?.[0]
    const markerId = members.find((report) => report.quest?.markerId)?.quest?.markerId
    const objectiveId = members.find((report) => report.quest?.objectiveId)?.quest?.objectiveId
    const stageIndex = members.find((report) => report.quest?.stageIndex != null)?.quest?.stageIndex
    return {
      key, reports: members, matches: members.length, questId: first.questId, issue: first.issue,
      ...(members.find((report) => report.quest?.mapId)?.quest?.mapId ? { mapId: members.find((report) => report.quest?.mapId)!.quest!.mapId } : {}),
      ...(markerId ? { markerId } : {}), ...(objectiveId ? { objectiveId } : {}), ...(stageIndex != null ? { stageIndex } : {}),
      ...(placed.length ? { point: { x: avg(placed.map((point) => point.x)), z: avg(placed.map((point) => point.z)), ...(floor ? { floor } : {}) } } : {}),
      latest: members.map((report) => report.createdAt).sort().at(-1) ?? '',
    }
  })
  return groups.sort((a, b) => b.matches - a.matches || b.latest.localeCompare(a.latest))
}

const avg = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10
const dateTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const when = (iso: string) => { try { return dateTime.format(new Date(iso)) } catch { return iso } }

const ACCOUNT_ID = /^[a-f0-9]{24}$/
/**
 * The report's author for «Открыть чат»: the server's report carries the account id until the account is deleted
 * (server/src/routes/bugReports.ts); a report without one has no chat button.
 */
export function reportAuthor(report: OwnerReport | OwnerReportRow): string | undefined {
  const id = (report as { accountId?: unknown }).accountId
  return typeof id === 'string' && ACCOUNT_ID.test(id) ? id : undefined
}

type Tab = 'reports' | 'chats'

/**
 * «Отчёты» (owner app only): the one table of reports, ideas and quest corrections (owner, 05.11.2026: «убери из отчетов все
 * и сделай там таблицу»; src/reports/ReportsTable.tsx), and «Чаты», the players' support conversations, answered here
 * (support/OwnerChats.tsx). What a report could do before lives under «Подробнее» on its row: the images full size, «Ответить»
 * (owner, 04.11.2026: «прям там могу ответить, не открывая чат»: the answer goes into the author's chat under «Ответ на заявку
 * №N», and the report reads «Отвечено»), «Начислить дни», «Открыть чат», and for a quest correction the constructor and the
 * place players agree on (owner, 13.10.2026). Nothing changes until the owner presses something.
 * The address may name a report (?report=N, a notification) or a conversation (?chat=<account>, from «Админ панель»).
 */
export function RequestsPage() {
  if (!isOwnerApp()) return <Navigate to="/" replace />
  return <Requests />
}

function Requests() {
  const [params] = useSearchParams()
  const chat = params.get('chat')
  const [tab, setTab] = useState<Tab>(chat ? 'chats' : 'reports')
  const [chatWith, setChatWith] = useState<string | null>(chat)
  const tabsRef = useRef<HTMLDivElement>(null)
  const openChat = useCallback((accountId: string) => {
    setChatWith(accountId)
    setTab('chats')
    // From a row far down the table: the tabs come back into view under the top bar, the conversation under them.
    tabsRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  const chats = useOwnerChats()
  const focus = Number(params.get('report')) || null
  return (
    <div className="page requests-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText('Админ')}</div>
          <h1 className="page-title">{uiText('Отчёты')}</h1>
          <p className="page-subtitle">{uiText('Отчёты, предложения и исправления квестов от игроков. Ничего не меняется, пока вы не нажмёте кнопку.')}</p>
        </div>
      </header>
      <div ref={tabsRef} className="requests-tabs" role="tablist" aria-label={uiText('Отчёты')}>
        <button type="button" role="tab" aria-selected={tab === 'reports'} className={`requests-tab${tab === 'reports' ? ' is-active' : ''}`} onClick={() => setTab('reports')}>
          <FileText size={14} />{uiText('Отчёты')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'chats'} className={`requests-tab${tab === 'chats' ? ' is-active' : ''}`} onClick={() => setTab('chats')}>
          <MessagesSquare size={14} />{uiText('Чаты')}{chats.data?.unread ? <span className="requests-tab-count">{chats.data.unread}</span> : null}
        </button>
      </div>
      {tab === 'reports' && <OwnerReportsTable onOpenChat={openChat} focusId={focus} />}
      {tab === 'chats' && <OwnerChats selected={chatWith} onSelect={setChatWith} />}
      {/* «Доступ Claude к заявкам» (owner, 14.10.2026: «2 вариант да»): the read-only key for Claude's cloud sessions. */}
      {tab === 'reports' && <details className="requests-more"><summary>{uiText('Доступ Claude к отчётам')}</summary><ClaudeAccessPanel /></details>}
    </div>
  )
}

/** The table with the owner app's data and its details; also in «Админ панель» → «Отчёты». */
export function OwnerReportsTable({ onOpenChat, focusId }: { onOpenChat: (accountId: string) => void; focusId?: number | null }) {
  const [view, setView] = useState<ReportTableView>('active')
  const table = useOwnerReportTable(view)
  const actions = useOwnerReportActions()
  const data = useOptionalTarkovData()?.data
  const raw = table.error instanceof Error ? cleanIpcError(table.error) : ''
  const error = /Не найдено|Неизвестный запрос/.test(raw) ? 'Отчёты видит только аккаунт владельца. Войдите в него в профиле.' : raw
  const page = table.data ?? null
  const groups = useMemo(() => groupQuestReports(page?.rows ?? []), [page])
  return (
    <ReportsTable
      page={page}
      view={view}
      onView={setView}
      t={uiText}
      focusId={focusId}
      error={error}
      loading={table.isFetching}
      onRefresh={() => void table.refetch()}
      onAct={(id, action, plan) => actions.work([id], action, plan)}
      onPlan={actions.plan}
      footer={page && page.total > page.rows.length ? <small className="dim">{uiText('Показаны последние 200')}</small> : null}
      detail={(row) => {
        const group = row.quest ? groups.find((entry) => entry.reports.some((report) => report.id === row.id)) : undefined
        return group
          ? <QuestGroupCard group={group} quests={data?.quests ?? []} maps={data?.maps ?? []} onOpenChat={onOpenChat} />
          : <ReportExtras report={row} onOpenChat={onOpenChat} />
      }}
    />
  )
}

/** The answer box on a report: what the player will see above the words, and the same box as in «Чаты». */
function ReportReplyBox({ report, accountId, onSent }: { report: OwnerReportRow; accountId: string; onSent: () => void }) {
  const { reply } = useOwnerChatActions()
  return (
    <div className="requests-reply">
      <SupportReportCard report={{ id: report.id, title: report.topic }} />
      <SupportComposer onSend={async (text, images) => { await reply(accountId, text, images, report.id); onSent() }} placeholder="Ответ игроку…" autoFocus allowImages />
    </div>
  )
}

/** «Отвечено»: the owner answered this report from its row, and when. */
function AnsweredMark({ at }: { at?: string }) {
  return at ? <span className="tag green requests-answered" title={when(at)}><CheckCircle2 size={11} aria-hidden="true" />{uiText('Отвечено')}</span> : null
}

/** «Ответить» and its box, for where a card puts them; nothing for a report of a deleted account. */
function useReportReply(report: OwnerReportRow, className: string) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const author = reportAuthor(report)
  if (!author) return { button: null, box: null }
  return {
    button: <button type="button" className={className} aria-expanded={open} onClick={() => { setOpen(!open); setSent(false) }}><Reply size={13} />{uiText('Ответить')}</button>,
    box: <>
      {sent && !report.answeredAt && <small className="quest-text-saved" role="status">{uiText('Ответ отправлен')}</small>}
      {open && <ReportReplyBox report={report} accountId={author} onSent={() => { setOpen(false); setSent(true) }} />}
    </>,
  }
}

/** One player's report of a quest correction: when, who, the notes, «Ответить»; «Открыть чат» when several players sent the group. */
function QuestReportNote({ report, chatButton, onOpenChat }: { report: OwnerReportRow; chatButton: boolean; onOpenChat: (accountId: string) => void }) {
  const author = reportAuthor(report)
  const reply = useReportReply(report, 'button small ghost requests-note-chat')
  return (
    <li>
      <span className="dim">№{report.id} · {when(report.createdAt)} · {report.email ?? uiText('аккаунт удалён')}{report.rewardDays ? ` · +${report.rewardDays} ${uiText('дн.')}` : ''}</span>
      <AnsweredMark at={report.answeredAt} />
      {report.quest?.pointNote && <span>{uiText('К точке')}: {report.quest.pointNote}</span>}
      {report.quest?.questNote && <span>{uiText('К квесту')}: {report.quest.questNote}</span>}
      {!report.quest?.pointNote && !report.quest?.questNote && <span className="dim">{report.topic}</span>}
      {author && <span className="requests-note-actions">
        {reply.button}
        {chatButton && <button type="button" className="button small ghost requests-note-chat" onClick={() => onOpenChat(author)}><MessagesSquare size={12} />{uiText('Открыть чат')}</button>}
      </span>}
      {reply.box}
    </li>
  )
}

/**
 * A quest correction several players may agree on: where, how many, their notes, and what the owner can do about it.
 * «Открыть чат» when one player sent them all; with several players, on each player's line. The point on the map closes the
 * reports as «Уже реализовано».
 */
function QuestGroupCard({ group, quests, maps, onOpenChat }: { group: RequestGroup<OwnerReportRow>; quests: Quest[]; maps: GameMap[]; onOpenChat: (accountId: string) => void }) {
  const navigate = useNavigate()
  const actions = useOwnerReportActions()
  const writer = useQuestPointWriter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [days, setDays] = useState(1)
  const quest = quests.find((entry) => entry.id === group.questId)
  const map = maps.find((entry) => entry.id === group.mapId)
  const ids = group.reports.map((report) => report.id)
  const authors = [...new Set(group.reports.flatMap((report) => reportAuthor(report) ?? []))]
  const confirmed = group.matches >= MATCHES_CONFIRMED
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(true); setError(''); setDone('')
    try { await action(); setDone(label) } catch (reason) { setError(cleanIpcError(reason) || 'Сервер недоступен') } finally { setBusy(false) }
  }
  const openInConstructor = () => {
    const mapId = group.mapId ?? quest?.mapId ?? quest?.mapIds?.[0]
    const proposal = group.point ? `&proposal=${group.point.x},${group.point.z}` : ''
    navigate(mapId ? `/maps/${mapId}?quest=${encodeURIComponent(group.questId)}&edit=1${proposal}` : `/maps?quest=${encodeURIComponent(group.questId)}&edit=1`)
  }
  // «Применить точку»: the agreed place goes on every player's map (a wrong point is moved there, a missing one added).
  const apply = () => {
    const point = group.point
    if (!point || !group.mapId) return
    const name = quest?.name ?? group.questId
    if (!window.confirm(uiText(`Поставить точку квеста «${name}» туда, куда указали игроки (${group.matches})? Её сразу увидят все.`))) return
    const goal = group.objectiveId ? { objectiveId: group.objectiveId } : group.stageIndex != null ? { stageIndex: group.stageIndex } : {}
    const note = `По заявкам ${ids.map((id) => `№${id}`).join(', ')}`.slice(0, 300)
    void run('Точка применена, отчёты закрыты', async () => {
      await writer.save(group.markerId
        ? { questId: group.questId, markerId: group.markerId, mapId: group.mapId!, x: point.x, z: point.z, kind: 'move', ...goal, ...(point.floor ? { floor: point.floor } : {}), note }
        : { questId: group.questId, mapId: group.mapId!, x: point.x, z: point.z, kind: 'add', ...goal, ...(point.floor ? { floor: point.floor } : {}), note })
      await actions.work(group.reports.filter((report) => REPORT_WORK_ACTIONS.already.from.includes(report.work.status)).map((report) => report.id), 'already')
    })
  }
  const reward = () => {
    if (!window.confirm(uiText(`Начислить ${days} дн. подписки каждому из ${group.matches} отправивших?`))) return
    void run('Дни начислены', () => actions.reward(ids, days))
  }
  return (
    <div className={`requests-group${confirmed ? ' is-confirmed' : ''}`}>
      <header className="requests-group-head">
        <div>
          <div className="eyebrow">{uiText(quest?.trader ?? 'Квест')} · {uiText(QUEST_ISSUE_LABELS[group.issue] ?? group.issue)}</div>
          <h2>{uiText(quest?.name ?? group.questId)}</h2>
          <div className="requests-tags">
            {map && <span className="tag">{uiText(map.name)}</span>}
            {group.point && <span className="tag">x {Math.round(group.point.x)}, z {Math.round(group.point.z)}{group.point.floor ? ` · ${uiText(group.point.floor)}` : ''}</span>}
            {[...new Set(group.reports.flatMap((report) => (report.quest?.mode ? [report.quest.mode] : [])))].map((mode) => <span key={mode} className="tag">{mode === 'seasonal' ? uiText('Сезон') : mode.toUpperCase()}</span>)}
          </div>
        </div>
        <span className={`requests-matches${confirmed ? ' is-confirmed' : ''}`} title={uiText('Сколько игроков указали одно и то же')}>
          <Users size={14} />{confirmed ? uiText(`Совпадает у ${group.matches}`) : uiText('1 игрок')}
        </span>
      </header>
      <ul className="requests-notes">
        {group.reports.map((report) => <QuestReportNote key={report.id} report={report} chatButton={authors.length > 1} onOpenChat={onOpenChat} />)}
      </ul>
      <div className="requests-actions">
        <button type="button" className="button small" disabled={busy} onClick={openInConstructor}><PencilRuler size={13} />{uiText('Открыть в конструкторе')}</button>
        {group.point && group.mapId && <button type="button" className="button small primary" disabled={busy} onClick={apply}><MapPinned size={13} />{uiText(group.markerId ? 'Перенести точку сюда' : 'Добавить точку сюда')}</button>}
        <span className="requests-reward">
          <input className="input" type="number" min={1} max={365} value={days} disabled={busy} onChange={(event) => setDays(Math.max(1, Math.min(365, Math.round(Number(event.target.value) || 1))))} aria-label={uiText('Дней подписки')} />
          <button type="button" className="button small" disabled={busy} onClick={reward}><Gift size={13} />{uiText('Начислить дни')}</button>
        </span>
        {authors.length === 1 && <button type="button" className="button small ghost" onClick={() => onOpenChat(authors[0]!)}><MessagesSquare size={13} />{uiText('Открыть чат')}</button>}
        {busy && <LoaderCircle size={14} className="spin" />}
        {done && <small className="quest-text-saved">{uiText(done)}</small>}
        {error && <small className="account-error">{uiText(error)}</small>}
      </div>
    </div>
  )
}

/**
 * What else a report or an idea holds, opened under its row: who sent it, the images (a thumbnail opens them full size,
 * ImageViewer; data URLs from the owner-only route, the gateway forwards JSON only), «Ответить», days and «Открыть чат».
 */
function ReportExtras({ report, onOpenChat }: { report: OwnerReportRow; onOpenChat: (accountId: string) => void }) {
  const actions = useOwnerReportActions()
  const [viewing, setViewing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [days, setDays] = useState(1)
  const author = reportAuthor(report)
  const reply = useReportReply(report, 'button small')
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(cleanIpcError(reason) || 'Сервер недоступен') } finally { setBusy(false) }
  }
  // Read once for an open row: not with the table, whose every change would fetch them again.
  const loaded = useQuery({
    queryKey: ['owner-report-images', report.id],
    queryFn: async () => {
      const found = await actions.detail(report.id)
      return Promise.all(found.files.map((file) => actions.image(report.id, file.idx)))
    },
    enabled: report.files > 0,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: 1,
  })
  const images = loaded.data ?? []
  return (
    <div className="requests-report">
      <small className="dim">
        {report.email ?? uiText('аккаунт удалён')}
        {report.rewardDays ? ` · +${report.rewardDays} ${uiText('дн.')}` : ''}
      </small>
      {report.answeredAt && <div className="requests-tags"><AnsweredMark at={report.answeredAt} /></div>}
      {images.length > 0 && <div className="requests-images">{images.map((src, index) => (
        <button key={index} type="button" className="requests-image" onClick={() => setViewing(index)} aria-label={`${uiText('Открыть изображение')} ${index + 1}`} title={uiText('Открыть во весь размер')}>
          <img src={src} alt={`${uiText('Изображение')} ${index + 1}`} />
        </button>
      ))}</div>}
      {viewing !== null && viewing < images.length && <ImageViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
      <div className="requests-actions">
        {reply.button}
        {author && <span className="requests-reward">
          <input className="input" type="number" min={1} max={365} value={days} disabled={busy} onChange={(event) => setDays(Math.max(1, Math.min(365, Math.round(Number(event.target.value) || 1))))} aria-label={uiText('Дней подписки')} />
          <button type="button" className="button small" disabled={busy} onClick={() => { if (window.confirm(uiText(`Начислить ${days} дн. подписки отправителю?`))) void run(() => actions.reward([report.id], days)) }}><Gift size={13} />{uiText('Начислить дни')}</button>
        </span>}
        {author && <button type="button" className="button small ghost" onClick={() => onOpenChat(author)}><MessagesSquare size={13} />{uiText('Открыть чат')}</button>}
        {(busy || loaded.isFetching) && <LoaderCircle size={14} className="spin" />}
        {error && <small className="account-error">{uiText(error)}</small>}
        {loaded.error && <small className="account-error">{cleanIpcError(loaded.error) || uiText('Сервер недоступен')}</small>}
      </div>
      {reply.box}
    </div>
  )
}
