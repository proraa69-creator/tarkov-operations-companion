import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { canResolvePlayerProfiles } from '../profile/playerProfileGateway'
import { useServerAccount } from '../sync/serverSync'
import { isNative } from '../platform'
import { DeepLinkLogin } from '../mobile/DeepLinkLogin'
import { OPEN_ACCOUNT_SIGN_IN_EVENT } from './accountEvents'
import { accountNickname, findNickname, profileNickname, RAID_MODE_ORDER, saveNicknameOnServer } from './nicknameBinding'
import { SignInStep, type AccountGateTab } from './AccountSignIn'
import { logNickname } from './logNickname'
import { accountGateEnabled } from './accountGate'
import './account.css'

/** Offline sign-in was skipped in this window (the server was not reachable). */
const SKIP_KEY = 'tarkov-account-gate-skipped'

/**
 * The account side of the app shell:
 * - first launch without a session (accountGateEnabled): the account window right away — «Вход» / «Регистрация»
 *   inside the app (AccountSignIn.tsx), then Overview;
 * - one nickname for PvP, PvE and «Сезон» on the server account (owner, 10.10.2026), read from the game logs by itself
 *   (account/logNickname.ts, no manual binding): modes without a bound profile are bound with it and a nickname the
 *   account lacks is saved to it.
 */
export function AccountController() {
  const navigate = useNavigate()
  const { status } = useServerAccount()
  const [skipped, setSkipped] = useState(() => readSkip())
  const [tab, setTab] = useState<AccountGateTab>('login')
  const gated = accountGateEnabled()
  // The sign-in window: no signed-in account (unless skipped while the server was not reachable).
  const needsSignIn = Boolean(gated && status && !status.signedIn && !skipped)
  const gateStep: 'signin' | null = needsSignIn ? 'signin' : null

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

  // The phone keeps handling QR sign-in links while the account window is open (DeepLinkLogin sits above it).
  const deepLinks = isNative() ? <DeepLinkLogin /> : null
  if (!gateStep) return deepLinks
  return <>
    <AccountGate
      tab={tab}
      // The nickname is read from the game logs (account/logNickname.ts): straight to the app after the sign-in.
      onSignedIn={() => navigate('/')}
      onSkip={() => { writeSkip(); setSkipped(true) }}
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
 * - the game logs gave a nickname (logNickname.ts) the account lacks: the account gets it; else the account has none
 *   and the app has one: the account gets it (per-mode Tarkov.dev names can lag behind a rename: never pushed);
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
    const local = profileNickname(profile, state.raidMode)
    // The game logs are the source (logNickname.ts): read before the sign-in, their nickname replaces the account's.
    const logs = logNickname()
    const push = logs && logs.toLowerCase() !== remote?.toLowerCase() ? logs : local && !remote ? local : undefined
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

/** The first-run window: the account sign-in (the nickname then comes from the game logs by itself). */
function AccountGate({ tab, onSignedIn, onSkip }: { tab: AccountGateTab; onSignedIn: () => void; onSkip: () => void }) {
  return (
    <div className="registration-overlay account-gate" role="dialog" aria-modal="true" aria-label={uiText('Вход в аккаунт')}>
      <section className="panel registration-dialog account-gate-dialog">
        <SignInStep key={tab} initialTab={tab} onSigningIn={() => {}} onSignedIn={onSignedIn} onSkip={onSkip} />
      </section>
    </div>
  )
}
