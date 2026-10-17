import { ExternalLink, Gift, LoaderCircle, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, errorMessage, type BoostyPublicResponse } from '../api'
import { Notice } from '../components/Notice'
import { tr } from '../i18n'
import { BOOSTY_EMAIL_WARNING } from '../../../src/shared/paymentRegions'
import '../payments.css'

type Offer = BoostyPublicResponse['offers'][number]

const REGIONS: Array<{ region: Offer['region']; title: string; note: string }> = [
  { region: 'CIS', title: 'СНГ (кроме России)', note: 'Беларусь, Казахстан, Армения, Узбекистан и другие страны СНГ.' },
  { region: 'WORLD', title: 'Другие страны', note: 'Европа, Азия, Америка и все остальные страны.' },
]

/**
 * raidos.app/boosty (owner, 17.10.2026: «ссылка будет открывать страницу сайта с оплатой на бусти без регистрации»,
 * «кнопки на каждую подписку в бусти»): every Boosty subscription with its own button, no account needed to open it.
 * The e-mail warning (BOOSTY_EMAIL_WARNING) is acknowledged before any button leads to Boosty, as in the cabinet.
 */
export function BoostyPage() {
  const [answer, setAnswer] = useState<BoostyPublicResponse | null>(null)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)
  const [ack, setAck] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.boostyPublic().then(
      (next) => { if (!cancelled) setAnswer(next) },
      (reason: unknown) => { if (!cancelled) setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network }) },
    )
    return () => { cancelled = true }
  }, [])

  // The visitor's own region first (a hint from where the visit comes from; any button can be used).
  const regions = answer?.regionHint === 'WORLD' ? [...REGIONS].reverse() : REGIONS

  return (
    <section className="section boosty-page">
      <div className="eyebrow">Boosty</div>
      <h1>{tr('Подписка Raid OS через Boosty')}</h1>
      <p className="muted boosty-page-lead">
        {tr('Подписка открывает все функции Raid OS в приложении для Windows, на телефоне и на сайте. Оплата — на платформе Boosty банковской картой или другим способом, который Boosty предложит в вашей стране. Цена и валюта показываются на Boosty при оформлении.')}
      </p>

      <div className="boosty-warning" role="note">
        <Mail aria-hidden="true" />
        <div>
          <p>{tr(BOOSTY_EMAIL_WARNING.ru)}</p>
          <p className="boosty-email">{tr('Ещё нет аккаунта? Можно оплатить сейчас и зарегистрироваться потом с тем же email — подписка откроется, когда аккаунт появится.')}</p>
        </div>
      </div>
      <label className="consent pay-autopay" htmlFor="boosty-public-ack">
        <input id="boosty-public-ack" type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
        <span>{tr('Понятно: укажу на Boosty email своего аккаунта Raid OS')}</span>
      </label>

      {error && <Notice tone={error.offline ? 'offline' : 'error'} title={tr('Подписки не загрузились')}>{tr(error.message)}</Notice>}
      {!answer && !error && <p className="muted"><LoaderCircle className="spinner" aria-hidden="true" /> {tr('Загружаем подписки…')}</p>}

      {answer && (
        <div className="boosty-page-regions">
          {regions.map(({ region, title, note }) => {
            const offers = answer.offers.filter((offer) => offer.region === region)
            if (!offers.length) return null
            return (
              <div key={region} className="panel boosty-page-region">
                <h2>{tr(title)}</h2>
                <p className="muted">{tr(note)}</p>
                <div className="boosty-offer-list">
                  {offers.map((offer) => <OfferButton key={offer.key} offer={offer} enabled={ack} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ol className="boosty-page-steps muted">
        <li>{tr('Нажмите кнопку подписки для своей страны — откроется Boosty.')}</li>
        <li>{tr('Оформите подписку на Boosty с тем же email, что и в аккаунте Raid OS.')}</li>
        <li>{tr('Доступ откроется автоматически через несколько минут и будет продлеваться вместе с подпиской на Boosty.')}</li>
      </ol>
      <p className="muted boosty-page-foot">
        {tr('Скидка друга — для тех, кого пригласил друг по своему коду: она одноразовая и действует для первой оплаты.')}{' '}
        {tr('Из России подписка оплачивается через СБП в')} <Link to="/cabinet">{tr('личном кабинете')}</Link>.
      </p>
    </section>
  )
}

function OfferButton({ offer, enabled }: { offer: Offer; enabled: boolean }) {
  const friend = offer.kind === 'friend'
  const label = tr(friend ? 'Подписка со скидкой друга' : 'Подписка')
  const icon = friend ? <Gift aria-hidden="true" /> : <ExternalLink aria-hidden="true" />
  if (!enabled) return <button type="button" className={`button${friend ? '' : ' primary'}`} disabled title={tr('Сначала отметьте, что укажете на Boosty email аккаунта')}>{icon}{label}</button>
  return <a className={`button${friend ? '' : ' primary'}`} href={offer.url} rel="noopener noreferrer">{icon}{label}</a>
}
