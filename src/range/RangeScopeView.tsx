import { useEffect, useRef, useState } from 'react'
import { FIGURE_HEIGHT } from './rangeHitboxes'
import { RangeScene, type SceneProps } from './RangeTarget'
import { fovMrad, mradToCm, reticleAt, type ScopeMode } from './rangeScope'

/**
 * The target seen through a scope (owner, 22.11.2026: «в режиме прицела… выставлять персонажей на дистанции… я поставил 600
 * метров, значит, персонаж стоит на дистанции 600 метров… Чтобы я мог прицелиться в прицел, выбрав сетку нужную, и проверить,
 * попадаю я или нет»): the field of view of the scope at its magnification, the character at its real angular size for the
 * distance, the reticle fixed in the middle. «Войти в прицел» takes the mouse (owner, 23.11.2026: «Нужно, чтобы кнопка была войти в
 * прицел, и можно было шевелить вверх-вниз, как в игре»): moving it turns the view, holding the left button fires, the wheel
 * turns a variable scope's magnification, Esc leaves. Where the page may not take the mouse, it turns the view while the
 * cursor moves over the scope. The recoil turns the view as it turns the barrel.
 */
export function RangeScopeView({ scene, distance, mode, zoom, onZoom, reticleUrls, boreCm, viewCm, dropCm, onFireStart, onFireEnd, onAim, lang }: {
  scene: SceneProps
  distance: number
  mode: ScopeMode
  /** The magnification now (a variable scope's wheel). */
  zoom: number
  onZoom: (zoom: number) => void
  /** The reticle pictures' addresses by file. */
  reticleUrls: Record<string, string>
  /** The bullet against the sight line at the target, cm: where it lands is shown under the reticle. */
  dropCm: number
  /** The barrel's and the view's turn by the recoil, centimetres at the target (the reticle is on the barrel). */
  boreCm: { x: number; y: number }
  viewCm: { x: number; y: number }
  onFireStart: (point: { x: number; y: number }) => void
  onFireEnd: () => void
  /** Where the reticle's centre is on the target's plane (figure centimetres, without the recoil). */
  onAim: (point: { x: number; y: number }) => void
  lang: 'ru' | 'en'
}) {
  const box = useRef<HTMLDivElement>(null)
  const [aim, setAim] = useState({ x: 0, y: 130 })
  /** In the scope: the mouse taken ('locked'), or turning the view as the cursor moves over it ('free'). */
  const [inside, setInside] = useState<'locked' | 'free' | null>(null)
  const locked = inside !== null
  // the view's width in mrad at the magnification now: the field of view narrows as the magnification grows
  const fov = fovMrad(mode.fovDeg) * (mode.zoom / zoom)
  const fovCm = mradToCm(fov, distance)
  const centre = { x: aim.x + viewCm.x, y: aim.y + viewCm.y }
  // the reticle moves on the screen by how far the barrel is off the view
  const reticleShift = { x: (boreCm.x - viewCm.x) / fovCm * 100, y: -(boreCm.y - viewCm.y) / fovCm * 100 }
  // a first focal plane reticle grows with the magnification; a second focal plane one keeps its size on the screen
  const reticle = reticleAt(mode, zoom)
  const reticleUrl = reticle.file ? reticleUrls[reticle.file] : undefined
  const reticleShare = reticle.mrad ? (mode.ffp ? reticle.mrad / fov : reticle.mrad / fovMrad(mode.fovDeg)) : 1

  const aimRef = useRef(aim)
  useEffect(() => { aimRef.current = aim; onAim(aim) }, [aim, onAim])
  const fireEndRef = useRef(onFireEnd)
  useEffect(() => { fireEndRef.current = onFireEnd }, [onFireEnd])
  useEffect(() => {
    const element = box.current
    const onLock = () => {
      if (document.pointerLockElement === element) { setInside('locked'); return }
      setInside((now) => {
        if (now !== 'locked') return now
        fireEndRef.current()
        return null
      })
    }
    // the page may not take the mouse: the view turns with the cursor over the scope instead
    const onLockRefused = () => setInside('free')
    document.addEventListener('pointerlockchange', onLock)
    document.addEventListener('pointerlockerror', onLockRefused)
    return () => {
      document.removeEventListener('pointerlockchange', onLock)
      document.removeEventListener('pointerlockerror', onLockRefused)
      if (element && document.pointerLockElement === element) document.exitPointerLock()
    }
  }, [])
  useEffect(() => {
    if (!inside) return
    const onMove = (event: MouseEvent) => {
      const size = box.current?.clientWidth ?? 600
      // a screen pixel turns the view by its share of the field
      const perPixel = fovCm / size
      setAim((current) => ({ x: current.x + event.movementX * perPixel, y: current.y - event.movementY * perPixel }))
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || inside !== 'free') return
      fireEndRef.current()
      setInside(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('keydown', onKey)
    }
  }, [inside, fovCm])
  // the wheel turns the magnification, not the page under the scope (React's wheel listener cannot hold the page)
  const zoomRef = useRef({ mode, zoom, onZoom })
  useEffect(() => { zoomRef.current = { mode, zoom, onZoom } }, [mode, zoom, onZoom])
  useEffect(() => {
    const element = box.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      const { mode: now, zoom: current, onZoom: change } = zoomRef.current
      if (!now.zoomMax || now.zoomMax <= now.zoom) return
      event.preventDefault()
      const step = (now.zoomMax - now.zoom) / 12
      change(Math.max(now.zoom, Math.min(now.zoomMax, current - Math.sign(event.deltaY) * step)))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])
  const enter = () => {
    const element = box.current
    if (!element?.requestPointerLock) { setInside('free'); return }
    try {
      const request = element.requestPointerLock() as unknown
      if (request instanceof Promise) request.catch(() => setInside('free'))
    } catch {
      setInside('free')
    }
  }

  const half = fovCm / 2
  const markRadius = Math.max(0.6, fovCm / 260)
  const viewBox = `${centre.x - half} ${FIGURE_HEIGHT - centre.y - half} ${fovCm} ${fovCm}`
  // where the bullet lands now: the reticle's centre with the drop at this distance (owner, 23.11.2026: «более ярко выраженной
  // красной обводкой»), drawn over the night and thermal filters
  const impact = { x: centre.x + (boreCm.x - viewCm.x), y: FIGURE_HEIGHT - (centre.y + (boreCm.y - viewCm.y) + dropCm) }
  const impactRadius = fovCm * 0.022
  return <div
    ref={box}
    className={`range-scope${locked ? ' is-locked' : ''}`}
    onMouseDown={(event) => {
      if (event.button !== 0 || !locked) return
      event.preventDefault()
      onFireStart(aimRef.current)
    }}
    onMouseUp={() => { if (locked) onFireEnd() }}
    onMouseLeave={() => {
      if (inside !== 'free') return
      onFireEnd()
      setInside(null)
    }}
  >
    <svg className={`range-scope-world${mode.night ? ' is-night' : ''}${mode.thermal ? ' is-thermal' : ''}`} viewBox={viewBox} preserveAspectRatio="xMidYMid slice">
      <rect x={centre.x - fovCm * 2} y={FIGURE_HEIGHT - centre.y - fovCm * 2} width={fovCm * 4} height={fovCm * 4} className="range-scope-sky" />
      <rect x={centre.x - fovCm * 2} y={FIGURE_HEIGHT} width={fovCm * 4} height={fovCm * 4} className="range-scope-grass" />
      <RangeScene {...scene} markRadius={markRadius} />
    </svg>
    {reticleUrl
      ? <img className="range-scope-reticle" src={reticleUrl} alt="" style={{ width: `${reticleShare * 100}%`, height: `${reticleShare * 100}%`, left: `${50 + reticleShift.x}%`, top: `${50 + reticleShift.y}%` }} />
      : <svg className="range-scope-reticle is-drawn" viewBox="-50 -50 100 100" style={{ left: `${50 + reticleShift.x}%`, top: `${50 + reticleShift.y}%` }}><path d="M-50 0H-3M3 0H50M0 -50V-3M0 3V50" /></svg>}
    <svg className="range-scope-world range-scope-impact" viewBox={viewBox} preserveAspectRatio="xMidYMid slice">
      <circle cx={impact.x} cy={impact.y} r={impactRadius} className="is-halo" />
      <circle cx={impact.x} cy={impact.y} r={impactRadius} className="is-ring" />
      <circle cx={impact.x} cy={impact.y} r={impactRadius * 0.16} className="is-dot" />
    </svg>
    {locked
      ? <div className="range-scope-hint">{lang === 'en' ? 'Left button — fire · wheel — zoom · Esc — leave' : 'ЛКМ — огонь · колесо — кратность · Esc — выйти'}</div>
      : <button type="button" className="button primary range-scope-enter" onMouseDown={(event) => event.stopPropagation()} onClick={enter}>{lang === 'en' ? 'Enter the scope' : 'Войти в прицел'}</button>}
  </div>
}
