import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Marker, Pane, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { divIcon, DomEvent, type DivIcon } from 'leaflet'
import { Check, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isPin, PIN_HEAD_PX, PIN_TEXT_MAX, pinEditorPlace, SKETCH_DEFAULT_COLOR, type SketchPoint, type SketchStroke } from '../maps/mapSketch'

/**
 * Pins of a drawing (a player's proposal №249; owner, 26.11.2026: «можно ставить геометки, куда удобно, и по желанию подписывать
 * их»): the map's own teardrop in the pencil's colour, its tip on the point, its words beside it. They take no click, like the strokes.
 */
const HEX = /^#[0-9a-f]{6}$/i
const icons = new Map<string, DivIcon>()
/** The tip is the point; the head's middle PIN_HEAD_PX above it (the eraser's reach, maps/mapSketch.ts). */
function pinIcon(color: string): DivIcon {
  const fill = HEX.test(color) ? color : SKETCH_DEFAULT_COLOR
  let icon = icons.get(fill)
  if (!icon) {
    icon = divIcon({
      className: 'map-pin',
      iconSize: [22, 30],
      iconAnchor: [11, 29],
      html: '<svg viewBox="0 0 22 30" width="22" height="30" aria-hidden="true">'
        + '<path d="M11 29C11 29 2.2 18.4 2.2 11A8.8 8.8 0 0 1 19.8 11C19.8 18.4 11 29 11 29Z" fill="' + fill + '" stroke="rgba(0,0,0,.7)" stroke-width="1.4"/>'
        + '<circle cx="11" cy="11" r="3.3" fill="rgba(0,0,0,.55)"/></svg>',
    })
    icons.set(fill, icon)
  }
  return icon
}

/** One pane of pins over the map's points; `opacity` for the squad's. */
export function SketchPins({ strokes, pane, opacity = 1 }: { strokes: readonly SketchStroke[]; pane: string; opacity?: number }) {
  const pins = strokes.flatMap((stroke, index) => (isPin(stroke) ? [{ stroke, index }] : []))
  if (!pins.length) return null
  return <Pane name={pane} style={{ zIndex: 620, pointerEvents: 'none' }}>
    {pins.map(({ stroke, index }) => <Marker
      // the eraser and the steps back change the list: the pin at a place in it takes whatever stands there now
      key={index}
      position={stroke.points[0]!}
      icon={pinIcon(stroke.color ?? SKETCH_DEFAULT_COLOR)}
      interactive={false}
      keyboard={false}
      opacity={opacity}
    >
      {stroke.text && <Tooltip permanent direction="right" offset={[9, -PIN_HEAD_PX]} className="map-pin-label" interactive={false}>{stroke.text}</Tooltip>}
    </Marker>)}
  </Pane>
}

/**
 * A pin just put: its words at once (owner: «вылезает окно подписи, то есть сразу включается строка, и можно сразу писать текст»),
 * ✓ keeps the pin with them (or none), ✕ takes the pin off. Enter is ✓, Escape is ✕. It follows the pin when the map moves: to its
 * right, else to its left, else (a phone's narrow map) under it, always whole on the map.
 */
export function PinEditor({ point, color, onAccept, onCancel }: { point: SketchPoint; color: string; onAccept: (text: string) => void; onCancel: () => void }) {
  const map = useMap()
  const [text, setText] = useState('')
  const [, follow] = useState(0)
  useMapEvents({ move: () => follow((value) => value + 1), zoom: () => follow((value) => value + 1) })
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // its width once it stands: the phone's line is narrower (mapSketch.css)
  useLayoutEffect(() => { setWidth(box.current?.offsetWidth ?? 0) }, [])
  useEffect(() => {
    const element = box.current
    if (!element) return
    // The map's own clicks and wheel stay out of it; React's clicks still come.
    DomEvent.disableClickPropagation(element)
    DomEvent.disableScrollPropagation(element)
  }, [])
  const at = map.latLngToContainerPoint(point)
  const size = map.getSize()
  const place = pinEditorPlace(at.x, at.y, width, size.x)
  return createPortal(<div
    ref={box}
    className="map-pin-editor"
    style={{ left: place.left, top: place.top }}
    role="group"
    aria-label={uiText('Подпись')}
  >
    <span className="map-pin-editor-dot" style={{ background: color }} aria-hidden="true" />
    <input
      autoFocus
      value={text}
      maxLength={PIN_TEXT_MAX}
      placeholder={uiText('Подпись')}
      aria-label={uiText('Подпись')}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); onAccept(text) }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
      }}
    />
    <button type="button" className="map-tool icon map-sketch-accept" aria-label={uiText('Сохранить')} title={uiText('Сохранить')} onClick={() => onAccept(text)}><Check size={14} aria-hidden="true" /></button>
    <button type="button" className="map-tool icon map-sketch-cancel" aria-label={uiText('Удалить')} title={uiText('Удалить')} onClick={onCancel}><X size={14} aria-hidden="true" /></button>
  </div>, map.getContainer())
}
