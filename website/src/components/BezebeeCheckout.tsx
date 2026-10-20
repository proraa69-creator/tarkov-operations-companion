import { CreditCard, ExternalLink, LoaderCircle, Mail, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, api, errorMessage, type PlanId } from '../api'
import { useAuth } from '../auth'
import { tr } from '../i18n'
import { formatMoney, planSaving } from '../plans'
import { Notice } from './Notice'
import { PlanSaving } from './PlanSaving'
import '../payments.css'

/** The e-mail warning before every BZB redirect: BZB asks for an e-mail or Telegram, the owner finds the payment by it. */
export const BEZEBEE_EMAIL_WARNING = 'При оплате укажите тот же email, который используется в вашем аккаунте Raid OS. Иначе мы не сможем найти платёж и открыть подписку.'

export interface BezebeePlan { plan: PlanId; months: number; price: number }

const LABELS: Record<PlanId, string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }

/**
 * The CIS tariffs on BZB (owner, 20.10.2026: «каждую ссылку отдельно, каждой кнопкой, как у нас сделано с ЮKassa»): one
 * card and one «Оплатить» per plan, like the Russian plans. The server lists them only for a CIS account and hands out a
 * plan's page only after the e-mail warning was ticked (server/src/services/bezebee.ts).
 */
export function BezebeePlans({ plans, currency, email }: { plans: BezebeePlan[]; currency: string; email: string }) {
  const [picked, setPicked] = useState<BezebeePlan | null>(null)
  const grid = plans.map((entry) => ({ id: entry.plan, months: entry.months, price: entry.price, currency: 'RUB' as const, discountPercent: 0 }))
  return (
    <div className="bezebee-plans">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {tr('Для вашей страны (СНГ) — оплата картой на странице сервиса BZB.')}{' '}
        {tr('Подписка в Raid OS откроется, когда мы найдём платёж по email вашего аккаунта.')}
      </p>
      <div className="plan-grid">
        {plans.map((entry, index) => {
          const saving = planSaving(grid[index], grid)
          const label = tr(LABELS[entry.plan])
          return (
            <div key={entry.plan} className="plan-card has-pay">
              <div className="plan-head"><span className="stat-label">{label}</span></div>
              <div className="plan-price mono">{formatMoney(entry.price, currency)}</div>
              {saving && <PlanSaving {...saving} currency={currency} />}
              <div className="stat-meta">{entry.months > 1 ? tr('≈ {price} в месяц', { price: formatMoney(Math.round(entry.price / entry.months), currency) }) : tr('помесячно')}</div>
              <button type="button" className="button block" onClick={() => setPicked(entry)} aria-label={tr('Оплатить {plan}', { plan: label })}>
                <CreditCard aria-hidden="true" />{tr('Оплатить')}
              </button>
            </div>
          )
        })}
      </div>
      {picked && <BezebeeWarningDialog plan={picked} currency={currency} email={email} onClose={() => setPicked(null)} />}
    </div>
  )
}

/** The warning; «Перейти к оплате» stays disabled until it is acknowledged, and only then the server names the page. */
function BezebeeWarningDialog({ plan, currency, email, onClose }: { plan: BezebeePlan; currency: string; email: string; onClose: () => void }) {
  const auth = useAuth().token
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function go() {
    if (!auth || !ack) return
    setBusy(true)
    setError(null)
    try {
      const { url } = await api.bezebeeLink(auth, plan.plan)
      window.location.assign(url)
    } catch (reason) {
      setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })
      setBusy(false)
    }
  }

  return createPortal(
    <div className="pay-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="pay-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow">BZB</div>
            <h2 id={titleId}>{tr(LABELS[plan.plan])} · {formatMoney(plan.price, currency)}</h2>
          </div>
          <button type="button" className="icon-button" aria-label={tr('Закрыть')} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="boosty-warning" role="note">
          <Mail aria-hidden="true" />
          <div>
            <p>{tr(BEZEBEE_EMAIL_WARNING)}</p>
            <p className="mono boosty-email">{email}</p>
          </div>
        </div>
        <label className="consent pay-autopay" htmlFor="bezebee-email-ack">
          <input id="bezebee-email-ack" type="checkbox" checked={ack} disabled={busy} onChange={(event) => setAck(event.target.checked)} />
          <span>{tr('Понятно: укажу при оплате этот email')}</span>
        </label>
        <p className="pay-dialog-note">{tr('Оплата разовая, без автопродления. Подписка откроется после проверки платежа.')}</p>
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title={tr('Ссылка не открылась')}>{tr(error.message)}</Notice>}
        <div className="pay-dialog-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</button>
          <button type="button" className="button primary" disabled={!ack || busy} onClick={() => void go()}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
            {tr('Перейти к оплате')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
