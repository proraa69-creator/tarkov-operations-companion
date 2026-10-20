import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowLeft, BadgeRussianRuble, CalendarDays, Check, ChevronRight, Clock3, CreditCard, Gift, ImagePlus, LoaderCircle,
  Maximize2, MessagesSquare, MessageSquareWarning, Paperclip, RefreshCw, Search, Send, ShieldCheck, Trash2, UserPlus, Users, Wifi, X,
} from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { prepareNoticeImage } from '../notices/imageResize'
import { countryName } from '../shared/countries'
import { SupportComposer, SupportMessageList } from '../support/SupportChat'
import type { SupportImageUpload } from '../support/supportChatClient'
import {
  adminApi, monthsToDays, type AdminOnlineStats, type AdminOverview, type AdminPayment, type AdminPaymentPeriod, type AdminPayments,
  type AdminRegionCounts, type AdminSupportDetail, type AdminSupportThreads, type AdminUser, type AdminUserDetail,
  type AdminUserFilter, type AdminUserRegion, type BugReportDetail, type BugReportList, type BugReportStatus,
  type PaymentStatus, type PlanId,
} from './adminApi'
import './adminMobile.css'

/**
 * The admin app's sections, one bottom bar (owner, 20.10.2026: «снизу панель управления: сводка, платежи, пользователи,
 * заявки, чаты»); the app opens on «Сводка».
 */
type Section = 'summary' | 'payments' | 'users' | 'requests' | 'chats'
/** How often the open app looks for new requests and chat messages (the red dots of the bottom bar). */
const ADMIN_BADGE_POLL_MS = 15_000
/** Days of «История по дням» shown before «Показать все». */
const ONLINE_DAYS_FOLDED = 3

const USER_FILTERS: Array<{ id: AdminUserFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Активные' },
  { id: 'trial', label: 'Пробные' },
  { id: 'inactive', label: 'Без подписки' },
]

const PRIMARY_USER_REGIONS: Array<{ id: Extract<AdminUserRegion, 'russia' | 'cis' | 'world'>; label: string; hint: string }> = [
  { id: 'russia', label: 'Россия', hint: 'Только Россия' },
  { id: 'cis', label: 'СНГ', hint: 'Все страны СНГ, кроме России' },
  { id: 'world', label: 'Мир', hint: 'Все страны вне России и СНГ' },
]

const SECONDARY_USER_REGIONS: Array<{ id: Extract<AdminUserRegion, 'all' | 'none'>; label: string }> = [
  { id: 'all', label: 'Все пользователи' },
  { id: 'none', label: 'Не указана' },
]

const PERIODS: Array<{ id: AdminPaymentPeriod; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: 'yesterday', label: 'Вчера' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'all', label: 'Всё время' },
]

const STATUSES: Array<{ id: PaymentStatus | 'all'; label: string }> = [
  { id: 'succeeded', label: 'Оплачено' },
  { id: 'pending', label: 'Ожидает' },
  { id: 'canceled', label: 'Отменено' },
  { id: 'refunded', label: 'Возврат' },
  { id: 'all', label: 'Все статусы' },
]

const PLAN_LABEL: Record<PlanId, string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }

const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽'
const dateTime = (value?: string) => value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
const dateOnly = (value?: string) => value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(value)) : '—'

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось загрузить данные'
}

async function prepareSupportImage(file: File): Promise<SupportImageUpload> {
  return { data: (await prepareNoticeImage(file)).data }
}

export function AdminMobilePage() {
  const [section, setSection] = useState<Section>('summary')
  // Open requests and unread chats for the bottom bar, and the banner when a new one comes while the app is open.
  const [badges, setBadges] = useState<{ requests: number; chats: number } | null>(null)
  const [banner, setBanner] = useState<{ text: string; section: Section } | null>(null)
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [online, setOnline] = useState<AdminOnlineStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [regionCounts, setRegionCounts] = useState<AdminRegionCounts | null>(null)
  const [userFilter, setUserFilter] = useState<AdminUserFilter>('all')
  const [userRegion, setUserRegion] = useState<AdminUserRegion>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [payments, setPayments] = useState<AdminPayments | null>(null)
  const [period, setPeriod] = useState<AdminPaymentPeriod>('30d')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | 'all'>('succeeded')
  const [selected, setSelected] = useState<AdminUserDetail | null>(null)
  const [reports, setReports] = useState<BugReportList | null>(null)
  const [reportStatus, setReportStatus] = useState<BugReportStatus>('open')
  const [selectedReport, setSelectedReport] = useState<BugReportDetail | null>(null)
  const [requestView, setRequestView] = useState<'bugs' | 'ideas'>('bugs')
  const [threads, setThreads] = useState<AdminSupportThreads | null>(null)
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const loadOverview = useCallback(async () => {
    const [summary, presence] = await Promise.all([adminApi.overview(), adminApi.online()])
    setOverview(summary)
    setOnline(presence)
  }, [])
  const loadUsers = useCallback(async () => {
    const result = await adminApi.users(query, userFilter, userRegion)
    setUsers(result.users)
    setUsersTotal(result.total)
    setRegionCounts(result.regions)
  }, [query, userFilter, userRegion])
  const loadPayments = useCallback(async () => setPayments(await adminApi.payments(period, paymentStatus)), [period, paymentStatus])
  const loadReports = useCallback(async () => setReports(await adminApi.bugReports(reportStatus)), [reportStatus])
  const loadThreads = useCallback(async () => setThreads(await adminApi.supportThreads()), [])
  const chatChanged = useCallback(() => { void loadThreads() }, [loadThreads])
  const loadSection = useCallback(() => section === 'summary' ? Promise.resolve() : section === 'users' ? loadUsers() : section === 'payments' ? loadPayments() : section === 'chats' ? loadThreads() : loadReports(), [loadPayments, loadReports, loadThreads, loadUsers, section])

  useEffect(() => {
    let active = true
    const overviewRequest = Promise.all([adminApi.overview(), adminApi.online()]).then(([summary, presence]) => { if (active) { setOverview(summary); setOnline(presence) } })
    const sectionRequest = section === 'summary'
      ? Promise.resolve()
      : section === 'users'
        ? adminApi.users(query, userFilter, userRegion).then((result) => { if (active) { setUsers(result.users); setUsersTotal(result.total); setRegionCounts(result.regions) } })
        : section === 'payments'
          ? adminApi.payments(period, paymentStatus).then((result) => { if (active) setPayments(result) })
          : section === 'chats'
            ? adminApi.supportThreads().then((result) => { if (active) setThreads(result) })
            : adminApi.bugReports(reportStatus).then((result) => { if (active) setReports(result) })
    Promise.all([overviewRequest, sectionRequest])
      .catch((reason) => { if (active) setError(errorText(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [paymentStatus, period, query, reportStatus, section, userFilter, userRegion])

  useEffect(() => {
    const timer = window.setInterval(() => { void adminApi.online().then(setOnline).catch(() => undefined) }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // New requests and chat messages without a manual refresh (owner, 20.10.2026: «приложение само каждые 10–30 секунд
  // обновляет заявки, и появляется кружочек уведомления»); a rise shows a banner at the top while the app is open.
  useEffect(() => {
    let active = true
    let last: { requests: number; chats: number } | null = null
    const check = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const [open, chats] = await Promise.all([adminApi.bugReports('open', 1), adminApi.supportThreads(1)])
        if (!active) return
        const next = { requests: open.counts.open, chats: chats.unread }
        if (last && next.requests > last.requests) setBanner({ text: 'Новая заявка', section: 'requests' })
        else if (last && next.chats > last.chats) setBanner({ text: 'Новое сообщение в чате', section: 'chats' })
        last = next
        setBadges(next)
      } catch { /* offline: the dots stay as they were */ }
    }
    void check()
    const timer = window.setInterval(() => void check(), ADMIN_BADGE_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => {
    if (!banner) return
    const timer = window.setTimeout(() => setBanner(null), 6000)
    return () => window.clearTimeout(timer)
  }, [banner])

  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try { await Promise.all([loadOverview(), loadSection()]) }
    catch (reason) { setError(errorText(reason)) }
    finally { setRefreshing(false) }
  }

  const openUser = async (user: AdminUser) => {
    setError('')
    try { setSelected(await adminApi.user(user.id)) }
    catch (reason) { setError(errorText(reason)) }
  }

  const updateSelected = async (detail: AdminUserDetail) => {
    setSelected(detail)
    setUsers((current) => current.map((item) => item.id === detail.user.id ? detail.user : item))
    await loadOverview()
  }

  const openReport = async (id: number) => {
    setError('')
    try { setSelectedReport((await adminApi.bugReport(id)).report) }
    catch (reason) { setError(errorText(reason)) }
  }

  const openChat = (accountId: string) => {
    setSection('chats')
    setSelected(null)
    setSelectedReport(null)
    setSelectedThread(accountId)
  }

  const TABS: Array<{ id: Section; label: string; icon: typeof Users; badge?: number }> = [
    { id: 'summary', label: 'Сводка', icon: Activity },
    { id: 'payments', label: 'Платежи', icon: CreditCard },
    { id: 'users', label: 'Пользователи', icon: Users },
    { id: 'requests', label: 'Заявки', icon: MessageSquareWarning, badge: badges?.requests },
    { id: 'chats', label: 'Чаты', icon: MessagesSquare, badge: badges?.chats },
  ]
  const current = TABS.find((tab) => tab.id === section)!

  return (
    <div className="page admin-mobile-page has-tabbar">
      <header className="page-header admin-mobile-header">
        <div>
          <div className="eyebrow">RAID OS · OWNER</div>
          <h1 className="page-title">{uiText(current.label)}</h1>
        </div>
        <button type="button" className="icon-button" onClick={refresh} disabled={refreshing} aria-label={uiText('Обновить')}>
          <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
        </button>
      </header>

      {banner && <button type="button" className="admin-banner" role="status" onClick={() => { setSection(banner.section); setBanner(null) }}>
        <span className="admin-banner-icon">{banner.section === 'chats' ? <MessagesSquare size={18} /> : <MessageSquareWarning size={18} />}</span>
        <span><strong>Raid OS</strong><small>{uiText(banner.text)}</small></span>
      </button>}

      {error && <div className="admin-error" role="alert"><ShieldCheck size={18} /><span>{uiText(error)}</span></div>}

      {section === 'summary' ? <>
        <OverviewCards data={overview} />
        {overview?.plans && <PlanTable title="Подписки по срокам" columns={[{ title: 'Этот месяц', plans: overview.plans.month }, { title: 'Всё время', plans: overview.plans.all }]} />}
        {overview?.squads && <SquadStats squads={overview.squads} />}
        <OnlineStatsBlock data={online} />
      </> : loading ? <AdminLoading /> : section === 'users' ? (
        <UsersSection users={users} total={usersTotal} region={userRegion} regions={regionCounts} filter={userFilter} search={search} onRegion={setUserRegion} onFilter={setUserFilter} onSearch={setSearch} onOpen={openUser} />
      ) : section === 'payments' ? <>
        <PaymentsSection data={payments} period={period} status={paymentStatus} onPeriod={setPeriod} onStatus={setPaymentStatus} onChanged={loadPayments} />
      </> : section === 'chats' ? (
        <ChatsSection threads={threads} onOpenChat={openChat} />
      ) : (
        <RequestsSection view={requestView} onView={setRequestView} data={reports} status={reportStatus} onStatus={setReportStatus} onOpen={openReport} />
      )}

      <nav className="admin-tabbar" aria-label={uiText('Разделы админ-панели')}>
        {TABS.map(({ id, label, icon: Icon, badge }) => <button type="button" key={id} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined} aria-label={uiText(badge ? `${label}, новых: ${badge}` : label)} onClick={() => setSection(id)}>
          <span className="admin-tab-icon"><Icon size={20} />{badge ? <i className="admin-tab-badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</i> : null}</span>
          <span>{uiText(label)}</span>
        </button>)}
      </nav>

      {selected && <UserSheet detail={selected} onClose={() => setSelected(null)} onUpdated={updateSelected} onOpenChat={openChat} />}
      {selectedReport && <ReportSheet detail={selectedReport} onClose={() => setSelectedReport(null)} onOpenChat={openChat} onUpdated={(report) => { setSelectedReport(report); void loadReports() }} />}
      {selectedThread && <ChatSheet accountId={selectedThread} onClose={() => setSelectedThread(null)} onChanged={chatChanged} />}
    </div>
  )
}

function RequestsSection({ view, onView, data, status, onStatus, onOpen }: {
  view: 'bugs' | 'ideas'; onView: (view: 'bugs' | 'ideas') => void; data: BugReportList | null
  status: BugReportStatus; onStatus: (status: BugReportStatus) => void; onOpen: (id: number) => void
}) {
  const reports = (data?.reports ?? []).filter((report) => view === 'ideas' ? report.kind === 'idea' : report.kind !== 'idea')
  const bugCount = (data?.reports ?? []).filter((report) => report.kind !== 'idea').length
  const ideaCount = (data?.reports ?? []).filter((report) => report.kind === 'idea').length
  return <section className="admin-block">
    <div className="admin-request-head">
      <button type="button" className={view === 'bugs' ? 'active' : ''} onClick={() => onView('bugs')}><span>{uiText('Ошибки и проблемы')}</span><strong>{bugCount}</strong></button>
      <button type="button" className={view === 'ideas' ? 'active' : ''} onClick={() => onView('ideas')}><span>{uiText('Предложения')}</span><strong>{ideaCount}</strong></button>
    </div>
    <div className="admin-chip-row admin-request-filters" role="group" aria-label={uiText('Статус заявок')}>
      <button type="button" className={status === 'open' ? 'active' : ''} onClick={() => onStatus('open')}>{uiText('Новые и в работе')}</button>
      <button type="button" className={status === 'closed' ? 'active' : ''} onClick={() => onStatus('closed')}>{uiText('Закрытые')}</button>
    </div>
    <div className="admin-list">
      {reports.map((report) => <button type="button" className="admin-user-row admin-request-row" key={report.id} onClick={() => onOpen(report.id)}>
        <span className={`admin-payment-icon ${report.status === 'open' ? 'pending' : 'succeeded'}`}><MessageSquareWarning size={18} /></span>
        <span className="admin-row-copy"><strong>{report.topic}</strong><small>{uiText(report.kind === 'idea' ? 'Предложение' : 'Заявка')} · {report.email ?? uiText('Без почты')}</small></span>
        <span className="admin-row-side">{report.files > 0 && <strong className="admin-attachment"><Paperclip size={13} />{report.files}</strong>}<small>{dateTime(report.createdAt)}</small></span>
        <ChevronRight size={17} />
      </button>)}
      {!reports.length && <AdminEmpty text={view === 'ideas' ? 'Предложений в этой категории нет' : status === 'open' ? 'Новых сообщений об ошибках нет' : 'Закрытых сообщений об ошибках нет'} />}
    </div>
  </section>
}

/** «Чаты» (its own tab, owner 20.10.2026): the players' support conversations, unread ones marked. */
function ChatsSection({ threads, onOpenChat }: { threads: AdminSupportThreads | null; onOpenChat: (accountId: string) => void }) {
  return <section className="admin-block">
    <div className="admin-list admin-chat-list">
      {(threads?.threads ?? []).map((thread) => <button type="button" className={`admin-user-row admin-chat-row${thread.unread ? ' is-unread' : ''}`} key={thread.accountId} onClick={() => onOpenChat(thread.accountId)}>
        <span className="admin-payment-icon pending"><MessagesSquare size={18} /></span>
        <span className="admin-row-copy"><strong>{thread.nickname || thread.email || uiText('Пользователь')}</strong><small>{thread.lastMessage.author === 'owner' ? `${uiText('Вы')}: ` : ''}{thread.lastMessage.text}</small></span>
        <span className="admin-row-side">{thread.unread > 0 && <strong className="admin-unread">{thread.unread}</strong>}<small>{dateTime(thread.lastAt)}</small></span>
        <ChevronRight size={17} />
      </button>)}
      {!threads?.threads.length && <AdminEmpty text="Переписок пока нет" />}
    </div>
  </section>
}

function ReportSheet({ detail, onClose, onUpdated, onOpenChat }: { detail: BugReportDetail; onClose: () => void; onUpdated: (report: BugReportDetail) => void; onOpenChat: (accountId: string) => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [images, setImages] = useState<Record<number, string>>({})
  const [expanded, setExpanded] = useState('')
  const [reply, setReply] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [rewardDays, setRewardDays] = useState('')

  useEffect(() => {
    let active = true
    Promise.all(detail.files.map(async (file) => [file.idx, await adminApi.bugReportImage(detail.id, file.idx)] as const))
      .then((entries) => { if (active) setImages(Object.fromEntries(entries)) })
      .catch((reason) => { if (active) setError(errorText(reason)) })
    return () => { active = false }
  }, [detail.files, detail.id])

  const toggle = async () => {
    setSaving(true); setError('')
    try { onUpdated((await adminApi.setBugReportStatus(detail.id, detail.status === 'open' ? 'closed' : 'open')).report) }
    catch (reason) { setError(errorText(reason)) }
    finally { setSaving(false) }
  }
  const answer = async () => {
    if (!detail.accountId || (!reply.trim() && !photo)) return
    setSaving(true); setError(''); setMessage('')
    try {
      await adminApi.supportReply(detail.accountId, reply.trim(), photo ? [await prepareSupportImage(photo)] : [])
      setReply(''); setPhoto(null); setMessage('Ответ отправлен пользователю')
    } catch (reason) { setError(errorText(reason)) }
    finally { setSaving(false) }
  }
  const reward = async () => {
    const days = Number(rewardDays)
    if (!Number.isInteger(days) || days < 1 || days > 365) { setError('Укажите от 1 до 365 дней'); return }
    setSaving(true); setError(''); setMessage('')
    try {
      const updated = (await adminApi.rewardReport(detail.id, days)).report
      onUpdated(updated); setRewardDays(''); setMessage(`Начислено ${days} дней`)
    } catch (reason) { setError(errorText(reason)) }
    finally { setSaving(false) }
  }
  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet" role="dialog" aria-modal="true" aria-label={uiText(detail.topic)}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{detail.topic}</strong><small>{detail.email ?? uiText('Без почты')}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-sheet-scroll">
        <div className="admin-user-facts">
          <article><span>{uiText('Статус')}</span><strong>{uiText(detail.status === 'open' ? 'Открыта' : 'Закрыта')}</strong></article>
          <article><span>{uiText('Создана')}</span><strong>{dateTime(detail.createdAt)}</strong></article>
          <article><span>{uiText('Платформа')}</span><strong>{detail.platform || '—'}</strong><small>{detail.appVersion || ''}</small></article>
          <article><span>{uiText('Вложения')}</span><strong>{detail.files.length}</strong></article>
        </div>
        <div className="admin-report-description"><h2>{uiText('Сообщение')}</h2><p>{detail.description}</p></div>
        {detail.files.length > 0 && <div className="admin-report-gallery">
          <div className="admin-report-files"><Paperclip size={16} /><span>{uiText(`Прикреплено файлов: ${detail.files.length}`)}</span></div>
          <div className="admin-report-images">{detail.files.map((file) => images[file.idx]
            ? <button type="button" key={file.idx} onClick={() => setExpanded(images[file.idx]!)} aria-label={uiText('Увеличить скриншот')}><img src={images[file.idx]} alt={uiText(`Вложение ${file.idx + 1}`)} /><span><Maximize2 size={14} />{uiText('Открыть')}</span></button>
            : <div className="admin-report-image-loading" key={file.idx}><LoaderCircle className="spin" size={20} /></div>)}</div>
        </div>}
        {detail.accountId && <div className="admin-report-reply">
          <h2>{uiText('Ответ пользователю')}</h2>
          <textarea className="input" rows={4} maxLength={2000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={uiText('Напишите ответ по заявке…')} />
          <div className="admin-report-reply-actions">
            <label className="button ghost"><ImagePlus size={16} />{uiText(photo ? 'Фото выбрано' : 'Добавить фото')}<input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label>
            <button type="button" className="button primary" disabled={saving || (!reply.trim() && !photo)} onClick={() => void answer()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{uiText('Отправить')}</button>
          </div>
          {photo && <small className="admin-report-photo-name">{photo.name}</small>}
        </div>}
        {detail.accountId && <div className="admin-report-reward">
          <div><Gift size={18} /><span><strong>{uiText('Начислить дни')}</strong><small>{uiText(detail.rewardDays ? `Уже начислено по отчёту: ${detail.rewardDays} дн.` : 'Подписка будет продлена сразу')}</small></span></div>
          <div><input className="input" inputMode="numeric" value={rewardDays} onChange={(event) => setRewardDays(event.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Дни" /><button type="button" className="button" disabled={saving || !rewardDays} onClick={() => void reward()}>{uiText('Начислить')}</button></div>
        </div>}
        {error && <div className="admin-inline-error">{uiText(error)}</div>}
        {message && <div className="admin-inline-success"><Check size={16} />{uiText(message)}</div>}
        {detail.accountId && <button type="button" className="button admin-report-action" onClick={() => onOpenChat(detail.accountId!)}><MessagesSquare size={17} />{uiText('Открыть чат')}</button>}
        <button type="button" className={`button admin-report-action${detail.status === 'open' ? ' primary' : ''}`} disabled={saving} onClick={toggle}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{uiText(detail.status === 'open' ? 'Закрыть заявку' : 'Вернуть в работу')}</button>
      </div>
      {expanded && <div className="admin-report-lightbox" role="dialog" aria-modal="true" aria-label={uiText('Просмотр скриншота')} onClick={() => setExpanded('')}><button type="button" className="icon-button" aria-label={uiText('Закрыть')} onClick={() => setExpanded('')}><X size={22} /></button><img src={expanded} alt={uiText('Скриншот отчёта')} onClick={(event) => event.stopPropagation()} /></div>}
    </section>
  </div>
}

/** The cards of «Сводка», as on the site: users, real paid subscriptions, the trial, the new ones of 30 days, the money. */
function OverviewCards({ data }: { data: AdminOverview | null }) {
  return (
    <section className="admin-overview" aria-label={uiText('Сводка')}>
      <article><span><Users size={16} />{uiText('Пользователи')}</span><strong>{data?.users.total ?? '—'}</strong><small>{uiText(`+${data?.users.today ?? 0} сегодня`)}</small></article>
      <article><span><ShieldCheck size={16} />{uiText('Платные подписки')}</span><strong>{data?.subscriptions.active ?? '—'}</strong><small>{uiText('реально оплаченные')}</small></article>
      <article><span><Gift size={16} />{uiText('Пробный')}</span><strong>{data?.subscriptions.trials ?? '—'}</strong><small>{uiText('сейчас на пробном')}</small></article>
      <article><span><UserPlus size={16} />{uiText('Новые за 30 дней')}</span><strong>{data?.users.days30 ?? '—'}</strong><small>{uiText(`+${data?.users.days7 ?? 0} за 7 дней`)}</small></article>
      <article><span><BadgeRussianRuble size={16} />{uiText('За месяц')}</span><strong>{data ? money(data.revenue.month.total) : '—'}</strong><small>{uiText(`${data?.revenue.month.payments ?? 0} оплат`)}</small></article>
      <article><span><CalendarDays size={16} />{uiText('За всё время')}</span><strong>{data ? money(data.revenue.all.total) : '—'}</strong><small>{uiText(`${data?.revenue.all.payments ?? 0} оплат`)}</small></article>
    </section>
  )
}

type PlanCounts = Record<PlanId, { count: number; revenue: number }>
const PLAN_IDS: PlanId[] = ['1m', '3m', '6m', '12m']

/** Paid subscriptions of each term: 1, 3, 6 and 12 months, in one or two columns (this month, all the time). */
function PlanTable({ title, columns }: { title: string; columns: Array<{ title: string; plans?: PlanCounts }> }) {
  return <section className="admin-block admin-plan-table" aria-label={uiText(title)}>
    <div className="admin-block-heading"><CalendarDays size={15} /><span>{uiText(title)}</span></div>
    <div className="admin-plan-rows" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${columns.length}, minmax(0, 1fr))` }}>
      <span className="header" />
      {columns.map((column) => <span className="header" key={column.title}>{uiText(column.title)}</span>)}
      {PLAN_IDS.map((plan) => <Fragment key={plan}>
        <span>{uiText(PLAN_LABEL[plan])}</span>
        {columns.map((column) => <span key={column.title}><strong>{column.plans?.[plan]?.count ?? 0}</strong><small>{money(column.plans?.[plan]?.revenue ?? 0)}</small></span>)}
      </Fragment>)}
    </div>
  </section>
}

/** «Отряды»: created, disbanded, active now and the players in them (the hideout is not counted, owner 20.10.2026). */
function SquadStats({ squads }: { squads: NonNullable<AdminOverview['squads']> }) {
  return <section className="admin-block" aria-label={uiText('Отряды')}>
    <div className="admin-block-heading"><Users size={15} /><span>{uiText('Отряды')}</span>{squads.since && <small>{uiText(`с ${dateOnly(squads.since)}`)}</small>}</div>
    <div className="admin-mini-grid">
      <article><span>{uiText('Создано')}</span><strong>{squads.created}</strong><small>{uiText(`+${squads.created30} за 30 дней`)}</small></article>
      <article><span>{uiText('Активные')}</span><strong>{squads.active}</strong><small>{uiText(`${squads.players} игроков`)}</small></article>
      <article><span>{uiText('Распущено')}</span><strong>{squads.disbanded}</strong><small>{uiText('всего')}</small></article>
    </div>
  </section>
}


function OnlineStatsBlock({ data }: { data: AdminOnlineStats | null }) {
  const today = data?.today
  const [allDays, setAllDays] = useState(false)
  return <section className="admin-online admin-block" aria-label={uiText('Статистика онлайна')}>
    <div className="admin-online-head">
      <div><span className="admin-online-icon"><Wifi size={19} /></span><div><strong>{uiText('Статистика онлайна')}</strong><small>{uiText(`Активность за последние ${data?.windowMinutes ?? 10} минут`)}</small></div></div>
      <strong className="admin-online-now"><i />{data?.current ?? '—'} <small>{uiText('сейчас')}</small></strong>
    </div>
    <div className="admin-online-today">
      <article><span>{uiText('За день')}</span><strong>{today?.users ?? '—'}</strong><small>{uiText('уникальных пользователей')}</small></article>
      <article><span>{uiText('Максимум')}</span><strong>{today?.maximum ?? '—'}</strong><small>{uiText('одновременно')}</small></article>
      <article><span>{uiText('Минимум')}</span><strong>{today?.minimum ?? '—'}</strong><small>{uiText('одновременно')}</small></article>
      <article><span>{uiText('В среднем')}</span><strong>{today?.average ?? '—'}</strong><small>{uiText('одновременно')}</small></article>
    </div>
    {(data?.history.length ?? 0) > 0 && <div className="admin-online-history">
      <div className="admin-online-history-title"><Activity size={15} /><span>{uiText('История по дням')}</span></div>
      <div className="admin-online-table">
        <div className="admin-online-row header"><span>{uiText('Дата')}</span><span>{uiText('За день')}</span><span>{uiText('Мин.')}</span><span>{uiText('Сред.')}</span><span>{uiText('Макс.')}</span></div>
        {data!.history.slice(0, allDays ? data!.history.length : ONLINE_DAYS_FOLDED).map((row) => <div className="admin-online-row" key={row.date}><span>{new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(`${row.date}T12:00:00Z`))}</span><strong>{row.users}</strong><span>{row.minimum}</span><span>{row.average}</span><strong>{row.maximum}</strong></div>)}
      </div>
      {data!.history.length > ONLINE_DAYS_FOLDED && <button type="button" className="button ghost admin-online-more" aria-expanded={allDays} onClick={() => setAllDays(!allDays)}>
        <ChevronRight size={15} className={allDays ? 'is-open' : ''} />{uiText(allDays ? 'Свернуть' : `Показать все дни (${data!.history.length})`)}
      </button>}
    </div>}
  </section>
}

function UsersSection({ users, total, region, regions, filter, search, onRegion, onFilter, onSearch, onOpen }: {
  users: AdminUser[]; total: number; region: AdminUserRegion; regions: AdminRegionCounts | null; filter: AdminUserFilter; search: string
  onRegion: (value: AdminUserRegion) => void; onFilter: (value: AdminUserFilter) => void; onSearch: (value: string) => void; onOpen: (user: AdminUser) => void
}) {
  return (
    <section className="admin-block">
      <div className="admin-block-title"><div><span>{uiText('Список пользователей')}</span><strong>{total}</strong></div></div>
      <label className="admin-search"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={uiText('Поиск по почте')} aria-label={uiText('Поиск по почте')} />{search && <button type="button" onClick={() => onSearch('')} aria-label={uiText('Очистить')}><X size={16} /></button>}</label>
      <div className="admin-region-summary" role="group" aria-label={uiText('Пользователи по регионам')}>
        {PRIMARY_USER_REGIONS.map((item) => <button type="button" key={item.id} className={region === item.id ? 'active' : ''} onClick={() => onRegion(item.id)}><span>{uiText(item.label)}</span><strong>{regions?.[item.id] ?? '—'}</strong><small>{uiText(item.hint)}</small></button>)}
      </div>
      <div className="admin-chip-row admin-region-secondary" role="group" aria-label={uiText('Дополнительные категории')}>
        {SECONDARY_USER_REGIONS.map((item) => <button type="button" key={item.id} className={region === item.id ? 'active' : ''} onClick={() => onRegion(item.id)}>{uiText(item.label)}{regions && <strong>{regions[item.id]}</strong>}</button>)}
      </div>
      <p className="admin-region-note">{uiText('После указания страны пользователь автоматически попадает в соответствующий регион.')}</p>
      <div className="admin-chip-row" role="group" aria-label={uiText('Фильтр пользователей')}>
        {USER_FILTERS.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => onFilter(item.id)}>{uiText(item.label)}</button>)}
      </div>
      <div className="admin-list">
        {users.map((user) => <button type="button" className="admin-user-row" key={user.id} onClick={() => onOpen(user)}>
          <span className={`admin-avatar ${user.subscription.status}`}>{user.email.slice(0, 1).toUpperCase()}</span>
          <span className="admin-row-copy"><strong>{user.email}</strong><small>{user.country ? countryName(user.country, 'ru') + ' · ' : ''}{subscriptionText(user)} · {uiText(`оплат: ${user.payments.count}`)}</small></span>
          <span className="admin-row-side"><strong>{money(user.payments.total)}</strong><small>{dateOnly(user.createdAt)}</small></span>
          <ChevronRight size={17} />
        </button>)}
        {!users.length && <AdminEmpty text={search ? 'Пользователь не найден' : 'В этой категории пока нет пользователей'} />}
      </div>
    </section>
  )
}

function PaymentsSection({ data, period, status, onPeriod, onStatus, onChanged }: {
  data: AdminPayments | null; period: AdminPaymentPeriod; status: PaymentStatus | 'all'
  onPeriod: (value: AdminPaymentPeriod) => void; onStatus: (value: PaymentStatus | 'all') => void
  /** A payment amount was changed: the list and the totals are read again. */
  onChanged?: () => Promise<unknown> | void
}) {
  const serverPlans = data?.totals.plans
  const breakdown = useMemo(() => {
    const result: Record<PlanId, { count: number; total: number }> = {
      '1m': { count: 0, total: 0 }, '3m': { count: 0, total: 0 }, '6m': { count: 0, total: 0 }, '12m': { count: 0, total: 0 },
    }
    for (const payment of data?.payments ?? []) if (payment.status === 'succeeded') {
      result[payment.plan].count += 1
      result[payment.plan].total += payment.amount
    }
    if (serverPlans) for (const plan of PLAN_IDS) result[plan] = { count: serverPlans[plan]?.count ?? 0, total: serverPlans[plan]?.revenue ?? 0 }
    return result
  }, [data, serverPlans])

  return (
    <section className="admin-block">
      <div className="admin-filter-grid">
        <label><span>{uiText('Период')}</span><select className="select" value={period} onChange={(event) => onPeriod(event.target.value as AdminPaymentPeriod)}>{PERIODS.map((item) => <option key={item.id} value={item.id}>{uiText(item.label)}</option>)}</select></label>
        <label><span>{uiText('Статус')}</span><select className="select" value={status} onChange={(event) => onStatus(event.target.value as PaymentStatus | 'all')}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{uiText(item.label)}</option>)}</select></label>
      </div>
      <div className="admin-payment-total">
        <span><Check size={18} />{uiText('Оплачено')}</span><strong>{money(data?.totals.revenue ?? 0)}</strong><small>{uiText(`${data?.totals.succeeded ?? 0} успешных платежей`)}</small>
        {data?.totals.net !== undefined && <small className="admin-payment-net">{uiText(`Чистыми: ${money(data.totals.net)}`)}</small>}
      </div>
      <div className="admin-plan-grid">
        {(Object.keys(breakdown) as PlanId[]).map((plan) => <article key={plan}><span>{PLAN_LABEL[plan]}</span><strong>{breakdown[plan].count}</strong><small>{money(breakdown[plan].total)}</small></article>)}
      </div>
      <div className="admin-list admin-payment-list">
        {(data?.payments ?? []).map((payment) => <PaymentRow key={payment.id} payment={payment} onChanged={onChanged} />)}
        {!data?.payments.length && <AdminEmpty text="За выбранный период платежей нет" />}
      </div>
    </section>
  )
}

const PROVIDER_TEXT: Record<string, string> = { yookassa: 'ЮKassa', boosty: 'Boosty', bezebee: 'BZB', archive: 'Архив', lava: 'Архив' }
const accountText = (email?: string, nickname?: string) => (email ? `${email}${nickname ? ` · ${nickname}` : ''}` : 'аккаунт удалён')

/** Where the payer came from (owner, 17.10.2026: «от кого человек пришёл»): a friend with his account, a streamer's code, nobody. */
function originText(payment: AdminPayment) {
  const inviter: { email?: string; nickname?: string; deleted?: true } | undefined = payment.invitedBy ?? (payment.friendDiscount && (payment.friendDiscount.inviter || payment.friendDiscount.inviterDeleted) ? { email: payment.friendDiscount.inviter, deleted: payment.friendDiscount.inviterDeleted } : undefined)
  if (inviter) return `Пришёл по приглашению: ${accountText(inviter.deleted ? undefined : inviter.email, inviter.nickname)}`
  if (payment.friendDiscount) return 'Пришёл по коду друга'
  return payment.referralCode ? `Пришёл по коду стримера ${payment.referralCode}` : 'Пришёл без приглашения'
}

/** A payment in plain words: who paid, where he came from, plan, Boosty or ЮKassa, discount; «Изменить сумму» when `onChanged`. */
function PaymentRow({ payment, onChanged }: { payment: AdminPayment; onChanged?: () => Promise<unknown> | void }) {
  const [editing, setEditing] = useState(false)
  const details = [PLAN_LABEL[payment.plan], PROVIDER_TEXT[payment.provider] ?? payment.provider, statusText(payment.status), payment.friendDiscount ? `скидка друга −${payment.friendDiscount.percent} %` : ''].filter(Boolean).join(' · ')
  return <article className={`admin-payment-row${editing ? ' is-editing' : ''}`}>
    <span className={`admin-payment-icon ${payment.status}`}><CreditCard size={18} /></span>
    <span className="admin-row-copy">
      <strong title={payment.email}>{uiText('Оплатил:')} {accountText(payment.email, payment.nickname)}</strong>
      <small className="admin-payment-origin">{uiText(originText(payment))}</small>
      <small>{uiText(details)}</small>
    </span>
    <span className="admin-row-side">
      <strong>{money(payment.amount)}</strong>
      {payment.netAmount !== undefined && payment.netAmount !== payment.amount && <small className="admin-payment-net">{uiText(`чистыми ${money(payment.netAmount)}`)}</small>}
      {payment.amountEdited && <small className="admin-payment-edited">{uiText(`изменено, было ${money(payment.amountEdited.before)}`)}</small>}
      <small>{dateTime(payment.paidAt ?? payment.createdAt)}</small>
      {onChanged && payment.provider !== 'archive' && payment.provider !== 'lava' && !editing && <button type="button" className="button small ghost admin-payment-edit" onClick={() => setEditing(true)}>{uiText('Изменить сумму')}</button>}
    </span>
    {editing && onChanged && <PaymentAmountEditor payment={payment} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await onChanged() }} />}
  </article>
}

/** «Изменить сумму» (owner, 17.10.2026): the new amount, an optional comment, the old amount in sight. */
function PaymentAmountEditor({ payment, onCancel, onSaved }: { payment: AdminPayment; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(String(payment.amount))
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const amount = Number(value.replace(',', '.').replace(/\s/g, ''))
  const valid = value.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000 && Math.abs(Math.round(amount * 100) - amount * 100) < 1e-6
  const save = async () => {
    if (!valid || saving) return
    setSaving(true); setError('')
    try {
      await adminApi.setPaymentAmount(payment.id, amount, comment.trim() || undefined)
      await onSaved()
    } catch (reason) { setError(errorText(reason)); setSaving(false) }
  }
  return <div className="admin-amount-editor">
    <small>{uiText(`Было: ${money(payment.amount)}${payment.amountEdited ? ` (до первого изменения ${money(payment.amountEdited.before)})` : ''}`)}</small>
    <label><span>{uiText('Новая сумма, ₽')}</span><input className="input" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} aria-invalid={!valid} autoFocus /></label>
    <label><span>{uiText('Комментарий (необязательно)')}</span><input className="input" value={comment} maxLength={200} onChange={(event) => setComment(event.target.value)} /></label>
    {error && <div className="admin-inline-error">{uiText(error)}</div>}
    <div className="admin-amount-buttons">
      <button type="button" className="button primary" disabled={!valid || saving} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{uiText('Сохранить')}</button>
      <button type="button" className="button ghost" disabled={saving} onClick={onCancel}>{uiText('Отмена')}</button>
    </div>
  </div>
}

function UserSheet({ detail, onClose, onUpdated, onOpenChat }: { detail: AdminUserDetail; onClose: () => void; onUpdated: (detail: AdminUserDetail) => Promise<void>; onOpenChat: (accountId: string) => void }) {
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState<'days' | 'months'>('months')
  const [reason, setReason] = useState('Оплата через BZB')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const user = detail.user
  const number = Number(amount)
  const days = Number.isInteger(number) && number > 0 ? (unit === 'months' ? monthsToDays(number) : number) : 0
  const valid = days >= 1 && days <= 3650 && reason.trim().length >= 2

  const grant = async () => {
    if (!valid) return
    const label = unit === 'months' ? `${number} мес. (${days} дней)` : `${days} дней`
    if (!window.confirm(`Выдать ${label} пользователю ${user.email}?`)) return
    setSaving(true); setError(''); setMessage('')
    try {
      const next = await adminApi.grant(user.id, days, reason.trim())
      await onUpdated(next)
      setMessage(`Подписка выдана до ${dateOnly(next.user.subscription.paidUntil)}`)
    } catch (reasonError) { setError(errorText(reasonError)) }
    finally { setSaving(false) }
  }

  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet" role="dialog" aria-modal="true" aria-label={uiText(`Пользователь ${user.email}`)}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{user.email}</strong><small>{subscriptionText(user)}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-sheet-scroll">
        <div className="admin-user-facts">
          <article><span>{uiText('Подписка до')}</span><strong>{user.subscription.lifetime ? uiText('Навсегда') : dateOnly(user.subscription.paidUntil ?? user.subscription.trialEndsAt)}</strong></article>
          <article><span>{uiText('Всего оплат')}</span><strong>{user.payments.count}</strong><small>{money(user.payments.total)}</small></article>
          <article><span>{uiText('Регистрация')}</span><strong>{dateOnly(user.createdAt)}</strong></article>
          <article><span>{uiText('Пригласил')}</span><strong>{user.referredBy ?? '—'}</strong><small>{user.referralCode ? uiText(`код ${user.referralCode}`) : ''}</small></article>
          <article><span>{uiText('Страна')}</span><strong>{user.country ? countryName(user.country, 'ru') : uiText('Не указана')}</strong></article>
          <article><span>{uiText('Ник в игре')}</span><strong>{user.nickname ?? '—'}</strong></article>
        </div>

        <button type="button" className="button admin-open-chat" onClick={() => onOpenChat(user.id)}><MessagesSquare size={17} />{uiText('Открыть чат')}</button>

        <div className="admin-grant-card">
          <div className="admin-card-heading"><UserPlus size={18} /><div><strong>{uiText('Выдать подписку')}</strong><small>{uiText('Укажите любое количество дней или месяцев')}</small></div></div>
          <div className="admin-grant-shortcuts">{[1, 3, 6, 12].map((value) => <button type="button" key={value} onClick={() => { setUnit('months'); setAmount(String(value)) }} className={unit === 'months' && amount === String(value) ? 'active' : ''}>{value} мес.</button>)}</div>
          <div className="admin-grant-fields">
            <label><span>{uiText('Количество')}</span><input className="input" type="number" min="1" max={unit === 'days' ? 3650 : 120} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
            <label><span>{uiText('Единица')}</span><select className="select" value={unit} onChange={(event) => setUnit(event.target.value as 'days' | 'months')}><option value="days">{uiText('Дни')}</option><option value="months">{uiText('Месяцы')}</option></select></label>
          </div>
          <label className="admin-reason"><span>{uiText('Причина')}</span><input className="input" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} /></label>
          {unit === 'months' && valid && <small className="admin-conversion"><Clock3 size={14} />{uiText(`Будет начислено ${days} дней`)}</small>}
          {error && <div className="admin-inline-error">{uiText(error)}</div>}
          {message && <div className="admin-inline-success"><Check size={16} />{uiText(message)}</div>}
          <button type="button" className="button primary admin-grant-submit" disabled={!valid || saving} onClick={grant}>{saving ? <LoaderCircle size={17} className="spin" /> : <UserPlus size={17} />}{uiText(saving ? 'Выдаём…' : 'Выдать подписку')}</button>
        </div>

        <div className="admin-history">
          <h2>{uiText('Последние платежи')}</h2>
          {detail.payments.map((payment) => <PaymentRow key={payment.id} payment={payment} onChanged={async () => onUpdated(await adminApi.user(user.id))} />)}
          {!detail.payments.length && <AdminEmpty text="Платежей пока нет" />}
          <h2>{uiText('Ручные начисления')}</h2>
          {detail.grants.map((grant, index) => <article className="admin-grant-row" key={`${grant.at}-${index}`}><span><strong>+{grant.days} дн.</strong><small>{grant.reason}</small></span><span><strong>{dateOnly(grant.paidUntil)}</strong><small>{dateTime(grant.at)}</small></span></article>)}
          {!detail.grants.length && <AdminEmpty text="Ручных начислений пока нет" />}
        </div>
      </div>
    </section>
  </div>
}

function ChatSheet({ accountId, onClose, onChanged }: { accountId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<AdminSupportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const next = await adminApi.supportThread(accountId)
      setDetail(next)
      setError('')
      await adminApi.supportRead(accountId).catch(() => undefined)
      onChanged()
    } catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }, [accountId, onChanged])

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 30_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [load])

  const reply = async (text: string, images: SupportImageUpload[]) => {
    await adminApi.supportReply(accountId, text, images)
    await load()
  }
  const remove = async () => {
    if (!window.confirm(uiText('Удалить переписку без возможности восстановления?'))) return
    setDeleting(true); setError('')
    try {
      await adminApi.supportDelete(accountId)
      onChanged()
      onClose()
    } catch (reason) { setError(errorText(reason)); setDeleting(false) }
  }
  const name = detail?.account.nickname || detail?.account.email || uiText('Чат с пользователем')
  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet admin-chat-sheet" role="dialog" aria-modal="true" aria-label={name}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{name}</strong><small>{detail?.account.email ?? uiText('Загружаем переписку…')}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-chat-body">
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        <SupportMessageList messages={detail?.messages ?? []} viewer="owner" otherName={name} loading={loading} error={error} onRetry={() => void load()} emptyText="Сообщений пока нет." />
        <SupportComposer onSend={reply} placeholder="Ответ пользователю…" allowImages />
        <button type="button" className="button danger admin-delete-chat" disabled={deleting} onClick={() => void remove()}>{deleting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}{uiText(deleting ? 'Удаляем…' : 'Удалить чат с сервера')}</button>
        <small className="admin-delete-note">{uiText('После удаления переписка не хранится в рабочей базе и не попадает в управляемые резервные копии.')}</small>
      </div>
    </section>
  </div>
}

function subscriptionText(user: AdminUser) {
  if (user.blockedAt) return uiText('Заблокирован')
  if (user.subscription.lifetime) return uiText('Пожизненная подписка')
  if (user.subscription.status === 'active') return uiText(`активна до ${dateOnly(user.subscription.paidUntil)}`)
  if (user.subscription.status === 'trial') return uiText(`пробная до ${dateOnly(user.subscription.trialEndsAt)}`)
  return uiText('подписки нет')
}

function statusText(status: PaymentStatus) {
  return uiText({ succeeded: 'оплачено', pending: 'ожидает', canceled: 'отменено', refunded: 'возврат' }[status])
}

function AdminLoading() {
  return <div className="admin-loading" role="status"><LoaderCircle size={28} className="spin" /><span>{uiText('Загружаем данные…')}</span></div>
}

function AdminEmpty({ text }: { text: string }) {
  return <div className="admin-empty"><span>{uiText(text)}</span></div>
}
