import { useEffect, useState } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import { useServerStatus } from '../sync/serverSync'

/**
 * «Онлайн сейчас» in the owner app (owner, 14.10.2026: «еще нужно что бы в приложении админа было под кнопкой ваши
 * предложения, сколько человек сейчас в приложении онлайн»): GET /v1/accounts/me/admin/online, the accounts seen in the
 * PC or phone app within the last few minutes (server/src/services/presence.ts). Only the owner app asks; the server
 * answers 404 to everybody else.
 */
export const OWNER_ONLINE_PATH = '/v1/accounts/me/admin/online'
export const OWNER_ONLINE_REFRESH_MS = 45_000
/** Focus right after an answer does not ask again. */
const FOCUS_QUIET_MS = 10_000

export interface OnlineNow { online: number; pc: number; phone: number; windowMinutes: number; at: string }

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null)

/** The server's answer, shape-checked (null when it is not one). */
export function cleanOnline(raw: unknown): OnlineNow | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const online = count(value?.online)
  if (!value || online === null) return null
  return { online, pc: count(value.pc) ?? 0, phone: count(value.phone) ?? 0, windowMinutes: count(value.windowMinutes) || 5, at: typeof value.at === 'string' ? value.at : '' }
}

/**
 * The count for the owner app (null outside it, signed out, or until the first answer). Read every ~45 s and when the
 * window gets the focus back; nothing is asked while the window is hidden.
 */
export function useOwnerOnline() {
  const status = useServerStatus()
  const enabled = isOwnerApp() && Boolean(status?.signedIn)
  const [online, setOnline] = useState<OnlineNow | null>(null)
  useEffect(() => {
    const request = enabled ? serviceClient() : undefined
    if (!request) return
    let alive = true
    let timer: number | undefined
    let asked = 0
    const visible = () => document.visibilityState !== 'hidden'
    const load = async () => {
      asked = Date.now()
      try {
        const next = cleanOnline(await request('GET', OWNER_ONLINE_PATH))
        if (alive && next) setOnline(next)
      } catch { /* an older server or no connection: the last number stays until the next try */ }
    }
    const start = () => {
      window.clearInterval(timer)
      timer = window.setInterval(() => { if (visible()) void load() }, OWNER_ONLINE_REFRESH_MS)
    }
    const onVisibility = () => {
      if (!visible()) { window.clearInterval(timer); timer = undefined; return }
      void load()
      start()
    }
    const onFocus = () => { if (visible() && Date.now() - asked > FOCUS_QUIET_MS) void load() }
    if (visible()) { void load(); start() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      setOnline(null)
    }
  }, [enabled])
  return enabled ? online : null
}
