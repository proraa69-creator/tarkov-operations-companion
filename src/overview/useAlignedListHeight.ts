import { useLayoutEffect, useState, type RefObject } from 'react'

/** At least so many tasks' height, wherever the blocks stand. */
const MIN_HEIGHT = 190
/** Not worth another layout. */
const CLOSE_ENOUGH = 1
/**
 * A measure waits this long after the last size change: the Overview lays its blocks for a new height a frame or two later, and a
 * measure before that reads «Рынок» where it stood for the old height (too low after the list grew, too high after it shrank).
 */
const SETTLE_MS = 120
/** Tries more while «Рынок» still overlaps the list's block. */
const SETTLE_TRIES = 12

/**
 * An element's box in the page as laid out: a block gliding to its new place (a transform, src/overview/useOverviewEditor.ts) is
 * taken where it stands, not where it is drawn mid-glide.
 */
function laidBox(element: HTMLElement) {
  let top = 0
  let left = 0
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop
    left += node.offsetLeft
  }
  return { top, left, bottom: top + element.offsetHeight, right: left + element.offsetWidth }
}

/**
 * The height of the «Текущие задания» list that brings «Рынок» level with «Требования рейда» across the two columns (owner, 07.11.2026:
 * «отображай их столько, чтобы блок «Рынок» был вровень с требованиями рейда»). Nothing to line up (blocks moved so that «Рынок» stands
 * above the list): null, and the stylesheet's height stands. It waits while the blocks are being carried: they are not in their places.
 *
 * Report 211 (and 208, «Баг вернулся» on 0.6.0.332): with a tall left column the list grew, the Overview moved «Оружейник» and «Рынок»
 * down a frame later and glided them there, and a measure in between saw «Рынок» inside the grown list's block (or mid-glide) and gave
 * the list up — it shrank, the blocks moved back, it grew again, round and round, «Оружейник» drawn over the tasks. The boxes are taken
 * as laid out now, and a «Рынок» still inside the list's block is a layout not caught up yet: the measure waits for it.
 */
export function useAlignedListHeight(list: RefObject<HTMLElement | null>, on: boolean, key: string) {
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!on) return
    const node = list.current
    const columns = node?.closest('.dashboard-layout, .overview-free')
    if (!node || !columns || typeof ResizeObserver === 'undefined') return
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let waited = 0
    const measure = () => {
      frame = 0
      if (node.closest('.overview-editing')) return
      const market = columns.querySelector<HTMLElement>('[data-block="favorites"]')
      const needs = columns.querySelector<HTMLElement>('[data-block="requirements"]')
      const block = node.closest<HTMLElement>('[data-block]') ?? node
      if (!market || !needs) { setHeight(null); return }
      // the free Overview (owner, 20.11.2026): only while «Рынок» stands under the list and «Требования рейда» beside it
      const own = laidBox(block)
      const marketBox = laidBox(market)
      const needsBox = laidBox(needs)
      const across = marketBox.left < own.right && own.left < marketBox.right
      if (across && marketBox.top < own.bottom - 1 && marketBox.bottom > own.top + 1) {
        // the blocks overlap: the Overview has not laid them for the list's new height yet
        if (waited++ < SETTLE_TRIES) later()
        return
      }
      waited = 0
      const below = across && marketBox.top >= own.bottom - 1
      const beside = needsBox.right <= own.left + 1 || needsBox.left >= own.right - 1
      if (!below || !beside) { setHeight(null); return }
      const now = node.offsetHeight
      const wanted = now + needsBox.top - marketBox.top
      const next = Math.round(Math.min(node.scrollHeight, Math.max(MIN_HEIGHT, wanted)))
      setHeight((current) => (current !== null && Math.abs(current - next) <= CLOSE_ENOUGH ? current : next))
    }
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { if (!frame) frame = requestAnimationFrame(measure) }, SETTLE_MS)
    }
    const observer = new ResizeObserver(() => { waited = 0; later() })
    observer.observe(columns)
    for (const block of columns.querySelectorAll('[data-block]')) observer.observe(block)
    measure()
    return () => { observer.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame) }
  }, [key, list, on])
  return on ? height : null
}
