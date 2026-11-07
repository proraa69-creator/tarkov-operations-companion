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
 */
export type SketchPoint = [number, number]
export interface SketchStroke { zoom: number; points: SketchPoint[] }

/** What is being drawn: `base` was kept before, only `added` can go back and forward. */
export interface SketchEdit { base: SketchStroke[]; added: SketchStroke[]; undone: SketchStroke[] }

export const startEdit = (base: SketchStroke[]): SketchEdit => ({ base, added: [], undone: [] })
export const addStroke = (edit: SketchEdit, stroke: SketchStroke): SketchEdit => ({ ...edit, added: [...edit.added, stroke], undone: [] })
export function undoStroke(edit: SketchEdit): SketchEdit {
  const last = edit.added.at(-1)
  return last ? { ...edit, added: edit.added.slice(0, -1), undone: [...edit.undone, last] } : edit
}
export function redoStroke(edit: SketchEdit): SketchEdit {
  const last = edit.undone.at(-1)
  return last ? { ...edit, added: [...edit.added, last], undone: edit.undone.slice(0, -1) } : edit
}
export const editedStrokes = (edit: SketchEdit) => [...edit.base, ...edit.added]

/** The line's width on screen at the zoom the stroke was drawn at, in pixels. */
export const SKETCH_LINE_PX = 3
/** Far out a line stays a hair, not nothing. */
const THINNEST_LINE_PX = 0.75

/** `scale`: how many times the map is larger now than when the stroke was drawn. */
export const sketchLineWidth = (scale: number) => Math.max(THINNEST_LINE_PX, SKETCH_LINE_PX * scale)

const PREFIX = 'raidos-map-sketch-v1:'
export const mapSketchKey = (profileId: string, mode: RaidMode, mapId: string) => `${PREFIX}${profileId}:${mode}:${mapId}`

const isPoint = (value: unknown): value is SketchPoint => Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))

export function readMapSketch(key: string): SketchStroke[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.flatMap((entry): SketchStroke[] => {
      const { zoom, points } = (entry ?? {}) as Partial<SketchStroke>
      if (typeof zoom !== 'number' || !Number.isFinite(zoom) || !Array.isArray(points)) return []
      const kept = points.filter(isPoint)
      return kept.length ? [{ zoom, points: kept }] : []
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
  begin: () => void
  draw: (stroke: SketchStroke) => void
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
    strokes: edit ? editedStrokes(edit) : kept,
    editing: Boolean(edit),
    canUndo: Boolean(edit?.added.length),
    canRedo: Boolean(edit?.undone.length),
    kept: kept.length > 0,
    begin: useCallback(() => setState((value) => ({ ...value, edit: value.edit ?? startEdit(value.kept) })), []),
    draw: useCallback((stroke: SketchStroke) => change((value) => addStroke(value, stroke)), [change]),
    undo: useCallback(() => change(undoStroke), [change]),
    redo: useCallback(() => change(redoStroke), [change]),
    accept: () => keep(edit ? editedStrokes(edit) : kept),
    cancel: useCallback(() => setState((value) => ({ ...value, edit: null })), []),
    close: () => keep([]),
  }
}
