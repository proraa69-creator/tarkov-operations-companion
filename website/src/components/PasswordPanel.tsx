import { KeyRound, LoaderCircle, Mail, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, type CodeChallenge } from '../api'
import { useAuth } from '../auth'
import { useAuthConfig } from './authConfig'
import { EmailCodeField, failure, ResendButton, retryAfter } from './EmailAuth'
import { Notice } from './Notice'
import '../payments.css'

/** Cabinet: «Пароль» — a small card; «Изменить пароль» opens a dialog confirmed by a code from the account's e-mail. */
export function PasswordPanel() {
  const [open, setOpen] = useState(false)
  const [changed, setChanged] = useState(false)

  return (
    <section className="panel" aria-labelledby="password-title">
      <div className="panel-header">
        <div className="panel-title" id="password-title"><KeyRound aria-hidden="true" />Пароль</div>
      </div>
      <div className="panel-body form">
        {changed
          ? <Notice tone="success">Пароль изменён. Входы на других устройствах завершены.</Notice>
          : <p className="muted" style={{ margin: 0, fontSize: 14 }}>Новый пароль подтверждается кодом из письма на почту аккаунта.</p>}
        <div><button type="button" className="button" onClick={() => { setChanged(false); setOpen(true) }}><KeyRound aria-hidden="true" />Изменить пароль</button></div>
      </div>
      {open && <PasswordDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); setChanged(true) }} />}
    </section>
  )
}

/**
 * The code goes to the account's own e-mail (the server's password reset: POST /email/reset/start → /email/reset);
 * every other session of the account ends. A server without e-mail codes falls back to the current password.
 */
function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const auth = useAuth()
  const config = useAuthConfig()
  const email = auth.account?.email ?? ''
  const byEmail = config?.emailEnabled === true
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null)
  const [code, setCode] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input, .pay-dialog-actions .button.primary')?.focus()
  }, [config, challenge])

  async function sendCode() {
    setBusy(true); setError(null); setLocalError('')
    try {
      const answer = await api.emailResetStart(email)
      setChallenge(answer)
      setCode('')
      setResendAt(Date.now() + answer.resendSeconds * 1000)
    } catch (reason) {
      setError(reason)
      const wait = retryAfter(reason)
      if (wait) setResendAt(wait)
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!auth.token) return
    if (next.length < 8) { setLocalError('Новый пароль должен быть не короче 8 символов.'); return }
    if (next !== repeat) { setLocalError('Пароли не совпадают.'); return }
    setBusy(true); setError(null); setLocalError('')
    try {
      const answer = challenge
        ? await api.emailReset(challenge.challengeId, code, next)
        : await api.changePassword(auth.token, current, next)
      auth.adopt(answer.token, answer.account)
      onDone()
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  const notices = <>
    {localError && <Notice tone="error">{localError}</Notice>}
    {failure(error)}
  </>

  const passwordFields = <>
    <label className="field">
      <span className="field-label">Новый пароль</span>
      <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
      <span className="field-hint">Не короче 8 символов. Входы на других устройствах будут завершены.</span>
    </label>
    <label className="field">
      <span className="field-label">Повторите новый пароль</span>
      <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
    </label>
  </>

  let body
  if (!config) {
    body = <div className="center-state"><LoaderCircle className="spinner" aria-hidden="true" /></div>
  } else if (byEmail && !challenge) {
    body = <>
      <p className="pay-dialog-note">Мы отправим код подтверждения на почту аккаунта <strong style={{ color: 'var(--text)' }}>{email}</strong>.</p>
      {notices}
      <div className="pay-dialog-actions">
        <button type="button" className="button ghost" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="button" className="button primary" disabled={busy || !email} onClick={() => void sendCode()}>
          {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Mail aria-hidden="true" />}Отправить код
        </button>
      </div>
    </>
  } else {
    body = (
      <form className="form" onSubmit={save}>
        {challenge
          ? <p className="pay-dialog-note">Код отправлен на <strong style={{ color: 'var(--text)' }}>{email}</strong>. Не сообщайте его никому.</p>
          : <label className="field">
              <span className="field-label">Текущий пароль</span>
              <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>}
        {notices}
        {challenge && <EmailCodeField value={code} onChange={setCode} />}
        {passwordFields}
        {challenge && <div><ResendButton until={resendAt} busy={busy} onClick={() => void sendCode()} /></div>}
        <div className="pay-dialog-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>Отмена</button>
          <button type="submit" className="button primary" disabled={busy || !next || (challenge ? code.length !== 6 : !current)}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}Сохранить
          </button>
        </div>
      </form>
    )
  }

  // A portal: the cabinet panels are animated with transforms, which would trap a fixed backdrop inside them.
  return createPortal(
    <div className="pay-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="pay-dialog password-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow">Аккаунт</div>
            <h2 id={titleId}>Изменить пароль</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        {body}
      </div>
    </div>,
    document.body,
  )
}
