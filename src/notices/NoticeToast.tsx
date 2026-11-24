import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Megaphone, X } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { addNotification, hasNotification } from '../notifications/notificationCenter'
import { useToastTimer } from '../notifications/ToastDock'
import { localized, type PlayerNotice } from '../shared/notices'
import { NoticeGallery, type NoticeImageLoader } from './NoticePopup'

/**
 * An announcement or a personal message («Отчёт №87 принят в работу», «Вам зачислено…») in the corner, with its photos and the owner's
 * button, over nothing (owner, 07.11.2026: «Абсолютно все объявления не должны перекрывать интерфейс»; «само закрывается там через 7
 * секунд»). Closing it closes it for good on every device, by the cross or by itself, and its words stay in «Уведомления».
 * A mouse resting on it, a finger that touched it or an enlarged photo keep it: otherwise a long text could not be read to its end.
 */
export function NoticeToast({ notice, locale, loadImage, onSeen, onClose }: { notice: PlayerNotice; locale: 'ru' | 'en'; loadImage: NoticeImageLoader; onSeen: () => void; onClose: () => void }) {
  const [resting, setResting] = useState(false)
  const [touched, setTouched] = useState(false)
  const [full, setFull] = useState<string | null>(null)
  const title = localized(notice.title, notice.titleEn, locale)
  const text = localized(notice.text, notice.textEn, locale)
  useToastTimer(onClose, resting || touched || full !== null)
  useEffect(() => {
    onSeen()
    if (!hasNotification(title, text)) addNotification({ title, text })
    // Once, when it comes: the words are kept as they were shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice.id])
  return <div className="restock-toast notice-toast" role="status" aria-live="polite"
    onPointerEnter={(event) => { if (event.pointerType === 'mouse') setResting(true) }}
    onPointerLeave={(event) => { if (event.pointerType === 'mouse') setResting(false) }}
    onPointerDown={(event) => { if (event.pointerType !== 'mouse') setTouched(true) }}>
    <Megaphone size={16} aria-hidden="true" />
    <div className="notice-toast-body">
      <strong lang={title === notice.titleEn ? 'en' : undefined}>{title}</strong>
      {text && <p lang={text === notice.textEn ? 'en' : undefined}>{text}</p>}
      {notice.images > 0 && <NoticeGallery id={notice.id} count={notice.images} load={loadImage} onOpen={setFull} />}
      {notice.button && <a className="button small notice-toast-link" href={notice.button.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" />{localized(notice.button.text, notice.button.textEn, locale)}</a>}
    </div>
    <button type="button" className="icon-button" aria-label={uiLabel('Закрыть')} title={uiLabel('Закрыть')} onClick={onClose}><X size={14} aria-hidden="true" /></button>
    {full && createPortal(<div className="notice-photo-full" role="dialog" aria-modal="true" aria-label={uiLabel('Фото')} onClick={() => setFull(null)}>
      <img src={full} alt="" />
      <button type="button" className="icon-button notice-photo-close" aria-label={uiLabel('Закрыть фото')} onClick={() => setFull(null)}><X size={18} /></button>
    </div>, document.body)}
  </div>
}
