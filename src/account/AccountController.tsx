import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, LoaderCircle, UserRound } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import type { RaidMode } from '../domain/types'
import { canResolvePlayerProfiles } from '../profile/playerProfileGateway'
import { openModeRegistrationDialog } from '../components/ModeRegistrationDialog'
import { useServerAccount, usesWebAccount } from '../sync/serverSync'
import { isNative } from '../platform'
import { DeepLinkLogin } from '../mobile/DeepLinkLogin'
import { clearNicknameStepRequest, nicknameStepRequested, OPEN_ACCOUNT_SIGN_IN_EVENT } from './accountEvents'
import { accountNickname, findNickname, profileNickname, RAID_MODE_ORDER, saveNicknameOnServer } from './nicknameBinding'
import { useNicknameBinder, type NicknameBinding } from './useNicknameBinder'
import { BoundNickname } from './BoundNickname'
import { SignInStep, type AccountGateTab } from './AccountSignIn'
import { accountGateEnabled } from './accountGate'
import './account.css'

/** Offline sign-in was skipped in this window (the server was not reachable). */
const SKIP_KEY = 'tarkov-account-gate-skipped'

/**
 * The account side of the app shell:
 * - first launch without a session (accountGateEnabled): the account window right away — «Вход» / «Регистрация»
 *   inside the app (AccountSignIn.tsx), then «bind the nickname» (one for every mode), then Overview;
 * - one nickname for PvP, PvE and «Сезон» on the server account (owner, 10.10.2026): modes without a bound profile are
 *   bound with it, a nickname the account lacks is saved to it (explicit «Привязать ник» always saves), and a character
 *   renamed in the game replaces the old nickname;
 * - «Привязать ник» opens by itself only while no nickname is known at all.
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
        // A nickname already on the account is bound by useNicknameAccountSync; otherwise ask for one.
        const known = Boolean(accountNickname(nicknames)) || RAID_MODE_ORDER.some((mode) => state.activeProfile.modes[mode].registration.status === 'registered')
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

/**
 * One nickname for all modes, the same on the account and in the app:
 * - the account has none and the app has one: the account gets it;
 * - renamed in the game: the current mode's character (refreshed by its account id) has a new nickname — the account
 *   gets it at once, so friends, squads and «Кочевники» show the new one;
 * - every mode without a bound profile is looked up with that nickname (once per session and nickname; a mode the
 *   player never played simply stays unbound).
 */
function useNicknameAccountSync(status: Status) {
  const state = useAppState()
  const attempted = useRef(new Set<string>())
  const registrations = RAID_MODE_ORDER.map((mode) => state.activeProfile.modes[mode].registration)
  const key = registrations.map((entry) => `${entry.status}:${entry.nickname ?? ''}`).join('|')

  useEffect(() => {
    if (!status?.signedIn || !status.online || !status.nicknames || !canResolvePlayerProfiles()) return
    const profile = state.activeProfile
    const remote = accountNickname(status.nicknames)
    const current = profile.modes[state.raidMode]
    const local = profileNickname(profile, state.raidMode)
    let push: string | undefined
    if (local && !remote) push = local
    else if (remote && current.registration.status === 'registered' && current.registration.nickname
      && current.registration.nickname.toLowerCase() !== remote.toLowerCase() && current.playerSnapshot?.nickname === current.registration.nickname) push = current.registration.nickname
    if (push && !attempted.current.has(`push:${push.toLowerCase()}`)) {
      attempted.current.add(`push:${push.toLowerCase()}`)
      void saveNicknameOnServer(push)
    }
    const nickname = push ?? remote
    if (!nickname) return
    for (const mode of RAID_MODE_ORDER) {
      if (profile.modes[mode].registration.status === 'registered') continue
      const attempt = `${profile.id}:${mode}:${nickname.toLowerCase()}`
      if (attempted.current.has(attempt)) continue
      attempted.current.add(attempt)
      void findNickname(mode, nickname).then((candidate) => {
        state.registerModeProfile(mode, { accountId: candidate.accountId, enteredNickname: nickname, nickname: candidate.nickname, verifiedAt: new Date().toISOString() })
        if (candidate.snapshot) state.updatePlayerSnapshot(mode, candidate.snapshot)
      }).catch(() => { /* no profile in this mode yet, or Tarkov.dev / the server is unavailable: tried again next session */ })
    }
  // `key` covers the registrations; the state functions update through the profile setter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, key, state.activeProfile.id, state.raidMode])
}

/**
 * «Привязать ник» opens by itself on a switch to an unbound mode only while no nickname is known at all (not while the
 * sign-in window is open): with one nickname for every mode, a known nickname binds the other modes by itself.
 */
function useUnboundModePrompt(gateOpen: boolean, status: Status) {
  const state = useAppState()
  const previous = useRef(state.raidMode)
  useEffect(() => {
    if (previous.current === state.raidMode) return
    previous.current = state.raidMode
    if (gateOpen || !canResolvePlayerProfiles()) return
    if (state.activeProfile.modes[state.raidMode].registration.status === 'registered') return
    // The phone binds through the server; a nickname already known is being bound for this mode.
    if (usesWebAccount() && !status?.signedIn) return
    if (accountNickname(status?.nicknames) || profileNickname(state.activeProfile)) return
    openModeRegistrationDialog()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.raidMode])
}

/** The first-run window: account sign-in, then the nickname (one for every mode). */
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
  const navigate = useNavigate()
  const bind = useNicknameBinder()
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [bound, setBound] = useState<NicknameBinding | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading || bound) return
    setLoading(true)
    setError('')
    try {
      setBound(await bind(nickname))
      window.setTimeout(() => { navigate('/'); onDone() }, 1400)
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
      <p className="muted">{uiText('Введите ник персонажа в Escape from Tarkov — он один для PvP, PvE и «Сезона». Программа найдёт профиль в каждом режиме, прогресс у режимов свой.')}</p>
      <label className="field-label">{uiText('Ник Escape from Tarkov')}
        <input className="input" value={nickname} onChange={(event) => { setNickname(event.target.value); setError('') }} placeholder={uiText('Например: shaurma')} autoComplete="off" spellCheck={false} maxLength={15} autoFocus disabled={Boolean(bound)} />
      </label>
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      {bound && <BoundNickname binding={bound} />}
      {!bound && <button className="button primary account-gate-submit" type="submit" disabled={loading || nickname.trim().length < 3}>
        {loading ? <LoaderCircle className="spin" size={16} /> : <UserRound size={16} />}{uiText(loading ? 'Ищем профиль…' : 'Привязать ник')}
      </button>}
      {!bound && <button type="button" className="link-button account-gate-later" onClick={() => { navigate('/'); onDone() }}>{uiText('Позже')}</button>}
    </form>
  )
}
