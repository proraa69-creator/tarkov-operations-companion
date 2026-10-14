import { Crosshair, Mail, ShieldCheck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Reveal } from '../components/Reveal'
import { stagger } from '../hooks/motion'
import { tr } from '../i18n'

/** Public contact address (owner, 01.10.2026). */
const CONTACT_EMAIL = 'raidosapp@gmail.com'

export function AboutPage() {
  return (
    <div className="page">
      <div className="container narrow">
        <header className="page-header about-head">
          <div>
            <div className="eyebrow stagger" style={stagger(0)}>{tr('О нас')}</div>
            <h1 className="page-title stagger" style={stagger(1)}>{tr('Сделано игроками — для игроков')}</h1>
            <p className="page-subtitle stagger" style={stagger(2)}>
              {tr('Мы — небольшая независимая команда, которая сама годами ходит в рейды Escape from Tarkov. Raid OS — это то, чего нам самим не хватало между рейдами.')}
            </p>
          </div>
        </header>

        <div className="about-grid">
          <Reveal className="panel about-card">
            <div className="about-icon"><Users aria-hidden="true" /></div>
            <h2>{tr('Кто мы')}</h2>
            <p>{tr('Независимые разработчики и игроки EFT. Мы не связаны с Battlestate Games и не продаём игровые преимущества — только удобство.')}</p>
          </Reveal>
          <Reveal className="panel about-card" delay={90}>
            <div className="about-icon"><Crosshair aria-hidden="true" /></div>
            <h2>{tr('Наша миссия')}</h2>
            <p>{tr('Меньше вкладок браузера и заметок на листочке, больше внимания самой игре. Компаньон должен быть под рукой и не мешать.')}</p>
          </Reveal>
        </div>

        <Reveal className="panel fairplay">
          <ShieldCheck aria-hidden="true" />
          <p>
            <strong>{tr('Честная игра.')}</strong>{' '}
            {tr('Raid OS не нарушает правила игры: не внедряется в Escape from Tarkov, не читает её память, не автоматизирует действия и не обходит защиту.')}
          </p>
        </Reveal>

        <Reveal className="panel contact-card">
          <div className="about-icon"><Mail aria-hidden="true" /></div>
          <div className="contact-text">
            <h2>{tr('Связаться с нами')}</h2>
            <p>{tr('Идеи, ошибки, сотрудничество — пишите.')}</p>
            <p className="mono contact-mail"><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
          </div>
          <Link to="/download" className="button primary">{tr('Скачать приложение')}</Link>
        </Reveal>

        <Reveal>
          <p className="disclaimer">
            {tr('Неофициальный фанатский проект. Escape from Tarkov — товарный знак Battlestate Games Limited. Проект не связан с Battlestate Games, не одобрен и не спонсируется ею. Все игровые материалы принадлежат их правообладателям.')}
            {' '}
            {tr('Игровой контент и материалы являются товарными знаками и объектами авторского права компании Battlestate Games и её лицензиаров. Все права защищены.')}
          </p>
        </Reveal>
      </div>
    </div>
  )
}
