import { useEffect, useRef } from 'react'
import { Hand, Square } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { handControl } from './handControlStore'
import { useHandControl } from './edition'
import { HAND_BONES, LM, type HandFrame } from './types'
import './handControl.css'

const FADE_MS = 320
const GHOST_PALM_PX = 58
const BRASS = [223, 189, 112] as const
const TRACKING_LABEL = { none: 'руки нет', weak: 'слабый трекинг', good: 'трекинг хороший' } as const

/**
 * Ghost hand / finger cursor drawn over Raid OS. The canvas never takes pointer events;
 * only the small status chip (Stop) is clickable, by mouse or by hand.
 */
export function HandControlLayer() {
  const snapshot = useHandControl()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorStyle = snapshot.settings.cursor
  const active = snapshot.status !== 'off'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let latest: HandFrame | null = null
    let shown: HandFrame | null = null
    let lostAt = 0
    let raf = 0

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
      if (!shown?.pointer) return
      const fade = lostAt ? 1 - (performance.now() - lostAt) / FADE_MS : 1
      if (fade <= 0) { shown = null; return }
      const alpha = fade * (shown.tracking === 'good' || lostAt ? 1 : 0.55)
      if (cursorStyle === 'ghost' && shown.skeleton) drawGhost(context, shown, width, height, alpha)
      drawCursor(context, shown, width, height, alpha, Boolean(lostAt))
      if (lostAt) raf = requestAnimationFrame(draw)
    }

    const off = handControl.onFrame((frame) => {
      latest = frame
      if (!raf) raf = requestAnimationFrame(draw)
    })
    const onResize = () => { if (!raf) raf = requestAnimationFrame(draw) }
    window.addEventListener('resize', onResize)
    return () => { off(); window.removeEventListener('resize', onResize); if (raf) cancelAnimationFrame(raf) }
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
      <canvas ref={canvasRef} className="hand-layer" aria-hidden="true" />
      {step ? (
        <div className={`hand-calibration hand-calibration--${step}`} role="status">
          <div className="hand-calibration-target" />
          <div className="hand-calibration-card">
            <strong>{uiText(step === 'top-left' ? 'Калибровка 1/2: левый верхний угол' : 'Калибровка 2/2: правый нижний угол')}</strong>
            <span>{uiText('Наведите указательный палец в удобную точку для этого угла и держите руку неподвижно.')}</span>
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
  const points = frame.skeleton!
  // The hand keeps its real shape but is drawn at a comfortable size anchored on the cursor,
  // growing slightly as it comes closer to the screen (depth), like a VR hand.
  const px = (index: number) => [points[index].x * width, points[index].y * height] as const
  const [tipX, tipY] = px(LM.INDEX_TIP)
  const [wristX, wristY] = px(LM.WRIST)
  const [palmX, palmY] = px(LM.MIDDLE_MCP)
  const palm = Math.hypot(palmX - wristX, palmY - wristY) || 1
  const scale = Math.min(3, Math.max(0.15, (GHOST_PALM_PX * Math.exp(frame.depth * 3)) / palm))
  const cursorX = frame.pointer!.x * width
  const cursorY = frame.pointer!.y * height
  const at = (index: number) => {
    const [x, y] = px(index)
    return [cursorX + (x - tipX) * scale, cursorY + (y - tipY) * scale] as const
  }
  const wristZ = points[LM.WRIST].z
  const size = (index: number) => Math.max(2, (5.5 - (points[index].z - wristZ) * 40) * Math.min(1.4, Math.max(0.7, Math.exp(frame.depth * 3))))

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
    if (index === LM.INDEX_TIP) continue
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
