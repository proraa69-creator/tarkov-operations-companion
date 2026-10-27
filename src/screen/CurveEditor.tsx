import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { uiText } from '../i18n/renderText'
import { curveFunction, fromShadowScale, screenTables, toShadowScale, type CurvePoint, type ScreenProfile } from './screenCurve'

export type CurveChannel = 'all' | 'r' | 'g' | 'b'
export type CurveScale = 'shadows' | 'linear'

const SIZE = 240
/** Marks under the graph: steps of 255, where Tarkov's dark tones are. */
const MARKS = [4, 8, 16, 32, 64, 128]

function withEnds(points: readonly CurvePoint[] | undefined): CurvePoint[] {
  const sorted = [...(points ?? [])].sort((a, b) => a.x - b.x)
  if (!sorted.length || sorted[0]!.x > 0) sorted.unshift({ x: 0, y: 0 })
  if (sorted[sorted.length - 1]!.x < 1) sorted.push({ x: 1, y: 1 })
  return sorted
}

const toStep = (value: number) => Math.round(value * 255)

/**
 * The curve (owner, 28.10.2026: «кривая работает снизу в углу, где неудобно… сильно резко, а наверху практически не
 * работает»). By default it is drawn on the «тени крупно» scale: steps 0…34 take half the graph both ways, so the dark
 * tones Tarkov is made of are as easy to move as the rest, and the straight line stays straight. Click to add a point,
 * drag it, double-click to remove; the chosen point can be typed in exactly (было → стало, steps 0…255) or moved a step at a
 * time with the arrow keys (Shift — five). The dashed line is the whole result (the sliders, zones and filters included).
 */
export function CurveEditor({ profile, channel, scale = 'shadows', onChange }: { profile: Omit<ScreenProfile, 'id' | 'name'>; channel: CurveChannel; scale?: CurveScale; onChange: (points: CurvePoint[]) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const view = scale === 'shadows' ? toShadowScale : (value: number) => value
  const back = scale === 'shadows' ? fromShadowScale : (value: number) => value
  const points = withEnds(channel === 'all' ? profile.curve : profile.channels?.[channel])
  const selected = chosen !== null && chosen < points.length ? chosen : null

  // Drawn by sampling on the scale itself, so a point anywhere on it shows its true shape.
  const samples = 96
  const line = (at: (value: number) => number) => Array.from({ length: samples + 1 }, (_, index) => {
    const x = index / samples
    return `${index ? 'L' : 'M'}${(x * SIZE).toFixed(1)},${((1 - view(at(back(x)))) * SIZE).toFixed(1)}`
  }).join(' ')
  const own = useMemo(() => { const curve = curveFunction(points); return line(curve) }, [points, scale]) // eslint-disable-line react-hooks/exhaustive-deps
  const result = useMemo(() => {
    const table = screenTables(profile)[channel === 'all' ? 'g' : channel]
    return line((value) => table[Math.min(255, Math.max(0, Math.round(value * 255)))]!)
  }, [profile, channel, scale]) // eslint-disable-line react-hooks/exhaustive-deps

  const at = (event: ReactPointerEvent) => {
    const box = svgRef.current!.getBoundingClientRect()
    return { x: back(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))), y: back(Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height))) }
  }
  /** Moves one point, kept between its neighbours; the ends move only up and down. */
  const place = (index: number, target: CurvePoint) => {
    const end = index === 0 || index === points.length - 1
    const min = end ? points[index]!.x : points[index - 1]!.x + 1 / 255, max = end ? points[index]!.x : points[index + 1]!.x - 1 / 255
    onChange(points.map((entry, other) => other === index ? { x: Math.min(max, Math.max(min, target.x)), y: Math.min(1, Math.max(0, target.y)) } : entry))
  }
  const move = (event: ReactPointerEvent) => { if (dragging !== null) place(dragging, at(event)) }
  const add = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.target !== svgRef.current && !(event.target as Element).classList.contains('curve-hit')) return
    const point = at(event)
    if (points.some((entry) => Math.abs(view(entry.x) - view(point.x)) < 0.025)) return
    const next = [...points, point].sort((a, b) => a.x - b.x)
    onChange(next)
    const index = next.indexOf(point)
    setDragging(index)
    setChosen(index)
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const nudge = (event: ReactKeyboardEvent) => {
    if (selected === null || !event.key.startsWith('Arrow')) return
    event.preventDefault()
    const by = (event.shiftKey ? 5 : 1) / 255
    const point = points[selected]!
    if (event.key === 'ArrowLeft') place(selected, { ...point, x: point.x - by })
    if (event.key === 'ArrowRight') place(selected, { ...point, x: point.x + by })
    if (event.key === 'ArrowUp') place(selected, { ...point, y: point.y + by })
    if (event.key === 'ArrowDown') place(selected, { ...point, y: point.y - by })
  }
  const remove = (index: number) => {
    if (index === 0 || index === points.length - 1) return
    onChange(points.filter((_, other) => other !== index))
    setChosen(null)
  }

  return (
    <div className={`curve-editor is-${channel}`}>
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={uiText('Кривая')} tabIndex={0} onKeyDown={nudge}
        onPointerDown={add} onPointerMove={move} onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
        <rect className="curve-hit" x="0" y="0" width={SIZE} height={SIZE} />
        {(scale === 'shadows' ? MARKS.map((step) => view(step / 255)) : [0.25, 0.5, 0.75]).map((value) => (
          <g key={value} className="curve-grid"><line x1={value * SIZE} x2={value * SIZE} y1="0" y2={SIZE} /><line y1={(1 - value) * SIZE} y2={(1 - value) * SIZE} x1="0" x2={SIZE} /></g>
        ))}
        {scale === 'shadows' && MARKS.map((step) => <text key={step} className="curve-mark" x={view(step / 255) * SIZE + 2} y={SIZE - 3}>{step}</text>)}
        <path className="curve-diagonal" d={`M0,${SIZE} L${SIZE},0`} />
        <path className="curve-result" d={result} />
        <path className="curve-own" d={own} />
        {points.map((point, index) => (
          <circle key={index} className={`curve-point${index === selected ? ' is-chosen' : ''}`} cx={view(point.x) * SIZE} cy={(1 - view(point.y)) * SIZE} r="7"
            onPointerDown={(event) => { event.stopPropagation(); svgRef.current?.setPointerCapture(event.pointerId); setDragging(index); setChosen(index) }}
            onDoubleClick={() => remove(index)} />
        ))}
      </svg>
      {selected !== null && (
        <div className="curve-point-fields">
          <span>{uiText('Выбранная точка')}</span>
          <label>{uiText('было')}<input className="input" type="number" min={0} max={255} value={toStep(points[selected]!.x)} disabled={selected === 0 || selected === points.length - 1}
            onChange={(event) => place(selected, { ...points[selected]!, x: Number(event.target.value) / 255 })} /></label>
          <label>{uiText('стало')}<input className="input" type="number" min={0} max={255} value={toStep(points[selected]!.y)}
            onChange={(event) => place(selected, { ...points[selected]!, y: Number(event.target.value) / 255 })} /></label>
          {selected > 0 && selected < points.length - 1 && <button type="button" className="button small ghost" onClick={() => remove(selected)}>{uiText('Убрать точку')}</button>}
        </div>
      )}
    </div>
  )
}
