import { DownloadCloud, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Notice } from '../Notice'
import { dateTime } from './adminData'
import { API_URL } from '../../config'
import '../../admin-security.css'

const when = (iso?: string) => (iso ? dateTime.format(new Date(iso)) : '—')
const megabytes = (bytes: number) => `${(Math.round(bytes / 1024 / 102.4) / 10).toLocaleString('ru-RU')} МБ`

/**
 * «Серверная версия»: a one-time link to this laptop's exe (server/src/routes/serverDownload.ts). It lives 15 minutes and
 * serves at most three downloads; the owner build runs without a subscription, so there is no permanent link.
 */
export function ServerExeSection({ token }: { token: string }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string; size: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const request = async () => {
    setBusy(true); setError(''); setCopied(false)
    try {
      const response = await fetch(`${API_URL}/v1/accounts/me/admin/server-exe-link`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) })
      const data = await response.json().catch(() => ({})) as { url?: string; expiresAt?: string; size?: number; error?: string }
      if (!response.ok || !data.url) throw new Error(data.error ?? (response.status === 404 ? 'Раздел доступен только владельцу (или сервер ещё не обновлён).' : `Ошибка сервера (HTTP ${response.status})`))
      const url = new URL(`${API_URL}${data.url}`, window.location.origin).toString()
      setLink({ url, expiresAt: data.expiresAt ?? '', size: data.size ?? 0 })
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'Raid OS Server.exe'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (reason) {
      setLink(null)
      setError(reason instanceof Error && reason.name !== 'TimeoutError' ? reason.message : 'Сервер не ответил. Попробуйте ещё раз.')
    } finally { setBusy(false) }
  }
  const copy = () => { if (link) void navigator.clipboard?.writeText(link.url).then(() => setCopied(true), () => {}) }
  return (
    <section className="admin-section" aria-labelledby="update-exe-title">
      <div className="admin-section-head"><h2 className="panel-title" id="update-exe-title"><DownloadCloud aria-hidden="true" />Серверная версия</h2></div>
      <p className="field-hint" style={{ margin: 0 }}>Raid OS Server для Windows · доступно владельцу.</p>
      {link && (
        <div className="admin-exe-link">
          <code className="mono" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{link.url}</code>
          <span className="muted guard-small">{megabytes(link.size)} · до {when(link.expiresAt)}</span>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="admin-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="button" disabled={busy} onClick={() => void request()}>
          {busy ? <LoaderCircle aria-hidden="true" className="spinner" /> : <DownloadCloud aria-hidden="true" />}Скачать серверную версию
        </button>
        {link && <a className="button primary" href={link.url} download><DownloadCloud aria-hidden="true" />Скачать</a>}
        {link && <button type="button" className="button ghost" onClick={copy}>{copied ? 'Скопировано' : 'Скопировать ссылку'}</button>}
      </div>
    </section>
  )
}
