import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { uiText } from '../i18n/renderText'
import { curveFunction, screenTables, type CurvePoint, type ScreenProfile } from './screenCurve'

export type CurveChannel = 'all' | 'r' | 'g' | 'b'

const SIZE = 240
const line = (values: ArrayLike<number>) => Array.from(values, (value, index) => `${index === 0 ? 'M' : 'L'}${(index / (values.length - 1) * SIZE).toFixed(1)},${((1 - value) * SIZE).toFixed(1)}`).join(' ')

/** The points with both ends; the ends move only up and down. */
function withEnds(points: readonly CurvePoint[] | undefined): CurvePoint[] {
  const sorted = [...(points ?? [])].sort((a, b) => a.x - b.x)
  if (!sorted.length || sorted[0]!.x > 0) sorted.unshift({ x: 0, y: 0 })
  if (sorted[sorted.length - 1]!.x < 1) sorted.push({ x: 1, y: 1 })
  return sorted
}

/**
 * The curve: click to add a point, drag to move it, double-click to remove it. The dashed line is the whole result for
 * that channel (the sliders included); the solid one is the curve being edited.
 */
export function CurveEditor({ profile, channel, onChange }: { profile: Omit<ScreenProfile, 'id' | 'name'>; channel: CurveChannel; onChange: (points: CurvePoint[]) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const points = withEnds(channel === 'all' ? profile.curve : profile.channels?.[channel])
  const own = useMemo(() => { const curve = curveFunction(points); return Array.from({ length: 65 }, (_, index) => curve(index / 64)) }, [points])
  const result = useMemo(() => screenTables(profile)[channel === 'all' ? 'g' : channel], [profile, channel])

  const at = (event: ReactPointerEvent) => {
    const box = svgRef.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height)) }
  }
  const move = (event: ReactPointerEvent) => {
    if (dragging === null) return
    const point = at(event)
    const next = points.map((entry, index) => {
      if (index !== dragging) return entry
      const end = index === 0 || index === points.length - 1
      const min = end ? entry.x : points[index - 1]!.x + 0.02, max = end ? entry.x : points[index + 1]!.x - 0.02
      return { x: Math.min(max, Math.max(min, point.x)), y: point.y }
    })
    onChange(next)
  }
  const add = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.target !== svgRef.current && !(event.target as Element).classList.contains('curve-hit')) return
    const point = at(event)
    if (points.some((entry) => Math.abs(entry.x - point.x) < 0.03)) return
    const next = [...points, point].sort((a, b) => a.x - b.x)
    onChange(next)
    setDragging(next.indexOf(point))
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  return (
    <div className={`curve-editor is-${channel}`}>
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={uiText('Кривая')}
        onPointerDown={add} onPointerMove={move} onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
        <rect className="curve-hit" x="0" y="0" width={SIZE} height={SIZE} />
        {[0.25, 0.5, 0.75].map((value) => <g key={value} className="curve-grid"><line x1={value * SIZE} x2={value * SIZE} y1="0" y2={SIZE} /><line y1={value * SIZE} y2={value * SIZE} x1="0" x2={SIZE} /></g>)}
        <path className="curve-diagonal" d={line([0, 1])} />
        <path className="curve-result" d={line(result)} />
        <path className="curve-own" d={line(own)} />
        {points.map((point, index) => (
          <circle key={index} className="curve-point" cx={point.x * SIZE} cy={(1 - point.y) * SIZE} r="7"
            onPointerDown={(event) => { event.stopPropagation(); svgRef.current?.setPointerCapture(event.pointerId); setDragging(index) }}
            onDoubleClick={() => { if (index > 0 && index < points.length - 1) onChange(points.filter((_, other) => other !== index)) }} />
        ))}
      </svg>
    </div>
  )
}
