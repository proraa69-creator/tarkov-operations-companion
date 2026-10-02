import { Download, ShieldCheck, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Platforms } from '../components/Platforms'
import { Trailer } from '../components/Trailer'
import { Presentation } from '../components/promo/Presentation'
import { stagger } from '../hooks/motion'

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
    </>
  )
}
