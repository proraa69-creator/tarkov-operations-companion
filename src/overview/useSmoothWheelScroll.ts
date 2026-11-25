import { useEffect, type RefObject } from 'react'

/** How much of the remaining distance the list covers each frame: a soft glide that still arrives quickly. */
const EASE = 0.22
/** A pixel-delta wheel smaller than this is a touchpad's own smooth scroll — left as it is. */
const TOUCHPAD_PX = 50

/**
 * The mouse wheel scrolls a list smoothly instead of in hard ~100 px jumps (owner, 25.11.2026: «плавный scroll, не
 * поквестовые скачки» — a notch used to leap past a whole task, as the rows are tall). Each notch nudges a target and
 * the list eases towards it over a few frames, so the direction reads and nothing lurches. At the very top or bottom
 * the wheel is left alone, so the page scrolls on past the list. A touchpad (small pixel deltas) already glides and a
 * coarse pointer (the phone) is left untouched; only a line/page or large-step wheel is smoothed.
 */
export function useSmoothWheelScroll(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el || typeof window === 'undefined') return
    // a coarse pointer (the phone) or a reader who turned animation off keeps the native scroll
    if (window.matchMedia?.('(pointer: coarse)')?.matches) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    let target = el.scrollTop
    let raf = 0
    const ease = () => {
      const diff = target - el.scrollTop
      if (Math.abs(diff) < 0.5) { el.scrollTop = target; raf = 0; return }
      el.scrollTop += diff * EASE
      raf = requestAnimationFrame(ease)
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const max = el.scrollHeight - el.clientHeight
      if (max <= 0) return
      // a touchpad's own smooth pixel scroll is left as it is
      if (event.deltaMode === 0 && Math.abs(event.deltaY) < TOUCHPAD_PX) return
      if (!raf) target = el.scrollTop // re-sync when idle: the scrollbar or a jump may have moved it
      const step = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1)
      const next = Math.max(0, Math.min(max, target + step))
      // at an end, let the wheel fall through so the page scrolls
      if (next === target) return
      event.preventDefault()
      target = next
      if (!raf) raf = requestAnimationFrame(ease)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel); if (raf) cancelAnimationFrame(raf) }
  }, [enabled, ref])
}
