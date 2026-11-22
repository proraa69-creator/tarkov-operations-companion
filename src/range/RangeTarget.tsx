import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { bodyOutline, FIGURE_HEIGHT, HEAD, regions, shapePath, type View } from './rangeHitboxes'
import { swayAt, useSwayTime } from './rangeSway'
import { BODY_PARTS, COLLIDER_PART, type BodyPart, type BodyState } from './rangeModel'
import type { Cover, FiredShot } from './rangeShot'
import { markOf } from './rangeView'
import { partLabelPoints, type FigurePicture } from './rangeFigures'
import type { PartMasks } from './partMasks'
import { CoverShape } from './RangeCover'
import type { CoverTextures } from './rangeCoverData'

const VIEW_BOX = '-44 -10 88 196'
/** The pictured figure stands a little taller (a helmet) and wider (the arms). */
const PICTURE_VIEW_BOX = '-52 -24 104 210'

export interface TargetFigure {
  base: FigurePicture
  layers: FigurePicture[]
  /** Object addresses of the pictures by file. */
  urls: Record<string, string>
}

export interface SceneProps {
  view: View
  /** The pictures of the character and its armour; without them the schematic figure. */
  figure?: TargetFigure
  body: BodyState
  marks: FiredShot[]
  cover: Cover
  coverTextures?: CoverTextures
  /** The pictured body parts' exact shapes (src/range/partMasks.ts). */
  masks?: PartMasks
  /** The part the last shot hit: its outline flashes (owner, 22.11.2026: «обводилась прям конечность… в точности по контурам»). */
  flash?: { part: BodyPart; n: number }
  /** The parts' health written on them; none in the scope. */
  labels?: Record<BodyPart, string>
  /** A mark's size, figure centimetres (bigger far away, seen through a scope). */
  markRadius?: number
}

/**
 * What stands at the range, in figure centimetres (x to the right, the soles at FIGURE_HEIGHT, y down): the character and its
 * armour, its hurt parts, the outline of the part just hit, the health on its parts, the cover and the bullet marks.
 */
export function RangeScene({ view, figure, body, marks, cover, coverTextures, masks, flash, labels, markRadius = 0.95 }: SceneProps) {
  const zones = useMemo(() => regions(view), [view])
  const outline = useMemo(() => bodyOutline(), [])
  const partFill = (part: BodyPart) => {
    if (body.destroyed[part]) return '#1d1f1e'
    const share = body.max[part] > 0 ? body.current[part] / body.max[part] : 0
    // full health: the figure's own colour; down to red as it falls
    const r = Math.round(70 + (1 - share) * 120), g = Math.round(84 - (1 - share) * 40), b = Math.round(74 - (1 - share) * 34)
    return `rgb(${r} ${g} ${b})`
  }
  const baseZones = figure?.base.zones
  const zonesOfFigure = useMemo(() => baseZones ?? [], [baseZones])
  const figurePoints = useMemo(() => partLabelPoints(zonesOfFigure), [zonesOfFigure])
  const pictured = Boolean(figure && figure.urls[figure.base.file])
  const partLabels: Array<{ part: BodyPart; x: number; y: number }> = pictured
    ? (Object.entries(figurePoints) as Array<[BodyPart, { x: number; y: number }]>).map(([part, point]) => ({ part, ...point }))
    : view === 'front'
    ? [{ part: 'Head', x: 0, y: 165 }, { part: 'Chest', x: 0, y: 133 }, { part: 'Stomach', x: 0, y: 108 }, { part: 'LeftArm', x: 22.5, y: 100 }, { part: 'RightArm', x: -22.5, y: 100 }, { part: 'LeftLeg', x: 8.5, y: 40 }, { part: 'RightLeg', x: -8.5, y: 40 }]
    : [{ part: 'Head', x: 0, y: 165 }, { part: 'Chest', x: 0, y: 133 }, { part: 'Stomach', x: 0, y: 108 }, { part: 'LeftArm', x: -22.5, y: 100 }, { part: 'RightArm', x: 22.5, y: 100 }, { part: 'LeftLeg', x: -8.5, y: 40 }, { part: 'RightLeg', x: 8.5, y: 40 }]
  return <>
    <defs>
      <clipPath id="range-body-clip">
        <path d={outline} />
        <ellipse cx={HEAD.cx} cy={FIGURE_HEIGHT - HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} />
      </clipPath>
    </defs>
    <rect x={-400} y={FIGURE_HEIGHT} width={800} height={6} className="range-ground" />
    {pictured && figure ? <>
      {[figure.base, ...figure.layers].map((picture) => figure.urls[picture.file]
        ? <image key={picture.file} href={figure.urls[picture.file]} x={picture.x} y={FIGURE_HEIGHT - picture.top} width={picture.width} height={picture.height} preserveAspectRatio="none" />
        : null)}
      {masks && BODY_PARTS.map((part) => {
        const url = masks.fill[part]
        if (!url) return null
        const share = body.max[part] > 0 ? body.current[part] / body.max[part] : 0
        const hurt = body.destroyed[part] ? 0.55 : (1 - share) * 0.45
        return hurt > 0.01 ? <image key={`hurt-${part}`} href={url} x={masks.x} y={FIGURE_HEIGHT - masks.top} width={masks.width} height={masks.height} preserveAspectRatio="none" opacity={hurt.toFixed(2)} className="range-part-hurt" /> : null
      })}
      {masks && flash && masks.edge[flash.part] && <image key={`flash-${flash.n}`} href={masks.edge[flash.part]} x={masks.x} y={FIGURE_HEIGHT - masks.top} width={masks.width} height={masks.height} preserveAspectRatio="none" className="range-part-flash" />}
    </> : <>
      <path d={outline} className="range-body" />
      <ellipse cx={HEAD.cx} cy={FIGURE_HEIGHT - HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} className="range-body" />
      <g clipPath="url(#range-body-clip)">
        {zones.map((zone) => {
          const part = COLLIDER_PART[zone.collider]
          return <path key={zone.collider} d={shapePath(zone.shape)} className={`range-zone${flash?.part === part ? ' is-hit' : ''}`} fill={partFill(part)} data-collider={zone.collider} />
        })}
      </g>
      <path d={outline} className="range-body-line" />
      <ellipse cx={HEAD.cx} cy={FIGURE_HEIGHT - HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} className="range-body-line" />
    </>}
    {labels && partLabels.map((label) => <text key={label.part} x={label.x} y={FIGURE_HEIGHT - label.y} className={`range-hp${body.destroyed[label.part] ? ' is-out' : ''}`} textAnchor="middle">{labels[label.part]}</text>)}
    {cover !== 'none' && <CoverShape cover={cover} textures={coverTextures} />}
    {marks.filter((mark) => mark.view === view).map((mark, index) => {
      const style = markOf(mark)
      return <circle key={index} cx={mark.point.x} cy={FIGURE_HEIGHT - mark.point.y} r={markRadius} fill={style.fill} className="range-mark" />
    })}
  </>
}

export function RangeTarget({ onFireStart, onFireEnd, onAimMove, spreadCm, muzzle, swayCm, ...scene }: SceneProps & {
  /** The group's diameter at the distance, cm (undefined without MOA). */
  spreadCm?: number
  /** Where the barrel points now, with the recoil (figure centimetres). */
  muzzle?: { x: number; y: number }
  /** The sway's amplitude at the target, cm (src/range/rangeSway.ts): the cross drifts where the barrel does. */
  swayCm?: number
  onFireStart: (point: { x: number; y: number }) => void
  onFireEnd: () => void
  onAimMove: (point: { x: number; y: number }) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null)
  const toFigure = (event: PointerEvent<SVGSVGElement>) => {
    const element = svg.current
    const matrix = element?.getScreenCTM()
    if (!element || !matrix) return null
    const point = element.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(matrix.inverse())
    return { x: local.x, y: FIGURE_HEIGHT - local.y }
  }
  const pictured = Boolean(scene.figure && scene.figure.urls[scene.figure.base.file])
  const swayTime = useSwayTime(Boolean(swayCm && aim))
  const drift = swayCm && aim ? swayAt(swayTime, swayCm) : { x: 0, y: 0 }
  const cross = aim ? { x: aim.x + drift.x, y: aim.y + drift.y } : null
  return <svg
    ref={svg}
    className={`range-target${pictured ? ' is-pictured' : ''}`}
    viewBox={pictured ? PICTURE_VIEW_BOX : VIEW_BOX}
    role="img"
    onPointerDown={(event) => {
      const point = toFigure(event)
      if (!point) return
      // keep the aim while the button is held outside the target (a pointer the browser no longer tracks cannot be captured)
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not captured */ }
      onFireStart(point)
    }}
    onPointerUp={() => onFireEnd()}
    onPointerCancel={() => onFireEnd()}
    onPointerLeave={() => { setAim(null); onFireEnd() }}
    onPointerMove={(event) => { const point = toFigure(event); setAim(point); if (point) onAimMove(point) }}
  >
    <RangeScene {...scene} />
    {muzzle && <circle cx={muzzle.x} cy={FIGURE_HEIGHT - muzzle.y} r={1.3} className="range-muzzle" pointerEvents="none" />}
    {cross && <g className="range-aim" pointerEvents="none">
      {spreadCm ? <circle cx={cross.x} cy={FIGURE_HEIGHT - cross.y} r={Math.max(0.6, spreadCm / 2)} className="range-spread" /> : null}
      <line x1={cross.x - 3} x2={cross.x - 0.8} y1={FIGURE_HEIGHT - cross.y} y2={FIGURE_HEIGHT - cross.y} />
      <line x1={cross.x + 0.8} x2={cross.x + 3} y1={FIGURE_HEIGHT - cross.y} y2={FIGURE_HEIGHT - cross.y} />
      <line x1={cross.x} x2={cross.x} y1={FIGURE_HEIGHT - cross.y - 3} y2={FIGURE_HEIGHT - cross.y - 0.8} />
      <line x1={cross.x} x2={cross.x} y1={FIGURE_HEIGHT - cross.y + 0.8} y2={FIGURE_HEIGHT - cross.y + 3} />
    </g>}
  </svg>
}
