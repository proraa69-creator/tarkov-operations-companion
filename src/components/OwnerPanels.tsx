import { useEffect, useState } from 'react'
import { Copy, CreditCard, UserPlus } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { PaymentSettings, StreamerRow } from '../electron'

/**
 * Owner controls under «Сервер и сайт на этом компьютере»: ЮKassa settings for subscriptions and secret invitation
 * links for streamers. Everything goes through the main process (electron/ownerAdmin.ts); the ЮKassa secret key is
 * write-only here — the app never shows it again.
 */
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function PaymentsPanel() {
  const api = window.tarkovDesktop?.owner
  const [saved, setSaved] = useState<PaymentSettings | null>(null)
  const [form, setForm] = useState({ shopId: '', monthPrice: '', receipts: false, streamerPercent: '0', secretKey: '' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    void api?.payments().then((value) => {
      setSaved(value)
      setForm({ shopId: value.shopId, monthPrice: value.monthPrice ? String(value.monthPrice) : '', receipts: value.receipts, streamerPercent: String(value.streamerPercent), secretKey: '' })
    }).catch(() => {})
  }, [api])
  if (!api || !saved) return null
  const on = Boolean(saved.shopId && saved.hasKey && saved.monthPrice)
  const save = (clearKey = false) => {
    setBusy(true); setMessage(null)
    void api.setPayments({ shopId: form.shopId, monthPrice: Number(form.monthPrice || 0), receipts: form.receipts, streamerPercent: Number(form.streamerPercent || 0), ...(form.secretKey ? { secretKey: form.secretKey } : {}), ...(clearKey ? { clearKey } : {}) })
      .then((value) => { setSaved(value); setForm((current) => ({ ...current, secretKey: '' })); setMessage({ ok: true, text: 'Сохранено, сервер перезапущен' }) })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  return (
    <div className="setting-row owner-panel">
      <div className="owner-panel-head">
        <span>
          <strong><CreditCard size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Оплата подписки (ЮKassa)')}</strong>
          <small>{uiText(on ? `Включена: ${saved.monthPrice} ₽ в месяц` : 'Выключена: укажите магазин, ключ и цену')}</small>
        </span>
        <button className="button ghost" onClick={() => setOpen(!open)}>{uiText(open ? 'Свернуть' : 'Настроить')}</button>
      </div>
      {open && (
        <form className="owner-form" onSubmit={(event) => { event.preventDefault(); save() }}>
          <small>{uiText('Данные берутся в личном кабинете ЮKassa → Интеграция → Ключи API. Ключ хранится на этом компьютере в зашифрованном виде и больше не показывается.')}</small>
          <label><span>{uiText('shopId')}</span><input className="input" inputMode="numeric" value={form.shopId} onChange={(event) => setForm({ ...form, shopId: event.target.value })} placeholder="123456" autoComplete="off" /></label>
          <label><span>{uiText('Секретный ключ')}</span><input className="input" type="password" value={form.secretKey} onChange={(event) => setForm({ ...form, secretKey: event.target.value })} placeholder={uiText(saved.hasKey ? 'Сохранён. Оставьте пустым, чтобы не менять' : 'live_… или test_…')} autoComplete="off" spellCheck={false} /></label>
          <label><span>{uiText('Цена месяца, ₽')}</span><input className="input" inputMode="decimal" value={form.monthPrice} onChange={(event) => setForm({ ...form, monthPrice: event.target.value })} placeholder="299" /></label>
          {Number(form.monthPrice) > 0 && <small>{uiText('Тарифы:')} 1 {uiText('мес')} — {fmt(Number(form.monthPrice))} ₽ · 3 {uiText('мес')} — {fmt(Number(form.monthPrice) * 3)} ₽ · 6 {uiText('мес')} — {fmt(Number(form.monthPrice) * 6)} ₽ · 12 {uiText('мес')} — {fmt(Number(form.monthPrice) * 12 * 0.67)} ₽ (−33%)</small>}
          <label><span>{uiText('Доля стримера, %')}</span><input className="input" inputMode="decimal" value={form.streamerPercent} onChange={(event) => setForm({ ...form, streamerPercent: event.target.value })} /></label>
          <label className="owner-check"><input type="checkbox" checked={form.receipts} onChange={(event) => setForm({ ...form, receipts: event.target.checked })} /><span>{uiText('Отправлять чеки 54-ФЗ через ЮKassa (если подключена онлайн-касса или «Мой налог»)')}</span></label>
          <small>{uiText('Адрес для уведомлений в ЮKassa (Интеграция → HTTP-уведомления, событие payment.succeeded и payment.canceled):')} <code style={{ userSelect: 'text' }}>{'https://<ваш постоянный адрес>/v1/payments/yookassa/webhook'}</code></small>
          {message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
          <span className="owner-actions">
            {saved.hasKey && <button type="button" className="button ghost" disabled={busy} onClick={() => save(true)}>{uiText('Удалить ключ')}</button>}
            <button className="button primary" type="submit" disabled={busy}>{uiText('Сохранить')}</button>
          </span>
        </form>
      )}
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
        </div>
      )}
    </div>
  )
}
