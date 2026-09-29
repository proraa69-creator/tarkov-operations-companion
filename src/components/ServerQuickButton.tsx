import { useEffect, useRef, useState } from 'react'
import { Server } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { LocalServerStatus } from '../electron'
import { LocalServerRow } from './ServerAccountPanel'

/**
 * «Сервер» in the top bar: start/stop the account server and the website on this PC, open the site and the
 * link for friends — the same controls as Profile → server account, one click away. Desktop only.
 */
export function ServerQuickButton() {
  const api = window.tarkovDesktop?.account
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LocalServerStatus | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!api?.localServerStatus) return
    const load = () => void api.localServerStatus?.().then(setStatus).catch(() => {})
    load()
    const timer = window.setInterval(load, open ? 2000 : 8000)
    return () => window.clearInterval(timer)
  }, [api, open])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [open])

  if (!api?.localServerStatus) return null
  const running = Boolean(status?.enabled && (status.api === 'running' || status.api === 'external'))
  return (
    <div className="server-quick" ref={rootRef}>
      <button className={`icon-button${running ? ' is-on' : ''}`} onClick={() => setOpen((value) => !value)} title={uiText(running ? 'Сервер и сайт работают' : 'Сервер и сайт')} aria-label={uiText('Сервер и сайт')} aria-expanded={open}>
        <Server size={16} />
        <span className="server-quick-dot" aria-hidden="true" />
      </button>
      {open && (
        <div className="server-quick-panel panel" role="dialog" aria-label={uiText('Сервер и сайт')}>
          <div className="panel-body stack">
            <LocalServerRow onChange={() => void api.localServerStatus?.().then(setStatus)} />
          </div>
        </div>
      )}
    </div>
  )
}
