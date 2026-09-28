import { Crosshair, Mail, ShieldCheck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Reveal } from '../components/Reveal'
import { stagger } from '../hooks/motion'

/** TODO(contact): replace with the real public contact address before launch. */
const CONTACT_EMAIL = 'contact@example.com'

export function AboutPage() {
  return (
    <div className="page">
      <div className="container narrow">
        <header className="page-header about-head">
          <div>
            <div className="eyebrow stagger" style={stagger(0)}>О нас</div>
            <h1 className="page-title stagger" style={stagger(1)}>Сделано игроками — для игроков</h1>
            <p className="page-subtitle stagger" style={stagger(2)}>
              Мы — небольшая независимая команда, которая сама годами ходит в рейды Escape from Tarkov.
              Tarkov Operations Companion — это то, чего нам самим не хватало между рейдами.
            </p>
          </div>
        </header>

        <div className="about-grid">
          <Reveal className="panel about-card">
            <div className="about-icon"><Users aria-hidden="true" /></div>
            <h2>Кто мы</h2>
            <p>Независимые разработчики и игроки EFT. Мы не связаны с Battlestate Games и не продаём игровые преимущества — только удобство.</p>
          </Reveal>
          <Reveal className="panel about-card" delay={90}>
            <div className="about-icon"><Crosshair aria-hidden="true" /></div>
            <h2>Наша миссия</h2>
            <p>Меньше вкладок браузера и заметок на листочке, больше внимания самой игре. Компаньон должен быть под рукой и не мешать.</p>
          </Reveal>
        </div>

        <Reveal className="panel fairplay">
          <ShieldCheck aria-hidden="true" />
          <p>
            <strong>Честная игра.</strong> Приложение никогда не трогает игру: не внедряется в Escape from Tarkov, не читает
            её память, не автоматизирует действия и не обходит защиту. Оно работает только с тем, что игра сама сохраняет
            на диск, — журналами и скриншотами.
          </p>
        </Reveal>

        <Reveal className="panel contact-card">
          <div className="about-icon"><Mail aria-hidden="true" /></div>
          <div className="contact-text">
            <h2>Связаться с нами</h2>
            <p>Идеи, ошибки, сотрудничество со стримерами — пишите.</p>
            {/* TODO(contact): placeholder address — replace CONTACT_EMAIL with the real one. */}
            <p className="mono contact-mail">{CONTACT_EMAIL} <span className="tag danger">заглушка — заменить</span></p>
          </div>
          <Link to="/download" className="button primary">Скачать приложение</Link>
        </Reveal>

        <Reveal>
          <p className="disclaimer">
            Неофициальный фанатский проект. Escape from Tarkov — товарный знак Battlestate Games Limited. Проект не связан
            с Battlestate Games, не одобрен и не спонсируется ею. Все игровые материалы принадлежат их правообладателям.
          </p>
        </Reveal>
      </div>
    </div>
  )
}
