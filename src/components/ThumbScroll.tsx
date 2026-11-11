import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import './thumbScroll.css'

/** The thumb is never shorter than this, so a finger always finds it. */
const MIN_THUMB = 28

/**
 * A list that shows its first `rows` rows and scrolls the rest with a real thumb on the right, one the finger takes and drags
 * up and down (owner, 11.11.2026: «справа будет ползунок, который перемещается вверх-вниз… не как на карте полоска»). The
 * box's height is measured from the rows its child lays out (a grid or a list), so two rows show whole at any width; with
 * `rows` unset or everything fitting there is no limit and no thumb. The wheel and a swipe scroll it as usual.
 */
export function ThumbScroll({ rows, className, children }: { rows?: number; className?: string; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const [thumb, setThumb] = useState<{ size: number; offset: number } | null>(null)
  const drag = useRef<{ pointer: number; startY: number; startTop: number } | null>(null)

  /** The height of the first `rows` rows: the top of the first child of row `rows + 1`, less the gap above it. */
  const measure = useCallback(() => {
    const box = boxRef.current
    const list = box?.firstElementChild as HTMLElement | null
    if (!box || !list || !rows) { setLimit(null); return }
    const tops = [...new Set([...list.children].map((child) => (child as HTMLElement).offsetTop))].sort((a, b) => a - b)
    if (tops.length <= rows) { setLimit(null); return }
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0
    setLimit(Math.ceil(tops[rows]! - tops[0]! - gap))
  }, [rows])

  const place = useCallback(() => {
    const box = boxRef.current, track = trackRef.current
    if (!box || !track || box.scrollHeight <= box.clientHeight + 1) { setThumb(null); return }
    const room = track.clientHeight
    const size = Math.max(MIN_THUMB, Math.round(room * box.clientHeight / box.scrollHeight))
    const offset = Math.round((room - size) * box.scrollTop / (box.scrollHeight - box.clientHeight))
    setThumb((old) => (old && old.size === size && old.offset === offset ? old : { size, offset }))
  }, [])

  useLayoutEffect(() => { measure() })
  useLayoutEffect(() => { place() }, [limit, place])
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { measure(); place() })
    observer.observe(box)
    if (box.firstElementChild) observer.observe(box.firstElementChild)
    return () => observer.disconnect()
  }, [measure, place])

  const scrollBy = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = boxRef.current, track = trackRef.current
    if (!box || !track || !thumb || event.target !== track) return
    // a press on the track beside the thumb turns a page that way
    const above = event.clientY < track.getBoundingClientRect().top + thumb.offset
    box.scrollBy({ top: (above ? -1 : 1) * box.clientHeight * 0.9, behavior: 'smooth' })
  }
  const grab = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const box = boxRef.current
    if (!box) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, startY: event.clientY, startTop: box.scrollTop }
  }
  const move = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const box = boxRef.current, track = trackRef.current, held = drag.current
    if (!box || !track || !thumb || !held || held.pointer !== event.pointerId) return
    const room = track.clientHeight - thumb.size
    if (room <= 0) return
    box.scrollTop = held.startTop + (event.clientY - held.startY) * (box.scrollHeight - box.clientHeight) / room
  }
  const release = (event: ReactPointerEvent<HTMLSpanElement>) => { if (drag.current?.pointer === event.pointerId) drag.current = null }

  return <div className={`thumb-scroll${thumb ? ' has-thumb' : ''}${className ? ` ${className}` : ''}`}>
    <div ref={boxRef} className="thumb-scroll-box" style={limit ? { maxHeight: limit } : undefined} onScroll={place}>{children}</div>
    <div ref={trackRef} className="thumb-scroll-track" aria-hidden="true" onPointerDown={scrollBy}>
      {thumb && <span className="thumb-scroll-thumb" style={{ height: thumb.size, transform: `translateY(${thumb.offset}px)` }}
        onPointerDown={grab} onPointerMove={move} onPointerUp={release} onPointerCancel={release} />}
    </div>
  </div>
}
