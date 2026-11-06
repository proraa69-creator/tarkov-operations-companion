import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CircleHelp } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { HoverCardPopup } from './HoverCard'
import { SETTING_HELP, type SettingHelpId } from './settingHelpTexts'
import '../styles/settingHelp.css'

/**
 * A small circle with a question mark beside a setting (owner, 06.11.2026, on a player's proposal, №76: «у каждой настройки
 * кружочек с вопросиком маленький. Туда наводишь мышь, и появляется окно помощник, которое рассказывает, для чего эта
 * функция»). The mouse shows it while it is on the circle and the keyboard while the circle has the focus; a phone has no
 * mouse, so a tap opens it and a second tap, or one anywhere else, closes it. It is drawn into <body> and kept inside the
 * window (components/HoverCard.tsx). No `title` here: that would open the app's other small window too (app/AppTooltips.tsx).
 */
export function SettingHelp({ id }: { id: SettingHelpId }) {
  const { locale } = useLocale()
  const cardId = useId()
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  // What pressed it last: a mouse has already opened it by hovering, a finger opens it with the click that follows.
  const pointer = useRef('')
  // jsdom has no PointerEvent: a missing pointerType counts as the mouse, as in app/AppTooltips.tsx.
  const isMouse = (event: ReactPointerEvent) => !event.pointerType || event.pointerType === 'mouse'

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const onPress = (event: PointerEvent) => { if (!button?.contains(event.target as Node)) close() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    document.addEventListener('pointerdown', onPress, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      document.removeEventListener('pointerdown', onPress, true)
    }
  }, [open, button])

  return (
    <>
      <button
        ref={setButton}
        type="button"
        className={`setting-help${open ? ' is-open' : ''}`}
        aria-label={locale === 'en' ? 'What is this?' : 'Что это?'}
        aria-describedby={open ? cardId : undefined}
        onPointerEnter={(event) => { if (isMouse(event)) setOpen(true) }}
        onPointerLeave={(event) => { if (isMouse(event)) setOpen(false) }}
        onPointerDown={(event) => { pointer.current = event.pointerType || 'mouse' }}
        onFocus={() => { if (!pointer.current) setOpen(true) }}
        onBlur={() => { pointer.current = ''; setOpen(false) }}
        onClick={() => { if (pointer.current !== 'mouse') setOpen((value) => !value) }}
      >
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      {open && button && <HoverCardPopup id={cardId} anchor={button}>{SETTING_HELP[id][locale]}</HoverCardPopup>}
    </>
  )
}
