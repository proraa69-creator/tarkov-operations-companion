import { Crosshair } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import '../styles/questConditions.css'

/**
 * The heading of the section «С условиями на снаряжение» at the bottom of «Текущие задания» (Overview) and «Квесты на
 * карте» (Maps): the quests with a weapon, parts or gear condition, apart from the ordinary ones (owner, 15.10.2026:
 * «придумай какую то отдельную колонку для них. что бы не путаться в квестах»). Only a grouping: the counts stay.
 */
export function GearSectionHeading({ count }: { count: number }) {
  return <div className="gear-section-head" role="heading" aria-level={4}>
    <span className="gear-section-icon" aria-hidden="true"><Crosshair size={13} /></span>
    <span className="gear-section-title">{uiText('С условиями на снаряжение')}</span>
    <span className="gear-section-count">{count}</span>
  </div>
}
