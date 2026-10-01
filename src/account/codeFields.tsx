import { AlertTriangle } from 'lucide-react'
import { uiText } from '../i18n/renderText'

/** Shared bits of the one-time-code forms in the apps (e-mail codes; the SMS forms behind PHONE_AUTH_UI). */
export function Warning({ text }: { text: string }) {
  return text ? <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(text)}</span></div> : null
}

export function CodeInput({ value, onChange, label = 'Код из письма' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <label className="field-label">{uiText(label)}
      <input className="input account-code-input" inputMode="numeric" autoComplete="one-time-code" value={value} maxLength={6} placeholder="000000" autoFocus
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))} />
    </label>
  )
}
