import { useState, type FormEvent } from 'react'
import { Check, KeyRound, LoaderCircle, LogIn, MessageSquareText, Phone, RefreshCw, Trash2 } from 'lucide-react'
import type { ServerAccountStatus } from '../electron'
import { uiText } from '../i18n/renderText'
import { phoneSignInToServer, refreshServerStatus } from '../sync/serverSync'
import { postService as post, useAuthFlag, useCooldown, waitFrom, type CodeChallenge as Challenge } from './codeRequest'
import { CodeInput, Warning } from './codeFields'
import './account.css'

/**
 * Phone number and SMS codes in the apps (server/src/routes/phone.ts): sign-in by code, password reset by phone, and
 * binding / removing the number in «Личный кабинет». Code requests go through the whitelisted service request; the
 * sign-in itself goes through the account API (the desktop main process keeps the session). Everything is hidden
 * while the server has no SMS provider (GET /v1/accounts/auth-config → smsEnabled: false), and everywhere while
 * PHONE_AUTH_UI (authFeatures.ts) is off: the apps sign in by e-mail only for now.
 */

/** null while unknown; false without a server, on an older server or with SMS switched off. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSmsEnabled(online: boolean | undefined) {
  return useAuthFlag('smsEnabled', online)
}

/**
 * Sign-in by phone (`login`) or password reset (`reset`): number → code (→ new password). The server answers the same
 * for every number, so the form never says whether a number is registered.
 */
export function PhoneSignInForm({ purpose, onSignedIn, onBack }: { purpose: 'login' | 'reset'; onSignedIn: (status: ServerAccountStatus) => void; onBack: () => void }) {
  const [phone, setPhone] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cooldown = useCooldown()

  const request = async (event?: FormEvent) => {
    event?.preventDefault()
    setBusy(true); setError('')
    try {
      const next = await post(`/v1/accounts/phone/${purpose}/start`, { phone }) as Challenge
      setChallenge(next); setCode('')
      cooldown.start(next.resendSeconds)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      if (waitFrom(message)) cooldown.start(waitFrom(message))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (!challenge) return
    if (purpose === 'reset' && password.length < 8) { setError('Новый пароль: от 8 до 128 символов'); return }
    if (purpose === 'reset' && password !== repeat) { setError('Пароли не совпадают'); return }
    setBusy(true); setError('')
    try {
      const status = await phoneSignInToServer(purpose, challenge.challengeId, code, purpose === 'reset' ? password : undefined)
      setPassword(''); setRepeat('')
      onSignedIn(status)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (!challenge) {
    return (
      <form className="stack" onSubmit={(event) => void request(event)}>
        <p className="muted" style={{ margin: 0 }}>{uiText(purpose === 'login'
          ? 'Введите номер, привязанный к аккаунту в личном кабинете. Мы пришлём код в SMS.'
          : 'Введите номер, привязанный к аккаунту. Мы пришлём код в SMS, после него задайте новый пароль.')}</p>
        <label className="field-label">{uiText('Номер телефона')}
          <input className="input" type="tel" autoComplete="tel" value={phone} maxLength={24} placeholder="+7 999 123-45-67" onChange={(event) => setPhone(event.target.value)} autoFocus />
        </label>
        <Warning text={error} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button primary" type="submit" disabled={busy || cooldown.left > 0 || phone.replace(/\D/g, '').length < 10}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <MessageSquareText size={14} />}{uiText('Получить код')}
          </button>
          <button className="button ghost" type="button" onClick={onBack}><LogIn size={14} />{uiText('Войти по e-mail и паролю')}</button>
        </div>
      </form>
    )
  }

  return (
    <form className="stack" onSubmit={(event) => void confirm(event)}>
      <p className="muted" style={{ margin: 0 }}>{uiText('Если номер привязан к аккаунту, на него придёт SMS с кодом. Никому не сообщайте код.')}</p>
      <CodeInput value={code} onChange={setCode} label="Код из SMS" />
      {purpose === 'reset' && <>
        <label className="field-label">{uiText('Новый пароль')}
          <input className="input" type="password" autoComplete="new-password" value={password} minLength={8} maxLength={128} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="field-label">{uiText('Повторите пароль')}
          <input className="input" type="password" autoComplete="new-password" value={repeat} minLength={8} maxLength={128} onChange={(event) => setRepeat(event.target.value)} />
        </label>
        <small className="dim">{uiText('Все входы на других устройствах будут завершены.')}</small>
      </>}
      <Warning text={error} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="button primary" type="submit" disabled={busy || code.length !== 6}>
          {busy ? <LoaderCircle className="spin" size={14} /> : purpose === 'login' ? <LogIn size={14} /> : <KeyRound size={14} />}{uiText(purpose === 'login' ? 'Войти' : 'Сохранить новый пароль')}
        </button>
        <button className="button ghost" type="button" disabled={busy || cooldown.left > 0} onClick={() => void request()}>
          <RefreshCw size={14} />{uiText('Отправить код ещё раз')}{cooldown.left > 0 ? ` (${cooldown.left})` : ''}
        </button>
        <button className="button ghost" type="button" onClick={() => { setChallenge(null); setError('') }}>{uiText('Другой номер')}</button>
      </div>
    </form>
  )
}

/**
 * «Войти по коду из SMS» / «Забыли пароль?» under a password sign-in form (only with SMS switched on). `resetLabel`:
 * another label for the SMS reset when the e-mail reset is shown too (EmailAccount.tsx).
 */
export function PhoneSignInLinks({ online, onPick, resetLabel = 'Забыли пароль?' }: { online: boolean | undefined; onPick: (purpose: 'login' | 'reset') => void; resetLabel?: string }) {
  const enabled = useSmsEnabled(online)
  if (!enabled) return null
  return (
    <div className="account-gate-links">
      <button type="button" className="link-button" onClick={() => onPick('login')}><MessageSquareText size={14} />{uiText('Войти по коду из SMS')}</button>
      <button type="button" className="link-button" onClick={() => onPick('reset')}><KeyRound size={14} />{uiText(resetLabel)}</button>
    </div>
  )
}

/** «Телефон» in «Личный кабинет»: the masked number, bind / change (password + SMS code) and remove (password). */
export function PhoneCabinetRow({ phone, online }: { phone?: string; online: boolean }) {
  const enabled = useSmsEnabled(online)
  const [mode, setMode] = useState<'view' | 'bind' | 'remove'>('view')
  const [number, setNumber] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const cooldown = useCooldown()

  const reset = (next: 'view' | 'bind' | 'remove') => { setMode(next); setChallenge(null); setCode(''); setPassword(''); setError('') }
  const run = (task: () => Promise<void>) => {
    setBusy(true); setError(''); setDone('')
    void task().catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      if (waitFrom(message)) cooldown.start(waitFrom(message))
    }).finally(() => setBusy(false))
  }
  const start = () => run(async () => {
    const next = await post('/v1/accounts/me/phone/start', { phone: number, password }) as Challenge
    setChallenge(next); setCode('')
    cooldown.start(next.resendSeconds)
  })
  const confirm = () => run(async () => {
    if (!challenge) return
    await post('/v1/accounts/me/phone/confirm', { challengeId: challenge.challengeId, code })
    reset('view'); setDone('Номер подтверждён и привязан.')
    void refreshServerStatus()
  })
  const remove = () => run(async () => {
    await post('/v1/accounts/me/phone/remove', { password })
    reset('view'); setDone('Номер отвязан.')
    void refreshServerStatus()
  })

  return (
    <div className="account-cabinet-cell account-phone">
      <span>{uiText('Телефон')}</span>
      <strong>{phone ?? uiText('Не привязан')}</strong>
      <small>{uiText(phone ? 'По нему можно войти и восстановить пароль кодом из SMS' : enabled === false ? 'Вход и восстановление по номеру телефона на этом сервере сейчас недоступны.' : 'Привяжите номер, чтобы входить по коду из SMS и восстановить пароль')}</small>
      {done && <small className="account-phone-done"><Check size={12} />{uiText(done)}</small>}
      {mode === 'view' && online && (
        <span className="account-phone-actions">
          {enabled && <button className="button ghost" onClick={() => { setDone(''); reset('bind') }}><Phone size={14} />{uiText(phone ? 'Сменить номер' : 'Привязать номер')}</button>}
          {phone && <button className="button ghost" onClick={() => { setDone(''); reset('remove') }}><Trash2 size={14} />{uiText('Отвязать')}</button>}
        </span>
      )}
      {mode === 'bind' && !challenge && (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); start() }}>
          <input className="input" type="tel" autoComplete="tel" value={number} maxLength={24} placeholder="+7 999 123-45-67" aria-label={uiText('Номер телефона')} onChange={(event) => setNumber(event.target.value)} autoFocus />
          <input className="input" type="password" autoComplete="current-password" value={password} maxLength={128} placeholder={uiText('Текущий пароль')} aria-label={uiText('Текущий пароль')} onChange={(event) => setPassword(event.target.value)} />
          <span className="account-phone-actions">
            <button className="button primary" type="submit" disabled={busy || cooldown.left > 0 || !password || number.replace(/\D/g, '').length < 10}>{busy ? <LoaderCircle className="spin" size={14} /> : <MessageSquareText size={14} />}{uiText('Получить код')}</button>
            <button className="button ghost" type="button" onClick={() => reset('view')}>{uiText('Отмена')}</button>
          </span>
        </form>
      )}
      {mode === 'bind' && challenge && (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); confirm() }}>
          <CodeInput value={code} onChange={setCode} label="Код из SMS" />
          <span className="account-phone-actions">
            <button className="button primary" type="submit" disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{uiText('Подтвердить')}</button>
            <button className="button ghost" type="button" disabled={busy || cooldown.left > 0} onClick={start}><RefreshCw size={14} />{uiText('Отправить код ещё раз')}{cooldown.left > 0 ? ` (${cooldown.left})` : ''}</button>
            <button className="button ghost" type="button" onClick={() => reset('view')}>{uiText('Отмена')}</button>
          </span>
        </form>
      )}
      {mode === 'remove' && (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); remove() }}>
          <input className="input" type="password" autoComplete="current-password" value={password} maxLength={128} placeholder={uiText('Текущий пароль')} aria-label={uiText('Текущий пароль')} onChange={(event) => setPassword(event.target.value)} autoFocus />
          <span className="account-phone-actions">
            <button className="button danger" type="submit" disabled={busy || !password}>{busy ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}{uiText('Отвязать номер')}</button>
            <button className="button ghost" type="button" onClick={() => reset('view')}>{uiText('Отмена')}</button>
          </span>
        </form>
      )}
      <Warning text={error} />
    </div>
  )
}
