import { Info } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { PENETRATION_POINTS } from './penetrationPoints'
import './arsenal.css'

/**
 * «Как работает пробитие» on «Баллистика» (player report 226): how a bullet meets armour, in short, as the app itself counts it —
 * the penetration chance of src/arsenal/ballistics.ts and the hit of the game's client code in src/range/rangeModel.ts
 * (resistance class × 10 and its fall with durability, 0 % at 15 below, about 90 % at equal, up to 40 % of damage and
 * penetration lost going through, blunt damage when stopped, ricochets off helmets and visors by angle, a fragmentation chance
 * per round). Folded until opened.
 */
export function PenetrationGuide() {
  return (
    <details className="panel penetration-guide">
      <summary className="panel-header"><span className="panel-title"><Info size={14} aria-hidden="true" />{uiText('Как работает пробитие')}</span></summary>
      <ul className="panel-body penetration-guide-list">
        {PENETRATION_POINTS.map((point) => <li key={point}>{uiText(point)}</li>)}
      </ul>
    </details>
  )
}
