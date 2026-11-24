import { NavLink } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isOwnerApp } from '../app/buildEdition'
import { useOwnerRequestCount } from '../data/ownerRequests'
import { useOwnerAccess } from './ownerAccess'
import './adminPanel.css'

/**
 * «Админ панель» at the top left, right above «Обзор» (owner, 16.10.2026: «Сделай отдельно в админ приложении, слева над
 * кнопкой обзор Админ панель»): only in the owner's app, and not while it is signed in to somebody else's account.
 *
 * The red number of what waits (owner, 15.11.2026: «Красная цифра непрочитанных… должна гореть на кнопке «Админ
 * панель»»): reports that wait plus conversations with unseen messages, moving the moment one arrives or is read
 * (src/data/ownerRequests.ts). «Отчёты» and «Чат» are inside the panel; the sidebar has no «Отчёты» of its own any more.
 */
export function AdminNavLink({ locale }: { locale: 'ru' | 'en' }) {
  if (!isOwnerApp()) return null
  return <OwnerLink locale={locale} />
}

function OwnerLink({ locale }: { locale: 'ru' | 'en' }) {
  const access = useOwnerAccess()
  const count = useOwnerRequestCount()
  if (access === 'not-owner') return null
  return (
    <NavLink to="/admin" className={({ isActive }) => `nav-link admin-nav-link ${isActive ? 'active' : ''}`}>
      <ShieldCheck /><span>{locale === 'en' ? 'Admin panel' : 'Админ панель'}</span>
      {count ? <span className="nav-badge" aria-label={`${uiText('Ждут ответа')}: ${count}`}>{count > 99 ? '99+' : count}</span> : null}
    </NavLink>
  )
}
