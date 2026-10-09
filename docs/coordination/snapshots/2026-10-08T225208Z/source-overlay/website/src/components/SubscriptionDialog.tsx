import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crown, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type PlansResponse } from '../api'
import { useAuth } from '../auth'
import { formatMoney, PLAN_LABELS, visiblePlans } from '../plans'
import '../payments.css'

const INCLUDED = [
  'Интерактивные карты: выходы, задания, ключи, этажи',
  'Трекер заданий и сюжета по логам игры',
  'Требуемые предметы для рейда',
  'Отдельный прогресс для PvP, PvE и «Сезона»',
  'Мини-карта поверх игры',
  'Предметы для «Коллекционера» и цены',
  'Синхронизация компьютера, телефона и сайта',
]

/**
 * «Подписка» in the site header: what the subscription gives, the prices, how payment and access work. There is no
 * payment here: «Оформить подписку» leads to the cabinet (signed in) or to registration, which ends in the cabinet.
 */
export function SubscriptionDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const { account } = useAuth()
  const navigate = useNavigate()
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeLatest = useRef(onClose)
  useEffect(() => { closeLatest.current = onClose })

  useEffect(() => {
    let cancelled = false
    api.plans().then((next) => { if (!cancelled) setPlans(next) }, () => undefined)
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeLatest.current() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus() }
  }, [])

  const subscribe = () => {
    onClose()
    navigate(account ? '/cabinet#subscription' : '/register')
  }
  const shown = visiblePlans(plans)

  return createPortal(
    <div className="pay-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="pay-dialog subscription-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow">Raid OS</div>
            <h2 id={titleId}>Подписка</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}><X aria-hidden="true" /></button>
        </div>

        <ul className="subscription-included">
          {INCLUDED.map((line) => <li key={line}><Check aria-hidden="true" />{line}</li>)}
        </ul>

        <div className="plan-grid subscription-plans">
          {shown.map((plan) => (
            <div key={plan.id} className={`plan-card${plan.id === '12m' ? ' is-best' : ''}`}>
              {plan.discountPercent > 0 && <span className="tag brass plan-badge">−{plan.discountPercent} %</span>}
              <span className="stat-label">{PLAN_LABELS[plan.id]}</span>
              <div className="plan-price mono">{plan.price === null ? '—' : formatMoney(plan.price, plan.currency)}</div>
              <div className="stat-meta">{plan.price === null ? '' : plan.months > 1 ? `≈ ${formatMoney(Math.round(plan.price / plan.months), plan.currency)} в месяц` : 'помесячно'}</div>
            </div>
          ))}
        </div>

        <ul className="subscription-terms">
          <li><strong>Оплата</strong> — в личном кабинете, на защищённой странице Robokassa: банковская карта, СБП. Каждая оплата разовая, без автосписаний.</li>
          <li><strong>Доступ</strong> открывается сразу после оплаты в приложении для Windows, на телефоне и на сайте.</li>
          <li><strong>Возврат</strong> — в любой момент за неиспользованные дни, без удержания комиссий.</li>
        </ul>

        <div className="pay-dialog-actions">
          <Link to="/legal" className="button" onClick={onClose}>Условия и документы</Link>
          <button type="button" className="button primary" onClick={subscribe}><Crown aria-hidden="true" />Оформить подписку</button>
        </div>
        {!account && <p className="pay-dialog-note">Сначала зарегистрируйтесь по e-mail — после регистрации откроется личный кабинет, где можно оплатить подписку.</p>}
      </div>
    </div>,
    document.body,
  )
}
