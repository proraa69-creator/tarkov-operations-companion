import { useEffect, type CSSProperties } from 'react'

/** True when the visitor asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const RIPPLE_SELECTOR = '.button.primary, .button.ripple, .ctrl-button'

/**
 * Click ripple for primary buttons (and anything with `.ripple`). One delegated pointerdown listener for the
 * whole document, so buttons rendered anywhere (including pages this file does not know about) get it.
 */
export function useRipple() {
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || prefersReducedMotion()) return
      const target = (event.target as Element | null)?.closest<HTMLElement>(RIPPLE_SELECTOR)
      if (!target || target.matches(':disabled, [aria-disabled="true"]')) return
      const rect = target.getBoundingClientRect()
      const size = Math.hypot(rect.width, rect.height) * 2
      const ripple = document.createElement('span')
      ripple.className = 'ripple-wave'
      ripple.setAttribute('aria-hidden', 'true')
      ripple.style.width = ripple.style.height = `${size}px`
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`
      target.appendChild(ripple)
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
      window.setTimeout(() => ripple.remove(), 1200)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])
}

/** Inline style for `.stagger` elements: the index drives the entrance delay. */
export function stagger(index: number): CSSProperties {
  return { '--i': index } as CSSProperties
}
