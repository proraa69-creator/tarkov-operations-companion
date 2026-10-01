import { uiText } from '../i18n/renderText'
import './squad.css'

/** A light «Отряд ×N» mark on a quest that N squad members have active (Maps → «Квесты на карте»). */
export function SquadQuestTag({ count }: { count?: number }) {
  if (!count || count < 2) return null
  return <span className="squad-quest-tag" title={uiText('Это задание активно у нескольких участников отряда')}>{uiText('Отряд')} ×{count}</span>
}
