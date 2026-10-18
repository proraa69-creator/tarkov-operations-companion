import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Lock, LoaderCircle, LogOut, MessageCircle, RefreshCw, Shield, Trash2, UserRound, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useServerAccount } from '../sync/serverSync'
import { webServiceRequest } from '../sync/webAccount'
import { SUPPORT_TELEGRAM_URL } from '../app/support'
import { useAccountNickname } from './useAccountNickname'
import { accessText, deleteErrorText, privacyPolicyUrl } from './iosAccountText'
import { PhoneCabinetRow } from './PhoneAccount'
import { PHONE_AUTH_UI } from './authFeatures'
import { EmailVerifyRow } from './EmailAccount'
import './account.css'
import './paywall.css'

/**
 * The account in the iPhone app (App Store build, owner 17.10.2026, src/platform.ts isIosApp): no plans, prices,
 * purchase links, referral discounts or partner payouts — the access the account has, «Обновить», «Поддержка»,
 * «Выйти», the privacy policy and «Удалить аккаунт» (Apple guideline 5.1.1(v); POST /v1/accounts/me/delete with the
 * current password, as on the website, website/src/components/DeleteAccountPanel.tsx).
 *
 * Every Raid OS account has a password: registration always sets one (server AccountStore.register /
 * createVerifiedAccount); SMS and e-mail codes only sign in to an existing account or reset its password. So a player
 * who signs in by phone and forgot the password resets it from the sign-in screen first.
 */

const confirmLogout = (logout: () => Promise<void>) => { if (window.confirm(uiText('Выйти из аккаунта на этом устройстве?'))) void logout() }

/** Instead of the paywall: the account has no access now; `note` — why, when it is not the subscription (device, clock, connection). */
export function IosNoAccess({ note }: { note?: string }) {
  const { status, checking, refresh, logout } = useServerAccount()
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="paywall">
      <section className="panel paywall-card" aria-label={uiText('Нет доступа')}>
        <header className="paywall-header">
          <span className="paywall-icon"><Lock size={20} /></span>
          <div>
            <div className="eyebrow">Raid OS</div>
            <h1>{uiText('Нет доступа')}</h1>
          </div>
        </header>
        <div className="paywall-account"><span>{uiText('Аккаунт')}: <strong>{status?.email ?? '—'}</strong></span></div>
        <p className="paywall-note">{uiText(note ?? 'У этого аккаунта сейчас нет доступа к Raid OS. Если доступ уже должен быть, нажмите «Обновить» или напишите в поддержку.')}</p>
        <div className="paywall-actions">
          <button className="button primary" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Обновить')}</button>
          <a className="button ghost" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} />{uiText('Поддержка')}</a>
          <button className="button danger" onClick={() => confirmLogout(logout)}><LogOut size={14} />{uiText('Выйти')}</button>
        </div>
        <div className="paywall-actions ios-account-links">
          <a className="link-button" href={privacyPolicyUrl()} target="_blank" rel="noopener noreferrer"><Shield size={14} />{uiText('Политика конфиденциальности')}</a>
          <button type="button" className="link-button ios-delete-link" onClick={() => setDeleting(true)}><Trash2 size={14} />{uiText('Удалить аккаунт')}</button>
        </div>
      </section>
      {deleting && <DeleteAccountDialog email={status?.email} onClose={() => setDeleting(false)} />}
    </div>
  )
}

/** «Аккаунт» on the profile of the iPhone app (signed in). */
export function IosAccountPanel() {
  const { status, checking, refresh, logout } = useServerAccount()
  const nickname = useAccountNickname()
  const [deleting, setDeleting] = useState(false)
  if (!status?.signedIn) return null
  const online = status.online ?? false
  const access = accessText(status.subscription)
  const good = access.startsWith('Доступ открыт')
  return (
    <>
      <section className="panel account-cabinet" aria-label={uiText('Аккаунт')}>
        <div className="panel-header">
          <div className="panel-title"><UserRound size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Аккаунт')}</div>
          <span className={`tag ${online ? 'green' : 'danger'}`}>{uiText(online ? 'Сервер доступен' : 'Сервер недоступен')}</span>
        </div>
        <div className="panel-body stack">
          <div className="account-cabinet-grid">
            <div className="account-cabinet-cell">
              <span>{uiText('Аккаунт')}</span>
              <strong>{status.email ?? '—'}</strong>
            </div>
            <div className={`account-cabinet-cell ${good ? 'is-good' : 'is-warn'}`}>
              <span>{uiText('Доступ')}</span>
              <strong>{uiText(access)}</strong>
            </div>
            <div className="account-cabinet-cell">
              <span>{uiText('Ник в игре')}</span>
              <strong>{nickname ?? '—'}</strong>
              <small>{uiText('Один для PvP, PvE и «Сезона», хранится в аккаунте')}</small>
            </div>
            {PHONE_AUTH_UI && <PhoneCabinetRow phone={status.phone} online={online} />}
            <EmailVerifyRow status={status} online={online} />
          </div>
          <div className="account-cabinet-actions">
            <button className="button ghost" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Обновить')}</button>
            <a className="button ghost" href={privacyPolicyUrl()} target="_blank" rel="noopener noreferrer"><Shield size={14} />{uiText('Политика конфиденциальности')}</a>
            <button className="button danger" onClick={() => confirmLogout(logout)}><LogOut size={14} />{uiText('Выйти')}</button>
          </div>
        </div>
      </section>
      <section className="panel account-cabinet ios-delete-account" aria-label={uiText('Удаление аккаунта')}>
        <div className="panel-header"><div className="panel-title"><Trash2 size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Удаление аккаунта')}</div></div>
        <div className="panel-body stack">
          <p className="muted" style={{ margin: 0 }}>{uiText('Почта, никнеймы, прогресс, друзья и настройки удаляются без возможности восстановления.')}</p>
          <div><button type="button" className="button danger" onClick={() => setDeleting(true)}><Trash2 size={14} />{uiText('Удалить аккаунт')}</button></div>
        </div>
      </section>
      {deleting && <DeleteAccountDialog email={status.email} onClose={() => setDeleting(false)} />}
    </>
  )
}

function DeleteAccountDialog({ email, onClose }: { email?: string; onClose: () => void }) {
  const { logout } = useServerAccount()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => { if (!busy) onClose() }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError('')
    try {
      const answer = await webServiceRequest('POST', '/v1/accounts/me/delete', { password })
      if (!answer) throw new Error('Войдите в аккаунт')
      setPassword('')
      // The server ended every session of the account: signing out here only forgets it on this phone.
      await logout().catch(() => undefined)
    } catch (reason) {
      setError(deleteErrorText(reason instanceof Error ? reason.message : String(reason)))
      setBusy(false)
    }
  }

  return (
    <Overlay label={uiText('Удалить аккаунт?')} onClose={close}>
      <div className="registration-icon"><Trash2 size={28} /></div>
      <div className="eyebrow">{uiText('Аккаунт')}</div>
      <h2>{uiText('Удалить аккаунт?')}</h2>
      <p className="muted">{uiText('Аккаунт будет удалён сразу и навсегда:')} <strong>{email ?? '—'}</strong></p>
      <form className="stack" style={{ textAlign: 'left' }} onSubmit={(event) => void submit(event)}>
        <label className="field-label">{uiText('Пароль для подтверждения')}
          <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        </label>
        <small className="dim">{uiText('Забыли пароль? Выйдите и восстановите его на экране входа по e-mail или SMS, затем удалите аккаунт.')}</small>
        {error && <p className="dim" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{uiText(error)}</p>}
        <div className="paywall-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={close}>{uiText('Отмена')}</button>
          <button type="submit" className="button danger" disabled={busy || !password}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}{uiText('Удалить навсегда')}
          </button>
        </div>
      </form>
    </Overlay>
  )
}

function Overlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  return createPortal(
    <div className="registration-overlay" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog account-qr-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <button className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        {children}
      </section>
    </div>,
    document.body,
  )
}
