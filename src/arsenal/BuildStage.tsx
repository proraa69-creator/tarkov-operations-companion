import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { BuildCanvas, type Drawn } from './BuildPicture'
import type { SlotKind, Zone } from './boardLayout'
import { layStage, type StageCellInput } from './stageLayout'

export interface StageSlot {
  key: string
  kind: SlotKind | 'ammo'
  zone: Zone
  depth: number
  /** The slot's path in the build (slot ids); none for the round. */
  path?: string[]
  filled: boolean
}

/** Cell sizes: a phone keeps a finger's size; the full screen is roomier. */
const SIZES = {
  phone: { cell: 44, gap: 4, reach: 16, maxScale: 1.4 },
  normal: { cell: 50, gap: 4, reach: 22, maxScale: 1.15 },
  full: { cell: 58, gap: 6, reach: 34, maxScale: 1.6 },
  phoneFull: { cell: 44, gap: 4, reach: 22, maxScale: 1.8 },
} as const
export type StageSize = keyof typeof SIZES

/**
 * The build drawn large, its module cells around it at their places, a line from each cell to its point on the weapon
 * (src/arsenal/stageLayout.ts). `renderCell` draws a cell's button (the page's own); `selected` lights its line.
 */
export function BuildStage({ drawn, slots, size, selected, renderCell, maxHeight }: {
  drawn: Drawn
  slots: StageSlot[]
  size: StageSize
  selected: string | null
  renderCell: (key: string, style: CSSProperties) => ReactNode
  /** The full screen fits the stage into the window's height too. */
  maxHeight?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const { laid } = drawn
  const inputs = useMemo<StageCellInput[]>(() => {
    const anchorOf = (slot: StageSlot): [number, number] | undefined => {
      if (!slot.path) return undefined
      const key = slot.path.join('/')
      return (slot.filled ? laid.centers[key] : undefined) ?? laid.anchors[key]
    }
    const magazine = slots.find((slot) => slot.kind === 'magazine' && slot.filled) ?? slots.find((slot) => slot.kind === 'magazine')
    return slots.map((slot) => ({ key: slot.key, kind: slot.kind, zone: slot.zone, depth: slot.depth, anchor: slot.kind === 'ammo' ? (magazine ? anchorOf(magazine) : undefined) : anchorOf(slot) }))
  }, [laid, slots])
  // the box of every part on the picture: no cell is laid over one
  const picture = useMemo(() => ({
    width: laid.width,
    height: laid.height,
    boxes: laid.parts.map((part): [number, number, number, number] => {
      const corners = [[0, 0], [part.asset.w, 0], [0, part.asset.h], [part.asset.w, part.asset.h]].map(([u, v]) => [part.m[0] * u! + part.m[1] * v! + part.m[2], part.m[3] * u! + part.m[4] * v! + part.m[5]])
      const xs = corners.map((corner) => corner[0]!)
      const ys = corners.map((corner) => corner[1]!)
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }),
  }), [laid])
  const sizing = SIZES[size]
  const stage = useMemo(() => {
    if (!width) return null
    const options = { width, cell: sizing.cell, gap: sizing.gap, reach: sizing.reach, sides: width >= 640, maxScale: sizing.maxScale }
    let laidOut = layStage(picture, inputs, options)
    // the full screen: a stage taller than the window draws the picture smaller until it fits (or cannot shrink further)
    if (maxHeight && laidOut.height > maxHeight) {
      for (let scale = laidOut.picture.scale * 0.92; scale > 0.2 && laidOut.height > maxHeight; scale *= 0.92) laidOut = layStage(picture, inputs, { ...options, maxScale: scale })
    }
    return laidOut
  }, [width, picture, inputs, sizing, maxHeight])
  return <div className={`build-stage is-${size}`} ref={box} style={{ height: stage?.height, '--wb-cell': `${sizing.cell}px` } as CSSProperties}>
    {stage && <>
      <BuildCanvas drawn={drawn} scale={stage.picture.scale} className="build-stage-picture" style={{ left: stage.picture.x, top: stage.picture.y }} />
      <svg className="build-stage-lines" width={stage.width} height={stage.height} aria-hidden="true">
        {stage.cells.map((cell) => <g key={cell.key} className={cell.key === selected ? 'is-selected' : undefined}>
          <line x1={cell.from[0]} y1={cell.from[1]} x2={cell.point[0]} y2={cell.point[1]} />
          <circle cx={cell.point[0]} cy={cell.point[1]} r={cell.key === selected ? 3.2 : 2.2} />
        </g>)}
      </svg>
      {stage.cells.map((cell) => <Fragment key={cell.key}>{renderCell(cell.key, { position: 'absolute', left: cell.x, top: cell.y })}</Fragment>)}
    </>}
  </div>
}
