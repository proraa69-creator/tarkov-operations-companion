import { ListChecks, Skull, Target, Warehouse } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { noteSidebarNavigation } from '../app/desktopBack'
import { uiText } from '../i18n/renderText'
import '../styles/hideoutTabs.css'

const VIEW = '/hideout'
const STASH = '/hideout/stash'
const QUESTS = '/hideout/quests'
const CIRCLE = '/hideout/cultist-circle'

/**
 * «Убежище и квесты»: three buttons at the very top that switch the page and never go away (owner, 20.11.2026: «кнопки убежище,
 * квесты и круг сектантов должны быть в самом верху, и они должны переключаться… кнопки не должны исчезать, они должны быть сверху,
 * над картой убежища»). «Убежище» opens the hideout from above; pressed again there, the items its levels take («по нажатию еще раз
 * убежище внутри уже… открываются предметы, требуемые для убежища»), and the list button beside it opens them at once.
 */
export function HideoutTabs() {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/+$/, '') || '/'
  const hideout = path === VIEW || path === STASH
  const tab = (to: string, active: boolean, label: string, icon: ReactNode) =>
    <Link to={to} className={`hideout-tab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>{icon}<span>{uiText(label)}</span></Link>
  // they switch the page like the sidebar, not «go into» it: no «Назад» over them on the PC (app/desktopBack.tsx)
  return <nav className="hideout-tabs" aria-label={uiText('Убежище и квесты')} onClickCapture={noteSidebarNavigation}>
    <div className={`hideout-tab-group${hideout ? ' is-active' : ''}`}>
      {tab(path === VIEW ? STASH : VIEW, hideout, 'Убежище', <Warehouse size={16} aria-hidden="true" />)}
      <Link to={STASH} className={`hideout-tab hideout-tab-items${path === STASH ? ' is-active' : ''}`} aria-current={path === STASH ? 'page' : undefined}
        aria-label={uiText('Предметы для убежища')} title={uiText('Предметы для убежища')}><ListChecks size={16} aria-hidden="true" /></Link>
    </div>
    {tab(QUESTS, path === QUESTS, 'Квесты', <Target size={16} aria-hidden="true" />)}
    {tab(CIRCLE, path === CIRCLE, 'Круг сектантов', <Skull size={16} aria-hidden="true" />)}
  </nav>
}

/** The pages under the three buttons: the buttons stay put while the page below them changes. */
export function HideoutSection() {
  return <>
    <HideoutTabs />
    <Outlet />
  </>
}
