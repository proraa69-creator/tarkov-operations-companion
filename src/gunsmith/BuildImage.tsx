import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'

/**
 * The finished build (owner, 11.10.2026: «картинка с готовой сборкой оружия»): the game's «Сборки оружия» screen from the
 * task's guide, as wide as the block; a click opens it full screen (closed by a click or Escape).
 */
export function BuildImage({ src, alt }: { src: string; alt: string }) {
  const { locale } = useLocale()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const zoom = locale === 'en' ? 'Open the build full screen' : 'Открыть сборку на весь экран'
  return <>
    <button type="button" className="gs-build-image" onClick={() => setOpen(true)} title={zoom} aria-label={zoom}>
      <img src={src} alt={alt} loading="lazy" />
    </button>
    {open && createPortal(<div className="gs-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}>
      <img src={src} alt={alt} />
      <button type="button" className="gs-lightbox-close" aria-label={locale === 'en' ? 'Close' : 'Закрыть'} onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button>
    </div>, document.body)}
  </>
}
