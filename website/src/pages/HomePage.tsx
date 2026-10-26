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
import { tr } from '../i18n'
import '../invites.css'

export function HomePage({ banner }: { banner?: ReactNode }) {
  return (
    <>
      <section className="hero">
        <div className="container">
          {banner}
          <div className="hero-head">
            <div className="eyebrow stagger" style={stagger(0)}>{tr('Компаньон для Escape from Tarkov')}</div>
            <h1 className="hero-title hero-wordmark stagger" style={stagger(1)}><img src="/brand/wordmark.svg" alt={tr('Raid OS — полевой компаньон · Escape from Tarkov')} /></h1>
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
      <FriendsPromo />
    </>
  )
}

/** «Пригласи друга» on the home page: the offer in two lines, the ranks ladder and one button. */
function FriendsPromo() {
  const { account } = useAuth()
  const signedIn = Boolean(account)
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
