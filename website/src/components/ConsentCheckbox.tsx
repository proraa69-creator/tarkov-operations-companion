import { Link } from 'react-router-dom'
import { tr } from '../i18n'
import '../extras.css'

/**
 * «Я принимаю условия оферты и даю согласие на обработку персональных данных» — never pre-ticked; the caller enables
 * «Оплатить» / «Зарегистрироваться» only when it is checked and sends LEGAL_VERSION to the server.
 */
export function ConsentCheckbox({ checked, onChange, id = 'consent' }: { checked: boolean; onChange: (checked: boolean) => void; id?: string }) {
  return (
    <label className="consent" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {tr('Я принимаю условия')} <Link to="/legal/offer" target="_blank" rel="noopener">{tr('оферты')}</Link> {tr('и даю')} <Link to="/legal/consent" target="_blank" rel="noopener">{tr('согласие на обработку персональных данных')}</Link> {tr('в соответствии с')} <Link to="/legal/privacy" target="_blank" rel="noopener">{tr('политикой')}</Link>
      </span>
    </label>
  )
}
