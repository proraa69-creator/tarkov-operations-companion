import { useRef, useState, type KeyboardEvent } from 'react'
import { Globe2, LogOut } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { cleanIpcError, logoutFromServer } from '../sync/serverSync'
import { CountryPicker, type CountryChoice } from '../components/CountryPicker'
import { saveInitialCountry, useCountryGate } from './initialCountry'
import './countryGate.css'

/**
 * «Укажите страну» (owner, 15.10.2026: «у тех у кого не указана страна, сделай всплывающее окно о том что "укажите
 * страну". пока они не заполнят не смогут дальше использовать»): an account from before the question at registration
 * (13.10.2026) gets this window over the whole app, the PC and the phone, the locked screens too (src/app/App.tsx). It
 * cannot be closed — no ✕, Escape does nothing, a click beside it does nothing, Tab stays inside — but «Выйти из
 * аккаунта» always works. Asked once per sign-in (GET /v1/accounts/me, `needsCountry`); a server that does not say so
 * shows nothing. After the save the server has the country (and the owner's tools work as before).
 */
export function CountryGate() {
  const gate = useCountryGate()
  return gate.missing ? <CountryGateDialog onSaved={gate.saved} onSignOut={() => { void logoutFromServer() }} /> : null
}

export function CountryGateDialog({ onSaved, onSignOut }: { onSaved: () => void; onSignOut: () => void }) {
  const { locale } = useLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLElement>(null)

  const save = async (choice: CountryChoice) => {
    setBusy(true)
    setError('')
    try {
      await saveInitialCountry(choice)
      onSaved()
    } catch (reason) {
      const message = cleanIpcError(reason)
      // Another device set it meanwhile: nothing more to ask.
      if (/Страна уже указана/.test(message)) { onSaved(); return }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  // Not dismissible: Escape stops here, Tab goes round inside the window.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
    if (!focusable.length) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="registration-overlay country-gate" role="dialog" aria-modal="true" aria-labelledby="country-gate-title" aria-describedby="country-gate-reason" onKeyDown={onKeyDown}>
      <section ref={dialog} className="panel registration-dialog country-gate-dialog">
        <div className="registration-icon"><Globe2 size={24} aria-hidden="true" /></div>
        <h2 id="country-gate-title">{uiLabel('Укажите страну')}</h2>
        <p id="country-gate-reason" className="muted country-gate-reason">{uiLabel('Нужна для правильного языка уведомлений и поддержки. Без неё приложением пользоваться нельзя.')}</p>
        <CountryPicker locale={locale} t={uiLabel} busy={busy} onSubmit={(choice) => void save(choice)} />
        {error && <p className="account-error country-gate-error" role="alert">{uiLabel(error)}</p>}
        <button type="button" className="link-button country-gate-signout" disabled={busy} onClick={onSignOut}>
          <LogOut size={13} aria-hidden="true" />{uiLabel('Выйти из аккаунта')}
        </button>
      </section>
    </div>
  )
}
