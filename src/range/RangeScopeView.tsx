import { useEffect, useRef, useState } from 'react'
import { FIGURE_HEIGHT } from './rangeHitboxes'
import { RangeScene, type SceneProps } from './RangeTarget'
import { fovMrad, mradToCm, type ScopeMode } from './rangeScope'

/**
 * The target seen through a scope (owner, 22.11.2026: «в режиме прицела… выставлять персонажей на дистанции… я поставил 600
 * метров, значит, персонаж стоит на дистанции 600 метров… Чтобы я мог прицелиться в прицел, выбрав сетку нужную, и проверить,
 * попадаю я или нет»): the field of view of the scope at its magnification, the character at its real angular size for the
 * distance, the reticle fixed in the middle. A click takes the mouse (Esc gives it back); moving it turns the view; holding the
 * button fires. The recoil turns the view as it turns the barrel.
 */
export function RangeScopeView({ scene, distance, mode, zoom, onZoom, reticleUrl, boreCm, viewCm, onFireStart, onFireEnd, onAim, lang }: {
  scene: SceneProps
  distance: number
  mode: ScopeMode
  /** The magnification now (a variable scope's wheel). */
  zoom: number
  onZoom: (zoom: number) => void
  reticleUrl?: string
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
  const [locked, setLocked] = useState(false)
  // the view's width in mrad at the magnification now: the field of view narrows as the magnification grows
  const fov = fovMrad(mode.fovDeg) * (mode.zoom / zoom)
  const fovCm = mradToCm(fov, distance)
  const centre = { x: aim.x + viewCm.x, y: aim.y + viewCm.y }
  // the reticle moves on the screen by how far the barrel is off the view
  const reticleShift = { x: (boreCm.x - viewCm.x) / fovCm * 100, y: -(boreCm.y - viewCm.y) / fovCm * 100 }
  // a first focal plane reticle grows with the magnification; a second focal plane one keeps its size on the screen
  const reticleShare = mode.reticleMrad ? (mode.ffp ? mode.reticleMrad / fov : mode.reticleMrad / fovMrad(mode.fovDeg)) : 1

  const aimRef = useRef(aim)
  useEffect(() => { aimRef.current = aim; onAim(aim) }, [aim, onAim])
  useEffect(() => {
    const onLock = () => setLocked(document.pointerLockElement === box.current)
    document.addEventListener('pointerlockchange', onLock)
    return () => document.removeEventListener('pointerlockchange', onLock)
  }, [])
  useEffect(() => {
    if (!locked) return
    const onMove = (event: MouseEvent) => {
      const size = box.current?.clientWidth ?? 600
      // a screen pixel turns the view by its share of the field
      const perPixel = fovCm / size
      setAim((current) => ({ x: current.x + event.movementX * perPixel, y: current.y - event.movementY * perPixel }))
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [locked, fovCm])

  const half = fovCm / 2
  const markRadius = Math.max(0.6, fovCm / 260)
  return <div
    ref={box}
    className={`range-scope${locked ? ' is-locked' : ''}`}
    onMouseDown={(event) => {
      if (event.button !== 0) return
      if (!locked) { void box.current?.requestPointerLock?.(); return }
      onFireStart(aimRef.current)
    }}
    onMouseUp={() => { if (locked) onFireEnd() }}
    onWheel={(event) => {
      if (!mode.zoomMax || mode.zoomMax <= mode.zoom) return
      const step = (mode.zoomMax - mode.zoom) / 12
      onZoom(Math.max(mode.zoom, Math.min(mode.zoomMax, zoom - Math.sign(event.deltaY) * step)))
    }}
  >
    <svg className="range-scope-world" viewBox={`${centre.x - half} ${FIGURE_HEIGHT - centre.y - half} ${fovCm} ${fovCm}`} preserveAspectRatio="xMidYMid slice">
      <rect x={centre.x - fovCm * 2} y={FIGURE_HEIGHT - centre.y - fovCm * 2} width={fovCm * 4} height={fovCm * 4} className="range-scope-sky" />
      <rect x={centre.x - fovCm * 2} y={FIGURE_HEIGHT} width={fovCm * 4} height={fovCm * 4} className="range-scope-grass" />
      <RangeScene {...scene} markRadius={markRadius} />
    </svg>
    {reticleUrl
      ? <img className="range-scope-reticle" src={reticleUrl} alt="" style={{ width: `${reticleShare * 100}%`, height: `${reticleShare * 100}%`, left: `${50 + reticleShift.x}%`, top: `${50 + reticleShift.y}%` }} />
      : <svg className="range-scope-reticle is-drawn" viewBox="-50 -50 100 100" style={{ left: `${50 + reticleShift.x}%`, top: `${50 + reticleShift.y}%` }}><path d="M-50 0H-3M3 0H50M0 -50V-3M0 3V50" /></svg>}
    {!locked && <div className="range-scope-hint">{lang === 'en' ? 'Click to take the mouse · Esc gives it back · hold to fire' : 'Щелчок — захватить мышь · Esc — вернуть · зажать — огонь'}</div>}
  </div>
}
