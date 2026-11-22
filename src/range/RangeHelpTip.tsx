import { useId, useState } from 'react'

/**
 * A «?» in a circle with an explanation (owner, 23.11.2026: «Там сделай вопросик в кружочке и объясни, что это значит»): shown
 * on hover or keyboard focus, and on a click or tap until the next one.
 */
export function RangeHelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <span className={`range-help${open ? ' is-open' : ''}`}>
    <button type="button" className="range-help-mark" aria-label={label} aria-describedby={id} aria-expanded={open} onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}>?</button>
    <span role="tooltip" id={id} className="range-help-text">{children}</span>
  </span>
}
