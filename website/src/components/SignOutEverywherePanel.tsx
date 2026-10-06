import { LoaderCircle, LogOut, MonitorSmartphone } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Notice } from './Notice'

/**
 * Cabinet: «Выйти на всех устройствах» — ends every session of the account (apps, phones, other browsers and this one,
 * POST /me/sessions/revoke-all), then signs this browser out. For a lost device or a password that leaked.
 */
export function SignOutEverywherePanel() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signOutEverywhere() {
    if (!auth.token) return
    setBusy(true); setError('')
    try {
      await api.revokeAllSessions(auth.token)
      await auth.logout()
      navigate('/', { replace: true })
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="sessions-title">
      <div className="panel-header">
        <div className="panel-title" id="sessions-title"><MonitorSmartphone aria-hidden="true" />Сеансы</div>
      </div>
      <div className="panel-body form">
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {confirming
            ? 'Вход завершится в приложении на всех компьютерах и телефонах и в этом браузере. Войти снова можно будет в любой момент.'
            : 'Потеряли устройство или кто-то знает ваш пароль — завершите все входы в аккаунт сразу.'}
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {confirming ? (
            <>
              <button type="button" className="button ghost" disabled={busy} onClick={() => setConfirming(false)}>Отмена</button>
              <button type="button" className="button" disabled={busy} onClick={() => void signOutEverywhere()}>
                {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <LogOut aria-hidden="true" />}Да, выйти везде
              </button>
            </>
          ) : (
            <button type="button" className="button" onClick={() => setConfirming(true)}><LogOut aria-hidden="true" />Выйти на всех устройствах</button>
          )}
        </div>
      </div>
    </section>
  )
}
