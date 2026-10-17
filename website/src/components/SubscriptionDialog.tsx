import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crown, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type PlansResponse } from '../api'
import { useAuth } from '../auth'
import { siteLocale, tr } from '../i18n'
import { formatMoney, planLabel, planSaving, visiblePlans } from '../plans'
import { paymentRegionOf, type PaymentRegion } from '../../../src/shared/paymentRegions'
import { PlanSaving } from './PlanSaving'
import '../payments.css'

const INCLUDED = [
  'Интерактивные карты: выходы, задания, ключи, этажи',
  'Трекер заданий и сюжета по логам игры',
  'Требуемые предметы для рейда',
  'Отдельный прогресс для PvP, PvE и «Сезона»',
  'Позиция и цена предмета на карте и в телефоне',
  'Предметы для «Коллекционера» и цены',
  'Синхронизация компьютера, телефона и сайта',
]

/** «СНГ» — Russia (ЮKassa, roubles) and the CIS (Boosty); «Зарубежная оплата» — every other country (Boosty). */
export type SubscriptionTab = 'cis' | 'world'

const tabOf = (region: PaymentRegion | undefined): SubscriptionTab | undefined => (region === undefined ? undefined : region === 'WORLD' ? 'world' : 'cis')

/** Time zones of Russia and the CIS: a guess for a visitor whose country the server could not tell. */
const CIS_TIME_ZONE = /^(Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov|Minsk|Chisinau)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Qostanay|Aqtobe|Aqtau|Atyrau|Oral|Qyzylorda|Bishkek|Dushanbe|Tashkent|Samarkand|Ashgabat|Yerevan|Baku))$/

/**
 * Which tab «Подписка» opens on (owner, 16.10.2026: «если сможешь отслеживать откуда заходит человек и предлагать сам
 * версию страницы»): the signed-in account's country; else where the server sees the visitor (Cloudflare); else the
 * browser's time zone; else the site language. Only a starting point: both tabs stay one click away.
 */
export function initialSubscriptionTab(accountCountry: string | undefined, hint: PaymentRegion | undefined, timeZone: string | undefined, locale: string): SubscriptionTab {
  return tabOf(paymentRegionOf(accountCountry)) ?? tabOf(hint) ?? (timeZone ? (CIS_TIME_ZONE.test(timeZone) ? 'cis' : 'world') : locale === 'en' ? 'world' : 'cis')
}

const browserTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } }

/**
 * «Подписка» in the site header: what the subscription gives, the prices, how payment and access work. There is no
 * payment here: «Оформить подписку» leads to the cabinet (signed in) or to registration, which ends in the cabinet.
 */
export function SubscriptionDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const { account } = useAuth()
  const navigate = useNavigate()
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  // Picked by the visitor: then nothing that arrives later switches the tab.
  const [picked, setPicked] = useState<SubscriptionTab | null>(null)
  const tab = picked ?? initialSubscriptionTab(account?.country, plans?.regionHint, browserTimeZone(), siteLocale())
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
            <h2 id={titleId}>{tr('Подписка')}</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" aria-label={tr('Закрыть')} onClick={onClose}><X aria-hidden="true" /></button>
        </div>

        <ul className="subscription-included">
          {INCLUDED.map((line) => <li key={line}><Check aria-hidden="true" />{tr(line)}</li>)}
        </ul>

        <div className="subscription-tabs" role="tablist" aria-label={tr('Способ оплаты')}>
          <button type="button" role="tab" aria-selected={tab === 'cis'} className={`button ${tab === 'cis' ? 'primary' : 'ghost'}`} onClick={() => setPicked('cis')}>{tr('СНГ')}</button>
          <button type="button" role="tab" aria-selected={tab === 'world'} className={`button ${tab === 'world' ? 'primary' : 'ghost'}`} onClick={() => setPicked('world')}>{tr('Зарубежная оплата')}</button>
        </div>

        {tab === 'cis' ? (
          <>
            <div className="plan-grid subscription-plans">
              {shown.map((plan) => {
                const saving = planSaving(plan, shown)
                return (
                  <div key={plan.id} className={`plan-card${plan.id === '12m' ? ' is-best' : ''}`}>
                    {plan.discountPercent > 0 && <span className="tag brass plan-badge">−{plan.discountPercent} %</span>}
                    <span className="stat-label">{planLabel(plan.id)}</span>
                    <div className="plan-price mono">{plan.price === null ? '—' : formatMoney(plan.price, plan.currency)}</div>
                    {saving && <PlanSaving {...saving} currency={plan.currency} />}
                    <div className="stat-meta">{plan.price === null ? '' : plan.months > 1 ? tr('≈ {price} в месяц', { price: formatMoney(Math.round(plan.price / plan.months), plan.currency) }) : tr('помесячно')}</div>
                  </div>
                )
              })}
            </div>

            <ul className="subscription-terms">
              <li><strong>{tr('Оплата из России')}</strong> {tr('— на защищённой странице ЮKassa через доступный способ: СБП, SberPay или T-Pay. Автопродление включается только отдельной галочкой, если оно подключено для магазина.')}</li>
              <li><strong>{tr('Доступ')}</strong> {tr('открывается сразу после оплаты в приложении для Windows, на телефоне и на сайте.')}</li>
              <li><strong>{tr('Беларусь, Казахстан и другие страны СНГ')}</strong> {tr('— оплата на платформе Boosty: ссылка появится в личном кабинете после регистрации.')}</li>
              <li><strong>{tr('Возврат')}</strong> {tr('— в любой момент за неиспользованные дни, без удержания комиссий.')}</li>
            </ul>
          </>
        ) : (
          <ul className="subscription-terms subscription-world">
            <li><strong>{tr('Оплата')}</strong> {tr('— на платформе Boosty банковской картой или другим способом, который Boosty предложит в вашей стране. Цена и валюта показываются на Boosty при оформлении.')}</li>
            <li><strong>{tr('Важно')}</strong> {tr('— укажите на Boosty тот же e-mail, что и в аккаунте Raid OS: по нему подписка откроется автоматически.')}</li>
            <li><strong>{tr('Доступ')}</strong> {tr('открывается автоматически через несколько минут после оплаты в приложении для Windows, на телефоне и на сайте и продлевается вместе с подпиской на Boosty.')}</li>
            <li><strong>{tr('Как оформить')}</strong> {tr('— зарегистрируйтесь и укажите свою страну: в личном кабинете появится ссылка на оплату через Boosty.')}</li>
          </ul>
        )}

        <div className="pay-dialog-actions">
          <Link to="/legal" className="button" onClick={onClose}>{tr('Условия и документы')}</Link>
          <button type="button" className="button primary" onClick={subscribe}><Crown aria-hidden="true" />{tr('Оформить подписку')}</button>
        </div>
        {!account && <p className="pay-dialog-note">{tr('Сначала зарегистрируйтесь по e-mail — после регистрации откроется личный кабинет, где можно оплатить подписку.')}</p>}
      </div>
    </div>,
    document.body,
  )
}
