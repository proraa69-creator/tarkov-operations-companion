import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, LoaderCircle, LogIn, RefreshCw, Server, UserPlus, UserRound } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import type { RaidMode } from '../domain/types'
import type { PlayerProfileCandidate } from '../profile/playerProfileGateway'
import { canResolvePlayerProfiles } from '../profile/playerProfileGateway'
import { openModeRegistrationDialog } from '../components/ModeRegistrationDialog'
import { useServerAccount, usesWebAccount } from '../sync/serverSync'
import { isDesktopShell, isNative } from '../platform'
import { DeepLinkLogin } from '../mobile/DeepLinkLogin'
import { isOwnerApp } from '../app/buildEdition'
import { openWebsite } from './accountActions'
import { OPEN_ACCOUNT_SIGN_IN_EVENT } from './accountEvents'
import { findNickname, modeTitle, RAID_MODE_ORDER, saveNicknamesOnServer } from './nicknameBinding'
import { useNicknameBinder } from './useNicknameBinder'
import { PhoneSignInForm, PhoneSignInLinks } from './PhoneAccount'
import { EmailSignInForm, EmailSignInLinks, useEmailEnabled } from './EmailAccount'
import './account.css'

/** Offline sign-in was skipped in this window (the server was not reachable). */
const SKIP_KEY = 'tarkov-account-gate-skipped'

/**
 * The account side of the app shell:
 * - first run of the players' app (client build, electron/buildEdition.ts): the account sign-in window, then
 *   «choose a mode and bind the nickname», then Overview;
 * - nicknames per mode on the server account: missing local bindings are restored from it, local ones it lacks are
 *   saved to it (explicit «Привязать ник» always saves);
 * - switching to a mode without a bound nickname (top bar, profile, or the game mode read from the EFT logs by
 *   AppShell) opens «Привязать ник».
 */
export function AccountController() {
  const state = useAppState()
  const navigate = useNavigate()
  const { status } = useServerAccount()
  const [nickStep, setNickStep] = useState(false)
  const [skipped, setSkipped] = useState(() => readSkip())
  const desktopClient = isDesktopShell() && !isOwnerApp()
  // The sign-in window: the players' desktop app without a signed-in account (unless skipped while offline).
  const needsSignIn = Boolean(desktopClient && status && !status.signedIn && !skipped)
  const gateStep: 'signin' | 'nick' | null = needsSignIn ? 'signin' : nickStep && desktopClient ? 'nick' : null

  useEffect(() => {
    const open = () => {
      try { sessionStorage.removeItem(SKIP_KEY) } catch { /* storage unavailable */ }
      setSkipped(false)
    }
    window.addEventListener(OPEN_ACCOUNT_SIGN_IN_EVENT, open)
    return () => window.removeEventListener(OPEN_ACCOUNT_SIGN_IN_EVENT, open)
  }, [])

  useNicknameAccountSync(status)
  useUnboundModePrompt(gateStep !== null, status)

  const native = isNative()
  if (!gateStep) return native ? <DeepLinkLogin /> : null
  return <AccountGate
    step={gateStep}
    // Shown as soon as the sign-in succeeds (no flash of the app in between); cleared when nicknames are known.
    onSigningIn={() => setNickStep(true)}
    onSignedIn={(nicknames) => {
      // Nicknames already on the account are restored by useNicknameAccountSync; otherwise ask for one.
      const known = RAID_MODE_ORDER.some((mode) => nicknames?.[mode] || state.activeProfile.modes[mode].registration.status === 'registered')
      setNickStep(!known)
      if (known) navigate('/')
    }}
    onSkip={() => { writeSkip(); setSkipped(true) }}
    onDone={() => setNickStep(false)}
  />
}

function readSkip() {
  try { return sessionStorage.getItem(SKIP_KEY) === '1' } catch { return false }
}
function writeSkip() {
  try { sessionStorage.setItem(SKIP_KEY, '1') } catch { /* storage unavailable */ }
}

type Status = ReturnType<typeof useServerAccount>['status']

/** Restores missing local bindings from the account and backfills the account from local bindings. */
function useNicknameAccountSync(status: Status) {
  const state = useAppState()
  const attempted = useRef(new Set<string>())
  const registrations = RAID_MODE_ORDER.map((mode) => state.activeProfile.modes[mode].registration)
  const key = registrations.map((entry) => `${entry.status}:${entry.nickname ?? ''}`).join('|')

  useEffect(() => {
    if (!status?.signedIn || !status.online || !status.nicknames || !canResolvePlayerProfiles()) return
    const server = status.nicknames
    const missingOnServer: Partial<Record<RaidMode, string>> = {}
    for (const mode of RAID_MODE_ORDER) {
      const local = state.activeProfile.modes[mode].registration
      const remote = server[mode]
      if (local.status === 'registered' && local.nickname && !remote) missingOnServer[mode] = local.nickname
      if (local.status === 'registered' || !remote) continue
      const attempt = `${state.activeProfile.id}:${mode}:${remote.toLowerCase()}`
      if (attempted.current.has(attempt)) continue
      attempted.current.add(attempt)
      void findNickname(mode, remote).then((candidate) => {
        state.registerModeProfile(mode, { accountId: candidate.accountId, enteredNickname: remote, nickname: candidate.nickname, verifiedAt: new Date().toISOString() })
        state.updatePlayerSnapshot(mode, candidate.snapshot)
      }).catch(() => { /* Tarkov.dev or the server is unavailable: «Привязать ник» stays available */ })
    }
    const backfill = Object.keys(missingOnServer).length ? JSON.stringify(missingOnServer) : ''
    if (backfill && !attempted.current.has(`push:${backfill}`)) {
      attempted.current.add(`push:${backfill}`)
      void saveNicknamesOnServer(missingOnServer)
    }
  // `key` covers the registrations; the state functions update through the profile setter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, key, state.activeProfile.id])
}

/** A switch to a mode without a bound nickname opens «Привязать ник» (not while the sign-in window is open). */
function useUnboundModePrompt(gateOpen: boolean, status: Status) {
  const state = useAppState()
  const previous = useRef(state.raidMode)
  useEffect(() => {
    if (previous.current === state.raidMode) return
    previous.current = state.raidMode
    if (gateOpen || !canResolvePlayerProfiles()) return
    if (state.activeProfile.modes[state.raidMode].registration.status === 'registered') return
    // The phone binds through the server; a nickname already on the account is being restored.
    if (usesWebAccount() && !status?.signedIn) return
    if (status?.nicknames?.[state.raidMode]) return
    openModeRegistrationDialog()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.raidMode])
}

/** The first-run window: account sign-in, then the nickname of one mode. */
function AccountGate({ step, onSigningIn, onSignedIn, onSkip, onDone }: {
  step: 'signin' | 'nick'
  onSigningIn: () => void
  onSignedIn: (nicknames?: Partial<Record<RaidMode, string>>) => void
  onSkip: () => void
  onDone: () => void
}) {
  return (
    <div className="registration-overlay account-gate" role="dialog" aria-modal="true" aria-label={uiText(step === 'signin' ? 'Вход в аккаунт' : 'Привязать ник')}>
      <section className="panel registration-dialog account-gate-dialog">
        <div className="account-gate-steps" aria-hidden="true"><span className={step === 'signin' ? 'active' : 'done'}>1</span><i /><span className={step === 'nick' ? 'active' : ''}>2</span></div>
        {step === 'signin' ? <SignInStep onSigningIn={onSigningIn} onSignedIn={onSignedIn} onSkip={onSkip} /> : <NicknameStep onDone={onDone} />}
      </section>
    </div>
  )
}

/** The account sign-in form (first run, and the paywall of the players' app without `onSkip`). */
export function SignInStep({ onSigningIn, onSignedIn, onSkip }: { onSigningIn: () => void; onSignedIn: (nicknames?: Partial<Record<RaidMode, string>>) => void; onSkip?: () => void }) {
  const { status, checking, refresh, login } = useServerAccount()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [phoneMode, setPhoneMode] = useState<'login' | 'reset' | null>(null)
  const [emailMode, setEmailMode] = useState<'login' | 'reset' | null>(null)
  const online = status?.online ?? false
  const emailCodes = useEmailEnabled(status?.online)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    onSigningIn()
    try {
      const next = await login(email, password)
      setPassword('')
      onSignedIn(next.nicknames)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Сервер недоступен')
    } finally {
      setBusy(false)
    }
  }

  if (emailMode) {
    return (
      <div className="stack account-gate-form">
        <div className="eyebrow">{uiText('Raid OS · шаг 1 из 2')}</div>
        <h2>{uiText(emailMode === 'login' ? 'Вход по коду из письма' : 'Восстановление пароля')}</h2>
        <EmailSignInForm purpose={emailMode} onSignedIn={(next) => { onSigningIn(); onSignedIn(next.nicknames) }} onBack={() => setEmailMode(null)} />
      </div>
    )
  }

  if (phoneMode) {
    return (
      <div className="stack account-gate-form">
        <div className="eyebrow">{uiText('Raid OS · шаг 1 из 2')}</div>
        <h2>{uiText(phoneMode === 'login' ? 'Вход по коду из SMS' : 'Восстановление пароля')}</h2>
        <PhoneSignInForm purpose={phoneMode} onSignedIn={(next) => { onSigningIn(); onSignedIn(next.nicknames) }} onBack={() => setPhoneMode(null)} />
      </div>
    )
  }

  return (
    <form className="stack account-gate-form" onSubmit={(event) => void submit(event)}>
      <div className="eyebrow">{uiText('Raid OS · шаг 1 из 2')}</div>
      <h2>{uiText('Вход в аккаунт')}</h2>
      <p className="muted">{uiText('Войдите тем же e-mail и паролем, что на сайте. Приложение свяжется с сервером: ваши ники, прогресс заданий и подписка хранятся в аккаунте.')}</p>
      <label className="field-label">{uiText('E-mail')}
        <input className="input" type="email" autoComplete="username" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} required autoFocus />
      </label>
      <label className="field-label">{uiText('Пароль')}
        <input className="input" type="password" autoComplete="current-password" value={password} minLength={8} maxLength={128} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      {status && !online && <div className="import-warning"><AlertTriangle size={17} /><span>{uiText('Сервер недоступен. Проверьте интернет и адрес сервера или попробуйте позже.')}</span></div>}
      <button className="button primary account-gate-submit" type="submit" disabled={busy || !online}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}{uiText(busy ? 'Входим…' : 'Войти')}
      </button>
      <div className="account-gate-links">
        <span>{uiText('Нет аккаунта?')}</span>
        <button type="button" className="link-button" onClick={() => openWebsite('register')}><UserPlus size={14} />{uiText('Зарегистрироваться на сайте')}</button>
      </div>
      <EmailSignInLinks online={status?.online} onPick={setEmailMode} />
      <PhoneSignInLinks online={status?.online} onPick={setPhoneMode} resetLabel={emailCodes ? 'Сбросить пароль по SMS' : undefined} />
      <ServerAddressLine />
      {status && !online && (
        <div className="account-gate-offline">
          <button type="button" className="button ghost" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Проверить снова')}</button>
          {onSkip && <button type="button" className="button ghost" onClick={onSkip}>{uiText('Продолжить без входа')}</button>}
        </div>
      )}
    </form>
  )
}

/** The server this app talks to; a player normally never changes it (the owner's address is built in). */
function ServerAddressLine() {
  const { status, refresh } = useServerAccount()
  const api = window.tarkovDesktop?.account
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  if (!status || !api?.setServerUrl) return null
  const save = async () => {
    setError('')
    try {
      await api.setServerUrl!(value)
      setEditing(false)
      void refresh()
    } catch (reason) {
      setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return (
    <div className="account-gate-server">
      <small><Server size={12} />{uiText('Сервер:')} <span className="account-gate-url">{status.serverUrl}</span></small>
      {!editing && <button type="button" className="link-button" onClick={() => { setValue(status.serverUrl); setEditing(true) }}>{uiText('Изменить')}</button>}
      {editing && (
        <div className="account-gate-server-edit">
          <input className="input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://…" spellCheck={false} autoComplete="off" />
          <button type="button" className="button ghost" onClick={() => void save()}>{uiText('Сохранить')}</button>
          <button type="button" className="button ghost" onClick={() => setEditing(false)}>{uiText('Отмена')}</button>
        </div>
      )}
      {error && <small className="account-error">{uiText(error)}</small>}
    </div>
  )
}

function NicknameStep({ onDone }: { onDone: () => void }) {
  const state = useAppState()
  const navigate = useNavigate()
  const bind = useNicknameBinder()
  const [mode, setMode] = useState<RaidMode>(state.raidMode)
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [bound, setBound] = useState<PlayerProfileCandidate | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading || bound) return
    setLoading(true)
    setError('')
    try {
      const candidate = await bind(mode, nickname)
      state.setRaidMode(mode)
      setBound(candidate)
      window.setTimeout(() => { navigate('/'); onDone() }, 1200)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Профиль не найден')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="stack account-gate-form" onSubmit={(event) => void submit(event)}>
      <div className="eyebrow">{uiText('Raid OS · шаг 2 из 2')}</div>
      <h2>{uiText('Привязать ник')}</h2>
      <p className="muted">{uiText('Выберите режим и введите ник, который у вас в этом режиме игры. Ники остальных режимов можно привязать позже: приложение предложит это при переключении режима.')}</p>
      <div className="field-label">{uiText('Режим')}
        <div className="mode-switch wide" role="radiogroup" aria-label={uiText('Режим')}>
          {RAID_MODE_ORDER.map((entry) => (
            <button key={entry} type="button" role="radio" aria-checked={mode === entry} className={mode === entry ? 'active' : ''} disabled={Boolean(bound)} onClick={() => { setMode(entry); setError('') }}>{uiText(modeTitle(entry))}</button>
          ))}
        </div>
      </div>
      <label className="field-label">{uiText('Ник Escape from Tarkov')}
        <input className="input" value={nickname} onChange={(event) => { setNickname(event.target.value); setError('') }} placeholder={uiText('Например: shaurma')} autoComplete="off" spellCheck={false} maxLength={15} autoFocus disabled={Boolean(bound)} />
      </label>
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      {bound && <div className="profile-candidate account-bound" role="status">
        <span className="profile-avatar small"><UserRound size={20} /></span>
        <span><strong>{bound.nickname}</strong><small>{bound.mode.toUpperCase()}{uiText(' · уровень ')}{bound.level}{uiText(' · обновляем данные…')}</small></span>
        <span className="tag green"><Check size={12} />{uiText('Привязан')}</span>
      </div>}
      {!bound && <button className="button primary account-gate-submit" type="submit" disabled={loading || nickname.trim().length < 3}>
        {loading ? <LoaderCircle className="spin" size={16} /> : <UserRound size={16} />}{uiText(loading ? 'Ищем профиль…' : 'Привязать ник')}
      </button>}
      {!bound && <button type="button" className="link-button account-gate-later" onClick={() => { navigate('/'); onDone() }}>{uiText('Позже')}</button>}
    </form>
  )
}
