import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** A short pause before a hover shows the list: a pointer passing over the example shows nothing. */
const SHOW_DELAY_MS = 90
/** The pointer may cross the gap into the list (to scroll it) before the list goes. */
const HIDE_GRACE_MS = 220
/** A focus or a click this soon after a press came from that press, not from the keyboard. */
const PRESS_MS = 800
const GAP = 6
const EDGE = 10
/** The list keeps at least this height even where the window has less room on both sides. */
const MIN_HEIGHT = 140

/** The class of the list in <body>: a press inside it is not «outside» for the card that unfolds (QuestConditionsCard). */
export const CHOICE_POPUP_CLASS = 'qc-variants'

/**
 * The list of every variant of a choice in «Сбор на рейд» (owner, 16.10.2026: «при наведении курсора на один из
 * вариантов, появляется всплывающее окно со всеми допустимыми. так же с оружием, прицелами и модулями»). The block and
 * the dialog still show one example and «или любое из N» (`more`); pointing at them shows `content` beside them.
 *
 * The list is drawn into <body> with a fixed position, so neither the unfolded card (it scrolls) nor the dialog clips
 * it; it stays inside the window (below the example, or above it when there is more room there) and scrolls when it is
 * long. It goes when the pointer leaves (after a short grace, so the pointer can reach the list), on Escape, on a press
 * elsewhere, on a scroll of the page and when the focus leaves.
 *
 * `toggle` (the dialog): «или любое из N» is a button — the keyboard's way in, and a tap on it shows or hides the list.
 * Without it (inside the card, itself a button) a tap on the example shows the list instead of opening the dialog.
 */
export function ChoicePopover({ as = 'span', className, more, heading, toggle, content, children }: {
  as?: 'span' | 'div'
  className?: string
  /** «или любое из N», translated. */
  more: string
  /** The list's heading («Подходит любое из N»), translated. */
  heading: string
  toggle?: boolean
  content: ReactNode
  children: ReactNode
}) {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const showTimer = useRef<number | undefined>(undefined)
  const hideTimer = useRef<number | undefined>(undefined)
  const press = useRef<{ type: string; at: number } | undefined>(undefined)
  const popupRef = useRef<HTMLDivElement>(null)

  const stopTimers = () => { window.clearTimeout(showTimer.current); window.clearTimeout(hideTimer.current) }
  const show = (delay = 0) => {
    stopTimers()
    if (delay) showTimer.current = window.setTimeout(() => setOpen(true), delay)
    else setOpen(true)
  }
  const hide = (delay = 0) => {
    stopTimers()
    if (delay) hideTimer.current = window.setTimeout(() => setOpen(false), delay)
    else setOpen(false)
  }
  const recentPress = () => press.current && Date.now() - press.current.at < PRESS_MS ? press.current.type : undefined

  useEffect(() => () => {
    window.clearTimeout(showTimer.current)
    window.clearTimeout(hideTimer.current)
  }, [])
  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null) => target instanceof Node && Boolean(anchor?.contains(target) || popupRef.current?.contains(target))
    const close = () => {
      window.clearTimeout(showTimer.current)
      window.clearTimeout(hideTimer.current)
      setOpen(false)
    }
    // Escape closes the list first; the card or the dialog under it stays.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    const onDown = (event: PointerEvent) => { if (!inside(event.target)) close() }
    // A fixed list would stay behind a scrolled example; its own scroll is not one.
    const onScroll = (event: Event) => { if (!inside(event.target)) close() }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, anchor])

  const events: HTMLAttributes<HTMLElement> = {
    // The list is a child of this element in React's tree: moving into it is no leave.
    onPointerEnter: (event: ReactPointerEvent) => { if (event.pointerType === 'mouse') show(open ? 0 : SHOW_DELAY_MS) },
    onPointerLeave: (event: ReactPointerEvent) => { if (event.pointerType === 'mouse') hide(HIDE_GRACE_MS) },
    onPointerDown: (event: ReactPointerEvent) => { press.current = { type: event.pointerType, at: Date.now() } },
    onFocus: () => { if (!recentPress()) show() },
    onBlur: (event: ReactFocusEvent) => {
      const next = event.relatedTarget
      if (next instanceof Node && (anchor?.contains(next) || popupRef.current?.contains(next))) return
      hide()
    },
    onClick: (event: ReactMouseEvent) => {
      const type = recentPress()
      press.current = undefined
      if (toggle) {
        if (!(event.target instanceof Element && event.target.closest('.qc-choice-toggle'))) return
        // A mouse has shown it by hovering; a tap or the keyboard shows or hides it.
        if (type === 'mouse') show()
        else if (open) hide()
        else show()
        return
      }
      if (type === 'touch' || type === 'pen') {
        // Inside the card: the tap shows the list, the card's dialog stays closed.
        event.preventDefault()
        event.stopPropagation()
        if (open) hide()
        else show()
        return
      }
      // A mouse click opens the card's dialog; the list goes.
      hide()
    },
  }
  const moreNode = toggle
    ? <button type="button" className="qc-more qc-choice-more qc-choice-toggle" aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}>{more}</button>
    : <span className="qc-more qc-choice-more">{more}</span>
  const body = <>
    {children}
    {moreNode}
    {open && anchor && <ChoicePopup id={id} anchor={anchor} heading={heading} popupRef={popupRef}>{content}</ChoicePopup>}
  </>
  const classes = `qc-choice${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`
  // Without the button, the example itself is described by the list while it is shown.
  const described = !toggle && open ? id : undefined
  return as === 'div'
    ? <div ref={setAnchor} className={classes} aria-describedby={described} {...events}>{body}</div>
    : <span ref={setAnchor} className={classes} aria-describedby={described} {...events}>{body}</span>
}

/** The list itself in <body>, placed beside `anchor` within the window. */
function ChoicePopup({ id, anchor, heading, popupRef, children }: {
  id: string
  anchor: HTMLElement
  heading: string
  popupRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  useLayoutEffect(() => {
    const popup = popupRef.current
    if (!popup) return
    const box = anchor.getBoundingClientRect()
    const width = popup.offsetWidth
    const natural = popup.offsetHeight
    const below = window.innerHeight - box.bottom - GAP - EDGE
    const above = box.top - GAP - EDGE
    const downward = natural <= below || below >= above
    const height = Math.min(natural, Math.max(MIN_HEIGHT, downward ? below : above), window.innerHeight - 2 * EDGE)
    const top = downward ? Math.min(box.bottom + GAP, window.innerHeight - EDGE - height) : box.top - GAP - height
    const left = Math.min(box.left, window.innerWidth - width - EDGE)
    setPlace({ left: Math.max(EDGE, left), top: Math.max(EDGE, top), maxHeight: height })
  }, [anchor, popupRef])
  // Nothing inside the list reaches the card under it: a click on it does not open the dialog.
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  return createPortal(
    <div ref={popupRef} id={id} role="tooltip" className={`${CHOICE_POPUP_CLASS}${place ? ' is-placed' : ''}`}
      style={place ? { left: place.left, top: place.top, maxHeight: place.maxHeight } : { left: -9999, top: 0 }}
      onClick={stop} onPointerDown={stop} onMouseDown={stop}>
      <div className="qc-variants-title">{heading}</div>
      {children}
    </div>,
    document.body,
  )
}
