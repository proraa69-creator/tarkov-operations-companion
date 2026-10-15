import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import '../styles/imageViewer.css'

let openViewers = 0

/** An ImageViewer is open (its Escape closes only it). */
// eslint-disable-next-line react-refresh/only-export-components -- a tiny query of the viewer's own state
export function imageViewerOpen() {
  return openViewers > 0
}

/**
 * Images full size: a report's in the owner's «Заявки» (owner, 14.10.2026: «еще добавь возможность открывать скриншоты
 * которые люди присылают», src/pages/RequestsPage.tsx) and the support chat's screenshots (owner, 15.10.2026,
 * src/support/SupportChat.tsx): over the whole app, each fitted to the window. ←/→ and the side buttons go through several; Esc, «×» or a click
 * outside the image closes it. Like the other dialogs, the focus moves in (to «×»), stays there (Tab goes round the
 * viewer's buttons) and goes back to the thumbnail afterwards. The images are the data URLs the routes answered (GET
 * …/bug-reports/:id/files/:idx/data, …/support/attachments/:id): nothing is put at an address anybody else could open.
 * While it is open, `imageViewerOpen()` is true: a dialog under it leaves Escape to it.
 */
export function ImageViewer({ images, index, onIndex, onClose }: { images: string[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const count = images.length
  const viewer = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const latest = useRef({ index, count, onIndex, onClose })
  useLayoutEffect(() => { latest.current = { index, count, onIndex, onClose } })
  useEffect(() => {
    openViewers += 1
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    // Captured on the window: Escape and the arrows belong to the viewer while it is open.
    const onKey = (event: KeyboardEvent) => {
      const { index, count, onIndex, onClose } = latest.current
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && count > 1) {
        event.preventDefault()
        onIndex((index + (event.key === 'ArrowRight' ? 1 : count - 1)) % count)
        return
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(viewer.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      if (!buttons.length) return
      event.preventDefault()
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = at < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (at + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length
      buttons[next]?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      openViewers -= 1
      window.removeEventListener('keydown', onKey, true)
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  const label = `${uiText('Изображение')} ${index + 1} ${uiText('из')} ${count}`
  const step = (delta: number) => onIndex((index + delta + count) % count)
  return createPortal(
    <div ref={viewer} className="requests-viewer" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <img src={images[index]} alt={label} />
      <button ref={closeButton} type="button" className="requests-viewer-close" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={18} /></button>
      {count > 1 && <>
        <button type="button" className="requests-viewer-step is-prev" onClick={() => step(-1)} aria-label={uiText('Предыдущее изображение')} title={uiText('Предыдущее изображение')}><ChevronLeft size={24} /></button>
        <button type="button" className="requests-viewer-step is-next" onClick={() => step(1)} aria-label={uiText('Следующее изображение')} title={uiText('Следующее изображение')}><ChevronRight size={24} /></button>
        <span className="requests-viewer-count" aria-hidden="true">{index + 1} / {count}</span>
      </>}
    </div>,
    document.body,
  )
}
