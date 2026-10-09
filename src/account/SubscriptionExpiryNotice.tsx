import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, CreditCard, X } from 'lucide-react'
import type { ServerAccountStatus, UpdateCheckResult, UpdateStatus } from '../electron'
import { uiText } from '../i18n/renderText'
import { useServerAccount } from '../sync/serverSync'
import { openWebsite, subscriptionText } from './accountActions'
import './subscriptionExpiry.css'

const DAY_MS = 24 * 60 * 60 * 1000
const WARNING_DAYS = new Set([1, 3])

export function subscriptionDaysLeft(subscription: ServerAccountStatus['subscription'], now = Date.now()) {
  if (!subscription || subscription.status === 'inactive' || subscription.status === 'lifetime') return null
  const value = subscription.status === 'trial' ? subscription.trialEndsAt : subscription.paidUntil
  if (!value) return null
  const expires = new Date(value).getTime()
  if (!Number.isFinite(expires)) return null
  return Math.max(0, Math.ceil((expires - now) / DAY_MS))
}

export function shouldWarnSubscription(subscription: ServerAccountStatus['subscription'], now = Date.now()) {
  const days = subscriptionDaysLeft(subscription, now)
  return days !== null && WARNING_DAYS.has(days)
}

function updateBlocksNotice(status: UpdateStatus) {
  return status.state === 'available' || status.state === 'downloading' || status.state === 'installing'
}

/** Waits for the startup update check. A newer build always wins; this dialog appears after the new app launches. */
function useStartupUpdateReady() {
  const api = window.tarkovDesktop?.update
  const [ready, setReady] = useState(!api)
  useEffect(() => {
    if (!api) return
    let active = true
    let status: UpdateStatus = { state: 'idle' }
    const settle = (result: UpdateCheckResult | null) => {
      if (!active) return
      const blocked = updateBlocksNotice(result?.status ?? status) || result?.outcome === 'available' || result?.outcome === 'busy'
      setReady(!blocked)
    }
    const unsubscribe = api.onStatus((next) => {
      status = next
      if (updateBlocksNotice(next)) setReady(false)
    })
    // The main process schedules its automatic startup check after 3 seconds. This read observes its result without
    // racing a second check; old builds without check() fall back to the status after the same startup window.
    const timer = window.setTimeout(() => {
      if (api.check) void api.check().then((result) => settle(result), () => settle(null))
      else void api.status().then((next) => { status = next; settle(null) }, () => settle(null))
    }, 3_500)
    return () => { active = false; window.clearTimeout(timer); unsubscribe() }
  }, [api])
  return ready
}

function remainingText(days: number) {
  if (days === 0) return 'Подписка заканчивается сегодня'
  if (days === 1) return 'Остался 1 день'
  return `Осталось ${days} дня`
}

export function SubscriptionExpiryNotice({ compact = false }: { compact?: boolean }) {
  const { status } = useServerAccount()
  const subscription = status?.signedIn ? status.subscription : undefined
  const days = subscriptionDaysLeft(subscription)
  const startupUpdateReady = useStartupUpdateReady()
  const warned = useRef(false)
  const [open, setOpen] = useState(false)
  const expiry = subscription?.status === 'trial' ? subscription.trialEndsAt : subscription?.paidUntil
  const expiryText = useMemo(() => expiry ? new Date(expiry).toLocaleDateString('ru-RU') : '', [expiry])

  useEffect(() => {
    if (warned.current || !startupUpdateReady || !shouldWarnSubscription(subscription)) return
    warned.current = true
    setOpen(true)
  }, [startupUpdateReady, subscription])
  useEffect(() => { if (!startupUpdateReady) setOpen(false) }, [startupUpdateReady])

  if (!subscription || subscription.status === 'inactive') return null
  const label = subscription.status === 'lifetime' ? 'Подписка навсегда' : subscriptionText(subscription)
  const urgent = days !== null && days <= 3

  return (
    <>
      <button type="button" className={`subscription-top-chip${urgent ? ' is-urgent' : ''}${compact ? ' is-compact' : ''}`} onClick={() => openWebsite('cabinet')} title={uiText('Открыть оплату подписки')}>
        <CalendarClock size={15} aria-hidden="true" />
        <span>{uiText(label)}</span>
        {days !== null && <small>{uiText(remainingText(days))}</small>}
      </button>
      {open && days !== null && createPortal(
        <div className="subscription-expiry-overlay" role="dialog" aria-modal="true" aria-labelledby="subscription-expiry-title">
          <section className="subscription-expiry-card">
            <button type="button" className="icon-button subscription-expiry-close" onClick={() => setOpen(false)} aria-label={uiText('Закрыть')}><X size={16} /></button>
            <div className="subscription-expiry-icon"><CalendarClock size={25} /></div>
            <div className="eyebrow">RAID OS · {uiText('ПОДПИСКА')}</div>
            <h2 id="subscription-expiry-title">{uiText('Срок подписки скоро закончится')}</h2>
            <p>{uiText(`${remainingText(days)}. Доступ действует до ${expiryText}. Продлите подписку, чтобы приложение продолжило работать без перерыва.`)}</p>
            <div className="subscription-expiry-actions">
              <button type="button" className="button" onClick={() => setOpen(false)}>{uiText('Позже')}</button>
              <button type="button" className="button primary" onClick={() => { openWebsite('cabinet'); setOpen(false) }}><CreditCard size={15} />{uiText('Продлить подписку')}</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  )
}
