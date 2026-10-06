import { BadgeCheck, CalendarClock, Crown, LayoutDashboard, CreditCard, Download, Gift, Link2, LoaderCircle, LogOut, MousePointerClick, Radio, Receipt, RefreshCw, Save, ShieldCheck, UserPlus, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ApiError, api, errorMessage, type Account, type AccountMode, type Autopay, type FriendDiscount, type Payment, type PaymentStatus, type PlanId, type PlansResponse, type StatsPeriod } from '../api'
import { useAuth } from '../auth'
import { AudienceLinks, audienceLink } from '../components/AudienceLinks'
import { CopyButton } from '../components/CopyButton'
import { AutopayCard } from '../components/PaymentRegionDialog'
import { DeleteAccountPanel } from '../components/DeleteAccountPanel'
import { ReferralStatsTable } from '../components/ReferralStatsTable'
import { StreamerPayouts } from '../components/StreamerPayouts'
import { LEGAL_VERSION } from '../legal/documents'
import { Notice } from '../components/Notice'
import { PasswordPanel } from '../components/PasswordPanel'
import { EmailVerifyBanner } from '../components/EmailAuth'
import { APP_VERSION } from '../config'
import { loadReferralCode, normalizeReferralCode, REFERRAL_CODE_PATTERN, saveReferralCode } from '../storage'
import { DownloadButton } from './DownloadPage'
import { InviteFriendsPanel } from '../components/InviteFriendsPanel'
import '../invites.css'

const MODES: { id: AccountMode; label: string; color: string }[] = [
  { id: 'pvp', label: 'PvP', color: 'var(--brass)' },
  { id: 'pve', label: 'PvE', color: 'var(--green)' },
  { id: 'seasonal', label: 'Сезон', color: 'var(--blue)' },
]

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const numberFormat = new Intl.NumberFormat('ru-RU')

function formatMoney(amount: number, currency: string) {
  const digits = Number.isInteger(amount) ? 0 : 2
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(amount) } catch { return `${amount} ${currency}` }
}

export function CabinetPage() {
  const auth = useAuth()
  const location = useLocation()
  const state = (location.state ?? {}) as { welcome?: boolean; referralRejected?: boolean; streamerWelcome?: string; passwordReset?: boolean }

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

        {(state.welcome || state.referralRejected || state.streamerWelcome || state.passwordReset) && (
          <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
            {state.streamerWelcome && <Notice tone="success" title="Вы стример">Код {state.streamerWelcome} привязан к аккаунту. Ниже — ваша ссылка для зрителей и статистика.</Notice>}
            {state.welcome && !state.streamerWelcome && <Notice tone="success" title="Аккаунт создан">Добро пожаловать! Привяжите никнеймы Tarkov и скачайте приложение.</Notice>}
            {state.passwordReset && <Notice tone="success" title="Пароль изменён">Новый пароль сохранён. Входы на других устройствах завершены — там войдите заново.</Notice>}
            {state.referralRejected && <Notice tone="warn" title="Код приглашения не применён">Такой код не найден. Проверьте его и укажите ниже, в блоке «Код приглашения».</Notice>}
          </div>
        )}

        <EmailVerifyBanner />

        {account.owner && (
          <section className="panel owner-panel" style={{ marginBottom: 16 }} aria-labelledby="owner-title">
            <div className="panel-header">
              <div className="panel-title" id="owner-title"><Crown aria-hidden="true" />Раздел владельца</div>
              <span className="tag brass">Владелец</span>
            </div>
            <div className="panel-body" style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 14, maxWidth: 640 }}>Статистика, платежи, пользователи, стримеры, выплаты, настройки продаж и журнал действий — в админ-панели.</span>
              <Link to="/admin" className="button primary"><LayoutDashboard aria-hidden="true" />Открыть админ-панель</Link>
            </div>
          </section>
        )}

        <div className="cabinet-grid">
          <div className="cabinet-col">
            {account.kind === 'streamer' && account.referralCode && <ReferralProgramPanel account={account} />}
            <SubscriptionPanel account={account} />
            {account.kind === 'user' && <InviteFriendsPanel />}
            <NicknamesPanel account={account} />
          </div>
          <div className="cabinet-col">
            <AppPanel />
            {account.kind === 'user' && <InviteCodePanel account={account} />}
            <PasswordPanel />
            <DeleteAccountPanel />
          </div>
        </div>
      </div>
    </div>
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
  const [autopay, setAutopay] = useState<Autopay | null>(null)
  const [friendDiscount, setFriendDiscount] = useState<FriendDiscount | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
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
    api.payments(token).then((next) => { if (!cancelled) { setHistory(next.payments); setAutopay(next.autopay ?? null); setFriendDiscount(next.friendDiscount ?? null) } }, () => undefined)
    return () => { cancelled = true }
    // A friend's code entered below («Код приглашения») changes referredBy: reload for the friend's price.
  }, [token, historyVersion, account.referredBy])

  // «Оплатить» goes straight to ЮKassa: a one-off payment, no checkboxes. Pressing it accepts the offer (the text under
  // the plans says so). Without the separate autopayment consent the law requires, nothing is ever charged again.
  async function pay(plan: PlanId) {
    if (!token) return
    setPaying(plan)
    setPayError(null)
    try {
      const language = navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
      const { confirmationUrl } = await api.createPayment(token, plan, LEGAL_VERSION, { region: 'ru', language })
      window.location.assign(confirmationUrl) // ЮKassa payment page; buttons stay disabled while the browser leaves
    } catch (reason) {
      setPayError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })
      setPaying(null)
    }
  }

  async function cancelAutopay() {
    if (!token) return
    setCancelling(true)
    setCancelError(null)
    try {
      setAutopay((await api.cancelAutopay(token)).autopay)
    } catch (reason) {
      setCancelError(errorMessage(reason))
    } finally {
      setCancelling(false)
    }
  }

  const { status, paidUntil, trialEndsAt, lifetime } = account.subscription
  if (lifetime) {
    return (
      <section className="panel" aria-labelledby="sub-title">
        <div className="panel-header">
          <div className="panel-title" id="sub-title"><CreditCard aria-hidden="true" />Подписка</div>
          <span className="tag green">Активна</span>
        </div>
        <div className="panel-body">
          <div className="lifetime">
            <strong>Бесплатно навсегда (стример)</strong>
            <span>Для стримеров все функции открыты без оплаты и без срока. Ничего оплачивать не нужно.</span>
          </div>
        </div>
      </section>
    )
  }
  const active = status === 'active'
  const trial = status === 'trial'
  const title = active && paidUntil ? `Активна до ${dateFormat.format(new Date(paidUntil))}`
    : trial && trialEndsAt ? `Пробный период до ${dateFormat.format(new Date(trialEndsAt))}`
      : 'Не активна'
  const hint = active ? 'Оплата нового тарифа продлит подписку от текущей даты окончания.'
    : trial ? 'Бесплатный доступ по приглашению. Чтобы не потерять доступ, оформите подписку заранее — дни сложатся.'
      : 'Выберите тариф — доступ откроется сразу после оплаты.'
  const busy = paying !== null || check?.phase === 'checking'
  const locked = busy

  return (
    <section className="panel" aria-labelledby="sub-title">
      <div className="panel-header">
        <div className="panel-title" id="sub-title"><CreditCard aria-hidden="true" />Подписка</div>
        {active ? <span className="tag green">Активна</span> : trial ? <span className="tag brass">Пробный период</span> : <span className="tag">Не активна</span>}
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
        {check && <PaymentCheckNotice check={check} />}
        {autopay && <AutopayCard autopay={autopay} busy={cancelling} error={cancelError} onCancel={() => void cancelAutopay()} />}
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
                const friend = friendDiscount && plan.id === friendDiscount.plan && plan.price !== null ? friendDiscount.percent : 0
                const best = plan.discountPercent > 0 || friend > 0
                // The same rounding as the server (kopecks): server/src/services/paymentStore.ts create().
                const friendPrice = friend && plan.price !== null ? Math.round(plan.price * (100 - friend)) / 100 : null
                return (
                  <div key={plan.id} className={`plan-card${best ? ' is-best' : ''}`}>
                    {best && <span className="tag brass plan-badge">−{friend || plan.discountPercent}%</span>}
                    <div className="plan-head">
                      <span className="stat-label">{PLAN_LABELS[plan.id] ?? `${plan.months} мес.`}</span>
                    </div>
                    {friendPrice !== null && plan.price !== null ? (
                      <>
                        <div className="plan-price mono"><s className="plan-old" aria-label={`Без скидки ${formatMoney(plan.price, plan.currency)}`}>{formatMoney(plan.price, plan.currency)}</s> {formatMoney(friendPrice, plan.currency)}</div>
                        <div className="plan-friend-note">−{friend} % по коду друга, только первый месяц</div>
                      </>
                    ) : (
                      <>
                        <div className="plan-price mono">{plan.price === null ? '—' : formatMoney(plan.price, plan.currency)}</div>
                        <div className="stat-meta">{plan.price === null ? 'цена на странице оплаты' : plan.months > 1 ? `≈ ${formatMoney(Math.round(plan.price / plan.months), plan.currency)} в месяц` : 'помесячно'}</div>
                      </>
                    )}
                    <button type="button" className={`button block ${best ? 'primary' : ''}`} disabled={locked} onClick={() => void pay(plan.id)}>
                      {paying === plan.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}Оплатить
                    </button>
                  </div>
                )
              })}
            </div>
            <p className="dim" style={{ margin: 0, fontSize: 13 }}>
              Подписку можно отменить в любое время. Нажимая «Оплатить», вы принимаете условия <Link to="/legal/offer" target="_blank" rel="noopener" style={{ color: 'var(--brass-strong)' }}>оферты</Link>.
            </p>
            {payError && <Notice tone={payError.offline ? 'offline' : 'error'} title="Оплата не началась">{payError.message}</Notice>}
            <p className="receipt-note">
              <Receipt aria-hidden="true" />
              <span>Чек об оплате придёт на e-mail аккаунта: <strong style={{ color: 'var(--text-muted)' }}>{account.email}</strong>.</span>
            </p>
            <p className="dim" style={{ margin: 0, fontSize: 13 }}>
              <ShieldCheck size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />
              Оплата на защищённой странице ЮKassa: карта, СБП, SberPay, ЮMoney. <Link to="/legal" style={{ color: 'var(--brass-strong)' }}>Реквизиты и возврат</Link>
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
                  <td>{PLAN_LABELS[payment.plan]?.replace(/ (месяц|месяца|месяцев)$/, ' мес.') ?? payment.plan}{payment.renewal ? ' · автопродление' : ''}{payment.provider === 'lava' ? ' · Lava.top' : ''}{payment.discountPercent ? <span className="tag brass tag-mini">скидка {payment.discountPercent} %</span> : null}</td>
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
  const auth = useAuth()
  const token = auth.token
  const code = account.referralCode!
  const link = audienceLink(code)
  const stats = { visits: 0, registrations: 0, activeSubscriptions: 0, ...account.stats }
  const counters = [
    { icon: MousePointerClick, label: 'Переходы', value: numberFormat.format(stats.visits), meta: 'по вашим ссылкам' },
    { icon: UserPlus, label: 'Регистрации', value: numberFormat.format(stats.registrations), meta: 'по вашему коду' },
    { icon: BadgeCheck, label: 'Подписки', value: numberFormat.format(stats.activeSubscriptions), meta: 'активные сейчас' },
  ]
  const loadSeries = useCallback((period: StatsPeriod) => {
    if (!token) return Promise.reject(new ApiError(401, 'Требуется вход в аккаунт'))
    return api.referralSeries(token, period)
  }, [token])
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
        <AudienceLinks code={code} />
        <div className="stat-grid ref-stats">
          {counters.map(({ icon: Icon, label, value, meta }) => (
            <div key={label} className="stat-card">
              <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
              <div className="stat-value mono">{value}</div>
              <div className="stat-meta">{meta}</div>
            </div>
          ))}
        </div>
        <StreamerPayouts />
        <ReferralStatsTable load={loadSeries} />
        <div className="how-it-works">
          <div className="field-label">Как это работает</div>
          <ol className="steps">
            <li><span><strong>Поделитесь ссылкой или QR-кодом.</strong> Зрителям не нужно вводить промокод: код применится сам при регистрации, и они получат 3 дня бесплатного доступа.</span></li>
            <li><span><strong>Приглашённые оформляют подписку.</strong> С каждой их оплаты вам начисляется ваша доля — она появляется в «Заработано». Учитываются только платежи, подтверждённые ЮKassa.</span></li>
            <li><span><strong>Выплаты.</strong> Запросите выплату любой суммы от минимальной до доступной или включите автовыплату — раз в несколько дней заявка создастся сама.</span></li>
          </ol>
        </div>
      </div>
    </section>
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
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Есть код стримера или друга? Укажите его — это можно сделать один раз. Код стримера — 3 дня бесплатно. Код друга — скидка 20 % на первый месяц, только до первой оплаты.</p>
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
