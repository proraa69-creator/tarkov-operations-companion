import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, type Account } from './api'
import { loadSessionToken, saveSessionToken } from './storage'

type Status = 'signed-out' | 'loading' | 'ready' | 'error'

interface AuthState {
  token: string | null
  account: Account | null
  status: Status
  error: ApiError | null
  login(email: string, password: string): Promise<{ token: string }>
  register(email: string, password: string, referralCode?: string): Promise<{ token: string; referralApplied: boolean }>
  logout(): Promise<void>
  reload(): void
  setAccount(account: Account): void
  /** A session from QR sign-in (qrLogin.ts): approved on a signed-in phone or desktop app. */
  adopt(token: string, account: Account): void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => loadSessionToken())
  const [account, setAccount] = useState<Account | null>(null)
  const [status, setStatus] = useState<Status>(() => (loadSessionToken() ? 'loading' : 'signed-out'))
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  const adoptSession = useCallback((nextToken: string | null, nextAccount: Account | null) => {
    saveSessionToken(nextToken)
    setToken(nextToken)
    setAccount(nextAccount)
    setError(null)
    setStatus(nextToken && nextAccount ? 'ready' : 'signed-out')
  }, [])

  // Load the account for a remembered session (and on "retry").
  useEffect(() => {
    if (!token || account) return
    let cancelled = false
    api.me(token).then(
      (me) => { if (!cancelled) { setAccount(me); setError(null); setStatus('ready') } },
      (reason: unknown) => {
        if (cancelled) return
        if (reason instanceof ApiError && reason.status === 401) { adoptSession(null, null); return }
        setError(reason instanceof ApiError ? reason : new ApiError(0, 'Не удалось загрузить аккаунт'))
        setStatus('error')
      },
    )
    return () => { cancelled = true }
  }, [token, account, attempt, adoptSession])

  const value = useMemo<AuthState>(() => ({
    token, account, status, error,
    async login(email, password) {
      const result = await api.login(email, password)
      adoptSession(result.token, result.account)
      return { token: result.token }
    },
    async register(email, password, referralCode) {
      const result = await api.register(email, password, referralCode)
      adoptSession(result.token, result.account)
      return { token: result.token, referralApplied: Boolean(result.referralApplied) }
    },
    async logout() {
      const current = token
      adoptSession(null, null)
      if (current) await api.logout(current).catch(() => undefined)
    },
    reload() {
      setStatus('loading')
      setError(null)
      setAttempt((n) => n + 1)
    },
    setAccount(next) { setAccount(next) },
    adopt(nextToken, nextAccount) { adoptSession(nextToken, nextAccount) },
  }), [token, account, status, error, adoptSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
