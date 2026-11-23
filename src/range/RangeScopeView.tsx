import { useEffect, useRef, useState } from 'react'
import { FIGURE_HEIGHT } from './rangeHitboxes'
import { RangeScene, type SceneProps } from './RangeTarget'
import { fovMrad, holdBarHalfCm, mradToCm, reticleAt, tickAt, type ScopeMode } from './rangeScope'
import { swayAt, useSwayTime } from './rangeSway'
import { RangeTracer, type Tracer } from './RangeTracer'

/**
 * The target seen through a scope (owner, 22.11.2026: «в режиме прицела… выставлять персонажей на дистанции… я поставил 600
 * метров, значит, персонаж стоит на дистанции 600 метров… Чтобы я мог прицелиться в прицел, выбрав сетку нужную, и проверить,
 * попадаю я или нет»): the field of view of the scope at its magnification, the character at its real angular size for the
 * distance, the reticle fixed in the middle. «Войти в прицел» takes the mouse (owner, 23.11.2026: «Нужно, чтобы кнопка была войти в
 * прицел, и можно было шевелить вверх-вниз, как в игре»): moving it turns the view, holding the left button fires, the wheel
 * turns a variable scope's magnification, Esc, the right button or «Выйти из прицела» leaves. Where the page may not take the
 * mouse, it turns the view while the cursor moves over the scope. The recoil and the sway turn the view as they turn the barrel.
 *
 * The wheel (owner, 23.11.2026: «Регулировка кратности происходит роликом… окно не должно… ездить… Если кратность меняется
 * только либо 1, либо 6, то меняется кратность… резко. Если… плавно, то… плавно роликом»): a variable mode turns smoothly, a
 * scope of fixed magnifications steps to the next one; in the scope the page under it never scrolls.
 */
export function RangeScopeView({ scene, distance, mode, modes, modeIndex, onMode, zoom, onZoom, reticleUrls, boreCm, viewCm, dropCm, swayCm, irons, tracer, onFireStart, onFireEnd, onAim, lang }: {
  scene: SceneProps
  distance: number
  mode: ScopeMode
  /** All the scope's modes and the one in use: the wheel steps between fixed magnifications. */
  modes: ScopeMode[]
  modeIndex: number
  onMode: (index: number) => void
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
  /** The sway's amplitude at the target, cm (src/range/rangeSway.ts); 0 or absent: off. */
  swayCm?: number
  /** No optic: the view at ×1 through the open sights, a frame instead of a scope's circle. */
  irons?: boolean
  /** The last single shot's bullet in flight (src/range/RangeTracer.tsx), when «Траектория» is on. */
  tracer?: Tracer | null
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
  const swayTime = useSwayTime(Boolean(swayCm))
  const sway = swayCm ? swayAt(swayTime, swayCm) : { x: 0, y: 0 }
  const centre = { x: aim.x + viewCm.x + sway.x, y: aim.y + viewCm.y + sway.y }
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
  const zoomRef = useRef({ mode, modes, modeIndex, onMode, zoom, onZoom, inside })
  useEffect(() => { zoomRef.current = { mode, modes, modeIndex, onMode, zoom, onZoom, inside } }, [mode, modes, modeIndex, onMode, zoom, onZoom, inside])
  useEffect(() => {
    const element = box.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      const { mode: now, modes: all, modeIndex: index, onMode: switchMode, zoom: current, onZoom: change, inside: entered } = zoomRef.current
      const up = event.deltaY < 0
      if (now.zoomMax && now.zoomMax > now.zoom) {
        event.preventDefault()
        const step = (now.zoomMax - now.zoom) / 12
        change(Math.max(now.zoom, Math.min(now.zoomMax, current + (up ? step : -step))))
        return
      }
      // fixed magnifications: the next one up or down, at once (the first mode of each magnification)
      const next = nextFixedMode(all, index, up)
      if (next !== undefined) { event.preventDefault(); switchMode(next); return }
      if (entered) event.preventDefault()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])
  const leave = () => {
    fireEndRef.current()
    if (document.pointerLockElement === box.current) document.exitPointerLock()
    else setInside(null)
  }
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
  // where the bullet lands now: the reticle's centre with the drop at this distance, drawn over the night and thermal filters —
  // a plain bar that stands out from the reticle (owner, 23.11.2026: «Сделай просто полосочку понятную… Если прицел красный,
  // то сделай ее черной. Если прицел черный, сделай ее красной»)
  const impact = { x: centre.x + (boreCm.x - viewCm.x), y: FIGURE_HEIGHT - (centre.y + (boreCm.y - viewCm.y) + dropCm) }
  // a little wider than the reticle's marks and a little thicker than its lines (owner, 23.11.2026: «ее нужно сделать меньше намного…
  // немного шире самой сетки рисок и чуть-чуть толще»)
  const barHalf = holdBarHalfCm(fovCm, distance, irons ? undefined : tickAt(mode, zoom))
  return <div
    ref={box}
    className={`range-scope${locked ? ' is-locked' : ''}${irons ? ' is-irons' : ''}`}
    onMouseDown={(event) => {
      if (!locked) return
      // the right button leaves the scope, as aiming ends in the game
      if (event.button === 2) { event.preventDefault(); leave(); return }
      if (event.button !== 0) return
      event.preventDefault()
      onFireStart(aimRef.current)
    }}
    onContextMenu={(event) => { if (locked) event.preventDefault() }}
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
    <svg className={`range-scope-world range-scope-impact${mode.reticleRed ? ' is-black' : ' is-red'}`} viewBox={viewBox} preserveAspectRatio="xMidYMid slice">
      <line x1={impact.x - barHalf} x2={impact.x + barHalf} y1={impact.y} y2={impact.y} className="is-halo" />
      <line x1={impact.x - barHalf} x2={impact.x + barHalf} y1={impact.y} y2={impact.y} className="is-bar" />
    </svg>
    {tracer && <RangeTracer key={tracer.id} tracer={tracer} viewBox={viewBox} lang={lang} />}
    {locked && <div className="range-scope-hint">{lang === 'en' ? 'Left button — fire · wheel — zoom · R — reload · F — new target · right button or Esc — leave' : 'ЛКМ — огонь · колесо — кратность · R — перезарядка · F — новая цель · ПКМ или Esc — выйти'}</div>}
    {inside === 'free' && <button type="button" className="button range-scope-leave" onMouseDown={(event) => event.stopPropagation()} onClick={leave}>{lang === 'en' ? 'Leave the scope' : 'Выйти из прицела'}</button>}
    {!locked && <button type="button" className="button primary range-scope-enter" onMouseDown={(event) => event.stopPropagation()} onClick={enter}>{irons ? (lang === 'en' ? 'Aim' : 'Прицелиться') : (lang === 'en' ? 'Enter the scope' : 'Войти в прицел')}</button>}
  </div>
}

/** The scope's next fixed magnification up or down from the mode in use (the first mode of each), if any. */
function nextFixedMode(modes: ScopeMode[], index: number, up: boolean): number | undefined {
  const current = modes[index]?.zoom
  if (current === undefined || modes.length < 2) return undefined
  const firsts = new Map<number, number>()
  modes.forEach((entry, at) => { if (!firsts.has(entry.zoom)) firsts.set(entry.zoom, at) })
  const zooms = [...firsts.keys()].sort((a, b) => a - b)
  const next = zooms[zooms.indexOf(current) + (up ? 1 : -1)]
  return next === undefined ? undefined : firsts.get(next)
}
