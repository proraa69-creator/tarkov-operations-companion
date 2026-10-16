import { useEffect, useState } from 'react'
import { Swords } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import './scourgeEvent.css'
import { SCOURGE_EVENT_END, openScourgeEvent, scourgeEventActive } from './scourgeEvent'

/**
 * The Overview's event button next to «Следующий рейд начинается здесь» (owner, 16.10.2026: the red mark on the
 * screenshot): opens the event clip, the story and the new boss again. Hidden while the blocks are being arranged, and
 * gone by itself when the event ends («по окончанию ивента, кнопка должна сама исчезнуть»).
 */
export function ScourgeEventButton() {
  const [active, setActive] = useState(() => scourgeEventActive())
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => setActive(false), Math.min(SCOURGE_EVENT_END - Date.now(), 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [active])
  if (!active) return null
  return <button type="button" className="button small scourge-event-button" onClick={openScourgeEvent}>
    <Swords size={15} aria-hidden="true" /><span>{uiText('Ивент: Вторжение Scourge')}</span>
  </button>
}
