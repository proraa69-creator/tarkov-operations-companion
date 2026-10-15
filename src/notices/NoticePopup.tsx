import { useEffect, useRef, useState } from 'react'
import { ExternalLink, ImageOff, LoaderCircle, Megaphone, X } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { localized, type PlayerNotice } from '../shared/notices'
import { noticeImage } from './noticeInbox'

/**
 * One of the owner's announcements as a window over the app (owner, 15.10.2026: «в всплывающем окне, я нажал и при входе
 * или кто в приложении, у них появятся уведомления»), in the app's dialog style: the title and the text in the app's
 * language when the owner wrote that language (else Russian), the photos as a small gallery that opens full size, the
 * owner's button (a link opened in the system browser) and «Понятно», which closes it for good on every device.
 */
export function NoticePopup({ notice, locale, onClose }: { notice: PlayerNotice; locale: 'ru' | 'en'; onClose: () => void }) {
  const [full, setFull] = useState<string | null>(null)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => { close.current?.focus() }, [notice.id])
  const title = localized(notice.title, notice.titleEn, locale)
  const text = localized(notice.text, notice.textEn, locale)
  return (
    <div className="registration-overlay notice-overlay" role="dialog" aria-modal="true" aria-labelledby={`notice-${notice.id}-title`}
      onKeyDown={(event) => { if (event.key === 'Escape' && full) { event.stopPropagation(); setFull(null) } }}>
      <section className="panel registration-dialog notice-dialog">
        <div className="notice-head">
          <div className="registration-icon notice-icon"><Megaphone size={22} aria-hidden="true" /></div>
          <div className="eyebrow">{uiLabel('Объявление Raid OS')}</div>
        </div>
        <h2 id={`notice-${notice.id}-title`} lang={title === notice.titleEn ? 'en' : undefined}>{title}</h2>
        <p className="notice-text" lang={text === notice.textEn ? 'en' : undefined}>{text}</p>
        {notice.images > 0 && <NoticeGallery id={notice.id} count={notice.images} onOpen={setFull} />}
        <div className="notice-actions">
          {notice.button && (
            <a className="button ghost" href={notice.button.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} aria-hidden="true" />{localized(notice.button.text, notice.button.textEn, locale)}
            </a>
          )}
          <button ref={close} type="button" className="button primary" onClick={onClose}>{uiLabel('Понятно')}</button>
        </div>
      </section>
      {full && (
        <div className="notice-photo-full" role="dialog" aria-modal="true" aria-label={uiLabel('Фото')} onClick={() => setFull(null)}>
          <img src={full} alt="" />
          <button type="button" className="icon-button notice-photo-close" aria-label={uiLabel('Закрыть фото')} onClick={() => setFull(null)}><X size={18} /></button>
        </div>
      )}
    </div>
  )
}

/** The photos as thumbnails, loaded one by one; a click opens one full size. */
function NoticeGallery({ id, count, onOpen }: { id: number; count: number; onOpen: (url: string) => void }) {
  const [urls, setUrls] = useState<Array<string | null | undefined>>(() => Array.from({ length: count }, () => undefined))
  useEffect(() => {
    let alive = true
    Array.from({ length: count }, (_, idx) => noticeImage(id, idx).then(
      (url) => { if (alive) setUrls((current) => current.map((value, at) => (at === idx ? url : value))) },
      () => { if (alive) setUrls((current) => current.map((value, at) => (at === idx ? null : value))) },
    ))
    return () => { alive = false }
  }, [id, count])
  return (
    <ul className={`notice-gallery count-${count}`} aria-label={uiLabel('Фото')}>
      {urls.map((url, idx) => (
        <li key={idx}>
          {url ? <button type="button" className="notice-photo" aria-label={`${uiLabel('Открыть фото')} ${idx + 1}`} onClick={() => onOpen(url)}><img src={url} alt="" /></button>
            : <span className="notice-photo is-empty">{url === null ? <ImageOff size={16} aria-hidden="true" /> : <LoaderCircle size={16} className="spin" aria-hidden="true" />}</span>}
        </li>
      ))}
    </ul>
  )
}
