import { LoaderCircle, Repeat } from 'lucide-react'
import type { Autopay, Plan } from '../api'
import '../payments.css'

const PERIOD_TEXT: Record<Plan['id'], string> = { '1m': 'каждый месяц', '3m': 'каждые 3 месяца', '6m': 'каждые 6 месяцев', '12m': 'каждые 12 месяцев' }

function formatMoney(amount: number, currency: string) {
  const digits = Number.isInteger(amount) ? 0 : 2
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(amount) } catch { return `${amount} ${currency}` }
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
