import { Download, ShieldCheck, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Platforms } from '../components/Platforms'
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
    </>
  )
}
