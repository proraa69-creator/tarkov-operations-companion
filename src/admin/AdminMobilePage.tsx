import { EftCasesTable } from '../reports/EftCasesTable'
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import {
  Activity, ArrowLeft, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, CreditCard, Gift, ImagePlus, LineChart, LoaderCircle,
  Maximize2, Megaphone, MessagesSquare, MessageSquareWarning, Newspaper, Paperclip, Radio, RefreshCw, Search, Send, Shield, ShieldCheck, Smartphone, Sticker, Trash2, UserPlus, UserRound, Users, Wifi, WifiOff, X,
} from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import { prepareNoticeImage } from '../notices/imageResize'
import { countryName } from '../shared/countries'
import { NEW_USERS_PERIODS, newUsersRange, ownerDayAgo, ownerRangeText, type NewUsersPeriod } from '../shared/ownerTime'
import { SupportComposer, SupportMessageList, SupportReportAnswerPlate, SupportReportCard } from '../support/SupportChat'
import type { SupportImageUpload, SupportMessage, SupportSendExtra } from '../support/supportChatClient'
import { supportPreviewText, useSupportEdit, useSupportOutbox, useSupportReply, useSupportReportAnswer, type SupportReportAnswer } from '../support/supportChatTools'
import { useLocale } from '../i18n/LocaleProvider'
import {
  adminApi, adminKept, adminPaths, monthsToDays, type AdminOnlineStats, type AdminOverview, type AdminPhones, type AdminPaymentPeriod, type AdminPaymentQuery, type AdminPayments,
  type AdminRangeStats, type AdminRegionCounts, type AdminRevenue, type AdminSupportDetail, type AdminSupportSearchUser, type AdminSupportThreads, type AdminUser, type AdminUserDetail,
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
import { AdsSheet } from './AdminAdsSheet'
import { StreamersSheet } from './AdminStreamersSheet'
import { AdminNewsSheet } from './AdminNewsEditor'
import { AdminBezebeeBlock } from './AdminBezebeeBlock'
import { useAdminAnswer, type AdminAnswer } from './useAdminAnswer'
import { ChatPersonMenu } from './ChatPersonMenu'
import { usePersonMenu } from './personMenu'
import { AccountProfile } from './AccountProfile'
import './adminMobile.css'
import { ruDays } from '../i18n/ruPlural'
import { SheetPortal } from './SheetPortal'

/**
 * «Стикеры» (owner, 07.11.2026: «в админ приложении на телефоне сделай мне функцию добавлять стикеры»): the packs and the
 * editor load only when opened (src/admin/stickers/), with the segmenter and the fonts.
 */
const StickerPacksSheet = lazy(() => import('./stickers/StickerPacksSheet').then((module) => ({ default: module.StickerPacksSheet })))

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
  { id: 'cis', label: 'СНГ', hint: 'СНГ, Украина, Латвия, Литва' },
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
  // «Аккаунты Таркова» (owner, 15.11.2026): the tab next to the three lists and its count of new cases.
  const [eftSelected, setEftSelected] = useState(false)
  const [eftCount, setEftCount] = useState(0)
  const [focusReport, setFocusReport] = useState<number | null>(null)
  const [selectedReport, setSelectedReport] = useState<BugReportDetail | null>(null)
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  // «Разъяснить» on a bug (owner, 25.11.2026): the chat with its author opens with the answer to that report ready.
  const [threadAnswer, setThreadAnswer] = useState<SupportReportAnswer | null>(null)
  // «Посмотреть профиль» (owner, 24.11.2026): a long press on a person in «Чаты», or the open chat's head.
  const [profileOf, setProfileOf] = useState<{ accountId: string; name?: string } | null>(null)
  const [error, setError] = useState('')
  // «Обновить», a change, the app back on the screen: the screen's data again (the calendar and «Новые за …» too).
  const [version, setVersion] = useState(0)
  // «Статистика онлайна» every minute; the chats after a chat was read or answered.
  const [onlineTick, setOnlineTick] = useState(0)
  const [chatsTick, setChatsTick] = useState(0)
  // «Отчёты» read again: something changed on the server, or a button here.
  const [reportsTick, setReportsTick] = useState(0)
  const [sheet, setSheet] = useState<'streamers' | 'referrals' | 'ads' | 'news' | 'stickers' | null>(null)
  // «Пригласи друга» appears once the server has «Привлечение друзей» (an older one answers 404); known from the last time.
  const [referrals, setReferrals] = useState(() => adminKept(adminPaths.referrals('', 'invited')) !== null)
  // «Стримеры» → красный счётчик новых заявок на вывод (owner, 25.11.2026).
  const [payoutPending, setPayoutPending] = useState(0)

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
  // Payout requests waiting for the owner: on open, every 5 minutes, on «Обновить», and when the streamers sheet closes.
  useEffect(() => {
    let active = true
    const load = () => adminApi.payoutAttention().then((answer) => { if (active) setPayoutPending(answer.count) }, () => {})
    load()
    const timer = window.setInterval(load, 5 * 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [version, sheet])

  const paymentFilter = useMemo<AdminPaymentQuery>(() => ({
    status: paymentStatus, ...(paymentPlan ? { plan: paymentPlan } : {}), ...(paymentQuery.trim() ? { q: paymentQuery.trim() } : {}),
    ...(period === 'custom' ? { custom: customDates } : {}),
  }), [customDates, paymentPlan, paymentQuery, paymentStatus, period])

  // «Сводка» loads at the start and on «Обновить» only, not again with every tab (owner, 03.11.2026: «долго загружает»);
  // each part on its own, so one slow answer never holds or hides the others.
  const loadOnline = useCallback(() => adminApi.online(), [])
  const loadPhones = useCallback(() => adminApi.phones(), [])
  const loadUsers = useCallback(() => adminApi.users(query, userFilter, userRegion), [query, userFilter, userRegion])
  const loadPayments = useCallback(() => adminApi.payments(period, paymentFilter), [period, paymentFilter])
  const loadReports = useCallback(() => adminApi.reportTable(reportView), [reportView])
  const loadThreads = useCallback(() => adminApi.supportThreads(), [])
  const overview = useAdminAnswer(adminPaths.overview(), adminApi.overview, version)
  const online = useAdminAnswer(adminPaths.online(), loadOnline, `${version}:${onlineTick}`)
  // «Телефоны»: with «Статистика онлайна», every minute (its «сейчас» is the last few minutes)
  const phones = useAdminAnswer(section === 'summary' ? adminPaths.phones() : null, loadPhones, `${version}:${onlineTick}`)
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
    void adminApi.watchReports(reportsChanged, stop.signal, setEftCount)
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

  const openChat = (accountId: string, answer: SupportReportAnswer | null = null) => {
    setSection('chats')
    setSelected(null)
    setSelectedReport(null)
    setProfileOf(null)
    setThreadAnswer(answer)
    setSelectedThread(accountId)
  }
  const openProfile = (accountId: string, name?: string) => setProfileOf({ accountId, ...(name ? { name } : {}) })

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
        {/* «Стримеры» and «Пригласи друга» as the site's tabs (owner, 03.11.2026), each in its own window. No «История
          обновлений» (owner, 15.11.2026): it is in «Обновление», where it is read and edited. */}
        <div className="admin-quick-links">
          <button type="button" onClick={() => setSheet('streamers')}><Radio size={18} /><span>{uiText('Стримеры')}</span>{payoutPending > 0 && <span className="admin-quick-badge" aria-label={uiText(`новых заявок на вывод: ${payoutPending}`)}>{payoutPending > 99 ? '99+' : payoutPending}</span>}<ChevronRight size={16} /></button>
          {referrals && <button type="button" onClick={() => setSheet('referrals')}><Gift size={18} /><span>{uiText('Пригласи друга')}</span><ChevronRight size={16} /></button>}
          {/* «Реклама» (owner, 09.11.2026): переходы, регистрации и оплаты по ссылке рекламы Reddit. */}
          <button type="button" onClick={() => setSheet('ads')}><Megaphone size={18} /><span>{uiText('Реклама')}</span><ChevronRight size={16} /></button>
          <button type="button" onClick={() => setSheet('news')}><Newspaper size={18} /><span>{uiLabel('Обновление')}</span><ChevronRight size={16} /></button>
          <button type="button" onClick={() => setSheet('stickers')}><Sticker size={18} /><span>{uiText('Стикеры')}</span><ChevronRight size={16} /></button>
        </div>
        {!overview.data && overview.error && <AdminFailure text={overview.error} onRetry={refresh} />}
        <OverviewCards data={overview.data} refreshKey={version} />
        <RevenueCards data={overview.data} />
        {overview.data?.plans && <PlanTable title="Подписки по срокам" columns={[{ title: 'Этот месяц', plans: overview.data.plans.month }, { title: 'За всё время', plans: overview.data.plans.all }]} />}
        {overview.data?.squads && <SquadStats squads={overview.data.squads} />}
        {phones.data && <PhoneStatsBlock data={phones.data} />}
        <OnlineStatsBlock data={online.data} />
        <RegistrationsBlock refreshKey={version} />
        <p className="admin-summary-note">{uiText('Время — по Бангкоку (UTC+7). Выданные вручную дни подписки не считаются выручкой.')}</p>
      </> : !shown.data ? (shown.error ? <AdminFailure text={shown.error} onRetry={refresh} /> : <AdminLoading />)
        : section === 'users' && users.data ? (
          <UsersSection users={users.data.users} total={users.data.total} region={userRegion} regions={users.data.regions} filter={userFilter} search={search} onRegion={setUserRegion} onFilter={setUserFilter} onSearch={setSearch} onOpen={openUser} />
        ) : section === 'payments' && payments.data ? (
          <PaymentsSection
            data={payments.data} period={period} status={paymentStatus} plan={paymentPlan} search={paymentSearch} custom={customDates}
            onPeriod={setPeriod} onStatus={setPaymentStatus} onPlan={setPaymentPlan} onSearch={setPaymentSearch} onCustom={setCustomDates} onChanged={reload} onOpenProfile={openProfile}
          />
        ) : section === 'chats' && threads.data ? (
          <ChatsSection threads={threads.data} onOpenChat={openChat} onOpenProfile={openProfile} />
        ) : reports.data ? (
          <section className="admin-block admin-reports-block">
            <ReportsTable
              page={reports.data}
              view={reportView}
              onView={(next) => { setReportView(next); setEftSelected(false) }}
              eft={{
                count: eftCount,
                selected: eftSelected,
                onSelect: () => setEftSelected(true),
                content: <EftCasesTable load={adminApi.eftCases} setStatus={adminApi.eftStatus} disputes={adminApi.eftDisputes} t={uiText} reloadKey={reportsTick} />,
              }}
              t={uiText}
              focusId={focusReport}
              onAct={async (id, action) => { await adminApi.reportWork(id, action); reportsChanged() }}
              onReward={async (id, days) => { await adminApi.rewardReport(id, days); reportsChanged() }}
              onAcceptPoint={async (id) => { await adminApi.acceptPoint(id); reportsChanged() }}
              onExplain={(row) => { if (row.accountId) openChat(row.accountId, { id: row.id, title: row.topic }) }}
              loadImage={(row, index) => adminApi.bugReportImage(row.id, index)}
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
      {selectedThread && <ChatSheet key={`${selectedThread}:${threadAnswer?.id ?? ''}`} accountId={selectedThread} answer={threadAnswer} onClose={() => { setSelectedThread(null); setThreadAnswer(null) }} onChanged={chatChanged} onOpenProfile={openProfile} />}
      {profileOf && <ProfileSheet accountId={profileOf.accountId} name={profileOf.name} onClose={() => setProfileOf(null)} onOpenChat={openChat} />}
      {sheet === 'streamers' && <StreamersSheet onClose={() => setSheet(null)} />}
      {sheet === 'referrals' && <ReferralsSheet onClose={() => setSheet(null)} />}
      {sheet === 'ads' && <AdsSheet onClose={() => setSheet(null)} />}
      {sheet === 'news' && <AdminNewsSheet request={adminApi.ownerRequest} onClose={() => setSheet(null)} />}
      {sheet === 'stickers' && <Suspense fallback={<div className="admin-sheet-backdrop"><AdminLoading /></div>}><StickerPacksSheet onClose={() => setSheet(null)} /></Suspense>}
    </div>
  )
}

/** Nothing to show and no answer from the server: what happened and «Повторить». */
function AdminFailure({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <div className="admin-error admin-failure" role="alert"><WifiOff size={18} /><span>{uiText(text)}</span><button type="button" className="button small" onClick={onRetry}>{uiText('Повторить')}</button></div>
}

/**
 * «Чаты» (its own tab, owner 20.10.2026): the players' support conversations, unread ones marked. A long press on a person
 * (owner, 24.11.2026: «на телефоне зажимаю пальцем… посмотреть профиль») opens the menu with «Посмотреть профиль».
 */
function ChatsSection({ threads, onOpenChat, onOpenProfile }: { threads: AdminSupportThreads | null; onOpenChat: (accountId: string) => void; onOpenProfile: (accountId: string, name?: string) => void }) {
  const { locale } = useLocale()
  const people = usePersonMenu()
  const nameOf = (thread: AdminSupportThreads['threads'][number]) => thread.nickname || thread.email || uiText('Пользователь')
  const search = useAccountSearch()
  return <section className="admin-block">
    {/* «Найти по почте» (owner, 26.11.2026: «в чате нету функции найти пользователя по логину, ну по почте»): anyone with an
        account, with a conversation or not; a tap opens the chat, a long press the profile */}
    <label className="admin-search admin-chat-search"><Search size={17} /><input value={search.query} onChange={(event) => search.setQuery(event.target.value)} placeholder={uiText('Найти по почте')} aria-label={uiText('Найти по почте')} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />{search.query && <button type="button" onClick={() => search.setQuery('')} aria-label={uiText('Очистить')}><X size={16} /></button>}</label>
    {search.active ? <div className="admin-list admin-chat-list admin-chat-found">
      {!search.result ? <div className="admin-chat-searching" role="status" aria-label={uiText('Ищем…')}><LoaderCircle size={18} className="spin" /></div>
        : search.result.error ? <div className="admin-inline-error" role="alert">{uiText(search.result.error)}</div>
        : search.result.users.length ? search.result.users.map((user) => <button type="button" className="admin-user-row admin-chat-row" key={user.id} onClick={() => onOpenChat(user.id)}
          {...people.bind({ accountId: user.id, name: user.nickname || user.email })}>
          <span className="admin-payment-icon pending"><UserRound size={18} /></span>
          <span className="admin-row-copy"><strong>{user.nickname || user.email}</strong><small>{[user.nickname ? user.email : '', user.hasThread ? '' : uiText('переписки нет')].filter(Boolean).join(' · ')}</small></span>
          <ChevronRight size={17} />
        </button>)
        : <AdminEmpty text="Никого не нашли" />}
    </div> : <div className="admin-list admin-chat-list">
      {(threads?.threads ?? []).map((thread) => <button type="button" className={`admin-user-row admin-chat-row${thread.unread ? ' is-unread' : ''}`} key={thread.accountId} onClick={() => onOpenChat(thread.accountId)}
        {...people.bind({ accountId: thread.accountId, name: nameOf(thread) })}>
        <span className="admin-payment-icon pending"><MessagesSquare size={18} /></span>
        <span className="admin-row-copy"><strong>{thread.nickname || thread.email || uiText('Пользователь')}</strong><small>{thread.lastMessage.author === 'owner' ? `${uiText('Вы')}: ` : ''}{supportPreviewText(thread.lastMessage, locale)}</small></span>
        <span className="admin-row-side">{thread.unread > 0 && <strong className="admin-unread">{thread.unread}</strong>}<small>{dateTime(thread.lastAt)}</small></span>
        <ChevronRight size={17} />
      </button>)}
      {!threads?.threads.length && <AdminEmpty text="Переписок пока нет" />}
    </div>}
    <ChatPersonMenu menu={people.menu} onClose={people.close} onProfile={(accountId) => onOpenProfile(accountId, people.menu?.name)} onChat={onOpenChat} />
  </section>
}

/** «Найти по почте» of «Чаты»: the accounts whose e-mail has the words (2 letters at least), asked a moment after typing stops. */
function useAccountSearch() {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; users: AdminSupportSearchUser[]; error?: string } | null>(null)
  const text = query.trim()
  useEffect(() => {
    if (text.length < 2) return
    let live = true
    const timer = window.setTimeout(() => {
      adminApi.supportSearch(text).then(
        (answer) => { if (live) setFound({ query: text, users: answer.users }) },
        (reason: unknown) => { if (live) setFound({ query: text, users: [], error: errorText(reason) }) },
      )
    }, 300)
    return () => { live = false; window.clearTimeout(timer) }
  }, [text])
  const active = text.length >= 2
  return { query, setQuery, active, result: active && found?.query === text ? found : null }
}

/** «Посмотреть профиль»: the player's whole account on a full screen sheet (admin/AccountProfile.tsx). */
function ProfileSheet({ accountId, name, onClose, onOpenChat }: { accountId: string; name?: string; onClose: () => void; onOpenChat: (accountId: string) => void }) {
  return <SheetPortal><div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet account-profile-sheet" role="dialog" aria-modal="true" aria-label={uiText(name ? `Профиль ${name}` : 'Профиль')}>
      <AccountProfile accountId={accountId} name={name} load={adminApi.profile} onBack={onClose} onOpenChat={onOpenChat} variant="sheet" call={adminApi.command} />
    </section>
  </div></SheetPortal>
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
      onUpdated(updated); setRewardDays(''); setMessage(`Начислено: ${ruDays(days)}`)
    } catch (reason) { setError(errorText(reason)) }
    finally { setSaving(false) }
  }
  return <SheetPortal><div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
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
  </div></SheetPortal>
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
      <article><span><ShieldCheck size={16} />{uiText('Платные подписки')}</span><strong>{data ? count.format(data.subscriptions.active) : '—'}</strong><small>{uiText(data?.subscriptions.activeRepeat === undefined ? 'только те, кто оплатил и подписка идёт' : `из них повторных: ${count.format(data.subscriptions.activeRepeat)}`)}</small></article>
      {/* «мёртвых» — 21 days registered without the free days used; «реальных» — the rest (owner, 16.11.2026). */}
      <article><span><Gift size={16} />{uiText('Пробный период')}</span><strong>{data ? count.format(data.subscriptions.trials) : '—'}</strong><small>{uiText(data?.subscriptions.trialsDead === undefined || data.subscriptions.trialsAlive === undefined ? 'сейчас на пробном' : `мёртвых ${count.format(data.subscriptions.trialsDead)} · реальных ${count.format(data.subscriptions.trialsAlive)}`)}</small></article>
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

/**
 * «Выручка сегодня», «За этот месяц», «За всё время», as on the site; the owner's days. «За всё время» also counts
 * «оплатили повторно» (owner, 12.11.2026: «счёт того, сколько человек оплатили повторно»): two or more paid payments.
 */
function RevenueCards({ data }: { data: AdminOverview | null }) {
  const cards: Array<{ title: string; revenue?: AdminRevenue; repeat?: number }> = [
    { title: 'Выручка сегодня', revenue: data?.revenue.today },
    { title: 'За этот месяц', revenue: data?.revenue.month },
    { title: 'За всё время', revenue: data?.revenue.all, repeat: data?.repeatPayers },
  ]
  return <section className="admin-revenue-cards" aria-label={uiText('Выручка')}>
    {/* «Грязными» (большое) и «чистыми» (net). «Повторных» — только в сегодня/месяце; в «За всё время» один показатель «оплатили повторно» (owner, 25.11.2026). */}
    {cards.map(({ title, revenue, repeat }) => <article key={title}><span><LineChart size={15} />{uiText(title)}</span><strong>{revenue ? money(revenue.total) : '—'}</strong>{revenue?.net !== undefined && <small className="admin-revenue-net">{uiText(`Чистыми: ${money(revenue.net)}`)}</small>}<small>{uiText(`оплат: ${revenue ? count.format(revenue.payments) : '—'}${revenue?.repeat !== undefined && repeat === undefined ? ` · повторных: ${count.format(revenue.repeat)}` : ''}`)}</small>{repeat !== undefined && <small>{uiText(`оплатили повторно: ${count.format(repeat)}`)}</small>}</article>)}
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

/**
 * «Телефоны» (owner, 23.11.2026: «сколько с андроида установило и зашло, сколько с айфона установило и зашло, и сколько в
 * данный момент онлайн с телефонов с каждого вида»): accounts signed in from the phone app by system, and who is in it now.
 */
function PhoneStatsBlock({ data }: { data: AdminPhones }) {
  return <section className="admin-block" aria-label={uiText('Телефоны')}>
    <div className="admin-block-heading"><Smartphone size={15} /><span>{uiText('Телефоны')}</span><small>{uiText(`всего пользователей ${count.format(data.users)}`)}</small></div>
    <div className="admin-mini-grid admin-squad-grid">
      <article><span>{uiText('Вошли с телефона')}</span><strong>{count.format(data.phones.accounts)}</strong><small>{uiText(`телефонов: ${count.format(data.phones.devices)}`)}</small></article>
      <article><span>{uiText('Онлайн с телефонов')}</span><strong>{count.format(data.online.phone)}</strong><small>{uiText(`за ${data.online.windowMinutes} мин`)}</small></article>
      <article><span>Android</span><strong>{count.format(data.android.accounts)}</strong><small>{uiText(`установили и вошли · онлайн ${count.format(data.android.online)}`)}</small></article>
      <article><span>iPhone</span><strong>{count.format(data.ios.accounts)}</strong><small>{uiText(`установили и вошли · онлайн ${count.format(data.ios.online)}`)}</small></article>
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
function PaymentsSection({ data, period, status, plan, search, custom, onPeriod, onStatus, onPlan, onSearch, onCustom, onChanged, onOpenProfile }: {
  data: AdminPayments | null; period: AdminPaymentPeriod; status: PaymentStatus | 'all'; plan: PlanId | ''; search: string; custom: { from: string; to: string }
  onPeriod: (value: AdminPaymentPeriod) => void; onStatus: (value: PaymentStatus | 'all') => void; onPlan: (value: PlanId | '') => void
  onSearch: (value: string) => void; onCustom: (value: { from: string; to: string }) => void
  /** A payment amount was changed or a refund marked: the list and the totals are read again. */
  onChanged?: () => Promise<unknown> | void
  /** A payment opens its payer's profile, and from it the chat (owner, 26.11.2026). */
  onOpenProfile?: (accountId: string, name: string) => void
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
    <>
    <AdminBezebeeBlock onCredited={() => void onChanged?.()} />
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
        {/* what «Чистыми» took off (owner, 26.11.2026: «сколько суммы чистыми») */}
        {data?.totals.fees !== undefined && <small className="admin-payment-net-parts">{uiText(`комиссия −${money(data.totals.fees)} · стримерам −${money(data.totals.streamerEarnings)}`)}</small>}
      </div>
      <div className="admin-plan-grid">
        {(Object.keys(breakdown) as PlanId[]).map((plan) => <article key={plan}><span>{PLAN_LABEL[plan]}</span><strong>{breakdown[plan].count}</strong><small>{money(breakdown[plan].total)}</small></article>)}
      </div>
      <div className="admin-list admin-payment-list">
        {(data?.payments ?? []).map((payment) => <PaymentRow key={payment.id} payment={payment} onChanged={onChanged} onOpenProfile={onOpenProfile} />)}
        {!data?.payments.length && <AdminEmpty text="За выбранный период платежей нет" />}
      </div>
    </section>
    </>
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
    const label = unit === 'months' ? `${number} мес. (${ruDays(days)})` : ruDays(days)
    if (!window.confirm(`Выдать ${label} пользователю ${user.email}?`)) return
    setSaving(true); setError(''); setMessage('')
    try {
      const next = await adminApi.grant(user.id, days, reason.trim())
      await onUpdated(next)
      setMessage(`Подписка выдана до ${dateOnly(next.user.subscription.paidUntil)}`)
    } catch (reasonError) { setError(errorText(reasonError)) }
    finally { setSaving(false) }
  }

  return <SheetPortal><div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet" role="dialog" aria-modal="true" aria-label={uiText(`Пользователь ${user.email}`)}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{user.email}</strong><small>{subscriptionText(user)}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-sheet-scroll">
        <div className="admin-user-facts">
          <article><span>{uiText('Подписка до')}</span><strong>{user.subscription.lifetime ? uiText('Навсегда') : !user.subscription.paidUntil && user.subscription.trialRaidDays ? uiText('ждёт первого рейда') : dateOnly(user.subscription.paidUntil ?? user.subscription.trialEndsAt)}</strong></article>
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
          {unit === 'months' && valid && <small className="admin-conversion"><Clock3 size={14} />{uiText(`Будет начислено: ${ruDays(days)}`)}</small>}
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
  </div></SheetPortal>
}

function ChatSheet({ accountId, answer, onClose, onChanged, onOpenProfile }: { accountId: string; answer?: SupportReportAnswer | null; onClose: () => void; onChanged: () => void; onOpenProfile: (accountId: string, name?: string) => void }) {
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
  // «Удалить сообщение» (owner, 26.11.2026): gone for both sides; the conversation is read again.
  const removeMessage = useCallback(async (message: { id: number }) => {
    await adminApi.supportDeleteMessage(accountId, message.id)
    await load()
  }, [accountId, load])

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 30_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [load])

  // Sent at once, the box and the keyboard ready for the next one (owner, 15.11.2026: «после отправки сообщения нельзя
  // сразу отправить второе… Отправка долго думает»): the server's message joins the conversation as it comes, nothing is
  // read again for it.
  const report = useSupportReportAnswer(answer)
  const { take } = report
  const sendReply = useCallback(async (text: string, images: SupportImageUpload[], extra: SupportSendExtra) => {
    const { message } = await adminApi.supportReply(accountId, text, images, extra.sticker ? undefined : take(), extra)
    setDetail((current) => (current && !current.messages.some((known) => known.id === message.id) ? { ...current, messages: [...current.messages, message] } : current))
    onChanged()
  }, [accountId, onChanged, take])
  const [sending, send] = useSupportOutbox(detail?.messages ?? [], 'owner', sendReply)
  // «Редактировать» (owner, 15.11.2026): the owner's own messages; the player sees only the new words.
  const editor = useSupportEdit(sending, async (message, text) => {
    const answer = await adminApi.supportEdit(accountId, message.id, text)
    setDetail((current) => (current ? { ...current, messages: current.messages.map((known) => (known.id === answer.message.id ? answer.message : known)) } : current))
  })
  const messages = editor.messages
  // Reactions, «Ответить» and stickers (owner, 07.11.2026): as in the owner app's «Чаты».
  const [replying, setReplying] = useSupportReply(messages)
  const react = async (message: SupportMessage, emoji: string, on: boolean) => {
    const answer = await adminApi.supportReact(accountId, message.id, emoji, on)
    setDetail((current) => (current ? { ...current, messages: current.messages.map((known) => (known.id === answer.message.id ? answer.message : known)) } : current))
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
  return <SheetPortal><div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet admin-chat-sheet" role="dialog" aria-modal="true" aria-label={name}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{name}</strong><small>{detail?.account.email ?? uiText('Загружаем переписку…')}</small></div>
        <div className="admin-sheet-actions"><button type="button" className="icon-button" onClick={() => onOpenProfile(accountId, detail ? name : undefined)} aria-label={uiText('Профиль')}><UserRound size={18} /></button><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></div></header>
      <div className="admin-chat-body">
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        <SupportMessageList messages={messages} viewer="owner" otherName={name} loading={loading} error={error} onRetry={() => void load()} emptyText="Сообщений пока нет."
          onReact={react} onReply={setReplying} onEdit={editor.start} onDelete={removeMessage} />
        {report.about && <SupportReportAnswerPlate report={report.about} onCancel={report.cancel} />}
        <SupportComposer onSend={send} placeholder="Ответ пользователю…" allowImages allowEmoji allowStickers replyTo={replying} onCancelReply={() => setReplying(null)}
          editing={editor.editing} onEdit={editor.submit} onCancelEdit={editor.cancel} />
        <button type="button" className="button danger admin-delete-chat" disabled={deleting} onClick={() => void remove()}>{deleting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}{uiText(deleting ? 'Удаляем…' : 'Удалить чат с сервера')}</button>
        <small className="admin-delete-note">{uiText('После удаления переписка не хранится в рабочей базе и не попадает в управляемые резервные копии.')}</small>
      </div>
    </section>
  </div></SheetPortal>
}

function subscriptionText(user: AdminUser) {
  if (user.blockedAt) return uiText('Заблокирован')
  if (user.subscription.lifetime) return uiText('Пожизненная подписка')
  if (user.subscription.status === 'active') return uiText(`активна до ${dateOnly(user.subscription.paidUntil)}${user.subscription.termHidden ? ' · срок скрыт' : ''}`)
  // owner, 12.11.2026: «ждёт первого рейда (2 дня)» instead of the latest end
  if (user.subscription.status === 'trial' && user.subscription.trialRaidDays) return uiText(`ждёт первого рейда (${user.subscription.trialRaidDays} ${user.subscription.trialRaidDays === 1 ? 'день' : 'дня'})`)
  if (user.subscription.status === 'trial') return uiText(`пробная до ${dateOnly(user.subscription.trialEndsAt)}`)
  return uiText('подписки нет')
}
