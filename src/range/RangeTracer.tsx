import { useEffect, useState } from 'react'
import { FIGURE_HEIGHT } from './rangeHitboxes'

/**
 * One point of a shot's flight: as the shooter sees it on the target's plane (figure cm, y up), its height against the line of sight
 * (cm), time, speed, energy (J) and the distance flown.
 */
export interface TracerPoint { x: number; y: number; drop: number; time: number; speed: number; energy: number; distance: number }
export interface Tracer { id: number; points: TracerPoint[] }

/** How long the whole path stays after the bullet has arrived, seconds. */
const LINGER = 1.2

/**
 * A single shot's bullet in flight, at its real speed, as a tracer looks through the scope in the game (owner, 23.11.2026:
 * «показывай траекторию полета пули в реальном времени, когда стреляешь одиночным режимом… с соответствующей скоростью»; «нужно
 * сделать в точности как у них»): the trajectory seen from the eye — each point's height against the line of sight carried to the
 * target's plane, so the bullet rises from under the scope, crosses the line of sight at the zero and falls onto the target where
 * the shot lands; a bright streak moving by the trajectory's own time, the path behind it; the time, speed and distance under it.
 */
export function RangeTracer({ tracer, viewBox, lang }: { tracer: Tracer; viewBox: string; lang: 'ru' | 'en' }) {
  const [elapsed, setElapsed] = useState(0)
  const points = tracer.points
  const total = points[points.length - 1]?.time ?? 0
  useEffect(() => {
    let frame = 0
    const start = performance.now()
    const tick = () => {
      const seconds = (performance.now() - start) / 1000
      setElapsed(seconds)
      if (seconds < total + LINGER) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [total])
  if (!points.length || elapsed >= total + LINGER) return null
  const now = Math.min(elapsed, total)
  const next = points.findIndex((point) => point.time >= now)
  const after = points[Math.max(0, next)]!
  const before = points[Math.max(0, next - 1)]!
  const f = after.time === before.time ? 1 : (now - before.time) / (after.time - before.time)
  const mix = (a: number, b: number) => a + (b - a) * f
  const head = { x: mix(before.x, after.x), y: mix(before.y, after.y), drop: mix(before.drop, after.drop), speed: mix(before.speed, after.speed), energy: mix(before.energy, after.energy), distance: mix(before.distance, after.distance) }
  const trail = [...points.slice(0, Math.max(0, next)), head].map((point) => `${point.x},${FIGURE_HEIGHT - point.y}`).join(' ')
  // the streak: where the bullet was a few hundredths of a second ago, to where it is
  const back = Math.max(0, now - 0.03)
  const backNext = points.findIndex((point) => point.time >= back)
  const b1 = points[Math.max(0, backNext)]!
  const b0 = points[Math.max(0, backNext - 1)]!
  const bf = b1.time === b0.time ? 1 : (back - b0.time) / (b1.time - b0.time)
  const tail = { x: b0.x + (b1.x - b0.x) * bf, y: b0.y + (b1.y - b0.y) * bf }
  const fading = elapsed > total ? 1 - (elapsed - total) / LINGER : 1
  const seconds = lang === 'en' ? 's' : 'с'
  const perSecond = lang === 'en' ? 'm/s' : 'м/с'
  const metres = lang === 'en' ? 'm' : 'м'
  const number = (value: number, digits: number) => value.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return <>
    <svg className="range-scope-world range-scope-tracer" viewBox={viewBox} preserveAspectRatio="xMidYMid slice" style={{ opacity: fading }}>
      <polyline points={trail} className="is-trail" />
      {elapsed < total && <line x1={tail.x} x2={head.x} y1={FIGURE_HEIGHT - tail.y} y2={FIGURE_HEIGHT - head.y} className="is-head" />}
    </svg>
    <div className="range-tracer-readout" style={{ opacity: fading }}>
      {number(now, 2)} {seconds} · {Math.round(head.speed)} {perSecond} · {number(Math.round(head.energy), 0)} {lang === 'en' ? 'J' : 'Дж'} · {head.drop < 0 ? '↓' : '↑'} {Math.abs(head.drop) >= 100 ? `${number(Math.abs(head.drop) / 100, 2)} ${metres}` : `${number(Math.abs(head.drop), 1)} ${lang === 'en' ? 'cm' : 'см'}`} · {Math.round(head.distance)} {metres}
    </div>
  </>
}
