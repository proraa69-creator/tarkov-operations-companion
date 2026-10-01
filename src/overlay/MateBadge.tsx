import { uiText } from '../i18n/renderText'
import './mateBadge.css'

/** A bare purple «MATE» badge: a friend or squad mate needs this item for a current quest. No names, no details. */
export function MateBadge({ show }: { show: boolean }) {
  if (!show) return null
  return <em className="eft-mate" title={uiText('Нужен другу или участнику отряда')}>MATE</em>
}
