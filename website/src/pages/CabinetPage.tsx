import { Activity, BadgeCheck, CalendarClock, Coins, CreditCard, Download, Gift, Link2, ListChecks, LoaderCircle, LogOut, MapPin, MousePointerClick, Package, Radio, Receipt, RefreshCw, Save, ShieldCheck, Trophy, UserPlus, Wallet, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ApiError, api, errorMessage, type Account, type AccountMode, type AccountSummary, type Payment, type PaymentStatus, type PlanId, type PlansResponse, type ReferralSeries, type ReferralSeriesRow, type StatsPeriod } from '../api'
import { useAuth } from '../auth'
import { CopyButton } from '../components/CopyButton'
import { Notice } from '../components/Notice'
import { APP_VERSION } from '../config'
import { loadReferralCode, normalizeReferralCode, REFERRAL_CODE_PATTERN, saveReferralCode } from '../storage'
import { DownloadButton } from './DownloadPage'

const MODES: { id: AccountMode; label: string; color: string }[] = [
  { id: 'pvp', label: 'PvP', color: 'var(--brass)' },
  { id: 'pve', label: 'PvE', color: 'var(--green)' },
  { id: 'seasonal', label: 'Сезон', color: 'var(--blue)' },
]

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const numberFormat = new Intl.NumberFormat('ru-RU')

function formatMoney(amount: number, currency: string) {
  const digits = Number.isInteger(amount) ? 0 : 2
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(amount) } catch { return `${amount} ${currency}` }
}

export function CabinetPage() {
  const auth = useAuth()
  const location = useLocation()
  const state = (location.state ?? {}) as { welcome?: boolean; referralRejected?: boolean; streamerWelcome?: string }

  if (auth.status === 'signed-out') return <Navigate to="/login" replace />

  if (auth.status === 'loading' || (auth.status === 'ready' && !auth.account)) {
    return (
      <div className="container page">
        <div className="panel center-state"><LoaderCircle className="spinner" aria-hidden="true" /><div>Загружаем личный кабинет…</div></div>
      </div>
    )
  }

  if (auth.status === 'error' || !auth.account) {
    const offline = auth.error?.network ?? false
    return (
      <div className="container page page-in">
        <div className="panel center-state" style={{ padding: 24 }}>
          {offline ? <WifiOff aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          <div style={{ maxWidth: 460 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 24, color: 'var(--text)' }}>{offline ? 'Нет связи с сервером' : 'Не удалось открыть кабинет'}</h1>
            <p style={{ margin: 0 }}>{auth.error?.message ?? 'Попробуйте ещё раз.'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="button primary" onClick={auth.reload}><RefreshCw aria-hidden="true" />Повторить</button>
            <button type="button" className="button ghost" onClick={() => void auth.logout()}><LogOut aria-hidden="true" />Выйти</button>
          </div>
        </div>
      </div>
    )
  }

  const account = auth.account
  return (
    <div className="page page-in">
      <div className="container">
        <div className="page-header">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Личный кабинет</div>
            <h1 className="page-title">{account.email}</h1>
            <p className="page-subtitle">Аккаунт создан {dateFormat.format(new Date(account.createdAt))}</p>
          </div>
          <button type="button" className="button ghost" onClick={() => void auth.logout()}><LogOut aria-hidden="true" />Выйти</button>
        </div>

        {(state.welcome || state.referralRejected || state.streamerWelcome) && (
          <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
            {state.streamerWelcome && <Notice tone="success" title="Вы стример">Код {state.streamerWelcome} привязан к аккаунту. Ниже — ваша ссылка для зрителей и статистика.</Notice>}
            {state.welcome && !state.streamerWelcome && <Notice tone="success" title="Аккаунт создан">Добро пожаловать! Привяжите никнеймы Tarkov и скачайте приложение.</Notice>}
            {state.referralRejected && <Notice tone="warn" title="Код приглашения не применён">Такой код не найден. Проверьте его и укажите ниже, в блоке «Код приглашения».</Notice>}
          </div>
        )}

        <div className="cabinet-grid">
          <div className="cabinet-col">
            {account.kind === 'streamer' && account.referralCode && <ReferralProgramPanel account={account} />}
            <SubscriptionPanel account={account} />
            <AppProgressPanel />
            <NicknamesPanel account={account} />
          </div>
          <div className="cabinet-col">
            <AppPanel />
            {account.kind === 'user' && <InviteCodePanel account={account} />}
          </div>
        </div>
      </div>
    </div>
  )
}

const MAP_NAMES: Record<string, string> = {
  customs: 'Таможня', woods: 'Лес', shoreline: 'Берег', lighthouse: 'Маяк', interchange: 'Развязка', reserve: 'Резерв',
  factory: 'Завод', 'the-lab': 'Лаборатория', streets: 'Улицы Таркова', 'streets-of-tarkov': 'Улицы Таркова', 'ground-zero': 'Эпицентр', labyrinth: 'Лабиринт',
}

function relativeTime(iso: string | null | undefined) {
  if (!iso) return null
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} ч назад`
  return dateTimeFormat.format(new Date(time))
}

/** What the desktop app sent to the server for each mode (GET /v1/me/summary). PvP, PvE and Season never mix. */
function AppProgressPanel() {
  const auth = useAuth()
  const [mode, setMode] = useState<AccountMode>('pvp')
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!auth.token) return Promise.resolve()
    return api.summary(auth.token).then(
      (next) => { setSummary(next); setError(null) },
      (reason: unknown) => setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network }),
    )
  }, [auth.token])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  const refresh = () => {
    setBusy(true)
    void load().finally(() => setBusy(false))
  }

  const data = summary?.modes[mode]
  const sync = relativeTime(data?.lastSyncAt)
  const position = data?.lastPosition
  const cards = data ? [
    { icon: ListChecks, label: 'Задания', value: numberFormat.format(data.quests.completed), meta: `выполнено · активно ${numberFormat.format(data.quests.active)}` },
    { icon: Trophy, label: 'Каппа', value: data.kappa ? `${data.kappa.completed} / ${data.kappa.total}` : '—', meta: data.kappa ? 'заданий для Каппы' : 'каталог загружается на сервере' },
    { icon: Package, label: 'Коллекционер', value: data.collector.total ? `${data.collector.collected} / ${data.collector.total}` : numberFormat.format(data.collector.collected), meta: 'предметов отмечено' },
    { icon: Activity, label: 'Синхронизация', value: sync ?? '—', meta: sync ? 'журналы игры' : 'ещё не было' },
  ] : []

  return (
    <section className="panel" aria-labelledby="progress-title">
      <div className="panel-header">
        <div className="panel-title" id="progress-title"><Activity aria-hidden="true" />Прогресс в приложении</div>
        <button type="button" className="button ghost small" onClick={refresh} disabled={busy} aria-label="Обновить">
          {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Обновить
        </button>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        <div role="tablist" aria-label="Режим" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {MODES.map(({ id, label, color }) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} className={`button small ${mode === id ? 'primary' : 'ghost'}`} onClick={() => setMode(id)}>
              <span className="mode-chip"><span className="mode-dot" style={{ background: color }} />{label}</span>
            </button>
          ))}
        </div>
        {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
        {!summary && !error && <div className="muted" style={{ fontSize: 14 }}>Загружаем данные приложения…</div>}
        {data && (
          <>
            <div className="stat-grid">
              {cards.map(({ icon: Icon, label, value, meta }) => (
                <div key={label} className="stat-card">
                  <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
                  <div className="stat-value mono">{value}</div>
                  <div className="stat-meta">{meta}</div>
                </div>
              ))}
            </div>
            <dl className="kv">
              <div><dt><MapPin size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />Последняя позиция</dt><dd>{position ? `${relativeTime(position.at)}${position.map ? ` · ${MAP_NAMES[position.map] ?? position.map}` : ''}` : 'нет данных'}</dd></div>
              {data.lastSyncAt && <div><dt>Журналы синхронизированы</dt><dd>{dateTimeFormat.format(new Date(data.lastSyncAt))}</dd></div>}
            </dl>
            {!data.lastSyncAt && !position && data.collector.collected === 0 && (
              <p className="dim" style={{ margin: 0, fontSize: 13 }}>Войдите в приложении (Профиль → «Аккаунт сервера») с этим e-mail — прогресс появится здесь после первого запуска игры.</p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

const PLAN_LABELS: Record<PlanId, string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }
const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  pending: { label: 'Ожидает', tone: '' },
  succeeded: { label: 'Оплачен', tone: 'green' },
  canceled: { label: 'Отменён', tone: 'danger' },
}
const PAYMENT_ID_PATTERN = /^[a-f0-9]{24}$/
const PAYMENT_POLL_MS = 3_000
const PAYMENT_POLL_LIMIT_MS = 120_000
const shortDateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

type PaymentCheck =
  | { phase: 'checking' }
  | { phase: 'succeeded'; paidUntil?: string }
  | { phase: 'canceled' }
  | { phase: 'timeout' }
  | { phase: 'error'; message: string }

/** Drops ?payment=… from the address bar once the check is over, so a reload does not re-check. */
function clearPaymentParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('payment')) return
  url.searchParams.delete('payment')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

/**
 * ЮKassa sends the user back to /cabinet?payment=<id>. Poll GET /v1/payments/:id (the server re-checks ЮKassa while the
 * payment is pending) until it settles or ~2 minutes pass, then refresh the account so the new paid period shows.
 */
function usePaymentCheck(paymentId: string | null, onSettled: () => void) {
  const auth = useAuth()
  const token = auth.token
  const [check, setCheck] = useState<PaymentCheck | null>(() => (paymentId ? { phase: 'checking' } : null))
  const callbacks = useRef({ setAccount: auth.setAccount, onSettled })
  useEffect(() => { callbacks.current = { setAccount: auth.setAccount, onSettled } })

  useEffect(() => {
    if (!paymentId || !token) return
    let cancelled = false
    let timer: number | undefined
    const started = Date.now()
    const finish = (next: PaymentCheck) => {
      if (cancelled) return
      setCheck(next)
      clearPaymentParam()
      callbacks.current.onSettled()
    }
    const poll = async () => {
      try {
        const payment = await api.payment(token, paymentId)
        if (cancelled) return
        if (payment.status === 'succeeded') {
          let paidUntil: string | undefined
          try {
            const me = await api.me(token)
            if (cancelled) return
            callbacks.current.setAccount(me)
            paidUntil = me.subscription.paidUntil
          } catch { /* the notice still says the payment went through */ }
          finish({ phase: 'succeeded', paidUntil })
          return
        }
        if (payment.status === 'canceled') { finish({ phase: 'canceled' }); return }
      } catch (reason) {
        if (cancelled) return
        // Network hiccups, rate limits and server errors are retried; "not found" and the like are final.
        if (reason instanceof ApiError && !reason.network && reason.status !== 429 && reason.status < 500) {
          finish({ phase: 'error', message: errorMessage(reason) })
          return
        }
      }
      if (Date.now() - started >= PAYMENT_POLL_LIMIT_MS) { finish({ phase: 'timeout' }); return }
      timer = window.setTimeout(() => void poll(), PAYMENT_POLL_MS)
    }
    void poll()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [paymentId, token])

  return check
}

function PaymentCheckNotice({ check }: { check: PaymentCheck }) {
  switch (check.phase) {
    case 'checking':
      return (
        <div className="notice info" role="status">
          <LoaderCircle className="spinner" aria-hidden="true" />
          <div><strong>Проверяем оплату…</strong>Это займёт несколько секунд — не закрывайте страницу.</div>
        </div>
      )
    case 'succeeded':
      return <Notice tone="success" title="Оплата прошла">{check.paidUntil ? `Подписка активна до ${dateFormat.format(new Date(check.paidUntil))}` : 'Подписка активна.'}</Notice>
    case 'canceled':
      return <Notice tone="warn" title="Оплата отменена">Деньги не списаны. Можно выбрать тариф и попробовать снова.</Notice>
    case 'timeout':
      return <Notice tone="warn" title="Оплата ещё обрабатывается">Платёжная система пока не подтвердила платёж. Обновите страницу через пару минут — статус появится в истории платежей.</Notice>
    case 'error':
      return <Notice tone="error" title="Не удалось проверить оплату">{check.message}</Notice>
  }
}

function SubscriptionPanel({ account }: { account: Account }) {
  const auth = useAuth()
  const token = auth.token
  const location = useLocation()
  const [paymentId] = useState(() => {
    const id = new URLSearchParams(location.search).get('payment')
    if (id && PAYMENT_ID_PATTERN.test(id)) return id
    if (id !== null) clearPaymentParam()
    return null
  })
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const [plansError, setPlansError] = useState<{ message: string; offline: boolean } | null>(null)
  const [history, setHistory] = useState<Payment[]>([])
  const [historyVersion, setHistoryVersion] = useState(0)
  const [paying, setPaying] = useState<PlanId | null>(null)
  const [payError, setPayError] = useState<{ message: string; offline: boolean } | null>(null)
  const reloadHistory = useCallback(() => setHistoryVersion((n) => n + 1), [])
  const check = usePaymentCheck(paymentId, reloadHistory)

  useEffect(() => {
    let cancelled = false
    api.plans().then(
      (next) => { if (!cancelled) { setPlans(next); setPlansError(null) } },
      (reason: unknown) => { if (!cancelled) setPlansError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network }) },
    )
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    // The history is secondary: on errors the table simply stays hidden.
    api.payments(token).then((next) => { if (!cancelled) setHistory(next.payments) }, () => undefined)
    return () => { cancelled = true }
  }, [token, historyVersion])

  async function pay(plan: PlanId) {
    if (!token) return
    setPaying(plan)
    setPayError(null)
    try {
      const { confirmationUrl } = await api.createPayment(token, plan)
      window.location.assign(confirmationUrl) // ЮKassa payment page; buttons stay disabled while the browser leaves
    } catch (reason) {
      setPayError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })
      setPaying(null)
    }
  }

  const { status, paidUntil, trialEndsAt } = account.subscription
  const active = status === 'active'
  const trial = status === 'trial'
  const title = active && paidUntil ? `Активна до ${dateFormat.format(new Date(paidUntil))}`
    : trial && trialEndsAt ? `Пробный период до ${dateFormat.format(new Date(trialEndsAt))}`
      : 'Не активна'
  const hint = active ? 'Оплата нового тарифа продлит подписку от текущей даты окончания.'
    : trial ? 'Бесплатный доступ по приглашению. Чтобы не потерять доступ, оформите подписку заранее — дни сложатся.'
      : 'Выберите тариф — доступ откроется сразу после оплаты.'
  const busy = paying !== null || check?.phase === 'checking'

  return (
    <section className="panel" aria-labelledby="sub-title">
      <div className="panel-header">
        <div className="panel-title" id="sub-title"><CreditCard aria-hidden="true" />Подписка</div>
        {active ? <span className="tag green">Активна</span> : trial ? <span className="tag brass">Пробный период</span> : <span className="tag">Не активна</span>}
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
        {check && <PaymentCheckNotice check={check} />}
        <div className="sub-status">
          <CalendarClock aria-hidden="true" size={28} style={{ color: active ? 'var(--success)' : trial ? 'var(--brass)' : 'var(--text-dim)', flex: '0 0 auto' }} />
          <div style={{ minWidth: 0 }}>
            <div className="big">{title}</div>
            <div className="muted" style={{ fontSize: 14 }}>{hint}</div>
          </div>
        </div>

        {plansError && <Notice tone={plansError.offline ? 'offline' : 'error'} title="Не удалось загрузить тарифы">{plansError.message}</Notice>}
        {!plans && !plansError && <div className="muted" style={{ fontSize: 14 }}>Загружаем тарифы…</div>}
        {plans && (!plans.enabled || plans.plans.length === 0) && (
          <Notice tone="info" title="Оплата скоро появится">Тарифы на 1, 3, 6 и 12 месяцев можно будет оплатить прямо здесь. Статус подписки проверяется только на сервере.</Notice>
        )}
        {plans?.enabled && plans.plans.length > 0 && (
          <>
            <div className="plan-grid">
              {plans.plans.map((plan) => {
                const best = plan.discountPercent > 0
                return (
                  <div key={plan.id} className={`plan-card${best ? ' is-best' : ''}`}>
                    {best && <span className="tag brass plan-badge">−{plan.discountPercent}%</span>}
                    <div className="plan-head">
                      <span className="stat-label">{PLAN_LABELS[plan.id] ?? `${plan.months} мес.`}</span>
                    </div>
                    <div className="plan-price mono">{formatMoney(plan.price, plan.currency)}</div>
                    <div className="stat-meta">{plan.months > 1 ? `≈ ${formatMoney(Math.round(plan.price / plan.months), plan.currency)} в месяц` : 'помесячно'}</div>
                    <button type="button" className={`button block ${best ? 'primary' : ''}`} disabled={busy} onClick={() => void pay(plan.id)}>
                      {paying === plan.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}Оплатить
                    </button>
                  </div>
                )
              })}
            </div>
            {payError && <Notice tone={payError.offline ? 'offline' : 'error'} title="Оплата не началась">{payError.message}</Notice>}
            <p className="dim" style={{ margin: 0, fontSize: 13 }}>
              <ShieldCheck size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />
              Оплата проходит на защищённой странице ЮKassa (банковская карта, СБП и др.). Разовый платёж, без автопродления.
            </p>
          </>
        )}

        {history.length > 0 && <PaymentHistory payments={history} />}
      </div>
    </section>
  )
}

function PaymentHistory({ payments }: { payments: Payment[] }) {
  return (
    <div className="pay-history">
      <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Receipt size={13} aria-hidden="true" />История платежей</div>
      <div className="table-scroll">
        <table className="pay-table">
          <thead>
            <tr><th scope="col">Дата</th><th scope="col">Тариф</th><th scope="col" className="num">Сумма</th><th scope="col">Статус</th></tr>
          </thead>
          <tbody>
            {payments.map((payment) => {
              const status = PAYMENT_STATUS[payment.status] ?? { label: payment.status, tone: '' }
              return (
                <tr key={payment.id}>
                  <td className="mono">{shortDateFormat.format(new Date(payment.paidAt ?? payment.createdAt))}</td>
                  <td>{PLAN_LABELS[payment.plan]?.replace(/ (месяц|месяца|месяцев)$/, ' мес.') ?? payment.plan}</td>
                  <td className="num mono">{formatMoney(payment.amount, payment.currency)}</td>
                  <td><span className={`tag ${status.tone}`}>{status.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReferralProgramPanel({ account }: { account: Account }) {
  const code = account.referralCode!
  const link = `${window.location.origin}/r/${encodeURIComponent(code)}`
  const empty = { amount: 0, currency: 'RUB' }
  const stats = { visits: 0, registrations: 0, activeSubscriptions: 0, ...account.stats, revenue: account.stats?.revenue ?? empty, earnings: account.stats?.earnings ?? empty }
  const counters = [
    { icon: MousePointerClick, label: 'Переходы', value: numberFormat.format(stats.visits), meta: 'по вашей ссылке' },
    { icon: UserPlus, label: 'Регистрации', value: numberFormat.format(stats.registrations), meta: 'с вашим кодом' },
    { icon: BadgeCheck, label: 'Подписки', value: numberFormat.format(stats.activeSubscriptions), meta: 'активные сейчас' },
  ]
  const money = [
    { icon: Wallet, label: 'Выручка по ссылке', value: formatMoney(stats.revenue.amount, stats.revenue.currency), meta: 'оплаты приглашённых', accent: false },
    { icon: Coins, label: 'Начисления', value: formatMoney(stats.earnings.amount, stats.earnings.currency), meta: 'ваша доля за всё время', accent: true },
  ]
  return (
    <section className="panel streamer-panel" aria-labelledby="ref-title">
      <div className="panel-header">
        <div className="panel-title" id="ref-title"><Radio aria-hidden="true" />Кабинет стримера</div>
        <span className="tag brass">Стример</span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
        <div className="ref-top" style={{ marginBottom: 0 }}>
          <div className="field">
            <span className="field-label">Ваш код</span>
            <div className="copy-row"><code>{code}</code><CopyButton value={code} /></div>
          </div>
          <div className="field">
            <span className="field-label"><Link2 size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />Ваша ссылка</span>
            <div className="copy-row"><code title={link}>{link}</code><CopyButton value={link} /></div>
          </div>
        </div>
        <div className="stat-grid ref-stats">
          {counters.map(({ icon: Icon, label, value, meta }) => (
            <div key={label} className="stat-card">
              <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
              <div className="stat-value mono">{value}</div>
              <div className="stat-meta">{meta}</div>
            </div>
          ))}
          {money.map(({ icon: Icon, label, value, meta, accent }) => (
            <div key={label} className={`stat-card is-money${accent ? ' is-accent' : ''}`}>
              <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
              <div className="stat-value mono">{value}</div>
              <div className="stat-meta">{meta}</div>
            </div>
          ))}
        </div>
        <StreamerStats />
        <div className="how-it-works">
          <div className="field-label">Как это работает</div>
          <ol className="steps">
            <li><span><strong>Поделитесь ссылкой или кодом.</strong> Кто зарегистрируется по ним, получит 3 дня бесплатного доступа.</span></li>
            <li><span><strong>Приглашённые оформляют подписку.</strong> Их оплаты попадают в «Выручку по ссылке», ваша доля — в «Начисления». Учитываются только платежи, подтверждённые ЮKassa.</span></li>
            <li><span><strong>Выплаты</strong> начислений согласуются с владельцем сервиса — напишите нам, когда захотите вывести сумму.</span></li>
          </ol>
        </div>
      </div>
    </section>
  )
}

const STATS_PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'day', label: 'По дням' },
  { id: 'month', label: 'По месяцам' },
  { id: 'year', label: 'По годам' },
]
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const PLAN_IDS: PlanId[] = ['1m', '3m', '6m', '12m']
const rubFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const rubCentsFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Whole roubles without kopecks, otherwise always two digits (119,60). */
const formatRub = (amount: number) => {
  const rounded = Math.round(amount * 100) / 100
  return (Number.isInteger(rounded) ? rubFormat : rubCentsFormat).format(rounded)
}

/** 2026-10-01 → «1 окт 2026», 2026-10 → «Октябрь 2026», 2026 → «2026». */
function formatPeriodKey(key: string) {
  const [year, month, day] = key.split('-')
  const m = Number(month) - 1
  if (day) return `${Number(day)} ${MONTHS_SHORT[m] ?? month} ${year}`
  if (month) return `${MONTHS_FULL[m] ?? month} ${year}`
  return year
}

/** Streamer statistics table (GET /v1/accounts/me/referral-stats): per day, month or year, with a totals row. */
function StreamerStats() {
  const auth = useAuth()
  const token = auth.token
  const [period, setPeriod] = useState<StatsPeriod>('day')
  const [series, setSeries] = useState<ReferralSeries | null>(null)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api.referralSeries(token, period).then(
      (next) => { if (!cancelled) { setSeries(next); setError(null) } },
      (reason: unknown) => { if (!cancelled) setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network }) },
    )
    return () => { cancelled = true }
  }, [token, period])

  const rows = series?.period === period ? series.rows : null
  const total = rows?.reduce<ReferralSeriesRow>((sum, row) => ({
    period: '', visits: sum.visits + row.visits, registrations: sum.registrations + row.registrations, payments: sum.payments + row.payments,
    months: { '1m': sum.months['1m'] + row.months['1m'], '3m': sum.months['3m'] + row.months['3m'], '6m': sum.months['6m'] + row.months['6m'], '12m': sum.months['12m'] + row.months['12m'] },
    revenue: sum.revenue + row.revenue, earnings: sum.earnings + row.earnings,
  }), { period: '', visits: 0, registrations: 0, payments: 0, months: { '1m': 0, '3m': 0, '6m': 0, '12m': 0 }, revenue: 0, earnings: 0 })
  const cells = (row: ReferralSeriesRow) => (
    <>
      <td className="num mono">{numberFormat.format(row.visits)}</td>
      <td className="num mono">{numberFormat.format(row.registrations)}</td>
      <td className="num mono">{numberFormat.format(row.payments)}</td>
      <td className="mono terms">{PLAN_IDS.filter((id) => row.months[id]).map((id) => `${id.replace('m', 'м')}: ${numberFormat.format(row.months[id])}`).join(' · ') || '—'}</td>
      <td className="num mono">{formatRub(row.revenue)}</td>
      <td className="num mono accent">{formatRub(row.earnings)}</td>
    </>
  )

  return (
    <div className="ref-series">
      <div className="ref-series-head">
        <div className="field-label">Статистика</div>
        <div role="tablist" aria-label="Период" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATS_PERIODS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={period === id} className={`button small ${period === id ? 'primary' : 'ghost'}`} onClick={() => setPeriod(id)}>{label}</button>
          ))}
        </div>
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {!rows && !error && <div className="muted" style={{ fontSize: 14 }}><LoaderCircle className="spinner" size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Загружаем статистику…</div>}
      {rows && rows.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Пока нет данных — они появятся после первых переходов по ссылке.</div>}
      {rows && rows.length > 0 && total && (
        <div className="table-scroll">
          <table className="pay-table stats-table">
            <thead>
              <tr>
                <th scope="col">Период</th><th scope="col" className="num">Переходы</th><th scope="col" className="num">Регистрации</th><th scope="col" className="num">Оплаты</th>
                <th scope="col" title="Сколько оплат на 1 / 3 / 6 / 12 месяцев">Сроки</th>
                <th scope="col" className="num">Выручка, ₽</th><th scope="col" className="num">Начисления, ₽</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const zero = !row.visits && !row.registrations && !row.payments && !row.revenue && !row.earnings
                return <tr key={row.period} className={zero ? 'is-zero' : undefined}><th scope="row">{formatPeriodKey(row.period)}</th>{cells(row)}</tr>
              })}
            </tbody>
            <tfoot>
              <tr><th scope="row">Итого</th>{cells(total)}</tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function NicknamesPanel({ account }: { account: Account }) {
  const auth = useAuth()
  const [values, setValues] = useState<Record<AccountMode, string>>(() => ({
    pvp: account.nicknames.pvp ?? '', pve: account.nicknames.pve ?? '', seasonal: account.nicknames.seasonal ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; offline?: boolean } | null>(null)
  const dirty = MODES.some(({ id }) => values[id].trim() !== (account.nicknames[id] ?? ''))

  async function save(event: FormEvent) {
    event.preventDefault()
    const bad = MODES.find(({ id }) => values[id].trim() && !/^[a-zA-Z0-9_-]{3,15}$/.test(values[id].trim()))
    if (bad) { setResult({ ok: false, message: `Никнейм ${bad.label}: 3–15 символов, латиница, цифры, «_» или «-».` }); return }
    if (!auth.token) return
    setBusy(true)
    setResult(null)
    try {
      const next = await api.setNicknames(auth.token, { pvp: values.pvp.trim(), pve: values.pve.trim(), seasonal: values.seasonal.trim() })
      auth.setAccount(next)
      setResult({ ok: true, message: 'Никнеймы сохранены.' })
    } catch (error) {
      setResult({ ok: false, message: errorMessage(error), offline: error instanceof ApiError && error.network })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="nick-title">
      <div className="panel-header">
        <div className="panel-title" id="nick-title"><BadgeCheck aria-hidden="true" />Никнеймы Tarkov</div>
      </div>
      <form className="panel-body form" onSubmit={save}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>У каждого режима свой профиль и прогресс — укажите ник для каждого режима, в котором играете.</p>
        <div className="nick-grid">
          {MODES.map(({ id, label, color }) => (
            <label key={id} className="field">
              <span className="field-label mode-chip"><span className="mode-dot" style={{ background: color }} />{label}</span>
              <input className="input" value={values[id]} maxLength={15} spellCheck={false} autoComplete="off" placeholder="Не привязан" onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))} />
            </label>
          ))}
        </div>
        {result && <Notice tone={result.ok ? 'success' : result.offline ? 'offline' : 'error'}>{result.message}</Notice>}
        <div><button type="submit" className="button primary" disabled={busy || !dirty}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}Сохранить</button></div>
      </form>
    </section>
  )
}

function AppPanel() {
  return (
    <section className="panel" aria-labelledby="app-title">
      <div className="panel-header">
        <div className="panel-title" id="app-title"><Download aria-hidden="true" />Приложение</div>
        <span className="tag brass">v{APP_VERSION}</span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Портативная версия для Windows. Войдите в приложении с тем же e-mail и паролем.</p>
        <DownloadButton large={false} />
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>Для мини-карты поверх игры включите в Tarkov режим экрана «Оконный без рамки».</p>
      </div>
    </section>
  )
}

function InviteCodePanel({ account }: { account: Account }) {
  const auth = useAuth()
  const [code, setCode] = useState(() => loadReferralCode() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)

  async function apply(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeReferralCode(code)
    if (!REFERRAL_CODE_PATTERN.test(normalized)) { setError({ message: 'Код: 3–24 символа, латиница, цифры, «_» или «-».', offline: false }); return }
    if (!auth.token) return
    setBusy(true)
    setError(null)
    try {
      auth.setAccount(await api.applyReferral(auth.token, normalized))
      saveReferralCode(null)
    } catch (reason) {
      setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="invite-title">
      <div className="panel-header">
        <div className="panel-title" id="invite-title"><Gift aria-hidden="true" />Код приглашения</div>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
        {account.referredBy ? (
          <dl className="kv">
            <div><dt>Вы приглашены по коду</dt><dd className="mono" style={{ color: 'var(--brass-strong)' }}>{account.referredBy}</dd></div>
          </dl>
        ) : (
          <form onSubmit={apply} style={{ display: 'grid', gap: 12 }}>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Пришли от автора или стримера? Укажите его код — это можно сделать один раз.</p>
            <div className="inline-form">
              <input className="input code" aria-label="Код приглашения" value={code} maxLength={24} spellCheck={false} autoComplete="off" placeholder="КОД" onChange={(e) => setCode(e.target.value)} />
              <button type="submit" className="button primary" disabled={busy || !code.trim()}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Применить</button>
            </div>
            {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
          </form>
        )}
      </div>
    </section>
  )
}
