import { uiText } from '../../i18n/renderText'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Eye, EyeOff, Minus, Plus, RotateCcw, Settings2, Undo2 } from 'lucide-react'
import type { HelmetHandle } from './helmet3d'
import { HELMETS, type HelmetVariant } from './helmets'
import { ANGLE_LIMITS, badgeBoxes, clampAngle, clampOffset, loadLayout, saveLayout, type AngleKey, type BadgeSpot, type HelmetLayout } from './helmetLayout'
import { useReducedMotion } from './useGearActive'

const OVERVIEW = '.sidebar .nav-link[href="#/"]'
const VARIANT_KEY = 'gear-helmet-variant-v1'
const HIDDEN_KEY = 'gear-helmet-hidden-v1'
/** Press-and-hold time before the settings button starts moving the mask. */
const HOLD_MS = 350
/** Moving further than this before the hold completes cancels it (a swipe: neither a click nor a drag). */
const HOLD_SLOP = 8
const BUTTON_SIZE = 20
const EDITOR_WIDTH = 232
/** Degrees per press of a slider's − / + button. */
const NUDGE = 5

/** The only pose settings: nod, tilt and turn of the head. The mask is moved by press-and-hold on the settings button. */
const ANGLE_CONTROLS: Array<{ key: AngleKey; label: string }> = [
  { key: 'pitch', label: 'Наклон вниз / вверх' },
  { key: 'roll', label: 'Наклон влево / вправо' },
  { key: 'yaw', label: 'Поворот влево / вправо' },
]

const formatDegrees = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}°`

function loadVariant(): HelmetVariant {
  let id: string | null = null
  try { id = localStorage.getItem(VARIANT_KEY) } catch { /* storage unavailable */ }
  return HELMETS.find((helmet) => helmet.id === id) ?? HELMETS[0]
}

function loadHidden() {
  try { return localStorage.getItem(HIDDEN_KEY) === '1' } catch { return false }
}

interface Offset { dx: number; dy: number }
interface DragState { id: number; startX: number; startY: number; base: Offset; last: Offset; timer: number; dragging: boolean }

/**
 * The 3D mask next to the «Обзор» / Overview item, shown in every colour theme. The three.js module is
 * fetched on first use only. The small button on the mask's corner opens its settings: pick the model, nod /
 * tilt / turn the head, hide or show it. Press and hold the button, then drag, to move the mask (with the
 * button) anywhere in the window. While hidden nothing 3D is loaded, only the button stays so the mask can
 * be brought back.
 */
export function HelmetBadge({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HelmetHandle | null>(null)
  const [spot, setSpot] = useState<BadgeSpot | null>(null)
  const [failed, setFailed] = useState(false)
  const [layout, setLayout] = useState<HelmetLayout>(() => loadLayout())
  const [variant, setVariant] = useState<HelmetVariant>(loadVariant)
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null)
  const picking = !!menuAt
  const [hidden, setHidden] = useState(loadHidden)
  const [grabbing, setGrabbing] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  // What a new renderer starts from: it mounts once per canvas and must not restart when these change.
  const latestRef = useRef({ layout, variant, reduced })
  useEffect(() => { latestRef.current = { layout, variant, reduced } })

  // The layout is saved as it changes; while the mask is being dragged, once it is let go.
  useEffect(() => { if (!grabbing) saveLayout(layout) }, [layout, grabbing])

  const toggleHidden = () => {
    const next = !hidden
    setHidden(next)
    setMenuAt(null)
    try { localStorage.setItem(HIDDEN_KEY, next ? '1' : '0') } catch { /* storage unavailable */ }
  }

  const choose = (next: HelmetVariant) => {
    setVariant(next)
    setFailed(false)
    if (hidden) {
      setHidden(false)
      try { localStorage.setItem(HIDDEN_KEY, '0') } catch { /* storage unavailable */ }
    }
    try { localStorage.setItem(VARIANT_KEY, next.id) } catch { /* storage unavailable */ }
  }

  const setAngle = (key: AngleKey, degrees: number) => setLayout((state) => ({ ...state, [key]: clampAngle(key, degrees) }))
  const resetAngles = () => setLayout((state) => ({ ...state, pitch: 0, roll: 0, yaw: 0 }))
  const moveHome = () => setLayout((state) => ({ ...state, dx: 0, dy: 0 }))

  // Live pose, model and motion preference go to the mounted renderer; the model swaps inside the same WebGL context.
  const { pitch, roll, yaw, scale, size } = layout
  useEffect(() => { handleRef.current?.setPose({ pitch, roll, yaw, scale }) }, [pitch, roll, yaw, scale])
  useEffect(() => { handleRef.current?.setVariant(variant) }, [variant])
  useEffect(() => { handleRef.current?.setReduced(reduced) }, [reduced])
  useEffect(() => { handleRef.current?.resize() }, [size])

  useEffect(() => {
    let active = true
    const place = () => {
      if (!active) return
      const rect = document.querySelector(OVERVIEW)?.getBoundingClientRect()
      setSpot((current) => {
        // hidden when the sidebar is collapsed to icons
        if (!rect || rect.width <= 150) return null
        const next = { top: rect.top + rect.height / 2, left: rect.right, width: window.innerWidth, height: window.innerHeight }
        const same = current && current.top === next.top && current.left === next.left && current.width === next.width && current.height === next.height
        return same ? current : next
      })
    }
    place()
    // The item moves when the sidebar or the brand above it changes size (e.g. once the fonts have loaded).
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    for (const selector of ['.sidebar', '.sidebar .brand', OVERVIEW]) {
      const element = document.querySelector(selector)
      if (element) ro?.observe(element)
    }
    window.addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => { active = false; ro?.disconnect(); window.removeEventListener('resize', place) }
  }, [])

  // One renderer per shown canvas (hiding the mask, or a failed load, removes the canvas and frees the context).
  const live = !!spot && !hidden && !failed
  useEffect(() => {
    const canvas = canvasRef.current
    if (!live || !canvas || typeof IntersectionObserver === 'undefined') return
    let cancelled = false
    let handle: HelmetHandle | null = null
    import('./helmet3d')
      .then(({ mountHelmet }) => {
        if (cancelled) return
        const { layout: saved, variant: model, reduced: still } = latestRef.current
        handle = mountHelmet(canvas, {
          reduced: still,
          pose: { pitch: saved.pitch, roll: saved.roll, yaw: saved.yaw, scale: saved.scale },
          variant: model,
          onError: () => { if (!cancelled) setFailed(true) },
        })
        handleRef.current = handle
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      handle?.dispose()
      if (handleRef.current === handle) handleRef.current = null
    }
  }, [live])

  // The head turns toward the cursor (strongly while it is on the mask or on «Обзор»); read at most once per frame.
  useEffect(() => {
    if (!live || reduced) return
    let frame = 0, x = 0, y = 0
    let link: Element | null = null
    const apply = () => {
      frame = 0
      const canvas = canvasRef.current
      const handle = handleRef.current
      if (!canvas || !handle) return
      const r = canvas.getBoundingClientRect()
      if (!r.width) return
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      if (!link?.isConnected) link = document.querySelector(OVERVIEW)
      const hover = (Math.abs(x - cx) <= r.width / 2 && Math.abs(y - cy) <= r.height / 2) || !!link?.matches(':hover')
      handle.setPointer((x - cx) / (hover ? 90 : 420), (y - cy) / (hover ? 70 : 420), hover)
    }
    const onMove = (event: PointerEvent) => {
      x = event.clientX; y = event.clientY
      if (!frame) frame = requestAnimationFrame(apply)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => { window.removeEventListener('pointermove', onMove); if (frame) cancelAnimationFrame(frame) }
  }, [live, reduced])

  // Keep the open menu inside the window.
  const moved = layout.dx !== 0 || layout.dy !== 0
  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!menuAt || !editor) return
    const maxTop = Math.max(12, window.innerHeight - editor.offsetHeight - 12)
    if (menuAt.top > maxTop) setMenuAt({ ...menuAt, top: maxTop })
  }, [menuAt, moved, failed])

  // The menu closes on Escape and on a press anywhere outside it.
  useEffect(() => {
    if (!picking) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuAt(null)
      buttonRef.current?.focus()
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (editorRef.current?.contains(target) || buttonRef.current?.contains(target))) return
      setMenuAt(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true) }
  }, [picking])

  useEffect(() => () => { if (dragRef.current) window.clearTimeout(dragRef.current.timer) }, [])

  if (!spot) return null
  // The saved offset may be off screen in a smaller window: draw it clamped, keep the saved value.
  const offset = clampOffset(spot, layout.dx, layout.dy, size)
  const { helmet, button } = badgeBoxes(spot, offset.dx, offset.dy, size)
  const turned = pitch !== 0 || roll !== 0 || yaw !== 0

  const onButtonPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    suppressClickRef.current = false
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
    const drag: DragState = { id: event.pointerId, startX: event.clientX, startY: event.clientY, base: offset, last: offset, timer: 0, dragging: false }
    drag.timer = window.setTimeout(() => {
      if (dragRef.current !== drag) return
      drag.dragging = true
      suppressClickRef.current = true
      setGrabbing(true)
      setMenuAt(null)
    }, HOLD_MS)
    dragRef.current = drag
  }

  const onButtonPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
    if (!drag.dragging) {
      // moved away before the hold completed: not a press-and-hold, and not a click either
      if (Math.hypot(dx, dy) > HOLD_SLOP) {
        window.clearTimeout(drag.timer)
        dragRef.current = null
        suppressClickRef.current = true
      }
      return
    }
    const next = clampOffset(spot, drag.base.dx + dx, drag.base.dy + dy, size)
    drag.last = { dx: Math.round(next.dx), dy: Math.round(next.dy) }
    setLayout((state) => ({ ...state, ...drag.last }))
  }

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    window.clearTimeout(drag.timer)
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag.dragging) return
    setLayout((state) => ({ ...state, ...drag.last }))
    setGrabbing(false)
  }

  const onButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    if (menuAt) { setMenuAt(null); return }
    const rect = event.currentTarget.getBoundingClientRect()
    // to the right of the button; if there is no room, to the left of the mask so it stays in view while it is adjusted
    const right = rect.left + BUTTON_SIZE + 6
    const left = right + EDITOR_WIDTH + 12 <= window.innerWidth ? right : Math.max(12, Math.min(helmet.left, rect.left) - EDITOR_WIDTH - 6)
    setMenuAt({ top: Math.max(12, rect.top + 6), left })
  }

  const hint = uiText('Зажмите кнопку и перетащите, чтобы передвинуть маску')
  return createPortal(
    <>
      {!hidden && !failed && (
        <div className="gear-helmet" style={{ top: helmet.top, left: helmet.left, width: size, height: size }} aria-hidden="true">
          <canvas ref={canvasRef} />
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className={`gear-helmet-settings${picking ? ' active' : ''}${grabbing ? ' grabbing' : ''}`}
        style={{ top: button.top, left: button.left }}
        onClick={onButtonClick}
        onPointerDown={onButtonPointerDown}
        onPointerMove={onButtonPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onContextMenu={(event) => event.preventDefault()}
        title={`${uiText('Настройки маски')}. ${hint}`}
        aria-label={uiText('Настройки маски')}
        aria-haspopup="dialog"
        aria-expanded={picking}
      >
        <Settings2 size={12} />
      </button>
      {menuAt && (
        <div ref={editorRef} className="gear-helmet-editor" style={{ top: menuAt.top, left: menuAt.left }} role="dialog" aria-label={uiText('Настройки маски')}>
          <div className="gear-helmet-editor-head"><strong>{uiText('Маска')}</strong></div>
          <div role="radiogroup" aria-label={uiText('Маска')}>
            {HELMETS.map((entry) => {
              const active = entry.id === variant.id && !hidden
              return (
                <button key={entry.id} type="button" role="radio" aria-checked={active} className={`gear-helmet-option${active ? ' active' : ''}`} onClick={() => choose(entry)}>
                  <span>{uiText(entry.label)}</span>{active && <Check size={13} />}
                </button>
              )
            })}
          </div>
          {failed && <p className="gear-helmet-note gear-helmet-error" role="status">{uiText('Маска не загрузилась')}</p>}
          <div className="gear-helmet-position" role="group" aria-label={uiText('Наклон и поворот')}>
            <div className="gear-helmet-position-head">
              <span>{uiText('Наклон и поворот')}</span>
              <button type="button" className="gear-helmet-reset" onClick={resetAngles} disabled={!turned}>{uiText('Сбросить')}</button>
            </div>
            {ANGLE_CONTROLS.map((control) => {
              const value = layout[control.key]
              const limit = ANGLE_LIMITS[control.key]
              const label = uiText(control.label)
              return (
                <div key={control.key} className="gear-helmet-slider">
                  <div className="gear-helmet-slider-label">
                    <span>{label}</span>
                    <output>{formatDegrees(value)}</output>
                    <button type="button" className="gear-helmet-zero" onClick={() => setAngle(control.key, 0)} disabled={value === 0} title={uiText('Сбросить')} aria-label={`${uiText('Сбросить')}: ${label}`}><RotateCcw size={11} /></button>
                  </div>
                  <div className="gear-helmet-slider-row">
                    <button type="button" className="gear-helmet-nudge" onClick={() => setAngle(control.key, value - NUDGE)} aria-label={`${label} −`} disabled={value <= -limit}><Minus size={11} /></button>
                    <input type="range" min={-limit} max={limit} step={1} value={value} onChange={(event) => setAngle(control.key, Number(event.target.value))} aria-label={label} aria-valuetext={formatDegrees(value)} />
                    <button type="button" className="gear-helmet-nudge" onClick={() => setAngle(control.key, value + NUDGE)} aria-label={`${label} +`} disabled={value >= limit}><Plus size={11} /></button>
                  </div>
                </div>
              )
            })}
          </div>
          {moved && (
            <button type="button" className="gear-helmet-option gear-helmet-home" onClick={moveHome}>
              <span>{uiText('Вернуть маску на место')}</span><Undo2 size={13} />
            </button>
          )}
          <button type="button" className="gear-helmet-option gear-helmet-toggle" onClick={toggleHidden}>
            <span>{uiText(hidden ? 'Показать маску' : 'Убрать маску')}</span>{hidden ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <p className="gear-helmet-note">{hint}</p>
        </div>
      )}
    </>,
    document.body,
  )
}

/** App-wide mount point (every theme). */
export function MaskBadge() {
  const reduced = useReducedMotion()
  return <HelmetBadge reduced={reduced} />
}
