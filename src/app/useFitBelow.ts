import { useLayoutEffect, type RefObject } from 'react'

/**
 * A column that ends at the bottom of the window on the PC (owner, 03.11.2026: «что бы влезали в размер окна экрана и не
 * должны листаться вверх или низ, если только много информации»): `--fit-below` on the element (and so on its children)
 * is the room left under its top edge, less the page's own bottom padding. A page whose columns fit never scrolls; what
 * does not fit scrolls inside the column. The top follows the page while it scrolls, until a sticky column sticks under
 * the top bar (as «Сборка оружия» does for its right column, WeaponBuildsPage useSideFit).
 */
export function useFitBelow(ref: RefObject<HTMLElement | null>, enabled = true) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    const content = element.closest('.content')
    let frame = 0
    let last = ''
    const update = () => {
      frame = 0
      const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) || 0
      const bottom = content ? parseFloat(getComputedStyle(content).paddingBottom) || 0 : 0
      const top = Math.max(element.getBoundingClientRect().top, topbar + 12)
      const room = `${Math.max(320, Math.floor(window.innerHeight - top - bottom))}px`
      if (room === last) return
      last = room
      element.style.setProperty('--fit-below', room)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    // A notice above the page or a column that changes height moves the top edge without a scroll or a resize.
    const observer = typeof ResizeObserver === 'undefined' || !content ? null : new ResizeObserver(schedule)
    if (observer && content) observer.observe(content)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
      element.style.removeProperty('--fit-below')
    }
  }, [ref, enabled])
}
