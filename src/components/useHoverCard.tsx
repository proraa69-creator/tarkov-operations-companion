import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { HoverCardPopup } from './HoverCard'

const SHOW_DELAY_MS = 120

/**
 * The app's hover card, instead of the browser's plain `title` tooltip: shown on hover and keyboard focus, styled like
 * the app's panels, drawn into <body> so no parent clips it, kept inside the window (below the anchor, or above when
 * there is no room). Spread `anchorProps` on the element it explains and render `card` anywhere next to it.
 */
export function useHoverCard(content: ReactNode | null | undefined) {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)

  const show = useCallback((event: { currentTarget: EventTarget }) => {
    setAnchor(event.currentTarget as HTMLElement)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS)
  }, [])
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', hide, true) }
  }, [open, hide])

  if (!content) return { anchorProps: {}, card: null }
  return {
    anchorProps: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide, 'aria-describedby': open ? id : undefined },
    card: open && anchor ? <HoverCardPopup id={id} anchor={anchor}>{content}</HoverCardPopup> : null,
  }
}

