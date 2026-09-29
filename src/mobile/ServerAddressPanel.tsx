import { useState, type FormEvent } from 'react'
import { RotateCcw, Save, Wifi } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { apiBaseUrl, DEFAULT_API_URL, setApiBaseUrl } from '../sync/webAccount'
import { refreshServerStatus } from '../sync/serverSync'

/**
 * Phone app: «Адрес сервера». The phone cannot reach 127.0.0.1 of the PC, so the owner enters the PC's address in
 * the home Wi-Fi (e.g. http://192.168.1.20:8787) or an HTTPS address of a hosted server.
 */
export function ServerAddressPanel() {
  const [value, setValue] = useState(apiBaseUrl)
  const [saved, setSaved] = useState(apiBaseUrl)
  const [error, setError] = useState('')

  const save = (event: FormEvent) => {
    event.preventDefault()
    try {
      const next = setApiBaseUrl(value)
      setValue(next)
      setSaved(next)
      setError('')
      void refreshServerStatus()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Некорректный адрес сервера')
    }
  }

  const reset = () => {
    setApiBaseUrl(DEFAULT_API_URL)
    setValue(DEFAULT_API_URL)
    setSaved(DEFAULT_API_URL)
    setError('')
    void refreshServerStatus()
  }

  return (
    <section className="panel" aria-label={uiText('Адрес сервера')}>
      <div className="panel-header"><div className="panel-title"><Wifi size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Адрес сервера')}</div></div>
      <form className="panel-body stack" onSubmit={save}>
        <p className="dim" style={{ margin: 0 }}>{uiText('Телефон не видит «127.0.0.1» компьютера. Укажите адрес ПК в той же сети Wi-Fi (например http://192.168.1.20:8787) или HTTPS-адрес сервера.')}</p>
        <label className="field-label">{uiText('Адрес')}
          <input className="input server-address-input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={value} maxLength={200} onChange={(event) => setValue(event.target.value)} placeholder="http://192.168.1.20:8787" />
        </label>
        {error && <p className="dim" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{uiText(error)}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button primary" type="submit" disabled={value.trim() === saved}><Save size={14} />{uiText('Сохранить')}</button>
          <button className="button ghost" type="button" onClick={reset} disabled={saved === DEFAULT_API_URL}><RotateCcw size={14} />{uiText('По умолчанию')}</button>
        </div>
      </form>
    </section>
  )
}
