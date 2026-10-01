import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, LoaderCircle, UserRound } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import type { RaidMode } from '../domain/types'
import type { PlayerProfileCandidate } from '../profile/playerProfileGateway'
import { canResolvePlayerProfiles } from '../profile/playerProfileGateway'
import { openModeRegistrationDialog } from '../components/ModeRegistrationDialog'
import { useServerAccount, usesWebAccount } from '../sync/serverSync'
import { isNative } from '../platform'
import { DeepLinkLogin } from '../mobile/DeepLinkLogin'
import { clearNicknameStepRequest, nicknameStepRequested, OPEN_ACCOUNT_SIGN_IN_EVENT } from './accountEvents'
import { findNickname, modeTitle, RAID_MODE_ORDER, saveNicknamesOnServer } from './nicknameBinding'
import { useNicknameBinder } from './useNicknameBinder'
import { SignInStep, type AccountGateTab } from './AccountSignIn'
import { accountGateEnabled } from './accountGate'
import './account.css'

/** Offline sign-in was skipped in this window (the server was not reachable). */
const SKIP_KEY = 'tarkov-account-gate-skipped'

/**
 * The account side of the app shell:
 * - first launch without a session (accountGateEnabled): the account window right away — «Вход» / «Регистрация»
 *   inside the app (AccountSignIn.tsx), then «choose a mode and bind the nickname», then Overview;
 * - nicknames per mode on the server account: missing local bindings are restored from it, local ones it lacks are
 *   saved to it (explicit «Привязать ник» always saves);
 * - switching to a mode without a bound nickname (top bar, profile, or the game mode read from the EFT logs by
 *   AppShell) opens «Привязать ник».
 */
export function AccountController() {
  const state = useAppState()
  const navigate = useNavigate()
  const { status } = useServerAccount()
  // After a sign-in on the paywall (players' app) the nickname step follows once the app opens.
  const [nickStep, setNickStep] = useState(nicknameStepRequested)
  useEffect(() => { clearNicknameStepRequest() }, [])
  const [skipped, setSkipped] = useState(() => readSkip())
  const [tab, setTab] = useState<AccountGateTab>('login')
  const gated = accountGateEnabled()
  // The sign-in window: no signed-in account (unless skipped while the server was not reachable).
  const needsSignIn = Boolean(gated && status && !status.signedIn && !skipped)
  const gateStep: 'signin' | 'nick' | null = needsSignIn ? 'signin' : nickStep && gated ? 'nick' : null

  useEffect(() => {
    const open = (event: Event) => {
      try { sessionStorage.removeItem(SKIP_KEY) } catch { /* storage unavailable */ }
      setTab((event as CustomEvent<AccountGateTab | undefined>).detail === 'register' ? 'register' : 'login')
      setSkipped(false)
    }
    window.addEventListener(OPEN_ACCOUNT_SIGN_IN_EVENT, open)
    return () => window.removeEventListener(OPEN_ACCOUNT_SIGN_IN_EVENT, open)
  }, [])

  useNicknameAccountSync(status)
  useUnboundModePrompt(gateStep !== null, status)

  // The phone keeps handling QR sign-in links while the account window is open (DeepLinkLogin sits above it).
  const deepLinks = isNative() ? <DeepLinkLogin /> : null
  if (!gateStep) return deepLinks
  return <>
    <AccountGate
      step={gateStep}
      tab={tab}
      // Shown as soon as the sign-in succeeds (no flash of the app in between); cleared when nicknames are known.
      onSigningIn={() => setNickStep(true)}
      onSignedIn={(nicknames) => {
        // Nicknames already on the account are restored by useNicknameAccountSync; otherwise ask for one.
        const known = RAID_MODE_ORDER.some((mode) => nicknames?.[mode] || state.activeProfile.modes[mode].registration.status === 'registered')
        setNickStep(!known)
        if (known) navigate('/')
      }}
      onSkip={() => { writeSkip(); setSkipped(true); setNickStep(false) }}
      onDone={() => setNickStep(false)}
    />
    {deepLinks}
  </>
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
function AccountGate({ step, tab, onSigningIn, onSignedIn, onSkip, onDone }: {
  step: 'signin' | 'nick'
  tab: AccountGateTab
  onSigningIn: () => void
  onSignedIn: (nicknames?: Partial<Record<RaidMode, string>>) => void
  onSkip: () => void
  onDone: () => void
}) {
  return (
    <div className="registration-overlay account-gate" role="dialog" aria-modal="true" aria-label={uiText(step === 'signin' ? 'Вход в аккаунт' : 'Привязать ник')}>
      <section className="panel registration-dialog account-gate-dialog">
        <div className="account-gate-steps" aria-hidden="true"><span className={step === 'signin' ? 'active' : 'done'}>1</span><i /><span className={step === 'nick' ? 'active' : ''}>2</span></div>
        {step === 'signin' ? <SignInStep key={tab} initialTab={tab} onSigningIn={onSigningIn} onSignedIn={onSignedIn} onSkip={onSkip} /> : <NicknameStep onDone={onDone} />}
      </section>
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
