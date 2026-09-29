import { Download, ShieldCheck, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Trailer } from '../components/Trailer'
import { stagger } from '../hooks/motion'

export function HomePage({ banner }: { banner?: ReactNode }) {
  return (
    <section className="hero">
      <div className="container">
        {banner}
        <div className="hero-head">
          <div className="eyebrow stagger" style={stagger(0)}>Компаньон для Escape from Tarkov</div>
          <h1 className="hero-title stagger" style={stagger(1)}>Tarkov Operator <span>Companion</span></h1>
          <p className="hero-lead stagger" style={stagger(2)}>Всё важное перед рейдом — в одном окне рядом с игрой.</p>
        </div>

        <div className="hero-stage stagger" style={stagger(3)}>
          <Trailer />
        </div>

        <div className="hero-actions center stagger" style={stagger(4)}>
          <Link to="/download" className="button primary large"><Download aria-hidden="true" />Скачать приложение</Link>
          <Link to="/cabinet" className="button large"><UserRound aria-hidden="true" />Личный кабинет</Link>
        </div>
        <p className="hero-note stagger" style={stagger(5)}>
          <ShieldCheck aria-hidden="true" />Не вмешивается в игру · Windows 10 и 11
        </p>
      </div>
    </section>
  )
}
