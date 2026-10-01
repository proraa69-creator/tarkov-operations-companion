import { useEffect, useState } from 'react'
import { cleanIpcError } from '../sync/serverSync'
import { serviceClient } from './nicknameBinding'

/**
 * Helpers shared by the one-time-code forms in the apps: SMS codes (PhoneAccount.tsx) and e-mail codes
 * (EmailAccount.tsx). Code requests go through the whitelisted service request (electron/serviceGateway.ts,
 * sync/webAccount.ts); the calls that return a session have their own account API.
 */

export interface CodeChallenge { challengeId: string; expiresAt: string; resendSeconds: number }

export async function postService(path: string, body: unknown) {
  const request = serviceClient()
  if (!request) throw new Error('Сервер недоступен')
  try {
    return await request('POST', path, body)
  } catch (error) {
    throw new Error(cleanIpcError(error), { cause: error })
  }
}

/** «Отправить код ещё раз (42)»: seconds left of the resend cooldown. */
export function useCooldown() {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [until])
  return { left: Math.max(0, Math.ceil((until - now) / 1000)), start: (seconds: number) => { setNow(Date.now()); setUntil(Date.now() + seconds * 1000) } }
}

/** The server's «Новый код можно запросить через 42 с.» → 42. */
export const waitFrom = (message: string) => Number(/через (\d+) с/.exec(message)?.[1] ?? 0)

/**
 * Whether the server sends one-time codes over `flag` ('smsEnabled' | 'emailEnabled', GET /v1/accounts/auth-config).
 * null while unknown; false without a server, on an older server or with the codes switched off.
 */
export function useAuthFlag(flag: 'smsEnabled' | 'emailEnabled', online: boolean | undefined) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    const request = serviceClient()
    if (!request || !online) return
    let active = true
    request('GET', '/v1/accounts/auth-config')
      .then((answer) => { if (active) setEnabled((answer as Record<string, unknown> | null)?.[flag] === true) })
      .catch(() => { if (active) setEnabled(false) })
    return () => { active = false }
  }, [online, flag])
  return online ? enabled : online === false ? false : null
}
