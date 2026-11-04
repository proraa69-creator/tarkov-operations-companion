import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import {
  Activity, ArrowLeft, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, CreditCard, Gift, ImagePlus, LineChart, LoaderCircle,
  Maximize2, MessagesSquare, MessageSquareWarning, Paperclip, Radio, RefreshCw, Search, Send, Shield, ShieldCheck, Trash2, UserPlus, Users, Wifi, WifiOff, X,
} from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { prepareNoticeImage } from '../notices/imageResize'
import { countryName } from '../shared/countries'
import { NEW_USERS_PERIODS, newUsersRange, ownerDayAgo, ownerRangeText, type NewUsersPeriod } from '../shared/ownerTime'
import { SupportComposer, SupportMessageList, SupportReportCard } from '../support/SupportChat'
import type { SupportImageUpload } from '../support/supportChatClient'
import {
  adminApi, adminKept, adminPaths, monthsToDays, type AdminOnlineStats, type AdminOverview, type AdminPaymentPeriod, type AdminPaymentQuery, type AdminPayments,
  type AdminRangeStats, type AdminRegionCounts, type AdminRevenue, type AdminSupportDetail, type AdminSupportThreads, type AdminUser, type AdminUserDetail,
  type AdminUserFilter, type AdminUserRegion, type BugReportDetail,
  type PaymentStatus, type PlanId,
} from './adminApi'
import { ReportsTable } from '../reports/ReportsTable'
import { REPORT_WORK_LABELS, type ReportTableView } from '../shared/reportWork'
import { OPEN_REPORT_EVENT } from './useAdminNotifications'
import { count, dateOnly, dateTime, errorText, money, PLAN_IDS, PLAN_LABEL } from './adminFormat'
import { AdminEmpty, AdminLoading, PaymentRow } from './adminShared'
import { RegistrationsBlock } from './AdminRegistrations'
import { ReferralsSheet } from './AdminReferralsSheet'
import { StreamersSheet } from './AdminStreamersSheet'
import { UpdateHistorySheet } from './AdminUpdateHistorySheet'
import { History as HistoryIcon } from 'lucide-react'
import { useAdminAnswer, type AdminAnswer } from './useAdminAnswer'
import './adminMobile.css'

/**
 * The admin app's sections, one bottom bar (owner, 20.10.2026: «снизу панель управления: сводка, платежи, пользователи,
 * заявки, чаты»; 05.11.2026: «блок заявки переделай на блок отчеты»); the app opens on «Сводка».
 */
type Section = 'summary' | 'payments' | 'users' | 'requests' | 'chats'
/**
 * How often the open app looks for new requests and chat messages (the red dots of the bottom bar): with the
 * notifications' 20 s (useAdminNotifications.ts), so both share one request (adminApi.ts).
 */
const ADMIN_BADGE_POLL_MS = 20_000
/** A screen whose data did not come is asked again by itself after this long. */
const ADMIN_RETRY_MS = 15_000
/** Back on the screen after this long: its data is asked again. */
const ADMIN_RESUME_RELOAD_MS = 60_000
/** Days of «История по дням» shown before «Показать все». */
const ONLINE_DAYS_FOLDED = 3

/** As on the site (website/src/components/admin/AdminUsers.tsx). */
const USER_FILTERS: Array<{ id: AdminUserFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Подписка' },
  { id: 'trial', label: 'Пробный' },
  { id: 'inactive', label: 'Без подписки' },
  { id: 'streamers', label: 'Стримеры' },
  { id: 'blocked', label: 'Заблокированы' },
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

/** The site's periods of «Платежи» (and «Вчера» of the app); «Даты»: from / to. */
const PERIODS: Array<{ id: AdminPaymentPeriod; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: 'yesterday', label: 'Вчера' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'month', label: 'Этот месяц' },
  { id: 'all', label: 'Всё время' },
  { id: 'custom', label: 'Даты' },
]

const STATUSES: Array<{ id: PaymentStatus | 'all'; label: string }> = [
  { id: 'succeeded', label: 'Оплачено' },
  { id: 'pending', label: 'Ожидает' },
  { id: 'canceled', label: 'Отменено' },
  { id: 'refunded', label: 'Возврат' },
  { id: 'all', label: 'Все статусы' },
]

async function prepareSupportImage(file: File): Promise<SupportImageUpload> {
  return { data: (await prepareNoticeImage(file)).data }
}

export function AdminMobilePage() {
  const [section, setSection] = useState<Section>('summary')
  // Open requests and unread chats for the bottom bar, and the banner when a new one comes while the app is open.
  const [badges, setBadges] = useState<{ requests: number; chats: number } | null>(null)
  const [banner, setBanner] = useState<{ text: string; section: Section; report?: number } | null>(null)
  const [userFilter, setUserFilter] = useState<AdminUserFilter>('all')
  const [userRegion, setUserRegion] = useState<AdminUserRegion>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<AdminPaymentPeriod>('30d')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | 'all'>('succeeded')
  const [paymentPlan, setPaymentPlan] = useState<PlanId | ''>('')
  const [paymentSearch, setPaymentSearch] = useState('')
  const [paymentQuery, setPaymentQuery] = useState('')
  const [customDates, setCustomDates] = useState(() => ({ from: ownerDayAgo(29), to: ownerDayAgo(0) }))
  const [selected, setSelected] = useState<AdminUserDetail | null>(null)
  const [reportView, setReportView] = useState<ReportTableView>('active')
  const [focusReport, setFocusReport] = useState<number | null>(null)
  const [selectedReport, setSelectedReport] = useState<BugReportDetail | null>(null)
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  const [error, setError] = useState('')
  // «Обновить», a change, the app back on the screen: the screen's data again (the calendar and «Новые за …» too).
  const [version, setVersion] = useState(0)
  // «Статистика онлайна» every minute; the chats after a chat was read or answered.
  const [onlineTick, setOnlineTick] = useState(0)
  const [chatsTick, setChatsTick] = useState(0)
  // «Отчёты» read again: something changed on the server, or a button here.
  const [reportsTick, setReportsTick] = useState(0)
  const [sheet, setSheet] = useState<'streamers' | 'referrals' | 'history' | null>(null)
  // «Пригласи друга» appears once the server has «Привлечение друзей» (an older one answers 404); known from the last time.
  const [referrals, setReferrals] = useState(() => adminKept(adminPaths.referrals('', 'invited')) !== null)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const timer = window.setTimeout(() => setPaymentQuery(paymentSearch), 300)
    return () => window.clearTimeout(timer)
  }, [paymentSearch])
  useEffect(() => {
    let active = true
    adminApi.referrals('', 'invited').then(() => { if (active) setReferrals(true) }, (reason: unknown) => { if (active && (reason as { status?: number }).status === 404) setReferrals(false) })
    return () => { active = false }
  }, [version])

  const paymentFilter = useMemo<AdminPaymentQuery>(() => ({
    status: paymentStatus, ...(paymentPlan ? { plan: paymentPlan } : {}), ...(paymentQuery.trim() ? { q: paymentQuery.trim() } : {}),
    ...(period === 'custom' ? { custom: customDates } : {}),
  }), [customDates, paymentPlan, paymentQuery, paymentStatus, period])

  // «Сводка» loads at the start and on «Обновить» only, not again with every tab (owner, 03.11.2026: «долго загружает»);
  // each part on its own, so one slow answer never holds or hides the others.
  const loadOnline = useCallback(() => adminApi.online(), [])
  const loadUsers = useCallback(() => adminApi.users(query, userFilter, userRegion), [query, userFilter, userRegion])
  const loadPayments = useCallback(() => adminApi.payments(period, paymentFilter), [period, paymentFilter])
  const loadReports = useCallback(() => adminApi.reportTable(reportView), [reportView])
  const loadThreads = useCallback(() => adminApi.supportThreads(), [])
  const overview = useAdminAnswer(adminPaths.overview(), adminApi.overview, version)
  const online = useAdminAnswer(adminPaths.online(), loadOnline, `${version}:${onlineTick}`)
  const users = useAdminAnswer(section === 'users' ? adminPaths.users(query, userFilter, userRegion) : null, loadUsers, version, { keepPrevious: true })
  const payments = useAdminAnswer(section === 'payments' ? adminPaths.payments(period, paymentFilter) : null, loadPayments, version, { keepPrevious: true })
  const reports = useAdminAnswer(section === 'requests' ? adminPaths.reportTable(reportView) : null, loadReports, `${version}:${reportsTick}`, { keepPrevious: true })
  const threads = useAdminAnswer(section === 'chats' ? adminPaths.supportThreads() : null, loadThreads, `${version}:${chatsTick}`, { keepPrevious: true })
  const shown: AdminAnswer<unknown> = section === 'summary' ? overview : section === 'users' ? users : section === 'payments' ? payments : section === 'requests' ? reports : threads
  const refreshing = overview.loading || shown.loading
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const chatChanged = useCallback(() => setChatsTick((value) => value + 1), [])
  const reportsChanged = useCallback(() => setReportsTick((value) => value + 1), [])

  // «Эта таблица должна в режиме онлайн пополняться» (owner, 05.11.2026): while «Отчёты» is on the screen, one request waits
  // on the server for the next change (src/reports/reportEvents.ts); nothing asks while it is not.
  useEffect(() => {
    if (section !== 'requests') return
    const stop = new AbortController()
    void adminApi.watchReports(reportsChanged, stop.signal)
    return () => stop.abort()
  }, [section, reportsChanged])

  // A notification, tapped or seen as the banner: «Отчёты» with its report at hand (owner, 05.11.2026: «мне приходит уведомление»).
  const openReportRow = useCallback((id: number) => {
    setSection('requests')
    setReportView('active')
    setFocusReport(id)
    setSelected(null)
    setSelectedReport(null)
    setSelectedThread(null)
  }, [])
  useEffect(() => {
    const onOpen = (event: Event) => { const id = (event as CustomEvent<number>).detail; if (Number.isSafeInteger(id) && id > 0) openReportRow(id) }
    window.addEventListener(OPEN_REPORT_EVENT, onOpen)
    const native = Capacitor.isNativePlatform()
      ? LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const id = Number((action.notification.extra as { reportId?: unknown } | undefined)?.reportId)
        if (Number.isSafeInteger(id) && id > 0) openReportRow(id)
      })
      : null
    return () => { window.removeEventListener(OPEN_REPORT_EVENT, onOpen); void native?.then((handle) => handle.remove()) }
  }, [openReportRow])

  useEffect(() => {
    const timer = window.setInterval(() => setOnlineTick((value) => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // No answer: asked again by itself after a while; the last data stays on screen meanwhile.
  const failed = shown.error || overview.error
  useEffect(() => {
    if (!failed) return
    const timer = window.setTimeout(() => setVersion((value) => value + 1), ADMIN_RETRY_MS)
    return () => window.clearTimeout(timer)
  }, [failed, version])

  // Back on the screen after a while (the phone was locked, another app): the screen's data again.
  useEffect(() => {
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > ADMIN_RESUME_RELOAD_MS) { hiddenAt = 0; setVersion((value) => value + 1) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // New requests and chat messages without a manual refresh (owner, 20.10.2026: «приложение само каждые 10–30 секунд
  // обновляет заявки, и появляется кружочек уведомления»); a rise shows a banner at the top while the app is open.
  useEffect(() => {
    let active = true
    let last: { requests: number; chats: number; latest: number } | null = null
    const check = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const [open, chats] = await Promise.all([adminApi.bugReports('open', 1), adminApi.supportThreads(1)])
        if (!active) return
        const newest = open.reports[0]
        const next = { requests: open.awaiting ?? open.counts.open, chats: chats.unread, latest: newest?.id ?? 0 }
        if (last && newest && next.latest > last.latest) setBanner({ text: `${uiText(newest.kind === 'idea' ? 'Новое предложение' : 'Новый отчёт')} №${newest.id}`, section: 'requests', report: newest.id })
        else if (last && next.chats > last.chats) setBanner({ text: 'Новое сообщение в чате', section: 'chats' })
        last = next
        setBadges({ requests: next.requests, chats: next.chats })
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

  const refresh = () => {
    setError('')
    adminApi.forget()
    reload()
  }

  const openUser = async (user: AdminUser) => {
    setError('')
    try { setSelected(await adminApi.user(user.id)) }
    catch (reason) { setError(errorText(reason)) }
  }

  const updateSelected = async (detail: AdminUserDetail) => {
    setSelected(detail)
    reload()
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
    { id: 'requests', label: 'Отчёты', icon: MessageSquareWarning, badge: badges?.requests },
    { id: 'chats', label: 'Чаты', icon: MessagesSquare, badge: badges?.chats },
  ]
  const current = TABS.find((tab) => tab.id === section)!
  const stale = shown.data && shown.error ? shown : overview.data && overview.error ? overview : null

  return (
    <div className="page admin-mobile-page has-tabbar">
      <header className="page-header admin-mobile-header">
        <div>
          <div className="eyebrow">RAID OS · OWNER</div>
          <h1 className="page-title">{uiText(current.label)}</h1>
        </div>
        <button type="button" className="icon-button" onClick={refresh} aria-busy={refreshing} aria-label={uiText('Обновить')}>
          <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
        </button>
      </header>

      {banner && <button type="button" className="admin-banner" role="status" onClick={() => { if (banner.report) openReportRow(banner.report); else setSection(banner.section); setBanner(null) }}>
        <span className="admin-banner-icon">{banner.section === 'chats' ? <MessagesSquare size={18} /> : <MessageSquareWarning size={18} />}</span>
        <span><strong>Raid OS</strong><small>{uiText(banner.text)}</small></span>
      </button>}

      {error && <div className="admin-error" role="alert"><ShieldCheck size={18} /><span>{uiText(error)}</span></div>}
      {/* One request without an answer is not «нет связи»: the last data stays, a quiet line says so (owner, 03.11.2026). */}
      {stale && <div className="admin-stale" role="status"><WifiOff size={15} /><span>{uiText(stale.keptAt ? `Сервер не ответил — показаны данные от ${dateTime(new Date(stale.keptAt).toISOString())}, повторим сами` : 'Сервер не ответил — показаны последние данные, повторим сами')}</span><button type="button" onClick={refresh}>{uiText('Повторить')}</button></div>}

      {section === 'summary' ? <>
        {/* «Стримеры» and «Пригласи друга» as the site's tabs (owner, 03.11.2026), each in its own window. */}
        <div className="admin-quick-links">
          <button type="button" onClick={() => setSheet('streamers')}><Radio size={18} /><span>{uiText('Стримеры')}</span><ChevronRight size={16} /></button>
          {referrals && <button type="button" onClick={() => setSheet('referrals')}><Gift size={18} /><span>{uiText('Пригласи друга')}</span><ChevronRight size={16} /></button>}
          <button type="button" onClick={() => setSheet('history')}><HistoryIcon size={18} /><span>{uiText('История обновлений')}</span><ChevronRight size={16} /></button>
        </div>
        {!overview.data && overview.error && <AdminFailure text={overview.error} onRetry={refresh} />}
        <OverviewCards data={overview.data} refreshKey={version} />
        <RevenueCards data={overview.data} />
        {overview.data?.plans && <PlanTable title="Подписки по срокам" columns={[{ title: 'Этот месяц', plans: overview.data.plans.month }, { title: 'За всё время', plans: overview.data.plans.all }]} />}
        {overview.data?.squads && <SquadStats squads={overview.data.squads} />}
        <OnlineStatsBlock data={online.data} />
        <RegistrationsBlock refreshKey={version} />
        <p className="admin-summary-note">{uiText('Время — по Бангкоку (UTC+7). Выданные вручную дни подписки не считаются выручкой.')}</p>
      </> : !shown.data ? (shown.error ? <AdminFailure text={shown.error} onRetry={refresh} /> : <AdminLoading />)
        : section === 'users' && users.data ? (
          <UsersSection users={users.data.users} total={users.data.total} region={userRegion} regions={users.data.regions} filter={userFilter} search={search} onRegion={setUserRegion} onFilter={setUserFilter} onSearch={setSearch} onOpen={openUser} />
        ) : section === 'payments' && payments.data ? (
          <PaymentsSection
            data={payments.data} period={period} status={paymentStatus} plan={paymentPlan} search={paymentSearch} custom={customDates}
            onPeriod={setPeriod} onStatus={setPaymentStatus} onPlan={setPaymentPlan} onSearch={setPaymentSearch} onCustom={setCustomDates} onChanged={reload}
          />
        ) : section === 'chats' && threads.data ? (
          <ChatsSection threads={threads.data} onOpenChat={openChat} />
        ) : reports.data ? (
          <section className="admin-block admin-reports-block">
            <ReportsTable
              page={reports.data}
              view={reportView}
              onView={setReportView}
              t={uiText}
              focusId={focusReport}
              onAct={async (id, action, plan) => { await adminApi.reportWork(id, action, plan); reportsChanged() }}
              onPlan={async (id, plan) => { await adminApi.reportPlan(id, plan); reportsChanged() }}
              onOpen={(row) => void openReport(row.id)}
            />
          </section>
        ) : <AdminLoading />}

      <nav className="admin-tabbar" aria-label={uiText('Разделы админ-панели')}>
        {TABS.map(({ id, label, icon: Icon, badge }) => <button type="button" key={id} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined} aria-label={uiText(badge ? `${label}, новых: ${badge}` : label)} onClick={() => setSection(id)}>
          <span className="admin-tab-icon"><Icon size={20} />{badge ? <i className="admin-tab-badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</i> : null}</span>
          <span>{uiText(label)}</span>
        </button>)}
      </nav>

      {selected && <UserSheet detail={selected} onClose={() => setSelected(null)} onUpdated={updateSelected} onOpenChat={openChat} />}
      {selectedReport && <ReportSheet detail={selectedReport} onClose={() => setSelectedReport(null)} onOpenChat={openChat} onUpdated={(report) => { setSelectedReport(report); reportsChanged() }} />}
      {selectedThread && <ChatSheet accountId={selectedThread} onClose={() => setSelectedThread(null)} onChanged={chatChanged} />}
      {sheet === 'streamers' && <StreamersSheet onClose={() => setSheet(null)} />}
      {sheet === 'referrals' && <ReferralsSheet onClose={() => setSheet(null)} />}
      {sheet === 'history' && <UpdateHistorySheet onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Nothing to show and no answer from the server: what happened and «Повторить». */
function AdminFailure({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <div className="admin-error admin-failure" role="alert"><WifiOff size={18} /><span>{uiText(text)}</span><button type="button" className="button small" onClick={onRetry}>{uiText('Повторить')}</button></div>
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

  const answer = async () => {
    if (!detail.accountId || (!reply.trim() && !photo)) return
    setSaving(true); setError(''); setMessage('')
    try {
      await adminApi.supportReply(detail.accountId, reply.trim(), photo ? [await prepareSupportImage(photo)] : [], detail.id)
      setReply(''); setPhoto(null); setMessage('Ответ отправлен пользователю')
      onUpdated({ ...detail, answeredAt: new Date().toISOString() })
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
          <article><span>{uiText('Статус')}</span><strong>{detail.work ? uiText(REPORT_WORK_LABELS[detail.work.status]) : '—'}</strong>{detail.answeredAt && <small>{uiText('Отвечено')}</small>}</article>
          <article><span>{uiText('Создан')}</span><strong>{dateTime(detail.createdAt)}</strong></article>
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
          <SupportReportCard report={{ id: detail.id, title: detail.topic }} />
          <textarea className="input" rows={4} maxLength={2000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={uiText('Напишите ответ по отчёту…')} />
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
      </div>
      {expanded && <div className="admin-report-lightbox" role="dialog" aria-modal="true" aria-label={uiText('Просмотр скриншота')} onClick={() => setExpanded('')}><button type="button" className="icon-button" aria-label={uiText('Закрыть')} onClick={() => setExpanded('')}><X size={22} /></button><img src={expanded} alt={uiText('Скриншот отчёта')} onClick={(event) => event.stopPropagation()} /></div>}
    </section>
  </div>
}

/**
 * The tiles of «Сводка», as on the site: users, really paid subscriptions, the trial, and «Новые за …» — a tap chooses the
 * period (owner, 03.11.2026: «7 дней, эта неделя, этот месяц, прошлый месяц, 30 дней»), the same as on the site.
 */
function OverviewCards({ data, refreshKey }: { data: AdminOverview | null; refreshKey: number }) {
  const [period, setPeriod] = useState<NewUsersPeriod>('30d')
  const [choosing, setChoosing] = useState(false)
  const { from, to } = newUsersRange(period)
  const loadRange = useCallback(() => adminApi.rangeStats(from, to), [from, to])
  const range = useAdminAnswer<AdminRangeStats>(adminPaths.rangeStats(from, to), loadRange, refreshKey)
  const current = NEW_USERS_PERIODS.find((item) => item.id === period)!
  const failed = Boolean(range.error) && range.data === null
  // Without an answer for «30 дней» the tile keeps the overview's own 30 days.
  const value = range.data?.users.new ?? (failed && period === '30d' ? data?.users.days30 : undefined)
  const users = data?.users
  return (
    <section className="admin-overview" aria-label={uiText('Сводка')}>
      <article><span><Users size={16} />{uiText('Пользователи')}</span><strong>{users ? count.format(users.total) : '—'}</strong><small>{uiText(users ? `сегодня +${users.today} · 7 дн. +${users.days7}${users.blocked ? ` · заблокировано ${users.blocked}` : ''}` : '')}</small></article>
      <article><span><ShieldCheck size={16} />{uiText('Платные подписки')}</span><strong>{data ? count.format(data.subscriptions.active) : '—'}</strong><small>{uiText('только те, кто оплатил и подписка идёт')}</small></article>
      <article><span><Gift size={16} />{uiText('Пробный период')}</span><strong>{data ? count.format(data.subscriptions.trials) : '—'}</strong><small>{uiText('сейчас на пробном')}</small></article>
      <button type="button" className={`admin-overview-pick${choosing ? ' is-open' : ''}`} aria-expanded={choosing} aria-label={uiText(`${current.title}: ${value ?? '…'}. Выбрать период`)} onClick={() => setChoosing((open) => !open)}>
        <span><UserPlus size={16} />{uiText(current.title)}<ChevronDown size={14} className="admin-overview-caret" /></span>
        <strong>{value === undefined ? (failed ? '—' : '…') : count.format(value)}</strong>
        <small>{uiText(`${ownerRangeText(from, to)} · сменить период`)}</small>
      </button>
      {choosing && <div className="admin-period-picker" role="group" aria-label={uiText('Период для новых пользователей')}>
        {NEW_USERS_PERIODS.map((item) => <button type="button" key={item.id} className={period === item.id ? 'active' : ''} aria-pressed={period === item.id} onClick={() => { setPeriod(item.id); setChoosing(false) }}>{uiText(item.label)}</button>)}
      </div>}
    </section>
  )
}

/** «Выручка сегодня», «За этот месяц», «За всё время», as on the site; the owner's days. */
function RevenueCards({ data }: { data: AdminOverview | null }) {
  const cards: Array<{ title: string; revenue?: AdminRevenue }> = [
    { title: 'Выручка сегодня', revenue: data?.revenue.today },
    { title: 'За этот месяц', revenue: data?.revenue.month },
    { title: 'За всё время', revenue: data?.revenue.all },
  ]
  return <section className="admin-revenue-cards" aria-label={uiText('Выручка')}>
    {cards.map(({ title, revenue }) => <article key={title}><span><LineChart size={15} />{uiText(title)}</span><strong>{revenue ? money(revenue.total) : '—'}</strong><small>{uiText(`оплат: ${revenue ? count.format(revenue.payments) : '—'}`)}</small></article>)}
  </section>
}

type PlanCounts = Record<PlanId, { count: number; revenue: number }>

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

/** «Отряды», as on the site: now, the players in them, created since the count began, disbanded (the hideout is not counted). */
function SquadStats({ squads }: { squads: NonNullable<AdminOverview['squads']> }) {
  return <section className="admin-block" aria-label={uiText('Отряды')}>
    <div className="admin-block-heading"><Shield size={15} /><span>{uiText('Отряды')}</span>{squads.since && <small>{uiText(`учёт с ${dateOnly(squads.since)}`)}</small>}</div>
    <div className="admin-mini-grid admin-squad-grid">
      <article><span>{uiText('Сейчас отрядов')}</span><strong>{count.format(squads.active)}</strong><small>{uiText(`за 30 дней создано: ${squads.created30}`)}</small></article>
      <article><span>{uiText('Играют в отрядах')}</span><strong>{count.format(squads.players)}</strong><small>{uiText(squads.active ? `в среднем ${(squads.players / squads.active).toFixed(1).replace('.', ',')} в отряде` : 'отрядов сейчас нет')}</small></article>
      <article><span>{uiText('Создано всего')}</span><strong>{count.format(squads.created)}</strong><small>{uiText(squads.since ? 'с начала учёта' : 'учёт идёт с этой версии')}</small></article>
      <article><span>{uiText('Расформировано')}</span><strong>{count.format(squads.disbanded)}</strong><small>{uiText('распущены или все вышли')}</small></article>
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

/** «Платежи», as on the site: the period (or «Даты»), the status, the plan, a search by e-mail, totals, every payment. */
function PaymentsSection({ data, period, status, plan, search, custom, onPeriod, onStatus, onPlan, onSearch, onCustom, onChanged }: {
  data: AdminPayments | null; period: AdminPaymentPeriod; status: PaymentStatus | 'all'; plan: PlanId | ''; search: string; custom: { from: string; to: string }
  onPeriod: (value: AdminPaymentPeriod) => void; onStatus: (value: PaymentStatus | 'all') => void; onPlan: (value: PlanId | '') => void
  onSearch: (value: string) => void; onCustom: (value: { from: string; to: string }) => void
  /** A payment amount was changed or a refund marked: the list and the totals are read again. */
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
        {period === 'custom' && <>
          <label><span>{uiText('С')}</span><input className="input" type="date" value={custom.from} max={custom.to || undefined} onChange={(event) => onCustom({ ...custom, from: event.target.value })} /></label>
          <label><span>{uiText('По')}</span><input className="input" type="date" value={custom.to} min={custom.from || undefined} onChange={(event) => onCustom({ ...custom, to: event.target.value })} /></label>
        </>}
        <label><span>{uiText('Тариф')}</span><select className="select" value={plan} onChange={(event) => onPlan(event.target.value as PlanId | '')}><option value="">{uiText('Все тарифы')}</option>{PLAN_IDS.map((id) => <option key={id} value={id}>{uiText(PLAN_LABEL[id])}</option>)}</select></label>
      </div>
      <label className="admin-search admin-payment-search"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={uiText('Поиск по e-mail')} aria-label={uiText('Поиск по e-mail')} />{search && <button type="button" onClick={() => onSearch('')} aria-label={uiText('Очистить')}><X size={16} /></button>}</label>
      {data && <div className="admin-payment-counts"><span>{uiText('Платежей')}<strong>{count.format(data.total)}</strong></span><span>{uiText('Оплачено')}<strong>{count.format(data.totals.succeeded)}</strong></span></div>}
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
