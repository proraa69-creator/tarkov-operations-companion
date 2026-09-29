import { uiText } from '../../i18n/renderText'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Eye, EyeOff, Settings2 } from 'lucide-react'
import type { HelmetHandle, HelmetPose } from './helmet3d'
import { HELMETS, type HelmetVariant } from './helmets'
import { useReducedMotion } from './useGearActive'

const OVERVIEW = '.sidebar .nav-link[href="#/"]'
const STORAGE_KEY = 'gear-helmet-layout-v1'
const VARIANT_KEY = 'gear-helmet-variant-v1'
const HIDDEN_KEY = 'gear-helmet-hidden-v1'

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

function loadHidden() {
  try { return localStorage.getItem(HIDDEN_KEY) === '1' } catch { return false }
}

/**
 * The 3D mask next to the «Обзор» / Overview item, shown in every colour theme. The three.js module is
 * fetched on first use only. Its placement is fixed (the layout the owner saved earlier with the old editor,
 * else the default); the small button next to it picks the model or hides / shows the mask. While hidden
 * nothing 3D is loaded, only the button stays so the mask can be brought back.
 */
export function HelmetBadge({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<HelmetHandle | null>(null)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [layout] = useState<HelmetLayout>(loadLayout)
  const [variant, setVariant] = useState<HelmetVariant>(loadVariant)
  const [picking, setPicking] = useState(false)
  const [hidden, setHidden] = useState(loadHidden)
  const toggleHidden = () => {
    setHidden((state) => {
      try { localStorage.setItem(HIDDEN_KEY, state ? '0' : '1') } catch { /* storage unavailable */ }
      return !state
    })
    setPicking(false)
  }
  const layoutRef = useRef(layout)

  const choose = (next: HelmetVariant) => {
    setVariant(next)
    setPicking(false)
    setFailed(false)
    if (hidden) toggleHidden()
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

  if (!spot) return null
  const size = layout.size
  const top = spot.top + layout.dy
  const left = spot.left + layout.dx
  return createPortal(
    <>
      {!hidden && !failed && (
        <div className="gear-helmet" style={{ top, left, width: size, height: size, margin: `${-size / 2 - 3}px 0 0 ${-size - 6}px` }} aria-hidden="true">
          <canvas ref={canvasRef} />
        </div>
      )}
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
            <button key={helmet.id} type="button" role="menuitemradio" aria-checked={helmet.id === variant.id && !hidden} className={`gear-helmet-option${helmet.id === variant.id && !hidden ? ' active' : ''}`} onClick={() => choose(helmet)}>
              <span>{uiText(helmet.label)}</span>{helmet.id === variant.id && !hidden && <Check size={13} />}
            </button>
          ))}
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
