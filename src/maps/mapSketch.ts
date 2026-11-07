import { useCallback, useEffect, useState } from 'react'
import type { RaidMode } from '../domain/types'

/**
 * «Зарисовка» on the map (a player's proposal №80; owner, 06.11.2026): a pencil, red, press and draw; a stroke let go can be taken back
 * and brought back; ✓ keeps it, ✕ drops what was drawn this time. Kept, the map works as before, and a cross closes the drawing, which
 * deletes it. It belongs to the map, not to the screen: a stroke keeps its size on the map, its line too, so it shrinks as the map
 * zooms out and grows as it zooms in (owner: «оригинальный размер должен оставаться»).
 *
 * Kept on this device per profile, mode and map, on every floor. Points are `[lat, lng]`, the map's game metres; a stroke remembers the
 * zoom it was drawn at, from which its line's width follows (components/MapSketch.tsx).
 *
 * A player's proposal №85, which the owner took up (07.11.2026, «прими её в работу»; №80 had been «без резинки»): an eraser that rubs out
 * what it passes over, kept drawings too, and colours for the pencil; red stays the first, and a stroke with no colour is red.
 */
export type SketchPoint = [number, number]
export interface SketchStroke { zoom: number; points: SketchPoint[]; color?: string }
export type SketchTool = 'pencil' | 'eraser'

/** The owner's red first. Bright, so that each shows on both the scheme and the satellite picture. */
export const SKETCH_COLORS = [
  { color: '#ff2b2b', label: 'Красный' },
  { color: '#ffd60a', label: 'Жёлтый' },
  { color: '#2fe06b', label: 'Зелёный' },
  { color: '#2ab7ff', label: 'Голубой' },
  { color: '#c264ff', label: 'Фиолетовый' },
  { color: '#ffffff', label: 'Белый' },
] as const
export const SKETCH_DEFAULT_COLOR: string = SKETCH_COLORS[0].color
const isSketchColor = (value: unknown): value is string => SKETCH_COLORS.some(({ color }) => color === value)

/** What is being drawn. One step back is one stroke of the pencil or one stroke of the eraser; `past` starts at what was kept. */
export interface SketchEdit { strokes: SketchStroke[]; past: SketchStroke[][]; future: SketchStroke[][] }

export const startEdit = (strokes: SketchStroke[]): SketchEdit => ({ strokes, past: [], future: [] })
export const changeStrokes = (edit: SketchEdit, strokes: SketchStroke[]): SketchEdit => (strokes === edit.strokes ? edit : { strokes, past: [...edit.past, edit.strokes], future: [] })
export const addStroke = (edit: SketchEdit, stroke: SketchStroke): SketchEdit => changeStrokes(edit, [...edit.strokes, stroke])
export function undoStroke(edit: SketchEdit): SketchEdit {
  const last = edit.past.at(-1)
  return last ? { strokes: last, past: edit.past.slice(0, -1), future: [...edit.future, edit.strokes] } : edit
}
export function redoStroke(edit: SketchEdit): SketchEdit {
  const next = edit.future.at(-1)
  return next ? { strokes: next, past: [...edit.past, edit.strokes], future: edit.future.slice(0, -1) } : edit
}

export const roundMetres = (value: number) => Math.round(value * 100) / 100

/** The eraser's size on screen, whatever the zoom. */
export const ERASER_RADIUS_PX = 12
export interface ScreenPoint { x: number; y: number }
/** From the map's metres to the screen. A map's two axes can have different scales and it can be turned, so the eraser's circle is measured on screen. */
export type SketchProjection = (point: SketchPoint) => ScreenPoint

/** The part of the segment a-b inside the circle, as fractions from a; null when none of it is. */
function insideCircle(a: ScreenPoint, b: ScreenPoint, center: ScreenPoint, radius: number): [number, number] | null {
  const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - center.x, fy = a.y - center.y
  const outside = fx * fx + fy * fy - radius * radius
  const length = dx * dx + dy * dy
  if (!length) return outside <= 0 ? [0, 1] : null
  const half = fx * dx + fy * dy
  const root = half * half - length * outside
  if (root <= 0) return null
  const enter = Math.max(0, (-half - Math.sqrt(root)) / length)
  const leave = Math.min(1, (-half + Math.sqrt(root)) / length)
  return enter < leave ? [enter, leave] : null
}

const between = (a: SketchPoint, b: SketchPoint, at: number): SketchPoint => [roundMetres(a[0] + (b[0] - a[0]) * at), roundMetres(a[1] + (b[1] - a[1]) * at)]

/** What is left of a stroke outside the circle, in pieces of the same colour and zoom; null when the circle does not touch it. */
function outsideCircle(stroke: SketchStroke, screen: SketchProjection, center: ScreenPoint, radius: number): SketchStroke[] | null {
  const pieces: SketchPoint[][] = []
  let piece: SketchPoint[] = []
  let touched = false
  const endPiece = () => {
    if (piece.length > 1) pieces.push(piece)
    piece = []
  }
  for (let index = 0; index + 1 < stroke.points.length; index += 1) {
    const a = stroke.points[index]!, b = stroke.points[index + 1]!
    const inside = insideCircle(screen(a), screen(b), center, radius)
    if (!inside) {
      if (!piece.length) piece.push(a)
      piece.push(b)
      continue
    }
    touched = true
    const [enter, leave] = inside
    if (enter > 0) {
      if (!piece.length) piece.push(a)
      piece.push(between(a, b, enter))
    }
    endPiece()
    if (leave < 1) piece = [between(a, b, leave), b]
  }
  endPiece()
  return touched ? pieces.map((points) => ({ ...stroke, points })) : null
}

/**
 * The eraser moved from one place on screen to another: what is left of the drawing. Nothing touched gives back the same list, and a
 * stroke it missed stays the same stroke.
 */
export function eraseStrokes(strokes: SketchStroke[], project: SketchProjection, from: ScreenPoint, to: ScreenPoint, radius = ERASER_RADIUS_PX): SketchStroke[] {
  const known = new Map<SketchPoint, ScreenPoint>()
  const screen: SketchProjection = (point) => {
    let found = known.get(point)
    if (!found) known.set(point, found = project(point))
    return found
  }
  // Steps of half a radius leave no gap, however fast the eraser went.
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (radius / 2)))
  let result = strokes
  for (let step = 0; step <= steps; step += 1) {
    const center = { x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps }
    let changed = false
    const next = result.flatMap((stroke) => {
      const left = outsideCircle(stroke, screen, center, radius)
      if (!left) return [stroke]
      changed = true
      return left
    })
    if (changed) result = next
  }
  return result
}

/** The line's width on screen at the zoom the stroke was drawn at, in pixels. */
export const SKETCH_LINE_PX = 3
/** Far out a line stays a hair, not nothing. */
const THINNEST_LINE_PX = 0.75

/** `scale`: how many times the map is larger now than when the stroke was drawn. */
export const sketchLineWidth = (scale: number) => Math.max(THINNEST_LINE_PX, SKETCH_LINE_PX * scale)

const PREFIX = 'raidos-map-sketch-v1:'
/** The last colour, for every map. «Удалить все данные» takes it too, by the prefix. */
const COLOR_KEY = `${PREFIX}color`
export const mapSketchKey = (profileId: string, mode: RaidMode, mapId: string) => `${PREFIX}${profileId}:${mode}:${mapId}`

const isPoint = (value: unknown): value is SketchPoint => Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))

export function readMapSketch(key: string): SketchStroke[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.flatMap((entry): SketchStroke[] => {
      const { zoom, points, color } = (entry ?? {}) as Partial<SketchStroke>
      if (typeof zoom !== 'number' || !Number.isFinite(zoom) || !Array.isArray(points)) return []
      const kept = points.filter(isPoint)
      return kept.length ? [{ zoom, points: kept, ...(isSketchColor(color) ? { color } : {}) }] : []
    })
  } catch { return [] }
}

function writeMapSketch(key: string, strokes: SketchStroke[]) {
  try {
    if (strokes.length) localStorage.setItem(key, JSON.stringify(strokes))
    else localStorage.removeItem(key)
  } catch { /* storage unavailable or full: the drawing lives until the map is left */ }
  window.dispatchEvent(new Event(EVENT))
}

function readSketchColor(): string {
  try {
    const saved = localStorage.getItem(COLOR_KEY)
    return isSketchColor(saved) ? saved : SKETCH_DEFAULT_COLOR
  } catch { return SKETCH_DEFAULT_COLOR }
}

/** «Удалить все данные». */
export function clearAllMapSketches() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
}

const EVENT = 'raidos-map-sketch-changed'
/** The account's other devices keep the strokes too, one by one (sync/playerStateStores.ts); what another device drew comes in here. */
export const MAP_SKETCH_SYNC = { event: EVENT, write: writeMapSketch } as const

/**
 * A drawing is kept: what another device did to the map since it began stays. `began`: the kept strokes when it began, `stored`: those
 * of the map now. Whatever this device drew or rubbed out stays as it is.
 */
export function withOtherDevices(strokes: SketchStroke[], began: SketchStroke[], stored: SketchStroke[]): SketchStroke[] {
  const text = (stroke: SketchStroke) => JSON.stringify(stroke)
  const before = new Set(began.map(text))
  const now = new Set(stored.map(text))
  const kept = strokes.filter((stroke) => !before.has(text(stroke)) || now.has(text(stroke)))
  const here = new Set(kept.map(text))
  return [...kept, ...stored.filter((stroke) => !before.has(text(stroke)) && !here.has(text(stroke)))]
}

export interface MapSketch {
  /** What the map shows: what was kept, or what is being drawn. */
  strokes: SketchStroke[]
  editing: boolean
  canUndo: boolean
  canRedo: boolean
  /** A drawing was kept: the cross is there. */
  kept: boolean
  tool: SketchTool
  color: string
  chooseTool: (tool: SketchTool) => void
  /** A colour is for drawing: it takes the pencil back from the eraser. */
  chooseColor: (color: string) => void
  begin: () => void
  draw: (stroke: SketchStroke) => void
  /** What the eraser left, as one step back. */
  replace: (strokes: SketchStroke[]) => void
  undo: () => void
  redo: () => void
  accept: () => void
  cancel: () => void
  close: () => void
}

/** Another map, mode or profile starts with its own drawing; what was being drawn and not accepted is dropped. */
export function useMapSketch(profileId: string, mode: RaidMode, mapId: string): MapSketch {
  const key = mapSketchKey(profileId, mode, mapId)
  const [state, setState] = useState(() => ({ key, kept: readMapSketch(key), edit: null as SketchEdit | null }))
  const current = state.key === key ? state : { key, kept: readMapSketch(key), edit: null }
  if (current !== state) setState(current)
  const { kept, edit } = current
  const [tool, setTool] = useState<SketchTool>('pencil')
  const [color, setColor] = useState(readSketchColor)

  const change = useCallback((next: (value: SketchEdit) => SketchEdit) => {
    setState((value) => (value.edit ? { ...value, edit: next(value.edit) } : value))
  }, [])
  const keep = useCallback((strokes: SketchStroke[]) => {
    const merged = withOtherDevices(strokes, kept, readMapSketch(key))
    writeMapSketch(key, merged)
    setState({ key, kept: merged, edit: null })
  }, [key, kept])

  // Another device drew or took something off: it shows at once. While a drawing is on here, it joins when that is kept (`keep`) or dropped.
  const drawing = Boolean(edit)
  useEffect(() => {
    const reread = () => setState((value) => {
      if (value.edit) return value
      const stored = readMapSketch(value.key)
      return JSON.stringify(stored) === JSON.stringify(value.kept) ? value : { ...value, kept: stored }
    })
    if (!drawing) reread()
    window.addEventListener(EVENT, reread)
    return () => window.removeEventListener(EVENT, reread)
  }, [drawing])

  return {
    strokes: edit ? edit.strokes : kept,
    editing: Boolean(edit),
    canUndo: Boolean(edit?.past.length),
    canRedo: Boolean(edit?.future.length),
    kept: kept.length > 0,
    tool,
    color,
    chooseTool: setTool,
    chooseColor: useCallback((next: string) => {
      setColor(next)
      setTool('pencil')
      try { localStorage.setItem(COLOR_KEY, next) } catch { /* storage unavailable: the colour lasts until the map is left */ }
    }, []),
    begin: useCallback(() => {
      setTool('pencil')
      setState((value) => ({ ...value, edit: value.edit ?? startEdit(value.kept) }))
    }, []),
    draw: useCallback((stroke: SketchStroke) => change((value) => addStroke(value, stroke)), [change]),
    replace: useCallback((strokes: SketchStroke[]) => change((value) => changeStrokes(value, strokes)), [change]),
    undo: useCallback(() => change(undoStroke), [change]),
    redo: useCallback(() => change(redoStroke), [change]),
    accept: () => keep(edit ? edit.strokes : kept),
    cancel: useCallback(() => setState((value) => ({ ...value, edit: null })), []),
    close: () => keep([]),
  }
}
