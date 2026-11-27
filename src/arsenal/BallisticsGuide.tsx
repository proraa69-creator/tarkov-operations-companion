import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import { BALLISTICS_GUIDE_POINTS, BALLISTICS_GUIDE_TITLE, guidePointParts } from './ballisticsGuidePoints'
import './arsenal.css'

/** The window: a title, the cross, Escape or a click beside it closes it; it scrolls when the points do not fit. */
function BallisticsGuideDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    dialog.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="registration-overlay ballistics-guide-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialog} tabIndex={-1} className="panel registration-dialog ballistics-guide-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <h2 id={titleId} className="ballistics-guide-title"><Info size={18} aria-hidden="true" />{uiLabel(BALLISTICS_GUIDE_TITLE)}</h2>
        <ul className="ballistics-guide-list">
          {BALLISTICS_GUIDE_POINTS.map((point) => {
            const { lead, rest } = guidePointParts(uiText(point.text))
            return (
              <li key={point.text}>
                {lead && <><strong>{lead}</strong>{' — '}</>}{rest}
                {point.items && <ul className="ballistics-guide-sublist">{point.items.map((item) => <li key={item}>{uiText(item)}</li>)}</ul>}
                {point.after && <span className="ballistics-guide-after">{uiText(point.after)}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    </div>,
    document.body,
  )
}

/**
 * «Как работает баллистика» beside the tabs of «Баллистика», on every tab, «Полигон» too (owner, 28.11.2026: «перенести на страницу
 * полигон и справа от вот этих переключателей… Сделай кнопку отдельно информация о баллистике»). It took the place of the folded
 * «Как работает пробитие» over the tables (report 226).
 */
export function BallisticsGuideButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const name = uiLabel(BALLISTICS_GUIDE_TITLE)
  return <>
    <button type="button" className="button small ghost ballistics-guide-button" title={name} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Info size={14} aria-hidden="true" />
      <span>{name}</span>
    </button>
    {open && <BallisticsGuideDialog onClose={close} />}
  </>
}
