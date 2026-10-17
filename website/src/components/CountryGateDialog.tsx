import { useRef, useState, type KeyboardEvent } from 'react'
import { Globe2, LogOut } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { siteLocale, tr } from '../i18n'
import { CountryPicker, type CountryChoice } from '../../../src/components/CountryPicker'
import '../payments.css'

/**
 * «Укажите страну» in the personal cabinet and the admin panel (owner, 15.10.2026; the app's window is
 * src/account/CountryGate.tsx): an account the server marks `needsCountry` gets this window over the page until it names
 * a country — from the list with a search, or typed by hand (src/components/CountryPicker.tsx). No ✕, Escape and a click
 * beside it do nothing; «Выйти из аккаунта» always works.
 */
export function CountryGateDialog() {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  if (!auth.token || !auth.account?.needsCountry) return null

  const save = async (choice: CountryChoice) => {
    if (!auth.token) return
    setBusy(true)
    setError('')
    try {
      auth.setAccount(await api.setInitialCountry(auth.token, choice))
    } catch (reason) {
      const message = errorMessage(reason)
      // Set meanwhile on another device: the account is read again and the window goes.
      if (/Страна уже указана/.test(message)) auth.reload()
      else setError(message)
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="pay-dialog-backdrop country-gate-backdrop" onKeyDown={onKeyDown}>
      <div ref={dialog} className="pay-dialog country-gate-site" role="dialog" aria-modal="true" aria-labelledby="country-gate-title" aria-describedby="country-gate-reason">
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow"><Globe2 size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 6 }} />{auth.account.email}</div>
            <h2 id="country-gate-title">{tr('Укажите страну')}</h2>
          </div>
        </div>
        <p id="country-gate-reason" className="pay-dialog-note">{tr('Нужна для правильного языка уведомлений и поддержки. Без неё личным кабинетом пользоваться нельзя.')}</p>
        <CountryPicker locale={siteLocale()} t={(text) => tr(text)} busy={busy} onSubmit={(choice) => void save(choice)} />
        {error && <p className="field-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button type="button" className="button ghost small" style={{ justifySelf: 'center' }} disabled={busy} onClick={() => void auth.logout()}>
          <LogOut aria-hidden="true" />{tr('Выйти из аккаунта')}
        </button>
      </div>
    </div>
  )
}
