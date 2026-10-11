import { Crown, Download, Menu, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { APP_VERSION, PRODUCT_NAME } from '../config'
import { useHashScroll } from '../hooks/hashScroll'
import { useRipple } from '../hooks/motion'
import { CookieNotice } from './CookieNotice'
import { LanguageSwitch } from './LanguageSwitch'
import { siteLocale, tr } from '../i18n'
import { SubscriptionDialog } from './SubscriptionDialog'
import '../brand.css'

const NAV = [
  { to: '/', label: 'Главная', end: true },
  { to: '/about', label: 'О нас', end: false },
]

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label={tr('Raid OS — на главную')}>
      <img className="brand-mark brand-logo-tile" src="/brand/icon.svg" alt="" aria-hidden="true" />
      <span className="brand-text">
        <img className="brand-name brand-logo-name" src="/brand/name.svg" alt="Raid OS" />
        <span className="brand-sub">{tr('ПОЛЕВОЙ КОМПАНЬОН')}</span>
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
          <nav className="site-nav" aria-label={tr('Основная навигация')}>
            {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{tr(item.label)}</NavLink>)}
          </nav>
          <div className="header-actions">
            <button type="button" className="button header-subscription" aria-haspopup="dialog" onClick={() => setSubscriptionOpen(true)}>
              <Crown aria-hidden="true" />
              <span className="label-long">{tr('Подписка')}</span>
              <span className="label-short">{siteLocale() === 'en' ? 'Plans' : 'Подписка'}</span>
            </button>
            <Link to="/download" className="button primary">
              <Download aria-hidden="true" />
              <span className="label-long">{tr('Скачать приложение')}</span>
              <span className="label-short">{tr('Скачать')}</span>
            </Link>
            <Link to="/cabinet" className="button header-cabinet" title={account ? account.email : undefined}>
              <UserRound aria-hidden="true" />
              <span className="label-long">{tr('Личный кабинет')}</span>
              <span className="label-short">{tr('Кабинет')}</span>
            </Link>
            {/* RU / EN right of «Личный кабинет», on the phone too (owner, 11.10.2026). */}
            <LanguageSwitch />
            <button type="button" className="icon-button menu-toggle" aria-label={tr(menuOpen ? 'Закрыть меню' : 'Открыть меню')} aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}>
              <span className={`menu-icon${menuOpen ? ' is-open' : ''}`} aria-hidden="true">
                <Menu size={18} />
                <X size={18} />
              </span>
            </button>
          </div>
        </div>
        <nav id="mobile-nav" className={`mobile-nav${menuOpen ? ' is-open' : ''}`} inert={!menuOpen} aria-hidden={!menuOpen} aria-label={tr('Мобильная навигация')}>
          {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{tr(item.label)}</NavLink>)}
          <button type="button" className="mobile-nav-button" onClick={() => { setMenuOpenOn(null); setSubscriptionOpen(true) }}>{tr('Подписка')}</button>
          <NavLink to="/download">{tr('Скачать приложение')}</NavLink>
          <NavLink to="/cabinet">{tr('Личный кабинет')}</NavLink>
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
            <div>© {new Date().getFullYear()} {PRODUCT_NAME} · {tr('версия {version}', { version: APP_VERSION })}</div>
            <div>{tr('Неофициальный фанатский проект. Escape from Tarkov — товарный знак Battlestate Games; проект с ней не связан.')}</div>
          </div>
          <nav aria-label={tr('Ссылки в подвале')}>
            <Link to="/about">{tr('О нас')}</Link>
            <Link to="/download">{tr('Скачать')}</Link>
            <Link to="/cabinet">{tr('Личный кабинет')}</Link>
          </nav>
          {/* The documents themselves stay in Russian (owner, 11.10.2026); only their names are translated. */}
          <nav className="legal-links" aria-label={tr('Документы')}>
            <Link to="/legal/offer">{tr('Публичная оферта')}</Link>
            <Link to="/legal/privacy">{tr('Политика конфиденциальности')}</Link>
            <Link to="/legal/consent">{tr('Согласие на обработку ПД')}</Link>
            <Link to="/legal/cookies">Cookie</Link>
            <Link to="/legal">{tr('Тарифы, оплата и возврат')}</Link>
          </nav>
        </div>
      </footer>
      {subscriptionOpen && <SubscriptionDialog onClose={() => setSubscriptionOpen(false)} />}
      <CookieNotice />
    </div>
  )
}
