import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, Check, LoaderCircle, RotateCcw, Settings2, ShoppingBag } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { APP_STORE_BUILD, isIosApp } from '../platform'
import { useServerAccount } from '../sync/serverSync'
import { privacyPolicyUrl } from './iosAccountText'
import {
  APPLE_EULA_URL, buyProduct, followStoreUpdates, loadIapInfo, manageSubscriptions, periodText, purchaseCancelled,
  restoreTransactions, sendOutcome, sendTransactions, storeProducts, type AppleIapInfo, type StoreProduct,
} from './appleIap'
import './appleSubscription.css'

/**
 * «Подписка Raid OS» in the iPhone app (src/account/appleIap.ts): on the «Нет доступа» screen and in the profile. Nothing
 * at all unless this is the App Store build of the iPhone app (StoreKit sells nothing to the build installed from the
 * site) and the server sells through Apple (GET /v1/apple/iap).
 */
const sells = () => APP_STORE_BUILD && isIosApp()
export function AppleSubscriptionPanel({ inline = false }: { inline?: boolean }) {
  const { status, refresh } = useServerAccount()
  const [info, setInfo] = useState<AppleIapInfo | null>(null)
  const [products, setProducts] = useState<StoreProduct[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const synced = useRef(false)
  const signedIn = Boolean(status?.signedIn)

  // The server's answer, then StoreKit's names and prices; `generation` asks again (after a purchase or a restore).
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    if (!sells() || !signedIn) return
    let current = true
    loadIapInfo().catch(() => null).then((next) => {
      if (!current) return undefined
      setInfo(next)
      return next?.enabled ? storeProducts(next.products).catch(() => []) : undefined
    }).then((found) => { if (current && found) setProducts(found) }).catch(() => {})
    return () => { current = false }
  }, [generation, signedIn])

  // Once: what the Apple ID already has goes to the server quietly (a purchase whose check did not get through), and
  // StoreKit's later news follow it.
  useEffect(() => {
    if (!info?.enabled || synced.current) return
    synced.current = true
    void followStoreUpdates(() => { void refresh(); reload() })
    void restoreTransactions(false).then((signed) => (signed.length ? sendTransactions(signed) : undefined)).then((result) => {
      if (result && !sendOutcome(result)) { void refresh(); reload() }
    }).catch(() => {})
  }, [info?.enabled, refresh, reload])

  if (!sells() || !signedIn || !info?.enabled) return null

  const run = async (key: string, signed: () => Promise<string[]>) => {
    setBusy(key)
    setMessage('')
    setDone(false)
    try {
      const transactions = await signed()
      if (!transactions.length) { setMessage('Покупок для восстановления нет.'); return }
      const result = await sendTransactions(transactions)
      const outcome = sendOutcome(result)
      if (outcome) { setMessage(outcome); return }
      setDone(true)
      await refresh()
      reload()
    } catch (reason) {
      if (!purchaseCancelled(reason)) setMessage(reason instanceof Error ? reason.message : 'Покупки сейчас недоступны.')
    } finally {
      setBusy(null)
    }
  }
  const buy = (product: StoreProduct) => run(product.id, async () => [await buyProduct(product.id, info.appAccountToken)])
  const restore = () => run('restore', () => restoreTransactions(true))
  const manage = async () => {
    setBusy('manage')
    try { await manageSubscriptions() } catch { setMessage('Покупки сейчас недоступны.') } finally { setBusy(null) }
  }

  const subscription = info.subscription?.active ? info.subscription : undefined
  const body = <>
    {subscription ? (
      <p className="apple-sub-active"><CalendarClock size={15} aria-hidden="true" /><span>{uiText('Подписка Apple до ')}<strong>{new Date(subscription.expiresAt).toLocaleDateString('ru-RU')}</strong></span></p>
    ) : (
      <>
        <p className="muted apple-sub-lead">{uiText('Карты, квесты, барахолка и все разделы на всех устройствах аккаунта.')}</p>
        {products === null ? <p className="muted apple-sub-lead"><LoaderCircle className="spin" size={14} />{uiText('Загружаем варианты…')}</p>
          : products.length ? <div className="apple-sub-products">
            {products.map((product) => (
              <button key={product.id} type="button" className="apple-sub-product" disabled={busy !== null} onClick={() => void buy(product)}>
                <span className="apple-sub-name"><strong>{uiText(periodText(product.months))}</strong><small>{product.title}</small></span>
                <span className="apple-sub-price">{busy === product.id ? <LoaderCircle className="spin" size={15} /> : product.price}</span>
              </button>
            ))}
          </div>
          : <p className="muted apple-sub-lead">{uiText('Покупки сейчас недоступны.')}</p>}
      </>
    )}
    {done && <p className="apple-sub-done" role="status"><Check size={14} aria-hidden="true" />{uiText('Подписка оформлена')}</p>}
    {message && <p className="apple-sub-error" role="alert">{uiText(message)}</p>}
    <div className="paywall-actions">
      {subscription && <button type="button" className="button ghost" disabled={busy !== null} onClick={() => void manage()}><Settings2 size={14} />{uiText('Управлять подпиской')}</button>}
      <button type="button" className="button ghost" disabled={busy !== null} onClick={() => void restore()}>{busy === 'restore' ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}{uiText('Восстановить покупки')}</button>
    </div>
    <p className="paywall-note apple-sub-terms">{uiText('Подписка продлевается автоматически, пока её не отменят в настройках Apple ID хотя бы за 24 часа до конца периода. Оплата — с Apple ID.')}</p>
    <p className="apple-sub-links">
      <a href={APPLE_EULA_URL} target="_blank" rel="noopener noreferrer">{uiText('Условия использования')}</a>
      <a href={privacyPolicyUrl()} target="_blank" rel="noopener noreferrer">{uiText('Политика конфиденциальности')}</a>
    </p>
  </>

  if (inline) return <div className="apple-sub is-inline" aria-label={uiText('Подписка Raid OS')}>{body}</div>
  return (
    <section className="panel account-cabinet apple-sub" aria-label={uiText('Подписка Raid OS')}>
      <div className="panel-header"><div className="panel-title"><ShoppingBag size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Подписка Raid OS')}</div></div>
      <div className="panel-body stack">{body}</div>
    </section>
  )
}
