import { uiText } from '../../i18n/renderText'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, Settings2, X } from 'lucide-react'
import type { HelmetHandle, HelmetPose } from './helmet3d'

const OVERVIEW = '.sidebar .nav-link[href="#/"]'
const STORAGE_KEY = 'gear-helmet-layout-v1'

/** Where and how the player placed the helmet: 3D pose plus an on-screen offset and badge size. */
interface HelmetLayout extends HelmetPose { dx: number; dy: number; size: number }

const DEFAULT_LAYOUT: HelmetLayout = { rotX: 12, rotY: -35, rotZ: -8, scale: 1, dx: 0, dy: 0, size: 86 }

function loadLayout(): HelmetLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<HelmetLayout> | null
    return { ...DEFAULT_LAYOUT, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

function saveLayout(layout: HelmetLayout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)) } catch { /* storage unavailable */ }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const wrap = (degrees: number) => ((degrees + 540) % 360) - 180

const SLIDERS: Array<{ key: keyof HelmetLayout; label: string; min: number; max: number; step: number }> = [
  { key: 'rotY', label: 'Поворот', min: -180, max: 180, step: 1 },
  { key: 'rotX', label: 'Наклон вперёд', min: -90, max: 90, step: 1 },
  { key: 'rotZ', label: 'Наклон вбок', min: -90, max: 90, step: 1 },
  { key: 'scale', label: 'Размер модели', min: 0.4, max: 2.5, step: 0.05 },
  { key: 'size', label: 'Размер окна', min: 56, max: 220, step: 2 },
  { key: 'dx', label: 'Сдвиг по горизонтали', min: -400, max: 400, step: 1 },
  { key: 'dy', label: 'Сдвиг по вертикали', min: -400, max: 400, step: 1 },
]

/**
 * The 3D helmet next to the «Обзор» / Overview item. The three.js module is fetched on first use only.
 * A small settings button opens an editor: drag the helmet to rotate it, Shift+drag or right-drag to move
 * it, the mouse wheel to resize it, or use the sliders. The layout is saved locally.
 */
export function HelmetBadge({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<HelmetHandle | null>(null)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [layout, setLayout] = useState<HelmetLayout>(loadLayout)
  const [editing, setEditing] = useState(false)
  const layoutRef = useRef(layout)
  useEffect(() => { layoutRef.current = layout }, [layout])

  const update = (patch: Partial<HelmetLayout>) => setLayout((current) => {
    const next = { ...current, ...patch }
    saveLayout(next)
    return next
  })

  useEffect(() => {
    const place = () => {
      const link = document.querySelector(OVERVIEW)
      const rect = link?.getBoundingClientRect()
      // hidden when the sidebar is collapsed to icons
      setSpot(rect && rect.width > 150 ? { top: rect.top + rect.height / 2, left: rect.right } : null)
    }
    place()
    const sidebar = document.querySelector('.sidebar')
    const ro = new ResizeObserver(place)
    if (sidebar) ro.observe(sidebar)
    window.addEventListener('resize', place)
    return () => { ro.disconnect(); window.removeEventListener('resize', place) }
  }, [])

  const visible = !!spot
  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible || !canvas) return
    let cancelled = false
    import('./helmet3d')
      .then(({ mountHelmet }) => {
        if (!cancelled) handleRef.current = mountHelmet(canvas, { reduced, pose: layoutRef.current, onError: () => setFailed(true) })
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
  }, [visible, reduced])

  useEffect(() => { handleRef.current?.setPose(layout) }, [layout])
  useEffect(() => { handleRef.current?.resize() }, [layout.size])

  // While editing, the helmet itself is a handle: drag = rotate, Shift/right drag = move, wheel = size.
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editing) return
    event.preventDefault()
    const move = event.shiftKey || event.button === 2
    const origin = { x: event.clientX, y: event.clientY, ...layoutRef.current }
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const onMove = (e: PointerEvent) => {
      const ddx = e.clientX - origin.x
      const ddy = e.clientY - origin.y
      if (move) update({ dx: clamp(Math.round(origin.dx + ddx), -400, 400), dy: clamp(Math.round(origin.dy + ddy), -400, 400) })
      else update({ rotY: wrap(Math.round(origin.rotY + ddx * 0.6)), rotX: clamp(Math.round(origin.rotX + ddy * 0.5), -90, 90) })
    }
    const onUp = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', onUp) }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!editing) return
    update({ scale: clamp(Math.round((layoutRef.current.scale - Math.sign(event.deltaY) * 0.05) * 100) / 100, 0.4, 2.5) })
  }

  if (!spot || failed) return null
  const size = layout.size
  const top = spot.top + layout.dy
  const left = spot.left + layout.dx
  return createPortal(
    <>
      <div
        className={`gear-helmet${editing ? ' is-editing' : ''}`}
        style={{ top, left, width: size, height: size, margin: `${-size / 2 - 3}px 0 0 ${-size - 6}px` }}
        aria-hidden="true"
        onPointerDown={startDrag}
        onWheel={onWheel}
        onContextMenu={(event) => { if (editing) event.preventDefault() }}
      >
        <canvas ref={canvasRef} />
      </div>
      <button
        type="button"
        className={`gear-helmet-settings${editing ? ' active' : ''}`}
        style={{ top: top - size / 2 - 3, left: left - 10 }}
        onClick={() => setEditing((state) => !state)}
        title={uiText('Настроить шлем')}
        aria-label={uiText('Настроить шлем')}
      >
        <Settings2 size={12} />
      </button>
      {editing && (
        <div className="gear-helmet-editor" style={{ top: Math.max(12, top - 40), left: left + 16 }} role="dialog" aria-label={uiText('Настроить шлем')}>
          <div className="gear-helmet-editor-head">
            <strong>{uiText('Шлем')}</strong>
            <button type="button" className="icon-button" onClick={() => setEditing(false)} aria-label={uiText('Готово')}><X size={14} /></button>
          </div>
          <p className="gear-helmet-editor-hint">{uiText('Тяните шлем мышью — вращение. Shift или правая кнопка — перемещение. Колесо — размер.')}</p>
          {SLIDERS.map((slider) => (
            <label key={slider.key} className="gear-helmet-slider">
              <span>{uiText(slider.label)}<em>{slider.key === 'scale' ? `${Math.round(layout.scale * 100)}%` : slider.key === 'size' || slider.key === 'dx' || slider.key === 'dy' ? `${layout[slider.key]} px` : `${layout[slider.key]}°`}</em></span>
              <input type="range" min={slider.min} max={slider.max} step={slider.step} value={layout[slider.key]} onChange={(event) => update({ [slider.key]: Number(event.target.value) })} />
            </label>
          ))}
          <div className="gear-helmet-editor-actions">
            <button type="button" className="button ghost small" onClick={() => update(DEFAULT_LAYOUT)}><RotateCcw size={12} />{uiText(' Сбросить')}</button>
            <button type="button" className="button primary small" onClick={() => setEditing(false)}>{uiText('Готово')}</button>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
