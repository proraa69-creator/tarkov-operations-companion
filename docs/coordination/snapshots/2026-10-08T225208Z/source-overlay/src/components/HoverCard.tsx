import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../styles/hoverCard.css'

const GAP = 8
const EDGE = 10

/** The card itself, drawn into <body> next to `anchor`: below it, or above when there is no room (useHoverCard). */
export function HoverCardPopup({ id, anchor, children }: { id: string; anchor: HTMLElement; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const card = ref.current
    if (!card) return
    const box = anchor.getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight
    const left = Math.min(Math.max(EDGE, box.left), window.innerWidth - width - EDGE)
    const below = box.bottom + GAP
    const top = below + height + EDGE <= window.innerHeight ? below : Math.max(EDGE, box.top - GAP - height)
    setPlace({ left, top })
  }, [anchor])
  return createPortal(
    <div ref={ref} id={id} role="tooltip" className={`hover-card${place ? ' is-placed' : ''}`} style={place ?? { left: -9999, top: -9999 }}>
      {children}
    </div>,
    document.body,
  )
}
