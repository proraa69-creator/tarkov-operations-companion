import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ChevronDown, MapPin, MapPinOff } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { keyDoorHref, keyDoorKindLabel, type KeyDoor } from '../data/keyDoors'
import { useHoverCard } from './useHoverCard'
import '../styles/keyDoors.css'

/** The pointer may cross the gap between the button and the list (or leave for a moment) without the list closing. */
export const KEY_DOORS_CLOSE_DELAY_MS = 220
const GAP = 6
const EDGE = 10
/** Mouse events a browser makes up after a touch are not a mouse. */
const TOUCH_MOUSE_GAP_MS = 800

function severalDoorsLabel(count: number, locale: AppLocale) {
  return locale === 'en' ? `${count} doors` : `Несколько дверей · ${count}`
}

/** The wiki's name of the place in the language shown, else the kind and its number: «Подвалы (выход)», «Дверь 2». */
function keyDoorLabel(door: KeyDoor, locale: AppLocale) {
  if (door.name) return locale === 'en' ? door.name.en : door.name.ru
  // uiLabel: «Дверь» is also a catalog name, which uiText would prefer («The Door»).
  return `${uiLabel(keyDoorKindLabel(door))}${door.number ? ` ${door.number}` : ''}`
}

/** «Таможня · 2 этаж · Дверь 2» — the map, the floor when it is not the main level, the place (or the kind and its number). */
function keyDoorRowText(door: KeyDoor, locale: AppLocale) {
  return { map: uiText(door.mapName), floor: door.rawFloor ? uiText(door.floor) : '', kind: keyDoorLabel(door, locale) }
}

/**
 * «Показать дверь на карте» for a key or keycard (owner, 15.10.2026): one door is a link to the map focused on it; several
 * doors are a button that only opens their list (hover with a mouse, tap on a touch screen) and each row of the list opens
 * the map on that door; no known door is a disabled button that says so.
 */
export function KeyDoorsButton({ keyName, doors, variant = 'row' }: { keyName: string; doors: KeyDoor[] | undefined; variant?: 'row' | 'detail' }) {
  const { locale } = useLocale()
  if (!doors?.length) return <NoDoorButton variant={variant} />
  if (doors.length === 1) return <OneDoorButton keyName={keyName} door={doors[0]!} variant={variant} />
  return <SeveralDoorsButton keyName={keyName} doors={doors} variant={variant} label={severalDoorsLabel(doors.length, locale)} />
}

function NoDoorButton({ variant }: { variant: 'row' | 'detail' }) {
  const hint = uiText('Дверь не отмечена на карте')
  // A disabled button gets no mouse events: the hover card hangs on its wrapper.
  const { anchorProps, card } = useHoverCard(variant === 'row' ? hint : null)
  if (variant === 'detail') return <button type="button" className="button ghost key-doors-button is-empty" disabled><MapPinOff size={15} /> {hint}</button>
  return <span className="key-doors-slot" {...anchorProps}><button type="button" className="icon-button key-doors-button is-empty" disabled aria-label={hint}><MapPinOff size={14} /></button>{card}</span>
}

function OneDoorButton({ keyName, door, variant }: { keyName: string; door: KeyDoor; variant: 'row' | 'detail' }) {
  const { locale } = useLocale()
  const where = [uiText(door.mapName), door.rawFloor ? uiText(door.floor) : '', door.name ? keyDoorLabel(door, locale) : ''].filter(Boolean).join(' · ')
  const label = `${uiText('Показать дверь на карте')} · ${where}`
  const { anchorProps, card } = useHoverCard(variant === 'row' ? label : null)
  if (variant === 'detail') return <Link className="button ghost key-doors-button" to={keyDoorHref(door)}><MapPin size={15} /> {uiText('Показать дверь на карте')} <small className="dim">{where}</small></Link>
  return <><Link className="icon-button key-doors-button" to={keyDoorHref(door)} aria-label={`${label} · ${keyName}`} {...anchorProps}><MapPin size={14} /></Link>{card}</>
}

function SeveralDoorsButton({ keyName, doors, variant, label }: { keyName: string; doors: KeyDoor[]; variant: 'row' | 'detail'; label: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const touchAt = useRef(0)

  const cancelClose = useCallback(() => window.clearTimeout(closeTimer.current), [])
  const show = useCallback(() => { cancelClose(); setOpen(true) }, [cancelClose])
  const close = useCallback(() => { cancelClose(); setOpen(false) }, [cancelClose])
  const closeSoon = useCallback(() => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), KEY_DOORS_CLOSE_DELAY_MS)
  }, [cancelClose])
  const isTouch = () => Date.now() - touchAt.current < TOUCH_MOUSE_GAP_MS
  const onMouseEnter = () => { if (!isTouch()) show() }
  const onMouseLeave = () => { if (!isTouch()) closeSoon() }
  const markTouch = () => { touchAt.current = Date.now() }
  // The button itself goes nowhere: a tap (or Enter / Space) toggles the list, a mouse click only keeps it open.
  const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (isTouch() || event.detail === 0) setOpen((value) => !value)
    else show()
  }

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (target && (anchor?.contains(target) || popupRef.current?.contains(target))) return
      close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      anchor?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('touchstart', onPointerDown, true)
    document.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('touchstart', onPointerDown, true)
      document.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [open, close, anchor])

  return <>
    <button
      ref={setAnchor}
      type="button"
      className={`${variant === 'detail' ? 'button ghost' : 'key-doors-chip'} key-doors-button is-several${open ? ' is-open' : ''}`}
      aria-haspopup="true"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      aria-label={`${label} · ${keyName}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={markTouch}
      onPointerDown={(event) => { if (event.pointerType === 'touch' || event.pointerType === 'pen') markTouch() }}
      onClick={onClick}
    >
      <MapPin size={variant === 'detail' ? 15 : 13} /><span>{label}</span><ChevronDown size={12} className="key-doors-caret" />
    </button>
    {open && anchor && <KeyDoorsPopup
      id={id}
      popupRef={popupRef}
      anchor={anchor}
      keyName={keyName}
      doors={doors}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPick={close}
    />}
  </>
}

function KeyDoorsPopup({ id, popupRef, anchor, keyName, doors, onMouseEnter, onMouseLeave, onPick }: {
  id: string
  popupRef: RefObject<HTMLDivElement | null>
  anchor: HTMLElement
  keyName: string
  doors: KeyDoor[]
  onMouseEnter: () => void
  onMouseLeave: () => void
  onPick: () => void
}) {
  const { locale } = useLocale()
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null)
  useLayoutEffect(() => {
    const card = popupRef.current
    if (!card) return
    const box = anchor.getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight
    // Right-aligned with the button (the row's action column is at the right edge), kept inside the window.
    const left = Math.min(Math.max(EDGE, box.right - width), window.innerWidth - width - EDGE)
    const below = box.bottom + GAP
    const above = below + height + EDGE > window.innerHeight && box.top - GAP - height >= EDGE
    setPlace({ left, top: above ? box.top - GAP - height : below, above })
  }, [anchor, popupRef])
  return createPortal(
    <div
      ref={popupRef}
      id={id}
      role="menu"
      aria-label={keyName}
      className={`key-doors-popup${place ? ' is-placed' : ''}${place?.above ? ' is-above' : ''}`}
      style={place ? { left: place.left, top: place.top } : { left: -9999, top: -9999 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="key-doors-popup-title">{uiText('Открывает')}</div>
      <div className="key-doors-popup-key">{uiText(keyName)}</div>
      <ul className="key-doors-list">
        {doors.map((door) => {
          const text = keyDoorRowText(door, locale)
          return <li key={door.markerId}>
            <Link role="menuitem" to={keyDoorHref(door)} onClick={onPick} className="key-doors-row" title={door.hint ? (locale === 'en' ? door.hint.en : door.hint.ru) : undefined}>
              <MapPin size={13} />
              <span className="key-doors-row-copy">
                <strong>{text.map}</strong>
                <small>{[text.kind, text.floor, door.needsPower ? uiText('нужно питание') : ''].filter(Boolean).join(' · ')}</small>
                {door.hint && <small className="key-doors-row-hint">{locale === 'en' ? door.hint.en : door.hint.ru}</small>}
              </span>
            </Link>
          </li>
        })}
      </ul>
    </div>,
    document.body,
  )
}
