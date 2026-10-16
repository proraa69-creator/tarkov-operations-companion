import { NavLink } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { isOwnerApp } from '../app/buildEdition'
import { useOwnerAccess } from './ownerAccess'
import './adminPanel.css'

/**
 * «Админ панель» at the top left, right above «Обзор» (owner, 16.10.2026: «Сделай отдельно в админ приложении, слева над
 * кнопкой обзор Админ панель»): only in the owner's app, and not while it is signed in to somebody else's account.
 */
export function AdminNavLink({ locale }: { locale: 'ru' | 'en' }) {
  if (!isOwnerApp()) return null
  return <OwnerLink locale={locale} />
}

function OwnerLink({ locale }: { locale: 'ru' | 'en' }) {
  const access = useOwnerAccess()
  if (access === 'not-owner') return null
  return (
    <NavLink to="/admin" className={({ isActive }) => `nav-link admin-nav-link ${isActive ? 'active' : ''}`}>
      <ShieldCheck /><span>{locale === 'en' ? 'Admin panel' : 'Админ панель'}</span>
    </NavLink>
  )
}
