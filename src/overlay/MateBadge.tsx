import { uiText } from '../i18n/renderText'
import './mateBadge.css'

/**
 * Who of the friends / squad needs this item for a current quest: their Tarkov nicknames (owner, 10.10.2026: «вместо
 * MATE ник того, кому нужен предмет»), two at most and «+N»; «MATE» when the server sent no names.
 */
export function MateBadge({ show, names = [] }: { show: boolean; names?: string[] }) {
  if (!show) return null
  const shown = names.slice(0, 2)
  const label = shown.length ? `${shown.join(', ')}${names.length > shown.length ? ` +${names.length - shown.length}` : ''}` : 'MATE'
  return <em className="eft-mate" title={uiText(names.length ? `Нужен: ${names.join(', ')}` : 'Нужен другу или участнику отряда')}>{label}</em>
}
