import { useLayoutEffect, useState, type RefObject } from 'react'

/** At least so many tasks' height, wherever the blocks stand. */
const MIN_HEIGHT = 190
/** Not worth another layout. */
const CLOSE_ENOUGH = 1

/**
 * The height of the «Текущие задания» list that brings «Рынок» level with «Требования рейда» across the two columns (owner, 07.11.2026:
 * «отображай их столько, чтобы блок «Рынок» был вровень с требованиями рейда»). Nothing to line up (blocks moved so that «Рынок» stands
 * above the list): null, and the stylesheet's height stands. It waits while the blocks are being carried: they are not in their places.
 */
export function useAlignedListHeight(list: RefObject<HTMLElement | null>, on: boolean, key: string) {
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!on) return
    const node = list.current
    const columns = node?.closest('.dashboard-layout, .overview-free')
    if (!node || !columns || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const measure = () => {
      frame = 0
      if (node.closest('.overview-editing')) return
      const market = columns.querySelector('[data-block="favorites"]')
      const needs = columns.querySelector('[data-block="requirements"]')
      // the free Overview (owner, 20.11.2026): only while «Рынок» stands under the list and «Требования рейда» beside it
      const own = (node.closest('[data-block]') ?? node).getBoundingClientRect()
      const marketBox = market?.getBoundingClientRect()
      const needsBox = needs?.getBoundingClientRect()
      const below = marketBox && marketBox.top >= own.bottom - 1 && marketBox.left < own.right && own.left < marketBox.right
      const beside = needsBox && (needsBox.right <= own.left + 1 || needsBox.left >= own.right - 1)
      if (!market || !needs || !below || !beside) { setHeight(null); return }
      const now = node.getBoundingClientRect().height
      const wanted = now + needs.getBoundingClientRect().top - market.getBoundingClientRect().top
      const next = Math.round(Math.min(node.scrollHeight, Math.max(MIN_HEIGHT, wanted)))
      setHeight((current) => (current !== null && Math.abs(current - next) <= CLOSE_ENOUGH ? current : next))
    }
    const later = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(later)
    observer.observe(columns)
    for (const block of columns.querySelectorAll('[data-block]')) observer.observe(block)
    measure()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [key, list, on])
  return on ? height : null
}
