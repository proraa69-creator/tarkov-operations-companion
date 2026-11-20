import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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

/** A picture's size once loaded (a flat picture of the weapon); 1000 × 350 until then. */
function usePictureSize(src: string | undefined) {
  const [size, setSize] = useState<{ src: string; width: number; height: number } | null>(null)
  useEffect(() => {
    if (!src || typeof Image === 'undefined') return
    let alive = true
    const image = new Image()
    image.onload = () => { if (alive && image.naturalWidth) setSize({ src, width: image.naturalWidth, height: image.naturalHeight }) }
    image.src = src
    return () => { alive = false }
  }, [src])
  return size?.src === src ? size : null
}

/**
 * The build drawn large, its module cells around it at their places, a line from each cell to its point on the weapon
 * (src/arsenal/stageLayout.ts). `renderCell` draws a cell's button (the page's own); `selected` lights its line. `flat`: the weapon's
 * own picture, for a weapon the app has no part pictures of — the same cells around it, without their points.
 */
export function BuildStage({ drawn, flat, slots, size, selected, renderCell, maxHeight }: {
  drawn: Drawn | null
  flat?: string
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
    // a window that measures nothing (tests) lays out at a PC's width
    const measure = () => setWidth(element.clientWidth || 960)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const flatSize = usePictureSize(drawn ? undefined : flat)
  const laid = drawn?.laid
  const inputs = useMemo<StageCellInput[]>(() => {
    const anchorOf = (slot: StageSlot): [number, number] | undefined => {
      if (!slot.path || !laid) return undefined
      const key = slot.path.join('/')
      const own = (slot.filled ? laid.centers[key] : undefined) ?? laid.anchors[key]
      if (own) return own
      // a part not drawn (no picture, turned to the eye) or a slot on one: the nearest point of a drawn part above it
      for (let depth = slot.path.length - 1; depth > 0; depth--) {
        const above = slot.path.slice(0, depth).join('/')
        const point = laid.anchors[above] ?? laid.centers[above]
        if (point) return point
      }
      return undefined
    }
    const magazine = slots.find((slot) => slot.kind === 'magazine' && slot.filled) ?? slots.find((slot) => slot.kind === 'magazine')
    return slots.map((slot) => ({ key: slot.key, kind: slot.kind, zone: slot.zone, depth: slot.depth, anchor: slot.kind === 'ammo' ? (magazine ? anchorOf(magazine) : undefined) : anchorOf(slot) }))
  }, [laid, slots])
  // the box of every part on the picture: no cell is laid over one (a flat picture: the whole of it)
  const picture = useMemo(() => !laid ? { width: 1000, height: flatSize ? Math.round(1000 * flatSize.height / flatSize.width) : 350 } : ({
    width: laid.width,
    height: laid.height,
    boxes: laid.parts.map((part): [number, number, number, number] => {
      const corners = [[0, 0], [part.asset.w, 0], [0, part.asset.h], [part.asset.w, part.asset.h]].map(([u, v]) => [part.m[0] * u! + part.m[1] * v! + part.m[2], part.m[3] * u! + part.m[4] * v! + part.m[5]])
      const xs = corners.map((corner) => corner[0]!)
      const ys = corners.map((corner) => corner[1]!)
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }),
  }), [laid, flatSize])
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
      {drawn
        ? <BuildCanvas drawn={drawn} scale={stage.picture.scale} className="build-stage-picture" style={{ left: stage.picture.x, top: stage.picture.y }} />
        : flat && <img src={flat} alt="" draggable={false} className="build-stage-picture is-flat"
          style={{ left: stage.picture.x, top: stage.picture.y, width: Math.round(picture.width * stage.picture.scale), height: Math.round(picture.height * stage.picture.scale) }} />}
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
