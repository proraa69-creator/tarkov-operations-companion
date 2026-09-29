import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HelmetHandle } from './helmet3d'

const OVERVIEW = '.sidebar .nav-link[href="#/"]'

/**
 * The 3D helmet next to the «Обзор» / Overview item. The three.js module is fetched on first use only.
 * It sits in the free space at the right end of the item, so the label is never covered.
 */
export function HelmetBadge({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const update = () => {
      const link = document.querySelector(OVERVIEW)
      const rect = link?.getBoundingClientRect()
      // hidden when the sidebar is collapsed to icons
      setSpot(rect && rect.width > 150 ? { top: rect.top + rect.height / 2, left: rect.right } : null)
    }
    update()
    const sidebar = document.querySelector('.sidebar')
    const ro = new ResizeObserver(update)
    if (sidebar) ro.observe(sidebar)
    window.addEventListener('resize', update)
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  }, [])

  const visible = !!spot
  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible || !canvas) return
    let handle: HelmetHandle | null = null
    let cancelled = false
    import('./helmet3d')
      .then(({ mountHelmet }) => { if (!cancelled) handle = mountHelmet(canvas, { reduced }) })
      .catch(() => setFailed(true))
    const onMove = (event: PointerEvent) => {
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
      handle?.dispose()
    }
  }, [visible, reduced])

  if (!spot || failed) return null
  return createPortal(
    <div className="gear-helmet" style={{ top: spot.top, left: spot.left }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>,
    document.body,
  )
}
