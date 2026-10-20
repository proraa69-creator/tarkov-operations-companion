import { CreditCard, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ApiError, api, errorMessage, type PlanId } from '../api'
import { useAuth } from '../auth'
import { tr } from '../i18n'
import { LEGAL_VERSION } from '../legal/documents'
import { formatMoney, planSaving } from '../plans'
import { Notice } from './Notice'
import { PlanSaving } from './PlanSaving'
import '../payments.css'

export interface BezebeePlan { plan: PlanId; months: number; price: number }

const LABELS: Record<PlanId, string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }

/**
 * The CIS tariffs on BZB (owner, 20.10.2026: «каждую ссылку отдельно, каждой кнопкой, как у нас сделано с ЮKassa»): one
 * card and one «Оплатить» per plan, a discounted plan highlighted like the Russian ones. Before leaving for BZB the same
 * confirmation as for ЮKassa: the offer and the personal data consent (stored with its version on the server), a one-time
 * payment — and no e-mail warning (owner: «при оплате через новый сервис это не нужно показывать»). The server lists the
 * plans only for a CIS account and names a plan's page only with the consent (server/src/services/bezebee.ts).
 */
export function BezebeePlans({ plans, currency }: { plans: BezebeePlan[]; currency: string }) {
  const [picked, setPicked] = useState<BezebeePlan | null>(null)
  const grid = plans.map((entry) => ({ id: entry.plan, months: entry.months, price: entry.price, currency: 'RUB' as const, discountPercent: 0 }))
  return (
    <div className="bezebee-plans">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {tr('Для вашей страны (СНГ) — оплата картой на странице сервиса BZB.')}{' '}
        {tr('Подписка откроется после подтверждения оплаты.')}
      </p>
      <div className="plan-grid">
        {plans.map((entry, index) => {
          const saving = planSaving(grid[index], grid)
          const percent = saving ? Math.round((saving.saving / saving.full) * 100) : 0
          const label = tr(LABELS[entry.plan])
          return (
            <div key={entry.plan} className={`plan-card has-pay${percent ? ' is-best' : ''}`}>
              {percent > 0 && <span className="tag brass plan-badge">−{percent}%</span>}
              <div className="plan-head"><span className="stat-label">{label}</span></div>
              <div className="plan-price mono">{formatMoney(entry.price, currency)}</div>
              {saving && <PlanSaving {...saving} currency={currency} />}
              <div className="stat-meta">{entry.months > 1 ? tr('≈ {price} в месяц', { price: formatMoney(Math.round(entry.price / entry.months), currency) }) : tr('помесячно')}</div>
              <button type="button" className={`button block ${percent ? 'primary' : ''}`} onClick={() => setPicked(entry)} aria-label={tr('Оплатить {plan}', { plan: label })}>
                <CreditCard aria-hidden="true" />{tr('Оплатить')}
              </button>
            </div>
          )
        })}
      </div>
      {picked && <BezebeePayDialog plan={picked} currency={currency} onClose={() => setPicked(null)} />}
    </div>
  )
}

/** «Перейти к оплате» stays disabled until the offer and the personal data consent are accepted. */
function BezebeePayDialog({ plan, currency, onClose }: { plan: BezebeePlan; currency: string; onClose: () => void }) {
  const auth = useAuth().token
  const [consent, setConsent] = useState(false)
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
    if (!auth || !consent) return
    setBusy(true)
    setError(null)
    try {
      const { url } = await api.bezebeeLink(auth, plan.plan, LEGAL_VERSION)
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
            <div className="eyebrow">{tr('Оплата картой · BZB')}</div>
            <h2 id={titleId}>{tr(LABELS[plan.plan])} · {formatMoney(plan.price, currency)}</h2>
          </div>
          <button type="button" className="icon-button" aria-label={tr('Закрыть')} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        <label className="consent pay-autopay" htmlFor="bezebee-legal-consent">
          <input id="bezebee-legal-consent" type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
          <span>{tr('Я принимаю условия')} <Link to="/legal/offer" target="_blank" rel="noopener">{tr('публичной оферты')}</Link> {tr('и даю')} <Link to="/legal/consent" target="_blank" rel="noopener">{tr('согласие на обработку персональных данных')}</Link>.</span>
        </label>
        <p className="pay-dialog-note">
          {tr('Платёж разовый. Автоматических повторных списаний нет.')}{' '}
          {tr('Оплата проходит на защищённой странице сервиса BZB; Raid OS не получает и не хранит данные вашей карты.')}
        </p>
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title={tr('Оплата не началась')}>{tr(error.message)}</Notice>}
        <div className="pay-dialog-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</button>
          <button type="button" className="button primary" disabled={!consent || busy} onClick={() => void go()}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
            {tr('Перейти к оплате')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
