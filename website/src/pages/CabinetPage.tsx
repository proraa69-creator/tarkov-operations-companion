import { BadgeCheck, CalendarClock, Crown, LayoutDashboard, CreditCard, Download, Gift, Link2, LoaderCircle, LogOut, MousePointerClick, Radio, Receipt, RefreshCw, Save, UserPlus, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ApiError, api, errorMessage, type Account, type Autopay, type FriendDiscount, type Payment, type PaymentStatus, type PlansResponse, type StatsPeriod, type YooKassaPaymentMethod } from '../api'
import { useAuth } from '../auth'
import { AudienceLinks, audienceLink } from '../components/AudienceLinks'
import { CopyButton } from '../components/CopyButton'
import { AutopayCard, YooKassaPaymentDialog } from '../components/PaymentRegionDialog'
import { DeleteAccountPanel } from '../components/DeleteAccountPanel'
import { ReferralStatsTable } from '../components/ReferralStatsTable'
import { StreamerPayouts } from '../components/StreamerPayouts'
import { Notice } from '../components/Notice'
import { PasswordPanel } from '../components/PasswordPanel'
import { SignOutEverywherePanel } from '../components/SignOutEverywherePanel'
import { EmailVerifyBanner } from '../components/EmailAuth'
import { APP_VERSION } from '../config'
import { loadReferralCode, normalizeReferralCode, REFERRAL_CODE_PATTERN, saveReferralCode } from '../storage'
import { DownloadButton } from './DownloadPage'
import { InviteFriendsPanel } from '../components/InviteFriendsPanel'
import { formatMoney, PLAN_LABELS, planSaving, visiblePlans } from '../plans'
import { PlanSaving } from '../components/PlanSaving'
import { LEGAL_VERSION } from '../legal/documents'
import '../invites.css'

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const numberFormat = new Intl.NumberFormat('ru-RU')

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
            {state.welcome && !state.streamerWelcome && <Notice tone="success" title="Аккаунт создан">Добро пожаловать! Укажите ник в Escape from Tarkov и скачайте приложение.</Notice>}
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
            <SignOutEverywherePanel />
            <DeleteAccountPanel />
          </div>
        </div>
      </div>
    </div>
  )
}

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  pending: { label: 'Ожидает', tone: '' },
  succeeded: { label: 'Оплачен', tone: 'green' },
  canceled: { label: 'Отменён', tone: 'danger' },
  refunded: { label: 'Возвращён', tone: 'danger' },
}
const PAYMENT_ID_PATTERN = /^[a-f0-9]{24}$/
const PAYMENT_POLL_MS = 1_500
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
          <div><strong>Проверяем предыдущую оплату…</strong>Можно сразу выбрать тариф и начать новую оплату другим способом.</div>
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
  const [history, setHistory] = useState<Payment[]>([])
  const [historyVersion, setHistoryVersion] = useState(0)
  const [selectedPlan, setSelectedPlan] = useState<PlansResponse['plans'][number] | null>(null)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<{ message: string; offline: boolean } | null>(null)
  const [autopay, setAutopay] = useState<Autopay | null>(null)
  const [friendDiscount, setFriendDiscount] = useState<FriendDiscount | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const reloadHistory = useCallback(() => setHistoryVersion((n) => n + 1), [])
  const check = usePaymentCheck(paymentId, reloadHistory)

  async function pay(method: YooKassaPaymentMethod, autoRenew: boolean) {
    if (!token || !selectedPlan) return
    setPaying(true)
    setPayError(null)
    try {
      const { confirmationUrl } = await api.createPayment(token, selectedPlan.id, LEGAL_VERSION, { region: 'ru', method, language: 'ru', ...(autoRenew ? { autopayVersion: LEGAL_VERSION } : {}) })
      window.location.assign(confirmationUrl)
    } catch (reason) {
      setPayError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })
      setPaying(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    api.plans().then(
      (next) => { if (!cancelled) setPlans(next) },
      () => undefined,
    )
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    // The history is secondary: on errors the table simply stays hidden.
    api.payments(token).then((next) => { if (!cancelled) { setHistory(next.payments); setAutopay(next.autopay ?? null); setFriendDiscount(next.friendDiscount ?? null) } }, () => undefined)
    return () => { cancelled = true }
    // A code entered below («Код приглашения»): a streamer's sets referredBy, a friend's invitedByFriend — reload the price.
  }, [token, historyVersion, account.referredBy, account.invitedByFriend])

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
      <section className="panel" id="subscription" aria-labelledby="sub-title">
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
  const hint = active ? 'Ваша подписка продолжает действовать.' : trial ? 'Бесплатный доступ по приглашению.' : ''
  const shownPlans = visiblePlans(plans)
  const checkoutPlan = selectedPlan && friendDiscount?.plan === selectedPlan.id && selectedPlan.price !== null
    ? { ...selectedPlan, price: Math.round(selectedPlan.price * (100 - friendDiscount.percent)) / 100 }
    : selectedPlan

  return (
    <>
    <section className="panel" id="subscription" aria-labelledby="sub-title">
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
            {hint && <div className="muted" style={{ fontSize: 14 }}>{hint}</div>}
          </div>
        </div>

        <>
            <div className="plan-grid">
              {shownPlans.map((plan) => {
                const friend = friendDiscount && plan.id === friendDiscount.plan && plan.price !== null ? friendDiscount.percent : 0
                const best = plan.discountPercent > 0 || friend > 0
                // The same rounding as the server (kopecks): server/src/services/paymentStore.ts create().
                const friendPrice = friend && plan.price !== null ? Math.round(plan.price * (100 - friend)) / 100 : null
                const saving = planSaving(plan, shownPlans)
                return (
                  <div key={plan.id} className={`plan-card has-pay${best ? ' is-best' : ''}`}>
                    {best && <span className="tag brass plan-badge">−{friend || plan.discountPercent}%</span>}
                    <div className="plan-head">
                      <span className="stat-label">{PLAN_LABELS[plan.id] ?? `${plan.months} мес.`}</span>
                    </div>
                    {friendPrice !== null && plan.price !== null ? (
                      <>
                        <div className="plan-price mono"><s className="plan-old" aria-label={`Без скидки ${formatMoney(plan.price, plan.currency)}`}>{formatMoney(plan.price, plan.currency)}</s> {formatMoney(friendPrice, plan.currency)}</div>
                        <div className="plan-friend-note">−{friend} % по приглашению, только первый месяц</div>
                      </>
                    ) : (
                      <>
                        <div className="plan-price mono">{plan.price === null ? '—' : formatMoney(plan.price, plan.currency)}</div>
                        {saving && <PlanSaving {...saving} currency={plan.currency} />}
                        <div className="stat-meta">{plan.price === null ? 'цена на странице оплаты' : plan.months > 1 ? `≈ ${formatMoney(Math.round(plan.price / plan.months), plan.currency)} в месяц` : 'помесячно'}</div>
                      </>
                    )}
                    <button type="button" className={`button block ${best ? 'primary' : ''}`} disabled={!plans?.providers?.yookassa || paying} onClick={() => { setPayError(null); setSelectedPlan(plan) }} aria-label={`Оплатить ${PLAN_LABELS[plan.id]}`}>
                      <CreditCard aria-hidden="true" />Оплатить
                    </button>
                  </div>
                )
              })}
            </div>
            {!plans?.providers?.yookassa && <Notice tone="info" title="Оплата временно недоступна">Тарифы и цены показаны для ознакомления. Попробуйте ещё раз позже.</Notice>}
          </>

        {history.length > 0 && <PaymentHistory payments={history} />}
      </div>
    </section>
    {checkoutPlan && <YooKassaPaymentDialog plan={checkoutPlan} methods={plans?.providers?.methods ?? ['sbp']} autopayAvailable={plans?.providers?.autopay === true} busy={paying} error={payError} onClose={() => { if (!paying) { setSelectedPlan(null); setPayError(null) } }} onPay={(method, autoRenew) => void pay(method, autoRenew)} />}
    </>
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
            <li><span><strong>Приглашённые оформляют подписку.</strong> С каждой их оплаты вам начисляется ваша доля — она появляется в «Заработано». Учитываются только подтверждённые платежи.</span></li>
            <li><span><strong>Выплаты.</strong> Запросите выплату любой суммы от минимальной до доступной или включите автовыплату — раз в несколько дней заявка создастся сама.</span></li>
          </ol>
        </div>
      </div>
    </section>
  )
}

/** The account's nickname: the server's one, or — from a server before it — the first of PvP → PvE → «Сезон». */
function accountNickname(account: Account) {
  return account.nickname ?? account.nicknames.pvp ?? account.nicknames.pve ?? account.nicknames.seasonal ?? ''
}

/** «Ник в Escape from Tarkov»: one for PvP, PvE and «Сезон» — in the game a character has the same nickname everywhere. */
function NicknamesPanel({ account }: { account: Account }) {
  const auth = useAuth()
  const saved = accountNickname(account)
  const [value, setValue] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; offline?: boolean } | null>(null)
  const dirty = value.trim() !== saved

  async function save(event: FormEvent) {
    event.preventDefault()
    const nickname = value.trim()
    if (nickname && !/^[a-zA-Z0-9_-]{3,15}$/.test(nickname)) { setResult({ ok: false, message: 'Ник: 3–15 символов, латиница, цифры, «_» или «-».' }); return }
    if (!auth.token) return
    setBusy(true)
    setResult(null)
    try {
      const next = await api.setNickname(auth.token, nickname)
      auth.setAccount(next)
      setResult({ ok: true, message: nickname ? 'Ник сохранён.' : 'Ник удалён.' })
    } catch (error) {
      setResult({ ok: false, message: errorMessage(error), offline: error instanceof ApiError && error.network })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="nick-title">
      <div className="panel-header">
        <div className="panel-title" id="nick-title"><BadgeCheck aria-hidden="true" />Ник в Escape from Tarkov</div>
      </div>
      <form className="panel-body form" onSubmit={save}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Один ник для PvP, PvE и «Сезона» — в игре он у персонажа везде одинаковый. Прогресс заданий у каждого режима свой.</p>
        {/* «Пригласи друга»: the game account the desktop app found in the logs (one game account — one Raid OS account). */}
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Аккаунт Escape from Tarkov: {account.eftAccount ? <strong className="mono">{account.eftAccount.masked}</strong> : 'не привязан — откройте приложение Raid OS на ПК с игрой, оно найдёт аккаунт в логах игры'}.
        </p>
        <label className="field nick-field">
          <span className="field-label">Ник</span>
          <input className="input" value={value} maxLength={15} spellCheck={false} autoComplete="off" placeholder="Не привязан" onChange={(e) => setValue(e.target.value)} />
        </label>
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
        ) : account.invitedByFriend ? (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>Вы пришли по приглашению друга: скидка 20 % на первый месяц действует до первой оплаты.</p>
        ) : (
          <form onSubmit={apply} style={{ display: 'grid', gap: 12 }}>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Есть код друга? Укажите его один раз до первой оплаты и получите скидку 20 % на первый месяц.</p>
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
