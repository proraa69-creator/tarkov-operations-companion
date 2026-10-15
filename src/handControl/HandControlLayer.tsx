import { useEffect, useRef } from 'react'
import { Hand, Square } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { CALIBRATION_TARGETS } from './calibration'
import { handControl } from './handControlStore'
import { useHandControl } from './edition'
import { ghostPose } from './ghostPose'
import { HAND_BONES, type HandFrame } from './types'
import './handControl.css'

const FADE_MS = 320
/**
 * The drawn hand is redrawn every display frame and eases towards the latest tracked pose
 * (time constant below), so it glides between camera frames instead of stepping from one to the
 * next — smooth on a 60/144 Hz monitor even when the camera gives 30 frames per second.
 */
const EASE_MS = 22

type P3 = { x: number; y: number; z: number }

/** Moves `current` towards `target` by `k` (0..1); a missing or reshaped pose snaps. */
function ease(current: P3[] | null, target: P3[] | null, k: number): P3[] | null {
  if (!target) return null
  if (!current || current.length !== target.length) return target.map((point) => ({ ...point }))
  for (let i = 0; i < target.length; i++) {
    current[i].x += (target[i].x - current[i].x) * k
    current[i].y += (target[i].y - current[i].y) * k
    current[i].z += (target[i].z - current[i].z) * k
  }
  return current
}
const BRASS = [223, 189, 112] as const
const TRACKING_LABEL = { none: 'руки нет', weak: 'слабый трекинг', good: 'трекинг хороший' } as const
const CALIBRATION_HINTS = {
  hold: 'Направьте указательный палец на светящуюся точку — туда где она на самом деле на экране — и задержите руку. На нарисованную руку не смотрите.',
  move: 'Отлично. Теперь направьте палец на следующую точку.',
  lost: 'Камера не видит руку. Поднесите ладонь в кадр.',
  point: 'Вытяните указательный палец — он и есть указатель.',
  retry: 'Точки не сошлись — пройдём ещё раз. Целитесь пальцем точно в каждую точку.',
} as const
const CALIBRATION_TITLES = [
  'Калибровка 1/5: левый верхний угол',
  'Калибровка 2/5: правый верхний угол',
  'Калибровка 3/5: правый нижний угол',
  'Калибровка 4/5: левый нижний угол',
  'Калибровка 5/5: центр экрана',
] as const

/**
 * Ghost hand / finger cursor drawn over Raid OS. The canvas never takes pointer events;
 * only the small status chip (Stop) is clickable, by mouse or by hand.
 */
export function HandControlLayer() {
  const snapshot = useHandControl()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvas3dRef = useRef<HTMLCanvasElement>(null)
  const cursorStyle = snapshot.settings.cursor
  const active = snapshot.status !== 'off'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let latest: HandFrame | null = null
    let shown: HandFrame | null = null
    let second: HandFrame | null = null
    let lostAt = 0
    let raf = 0
    let drawnAt = 0
    let smooth: P3[] | null = null
    let smoothSecond: P3[] | null = null
    let smoothPointer: P3 | null = null
    // The 3D hand loads on demand; until then (or if WebGL is unavailable) the outline is drawn.
    let hand3d: import('./hand3d').Hand3D | null = null
    let disposed = false
    if (cursorStyle === 'hand3d' && canvas3dRef.current) {
      const target = canvas3dRef.current
      void import('./hand3d').then(({ Hand3D }) => Hand3D.create(target)).then((created) => {
        if (disposed) created.dispose()
        else hand3d = created
      }, (error) => console.warn('Hand Control: 3D hand unavailable', error))
    }

    const draw = () => {
      raf = 0
      const ratio = window.devicePixelRatio || 1
      const width = window.innerWidth
      const height = window.innerHeight
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      if (latest?.pointer) { shown = latest; lostAt = 0 }
      else if (shown && !lostAt) lostAt = performance.now()
      if (!shown?.pointer) { drawnAt = 0; return }
      const now = performance.now()
      const fade = lostAt ? 1 - (now - lostAt) / FADE_MS : 1
      if (fade <= 0) { shown = null; smooth = smoothSecond = null; smoothPointer = null; drawnAt = 0; hand3d?.render([], 0, width, height); return }
      // Ease the drawn pose towards the tracked one at display rate (see EASE_MS).
      const k = drawnAt ? 1 - Math.exp(-Math.min(100, now - drawnAt) / EASE_MS) : 1
      drawnAt = now
      smooth = ease(smooth, shown.skeleton, k)
      smoothSecond = ease(smoothSecond, second?.skeleton ?? null, k)
      smoothPointer = ease(smoothPointer ? [smoothPointer] : null, [{ ...shown.pointer, z: 0 }], k)![0]
      const view: HandFrame = { ...shown, skeleton: smooth, pointer: { x: smoothPointer.x, y: smoothPointer.y } }
      const alpha = fade * (shown.tracking === 'good' || lostAt ? 1 : 0.55)
      if (cursorStyle !== 'finger' && view.skeleton && view.hand) {
        // The second hand (if enabled and in view) is drawn the same way; it does not control.
        const hands = [view, ...(second && smoothSecond && !lostAt ? [{ ...second, skeleton: smoothSecond }] : [])]
        if (hand3d) hand3d.render(hands.map((frame) => ({ points: ghostPose(frame, width, height), chirality: frame.chirality ?? 'right' })), alpha, width, height)
        else hands.forEach((frame, index) => drawGhost(context, frame, width, height, index ? alpha * 0.75 : alpha))
      }
      // With a drawn hand the fingertip is the pointer; the ring is only for the "cursor" view.
      if (cursorStyle === 'finger' || !view.skeleton) drawCursor(context, view, width, height, alpha, Boolean(lostAt))
      // Keep drawing while the hand is shown: the eased pose keeps moving between camera frames.
      raf = requestAnimationFrame(draw)
    }

    const off = handControl.onFrame((frame, other) => {
      latest = frame
      second = other
      if (!raf) raf = requestAnimationFrame(draw)
    })
    const onResize = () => { if (!raf) raf = requestAnimationFrame(draw) }
    window.addEventListener('resize', onResize)
    return () => {
      disposed = true
      off()
      window.removeEventListener('resize', onResize)
      if (raf) cancelAnimationFrame(raf)
      hand3d?.dispose()
    }
  }, [cursorStyle, active])

  useEffect(() => {
    // Escape inside Raid OS (only when its window has focus) also stops hand control.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') handControl.stop() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (snapshot.status === 'off') return null
  const tracking = snapshot.frame?.tracking ?? 'none'
  const step = snapshot.calibration.step

  return (
    <>
      {/* While calibrating the drawn hand is hidden: it still uses the old map, and chasing it
          instead of pointing at the real target would just reproduce the old calibration. */}
      {cursorStyle === 'hand3d' ? <canvas key="hand3d" ref={canvas3dRef} className={`hand-layer hand-layer--3d${step !== null ? ' hand-layer--hidden' : ''}`} aria-hidden="true" /> : null}
      <canvas ref={canvasRef} className={`hand-layer${step !== null ? ' hand-layer--hidden' : ''}`} aria-hidden="true" />
      {step !== null ? (
        <div className="hand-calibration" role="status">
          <div className="hand-calibration-target" style={{ left: `${CALIBRATION_TARGETS[step].x * 100}vw`, top: `${CALIBRATION_TARGETS[step].y * 100}vh` }} />
          {/* The card sits in the middle, or near the top while the centre dot is the target. */}
          <div className={`hand-calibration-card${CALIBRATION_TARGETS[step].x === 0.5 ? ' hand-calibration-card--top' : ''}`}>
            <strong>{uiText(CALIBRATION_TITLES[step])}</strong>
            <span>{uiText(CALIBRATION_HINTS[snapshot.calibration.hint])}</span>
            <div className="hand-calibration-bar"><i style={{ width: `${Math.round(snapshot.calibration.progress * 100)}%` }} /></div>
            <button className="button ghost" onClick={() => handControl.cancelCalibration()}>{uiText('Отмена')}</button>
          </div>
        </div>
      ) : null}
      <div className={`hand-chip hand-chip--${snapshot.status === 'on' ? tracking : snapshot.status}`} role="status">
        <Hand size={15} />
        <span className="hand-chip-title">Hand Control</span>
        <span className="hand-chip-state">{uiText(snapshot.status === 'starting' ? 'запуск камеры…' : snapshot.status === 'error' ? 'ошибка камеры' : TRACKING_LABEL[tracking])}</span>
        {snapshot.stats && snapshot.status === 'on' ? <span className="hand-chip-fps mono">{snapshot.stats.fps} fps</span> : null}
        <button className="hand-chip-stop" onClick={() => handControl.stop()} aria-label={uiText('Остановить Hand Control')}>
          <Square size={11} />{uiText('Стоп')}
        </button>
      </div>
    </>
  )
}

function drawGhost(context: CanvasRenderingContext2D, frame: HandFrame, width: number, height: number, alpha: number) {
  const points = ghostPose(frame, width, height)
  const at = (index: number) => [points[index].x, points[index].y] as const
  const size = (index: number) => Math.max(2, Math.min(8, 5.5 + points[index].z * 0.08))

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.shadowColor = `rgba(${BRASS.join(',')}, ${0.45 * alpha})`
  context.shadowBlur = 14
  context.strokeStyle = `rgba(${BRASS.join(',')}, ${0.42 * alpha})`
  context.lineWidth = 9
  for (const [a, b] of HAND_BONES) {
    context.beginPath()
    context.moveTo(...at(a))
    context.lineTo(...at(b))
    context.stroke()
  }
  context.shadowBlur = 0
  context.strokeStyle = `rgba(237, 242, 237, ${0.55 * alpha})`
  context.lineWidth = 1.6
  for (const [a, b] of HAND_BONES) {
    context.beginPath()
    context.moveTo(...at(a))
    context.lineTo(...at(b))
    context.stroke()
  }
  context.fillStyle = `rgba(237, 242, 237, ${0.7 * alpha})`
  for (let index = 0; index < points.length; index++) {
    context.beginPath()
    context.arc(...at(index), size(index) / 2, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function drawCursor(context: CanvasRenderingContext2D, frame: HandFrame, width: number, height: number, alpha: number, fading: boolean) {
  const x = frame.pointer!.x * width
  const y = frame.pointer!.y * height
  const radius = frame.phase === 'press' ? 9 : 13 - frame.pressProgress * 3
  context.save()
  context.globalAlpha = alpha
  context.shadowColor = 'rgba(0, 0, 0, .55)'
  context.shadowBlur = 6
  context.fillStyle = frame.phase === 'press' ? `rgba(${BRASS.join(',')}, .95)` : 'rgba(237, 242, 237, .9)'
  context.beginPath()
  context.arc(x, y, 3.5, 0, Math.PI * 2)
  context.fill()
  context.shadowBlur = 0
  context.lineWidth = 2
  context.strokeStyle = 'rgba(237, 242, 237, .35)'
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.stroke()
  if (!fading && frame.phase !== 'scroll' && frame.pressProgress > 0.02) {
    // Poke depth: the ring fills as the finger moves towards the screen.
    context.strokeStyle = `rgba(${BRASS.join(',')}, .95)`
    context.lineWidth = 3
    context.beginPath()
    context.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frame.pressProgress)
    context.stroke()
  }
  if (frame.phase === 'scroll') {
    context.fillStyle = `rgba(${BRASS.join(',')}, .95)`
    for (const direction of [-1, 1]) {
      context.beginPath()
      context.moveTo(x - 6, y + direction * 18)
      context.lineTo(x + 6, y + direction * 18)
      context.lineTo(x, y + direction * 25)
      context.closePath()
      context.fill()
    }
  }
  context.restore()
}
