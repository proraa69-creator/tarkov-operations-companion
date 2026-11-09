import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Newspaper, RefreshCw, X } from 'lucide-react'
import { displayVersion } from '../app/appVersion'
import { IphoneUpdateLink } from '../mobile/IphoneUpdateBanner'
import { iphoneUpdatesShown, useIphoneUpdate } from '../mobile/iphoneUpdate'
import { useLocale } from '../i18n/LocaleProvider'
import { uiLabel, uiText } from '../i18n/renderText'
import { LIVE_UPDATE_EVENT } from '../data/mapUpdates'
import { refreshNewsEdits, useNewsList } from './newsEdits'
import { markAllNewsRead, NEWS_GROUPS, readNews, rememberFirstLook, unreadNews, useReadNews, type NewsEntry } from './newsState'
import './news.css'
import '../styles/iphoneUpdate.css'

/** The iPhone app's newer version (mobile/iphoneUpdate.ts) while this app is not updated; null elsewhere. */
function useAppUpdate() {
  const { available } = useIphoneUpdate()
  return iphoneUpdatesShown() ? available : null
}

function NewsEntryCard({ entry, isNew }: { entry: NewsEntry; isNew: boolean }) {
  const { locale } = useLocale()
  const language = locale === 'en' ? 'en' : 'ru'
  const date = new Date(`${entry.date}T12:00:00`).toLocaleDateString(language, { day: 'numeric', month: 'long' })
  return (
    <article className={`news-entry${isNew ? ' is-new' : ''}`}>
      <header>
        <strong>{entry.version}</strong>
        <small>{date}</small>
      </header>
      {NEWS_GROUPS.map(({ kind, title }) => {
        const items = entry.items.filter((item) => item.kind === kind)
        return items.length > 0 && (
          <section key={kind}>
            <h3>{uiText(title)}</h3>
            <ul>{items.map((item, index) => <li key={index}>{item[language] || item.ru}</li>)}</ul>
          </section>
        )
      })}
    </article>
  )
}

/** Opening the window reads everything (owner, 06.11.2026: «не надо добавлять кнопку… автоматически считается прочитанным»); what was new keeps its frame while it stays open. */
function NewsDialog({ onClose }: { onClose: () => void }) {
  const list = useNewsList()
  const [fresh] = useState(() => new Set(unreadNews(readNews(list), list).map((entry) => entry.version)))
  const appUpdate = useAppUpdate()
  useEffect(() => { markAllNewsRead(list) }, [list])
  // Always the owner's freshest text: asked on opening, and again the moment the server says something changed.
  useEffect(() => {
    const refresh = () => void refreshNewsEdits()
    refresh()
    window.addEventListener(LIVE_UPDATE_EVENT, refresh)
    return () => window.removeEventListener(LIVE_UPDATE_EVENT, refresh)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="registration-overlay news-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog news-dialog" role="dialog" aria-modal="true" aria-labelledby="news-title">
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <div className="news-head">
          <h2 id="news-title">{uiLabel('Обновление')}</h2>
        </div>
        {appUpdate && (
          // owner, 09.11.2026: «у него должно подсвечиваться в новостях… Вышла новая версия приложения. И оно будет гореть, пока
          // человек не обновит приложение. Прям там у него будет кнопка «Обновить»».
          <div className="news-app-update" role="status">
            <RefreshCw size={18} aria-hidden="true" />
            <strong>{`${uiText('Вышла новая версия приложения')} ${displayVersion(appUpdate)}`}</strong>
            <IphoneUpdateLink className="button small primary" />
          </div>
        )}
        <div className="news-list">{list.map((entry) => <NewsEntryCard key={entry.version} entry={entry} isNew={fresh.has(entry.version)} />)}</div>
      </section>
    </div>,
    document.body,
  )
}

/** The small button on top, with the red count of what is not read yet, as in «Отчёты» and «Торговля». */
export function NewsButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const read = useReadNews()
  const list = useNewsList()
  const appUpdate = useAppUpdate()
  // The app's own update counts as one more and makes the button burn until the app is updated.
  const unread = unreadNews(read, list).length + (appUpdate ? 1 : 0)
  useEffect(() => { rememberFirstLook(list) }, [list])
  useEffect(() => { void refreshNewsEdits() }, [])
  const name = uiLabel('Обновление')
  const label = unread > 0 ? `${name}: ${unread}` : name
  return <>
    <button type="button" className={`icon-button news-button${appUpdate ? ' has-app-update' : ''}`} title={name} aria-label={label} onClick={() => setOpen(true)}>
      <Newspaper size={16} aria-hidden="true" />
      {unread > 0 && <span className="nav-badge" aria-hidden="true">{unread}</span>}
    </button>
    {open && <NewsDialog onClose={close} />}
  </>
}
