import { uiText } from '../../i18n/renderText'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Eye, EyeOff, Minus, Plus, Settings2 } from 'lucide-react'
import type { HelmetHandle, HelmetPose } from './helmet3d'
import { HELMETS, type HelmetVariant } from './helmets'
import { useReducedMotion } from './useGearActive'

const OVERVIEW = '.sidebar .nav-link[href="#/"]'
const STORAGE_KEY = 'gear-helmet-layout-v1'
const VARIANT_KEY = 'gear-helmet-variant-v1'
const HIDDEN_KEY = 'gear-helmet-hidden-v1'
const BUTTON_KEY = 'gear-helmet-button-v1'
/** Press-and-hold time before the settings button can be dragged. */
const HOLD_MS = 350
/** Moving further than this before the hold completes cancels it (it was not a press-and-hold). */
const HOLD_SLOP = 8
const BUTTON_SIZE = 20
const EDITOR_WIDTH = 220

/** Where the helmet sits: 3D pose plus an on-screen offset and badge size. */
interface HelmetLayout extends HelmetPose { dx: number; dy: number; size: number }
type PositionKey = 'dx' | 'dy' | 'rotZ'
interface Offset { x: number; y: number }

const DEFAULT_LAYOUT: HelmetLayout = { rotX: 12, rotY: -35, rotZ: -8, scale: 1, dx: 0, dy: 0, size: 86 }

/** The only placement settings the player can change: up–down, left–right and tilt. */
const POSITION_CONTROLS: Array<{ key: PositionKey; label: string; min: number; max: number; step: number; unit: string }> = [
  { key: 'dy', label: 'Вверх–вниз', min: -120, max: 120, step: 2, unit: 'px' },
  { key: 'dx', label: 'Влево–вправо', min: -160, max: 160, step: 2, unit: 'px' },
  { key: 'rotZ', label: 'Наклон', min: -60, max: 60, step: 2, unit: '°' },
]

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function readStored(key: string): Record<string, unknown> | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : null
  } catch {
    return null
  }
}

function loadLayout(): HelmetLayout {
  return { ...DEFAULT_LAYOUT, ...(readStored(STORAGE_KEY) as Partial<HelmetLayout> | null ?? {}) }
}

/** Writes only the changed fields; everything else already stored under the key is kept as it was. */
function saveLayout(patch: Partial<HelmetLayout>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...(readStored(STORAGE_KEY) ?? {}), ...patch })) } catch { /* storage unavailable */ }
}

function loadButtonOffset(): Offset {
  const saved = readStored(BUTTON_KEY)
  const x = Number(saved?.x), y = Number(saved?.y)
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 }
}

function loadVariant(): HelmetVariant {
  let id: string | null = null
  try { id = localStorage.getItem(VARIANT_KEY) } catch { /* storage unavailable */ }
  return HELMETS.find((helmet) => helmet.id === id) ?? HELMETS[0]
}

function loadHidden() {
  try { return localStorage.getItem(HIDDEN_KEY) === '1' } catch { return false }
}

interface DragState { id: number; startX: number; startY: number; base: Offset; anchor: Offset; last: Offset; timer: number; dragging: boolean }

/** Clamps a button offset from its un-dragged spot (anchor) so the button stays fully inside the window. */
function clampOffset(offset: Offset, anchor: Offset): Offset {
  const maxX = Math.max(4, window.innerWidth - BUTTON_SIZE - 4)
  const maxY = Math.max(4, window.innerHeight - BUTTON_SIZE - 4)
  return { x: clamp(anchor.x + offset.x, 4, maxX) - anchor.x, y: clamp(anchor.y + offset.y, 4, maxY) - anchor.y }
}

/**
 * The 3D mask next to the «Обзор» / Overview item, shown in every colour theme. The three.js module is
 * fetched on first use only. The small button next to it opens a menu to pick the model, hide / show the mask
 * and nudge its position (up–down, left–right, tilt); press and hold the button to drag it somewhere else.
 * While hidden nothing 3D is loaded, only the button stays so the mask can be brought back.
 */
export function HelmetBadge({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HelmetHandle | null>(null)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [layout, setLayout] = useState<HelmetLayout>(loadLayout)
  const [variant, setVariant] = useState<HelmetVariant>(loadVariant)
  /** Open menu: its spot, plus the button's anchor frozen at opening so moving the mask never slides the button under the menu. */
  const [menuAt, setMenuAt] = useState<{ top: number; left: number; anchor: Offset } | null>(null)
  const picking = !!menuAt
  const [hidden, setHidden] = useState(loadHidden)
  const [buttonOffset, setButtonOffset] = useState<Offset>(loadButtonOffset)
  const [grabbing, setGrabbing] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const layoutRef = useRef(layout)

  const toggleHidden = () => {
    setHidden((state) => {
      try { localStorage.setItem(HIDDEN_KEY, state ? '0' : '1') } catch { /* storage unavailable */ }
      return !state
    })
    setMenuAt(null)
  }

  const choose = (next: HelmetVariant) => {
    setVariant(next)
    setMenuAt(null)
    setFailed(false)
    if (hidden) toggleHidden()
    try { localStorage.setItem(VARIANT_KEY, next.id) } catch { /* storage unavailable */ }
  }

  const updatePosition = (patch: Partial<Pick<HelmetLayout, PositionKey>>) => {
    setLayout((state) => ({ ...state, ...patch }))
    saveLayout(patch)
  }
  const resetPosition = () => updatePosition({ dx: DEFAULT_LAYOUT.dx, dy: DEFAULT_LAYOUT.dy, rotZ: DEFAULT_LAYOUT.rotZ })

  // Live pose: the mounted helmet eases to the new tilt; a remount (other model) starts from it.
  useEffect(() => {
    layoutRef.current = layout
    handleRef.current?.setPose(layout)
  }, [layout])

  useEffect(() => {
    const place = () => {
      const link = document.querySelector(OVERVIEW)
      const rect = link?.getBoundingClientRect()
      // hidden when the sidebar is collapsed to icons
      setSpot(rect && rect.width > 150 ? { top: rect.top + rect.height / 2, left: rect.right } : null)
    }
    place()
    const sidebar = document.querySelector('.sidebar')
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (sidebar) ro?.observe(sidebar)
    window.addEventListener('resize', place)
    return () => { ro?.disconnect(); window.removeEventListener('resize', place) }
  }, [])

  const visible = !!spot && !hidden
  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible || !canvas || typeof IntersectionObserver === 'undefined') return
    let cancelled = false
    import('./helmet3d')
      .then(({ mountHelmet }) => {
        if (!cancelled) handleRef.current = mountHelmet(canvas, { reduced, pose: layoutRef.current, variant, onError: () => setFailed(true) })
      })
      .catch(() => setFailed(true))
    const onMove = (event: PointerEvent) => {
      const handle = handleRef.current
      if (!handle) return
      const r = canvas.getBoundingClientRect()
      const link = document.querySelector(OVERVIEW)
      const hover = !!link?.matches(':hover')
      const nx = (event.clientX - (r.left + r.width / 2)) / (hover ? 90 : 420)
      const ny = (event.clientY - (r.top + r.height / 2)) / (hover ? 70 : 420)
      handle.setPointer(nx, ny, hover)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      cancelled = true
      window.removeEventListener('pointermove', onMove)
      handleRef.current?.dispose()
      handleRef.current = null
    }
  }, [visible, reduced, variant])

  // Keep the open menu inside the window (it is taller now that it has the position controls).
  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!menuAt || !editor) return
    const maxTop = Math.max(12, window.innerHeight - editor.offsetHeight - 12)
    if (menuAt.top > maxTop) setMenuAt({ ...menuAt, top: maxTop })
  }, [menuAt])

  useEffect(() => () => { if (dragRef.current) window.clearTimeout(dragRef.current.timer) }, [])

  const size = layout.size
  const top = (spot?.top ?? 0) + layout.dy
  const left = (spot?.left ?? 0) + layout.dx
  /** The settings button's un-dragged spot: at the helmet's top-right corner. */
  const anchor: Offset = { x: left - 10, y: top - size / 2 - 3 }
  // while the menu is open the button stays where it was; it glides back next to the mask when the menu closes
  const buttonAnchor = menuAt?.anchor ?? anchor
  const button = clampOffset(buttonOffset, buttonAnchor)
  const buttonAt: Offset = { x: buttonAnchor.x + button.x, y: buttonAnchor.y + button.y }

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    window.clearTimeout(drag.timer)
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag.dragging) return
    setGrabbing(false)
    setButtonOffset(drag.last)
    try { localStorage.setItem(BUTTON_KEY, JSON.stringify(drag.last)) } catch { /* storage unavailable */ }
  }

  const onButtonPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    suppressClickRef.current = false
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const target = event.currentTarget
    const pointerId = event.pointerId
    try { target.setPointerCapture(pointerId) } catch { /* pointer already gone */ }
    // offset of where the button is drawn now, measured from the live anchor (they differ while the menu is open)
    const base = { x: buttonAt.x - anchor.x, y: buttonAt.y - anchor.y }
    const drag: DragState = { id: pointerId, startX: event.clientX, startY: event.clientY, base, anchor, last: base, timer: 0, dragging: false }
    drag.timer = window.setTimeout(() => {
      if (dragRef.current !== drag) return
      drag.dragging = true
      suppressClickRef.current = true
      setGrabbing(true)
      setButtonOffset(base)
      setMenuAt(null)
    }, HOLD_MS)
    dragRef.current = drag
  }

  const onButtonPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
    if (!drag.dragging) {
      // moved away before the hold completed: not a press-and-hold (and not a click on the button either)
      if (Math.hypot(dx, dy) > HOLD_SLOP) {
        window.clearTimeout(drag.timer)
        dragRef.current = null
      }
      return
    }
    drag.last = clampOffset({ x: drag.base.x + dx, y: drag.base.y + dy }, drag.anchor)
    setButtonOffset(drag.last)
  }

  const onButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    if (menuAt) { setMenuAt(null); return }
    const rect = event.currentTarget.getBoundingClientRect()
    const right = rect.left + BUTTON_SIZE + 6
    const left = right + EDITOR_WIDTH + 12 > window.innerWidth ? Math.max(12, rect.left - EDITOR_WIDTH - 6) : right
    setMenuAt({ top: Math.max(12, rect.top + 6), left, anchor })
  }

  if (!spot) return null
  const hint = `${uiText('Выбрать маску')}. ${uiText('Зажмите и перетащите кнопку')}`
  return createPortal(
    <>
      {!hidden && !failed && (
        <div className="gear-helmet" style={{ top, left, width: size, height: size, margin: `${-size / 2 - 3}px 0 0 ${-size - 6}px` }} aria-hidden="true">
          <canvas ref={canvasRef} />
        </div>
      )}
      <button
        type="button"
        className={`gear-helmet-settings${picking ? ' active' : ''}${grabbing ? ' grabbing' : ''}`}
        style={{ top: buttonAt.y, left: buttonAt.x }}
        onClick={onButtonClick}
        onPointerDown={onButtonPointerDown}
        onPointerMove={onButtonPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(event) => event.preventDefault()}
        title={hint}
        aria-label={uiText('Выбрать маску')}
        aria-expanded={picking}
      >
        <Settings2 size={12} />
      </button>
      {menuAt && (
        <div ref={editorRef} className="gear-helmet-editor" style={{ top: menuAt.top, left: menuAt.left }} role="menu" aria-label={uiText('Выбрать маску')}>
          <div className="gear-helmet-editor-head"><strong>{uiText('Маска')}</strong></div>
          {HELMETS.map((helmet) => (
            <button key={helmet.id} type="button" role="menuitemradio" aria-checked={helmet.id === variant.id && !hidden} className={`gear-helmet-option${helmet.id === variant.id && !hidden ? ' active' : ''}`} onClick={() => choose(helmet)}>
              <span>{uiText(helmet.label)}</span>{helmet.id === variant.id && !hidden && <Check size={13} />}
            </button>
          ))}
          <div className="gear-helmet-position" role="group" aria-label={uiText('Положение')}>
            <div className="gear-helmet-position-head">
              <span>{uiText('Положение')}</span>
              <button type="button" className="gear-helmet-reset" onClick={resetPosition}>{uiText('Сбросить')}</button>
            </div>
            {POSITION_CONTROLS.map((control) => {
              const value = layout[control.key]
              const label = uiText(control.label)
              const set = (next: number) => updatePosition({ [control.key]: clamp(Math.round(next), control.min, control.max) })
              return (
                <div key={control.key} className="gear-helmet-slider">
                  <div className="gear-helmet-slider-label"><span>{label}</span><output>{`${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value))}${control.unit === '°' ? '°' : ` ${control.unit}`}`}</output></div>
                  <div className="gear-helmet-slider-row">
                    <button type="button" className="gear-helmet-nudge" onClick={() => set(value - control.step)} aria-label={`${label} −`} disabled={value <= control.min}><Minus size={11} /></button>
                    <input type="range" min={control.min} max={control.max} step={1} value={clamp(value, control.min, control.max)} onChange={(event) => set(Number(event.target.value))} aria-label={label} />
                    <button type="button" className="gear-helmet-nudge" onClick={() => set(value + control.step)} aria-label={`${label} +`} disabled={value >= control.max}><Plus size={11} /></button>
                  </div>
                </div>
              )
            })}
          </div>
          <button type="button" role="menuitem" className="gear-helmet-option gear-helmet-toggle" onClick={toggleHidden}>
            <span>{uiText(hidden ? 'Показать маску' : 'Убрать маску')}</span>{hidden ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
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
