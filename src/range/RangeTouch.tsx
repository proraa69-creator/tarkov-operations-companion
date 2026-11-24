import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

/**
 * The phone's controls on the range's full screen (owner, 24.11.2026: «Джойстик получается лево-право водить и кнопка огня, нажатие
 * огня. Джойстик слева, огонь справа»). `turned`: the screen is turned a quarter by CSS where the phone would not lock to landscape,
 * so a finger's way on the glass is turned back into the stick's.
 */
const RADIUS = 52

export function RangeStick({ onStick, turned, label }: { onStick: (x: number, y: number) => void; turned: boolean; label: string }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const held = useRef<{ id: number; x: number; y: number } | null>(null)
  const push = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = held.current
    if (!from || event.pointerId !== from.id) return
    let dx = event.clientX - from.x
    let dy = event.clientY - from.y
    // turned a quarter clockwise: the stick's right is the glass' down, its down the glass' left
    if (turned) [dx, dy] = [dy, -dx]
    const length = Math.hypot(dx, dy)
    const k = length > RADIUS ? RADIUS / length : 1
    setKnob({ x: dx * k, y: dy * k })
    onStick(dx * k / RADIUS, -dy * k / RADIUS)
  }
  const letGo = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (held.current?.id !== event.pointerId) return
    held.current = null
    setKnob({ x: 0, y: 0 })
    onStick(0, 0)
  }
  return <div className="range-stick" role="slider" aria-label={label} aria-valuenow={0}
    onPointerDown={(event) => {
      event.preventDefault()
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* a pointer the page cannot hold */ }
      const box = event.currentTarget.getBoundingClientRect()
      held.current = { id: event.pointerId, x: box.left + box.width / 2, y: box.top + box.height / 2 }
      push(event)
    }}
    onPointerMove={push} onPointerUp={letGo} onPointerCancel={letGo} onContextMenu={(event) => event.preventDefault()}>
    <span className="range-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
  </div>
}

/** Held: the trigger pulled (automatic fire goes on while it is held). */
export function RangeFireButton({ onDown, onUp, label, children }: { onDown: () => void; onUp: () => void; label: string; children?: ReactNode }) {
  const [down, setDown] = useState(false)
  const release = () => { if (!down) return; setDown(false); onUp() }
  return <button type="button" className={`range-fire${down ? ' is-down' : ''}`} aria-label={label}
    onPointerDown={(event) => { event.preventDefault(); try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* as above */ } setDown(true); onDown() }}
    onPointerUp={release} onPointerCancel={release} onContextMenu={(event) => event.preventDefault()}>
    {children}
  </button>
}
