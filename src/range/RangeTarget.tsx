import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { bodyOutline, FIGURE_HEIGHT, HEAD, plateRegions, regions, shapePath, type View } from './rangeHitboxes'
import { COLLIDER_PART, type ArmorPiece, type BodyPart, type BodyState } from './rangeModel'
import type { Cover, FiredShot } from './rangeShot'
import { CLASS_COLORS, markOf } from './rangeView'
import { partLabelPoints, type FigurePicture } from './rangeFigures'

const VIEW_BOX = '-44 -10 88 196'
/** The pictured figure stands a little taller (a helmet) and wider (the arms). */
const PICTURE_VIEW_BOX = '-52 -24 104 210'

export interface TargetFigure {
  base: FigurePicture
  layers: FigurePicture[]
  /** Object addresses of the pictures by file. */
  urls: Record<string, string>
}

export function RangeTarget({ view, kit, body, marks, showArmor, cover, spreadCm, onFireStart, onFireEnd, onAimMove, labels, figure }: {
  view: View
  /** The pictures of the character and its armour; without them the schematic figure. */
  figure?: TargetFigure
  kit: ArmorPiece[]
  body: BodyState
  marks: FiredShot[]
  showArmor: boolean
  cover: Cover
  /** The group's diameter at the distance, cm (undefined without MOA). */
  spreadCm?: number
  onFireStart: (point: { x: number; y: number }) => void
  onFireEnd: () => void
  onAimMove: (point: { x: number; y: number }) => void
  labels: Record<BodyPart, string>
}) {
  const svg = useRef<SVGSVGElement>(null)
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null)
  const zones = useMemo(() => regions(view), [view])
  const outline = useMemo(() => bodyOutline(), [])
  const plates = useMemo(() => plateRegions(view), [view])
  const coverage = useMemo(() => {
    const best = new Map<string, number>()
    for (const piece of kit) for (const collider of piece.colliders) if (piece.durability > 0) best.set(collider, Math.max(best.get(collider) ?? 0, piece.armorClass))
    return best
  }, [kit])
  const platePieces = useMemo(() => {
    const map = new Map<string, ArmorPiece>()
    for (const piece of kit) for (const zone of piece.plates) map.set(zone, piece)
    return map
  }, [kit])

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
    <defs>
      <clipPath id="range-body-clip">
        <path d={outline} />
        <ellipse cx={HEAD.cx} cy={FIGURE_HEIGHT - HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} />
      </clipPath>
    </defs>
    <rect x={-52} y={FIGURE_HEIGHT} width={104} height={6} className="range-ground" />
    {pictured && figure ? <>
      {[figure.base, ...figure.layers].map((picture) => figure.urls[picture.file]
        ? <image key={picture.file} href={figure.urls[picture.file]} x={picture.x} y={FIGURE_HEIGHT - picture.top} width={picture.width} height={picture.height} preserveAspectRatio="none" />
        : null)}
      {zonesOfFigure.filter((zone) => !zone.plate).map((zone, index) => {
        const share = body.max[zone.part] > 0 ? body.current[zone.part] / body.max[zone.part] : 0
        const armorClass = showArmor ? coverage.get(zone.type) : undefined
        const hurt = body.destroyed[zone.part] ? 0.55 : (1 - share) * 0.45
        return <path key={`${zone.type}-${index}`} d={polyPath(zone.poly)} className="range-figure-zone" fill={`rgb(226 87 76 / ${hurt.toFixed(2)})`} stroke={armorClass ? CLASS_COLORS[armorClass] : undefined} data-collider={zone.type} />
      })}
      {showArmor && zonesOfFigure.filter((zone) => zone.plate && platePieces.has(zone.plate)).map((zone, index) => {
        const piece = platePieces.get(zone.plate!)!
        return <path key={`${zone.plate}-${index}`} d={polyPath(zone.poly)} className={`range-plate${piece.durability <= 0 ? ' is-broken' : ''}`} fill={CLASS_COLORS[piece.armorClass]} stroke={CLASS_COLORS[piece.armorClass]} />
      })}
    </> : <>
    <path d={outline} className="range-body" />
    <ellipse cx={HEAD.cx} cy={FIGURE_HEIGHT - HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} className="range-body" />
    <g clipPath="url(#range-body-clip)">
    {zones.map((zone) => {
      const part = COLLIDER_PART[zone.collider]
      const armorClass = showArmor ? coverage.get(zone.collider) : undefined
      return <path key={zone.collider} d={shapePath(zone.shape)} className="range-zone" fill={partFill(part)} stroke={armorClass ? CLASS_COLORS[armorClass] : undefined} strokeWidth={armorClass ? 0.9 : undefined} data-collider={zone.collider} />
    })}
    </g>
    <path d={outline} className="range-body-line" />
    <ellipse cx={HEAD.cx} cy={FIGURE_HEIGHT - HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} className="range-body-line" />
    </>}
    {!pictured && showArmor && plates.filter((plate) => platePieces.has(plate.zone)).map((plate) => {
      const piece = platePieces.get(plate.zone)!
      return <path key={plate.zone} d={shapePath(plate.shape)} className={`range-plate${piece.durability <= 0 ? ' is-broken' : ''}`} fill={CLASS_COLORS[piece.armorClass]} stroke={CLASS_COLORS[piece.armorClass]} />
    })}
    {partLabels.map((label) => <text key={label.part} x={label.x} y={FIGURE_HEIGHT - label.y} className={`range-hp${body.destroyed[label.part] ? ' is-out' : ''}`} textAnchor="middle">{labels[label.part]}</text>)}
    {cover !== 'none' && <CoverShape cover={cover} />}
    {marks.filter((mark) => mark.view === view).map((mark, index) => {
      const style = markOf(mark)
      return <circle key={index} cx={mark.point.x} cy={FIGURE_HEIGHT - mark.point.y} r={0.95} fill={style.fill} className="range-mark" />
    })}
    {aim && <g className="range-aim" pointerEvents="none">
      {spreadCm ? <circle cx={aim.x} cy={FIGURE_HEIGHT - aim.y} r={Math.max(0.6, spreadCm / 2)} className="range-spread" /> : null}
      <line x1={aim.x - 3} x2={aim.x - 0.8} y1={FIGURE_HEIGHT - aim.y} y2={FIGURE_HEIGHT - aim.y} />
      <line x1={aim.x + 0.8} x2={aim.x + 3} y1={FIGURE_HEIGHT - aim.y} y2={FIGURE_HEIGHT - aim.y} />
      <line x1={aim.x} x2={aim.x} y1={FIGURE_HEIGHT - aim.y - 3} y2={FIGURE_HEIGHT - aim.y - 0.8} />
      <line x1={aim.x} x2={aim.x} y1={FIGURE_HEIGHT - aim.y + 0.8} y2={FIGURE_HEIGHT - aim.y + 3} />
    </g>}
  </svg>
}

/** A polygon of figure centimetres as an SVG path. */
function polyPath(poly: ReadonlyArray<readonly [number, number]>) {
  return `M${poly.map(([x, y]) => `${x.toFixed(2)},${(FIGURE_HEIGHT - y).toFixed(2)}`).join('L')}Z`
}

function CoverShape({ cover }: { cover: Cover }) {
  const Y = (y: number) => FIGURE_HEIGHT - y
  if (cover === 'left') return <rect x={-44} y={-10} width={46} height={196} className="range-cover" />
  if (cover === 'right') return <rect x={-2} y={-10} width={46} height={196} className="range-cover" />
  if (cover === 'low') return <rect x={-44} y={Y(108)} width={88} height={108 + 6} className="range-cover" />
  return <path className="range-cover" fillRule="evenodd" d={`M-44,-10H44V186H-44Z M-34,${Y(186)}H34V${Y(118)}H-34Z`} />
}
