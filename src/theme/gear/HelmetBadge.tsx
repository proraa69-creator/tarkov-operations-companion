import { uiText } from '../../i18n/renderText'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Settings2 } from 'lucide-react'
import type { HelmetHandle, HelmetPose } from './helmet3d'
import { HELMETS, type HelmetVariant } from './helmets'

const OVERVIEW = '.sidebar .nav-link[href="#/"]'
const STORAGE_KEY = 'gear-helmet-layout-v1'
const VARIANT_KEY = 'gear-helmet-variant-v1'

/** Where the helmet sits: 3D pose plus an on-screen offset and badge size (read-only now). */
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

function loadVariant(): HelmetVariant {
  let id: string | null = null
  try { id = localStorage.getItem(VARIANT_KEY) } catch { /* storage unavailable */ }
  return HELMETS.find((helmet) => helmet.id === id) ?? HELMETS[0]
}

/**
 * The 3D helmet next to the «Обзор» / Overview item. The three.js module is fetched on first use only.
 * Its placement is fixed (the layout the owner saved earlier with the old editor, else the default); the
 * small button next to it only picks which helmet model is shown.
 */
export function HelmetBadge({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<HelmetHandle | null>(null)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [layout] = useState<HelmetLayout>(loadLayout)
  const [variant, setVariant] = useState<HelmetVariant>(loadVariant)
  const [picking, setPicking] = useState(false)
  const layoutRef = useRef(layout)

  const choose = (next: HelmetVariant) => {
    setVariant(next)
    setPicking(false)
    setFailed(false)
    try { localStorage.setItem(VARIANT_KEY, next.id) } catch { /* storage unavailable */ }
  }

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

  if (!spot || failed) return null
  const size = layout.size
  const top = spot.top + layout.dy
  const left = spot.left + layout.dx
  return createPortal(
    <>
      <div className="gear-helmet" style={{ top, left, width: size, height: size, margin: `${-size / 2 - 3}px 0 0 ${-size - 6}px` }} aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>
      <button
        type="button"
        className={`gear-helmet-settings${picking ? ' active' : ''}`}
        style={{ top: top - size / 2 - 3, left: left - 10 }}
        onClick={() => setPicking((state) => !state)}
        title={uiText('Выбрать маску')}
        aria-label={uiText('Выбрать маску')}
        aria-expanded={picking}
      >
        <Settings2 size={12} />
      </button>
      {picking && (
        <div className="gear-helmet-editor" style={{ top: Math.max(12, top - 40), left: left + 16 }} role="menu" aria-label={uiText('Выбрать маску')}>
          <div className="gear-helmet-editor-head"><strong>{uiText('Маска')}</strong></div>
          {HELMETS.map((helmet) => (
            <button key={helmet.id} type="button" role="menuitemradio" aria-checked={helmet.id === variant.id} className={`gear-helmet-option${helmet.id === variant.id ? ' active' : ''}`} onClick={() => choose(helmet)}>
              <span>{uiText(helmet.label)}</span>{helmet.id === variant.id && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </>,
    document.body,
  )
}
