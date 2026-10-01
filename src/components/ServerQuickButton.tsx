import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Server } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { LocalServerStatus, WatchdogAlert } from '../electron'
import { LocalServerRow } from './ServerAccountPanel'
import { ServerAlertToast, ServerStatusLamps, useServerWatchdog } from './ServerStatusLamps'
import { isOwnerApp } from '../app/buildEdition'
import '../styles/serverStatus.css'

const TOAST_MS = 15_000

/**
 * «Сервер» in the top bar: status lamps, start/stop of the account server and the website on this PC, the site and
 * the link for friends — the same controls as Profile → server account, one click away. Owner's desktop build only.
 * The popover fits the window (its own scroll), the icon's dot shows the worst lamp, alerts pop up as toasts.
 */
export function ServerQuickButton() {
  const api = window.tarkovDesktop?.account
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LocalServerStatus | null>(null)
  const [hostname, setHostname] = useState<string | undefined>()
  const [alerts, setAlerts] = useState<WatchdogAlert[]>([])
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const owner = Boolean(api?.localServerStatus) && isOwnerApp()

  const dismiss = useCallback((alert: WatchdogAlert) => setAlerts((list) => list.filter((entry) => entry !== alert)), [])
  const pushAlert = useCallback((alert: WatchdogAlert) => {
    setAlerts((list) => [alert, ...list.filter((entry) => entry.service !== alert.service)].slice(0, 3))
    window.setTimeout(() => dismiss(alert), TOAST_MS)
  }, [dismiss])
  const { snapshot, setSnapshot } = useServerWatchdog(pushAlert)

  useEffect(() => {
    if (!owner) return
    const load = () => {
      void api?.localServerStatus?.().then(setStatus).catch(() => {})
      void api?.tunnelStatus?.().then((tunnel) => setHostname(tunnel.hostname)).catch(() => {})
    }
    load()
    const timer = window.setInterval(load, open ? 2000 : 8000)
    return () => window.clearInterval(timer)
  }, [api, open, owner])

  useEffect(() => {
    if (!open) return
    // Only a press outside closes it: scrolling, the scrollbar and clicks inside keep it open.
    const close = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (rootRef.current?.contains(target) || target?.closest?.('.server-toasts')) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [open])

  // Fit the window: from just under the button to 12 px above the bottom edge, at any window height and theme.
  useLayoutEffect(() => {
    if (!open) return
    const fit = () => {
      const top = rootRef.current?.getBoundingClientRect().bottom ?? 68
      setMaxHeight(Math.max(160, Math.floor(window.innerHeight - top - 8 - 12)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open])

  // Only the owner's build has the server on this PC (electron/buildEdition.ts); players never see this button.
  if (!owner || !api) return null
  const running = Boolean(status?.enabled && (status.api === 'running' || status.api === 'external'))
  const worst = snapshot?.enabled ? snapshot.worst : running ? 'green' : 'grey'
  const title = worst === 'red' ? 'Сервер: ошибка' : worst === 'amber' ? 'Сервер: запускается или перезапускается' : running ? 'Сервер и сайт работают' : 'Сервер и сайт'
  return (
    <div className="server-quick" ref={rootRef}>
      <button className={`icon-button${running ? ' is-on' : ''} server-quick-lamp-${worst}`} onClick={() => setOpen((value) => !value)} title={uiText(title)} aria-label={uiText('Сервер и сайт')} aria-expanded={open}>
        <Server size={16} />
        <span className="server-quick-dot" aria-hidden="true" />
      </button>
      {open && (
        <div className="server-quick-panel panel" role="dialog" aria-label={uiText('Сервер и сайт')} style={maxHeight ? { maxHeight } : undefined}>
          <div className="server-quick-scroll">
            <div className="panel-body stack">
              <ServerStatusLamps snapshot={snapshot} onSnapshot={setSnapshot} hostname={hostname} />
              <LocalServerRow onChange={() => void api.localServerStatus?.().then(setStatus)} />
            </div>
          </div>
        </div>
      )}
      <ServerAlertToast alerts={alerts} onClose={dismiss} />
    </div>
  )
}
