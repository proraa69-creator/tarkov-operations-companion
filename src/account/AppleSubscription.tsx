import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, Check, ExternalLink, LoaderCircle, Monitor, RotateCcw, Settings2, ShoppingBag } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { APP_STORE_BUILD, isIosApp } from '../platform'
import { useServerAccount } from '../sync/serverSync'
import { pcAppUrl, privacyPolicyUrl } from './iosAccountText'
import { openWebsite } from './accountActions'
import {
  APPLE_EULA_URL, buyProduct, followStoreUpdates, loadIapInfo, manageSubscriptions, parseIapInfo, periodText, purchaseCancelled,
  restoreTransactions, savingPercent, sendOutcome, sendTransactions, storefrontCountry, storeProducts, type AppleIapInfo, type StoreProduct,
} from './appleIap'
import './appleSubscription.css'

/**
 * «Подписка Raid OS» in the iPhone app (src/account/appleIap.ts): on the «Нет доступа» screen and in the profile — only in
 * the App Store build of the iPhone app (StoreKit sells nothing to the build installed from the site) and when the server
 * sells through Apple (GET /v1/apple/iap). Next to it, in any iPhone build while the server allows it (`pcAppLink`),
 * «Raid OS для Windows» (PcAppCard).
 */
const sells = () => APP_STORE_BUILD && isIosApp()
export function AppleSubscriptionPanel({ inline = false }: { inline?: boolean }) {
  const { status, refresh } = useServerAccount()
  const [info, setInfo] = useState<AppleIapInfo | null>(null)
  const [products, setProducts] = useState<StoreProduct[] | null>(null)
  const [storefront, setStorefront] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const synced = useRef(false)
  const signedIn = Boolean(status?.signedIn)

  // The server's answer, then StoreKit's names and prices; `generation` asks again (after a purchase or a restore).
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    if (!isIosApp() || !signedIn) return
    let current = true
    loadIapInfo().catch(() => parseIapInfo(null)).then((next) => {
      if (!current) return undefined
      setInfo(next)
      if (!sells() || !next?.enabled) return undefined
      if (next.siteLinkStorefronts.length) void storefrontCountry().then((code) => { if (current) setStorefront(code) })
      return storeProducts(next.products).catch(() => [])
    }).then((found) => { if (current && found) setProducts(found) }).catch(() => {})
    return () => { current = false }
  }, [generation, signedIn])

  // Once: what the Apple ID already has goes to the server quietly (a purchase whose check did not get through), and
  // StoreKit's later news follow it.
  useEffect(() => {
    if (!sells() || !info?.enabled || synced.current) return
    synced.current = true
    void followStoreUpdates(() => { void refresh(); reload() })
    void restoreTransactions(false).then((signed) => (signed.length ? sendTransactions(signed) : undefined)).then((result) => {
      if (result && !sendOutcome(result)) { void refresh(); reload() }
    }).catch(() => {})
  }, [info?.enabled, refresh, reload])

  if (!isIosApp() || !signedIn || !info) return null
  const pc = info.pcAppLink ? <PcAppCard inline={inline} /> : null
  if (!sells() || !info.enabled) return pc

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
  // «Оплатить на сайте» only on a storefront where Apple allows it (appleIap.ts), never more prominent than Apple's plans.
  const siteLink = !subscription && Boolean(storefront) && info.siteLinkStorefronts.includes(storefront) && Boolean(products?.length)
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
                <span className="apple-sub-name"><strong>{uiText(periodText(product.months))}{savingPercent(product, products) ? <span className="apple-sub-saving">−{savingPercent(product, products)} %</span> : null}</strong><small>{product.title}</small></span>
                <span className="apple-sub-price">{busy === product.id ? <LoaderCircle className="spin" size={15} /> : product.price}</span>
              </button>
            ))}
          </div>
          : <p className="muted apple-sub-lead">{uiText('Покупки сейчас недоступны.')}</p>}
        {siteLink && <p className="apple-sub-site">
          <span className="muted">{uiText('Можно оплатить и на сайте Raid OS.')}</span>
          <button type="button" className="link-button" onClick={() => openWebsite('cabinet')}><ExternalLink size={13} aria-hidden="true" />{uiText('Оплатить на сайте')}</button>
        </p>}
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

  if (inline) return <><div className="apple-sub is-inline" aria-label={uiText('Подписка Raid OS')}>{body}</div>{pc}</>
  return (
    <>
      <section className="panel account-cabinet apple-sub" aria-label={uiText('Подписка Raid OS')}>
        <div className="panel-header"><div className="panel-title"><ShoppingBag size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Подписка Raid OS')}</div></div>
        <div className="panel-body stack">{body}</div>
      </section>
      {pc}
    </>
  )
}

/**
 * «Raid OS для ПК» (owner, 09.11.2026: «Можно указать «Скачайте наше приложение для ПК» и указать ссылку на скачивание»;
 * «чтобы в приложении не было упоминаний об оплате… Только упоминание скачать приложение для ПК, без него приложение не
 * будет работать»): raidos.app/pc — the site's page with the download only (no plans, prices, cabinet or donations:
 * website/src/pages/PcAppPage.tsx). Not a word about paying. The server turns it off without a release
 * (APPLE_PC_APP_LINK=0).
 */
export function PcAppCard({ inline = false }: { inline?: boolean }) {
  const body = <>
    <p className="muted pc-app-text">{uiText('Скачайте приложение для ПК — без него Raid OS не работает.')}</p>
    <a className="button ghost pc-app-link" href={pcAppUrl()} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />{uiText('Скачать для Windows')}</a>
  </>
  if (inline) return <div className="pc-app is-inline" aria-label={uiText('Raid OS для ПК')}><strong className="pc-app-title"><Monitor size={14} aria-hidden="true" />{uiText('Raid OS для ПК')}</strong>{body}</div>
  return (
    <section className="panel account-cabinet pc-app" aria-label={uiText('Raid OS для ПК')}>
      <div className="panel-header"><div className="panel-title"><Monitor size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Raid OS для ПК')}</div></div>
      <div className="panel-body stack">{body}</div>
    </section>
  )
}
