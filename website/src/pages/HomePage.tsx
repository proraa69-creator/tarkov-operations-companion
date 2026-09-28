import { ArrowRight, Check, Download, Languages, Layers, ListChecks, Map, ShieldCheck, Store, UserRound, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Trailer } from '../components/Trailer'

const FEATURES = [
  {
    icon: Map,
    eyebrow: 'Карты',
    title: 'Карты и мини-карта поверх игры',
    text: 'Интерактивные карты всех локаций и компактная мини-карта, которая открывается поверх игры по горячей клавише.',
    points: ['Выходы, ключи, боссы и точки заданий на одной карте', 'Позиция по игровому скриншоту — без чтения памяти игры', 'Оверлей работает в режиме «Оконный без рамки»'],
  },
  {
    icon: ListChecks,
    eyebrow: 'Прогресс',
    title: 'Задания и Капа',
    text: 'Прогресс заданий подхватывается из журналов игры, а путь к «Капе» разложен по шагам.',
    points: ['Цепочки заданий по торговцам и что открывается дальше', 'Предметы для сдачи и отметка «найдено в рейде»', 'Прогресс Капы: что уже выполнено, что осталось'],
  },
  {
    icon: Store,
    eyebrow: 'Экономика',
    title: 'Барахолка',
    text: 'Предметы, ключи и боеприпасы в одном разделе: цены под рукой, чтобы за секунды решить, что продать и что взять в рейд.',
    points: ['Цены предметов и лучший вариант продажи', 'Боеприпасы по калибрам: урон и пробитие', 'Избранное и список предметов на рейд'],
  },
  {
    icon: Layers,
    eyebrow: 'Режимы',
    title: 'Профили PvP, PvE и Сезон',
    text: 'У каждого режима свой прогресс. Переключайтесь в один клик — данные режимов никогда не смешиваются.',
    points: ['Отдельный прогресс заданий для PvP, PvE и Сезона', 'Привязка никнейма Tarkov для каждого режима', 'Русский и английский интерфейс'],
  },
]

const STEPS = [
  { title: 'Скачайте приложение', text: 'Портативная версия для Windows — установка не требуется.' },
  { title: 'Создайте аккаунт', text: 'Один аккаунт для сайта и приложения. Вход по e-mail и паролю.' },
  { title: 'Привяжите никнеймы', text: 'Укажите ник для PvP, PvE и Сезона — и компаньон готов к рейду.' },
]

export function HomePage({ banner }: { banner?: ReactNode }) {
  return (
    <div className="page-in">
      <section className="hero">
        <div className="container">
          {banner}
          <div className="hero-grid" style={banner ? { marginTop: 34 } : undefined}>
            <div>
              <div className="eyebrow">Компаньон для Escape from Tarkov</div>
              <h1 className="hero-title">Tarkov Operations <span>Companion</span></h1>
              <p className="hero-lead">
                Карты с мини-картой поверх игры, задания и путь к «Капе», цены барахолки и отдельные профили PvP, PvE и Сезона — в одном приложении для Windows.
              </p>
              <div className="hero-actions">
                <Link to="/download" className="button primary large"><Download aria-hidden="true" />Скачать приложение</Link>
                <Link to="/cabinet" className="button large"><UserRound aria-hidden="true" />Личный кабинет</Link>
              </div>
              <div className="hero-tags">
                <span className="tag brass">PvP · PvE · Сезон</span>
                <span className="tag"><Languages aria-hidden="true" />Русский и English</span>
                <span className="tag green"><ShieldCheck aria-hidden="true" />Без вмешательства в игру</span>
              </div>
            </div>
            <Trailer />
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Возможности</div>
            <h2 className="section-title">Всё, что нужно перед рейдом и во время него</h2>
            <p className="section-sub">Без вкладок браузера и поиска по вики: карта, задания и цены открываются в одном окне или прямо поверх игры.</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map(({ icon: Icon, eyebrow, title, text, points }) => (
              <article key={title} className="panel feature">
                <div className="feature-icon"><Icon aria-hidden="true" /></div>
                <div>
                  <div className="eyebrow">{eyebrow}</div>
                  <h3 style={{ marginTop: 6 }}>{title}</h3>
                </div>
                <p>{text}</p>
                <ul>
                  {points.map((point) => <li key={point}><Check aria-hidden="true" />{point}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Как начать</div>
            <h2 className="section-title">Три шага до первого рейда</h2>
          </div>
          <div className="steps">
            {STEPS.map((step, index) => (
              <div key={step.title} className="panel step">
                <div className="step-num">ШАГ {String(index + 1).padStart(2, '0')}</div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            ))}
          </div>
          <div className="panel fairplay" style={{ marginTop: 16 }}>
            <ShieldCheck aria-hidden="true" />
            <p><strong>Честная игра.</strong> Приложение не внедряется в Escape from Tarkov, не читает память игры, не автоматизирует действия и не обходит защиту. Оно работает только с тем, что игра сама сохраняет на диск, — журналами и скриншотами.</p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container">
          <div className="panel cta-band">
            <div>
              <div className="eyebrow"><Users aria-hidden="true" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />Готовы к рейду?</div>
              <h2>Скачайте приложение и войдите в аккаунт</h2>
              <p>Один аккаунт для сайта и приложения.</p>
            </div>
            <div className="hero-actions">
              <Link to="/download" className="button primary large"><Download aria-hidden="true" />Скачать приложение</Link>
              <Link to="/register" className="button large">Создать аккаунт<ArrowRight aria-hidden="true" /></Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
