import { useEffect, useRef } from 'react'
import { canAnimate, easeOut } from '../shared/motion'

/**
 * A number that counts up to its value when it appears and slides to a new value when it changes (owner, 12.10.2026:
 * «сделай нам так же плавно все приложение» — the numbers of the reference video). The text is updated on the element,
 * frame by frame, without re-rendering; every render already holds the final value, so tests, screen readers and
 * reduced motion get the real number. `format` must be stable (a module-level function).
 */
export function CountUp({ value, format = String, className }: { value: number; format?: (value: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)

  useEffect(() => {
    const element = ref.current
    const from = shown.current ?? 0
    shown.current = value
    if (!element || from === value || !Number.isFinite(value) || !canAnimate()) return
    // Appearing: 650 ms from zero; a change: 420 ms from the number on screen.
    const duration = from === 0 ? 650 : 420
    const start = performance.now()
    let current = from
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      current = Math.round(from + (value - from) * easeOut(progress))
      element.textContent = format(current)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    element.textContent = format(from)
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      // Interrupted (a new value, or React's double run in development): the next run starts from what is on screen.
      if (current !== value) shown.current = current
      element.textContent = format(value)
    }
  }, [value, format])

  return <span ref={ref} className={`count-up${className ? ` ${className}` : ''}`}>{format(value)}</span>
}
