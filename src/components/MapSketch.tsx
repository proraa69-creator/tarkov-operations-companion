import { useEffect, useState } from 'react'
import { Pane, Polyline, useMap, useMapEvents } from 'react-leaflet'
import { polyline as leafletPolyline, type Polyline as LeafletPolyline } from 'leaflet'
import { Check, Pencil, Redo2, Undo2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { SKETCH_LINE_PX, sketchLineWidth, type MapSketch, type SketchPoint } from '../maps/mapSketch'
import './mapSketch.css'

const COLOR = '#ff2b2b'
const PANE = 'map-sketch'
/** Closer than this to the last point, in screen pixels, a move adds nothing. */
const MIN_STEP_PX = 2
const metres = (value: number) => Math.round(value * 100) / 100

function ToolButton({ label, onClick, disabled, className = '', children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; children: React.ReactNode }) {
  const text = uiText(label)
  return <button type="button" className={`map-tool icon ${className}`} aria-label={text} title={text} disabled={disabled} onClick={onClick}>{children}</button>
}

/** The pencil beside the choice of icons, and while drawing, back, forward, ✓ and ✕; with a drawing kept, the cross that closes it. */
export function MapSketchToolbar({ sketch, onBegin }: { sketch: MapSketch; onBegin: () => void }) {
  return <div className="map-tools map-sketch" role="toolbar" aria-label={uiText('Зарисовка')}>
    {sketch.editing
      ? <>
        <span className="map-tool icon map-sketch-pen" aria-hidden="true"><Pencil size={14} /></span>
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
 * the map (a stroke begun by the first finger goes). The wheel and the zoom buttons work while drawing.
 */
export function MapSketchLayer({ sketch }: { sketch: MapSketch }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  // At the end of a zoom only: while it runs the whole picture, lines too, is scaled by the browser.
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const { editing, draw } = sketch

  useEffect(() => {
    if (!editing) return
    const container = map.getContainer()
    const dragging = map.dragging.enabled()
    const doubleClick = map.doubleClickZoom.enabled()
    map.dragging.disable()
    map.doubleClickZoom.disable()
    container.classList.add('is-sketching')

    let line: LeafletPolyline | null = null
    let points: SketchPoint[] = []
    let last = { x: 0, y: 0 }
    let pointer: number | null = null
    let strokeZoom = 0
    /** A second finger is down: no drawing until every finger is up. */
    const fingers = new Set<number>()
    let pinching = false

    const drop = () => {
      line?.remove()
      line = null
      points = []
      pointer = null
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
      strokeZoom = map.getZoom()
      const at = map.mouseEventToLatLng(event)
      points = [[metres(at.lat), metres(at.lng)]]
      last = { x: event.clientX, y: event.clientY }
      line = leafletPolyline(points, { pane: PANE, color: COLOR, weight: SKETCH_LINE_PX, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map)
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer || !line) return
      if (Math.hypot(event.clientX - last.x, event.clientY - last.y) < MIN_STEP_PX) return
      last = { x: event.clientX, y: event.clientY }
      const at = map.mouseEventToLatLng(event)
      const point: SketchPoint = [metres(at.lat), metres(at.lng)]
      points.push(point)
      line.addLatLng(point)
    }
    const onUp = (event: PointerEvent) => {
      fingers.delete(event.pointerId)
      if (!fingers.size) pinching = false
      if (event.pointerId !== pointer) return
      // A press without a move leaves a dot.
      if (event.type === 'pointerup' && points.length) draw({ zoom: strokeZoom, points: points.length > 1 ? points : [points[0]!, points[0]!] })
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
      container.classList.remove('is-sketching')
      drop()
      if (dragging) map.dragging.enable()
      if (doubleClick) map.doubleClickZoom.enable()
    }
  }, [draw, editing, map])

  return <Pane name={PANE} style={{ zIndex: 450, pointerEvents: 'none' }}>
    {sketch.strokes.map((stroke, index) => <Polyline
      // A stroke never changes: a new place in the list is a new stroke.
      key={index}
      positions={stroke.points}
      interactive={false}
      pathOptions={{ color: COLOR, weight: sketchLineWidth(map.getZoomScale(zoom, stroke.zoom)), lineCap: 'round', lineJoin: 'round' }}
    />)}
  </Pane>
}
