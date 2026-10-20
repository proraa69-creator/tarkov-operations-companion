import { ExternalLink, Gift, LoaderCircle, Mail, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, api, errorMessage, type BoostyOffer, type PaymentRegion } from '../api'
import { useAuth } from '../auth'
import { tr } from '../i18n'
import { BOOSTY_EMAIL_WARNING } from '../../../src/shared/paymentRegions'
import { Notice } from './Notice'
import '../payments.css'

/**
 * Paying through Boosty (CIS / WORLD; owner's spec: docs/payments/payment-regions-and-announcements.md). The server
 * decides the region from the saved country and hands out only that region's link; the page never knows a link before
 * the payer ticked the e-mail warning (BOOSTY_EMAIL_WARNING, exact text, before every redirect). The friend-discount offer
 * appears only while the server lists it (a friend's code, not spent yet).
 */
/** `secondary`: Boosty below the CIS tariffs on BZB (components/BezebeeCheckout.tsx), not the main button. */
export function BoostyOffers({ region, offers, email, secondary = false }: { region: Exclude<PaymentRegion, 'RU'>; offers: BoostyOffer[]; email: string; secondary?: boolean }) {
  const [offer, setOffer] = useState<BoostyOffer | null>(null)
  return (
    <div className="boosty-offers">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {tr(region === 'CIS' ? 'Для вашей страны (СНГ) оплата — через Boosty.' : 'Для вашей страны оплата — через Boosty (международная подписка).')}{' '}
        {tr('Подписка в Raid OS включится, когда мы найдём платёж по email вашего аккаунта.')}
      </p>
      <div className="boosty-offer-list">
        {offers.includes('standard') && (
          <button type="button" className={secondary ? 'button' : 'button primary'} onClick={() => setOffer('standard')}>
            <ExternalLink aria-hidden="true" />{tr('Оплатить через Boosty')}
          </button>
        )}
        {offers.includes('friend') && (
          <button type="button" className="button" onClick={() => setOffer('friend')}>
            <Gift aria-hidden="true" />{tr('Оплатить со скидкой друга (один раз)')}
          </button>
        )}
      </div>
      {offer && <BoostyWarningDialog offer={offer} email={email} onClose={() => setOffer(null)} />}
    </div>
  )
}

/** The required warning; «Перейти на Boosty» stays disabled until it is acknowledged. */
export function BoostyWarningDialog({ offer, email, onClose }: { offer: BoostyOffer; email: string; onClose: () => void }) {
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
      const { url } = await api.boostyLink(auth, offer)
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
            <div className="eyebrow">Boosty</div>
            <h2 id={titleId}>{tr(offer === 'friend' ? 'Оплата со скидкой друга' : 'Оплата через Boosty')}</h2>
          </div>
          <button type="button" className="icon-button" aria-label={tr('Закрыть')} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="boosty-warning" role="note">
          <Mail aria-hidden="true" />
          <div>
            <p>{tr(BOOSTY_EMAIL_WARNING.ru)}</p>
            <p className="mono boosty-email">{email}</p>
          </div>
        </div>
        <label className="consent pay-autopay" htmlFor="boosty-email-ack">
          <input id="boosty-email-ack" type="checkbox" checked={ack} disabled={busy} onChange={(event) => setAck(event.target.checked)} />
          <span>{tr('Понятно: укажу на Boosty этот email')}</span>
        </label>
        {offer === 'friend' && <p className="pay-dialog-note">{tr('Скидка друга — одноразовая: она действует для первой оплаты и после неё исчезнет.')}</p>}
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title={tr('Ссылка не открылась')}>{tr(error.message)}</Notice>}
        <div className="pay-dialog-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</button>
          <button type="button" className="button primary" disabled={!ack || busy} onClick={() => void go()}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
            {tr('Перейти на Boosty')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
