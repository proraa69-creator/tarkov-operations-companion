import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, BadgeRussianRuble, CalendarDays, Check, ChevronRight, Clock3, CreditCard, LoaderCircle,
  MessageSquareWarning, Paperclip, RefreshCw, Search, ShieldCheck, UserPlus, Users, X,
} from 'lucide-react'
import { uiText } from '../i18n/renderText'
import {
  adminApi, monthsToDays, type AdminOverview, type AdminPayment, type AdminPaymentPeriod, type AdminPayments,
  type AdminUser, type AdminUserDetail, type AdminUserFilter, type BugReportDetail, type BugReportList,
  type BugReportStatus, type PaymentStatus, type PlanId,
} from './adminApi'
import './adminMobile.css'

type Section = 'users' | 'payments' | 'requests'

const USER_FILTERS: Array<{ id: AdminUserFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Активные' },
  { id: 'trial', label: 'Пробные' },
  { id: 'inactive', label: 'Без подписки' },
  { id: 'streamers', label: 'Стримеры' },
  { id: 'blocked', label: 'Заблокированные' },
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

export function AdminMobilePage() {
  const [section, setSection] = useState<Section>('users')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [userFilter, setUserFilter] = useState<AdminUserFilter>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [payments, setPayments] = useState<AdminPayments | null>(null)
  const [period, setPeriod] = useState<AdminPaymentPeriod>('30d')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | 'all'>('succeeded')
  const [selected, setSelected] = useState<AdminUserDetail | null>(null)
  const [reports, setReports] = useState<BugReportList | null>(null)
  const [reportStatus, setReportStatus] = useState<BugReportStatus>('open')
  const [selectedReport, setSelectedReport] = useState<BugReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const loadOverview = useCallback(async () => setOverview(await adminApi.overview()), [])
  const loadUsers = useCallback(async () => {
    const result = await adminApi.users(query, userFilter)
    setUsers(result.users)
    setUsersTotal(result.total)
  }, [query, userFilter])
  const loadPayments = useCallback(async () => setPayments(await adminApi.payments(period, paymentStatus)), [period, paymentStatus])
  const loadReports = useCallback(async () => setReports(await adminApi.bugReports(reportStatus)), [reportStatus])
  const loadSection = useCallback(() => section === 'users' ? loadUsers() : section === 'payments' ? loadPayments() : loadReports(), [loadPayments, loadReports, loadUsers, section])

  useEffect(() => {
    let active = true
    const overviewRequest = adminApi.overview().then((result) => { if (active) setOverview(result) })
    const sectionRequest = section === 'users'
      ? adminApi.users(query, userFilter).then((result) => { if (active) { setUsers(result.users); setUsersTotal(result.total) } })
      : section === 'payments'
        ? adminApi.payments(period, paymentStatus).then((result) => { if (active) setPayments(result) })
        : adminApi.bugReports(reportStatus).then((result) => { if (active) setReports(result) })
    Promise.all([overviewRequest, sectionRequest])
      .catch((reason) => { if (active) setError(errorText(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [paymentStatus, period, query, reportStatus, section, userFilter])

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

  return (
    <div className="page admin-mobile-page">
      <header className="page-header admin-mobile-header">
        <div>
          <div className="eyebrow">RAID OS · OWNER</div>
          <h1 className="page-title">{uiText('Админ-панель')}</h1>
          <p className="page-subtitle">{uiText('Пользователи, подписки и платежи — с телефона.')}</p>
        </div>
        <button type="button" className="icon-button" onClick={refresh} disabled={refreshing} aria-label={uiText('Обновить')}>
          <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
        </button>
      </header>

      {error && <div className="admin-error" role="alert"><ShieldCheck size={18} /><span>{uiText(error)}</span></div>}

      <OverviewCards data={overview} />

      <div className="admin-section-switch" role="tablist" aria-label={uiText('Раздел админ-панели')}>
        <button type="button" role="tab" aria-selected={section === 'users'} className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}><Users size={18} />{uiText('Пользователи')}</button>
        <button type="button" role="tab" aria-selected={section === 'payments'} className={section === 'payments' ? 'active' : ''} onClick={() => setSection('payments')}><CreditCard size={18} />{uiText('Платежи')}</button>
        <button type="button" role="tab" aria-selected={section === 'requests'} className={section === 'requests' ? 'active' : ''} onClick={() => setSection('requests')}><MessageSquareWarning size={18} />{uiText('Заявки')}</button>
      </div>

      {loading ? <AdminLoading /> : section === 'users' ? (
        <UsersSection users={users} total={usersTotal} filter={userFilter} search={search} onFilter={setUserFilter} onSearch={setSearch} onOpen={openUser} />
      ) : section === 'payments' ? (
        <PaymentsSection data={payments} period={period} status={paymentStatus} onPeriod={setPeriod} onStatus={setPaymentStatus} />
      ) : (
        <RequestsSection data={reports} status={reportStatus} onStatus={setReportStatus} onOpen={openReport} />
      )}

      {selected && <UserSheet detail={selected} onClose={() => setSelected(null)} onUpdated={updateSelected} />}
      {selectedReport && <ReportSheet detail={selectedReport} onClose={() => setSelectedReport(null)} onUpdated={(report) => { setSelectedReport(report); void loadReports() }} />}
    </div>
  )
}

function RequestsSection({ data, status, onStatus, onOpen }: { data: BugReportList | null; status: BugReportStatus; onStatus: (status: BugReportStatus) => void; onOpen: (id: number) => void }) {
  return <section className="admin-block">
    <div className="admin-request-head">
      <div><span>{uiText('Открытые')}</span><strong>{data?.counts.open ?? 0}</strong></div>
      <div><span>{uiText('Закрытые')}</span><strong>{data?.counts.closed ?? 0}</strong></div>
    </div>
    <div className="admin-chip-row admin-request-filters" role="group" aria-label={uiText('Статус заявок')}>
      <button type="button" className={status === 'open' ? 'active' : ''} onClick={() => onStatus('open')}>{uiText('Новые и в работе')}</button>
      <button type="button" className={status === 'closed' ? 'active' : ''} onClick={() => onStatus('closed')}>{uiText('Закрытые')}</button>
    </div>
    <div className="admin-list">
      {(data?.reports ?? []).map((report) => <button type="button" className="admin-user-row admin-request-row" key={report.id} onClick={() => onOpen(report.id)}>
        <span className={`admin-payment-icon ${report.status === 'open' ? 'pending' : 'succeeded'}`}><MessageSquareWarning size={18} /></span>
        <span className="admin-row-copy"><strong>{report.topic}</strong><small>{report.email ?? uiText('Без почты')} · {report.platform || uiText('Платформа не указана')}</small></span>
        <span className="admin-row-side">{report.files > 0 && <strong className="admin-attachment"><Paperclip size={13} />{report.files}</strong>}<small>{dateTime(report.createdAt)}</small></span>
        <ChevronRight size={17} />
      </button>)}
      {!data?.reports.length && <AdminEmpty text={status === 'open' ? 'Новых заявок нет' : 'Закрытых заявок нет'} />}
    </div>
  </section>
}

function ReportSheet({ detail, onClose, onUpdated }: { detail: BugReportDetail; onClose: () => void; onUpdated: (report: BugReportDetail) => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const toggle = async () => {
    setSaving(true); setError('')
    try { onUpdated((await adminApi.setBugReportStatus(detail.id, detail.status === 'open' ? 'closed' : 'open')).report) }
    catch (reason) { setError(errorText(reason)) }
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
        {detail.files.length > 0 && <div className="admin-report-files"><Paperclip size={16} /><span>{uiText(`Прикреплено файлов: ${detail.files.length}`)}</span></div>}
        {error && <div className="admin-inline-error">{uiText(error)}</div>}
        <button type="button" className={`button admin-report-action${detail.status === 'open' ? ' primary' : ''}`} disabled={saving} onClick={toggle}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{uiText(detail.status === 'open' ? 'Закрыть заявку' : 'Вернуть в работу')}</button>
      </div>
    </section>
  </div>
}

function OverviewCards({ data }: { data: AdminOverview | null }) {
  return (
    <section className="admin-overview" aria-label={uiText('Сводка')}>
      <article><span><Users size={16} />{uiText('Пользователи')}</span><strong>{data?.users.total ?? '—'}</strong><small>{uiText(`+${data?.users.today ?? 0} сегодня`)}</small></article>
      <article><span><ShieldCheck size={16} />{uiText('Активные')}</span><strong>{data?.subscriptions.active ?? '—'}</strong><small>{uiText(`${data?.subscriptions.trials ?? 0} пробных`)}</small></article>
      <article><span><BadgeRussianRuble size={16} />{uiText('За месяц')}</span><strong>{data ? money(data.revenue.month.total) : '—'}</strong><small>{uiText(`${data?.revenue.month.payments ?? 0} оплат`)}</small></article>
      <article><span><CalendarDays size={16} />{uiText('За всё время')}</span><strong>{data ? money(data.revenue.all.total) : '—'}</strong><small>{uiText(`${data?.revenue.all.payments ?? 0} оплат`)}</small></article>
    </section>
  )
}

function UsersSection({ users, total, filter, search, onFilter, onSearch, onOpen }: {
  users: AdminUser[]; total: number; filter: AdminUserFilter; search: string
  onFilter: (value: AdminUserFilter) => void; onSearch: (value: string) => void; onOpen: (user: AdminUser) => void
}) {
  return (
    <section className="admin-block">
      <div className="admin-block-title"><div><span>{uiText('Список пользователей')}</span><strong>{total}</strong></div></div>
      <label className="admin-search"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={uiText('Поиск по почте')} aria-label={uiText('Поиск по почте')} />{search && <button type="button" onClick={() => onSearch('')} aria-label={uiText('Очистить')}><X size={16} /></button>}</label>
      <div className="admin-chip-row" role="group" aria-label={uiText('Фильтр пользователей')}>
        {USER_FILTERS.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => onFilter(item.id)}>{uiText(item.label)}</button>)}
      </div>
      <div className="admin-list">
        {users.map((user) => <button type="button" className="admin-user-row" key={user.id} onClick={() => onOpen(user)}>
          <span className={`admin-avatar ${user.subscription.status}`}>{user.email.slice(0, 1).toUpperCase()}</span>
          <span className="admin-row-copy"><strong>{user.email}</strong><small>{subscriptionText(user)} · {uiText(`оплат: ${user.payments.count}`)}</small></span>
          <span className="admin-row-side"><strong>{money(user.payments.total)}</strong><small>{dateOnly(user.createdAt)}</small></span>
          <ChevronRight size={17} />
        </button>)}
        {!users.length && <AdminEmpty text={search ? 'Пользователь не найден' : 'В этой категории пока нет пользователей'} />}
      </div>
    </section>
  )
}

function PaymentsSection({ data, period, status, onPeriod, onStatus }: {
  data: AdminPayments | null; period: AdminPaymentPeriod; status: PaymentStatus | 'all'
  onPeriod: (value: AdminPaymentPeriod) => void; onStatus: (value: PaymentStatus | 'all') => void
}) {
  const breakdown = useMemo(() => {
    const result: Record<PlanId, { count: number; total: number }> = {
      '1m': { count: 0, total: 0 }, '3m': { count: 0, total: 0 }, '6m': { count: 0, total: 0 }, '12m': { count: 0, total: 0 },
    }
    for (const payment of data?.payments ?? []) if (payment.status === 'succeeded') {
      result[payment.plan].count += 1
      result[payment.plan].total += payment.amount
    }
    return result
  }, [data])

  return (
    <section className="admin-block">
      <div className="admin-filter-grid">
        <label><span>{uiText('Период')}</span><select className="select" value={period} onChange={(event) => onPeriod(event.target.value as AdminPaymentPeriod)}>{PERIODS.map((item) => <option key={item.id} value={item.id}>{uiText(item.label)}</option>)}</select></label>
        <label><span>{uiText('Статус')}</span><select className="select" value={status} onChange={(event) => onStatus(event.target.value as PaymentStatus | 'all')}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{uiText(item.label)}</option>)}</select></label>
      </div>
      <div className="admin-payment-total">
        <span><Check size={18} />{uiText('Оплачено')}</span><strong>{money(data?.totals.revenue ?? 0)}</strong><small>{uiText(`${data?.totals.succeeded ?? 0} успешных платежей`)}</small>
      </div>
      <div className="admin-plan-grid">
        {(Object.keys(breakdown) as PlanId[]).map((plan) => <article key={plan}><span>{PLAN_LABEL[plan]}</span><strong>{breakdown[plan].count}</strong><small>{money(breakdown[plan].total)}</small></article>)}
      </div>
      <div className="admin-list admin-payment-list">
        {(data?.payments ?? []).map((payment) => <PaymentRow key={payment.id} payment={payment} />)}
        {!data?.payments.length && <AdminEmpty text="За выбранный период платежей нет" />}
      </div>
    </section>
  )
}

function PaymentRow({ payment }: { payment: AdminPayment }) {
  return <article className="admin-payment-row">
    <span className={`admin-payment-icon ${payment.status}`}><CreditCard size={18} /></span>
    <span className="admin-row-copy"><strong>{payment.email}</strong><small>{PLAN_LABEL[payment.plan]} · {payment.provider === 'lava' ? 'Lava.top' : 'ЮKassa'} · {statusText(payment.status)}</small></span>
    <span className="admin-row-side"><strong>{money(payment.amount)}</strong><small>{dateTime(payment.paidAt ?? payment.createdAt)}</small></span>
  </article>
}

function UserSheet({ detail, onClose, onUpdated }: { detail: AdminUserDetail; onClose: () => void; onUpdated: (detail: AdminUserDetail) => Promise<void> }) {
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState<'days' | 'months'>('months')
  const [reason, setReason] = useState('Оплата через Boosty')
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
        </div>

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
          {detail.payments.map((payment) => <PaymentRow key={payment.id} payment={payment} />)}
          {!detail.payments.length && <AdminEmpty text="Платежей пока нет" />}
          <h2>{uiText('Ручные начисления')}</h2>
          {detail.grants.map((grant, index) => <article className="admin-grant-row" key={`${grant.at}-${index}`}><span><strong>+{grant.days} дн.</strong><small>{grant.reason}</small></span><span><strong>{dateOnly(grant.paidUntil)}</strong><small>{dateTime(grant.at)}</small></span></article>)}
          {!detail.grants.length && <AdminEmpty text="Ручных начислений пока нет" />}
        </div>
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
