import { useEffect, useState } from 'react'
import { AlertTriangle, CreditCard, Gift, Lock, LogOut, MonitorSmartphone, RefreshCw } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useServerAccount, usesWebAccount } from '../sync/serverSync'
import { webServiceRequest } from '../sync/webAccount'
import { ServerAccountPanel } from '../components/ServerAccountPanel'
import { SignInStep } from './AccountSignIn'
import { openWebsite, subscriptionText } from './accountActions'
import { lockedReasonText, type DataAccess } from './dataAccess'
import { requestNicknameStep } from './accountEvents'
import './account.css'
import './paywall.css'

/** While the paywall is open the status is checked this often: a payment on the website unlocks the app by itself. */
export const PAYWALL_REFRESH_MS = 15_000

interface Plan { id: '1m' | '3m' | '6m' | '12m'; months: number; price: number | null; currency: string; discountPercent: number }

const PLAN_NAMES: Record<Plan['id'], string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }
const DEFAULT_PLANS: Plan[] = [
  { id: '1m', months: 1, price: null, currency: 'RUB', discountPercent: 0 },
  { id: '3m', months: 3, price: null, currency: 'RUB', discountPercent: 10 },
  { id: '6m', months: 6, price: null, currency: 'RUB', discountPercent: 17 },
  { id: '12m', months: 12, price: null, currency: 'RUB', discountPercent: 33 },
]

/**
 * The players' app without a valid entitlement (docs/subscription-protection.md): only the account and the subscription.
 * Signed out → sign-in (or registration on the website); signed in → plans, «Оплатить» on the website, the referral
 * trial. Game pages stay locked until the server issues a signed entitlement for this device.
 */
export function Paywall({ access }: { access: Extract<DataAccess, { state: 'locked' | 'checking' }> }) {
  const { status, checking, refresh, logout } = useServerAccount()
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh() }, PAYWALL_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  if (access.state === 'checking') {
    return <div className="paywall" role="status"><section className="panel paywall-card"><RefreshCw className="spin" size={22} /><p className="muted">{uiText('Проверяем подписку…')}</p></section></div>
  }

  if (access.reason === 'signed-out') {
    return (
      <div className="paywall">
        <section className="panel paywall-card" aria-label={uiText('Вход в аккаунт')}>
          <PaywallHeader />
          {/* The phone signs in with its own form (server address included); the desktop with the first-run form. */}
          {usesWebAccount() ? <ServerAccountPanel /> : <SignInStep onSigningIn={() => {}} onSignedIn={(nicknames) => { requestNicknameStep(nicknames); void refresh() }} />}
        </section>
      </div>
    )
  }

  const subscription = status?.subscription
  const trialOver = subscription?.status === 'inactive' && Boolean(subscription.trialEndsAt)
  return (
    <div className="paywall">
      <section className="panel paywall-card" aria-label={uiText('Подписка')}>
        <PaywallHeader />
        <div className="paywall-account">
          <span>{uiText('Аккаунт')}: <strong>{status?.email ?? '—'}</strong></span>
          <span className="tag brass">{uiText(subscriptionText(subscription))}</span>
        </div>
        <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(lockedReasonText(access.reason, access.message))}</span></div>
        {access.reason === 'subscription' && <PlanList />}
        <div className="paywall-trial">
          <Gift size={16} />
          <span>{uiText(trialOver
            ? 'Пробный период закончился. Оформите подписку, чтобы продолжить.'
            : 'Есть код друга? Укажите его в личном кабинете на сайте до первой оплаты — скидка 20 % на первый месяц.')}</span>
        </div>
        <div className="paywall-actions">
          <button className="button primary" onClick={() => openWebsite('cabinet')}><CreditCard size={15} />{uiText('Оплатить')}</button>
          <button className="button ghost" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Проверить оплату')}</button>
          <button className="button danger" onClick={() => { if (window.confirm(uiText('Выйти из аккаунта на этом устройстве?'))) void logout() }}><LogOut size={14} />{uiText('Выйти')}</button>
        </div>
        <p className="paywall-note"><MonitorSmartphone size={13} />{uiText('Подписка работает на трёх устройствах одновременно. Вход на четвёртом отключает то, которым пользовались давнее всех.')}</p>
      </section>
    </div>
  )
}

function PaywallHeader() {
  return (
    <header className="paywall-header">
      <span className="paywall-icon"><Lock size={20} /></span>
      <div>
        <div className="eyebrow">Raid OS</div>
        <h1>{uiText('Нужна подписка')}</h1>
      </div>
    </header>
  )
}

const rub = (amount: number) => `${amount.toLocaleString('ru-RU')} ₽`

/** «810 ₽ вместо 900 ₽, экономия 90 ₽»: a longer plan against paying month by month (website/src/plans.ts planSaving). */
function planSaving(plan: Plan, plans: Plan[]) {
  const month = plans.find((entry) => entry.months === 1)?.price
  if (plan.months <= 1 || !plan.price || !month) return null
  const full = Math.round(month * plan.months * 100) / 100
  const saving = Math.round((full - plan.price) * 100) / 100
  return saving > 0 ? { full, saving } : null
}

/** Plans and prices from the server (GET /v1/payments/plans); without prices — «цена на странице оплаты». */
function PlanList() {
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS)
  useEffect(() => {
    let alive = true
    const request = window.tarkovDesktop?.serviceRequest ?? (usesWebAccount() ? webServiceRequest : undefined)
    void request?.('GET', '/v1/payments/plans').then((answer) => {
      const list = (answer as { plans?: unknown } | null)?.plans
      if (alive && Array.isArray(list) && list.length) setPlans(list.filter((plan): plan is Plan => Boolean(plan) && typeof (plan as Plan).id === 'string' && (plan as Plan).id in PLAN_NAMES))
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  return (
    <div className="paywall-plans" role="list">
      {plans.map((plan) => {
        const saving = planSaving(plan, plans)
        return (
          <button type="button" key={plan.id} role="listitem" className={`paywall-plan${plan.id === '12m' ? ' best' : ''}`} onClick={() => openWebsite('cabinet')}>
            <strong>{uiText(PLAN_NAMES[plan.id])}</strong>
            <span>{plan.price ? rub(plan.price) : uiText('цена на странице оплаты')}</span>
            {saving && <span>{uiText('вместо')} <s>{rub(saving.full)}</s></span>}
            {plan.discountPercent > 0 && <small>−{plan.discountPercent}%{saving ? ` · ${uiText('экономия')} ${rub(saving.saving)}` : ''}</small>}
          </button>
        )
      })}
    </div>
  )
}

/** One-time notice after a sign-in that switched other devices off (three-device limit). */
export function DeviceLimitNotice() {
  const { status } = useServerAccount()
  const [dismissed, setDismissed] = useState('')
  const devices = status?.entitlement?.revokedDevices ?? []
  const key = devices.map((device) => `${device.name}@${device.lastSeenAt}`).join('|')
  if (!devices.length || dismissed === key) return null
  return (
    <div className="paywall-device-notice" role="status">
      <MonitorSmartphone size={16} />
      <span>{uiText('Вход выполнен. Чтобы на аккаунте было не больше трёх устройств, отключено:')} <strong>{devices.map((device) => device.name).join(', ')}</strong></span>
      <button className="button ghost" onClick={() => setDismissed(key)}>{uiText('Понятно')}</button>
    </div>
  )
}
