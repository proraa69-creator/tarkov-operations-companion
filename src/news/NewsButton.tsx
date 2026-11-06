import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Newspaper, X } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { markAllNewsRead, NEWS, readNews, rememberFirstLook, unreadNews, useReadNews, type NewsEntry, type NewsKind } from './newsState'
import './news.css'

/** In this order inside an entry. */
const GROUPS: ReadonlyArray<{ kind: NewsKind; title: string }> = [
  { kind: 'added', title: 'Добавили' },
  { kind: 'changed', title: 'Изменили' },
  { kind: 'improved', title: 'Улучшили' },
]

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
      {GROUPS.map(({ kind, title }) => {
        const items = entry.items.filter((item) => item.kind === kind)
        return items.length > 0 && (
          <section key={kind}>
            <h3>{uiText(title)}</h3>
            <ul>{items.map((item) => <li key={item.ru}>{item[language]}</li>)}</ul>
          </section>
        )
      })}
    </article>
  )
}

/** Opening the window reads everything (owner, 06.11.2026: «не надо добавлять кнопку… автоматически считается прочитанным»); what was new keeps its frame while it stays open. */
function NewsDialog({ onClose }: { onClose: () => void }) {
  const [fresh] = useState(() => new Set(unreadNews(readNews()).map((entry) => entry.version)))
  useEffect(() => { markAllNewsRead() }, [])
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
          <h2 id="news-title">{uiText('Новости обновлений')}</h2>
        </div>
        <div className="news-list">{NEWS.map((entry) => <NewsEntryCard key={entry.version} entry={entry} isNew={fresh.has(entry.version)} />)}</div>
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
  const unread = unreadNews(read).length
  useEffect(() => { rememberFirstLook() }, [])
  const label = unread > 0 ? `${uiText('Новости обновлений')}: ${unread}` : uiText('Новости обновлений')
  return <>
    <button type="button" className="icon-button news-button" title={uiText('Новости обновлений')} aria-label={label} onClick={() => setOpen(true)}>
      <Newspaper size={16} aria-hidden="true" />
      {unread > 0 && <span className="nav-badge" aria-hidden="true">{unread}</span>}
    </button>
    {open && <NewsDialog onClose={close} />}
  </>
}
