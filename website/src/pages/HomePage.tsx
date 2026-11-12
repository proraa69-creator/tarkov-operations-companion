import { Download, ShieldCheck, Ticket, UserPlus, UserRound, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { RankLadder } from '../components/InviteFriendsPanel'
import { Platforms } from '../components/Platforms'
import { Reveal } from '../components/Reveal'
import { Trailer } from '../components/Trailer'
import { Presentation } from '../components/promo/Presentation'
import { stagger } from '../hooks/motion'
import { tr, useSiteLocale } from '../i18n'
import '../invites.css'

export function HomePage({ banner }: { banner?: ReactNode }) {
  const locale = useSiteLocale()
  return (
    <>
      <section className="hero">
        <div className="container">
          {banner}
          <div className="hero-head">
            <h1 className="hero-title hero-wordmark stagger" style={stagger(1)}><img src={locale === 'en' ? '/brand/wordmark-en.svg' : '/brand/wordmark.svg'} alt={tr('Raid OS — помощник в рейдах · Escape from Tarkov')} /></h1>
            <p className="hero-lead stagger" style={stagger(2)}>{tr('Всё важное перед рейдом — в одном окне.')}</p>
          </div>

          <div className="hero-stage stagger" style={stagger(3)}>
            <Trailer />
          </div>

          <div className="hero-actions center stagger" style={stagger(4)}>
            <Link to="/download" className="button primary large"><Download aria-hidden="true" />{tr('Скачать приложение')}</Link>
            <Link to="/cabinet" className="button large"><UserRound aria-hidden="true" />{tr('Личный кабинет')}</Link>
          </div>
          <div className="stagger" style={stagger(5)}><Platforms /></div>
          <p className="hero-note stagger" style={stagger(6)}>
            <ShieldCheck aria-hidden="true" />{tr('Не вмешивается в игру')}
          </p>
        </div>
      </section>
      <Presentation />
      <FriendsPromo referral={Boolean(banner)} />
    </>
  )
}

/** «Пригласи друга» on the home page: the offer in two lines, the ranks ladder and one button. */
function FriendsPromo({ referral = false }: { referral?: boolean }) {
  const { account } = useAuth()
  const signedIn = Boolean(account)
  // Signed out: nothing about paying (owner, 12.11.2026: «убери на сайте на время, кнопку подписка, пока человек не
  // зарегистрируется»; a page opened from the iPhone app shows no subscription) — but on a friend's link (/r/<code>), whose
  // whole point is the offer.
  if (!signedIn && !referral) return null
  // The Apple reviewer's test account: no «Пригласи друга» (owner, 12.11.2026).
  if (account?.storeReview) return null
  return (
    <section className="friends-promo" aria-labelledby="friends-promo-title">
      <div className="container">
        <Reveal className="panel friends-card">
          <div>
            <div className="feature-eyebrow"><span className="feature-icon" aria-hidden="true"><Users /></span>{tr('Пригласи друга')}</div>
            <h2 className="feature-title" id="friends-promo-title">{tr('Raid OS выгоднее с отрядом')}</h2>
            <p className="feature-lead">{tr('Приглашай друзей, помогай им быстрее закрывать квесты и получай Premium бесплатно. Твой друг получает скидку 20 % на первый месяц, а ты — 7 дней Premium за каждого, кто его оплатил, даже если у тебя ещё не было оплат.')}</p>
            <div className="hero-actions">
              {signedIn ? (
                <Link to="/cabinet" className="button primary large"><Ticket aria-hidden="true" />{tr('Мой код')}</Link>
              ) : (
                <Link to="/register" className="button primary large"><UserPlus aria-hidden="true" />{tr('Зарегистрироваться')}</Link>
              )}
            </div>
          </div>
          <RankLadder compact />
        </Reveal>
      </div>
    </section>
  )
}
