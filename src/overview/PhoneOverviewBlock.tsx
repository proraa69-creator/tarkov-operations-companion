import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Columns2, MoveDiagonal2, RectangleHorizontal, RotateCcw } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { PHONE_NARROWABLE, type PhoneBlockSize } from './phoneLayout'
import type { PhoneOverview } from './usePhoneOverview'

/** How long a finger rests on a block before it lifts, and how far it may wander meanwhile (more is a scroll). */
export const HOLD_MS = 380
const HOLD_SLOP_PX = 9

/**
 * One block of the phone's Overview. While «Настроить блоки» is on, its content does not react (inert) and a bar on top
 * names it, halves it («пополам» / «во всю ширину») and puts its size back. A block held down for a moment lifts and
 * follows the finger; the others shake gently, as on an iPhone home screen, and the one it is dropped on swaps places
 * with it (owner, 28.10.2026). While a block is held the page does not scroll.
 */
export function PhoneOverviewBlock({ overview, id, label, children }: {
  overview: PhoneOverview
  id: string
  label: string
  index?: number
  count?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { register } = overview
  useLayoutEffect(() => {
    register(id, ref.current)
    return () => register(id, null)
  }, [id, register])

  const narrow = overview.layout.narrow.includes(id)
  const size = overview.layout.sizes?.[id]
  const width = size?.w ?? (narrow ? 0.5 : 1)
  const contentRef = useRef<HTMLDivElement>(null)
  const resizing = useRef<{ pointer: number; left: number; top: number; gridWidth: number; room: number } | null>(null)

  // The corner handle (owner, 17.10.2026): the width follows the finger as a share of the row, the height in pixels. The
  // width stops at the screen's edge (owner, 28.10.2026: «он должен упираться в стенку»): a block in the right half can
  // grow only over the room left of the edge, so it never wraps to a new row under the finger and jumps.
  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const content = contentRef.current
    const grid = ref.current?.parentElement
    if (!content || !grid) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const block = ref.current!.getBoundingClientRect()
    const area = grid.getBoundingClientRect()
    resizing.current = { pointer: event.pointerId, left: block.left, top: content.getBoundingClientRect().top, gridWidth: area.width, room: (area.right - block.left) / area.width }
  }
  const followResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = resizing.current
    if (!start || start.pointer !== event.pointerId || !start.gridWidth) return
    const room = Math.min(1, start.room)
    let w = Math.min(room, (event.clientX - start.left) / start.gridWidth)
    if (w > room - 0.04) w = room
    if (Math.abs(w - 0.5) < 0.025) w = 0.5
    if (w > 0.96) w = 1
    const next: PhoneBlockSize = { h: event.clientY - start.top, ...(w < 1 ? { w } : {}) }
    overview.resize(id, next)
  }
  const endResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizing.current?.pointer === event.pointerId) resizing.current = null
  }

  // Hold to lift, drag to swap.
  const hold = useRef<{ pointer: number; x: number; y: number; scroll: number; timer: number; lifted: boolean; clientX: number; clientY: number; frame?: number } | null>(null)
  const { setDragging, swap } = overview
  const draggingRef = useRef(overview.dragging)
  useEffect(() => { draggingRef.current = overview.dragging })
  const lifted = overview.dragging?.id === id
  const target = overview.dragging?.over === id

  const blockUnder = (x: number, y: number) => {
    for (const element of document.elementsFromPoint(x, y)) {
      const block = (element as HTMLElement).closest?.<HTMLElement>('[data-block]')
      if (block && block !== ref.current && block.parentElement === ref.current?.parentElement) return block.dataset.block
    }
    return undefined
  }

  /** The lifted block under the finger, the page's scroll included (the page itself does not move while a block is held). */
  const place = () => {
    const state = hold.current
    if (!state?.lifted) return
    const dx = state.clientX - state.x
    const dy = state.clientY + window.scrollY - (state.y + state.scroll)
    if (ref.current) ref.current.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`
    const over = blockUnder(state.clientX, state.clientY)
    if (over !== draggingRef.current?.over) setDragging({ id, over })
  }
  /** A finger held near the top or the bottom scrolls the page, faster nearer the edge: blocks off the screen are reachable. */
  const edgeScroll = () => {
    const state = hold.current
    if (!state?.lifted) return
    const edge = 90
    const step = state.clientY < edge ? -Math.ceil((edge - state.clientY) / 6)
      : state.clientY > window.innerHeight - edge ? Math.ceil((state.clientY - (window.innerHeight - edge)) / 6) : 0
    if (step) { window.scrollBy(0, step); place() }
    state.frame = window.requestAnimationFrame(edgeScroll)
  }

  const release = () => {
    const state = hold.current
    if (state) { window.clearTimeout(state.timer); if (state.frame) window.cancelAnimationFrame(state.frame) }
    hold.current = null
    if (ref.current) ref.current.style.transform = ''
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!overview.editing || event.button > 0) return
    if ((event.target as HTMLElement).closest('button')) return
    const pointer = event.pointerId
    const element = event.currentTarget
    const timer = window.setTimeout(() => {
      if (hold.current?.pointer !== pointer) return
      hold.current.lifted = true
      setDragging({ id })
      hold.current.frame = window.requestAnimationFrame(edgeScroll)
      try { element.setPointerCapture?.(pointer) } catch { /* the pointer is gone: its up ends the drag anyway */ }
      try { navigator.vibrate?.(12) } catch { /* no vibration on this device */ }
    }, HOLD_MS)
    hold.current = { pointer, x: event.clientX, y: event.clientY, scroll: window.scrollY, timer, lifted: false, clientX: event.clientX, clientY: event.clientY }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = hold.current
    if (!state || state.pointer !== event.pointerId) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (!state.lifted) {
      // The finger moved before the block lifted: a scroll of the page, not a drag.
      if (Math.hypot(dx, dy) > HOLD_SLOP_PX) release()
      return
    }
    event.preventDefault()
    state.clientX = event.clientX
    state.clientY = event.clientY
    place()
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = hold.current
    if (!state || state.pointer !== event.pointerId) return
    const over = state.lifted ? blockUnder(event.clientX, event.clientY) : undefined
    const wasLifted = state.lifted
    release()
    if (!wasLifted) return
    setDragging(null)
    if (over) swap(id, over)
  }
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (hold.current?.pointer !== event.pointerId) return
    const wasLifted = hold.current.lifted
    release()
    if (wasLifted) setDragging(null)
  }

  // While the block is held the page stays put: the touch's moves are the drag's, never a scroll.
  useEffect(() => {
    if (!lifted) return
    const stop = (event: TouchEvent) => { if (event.cancelable) event.preventDefault() }
    document.addEventListener('touchmove', stop, { passive: false })
    return () => document.removeEventListener('touchmove', stop)
  }, [lifted])
  useEffect(() => () => release(), [])

  const shaking = overview.editing && overview.dragging && !lifted
  const classes = ['overview-block', 'phone-block', narrow && 'is-narrow', size && 'is-sized', size?.h !== undefined && 'has-height', width < 0.62 && 'is-small',
    overview.editing && 'is-editing', lifted && 'is-lifted', shaking && 'is-shaking', target && 'is-drop-target'].filter(Boolean).join(' ')
  const style = { '--w': width, ...(size?.h !== undefined ? { '--h': `${size.h}px` } : {}) } as CSSProperties
  const half = width < 0.75
  return <div ref={ref} className={classes} data-block={id} style={style}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
    onContextMenu={overview.editing ? (event) => event.preventDefault() : undefined}>
    <div ref={contentRef} className="overview-block-content" inert={overview.editing}>{children}</div>
    {overview.editing && <button type="button" className="phone-block-resize" aria-label={uiText('Изменить размер')} title={uiText('Изменить размер')}
      onPointerDown={beginResize} onPointerMove={followResize} onPointerUp={endResize} onPointerCancel={endResize}><MoveDiagonal2 size={16} /></button>}
    {overview.editing && <div className="phone-block-tools" role="group" aria-label={uiText(label)}>
      <span className="phone-block-name">{uiText(label)}</span>
      {PHONE_NARROWABLE.has(id) && <button type="button" className="phone-block-tool" aria-pressed={half} onClick={() => overview.setHalf(id, !half)}
        aria-label={uiText(half ? 'Во всю ширину' : 'Пополам')} title={uiText(half ? 'Во всю ширину' : 'Пополам')}>
        {half ? <RectangleHorizontal size={15} /> : <Columns2 size={15} />}
      </button>}
      {size && <button type="button" className="phone-block-tool" onClick={() => overview.resize(id, undefined)} aria-label={uiText('Размер по умолчанию')} title={uiText('Размер по умолчанию')}><RotateCcw size={15} /></button>}
    </div>}
  </div>
}
