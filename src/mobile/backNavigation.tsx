import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { BACK_BUTTON_PLACES, backDelta, setBackButtonPlace, useBackButtonPlace, usePageHistory } from './backHistory'

/** The floating «Назад», shown on every page reached by a tap; it returns to the page before, scrolled where it was. */
export function PhoneBackButton() {
  const navigate = useNavigate()
  const place = useBackButtonPlace()
  useLocation()
  usePageHistory()
  const delta = backDelta()
  if (delta == null) return null
  return <button type="button" className={`phone-back is-${place}`} onClick={() => navigate(delta)} aria-label={uiText('Назад')}><ArrowLeft size={18} /><span>{uiText('Назад')}</span></button>
}

/**
 * Settings: the place of «Назад» — four corners and a small phone picture where the button moves at once and can be
 * tapped (it does nothing there), so the player checks at once whether the place suits him (owner, 17.10.2026).
 */
export function BackButtonSettings() {
  const place = useBackButtonPlace()
  const [taps, setTaps] = useState(0)
  return <div className="setting-row phone-back-setting">
    <span><strong>{uiText('Кнопка «Назад»')}</strong><small>{uiText('Есть на каждом экране после перехода по меню и возвращает туда же, где вы были. Нажмите кнопку на картинке — удобно ли до неё дотянуться.')}</small></span>
    <div className="phone-back-choice">
      <div className="phone-back-places" role="radiogroup" aria-label={uiText('Где кнопка «Назад»')}>
        {BACK_BUTTON_PLACES.map((entry) => <button type="button" role="radio" aria-checked={place === entry.id} key={entry.id} className={`button small phone-back-place${place === entry.id ? ' primary' : ''}`} onClick={() => setBackButtonPlace(entry.id)}><span className={`phone-back-corner is-${entry.id}`} aria-hidden="true" />{uiText(entry.label)}</button>)}
      </div>
      <div className="phone-back-preview" aria-hidden="true">
        <span className="phone-back-preview-top" />
        <span className="phone-back-preview-line" /><span className="phone-back-preview-line short" /><span className="phone-back-preview-line" />
        <span className="phone-back-preview-tabs" />
        <button type="button" tabIndex={-1} className={`phone-back-preview-button is-${place}`} key={`${place}-${taps}`} onClick={() => setTaps((count) => count + 1)}><ArrowLeft size={11} />{uiText('Назад')}</button>
      </div>
    </div>
  </div>
}
