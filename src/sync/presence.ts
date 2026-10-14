/**
 * «Онлайн сейчас» (owner, 14.10.2026: «сколько человек сейчас в приложении онлайн»): while the PC app or the phone app
 * runs and its user is signed in, it tells the server about once a minute (POST /v1/me/presence). The gateway sends the
 * device id with it (electron/serviceGateway.ts, src/sync/webAccount.ts); the server keeps the count in memory and only
 * the owner reads it (server/src/services/presence.ts). The browser preview sends nothing; the website never does.
 */
import { useEffect } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isDesktopShell, isNative } from '../platform'
import { useServerStatus } from './serverSync'

export const PRESENCE_PATH = '/v1/me/presence'
/** Under the server's 5-minute window with room for a missed beat or two (server/src/services/presence.ts). */
export const PRESENCE_HEARTBEAT_MS = 60_000

/** The heartbeat of this app while its user is signed in (mounted once, in the app shell). */
export function usePresenceHeartbeat() {
  const status = useServerStatus()
  const account = status?.signedIn ? status.email ?? 'signed-in' : ''
  useEffect(() => {
    if (!account || !(isDesktopShell() || isNative())) return
    const request = serviceClient()
    if (!request) return
    let last = 0
    const beat = () => {
      last = Date.now()
      // An older server without the route, no connection: the next beat tries again.
      void request('POST', PRESENCE_PATH).catch(() => {})
    }
    beat()
    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS)
    // Back on screen (the phone app resumed): at once, unless a beat went out moments ago.
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - last > 15_000) beat() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [account])
}
