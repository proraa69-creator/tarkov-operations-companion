/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate } from 'react-router-dom'
import { Bug, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Gift, Inbox, Lightbulb, LoaderCircle, MapPinned, MessagesSquare, PencilRuler, RotateCcw, Users, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isOwnerApp } from '../app/buildEdition'
import { useOptionalTarkovData } from '../data/DataProvider'
import { useQuestPointWriter } from '../data/questPointOverrides'
import { useOwnerChats, useOwnerReportActions, useOwnerReports, type OwnerReport, type OwnerReportDetail } from '../data/ownerRequests'
import { OwnerChats } from '../support/OwnerChats'
import { cleanIpcError } from '../sync/serverSync'
import { MATCHES_CONFIRMED, QUEST_ISSUE_LABELS, REPORT_CATEGORY_LABELS } from '../shared/reportCategories'
import type { GameMap, Quest } from '../domain/types'
import '../styles/requests.css'

/** Reports of one quest that agree (server/src/services/bugReportStore.ts `questGroups`), with the place they agree on. */
export interface RequestGroup {
  key: string
  reports: OwnerReport[]
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
export function groupQuestReports(reports: OwnerReport[]): RequestGroup[] {
  const byKey = new Map<string, OwnerReport[]>()
  for (const report of reports) {
    if (!report.quest) continue
    const key = report.group ?? `report:${report.id}`
    byKey.set(key, [...(byKey.get(key) ?? []), report])
  }
  const groups = [...byKey].map(([key, members]): RequestGroup => {
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
export function reportAuthor(report: OwnerReport): string | undefined {
  const id = (report as OwnerReport & { accountId?: unknown }).accountId
  return typeof id === 'string' && ACCOUNT_ID.test(id) ? id : undefined
}

type Tab = 'quests' | 'bugs' | 'ideas' | 'chats' | 'closed'

/**
 * «Заявки» (owner app only; owner, 13.10.2026): players' quest corrections grouped by what they agree on («если она
 * сходится 2-3-4 раза значит буду в ручную менять»), bug reports and ideas. From here the owner opens the quest in the
 * constructor, applies the agreed place to the quest for every player, closes and grants subscription days. Nothing is
 * changed until the owner does it. «Чаты»: the players' support chats, answered here (support/OwnerChats.tsx).
 *
 * «Открыть чат» on a report (owner, 14.10.2026: «где я отметил добавь открыть чат и туда можно будет писать»): «Чаты»
 * with the author's conversation open, where the owner can write first. A report's images open full size
 * («еще добавь возможность открывать скриншоты которые люди присылают»): ImageViewer.
 */
export function RequestsPage() {
  if (!isOwnerApp()) return <Navigate to="/" replace />
  return <Requests />
}

function Requests() {
  const [tab, setTab] = useState<Tab>('quests')
  const [chatWith, setChatWith] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const openChat = useCallback((accountId: string) => {
    setChatWith(accountId)
    setTab('chats')
    // From a card far down the list: the tabs come back into view under the top bar, the conversation under them.
    tabsRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  const open = useOwnerReports('open')
  const closed = useOwnerReports('closed')
  const chats = useOwnerChats()
  const data = useOptionalTarkovData()?.data
  const reports = useMemo(() => open.data ?? [], [open.data])
  const groups = useMemo(() => groupQuestReports(reports), [reports])
  const bugs = reports.filter((report) => !report.quest && report.kind === 'bug')
  const ideas = reports.filter((report) => report.kind === 'idea')
  const tabs: Array<{ id: Tab; label: string; count?: number; icon: typeof Inbox }> = [
    { id: 'quests', label: 'Квесты', count: reports.filter((report) => report.quest).length, icon: MapPinned },
    { id: 'bugs', label: 'Ошибки', count: bugs.length, icon: Bug },
    { id: 'ideas', label: 'Предложения', count: ideas.length, icon: Lightbulb },
    { id: 'chats', label: 'Чаты', count: chats.data?.unread, icon: MessagesSquare },
    { id: 'closed', label: 'Закрытые', icon: CheckCircle2 },
  ]
  const error = open.error instanceof Error ? cleanIpcError(open.error) : ''
  return (
    <div className="page requests-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText('Админ')}</div>
          <h1 className="page-title">{uiText('Заявки')}</h1>
          <p className="page-subtitle">{uiText('Ошибки, предложения и исправления квестов от игроков. Совпадающие исправления собраны вместе — ничего не меняется, пока вы не примените.')}</p>
        </div>
      </header>
      <div ref={tabsRef} className="requests-tabs" role="tablist" aria-label={uiText('Заявки')}>
        {tabs.map(({ id, label, count, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`requests-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
            <Icon size={14} />{uiText(label)}{count ? <span className="requests-tab-count">{count}</span> : null}
          </button>
        ))}
      </div>
      {error && <p className="account-error" role="alert">{uiText(/Не найдено|Неизвестный запрос/.test(error) ? 'Заявки видит только аккаунт владельца. Войдите в него в профиле.' : error)}</p>}
      {open.isLoading && <p className="dim"><LoaderCircle size={14} className="spin" /> {uiText('Загружаем заявки…')}</p>}
      {tab === 'quests' && (groups.length
        ? groups.map((group) => <QuestGroupCard key={group.key} group={group} quests={data?.quests ?? []} maps={data?.maps ?? []} onOpenChat={openChat} />)
        : !open.isLoading && <EmptyRequests text="Исправлений квестов пока нет." />)}
      {tab === 'bugs' && (bugs.length ? bugs.map((report) => <ReportCard key={report.id} report={report} onOpenChat={openChat} />) : !open.isLoading && <EmptyRequests text="Открытых отчётов об ошибках нет." />)}
      {tab === 'ideas' && (ideas.length ? ideas.map((report) => <ReportCard key={report.id} report={report} onOpenChat={openChat} />) : !open.isLoading && <EmptyRequests text="Новых предложений нет." />)}
      {tab === 'chats' && <OwnerChats selected={chatWith} onSelect={setChatWith} />}
      {tab === 'closed' && ((closed.data ?? []).length ? (closed.data ?? []).map((report) => <ReportCard key={report.id} report={report} onOpenChat={openChat} />) : !closed.isLoading && <EmptyRequests text="Закрытых заявок нет." />)}
    </div>
  )
}

function EmptyRequests({ text }: { text: string }) {
  return <section className="panel requests-empty"><Inbox size={22} /><span>{uiText(text)}</span></section>
}

/**
 * A quest correction several players may agree on: where, how many, their notes, and the owner's actions. «Открыть чат»
 * after «Закрыть» when one player sent them all; with several players, on each player's line.
 */
function QuestGroupCard({ group, quests, maps, onOpenChat }: { group: RequestGroup; quests: Quest[]; maps: GameMap[]; onOpenChat: (accountId: string) => void }) {
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
    void run('Точка применена, заявки закрыты', async () => {
      await writer.save(group.markerId
        ? { questId: group.questId, markerId: group.markerId, mapId: group.mapId!, x: point.x, z: point.z, kind: 'move', ...goal, ...(point.floor ? { floor: point.floor } : {}), note }
        : { questId: group.questId, mapId: group.mapId!, x: point.x, z: point.z, kind: 'add', ...goal, ...(point.floor ? { floor: point.floor } : {}), note })
      await actions.setStatus(ids, 'closed')
    })
  }
  const reward = () => {
    if (!window.confirm(uiText(`Начислить ${days} дн. подписки каждому из ${group.matches} отправивших?`))) return
    void run('Дни начислены', () => actions.reward(ids, days))
  }
  return (
    <section className={`panel requests-group${confirmed ? ' is-confirmed' : ''}`}>
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
        {group.reports.map((report) => {
          const author = authors.length > 1 ? reportAuthor(report) : undefined
          return (
            <li key={report.id}>
              <span className="dim">№{report.id} · {when(report.createdAt)} · {report.email ?? uiText('аккаунт удалён')}{report.rewardDays ? ` · +${report.rewardDays} ${uiText('дн.')}` : ''}</span>
              {report.quest?.pointNote && <span>{uiText('К точке')}: {report.quest.pointNote}</span>}
              {report.quest?.questNote && <span>{uiText('К квесту')}: {report.quest.questNote}</span>}
              {!report.quest?.pointNote && !report.quest?.questNote && <span className="dim">{report.topic}</span>}
              {author && <button type="button" className="button small ghost requests-note-chat" onClick={() => onOpenChat(author)}><MessagesSquare size={12} />{uiText('Открыть чат')}</button>}
            </li>
          )
        })}
      </ul>
      <div className="requests-actions">
        <button type="button" className="button small" disabled={busy} onClick={openInConstructor}><PencilRuler size={13} />{uiText('Открыть в конструкторе')}</button>
        {group.point && group.mapId && <button type="button" className="button small primary" disabled={busy} onClick={apply}><MapPinned size={13} />{uiText(group.markerId ? 'Перенести точку сюда' : 'Добавить точку сюда')}</button>}
        <span className="requests-reward">
          <input className="input" type="number" min={1} max={365} value={days} disabled={busy} onChange={(event) => setDays(Math.max(1, Math.min(365, Math.round(Number(event.target.value) || 1))))} aria-label={uiText('Дней подписки')} />
          <button type="button" className="button small" disabled={busy} onClick={reward}><Gift size={13} />{uiText('Начислить дни')}</button>
        </span>
        <button type="button" className="button small ghost" disabled={busy} onClick={() => void run('Заявки закрыты', () => actions.setStatus(ids, 'closed'))}><CheckCircle2 size={13} />{uiText('Закрыть')}</button>
        {authors.length === 1 && <button type="button" className="button small ghost" onClick={() => onOpenChat(authors[0]!)}><MessagesSquare size={13} />{uiText('Открыть чат')}</button>}
        {busy && <LoaderCircle size={14} className="spin" />}
        {done && <small className="quest-text-saved">{uiText(done)}</small>}
        {error && <small className="account-error">{uiText(error)}</small>}
      </div>
    </section>
  )
}

/**
 * A bug report or an idea: what it is about, the details and images on demand, close / reopen, days and «Открыть чат».
 * A thumbnail, or «изображений: N», opens the images full size (ImageViewer).
 */
function ReportCard({ report, onOpenChat }: { report: OwnerReport; onOpenChat: (accountId: string) => void }) {
  const actions = useOwnerReportActions()
  const [detail, setDetail] = useState<OwnerReportDetail | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [days, setDays] = useState(1)
  const author = reportAuthor(report)
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(cleanIpcError(reason) || 'Сервер недоступен') } finally { setBusy(false) }
  }
  /** The description, then the images: data URLs from the owner-only route (the gateway forwards JSON only). */
  const load = async () => {
    let loaded: string[] = []
    await run(async () => {
      const found = await actions.detail(report.id)
      setDetail(found)
      loaded = await Promise.all(found.files.map((file) => actions.image(report.id, file.idx)))
      setImages(loaded)
    })
    return loaded
  }
  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    if (next && !detail) void load()
  }
  const showImages = async () => {
    if (busy) return
    setExpanded(true)
    if ((images.length ? images : await load()).length) setViewing(0)
  }
  const closedReport = report.status === 'closed'
  return (
    <section className="panel requests-report">
      <header className="requests-group-head">
        <div>
          <div className="eyebrow">{uiText(report.kind === 'idea' ? 'Предложение' : report.category ? REPORT_CATEGORY_LABELS[report.category] : 'Ошибка')} · №{report.id} · {when(report.createdAt)}</div>
          <h2>{report.topic}</h2>
          <small className="dim">
            {report.email ?? uiText('аккаунт удалён')} · {report.appVersion}
            {report.files ? <> · <button type="button" className="requests-files-link" aria-busy={busy} onClick={() => void showImages()} title={uiText('Открыть во весь размер')}>{uiText('изображений')}: {report.files}</button></> : null}
            {report.rewardDays ? ` · +${report.rewardDays} ${uiText('дн.')}` : ''}
          </small>
        </div>
        <button type="button" className="icon-button" aria-expanded={expanded} onClick={toggle} aria-label={uiText('Подробнее')} title={uiText('Подробнее')}><ChevronDown size={16} className={expanded ? 'is-flipped' : ''} /></button>
      </header>
      {expanded && detail && (
        <div className="requests-detail">
          {detail.description && <p>{detail.description}</p>}
          {images.length > 0 && <div className="requests-images">{images.map((src, index) => (
            <button key={index} type="button" className="requests-image" onClick={() => setViewing(index)} aria-label={`${uiText('Открыть изображение')} ${index + 1}`} title={uiText('Открыть во весь размер')}>
              <img src={src} alt={`${uiText('Изображение')} ${index + 1}`} />
            </button>
          ))}</div>}
        </div>
      )}
      {viewing !== null && viewing < images.length && <ImageViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
      <div className="requests-actions">
        <span className="requests-reward">
          <input className="input" type="number" min={1} max={365} value={days} disabled={busy} onChange={(event) => setDays(Math.max(1, Math.min(365, Math.round(Number(event.target.value) || 1))))} aria-label={uiText('Дней подписки')} />
          <button type="button" className="button small" disabled={busy} onClick={() => { if (window.confirm(uiText(`Начислить ${days} дн. подписки отправителю?`))) void run(() => actions.reward([report.id], days)) }}><Gift size={13} />{uiText('Начислить дни')}</button>
        </span>
        {closedReport
          ? <button type="button" className="button small ghost" disabled={busy} onClick={() => void run(() => actions.setStatus([report.id], 'open'))}><RotateCcw size={13} />{uiText('Открыть снова')}</button>
          : <button type="button" className="button small ghost" disabled={busy} onClick={() => void run(() => actions.setStatus([report.id], 'closed'))}><CheckCircle2 size={13} />{uiText('Закрыть')}</button>}
        {author && <button type="button" className="button small ghost" onClick={() => onOpenChat(author)}><MessagesSquare size={13} />{uiText('Открыть чат')}</button>}
        {busy && <LoaderCircle size={14} className="spin" />}
        {error && <small className="account-error">{uiText(error)}</small>}
      </div>
    </section>
  )
}

/**
 * A report's images full size (owner, 14.10.2026: «еще добавь возможность открывать скриншоты которые люди присылают»):
 * over the whole app, each fitted to the window. ←/→ and the side buttons go through several; Esc, «×» or a click
 * outside the image closes it. Like the other dialogs, the focus moves in (to «×»), stays there (Tab goes round the
 * viewer's buttons) and goes back to the thumbnail afterwards. The images are the data URLs the owner-only route answered
 * (GET …/bug-reports/:id/files/:idx/data): nothing is put at an address anybody else could open.
 */
function ImageViewer({ images, index, onIndex, onClose }: { images: string[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const count = images.length
  const viewer = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const latest = useRef({ index, count, onIndex, onClose })
  useLayoutEffect(() => { latest.current = { index, count, onIndex, onClose } })
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    // Captured on the window: Escape and the arrows belong to the viewer while it is open.
    const onKey = (event: KeyboardEvent) => {
      const { index, count, onIndex, onClose } = latest.current
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && count > 1) {
        event.preventDefault()
        onIndex((index + (event.key === 'ArrowRight' ? 1 : count - 1)) % count)
        return
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(viewer.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      if (!buttons.length) return
      event.preventDefault()
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = at < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (at + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length
      buttons[next]?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  const label = `${uiText('Изображение')} ${index + 1} ${uiText('из')} ${count}`
  const step = (delta: number) => onIndex((index + delta + count) % count)
  return createPortal(
    <div ref={viewer} className="requests-viewer" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <img src={images[index]} alt={label} />
      <button ref={closeButton} type="button" className="requests-viewer-close" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={18} /></button>
      {count > 1 && <>
        <button type="button" className="requests-viewer-step is-prev" onClick={() => step(-1)} aria-label={uiText('Предыдущее изображение')} title={uiText('Предыдущее изображение')}><ChevronLeft size={24} /></button>
        <button type="button" className="requests-viewer-step is-next" onClick={() => step(1)} aria-label={uiText('Следующее изображение')} title={uiText('Следующее изображение')}><ChevronRight size={24} /></button>
        <span className="requests-viewer-count" aria-hidden="true">{index + 1} / {count}</span>
      </>}
    </div>,
    document.body,
  )
}
