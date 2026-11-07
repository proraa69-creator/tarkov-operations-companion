import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../styles/app-tooltips.css'

const SHOW_AFTER_MS = 300
const GAP = 8
const EDGE = 8

interface Tip { text: string; box: DOMRect }

/**
 * Every small window on hover in the app's own style (owner, 05.11.2026: «все окошки вот такие маленькие, они должны быть не
 * белые, а в стиле нашего приложения. И более аккуратные»). The hundreds of `title` attributes stay as they are in the pages:
 * while the mouse is on an element its `title` is taken off, so the browser's white window never opens, and it is put back
 * when the mouse leaves, so the page's own text and a screen reader's name stay right. Only the mouse: a phone has no hover.
 */
export function AppTooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const window_ = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: { element: Element; text: string } | null = null
    const hide = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      setTip(null)
      setPlace(null)
    }
    const release = () => {
      hide()
      // A text the page wrote meanwhile stands: only what was taken goes back.
      if (current && !current.element.hasAttribute('title')) current.element.setAttribute('title', current.text)
      current = null
    }
    const over = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return
      const target = event.target instanceof Element ? event.target : null
      const element = target?.closest('[title]') ?? null
      // Still inside the element whose title is taken: `closest` finds it no more, and nothing has changed.
      if (current && target && current.element.contains(target) && (!element || element === current.element)) return
      release()
      const text = element?.getAttribute('title')
      if (!element || !text) return
      element.removeAttribute('title')
      current = { element, text }
      timer = setTimeout(() => {
        if (current?.element.isConnected) setTip({ text, box: current.element.getBoundingClientRect() })
      }, SHOW_AFTER_MS)
    }
    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    document.documentElement.addEventListener('pointerleave', release)
    window.addEventListener('blur', release)
    return () => {
      release()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true)
      document.documentElement.removeEventListener('pointerleave', release)
      window.removeEventListener('blur', release)
    }
  }, [])

  // Above the element, under it when there is no room, always inside the window.
  useLayoutEffect(() => {
    const element = window_.current
    if (!tip || !element) return
    const { width, height } = element.getBoundingClientRect()
    const above = tip.box.top - height - GAP
    const top = above >= EDGE ? above : Math.min(tip.box.bottom + GAP, window.innerHeight - height - EDGE)
    const left = Math.min(Math.max(EDGE, tip.box.left + tip.box.width / 2 - width / 2), Math.max(EDGE, window.innerWidth - width - EDGE))
    setPlace({ left, top })
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div ref={window_} className="app-tooltip" role="tooltip" style={place ?? { left: 0, top: 0, visibility: 'hidden' }}>{tip.text}</div>,
    document.body,
  )
}
