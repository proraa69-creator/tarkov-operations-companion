import { LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Notice } from './Notice'
import '../payments.css'

/** Cabinet: «Удалить аккаунт» — confirmed with the current password (POST /me/delete). */
export function DeleteAccountPanel() {
  const [open, setOpen] = useState(false)
  return (
    <section className="panel" aria-labelledby="delete-account-title">
      <div className="panel-header">
        <div className="panel-title" id="delete-account-title"><Trash2 aria-hidden="true" />Удаление аккаунта</div>
      </div>
      <div className="panel-body form">
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Почта, никнеймы, прогресс, друзья и настройки удаляются без возможности восстановления. Оплаченный срок подписки сгорает.</p>
        <div><button type="button" className="button account-delete" onClick={() => setOpen(true)}><Trash2 aria-hidden="true" />Удалить аккаунт</button></div>
      </div>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </section>
  )
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    dialog.current?.querySelector<HTMLElement>('input')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!auth.token || !password) return
    setBusy(true); setError('')
    try {
      await api.deleteAccount(auth.token, password)
      await auth.logout()
      navigate('/', { replace: true })
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }

  // A portal: the cabinet panels are animated with transforms, which would trap a fixed backdrop inside them.
  return createPortal(
    <div className="pay-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="pay-dialog password-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow">Аккаунт</div>
            <h2 id={titleId}>Удалить аккаунт?</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        <form className="form" onSubmit={(event) => void submit(event)}>
          <p className="pay-dialog-note">Аккаунт <strong style={{ color: 'var(--text)' }}>{auth.account?.email}</strong> будет удалён сразу и навсегда. Записи об оплатах сохраняются обезличенно — их требует бухгалтерский учёт.</p>
          <label className="field">
            <span className="field-label">Пароль для подтверждения</span>
            <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="pay-dialog-actions">
            <button type="button" className="button ghost" disabled={busy} onClick={onClose}>Отмена</button>
            <button type="submit" className="button account-delete" disabled={busy || !password}>
              {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}Удалить навсегда
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
