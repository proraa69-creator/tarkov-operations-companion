import { NavLink } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isOwnerApp } from '../app/buildEdition'
import { useOwnerRequestCount } from '../data/ownerRequests'
import '../styles/requests.css'

/**
 * «Заявки» at the bottom left of the owner app's sidebar (owner, 13.10.2026: «добавь снизу слева кнопку заявки и если
 * они появляются, то там на этой кнопке будет появлятся красный маленький кружок с количеством заявок»): the number of
 * open reports, moving the moment one arrives or is closed (src/data/ownerRequests.ts).
 */
export function RequestsNavButton({ locale }: { locale: 'ru' | 'en' }) {
  const owner = isOwnerApp()
  if (!owner) return null
  return <RequestsLink locale={locale} />
}

function RequestsLink({ locale }: { locale: 'ru' | 'en' }) {
  const count = useOwnerRequestCount()
  return (
    <nav className="nav-list requests-nav" aria-label={uiText('Заявки')}>
      <NavLink to="/requests" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        <Inbox /><span>{locale === 'en' ? 'Requests' : 'Заявки'}</span>
        {count ? <span className="nav-badge" aria-label={uiText(`Открытых заявок: ${count}`)}>{count > 99 ? '99+' : count}</span> : null}
      </NavLink>
    </nav>
  )
}
