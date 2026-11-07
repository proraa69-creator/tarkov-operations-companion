import { useEffect, useRef, useState } from 'react'
import { Pane, Polyline, useMap, useMapEvents } from 'react-leaflet'
import { polyline as leafletPolyline, type Polyline as LeafletPolyline } from 'leaflet'
import { Check, Eraser, Pencil, Redo2, Undo2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { eraseStrokes, roundMetres, SKETCH_COLORS, SKETCH_DEFAULT_COLOR, SKETCH_LINE_PX, sketchLineWidth, type MapSketch, type ScreenPoint, type SketchPoint, type SketchStroke } from '../maps/mapSketch'
import './mapSketch.css'

const PANE = 'map-sketch'
/** Closer than this to the last point, in screen pixels, a move adds nothing. */
const MIN_STEP_PX = 2

function ToolButton({ label, onClick, disabled, className = '', pressed, expanded, children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; pressed?: boolean; expanded?: boolean; children: React.ReactNode }) {
  const text = uiText(label)
  return <button type="button" className={`map-tool icon ${className}${pressed ? ' active' : ''}`} aria-label={text} title={text} aria-pressed={pressed} aria-expanded={expanded} disabled={disabled} onClick={onClick}>{children}</button>
}

/** The pencil's colour, and under it, when pressed, the others. Picking one, or pressing anywhere else, folds them. */
function SketchColors({ sketch }: { sketch: MapSketch }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])
  return <div ref={box} className="map-sketch-colors">
    <ToolButton label="Цвет" expanded={open} onClick={() => setOpen((value) => !value)}><span className="map-sketch-dot" style={{ background: sketch.color }} aria-hidden="true" /></ToolButton>
    {open && <div className="map-sketch-palette" role="group" aria-label={uiText('Цвет')}>
      {SKETCH_COLORS.map(({ color, label }) => <button
        key={color}
        type="button"
        className="map-sketch-swatch"
        style={{ background: color }}
        aria-label={uiText(label)}
        title={uiText(label)}
        aria-pressed={color === sketch.color}
        onClick={() => { sketch.chooseColor(color); setOpen(false) }}
      />)}
    </div>}
  </div>
}

/** The pencil beside the choice of icons, and while drawing, the eraser, the colour, back, forward, ✓ and ✕; with a drawing kept, the cross that closes it. */
export function MapSketchToolbar({ sketch, onBegin }: { sketch: MapSketch; onBegin: () => void }) {
  return <div className={`map-tools map-sketch${sketch.editing ? ' is-editing' : ''}`} role="toolbar" aria-label={uiText('Зарисовка')}>
    {sketch.editing
      ? <>
        <ToolButton label="Карандаш" pressed={sketch.tool === 'pencil'} onClick={() => sketch.chooseTool('pencil')}><Pencil size={14} style={sketch.tool === 'pencil' ? { color: sketch.color } : undefined} aria-hidden="true" /></ToolButton>
        <ToolButton label="Резинка" pressed={sketch.tool === 'eraser'} onClick={() => sketch.chooseTool('eraser')}><Eraser size={14} aria-hidden="true" /></ToolButton>
        <SketchColors sketch={sketch} />
        <ToolButton label="Назад" disabled={!sketch.canUndo} onClick={sketch.undo}><Undo2 size={14} aria-hidden="true" /></ToolButton>
        <ToolButton label="Вперёд" disabled={!sketch.canRedo} onClick={sketch.redo}><Redo2 size={14} aria-hidden="true" /></ToolButton>
        <ToolButton label="Ок" className="map-sketch-accept" onClick={sketch.accept}><Check size={14} aria-hidden="true" /></ToolButton>
        <ToolButton label="Отмена" className="map-sketch-cancel" onClick={sketch.cancel}><X size={14} aria-hidden="true" /></ToolButton>
      </>
      : <>
        <ToolButton label="Зарисовка" onClick={() => { onBegin(); sketch.begin() }}><Pencil size={14} aria-hidden="true" /></ToolButton>
        {sketch.kept && <ToolButton label="Закрыть зарисовку" className="map-sketch-cancel" onClick={sketch.close}><X size={14} aria-hidden="true" /></ToolButton>}
      </>}
  </div>
}

/**
 * The strokes on the map, under its points, never taking a click; while drawing, a press draws. One finger draws on a phone, two zoom
 * the map (a stroke begun by the first finger goes). The wheel and the zoom buttons work while drawing. The eraser goes the same way:
 * what lies between its press and its release is one step back.
 */
export function MapSketchLayer({ sketch }: { sketch: MapSketch }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  // At the end of a zoom only: while it runs the whole picture, lines too, is scaled by the browser.
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const { editing, draw, replace, tool, color } = sketch
  /** What the eraser has left so far, shown while it is held. */
  const [erased, setErased] = useState<SketchStroke[] | null>(null)
  const current = useRef(sketch.strokes)
  useEffect(() => { current.current = sketch.strokes })

  useEffect(() => {
    if (!editing) return
    const container = map.getContainer()
    const dragging = map.dragging.enabled()
    const doubleClick = map.doubleClickZoom.enabled()
    map.dragging.disable()
    map.doubleClickZoom.disable()
    container.classList.add('is-sketching')
    const erasing = tool === 'eraser'
    container.classList.toggle('is-erasing', erasing)

    let line: LeafletPolyline | null = null
    let points: SketchPoint[] = []
    let last = { x: 0, y: 0 }
    let pointer: number | null = null
    let strokeZoom = 0
    /** A second finger is down: no drawing until every finger is up. */
    const fingers = new Set<number>()
    let pinching = false
    /** The eraser, while held: what it has left, and where it was last. */
    let left: SketchStroke[] | null = null
    let rubbed: ScreenPoint = { x: 0, y: 0 }

    const drop = () => {
      line?.remove()
      line = null
      points = []
      pointer = null
      left = null
      setErased(null)
    }
    const rub = (to: ScreenPoint) => {
      if (!left) return
      const next = eraseStrokes(left, (point) => map.latLngToContainerPoint(point), rubbed, to)
      rubbed = to
      if (next !== left) {
        left = next
        setErased(next)
      }
    }
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        fingers.add(event.pointerId)
        if (fingers.size > 1) { pinching = true; drop(); return }
      }
      if (pinching || pointer !== null || event.button !== 0) return
      if ((event.target as HTMLElement).closest('.leaflet-control')) return
      event.preventDefault()
      container.setPointerCapture?.(event.pointerId)
      pointer = event.pointerId
      last = { x: event.clientX, y: event.clientY }
      if (erasing) {
        left = current.current
        rubbed = map.mouseEventToContainerPoint(event)
        rub(rubbed)
        return
      }
      strokeZoom = map.getZoom()
      const at = map.mouseEventToLatLng(event)
      points = [[roundMetres(at.lat), roundMetres(at.lng)]]
      line = leafletPolyline(points, { pane: PANE, color, weight: SKETCH_LINE_PX, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map)
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      if (Math.hypot(event.clientX - last.x, event.clientY - last.y) < MIN_STEP_PX) return
      last = { x: event.clientX, y: event.clientY }
      if (left) { rub(map.mouseEventToContainerPoint(event)); return }
      if (!line) return
      const at = map.mouseEventToLatLng(event)
      const point: SketchPoint = [roundMetres(at.lat), roundMetres(at.lng)]
      points.push(point)
      line.addLatLng(point)
    }
    const onUp = (event: PointerEvent) => {
      fingers.delete(event.pointerId)
      if (!fingers.size) pinching = false
      if (event.pointerId !== pointer) return
      if (event.type === 'pointerup') {
        if (left) replace(left)
        // A press without a move leaves a dot.
        else if (points.length) draw({ zoom: strokeZoom, points: points.length > 1 ? points : [points[0]!, points[0]!], color })
      }
      drop()
    }
    container.addEventListener('pointerdown', onDown)
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('pointercancel', onUp)
    return () => {
      container.removeEventListener('pointerdown', onDown)
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('pointercancel', onUp)
      container.classList.remove('is-sketching', 'is-erasing')
      drop()
      if (dragging) map.dragging.enable()
      if (doubleClick) map.doubleClickZoom.enable()
    }
  }, [color, draw, editing, map, replace, tool])

  return <Pane name={PANE} style={{ zIndex: 450, pointerEvents: 'none' }}>
    {(erased ?? sketch.strokes).map((stroke, index) => <Polyline
      // The eraser can shorten a list and split a stroke: the line at a place in it takes whatever stands there now.
      key={index}
      positions={stroke.points}
      interactive={false}
      pathOptions={{ color: stroke.color ?? SKETCH_DEFAULT_COLOR, weight: sketchLineWidth(map.getZoomScale(zoom, stroke.zoom)), lineCap: 'round', lineJoin: 'round' }}
    />)}
  </Pane>
}
