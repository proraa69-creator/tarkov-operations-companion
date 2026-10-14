import { useEffect, useState } from 'react'
import { api, ApiError, type AdminOnline as Online } from '../../api'
import { useAuth } from '../../auth'
import { numberFormat } from './adminData'

/** How often the admin panel reads «Онлайн сейчас» while its tab is visible. */
export const ADMIN_ONLINE_REFRESH_MS = 45_000

/**
 * «Онлайн сейчас» at the top of the admin panel (owner, 14.10.2026: «сколько человек сейчас в приложении онлайн … и на
 * сайте в админ панели»): the accounts in the PC or phone app within the last few minutes
 * (server/src/services/presence.ts). Visits to the site do not count. Read every ~45 s while the tab is visible and at
 * once when it is shown again; a server without the route shows nothing.
 */
export function AdminOnline() {
  const { token } = useAuth()
  const [online, setOnline] = useState<Online | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (!token) return
    let alive = true
    let timer: number | undefined
    const visible = () => document.visibilityState !== 'hidden'
    const load = async () => {
      try {
        const next = await api.adminOnline(token)
        if (alive) { setOnline(next); setMissing(false) }
      } catch (reason) {
        // 404: a server from before «Онлайн сейчас». Anything else: the last number stays until the next try.
        if (alive && reason instanceof ApiError && reason.status === 404) setMissing(true)
      }
    }
    const start = () => {
      window.clearInterval(timer)
      timer = window.setInterval(() => { if (visible()) void load() }, ADMIN_ONLINE_REFRESH_MS)
    }
    const onVisibility = () => {
      if (!visible()) { window.clearInterval(timer); timer = undefined; return }
      void load()
      start()
    }
    if (visible()) { void load(); start() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [token])
  if (missing || !online) return null
  const title = `Аккаунты в приложении для ПК или телефона за последние ${online.windowMinutes} мин. Посещения сайта не считаются.`
  return (
    <div className="admin-online" role="status" title={title} aria-label={`Онлайн сейчас: ${online.online}. ПК: ${online.pc}, телефон: ${online.phone}. ${title}`}>
      <span className="admin-online-dot" aria-hidden="true" />
      <span>Онлайн сейчас: <strong className="mono">{numberFormat.format(online.online)}</strong></span>
      <span className="admin-online-split mono">ПК {numberFormat.format(online.pc)} · телефон {numberFormat.format(online.phone)}</span>
      <span className="admin-online-window">за {online.windowMinutes} мин</span>
    </div>
  )
}
