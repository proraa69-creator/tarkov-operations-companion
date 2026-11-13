import { createContext, useCallback, useContext, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { featureEnabled } from '../app/archivedFeatures'
import { uiText } from '../i18n/renderText'
import { usePopupMenu } from '../components/usePopupMenu'

/** «Сборка оружия» on this weapon, on «Готовые сборки» (pages/WeaponBuildsPage.tsx reads `weapon` and `tab`). */
function weaponBuildsHref(weaponId: string) {
  return `/arsenal/builds?weapon=${encodeURIComponent(weaponId)}&tab=ready`
}

/** The same rule as the page's route (app/App.tsx): elsewhere the address leads to «Баллистика». */
const buildsShown = () => featureEnabled('weaponBuilds') || import.meta.env.DEV

interface WeaponMenu { x: number; y: number; id: string; name: string }
type OpenMenu = (weapon: { id: string; name: string }, event: ReactMouseEvent) => void

const WeaponMenuContext = createContext<OpenMenu | undefined>(undefined)

/**
 * A right click on a weapon of «Сбор на рейд» (owner, 10.11.2026: «Сразу открывается окно не сборок человека, а сборки
 * приложения… И все, и человек пользуется»): «Открыть сборку». The menu lives here, above the list of a choice's variants,
 * which goes away on the press that reaches the menu.
 */
export function WeaponBuildMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<WeaponMenu | null>(null)
  const close = useCallback(() => setMenu(null), [])
  const open = useCallback<OpenMenu>((weapon, event) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, ...weapon })
  }, [])
  return <WeaponMenuContext.Provider value={buildsShown() ? open : undefined}>
    {children}
    <WeaponBuildMenuView menu={menu} onClose={close} />
  </WeaponMenuContext.Provider>
}

/**
 * The right-click handler for one weapon (owner, 13.11.2026: «при наведении курсора на оружие правой кнопкой мыши открывалась
 * менюшка… «Открыть сборку оружия»»); none outside the provider or while «Сборка оружия» is hidden.
 */
export function useWeaponBuildMenu(weapon: { id: string; name: string }) {
  const open = useContext(WeaponMenuContext)
  return open ? (event: ReactMouseEvent) => open(weapon, event) : undefined
}

function WeaponBuildMenuView({ menu, onClose }: { menu: WeaponMenu | null; onClose: () => void }) {
  const ref = usePopupMenu(menu, onClose)
  const navigate = useNavigate()
  if (!menu) return null
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 228))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 90))
  return createPortal(
    <div ref={ref} className="point-menu quest-defer-menu weapon-build-menu" role="menu" aria-label={uiText('Меню оружия')} style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()} onMouseDown={(event) => event.stopPropagation()}>
      <div className="point-menu-title">{uiText(menu.name)}</div>
      <button type="button" role="menuitem" onClick={() => { onClose(); navigate(weaponBuildsHref(menu.id)) }}>
        <Wrench size={13} aria-hidden="true" />{uiText('Открыть сборку оружия')}
      </button>
    </div>,
    document.body,
  )
}
