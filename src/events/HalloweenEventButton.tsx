import { Biohazard } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { openHalloweenEvent, useHalloweenActive } from './halloweenEvent'
import './halloweenEvent.css'

/**
 * The Overview's event button next to «Следующий рейд начинается здесь» (owner, 02.11.2026: «сделай кнопку Хеллоуин»):
 * opens the event window (HalloweenEventWindow.tsx). Hidden while the blocks are being arranged, and gone by itself when
 * the event ends.
 */
export function HalloweenEventButton() {
  const active = useHalloweenActive()
  if (!active) return null
  return <button type="button" className="button small halloween-event-button" onClick={openHalloweenEvent}>
    <Biohazard size={15} aria-hidden="true" /><span>{uiText('Хеллоуин')}</span>
  </button>
}
