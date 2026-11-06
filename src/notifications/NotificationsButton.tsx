import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { TriangleAlert, Trash2, X } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { uiLabel, uiText } from '../i18n/renderText'
import { clearNotifications, markNotificationsRead, unreadNotifications, useNotifications, type AppNotification } from './notificationCenter'
import '../news/news.css'
import './notifications.css'

/** Opening the window reads everything, as «Обновление» does; what was new keeps its mark while it is open. */
export function NotificationsDialog({ onClose }: { onClose: () => void }) {
  const entries = useNotifications()
  const { locale } = useLocale()
  const navigate = useNavigate()
  const [fresh] = useState(() => new Set(entries.filter((entry) => !entry.read).map((entry) => entry.id)))
  useEffect(() => { markNotificationsRead() }, [entries])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const when = (at: number) => new Date(at).toLocaleString(locale === 'en' ? 'en' : 'ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  const body = (entry: AppNotification) => <>
    <header><strong>{entry.title}</strong><small>{when(entry.at)}</small></header>
    <p>{entry.text}</p>
  </>
  return createPortal(
    <div className="registration-overlay news-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog news-dialog" role="dialog" aria-modal="true" aria-labelledby="notifications-title">
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <div className="news-head">
          <h2 id="notifications-title">{uiLabel('Уведомления')}</h2>
          {entries.length > 0 && <button type="button" className="button small ghost" onClick={clearNotifications}><Trash2 size={13} aria-hidden="true" />{uiLabel('Очистить')}</button>}
        </div>
        {entries.length === 0
          ? <p className="notifications-empty">{uiLabel('Уведомлений пока нет.')}</p>
          : <div className="news-list">{entries.map((entry) => entry.open
            ? <button key={entry.id} type="button" className={`news-entry notification-entry${fresh.has(entry.id) ? ' is-new' : ''}`} onClick={() => { onClose(); navigate(entry.open!) }}>{body(entry)}</button>
            : <article key={entry.id} className={`news-entry notification-entry${fresh.has(entry.id) ? ' is-new' : ''}`}>{body(entry)}</article>)}</div>}
      </section>
    </div>,
    document.body,
  )
}

/**
 * The small button on top, beside «Обновление», with the same red count of what is not read yet. A phone's top bar has no room for
 * it (the PvP / PvE / Season switch would shrink until its words do not fit): there it is a row of «Ещё» (mobile/MobileNav.tsx).
 */
export function NotificationsButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const unread = unreadNotifications(useNotifications())
  const name = uiLabel('Уведомления')
  return <>
    <button type="button" className="icon-button news-button notifications-button" title={name} aria-label={unread > 0 ? `${name}: ${unread}` : name} onClick={() => setOpen(true)}>
      <TriangleAlert size={16} aria-hidden="true" />
      {unread > 0 && <span className="nav-badge" aria-hidden="true">{unread}</span>}
    </button>
    {open && <NotificationsDialog onClose={close} />}
  </>
}
