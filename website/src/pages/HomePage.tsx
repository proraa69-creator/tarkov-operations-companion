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
import '../invites.css'

export function HomePage({ banner }: { banner?: ReactNode }) {
  return (
    <>
      <section className="hero">
        <div className="container">
          {banner}
          <div className="hero-head">
            <div className="eyebrow stagger" style={stagger(0)}>Компаньон для Escape from Tarkov</div>
            <h1 className="hero-title hero-wordmark stagger" style={stagger(1)}><img src="/brand/wordmark.svg" alt="Raid OS — полевой компаньон · Escape from Tarkov" /></h1>
            <p className="hero-lead stagger" style={stagger(2)}>Всё важное перед рейдом — в одном окне рядом с игрой.</p>
          </div>

          <div className="hero-stage stagger" style={stagger(3)}>
            <Trailer />
          </div>

          <div className="hero-actions center stagger" style={stagger(4)}>
            <Link to="/download" className="button primary large"><Download aria-hidden="true" />Скачать приложение</Link>
            <Link to="/cabinet" className="button large"><UserRound aria-hidden="true" />Личный кабинет</Link>
          </div>
          <div className="stagger" style={stagger(5)}><Platforms /></div>
          <p className="hero-note stagger" style={stagger(6)}>
            <ShieldCheck aria-hidden="true" />Не вмешивается в игру · Windows 10 и 11
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
            <div className="feature-eyebrow"><span className="feature-icon" aria-hidden="true"><Users /></span>Пригласи друга</div>
            <h2 className="feature-title" id="friends-promo-title">Raid OS выгоднее с отрядом</h2>
            <p className="feature-lead">Приглашай друзей, помогай им быстрее закрывать квесты и получай Premium бесплатно. Твой друг получает скидку на первый месяц, а ты — дни подписки за каждого активного игрока.</p>
            <div className="hero-actions">
              {signedIn ? (
                <Link to="/cabinet" className="button primary large"><Ticket aria-hidden="true" />Мой код</Link>
              ) : (
                <Link to="/register" className="button primary large"><UserPlus aria-hidden="true" />Зарегистрироваться</Link>
              )}
            </div>
          </div>
          <RankLadder compact />
        </Reveal>
      </div>
    </section>
  )
}
