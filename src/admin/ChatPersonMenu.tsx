import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { MessagesSquare, UserRound } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { initial } from './adminFormat'
import type { PersonMenuState } from './personMenu'
import './chatPersonMenu.css'

/**
 * The menu on a person in the admin chats (owner, 24.11.2026: «я захожу в чат, и вот у меня есть чаты по никам. Вот я
 * нажимаю правой кнопкой, на телефоне зажимаю пальцем какого-либо из человека… у меня открывается окошечко, и там будет
 * посмотреть профиль»): opened by usePersonMenu (admin/personMenu.ts). The mouse gets a small menu by the pointer, the
 * finger a sheet from the bottom of the screen: «Посмотреть профиль» and «Открыть чат» (when `onChat` is given). Arrow keys
 * move between the items, Escape or a click outside closes it, the focus goes back to the person.
 */
export function ChatPersonMenu({ menu, onClose, onProfile, onChat }: { menu: PersonMenuState | null; onClose: () => void; onProfile: (accountId: string) => void; onChat?: (accountId: string) => void }) {
  if (!menu || typeof document === 'undefined') return null
  return createPortal(<PersonMenuBody key={`${menu.accountId}:${menu.x}:${menu.y}`} menu={menu} onClose={onClose} onProfile={onProfile} onChat={onChat} />, document.body)
}

function PersonMenuBody({ menu, onClose, onProfile, onChat }: { menu: PersonMenuState; onClose: () => void; onProfile: (accountId: string) => void; onChat?: (accountId: string) => void }) {
  const { locale } = useLocale()
  const tr = (ru: string, en: string) => (locale === 'en' ? en : ru)
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const returnTo = useRef<Element | null>(menu.trigger ?? (typeof document === 'undefined' ? null : document.activeElement))
  // By the pointer, inside the window.
  useLayoutEffect(() => {
    if (menu.sheet || !box.current) return
    const { width, height } = box.current.getBoundingClientRect()
    const margin = 8
    setPlace({
      left: Math.max(margin, Math.min(menu.x, window.innerWidth - width - margin)),
      top: Math.max(margin, menu.y + height + margin > window.innerHeight ? menu.y - height : menu.y),
    })
  }, [menu])
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    const focusBack = returnTo.current
    return () => { if (focusBack instanceof HTMLElement && document.contains(focusBack)) focusBack.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    const away = () => onClose()
    window.addEventListener('resize', away)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('resize', away)
      window.removeEventListener('blur', away)
    }
  }, [onClose])
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
  }
  const choose = (run: (accountId: string) => void) => () => { onClose(); run(menu.accountId) }
  const items = <>
    <button type="button" role="menuitem" className="chat-person-menu-item" onClick={choose(onProfile)}><UserRound size={menu.sheet ? 19 : 15} aria-hidden="true" />{tr('Посмотреть профиль', 'View profile')}</button>
    {onChat && <button type="button" role="menuitem" className="chat-person-menu-item" onClick={choose(onChat)}><MessagesSquare size={menu.sheet ? 19 : 15} aria-hidden="true" />{tr('Открыть чат', 'Open chat')}</button>}
  </>
  return (
    <div className={`chat-person-menu-layer${menu.sheet ? ' is-sheet' : ''}`} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }} onContextMenu={(event) => { event.preventDefault(); if (event.target === event.currentTarget) onClose() }}>
      {menu.sheet ? (
        <div ref={box} className="chat-person-menu is-sheet" role="menu" aria-label={menu.name} onKeyDown={keys}>
          <div className="chat-person-menu-title"><span className="chat-person-menu-avatar" aria-hidden="true">{initial(menu.name)}</span><strong>{menu.name}</strong></div>
          {items}
          <button type="button" className="chat-person-menu-cancel" onClick={onClose}>{tr('Отмена', 'Cancel')}</button>
        </div>
      ) : (
        <div ref={box} className="chat-person-menu" role="menu" aria-label={menu.name} onKeyDown={keys} style={place ? { left: place.left, top: place.top } : { left: menu.x, top: menu.y, visibility: 'hidden' }}>
          <div className="chat-person-menu-title"><strong>{menu.name}</strong></div>
          {items}
        </div>
      )}
    </div>
  )
}
