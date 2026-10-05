import { useEffect, useState } from 'react'
import { Copy, ShieldCheck, UserPlus } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { StreamerRow, StreamerShareSettings } from '../electron'

/**
 * Owner controls under «Сервер и сайт на этом компьютере»: the global streamer share and secret invitation links for
 * streamers. Everything goes through the main process (electron/ownerAdmin.ts).
 */
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** «Доля стримеров, %» (0–100): the share of every payment credited to the referring streamer (TARKOV_STREAMER_PERCENT). */
export function StreamerSharePanel() {
  const api = window.tarkovDesktop?.owner
  const [saved, setSaved] = useState<StreamerShareSettings | null>(null)
  const [percent, setPercent] = useState('10')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    void api?.streamerShare?.().then((value) => { setSaved(value); setPercent(String(value.streamerPercent)) }).catch(() => {})
  }, [api])
  if (!api?.setStreamerShare || !saved) return null
  const value = Number(percent.replace(',', '.'))
  const valid = percent.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100
  const save = () => {
    if (!valid || !api.setStreamerShare) { setMessage({ ok: false, text: 'Доля стримеров: от 0 до 100 %' }); return }
    setBusy(true); setMessage(null)
    void api.setStreamerShare({ streamerPercent: value })
      .then((next) => { setSaved(next); setPercent(String(next.streamerPercent)); setMessage({ ok: true, text: 'Сохранено, сервер перезапущен' }) })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  return (
    <div className="setting-row owner-panel">
      <form className="owner-form" onSubmit={(event) => { event.preventDefault(); save() }}>
        <label><span>{uiText('Доля стримеров, %')}</span><input className="input" inputMode="decimal" value={percent} onChange={(event) => setPercent(event.target.value)} aria-invalid={!valid} /></label>
        {message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
        <span className="owner-actions">
          <button className="button primary" type="submit" disabled={busy || !valid || value === saved.streamerPercent}>{uiText('Сохранить')}</button>
        </span>
      </form>
    </div>
  )
}

const fmt = (value: number) => (Math.round(value * 100) / 100).toLocaleString('ru-RU')

export function StreamersPanel() {
  const api = window.tarkovDesktop?.owner
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ streamers: StreamerRow[]; invites: Array<{ code: string; expiresAt: string }> } | null>(null)
  const [code, setCode] = useState('')
  const [link, setLink] = useState<{ link: string; code: string; expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => { void api?.streamers().then((value) => { setData(value); setError('') }).catch((reason: unknown) => setError(errorText(reason))) }
  useEffect(() => { if (open) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!api) return null
  const invite = () => {
    setBusy(true); setError(''); setLink(null)
    void api.inviteStreamer(code).then((value) => { setLink(value); setCode(''); load() }).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false))
  }
  return (
    <div className="setting-row owner-panel">
      <div className="owner-panel-head">
        <span>
          <strong><UserPlus size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Стримеры')}</strong>
          <small>{uiText('Секретная ссылка-приглашение: стример открывает её, регистрируется, и у него появляется кабинет стримера. Обычные игроки её не видят.')}</small>
        </span>
        <button className="button ghost" onClick={() => setOpen(!open)}>{uiText(open ? 'Свернуть' : 'Открыть')}</button>
      </div>
      {open && (
        <div className="owner-form">
          <form className="owner-invite" onSubmit={(event) => { event.preventDefault(); invite() }}>
            <input className="input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder={uiText('Код стримера, например HUNTER_TV')} maxLength={24} spellCheck={false} />
            <button className="button primary" type="submit" disabled={busy || code.trim().length < 3}>{uiText('Создать ссылку')}</button>
          </form>
          {link && (
            <div className="owner-link">
              <small>{uiText('Ссылка для')} {link.code} · {uiText('одноразовая, действует до')} {new Date(link.expiresAt).toLocaleDateString()}</small>
              <strong style={{ userSelect: 'text', wordBreak: 'break-all' }}>{link.link}</strong>
              <button className="button ghost" onClick={() => void navigator.clipboard.writeText(link.link)}><Copy size={14} />{uiText('Скопировать')}</button>
            </div>
          )}
          {error && <small style={{ color: 'var(--danger)' }}>{uiText(error)}</small>}
          {data && data.streamers.length > 0 && (
            <table className="owner-table">
              <thead><tr><th>{uiText('Код')}</th><th>E-mail</th><th>{uiText('Переходы')}</th><th>{uiText('Регистрации')}</th><th>{uiText('Оплатили')}</th><th>{uiText('Выручка, ₽')}</th><th>{uiText('Начислено, ₽')}</th></tr></thead>
              <tbody>{data.streamers.map((row) => (
                <tr key={row.code}><td>{row.code}</td><td>{row.email}</td><td>{row.stats.visits}</td><td>{row.stats.registrations}</td><td>{row.stats.activeSubscriptions}</td><td>{fmt(row.stats.revenue.amount)}</td><td>{fmt(row.stats.earnings.amount)}</td></tr>
              ))}</tbody>
            </table>
          )}
          {data && data.invites.length > 0 && <small>{uiText('Неиспользованные приглашения:')} {data.invites.map((item) => item.code).join(', ')}</small>}
          {data && !data.streamers.length && !data.invites.length && <small>{uiText('Стримеров пока нет.')}</small>}
          <OwnerEmailForm />
        </div>
      )}
    </div>
  )
}

/**
 * «E-mail владельца»: the site account(s) that see the owner section of the website (streamers, statistics, links,
 * payouts). Passed to the API as TARKOV_OWNER_EMAILS; the server checks it on every owner request.
 */
function OwnerEmailForm() {
  const api = window.tarkovDesktop?.owner
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { void api?.ownerEmails?.().then((emails) => { setSaved(emails); setValue(emails.join(', ')) }).catch(() => {}) }, [api])
  if (!api?.setOwnerEmails) return null
  const save = () => {
    setBusy(true); setMessage(null)
    void api.setOwnerEmails(value)
      .then((emails) => { setSaved(emails); setValue(emails.join(', ')); setMessage({ ok: true, text: 'Сохранено, сервер перезапущен' }) })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  return (
    <form className="owner-form owner-email" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 4 }} onSubmit={(event) => { event.preventDefault(); save() }}>
      <label>
        <span><ShieldCheck size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{uiText('E-mail владельца')}</span>
        <input className="input" type="text" inputMode="email" value={value} onChange={(event) => setValue(event.target.value)} placeholder="owner@example.com" autoComplete="off" spellCheck={false} />
      </label>
      <small>{uiText('Войдите на сайте с этим e-mail — в личном кабинете появится раздел владельца: все стримеры, их статистика, ссылки-приглашения и выплаты. Сначала зарегистрируйте этот e-mail на сайте: указанный здесь адрес больше нельзя зарегистрировать заново.')}</small>
      {message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
      <span className="owner-actions">
        <button className="button primary" type="submit" disabled={busy || value.trim() === (saved ?? []).join(', ')}>{uiText('Сохранить')}</button>
      </span>
    </form>
  )
}
