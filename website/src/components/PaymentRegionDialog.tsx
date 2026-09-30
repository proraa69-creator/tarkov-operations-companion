import { CreditCard, Globe2, LoaderCircle, MapPin, Repeat, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { Autopay, Plan, PaymentRegion, PlansResponse } from '../api'
import { Notice } from './Notice'
import '../payments.css'

const PERIOD_TEXT: Record<Plan['id'], string> = { '1m': 'каждый месяц', '3m': 'каждые 3 месяца', '6m': 'каждые 6 месяцев', '12m': 'каждые 12 месяцев' }
const PLAN_TEXT: Record<Plan['id'], string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }

function formatMoney(amount: number, currency: string) {
  const digits = Number.isInteger(amount) ? 0 : 2
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(amount) } catch { return `${amount} ${currency}` }
}

/**
 * «Оплатить» → choose where the card is from:
 * - «Россия и СНГ» — ЮKassa (карта, СБП, SberPay, ЮMoney…), a one-off payment; with the separate, never pre-ticked
 *   autopayment consent (376-ФЗ) ЮKassa saves the method and the plan renews by itself until cancelled.
 * - «Другие страны» — Lava.top (Visa/Mastercard, PayPal…), a subscription Lava renews by itself; the same consent is
 *   therefore required.
 */
export function PaymentRegionDialog({ plan, plans, autopay, busy, error, onClose, onPay }: {
  plan: Plan
  plans: PlansResponse
  autopay: Autopay | null
  busy: boolean
  error: { message: string; offline: boolean } | null
  onClose: () => void
  onPay: (region: PaymentRegion, autopayConsent: boolean) => void
}) {
  const providers = plans.providers ?? { yookassa: true, lava: false, autopay: false }
  const [region, setRegion] = useState<PaymentRegion | null>(providers.yookassa ? 'ru' : providers.lava ? 'intl' : null)
  const [autopayConsent, setAutopayConsent] = useState(false)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const renewing = autopay?.status === 'active'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    dialog.current?.querySelector<HTMLElement>('input[type="radio"]:checked, button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const foreignCurrency = plans.foreign?.currency ?? providers.lavaCurrency ?? 'USD'
  const foreignPrice = plans.foreign?.prices?.[plan.id]
  const rubPrice = plan.price === null ? null : formatMoney(plan.price, 'RUB')
  const foreignText = foreignPrice ? formatMoney(foreignPrice, foreignCurrency) : `цена в ${foreignCurrency} на странице оплаты`
  const autopayOffered = region === 'ru' ? providers.autopay && !renewing : region === 'intl'
  const needsConsent = region === 'intl'
  const blockedByRenewal = region === 'intl' && renewing
  const canPay = region !== null && !busy && !blockedByRenewal && (!needsConsent || autopayConsent)
  // Genitive for «Согласен на автоматическое списание …».
  const amountText = region === 'intl' ? (foreignPrice ? foreignText : `стоимости тарифа в ${foreignCurrency} (указана на странице оплаты Lava.top)`) : rubPrice ?? ''

  // A portal: the cabinet panels are animated with transforms, which would trap a fixed backdrop inside them.
  return createPortal(
    <div className="pay-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="pay-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow">Оплата подписки</div>
            <h2 id={titleId}>{PLAN_TEXT[plan.id]}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>

        <fieldset className="pay-regions">
          <legend>Где выпущена ваша карта?</legend>
          <label className={`pay-region${region === 'ru' ? ' is-selected' : ''}${providers.yookassa ? '' : ' is-disabled'}`}>
            <input type="radio" name="pay-region" value="ru" checked={region === 'ru'} disabled={!providers.yookassa || busy} onChange={() => { setRegion('ru'); setAutopayConsent(false) }} />
            <MapPin aria-hidden="true" />
            <span className="pay-region-text">
              <strong>Россия и СНГ</strong>
              <small>Карта, СБП, SberPay, ЮMoney… · ЮKassa</small>
            </span>
            <span className="pay-region-price mono">{providers.yookassa ? rubPrice ?? '' : 'недоступно'}</span>
          </label>
          <label className={`pay-region${region === 'intl' ? ' is-selected' : ''}${providers.lava ? '' : ' is-disabled'}`}>
            <input type="radio" name="pay-region" value="intl" checked={region === 'intl'} disabled={!providers.lava || busy} onChange={() => { setRegion('intl'); setAutopayConsent(false) }} />
            <Globe2 aria-hidden="true" />
            <span className="pay-region-text">
              <strong>Другие страны</strong>
              <small>Visa/Mastercard, PayPal… · Lava.top</small>
            </span>
            <span className="pay-region-price mono">{providers.lava ? foreignText : 'скоро'}</span>
          </label>
        </fieldset>

        {region === 'intl' && (
          <p className="pay-dialog-note">Подписка оформляется у платёжного агента Lava.top и продлевается автоматически {PERIOD_TEXT[plan.id]}, пока вы её не отмените. Отменить можно в личном кабинете в один клик.</p>
        )}
        {blockedByRenewal && <Notice tone="warn" title="Автопродление уже включено">Чтобы оформить подписку через Lava.top, сначала отмените текущее автопродление в личном кабинете.</Notice>}
        {region === 'ru' && renewing && <p className="pay-dialog-note">Автопродление уже включено — этот платёж будет разовым и продлит подписку от текущей даты окончания.</p>}

        {autopayOffered && !blockedByRenewal && (
          <label className="consent pay-autopay" htmlFor="pay-autopay">
            <input id="pay-autopay" type="checkbox" checked={autopayConsent} disabled={busy} onChange={(event) => setAutopayConsent(event.target.checked)} />
            <span>
              <Repeat size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />
              Согласен на автоматическое списание {amountText} {PERIOD_TEXT[plan.id]} {region === 'intl' ? 'через Lava.top' : 'с сохранённой карты или счёта'} до отмены. Отменить автопродление можно в личном кабинете в любой момент. Условия — в разделе «Автоплатежи» <Link to="/legal/offer" target="_blank" rel="noopener">оферты</Link>.
            </span>
          </label>
        )}
        {region === 'ru' && autopayOffered && !autopayConsent && <p className="pay-dialog-note dim">Без этой отметки платёж разовый: продлевать подписку вы будете сами.</p>}

        {error && <Notice tone={error.offline ? 'offline' : 'error'} title="Оплата не началась">{error.message}</Notice>}

        <div className="pay-dialog-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>Отмена</button>
          <button type="button" className="button primary" disabled={!canPay} title={needsConsent && !autopayConsent ? 'Отметьте согласие на автоматическое списание' : undefined} onClick={() => region && onPay(region, autopayOffered && autopayConsent)}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
            {region === 'intl' ? 'Перейти к оплате в Lava.top' : 'Перейти к оплате в ЮKassa'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The cabinet's autopayment block: amount, period, next charge and «Отменить автопродление» (one click). */
export function AutopayCard({ autopay, busy, error, onCancel }: { autopay: Autopay; busy: boolean; error: string | null; onCancel: () => void }) {
  const date = (iso?: string) => (iso ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '')
  const via = autopay.provider === 'lava' ? 'Lava.top' : autopay.method ?? 'ЮKassa'
  const amount = formatMoney(autopay.amount, autopay.currency)
  if (autopay.status === 'active') {
    return (
      <div className="autopay-card is-active">
        <Repeat aria-hidden="true" />
        <div className="autopay-text">
          <strong>Автопродление включено</strong>
          <span>{amount} {PERIOD_TEXT[autopay.plan]} · {via}</span>
          {autopay.nextChargeAt && <span className="dim">Следующее списание — около {date(autopay.nextChargeAt)}</span>}
          {error && <span className="autopay-error">{error}</span>}
        </div>
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          {busy && <LoaderCircle className="spinner" aria-hidden="true" />}Отменить автопродление
        </button>
      </div>
    )
  }
  return (
    <div className="autopay-card">
      <Repeat aria-hidden="true" />
      <div className="autopay-text">
        <strong>{autopay.status === 'failed' ? 'Автопродление остановлено: списание не прошло' : 'Автопродление отключено'}</strong>
        <span>{autopay.paidUntil ? `Подписка действует до ${date(autopay.paidUntil).replace(/\.$/, '')}. ` : ''}Больше ничего не спишется{autopay.provider === 'yookassa' ? ', сохранённый способ оплаты удалён' : ''}.</span>
      </div>
    </div>
  )
}
