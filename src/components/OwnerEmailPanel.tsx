import { useEffect, useState } from 'react'
import { Mail, Send } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { EmailProvider, EmailServerStatus, EmailSettings } from '../electron'

/**
 * «Почта: коды подтверждения» under «Сервер и сайт на этом компьютере», next to the SMS panel: the e-mail provider for
 * registration confirmation, sign-in by e-mail code and «Забыли пароль?» (server/src/services/email,
 * docs/email-codes.md). The key is encrypted with safeStorage in the main process and write-only here; the settings
 * reach the API process only as environment variables. The website's admin panel has no such settings on purpose: a
 * stolen owner web session must not be able to redirect one-time codes.
 */
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const PROVIDERS: Array<{ id: EmailProvider; label: string }> = [{ id: 'resend', label: 'Resend' }]
const DEFAULT_FROM = 'Raid OS <noreply@raidos.app>'

export function OwnerEmailPanel() {
  const api = window.tarkovDesktop?.owner
  const [saved, setSaved] = useState<EmailSettings | null>(null)
  const [server, setServer] = useState<EmailServerStatus | null>(null)
  const [form, setForm] = useState({ provider: '' as EmailProvider, from: DEFAULT_FROM, dailyLimit: '500', apiKey: '' })
  const [testTo, setTestTo] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const apply = (value: EmailSettings) => {
    setSaved(value)
    setForm({ provider: value.provider, from: value.from, dailyLimit: String(value.dailyLimit), apiKey: '' })
  }
  const refreshServer = () => { void api?.emailStatus?.().then(setServer).catch(() => setServer(null)) }
  useEffect(() => {
    void api?.email?.().then(apply).catch(() => {})
    refreshServer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])
  if (!api?.email || !api.setEmail || !saved) return null
  const status = !saved.configured
    ? uiText('Выключено: регистрация без подтверждения e-mail, вход и восстановление по коду из письма скрыты')
    : server?.emailEnabled
      ? `${uiText('Включено')}: Resend · ${server.from ?? saved.from} · ${uiText('отправлено за сутки')} ${server.sentToday} / ${server.dailyLimit}`
      : `${uiText('Настроено')}: Resend · ${uiText('сервер ещё не применил настройки')}`

  const save = (clearKey = false) => {
    setBusy(true); setMessage(null)
    void api.setEmail!({
      provider: clearKey ? '' : form.provider, from: form.from.trim(), dailyLimit: Number(form.dailyLimit || 0),
      ...(form.apiKey ? { apiKey: form.apiKey.trim() } : {}), ...(clearKey ? { clearKey } : {}),
    })
      .then((value) => { apply(value); setMessage({ ok: true, text: 'Сохранено, сервер перезапущен' }); window.setTimeout(refreshServer, 1500) })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  const sendTest = () => {
    if (!api.sendTestEmail) return
    setBusy(true); setMessage(null)
    void api.sendTestEmail(testTo.trim())
      .then((result) => { setMessage({ ok: true, text: `${uiText('Тестовое письмо отправлено')} · ${result.sentToday} / ${result.dailyLimit}` }); refreshServer() })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }

  return (
    <div className="setting-row owner-panel">
      <div className="owner-panel-head">
        <span>
          <strong><Mail size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Почта: коды подтверждения')}</strong>
          <small>{status}</small>
        </span>
        <button className="button ghost" onClick={() => setOpen(!open)}>{uiText(open ? 'Свернуть' : 'Настроить')}</button>
      </div>
      {open && (
        <form className="owner-form" onSubmit={(event) => { event.preventDefault(); save() }}>
          <small>{uiText('Коды для подтверждения e-mail при регистрации, входа по коду из письма и восстановления пароля. Ключ хранится на этом компьютере в зашифрованном виде и больше не показывается. Эти настройки есть только здесь, не на сайте. Подробности: docs/email-codes.md.')}</small>
          <label><span>{uiText('Почтовый сервис')}</span>
            <select className="input" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as EmailProvider })}>
              <option value="">{uiText('Выключено')}</option>
              {PROVIDERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </label>
          {form.provider && <label><span>{uiText('API-ключ')}</span><input className="input" type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={uiText(saved.hasKey ? 'Сохранён. Оставьте пустым, чтобы не менять' : 're_… (Resend → API Keys, доступ Sending access)')} autoComplete="off" spellCheck={false} /></label>}
          {form.provider && <label><span>{uiText('Отправитель (From)')}</span><input className="input" value={form.from} maxLength={200} onChange={(event) => setForm({ ...form, from: event.target.value })} placeholder={DEFAULT_FROM} autoComplete="off" spellCheck={false} /></label>}
          {form.provider && <small>{uiText('Домен отправителя (raidos.app) должен быть подтверждён в Resend, иначе письма не уйдут.')}</small>}
          <label><span>{uiText('Лимит писем в сутки')}</span><input className="input" inputMode="numeric" value={form.dailyLimit} onChange={(event) => setForm({ ...form, dailyLimit: event.target.value.replace(/\D/g, '') })} placeholder="500" /></label>
          <small>{uiText('Защита от рассылки через форму регистрации: после лимита письма не отправляются до следующих суток, вход по паролю работает как обычно.')}</small>
          {message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
          <span className="owner-actions">
            {saved.hasKey && <button type="button" className="button ghost" disabled={busy} onClick={() => save(true)}>{uiText('Удалить ключ')}</button>}
            <button className="button primary" type="submit" disabled={busy}>{uiText('Сохранить')}</button>
          </span>
          {saved.configured && api.sendTestEmail && <>
            <label><span>{uiText('Тестовое письмо на адрес')}</span><input className="input" type="email" value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="you@example.com" autoComplete="off" /></label>
            <span className="owner-actions">
              <button type="button" className="button" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.trim())} onClick={sendTest}><Send size={14} />{uiText('Отправить тестовое письмо')}</button>
            </span>
          </>}
        </form>
      )}
    </div>
  )
}
