import { Crown, Download, Menu, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { APP_VERSION, PRODUCT_NAME } from '../config'
import { useHashScroll } from '../hooks/hashScroll'
import { useRipple } from '../hooks/motion'
import { CookieNotice } from './CookieNotice'
import { SubscriptionDialog } from './SubscriptionDialog'
import '../brand.css'

const NAV = [
  { to: '/', label: 'Главная', end: true },
  { to: '/about', label: 'О нас', end: false },
]

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Raid OS — на главную">
      <img className="brand-mark brand-logo-tile" src="/brand/icon.svg" alt="" aria-hidden="true" />
      <span className="brand-text">
        <img className="brand-name brand-logo-name" src="/brand/name.svg" alt="Raid OS" />
        <span className="brand-sub">ПОЛЕВОЙ КОМПАНЬОН</span>
      </span>
    </Link>
  )
}

export function SiteLayout() {
  const { pathname } = useLocation()
  const { account } = useAuth()
  // The mobile menu is tied to the page it was opened on, so navigating closes it.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null)
  const menuOpen = menuOpenOn === pathname
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  useRipple()
  useHashScroll()

  return (
    <div className="site">
      <header className="site-header">
        <div className="container">
          <Brand />
          <nav className="site-nav" aria-label="Основная навигация">
            {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}
          </nav>
          <div className="header-actions">
            <button type="button" className="button header-subscription" aria-haspopup="dialog" onClick={() => setSubscriptionOpen(true)}>
              <Crown aria-hidden="true" />
              <span className="label-long">Подписка</span>
              <span className="label-short">Подписка</span>
            </button>
            <Link to="/download" className="button primary">
              <Download aria-hidden="true" />
              <span className="label-long">Скачать приложение</span>
              <span className="label-short">Скачать</span>
            </Link>
            <Link to="/cabinet" className="button header-cabinet" title={account ? account.email : undefined}>
              <UserRound aria-hidden="true" />
              <span className="label-long">Личный кабинет</span>
              <span className="label-short">Кабинет</span>
            </Link>
            <button type="button" className="icon-button menu-toggle" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}>
              <span className={`menu-icon${menuOpen ? ' is-open' : ''}`} aria-hidden="true">
                <Menu size={18} />
                <X size={18} />
              </span>
            </button>
          </div>
        </div>
        <nav id="mobile-nav" className={`mobile-nav${menuOpen ? ' is-open' : ''}`} inert={!menuOpen} aria-hidden={!menuOpen} aria-label="Мобильная навигация">
          {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}
          <button type="button" className="mobile-nav-button" onClick={() => { setMenuOpenOn(null); setSubscriptionOpen(true) }}>Подписка</button>
          <NavLink to="/download">Скачать приложение</NavLink>
          <NavLink to="/cabinet">Личный кабинет</NavLink>
        </nav>
      </header>
      {menuOpen && <div className="menu-scrim" aria-hidden="true" onClick={() => setMenuOpenOn(null)} />}

      <main className="site-main">
        {/* Keyed by path so every navigation replays the route-enter transition. */}
        <div key={pathname} className="route-view">
          <Outlet />
        </div>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div>
            <div>© {new Date().getFullYear()} {PRODUCT_NAME} · версия {APP_VERSION}</div>
            <div>Неофициальный фанатский проект. Escape from Tarkov — товарный знак Battlestate Games; проект с ней не связан.</div>
          </div>
          <nav aria-label="Ссылки в подвале">
            <Link to="/about">О нас</Link>
            <Link to="/download">Скачать</Link>
            <Link to="/cabinet">Личный кабинет</Link>
          </nav>
          <nav className="legal-links" aria-label="Документы">
            <Link to="/legal/offer">Публичная оферта</Link>
            <Link to="/legal/privacy">Политика конфиденциальности</Link>
            <Link to="/legal/consent">Согласие на обработку ПД</Link>
            <Link to="/legal/cookies">Cookie</Link>
            <Link to="/legal">Тарифы, оплата и возврат</Link>
          </nav>
        </div>
      </footer>
      {subscriptionOpen && <SubscriptionDialog onClose={() => setSubscriptionOpen(false)} />}
      <CookieNotice />
    </div>
  )
}
