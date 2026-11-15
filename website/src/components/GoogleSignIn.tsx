import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, errorMessage } from '../api'
import { useAuth } from '../auth'
import { siteLocale, tr } from '../i18n'
import { ConsentCheckbox } from './ConsentCheckbox'
import { CountrySelect } from './CountrySelect'
import { LEGAL_VERSION } from '../legal/documents'
import { Notice } from './Notice'
import { googleSignInOffered } from '../../../src/shared/googleRegion'

/**
 * «Войти через Google» (owner, 15.11.2026: «для всех стран, кроме России»): Google's own button (Google Identity Services)
 * gives an ID token; POST /v1/accounts/google checks it and signs in, or — for an address with no account — asks the
 * country first (Russia is refused there). Hidden on a device set to a Russian time zone (googleRegion.ts) and while the
 * server names no Google client.
 */
const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface GoogleIdApi {
  initialize(options: { client_id: string; callback: (answer: { credential?: string }) => void; ux_mode?: 'popup'; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void
  renderButton(element: HTMLElement, options: Record<string, unknown>): void
}
declare global { interface Window { google?: { accounts?: { id?: GoogleIdApi } } } }

let scriptPromise: Promise<GoogleIdApi> | null = null
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  scriptPromise ??= new Promise<GoogleIdApi>((resolve, reject) => {
    const ready = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load')))
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = ready
    script.onerror = () => { scriptPromise = null; reject(new Error('Google sign-in did not load')) }
    document.head.append(script)
  })
  return scriptPromise
}

/** `onSignedIn`: stay on the page (the QR approval of the PC app, pages/AppLoginPage.tsx) instead of going to the cabinet. */
export function GoogleSignIn({ clientId, referralCode, onSignedIn }: { clientId?: string; referralCode?: string; onSignedIn?: () => void }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [country, setCountry] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const shown = Boolean(clientId) && googleSignInOffered()

  const send = async (credential: string, chosen?: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.googleSignIn({ credential, ...(chosen ? { country: chosen } : {}), ...(referralCode ? { referralCode } : {}) })
      // a new account: the accepted documents, as after a registration (152-ФЗ: consent must be provable)
      if (result.created) void api.recordConsent(result.token, 'registration', LEGAL_VERSION).catch(() => undefined)
      auth.adopt(result.token, result.account)
      if (onSignedIn) onSignedIn()
      else navigate('/cabinet', { replace: true, ...(result.created ? { state: { welcome: true } } : {}) })
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && !chosen) setPending(credential)
      else setError(reason)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!shown || !clientId || pending) return
    let active = true
    loadGoogle().then((google) => {
      if (!active || !box.current) return
      google.initialize({ client_id: clientId, callback: (answer) => { if (answer.credential) void send(answer.credential) }, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true })
      google.renderButton(box.current, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'continue_with', logo_alignment: 'left', width: Math.min(400, box.current.clientWidth || 320), locale: siteLocale() })
    }, () => { /* no Google here (blocked network, ad blocker): the other ways stay */ })
    return () => { active = false }
    // send() only reads the latest state through setters; the button is drawn once per client and step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, clientId, pending])

  if (!shown) return null
  if (pending) {
    const submit = (event: FormEvent) => { event.preventDefault(); if (country && consent) void send(pending, country) }
    return <form className="form google-country" onSubmit={submit}>
      <p className="lead">{tr('Укажите страну, чтобы создать аккаунт.')}</p>
      {error !== null && <Notice tone="error">{errorMessage(error)}</Notice>}
      <CountrySelect value={country} onChange={setCountry} />
      <ConsentCheckbox checked={consent} onChange={setConsent} id="google-consent" />
      <button type="submit" className="button primary large block" disabled={busy || !country || !consent}>
        {busy && <LoaderCircle className="spinner" aria-hidden="true" />}{tr('Продолжить')}
      </button>
    </form>
  }
  return <div className="google-sign-in">
    {error !== null && <Notice tone="error">{errorMessage(error)}</Notice>}
    <div ref={box} className="google-button" aria-busy={busy} style={{ display: 'flex', justifyContent: 'center', minHeight: 44, marginBottom: 10 }} />
  </div>
}
