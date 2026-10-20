import { Check, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { localeTag, tr } from '../i18n'
import { Notice } from './Notice'
import '../payments.css'

const formatDate = (value: string) => new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))

/**
 * Cabinet: «Удалить аккаунт» — confirmed with the current password (POST /me/delete). The server deletes the account
 * 10 days later (owner, 20.10.2026); the 10 days are named only once the player has pressed «Удалить аккаунт», and
 * while they run the panel shows the date and «Отменить удаление».
 */
export function DeleteAccountPanel() {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const deletionAt = auth.account?.deletionAt

  async function cancel() {
    if (!auth.token) return
    setBusy(true); setError('')
    try {
      const { account } = await api.cancelAccountDeletion(auth.token)
      auth.setAccount(account)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="delete-account-title">
      <div className="panel-header">
        <div className="panel-title" id="delete-account-title"><Trash2 aria-hidden="true" />{tr('Удаление аккаунта')}</div>
      </div>
      <div className="panel-body form">
        {deletionAt && !open ? (
          <>
            <Notice tone="warn" title={tr('Аккаунт будет удалён {date}', { date: formatDate(deletionAt) })}>{tr('До этого срока аккаунт работает как обычно, удаление можно отменить.')}</Notice>
            {error && <Notice tone="error">{tr(error)}</Notice>}
            <div>
              <button type="button" className="button" disabled={busy} onClick={() => void cancel()}>
                {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}{tr('Отменить удаление')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>{tr('Почта, никнеймы, прогресс, друзья и настройки удаляются без возможности восстановления. Оплаченный срок подписки сгорает.')}</p>
            <div><button type="button" className="button account-delete" onClick={() => setOpen(true)}><Trash2 aria-hidden="true" />{tr('Удалить аккаунт')}</button></div>
          </>
        )}
      </div>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </section>
  )
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth()
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Set once the server has accepted the request: only now does the dialog say when the account goes.
  const [scheduledAt, setScheduledAt] = useState<string | null>(null)
  const [noteBefore, noteAfter] = tr('Аккаунт {email} будет удалён вместе со всеми данными. Записи об оплатах сохраняются обезличенно — их требует бухгалтерский учёт.').split('{email}')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    dialog.current?.querySelector<HTMLElement>('input, .button.primary')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose, scheduledAt])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!auth.token || !password) return
    setBusy(true); setError('')
    try {
      const { deletionAt, account } = await api.deleteAccount(auth.token, password)
      setPassword('')
      setScheduledAt(deletionAt)
      auth.setAccount(account)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  // A portal: the cabinet panels are animated with transforms, which would trap a fixed backdrop inside them.
  return createPortal(
    <div className="pay-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="pay-dialog password-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow">{tr('Аккаунт')}</div>
            <h2 id={titleId}>{scheduledAt ? tr('Удаление запланировано') : tr('Удалить аккаунт?')}</h2>
          </div>
          <button type="button" className="icon-button" aria-label={tr('Закрыть')} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        {scheduledAt ? (
          <div className="form">
            <p className="pay-dialog-note">{tr('Аккаунт будет удалён через 10 дней — {date}. Только после этого срока данные удаляются.', { date: formatDate(scheduledAt) })}</p>
            <p className="pay-dialog-note">{tr('До этого срока аккаунт работает как обычно, а удаление можно отменить в личном кабинете.')}</p>
            <div className="pay-dialog-actions">
              <button type="button" className="button primary" onClick={onClose}><Check aria-hidden="true" />{tr('Понятно')}</button>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={(event) => void submit(event)}>
            <p className="pay-dialog-note">{noteBefore}<strong style={{ color: 'var(--text)' }}>{auth.account?.email}</strong>{noteAfter}</p>
            <label className="field">
              <span className="field-label">{tr('Пароль для подтверждения')}</span>
              <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <Notice tone="error">{tr(error)}</Notice>}
            <div className="pay-dialog-actions">
              <button type="button" className="button ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</button>
              <button type="submit" className="button account-delete" disabled={busy || !password}>
                {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}{tr('Удалить аккаунт')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
