import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

/**
 * The phone's controls on the range's full screen (owner, 24.11.2026: «В прицеле нужно сделать не джойстик а левую часть экрана для
 * наведения, сделай более плавнее управление»): a finger drawn over the left half of the screen turns the view by as much as it
 * moves, the fire button on the right fires. `turned`: the screen is turned a quarter by CSS where the phone would not lock to
 * landscape, so a finger's way on the glass is turned back into the picture's.
 */
const holdPointer = (event: ReactPointerEvent<HTMLElement>) => {
  try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* a pointer the page cannot hold */ }
}

/** The left half of the screen: the finger's way, in the picture's pixels, right and down. */
export function RangeLookArea({ onLook, turned, hint }: { onLook: (dx: number, dy: number) => void; turned: boolean; hint: string }) {
  const finger = useRef<{ id: number; x: number; y: number } | null>(null)
  const [used, setUsed] = useState(false)
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = finger.current
    if (!from || event.pointerId !== from.id) return
    let dx = event.clientX - from.x
    let dy = event.clientY - from.y
    finger.current = { id: from.id, x: event.clientX, y: event.clientY }
    // turned a quarter clockwise: the picture's right is the glass' down, its down the glass' left
    if (turned) [dx, dy] = [dy, -dx]
    if (dx || dy) onLook(dx, dy)
  }
  const letGo = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (finger.current?.id === event.pointerId) finger.current = null
  }
  return <div className="range-look" aria-hidden="true"
    onPointerDown={(event) => {
      event.preventDefault()
      // one finger aims; another landing here meanwhile is let be
      if (finger.current) return
      holdPointer(event)
      finger.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      setUsed(true)
    }}
    onPointerMove={move} onPointerUp={letGo} onPointerCancel={letGo} onLostPointerCapture={letGo} onContextMenu={(event) => event.preventDefault()}>
    {!used && <span className="range-look-hint">{hint}</span>}
  </div>
}

/**
 * A slider standing upright, the least at the bottom (in the picture; on the glass to the left when the picture is turned): where
 * the finger is on it is where it stands.
 */
export function RangeTouchSlider({ share, onShare, turned, label, value, caption, stops }: {
  share: number
  onShare: (share: number) => void
  turned: boolean
  label: string
  /** The value now as it reads («300 м», «×6»). */
  value: string
  /** A word under it. */
  caption: string
  /** Fixed steps: the marks on the track. */
  stops?: number
}) {
  const track = useRef<HTMLSpanElement>(null)
  const finger = useRef<number | null>(null)
  const set = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return
    // the picture's up is the glass' right when it is turned
    onShare(clamp(turned ? (event.clientX - box.left) / box.width : (box.bottom - event.clientY) / box.height))
  }
  const letGo = (event: ReactPointerEvent<HTMLDivElement>) => { if (finger.current === event.pointerId) finger.current = null }
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = stops && stops > 1 ? 1 / (stops - 1) : 0.02
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); onShare(clamp(share + step)) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); onShare(clamp(share - step)) }
  }
  const at = clamp(share) * 100
  return <div className="range-slider" role="slider" tabIndex={0} aria-label={label} aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at)} aria-valuetext={value}
    onPointerDown={(event) => {
      event.preventDefault()
      if (finger.current !== null) return
      holdPointer(event)
      finger.current = event.pointerId
      set(event)
    }}
    onPointerMove={(event) => { if (finger.current === event.pointerId) set(event) }}
    onPointerUp={letGo} onPointerCancel={letGo} onLostPointerCapture={letGo} onKeyDown={onKey} onContextMenu={(event) => event.preventDefault()}>
    <b className="range-slider-value">{value}</b>
    <span className="range-slider-track" ref={track}>
      {stops && stops > 1 && Array.from({ length: stops }, (_, index) => <i key={index} className="range-slider-stop" style={{ bottom: `${index / (stops - 1) * 100}%` }} />)}
      <span className="range-slider-fill" style={{ height: `${at}%` }} />
      <span className="range-slider-thumb" style={{ bottom: `${at}%` }} />
    </span>
    <span className="range-slider-caption">{caption}</span>
  </div>
}

/** Held: the trigger pulled (automatic fire goes on while it is held). */
export function RangeFireButton({ onDown, onUp, label, children }: { onDown: () => void; onUp: () => void; label: string; children?: ReactNode }) {
  const [down, setDown] = useState(false)
  const release = () => { if (!down) return; setDown(false); onUp() }
  return <button type="button" className={`range-fire${down ? ' is-down' : ''}`} aria-label={label}
    onPointerDown={(event) => { event.preventDefault(); holdPointer(event); setDown(true); onDown() }}
    onPointerUp={release} onPointerCancel={release} onContextMenu={(event) => event.preventDefault()}>
    {children}
  </button>
}

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
