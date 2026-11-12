import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import './thumbScroll.css'

/** The thumb is never shorter than this, so a finger always finds it. */
const MIN_THUMB = 36

/**
 * A list that shows its first `rows` rows and scrolls the rest with a real thumb on the right, one the finger takes and drags
 * up and down (owner, 11.11.2026: «справа будет ползунок, который перемещается вверх-вниз… не как на карте полоска»). The
 * box's height is measured from the rows its child lays out (a grid or a list), so two rows show whole at any width; with
 * `rows` unset or everything fitting there is no limit and no thumb. Only the thumb (or a press on its track) moves the list: a
 * finger on the items scrolls the page, never the block (owner, 11.11.2026).
 */
export function ThumbScroll({ rows, className, children }: { rows?: number; className?: string; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const [limit, setLimit] = useState<number | null>(null)
  // Only the thumb's size goes through React; its place and the list's scroll are set straight on the elements, so a drag
  // never re-renders the list (owner, 12.11.2026: «Когда начинаешь листать, текст как будто дергается… сделать плавнее»).
  const [thumbSize, setThumbSize] = useState<number | null>(null)
  const offsetRef = useRef(0)
  const drag = useRef<{ pointer: number; startY: number; startTop: number } | null>(null)
  // The list glides after the finger: each frame it covers a part of the way left to where the thumb points.
  const target = useRef<number | null>(null)
  const frame = useRef<number | null>(null)

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
    if (!box || !track || box.scrollHeight <= box.clientHeight + 1) { setThumbSize(null); return }
    const room = track.clientHeight
    const size = Math.max(MIN_THUMB, Math.round(room * box.clientHeight / box.scrollHeight))
    const offset = (room - size) * box.scrollTop / (box.scrollHeight - box.clientHeight)
    offsetRef.current = offset
    if (thumbRef.current) thumbRef.current.style.transform = `translate3d(0, ${offset}px, 0)`
    setThumbSize((old) => (old === size ? old : size))
  }, [])
  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current) }, [])
  const glide = useCallback(() => {
    if (frame.current != null) return
    const tick = () => {
      frame.current = null
      const box = boxRef.current
      if (!box || target.current == null) return
      const left = target.current - box.scrollTop
      if (Math.abs(left) < 0.5) { box.scrollTop = target.current; target.current = null; place(); return }
      box.scrollTop += left * 0.38
      place()
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [place])
  // a thumb just shown takes its place at once
  useLayoutEffect(() => { if (thumbSize && thumbRef.current) thumbRef.current.style.transform = `translate3d(0, ${offsetRef.current}px, 0)` }, [thumbSize])

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
    if (!box || !track || !thumbSize || event.target !== track) return
    // a press on the track beside the thumb turns a page that way
    const above = event.clientY < track.getBoundingClientRect().top + offsetRef.current
    const most = box.scrollHeight - box.clientHeight
    target.current = Math.max(0, Math.min(most, (target.current ?? box.scrollTop) + (above ? -1 : 1) * box.clientHeight * 0.9))
    glide()
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
    if (!box || !track || !thumbSize || !held || held.pointer !== event.pointerId) return
    const room = track.clientHeight - thumbSize
    if (room <= 0) return
    const most = box.scrollHeight - box.clientHeight
    target.current = Math.max(0, Math.min(most, held.startTop + (event.clientY - held.startY) * most / room))
    glide()
  }
  const release = (event: ReactPointerEvent<HTMLSpanElement>) => { if (drag.current?.pointer === event.pointerId) drag.current = null }

  return <div className={`thumb-scroll${thumbSize ? ' has-thumb' : ''}${className ? ` ${className}` : ''}`}>
    <div ref={boxRef} className="thumb-scroll-box" style={limit ? { maxHeight: limit } : undefined} onScroll={place}>{children}</div>
    <div ref={trackRef} className="thumb-scroll-track" aria-hidden="true" onPointerDown={scrollBy}>
      {thumbSize && <span ref={thumbRef} className="thumb-scroll-thumb" style={{ height: thumbSize }}
        onPointerDown={grab} onPointerMove={move} onPointerUp={release} onPointerCancel={release} />}
    </div>
  </div>
}
