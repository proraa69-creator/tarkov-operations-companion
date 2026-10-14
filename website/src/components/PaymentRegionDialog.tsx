import { CreditCard, LoaderCircle, Repeat, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { Autopay, Plan, YooKassaPaymentMethod } from '../api'
import { localeTag, tr } from '../i18n'
import { Notice } from './Notice'
import '../payments.css'

const PERIOD_TEXT: Record<Plan['id'], string> = { '1m': 'каждый месяц', '3m': 'каждые 3 месяца', '6m': 'каждые 6 месяцев', '12m': 'каждые 12 месяцев' }
const PLAN_TEXT: Record<Plan['id'], string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }
const METHOD_TEXT: Record<YooKassaPaymentMethod, { title: string; detail: string }> = {
  sbp: { title: 'Система быстрых платежей (СБП)', detail: 'Выберите банк и подтвердите платёж в его приложении' },
  sberbank: { title: 'SberPay', detail: 'Подтверждение в приложении СберБанк Онлайн' },
  tinkoff_bank: { title: 'T-Pay', detail: 'Подтверждение в приложении Т-Банка' },
}

function formatMoney(amount: number, currency: string) {
  const digits = Number.isInteger(amount) ? 0 : 2
  try { return new Intl.NumberFormat(localeTag(), { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(amount) } catch { return `${amount} ${currency}` }
}

/** The server's name of a saved payment method («Карта *4444», «СБП», «SberPay»…) in the site language. */
function methodLabel(method: string) {
  const card = /^Карта \*(\d{4})$/.exec(method)
  return card ? tr('Карта *{last4}', { last4: card[1] ?? '' }) : tr(method)
}

/** Confirmation before leaving for the hosted YooKassa page. No bank details are collected by Raid OS. */
export function YooKassaPaymentDialog({ plan, methods, autopayAvailable, busy, error, onClose, onPay }: {
  plan: Plan
  methods: YooKassaPaymentMethod[]
  autopayAvailable: boolean
  busy: boolean
  error: { message: string; offline: boolean } | null
  onClose: () => void
  onPay: (method: YooKassaPaymentMethod, autoRenew: boolean) => void
}) {
  const [consent, setConsent] = useState(false)
  const [method, setMethod] = useState<YooKassaPaymentMethod>(methods[0] ?? 'sbp')
  const [autoRenew, setAutoRenew] = useState(false)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return createPortal(
    <div className="pay-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="pay-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow">{tr('Способ оплаты')}</div>
            <h2 id={titleId}>{tr(PLAN_TEXT[plan.id])} · {plan.price === null ? '' : formatMoney(plan.price, 'RUB')}</h2>
          </div>
          <button type="button" className="icon-button" aria-label={tr('Закрыть')} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>

        <fieldset className="pay-regions">
          <legend>{tr('Выберите способ')}</legend>
          {methods.map((item) => (
            <label key={item} className={`pay-region${method === item ? ' is-selected' : ''}`}>
              <input type="radio" name="payment-method" value={item} checked={method === item} disabled={busy} onChange={() => { setMethod(item); setAutoRenew(false) }} />
              <CreditCard aria-hidden="true" />
              <span className="pay-region-text"><strong>{tr(METHOD_TEXT[item].title)}</strong><small>{tr(METHOD_TEXT[item].detail)}</small></span>
              <span className="pay-region-price mono">{plan.price === null ? '' : formatMoney(plan.price, 'RUB')}</span>
            </label>
          ))}
        </fieldset>

        <label className="consent pay-autopay" htmlFor="pay-legal-consent">
          <input id="pay-legal-consent" type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
          <span>{tr('Я принимаю условия')} <Link to="/legal/offer" target="_blank" rel="noopener">{tr('публичной оферты')}</Link> {tr('и даю')} <Link to="/legal/consent" target="_blank" rel="noopener">{tr('согласие на обработку персональных данных')}</Link>.</span>
        </label>

        {autopayAvailable && (
          <label className="consent pay-autopay" htmlFor="pay-auto-renew">
            <input id="pay-auto-renew" type="checkbox" checked={autoRenew} disabled={busy} onChange={(event) => setAutoRenew(event.target.checked)} />
            <span>{tr('Включить автопродление')}</span>
          </label>
        )}

        <p className="pay-dialog-note">
          {autoRenew
            ? tr('После первого подтверждения выбранный способ оплаты сохранится в ЮKassa. Затем с него будет списываться {amount} {period} до отмены. Перед каждым списанием мы уведомим вас. Отключить автопродление можно в личном кабинете.', {
              amount: plan.price === null ? tr('стоимость тарифа') : formatMoney(plan.price, 'RUB'),
              period: tr(PERIOD_TEXT[plan.id]),
            })
            : tr('Платёж разовый. Автоматических повторных списаний нет.')}{' '}
          {tr('Raid OS не получает и не хранит реквизиты вашего банковского счёта.')}
        </p>
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title={tr('Оплата не началась')}>{error.message}</Notice>}

        <div className="pay-dialog-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</button>
          <button type="button" className="button primary" disabled={!consent || busy} onClick={() => onPay(method, autoRenew)}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
            {tr('Перейти к оплате')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The cabinet's autopayment block: amount, period, next charge and «Отменить автопродление» (one click). */
export function AutopayCard({ autopay, busy, error, onCancel }: { autopay: Autopay; busy: boolean; error: string | null; onCancel: () => void }) {
  const date = (iso?: string) => (iso ? new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '')
  // An archived autopayment (a payment service that is no longer connected) names no method.
  const via = autopay.provider === 'yookassa' ? ` · ${autopay.method ? methodLabel(autopay.method) : tr('ЮKassa')}` : ''
  const amount = formatMoney(autopay.amount, autopay.currency)
  if (autopay.status === 'active') {
    return (
      <div className="autopay-card is-active">
        <Repeat aria-hidden="true" />
        <div className="autopay-text">
          <strong>{tr('Автопродление включено')}</strong>
          <span>{amount} {tr(PERIOD_TEXT[autopay.plan])}{via}</span>
          {autopay.nextChargeAt && <span className="dim">{tr('Следующее списание — около {date}', { date: date(autopay.nextChargeAt) })}</span>}
          {error && <span className="autopay-error">{error}</span>}
        </div>
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          {busy && <LoaderCircle className="spinner" aria-hidden="true" />}{tr('Отменить автопродление')}
        </button>
      </div>
    )
  }
  return (
    <div className="autopay-card">
      <Repeat aria-hidden="true" />
      <div className="autopay-text">
        <strong>{tr(autopay.status === 'failed' ? 'Автопродление остановлено: списание не прошло' : 'Автопродление отключено')}</strong>
        <span>{autopay.paidUntil ? `${tr('Подписка действует до {date}.', { date: date(autopay.paidUntil).replace(/\.$/, '') })} ` : ''}{tr(autopay.provider === 'yookassa' ? 'Больше ничего не спишется, сохранённый способ оплаты удалён.' : 'Больше ничего не спишется.')}</span>
      </div>
    </div>
  )
}
