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
  // Our own green button with the coloured «G» and no white anywhere (owner, 16.11.2026: «Убери все белое с этой кнопки…
  // Google должен быть на зеленом фоне нашем»). Google's button, which does the sign-in, lies over it unseen and takes the press.
  return <div className="google-sign-in">
    {error !== null && <Notice tone="error">{errorMessage(error)}</Notice>}
    <div style={{ position: 'relative', marginBottom: 10 }}>
      <span className="button large block google-face" aria-hidden="true">{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <GoogleMark />}{tr('Войти через Google')}</span>
      <div ref={box} className="google-button" aria-busy={busy} aria-label={tr('Войти через Google')} style={{ position: 'absolute', inset: 0, opacity: 0.001, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
    </div>
  </div>
}

/** Google's «G» in its four colours, straight on our button (no white plate). */
function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
}
