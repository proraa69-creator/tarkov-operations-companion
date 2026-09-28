import { Download, Menu, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { APP_VERSION } from '../config'

const NAV = [
  { to: '/', label: 'Главная', end: true },
  { to: '/download', label: 'Скачать', end: false },
  { to: '/cabinet', label: 'Личный кабинет', end: false },
]

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Tarkov Operations Companion — на главную">
      <span className="brand-mark" aria-hidden="true">TO</span>
      <span className="brand-text">
        <span className="brand-name">TARKOV OPERATIONS</span>
        <span className="brand-sub">COMPANION</span>
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

  return (
    <div className="site">
      <header className="site-header">
        <div className="container">
          <Brand />
          <nav className="site-nav" aria-label="Основная навигация">
            {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}
          </nav>
          <div className="header-actions">
            <Link to="/download" className="button primary">
              <Download aria-hidden="true" />
              <span className="label-long">Скачать приложение</span>
              <span className="label-short">Скачать</span>
            </Link>
            <Link to="/cabinet" className="button" title={account ? account.email : undefined}>
              <UserRound aria-hidden="true" />
              <span className="label-long">Личный кабинет</span>
              <span className="label-short">Кабинет</span>
            </Link>
            <button type="button" className="icon-button menu-toggle" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}>
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        <nav id="mobile-nav" className="mobile-nav" hidden={!menuOpen} aria-label="Мобильная навигация">
          {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}
          {!account && <NavLink to="/register">Регистрация</NavLink>}
        </nav>
      </header>

      <main className="site-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container">
          <div>
            <div>© {new Date().getFullYear()} Tarkov Operations Companion · версия {APP_VERSION}</div>
            <div>Неофициальный фанатский проект. Escape from Tarkov — товарный знак Battlestate Games; проект с ней не связан.</div>
          </div>
          <nav aria-label="Ссылки в подвале">
            <Link to="/download">Скачать</Link>
            <Link to="/login">Вход</Link>
            <Link to="/register">Регистрация</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
