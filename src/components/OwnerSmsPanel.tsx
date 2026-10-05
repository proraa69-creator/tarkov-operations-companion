import { useEffect, useState } from 'react'
import { MessageSquareText, Send } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { SmsProvider, SmsServerStatus, SmsSettings } from '../electron'

/**
 * «SMS: одноразовые коды» under «Сервер и сайт на этом компьютере», next to the streamer share: the SMS provider for
 * phone binding, sign-in and password reset by phone (server/src/services/sms, docs/sms-login.md). The key is
 * encrypted with safeStorage in the main process and write-only here; the settings reach the API process only as
 * environment variables. The website's admin panel has no such settings on purpose: a stolen owner web session must
 * not be able to redirect one-time codes.
 */
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const PROVIDERS: Array<{ id: SmsProvider; label: string; login?: string; key: string }> = [
  { id: 'smsru', label: 'SMS.ru', key: 'api_id (sms.ru → Программистам)' },
  { id: 'smsc', label: 'SMSC.ru', login: 'Логин SMSC.ru', key: 'Пароль или API-пароль SMSC.ru' },
  { id: 'smsaero', label: 'SMS Aero', login: 'E-mail аккаунта SMS Aero', key: 'API-ключ (smsaero.ru → Настройки → API)' },
]

export function OwnerSmsPanel() {
  const api = window.tarkovDesktop?.owner
  const [saved, setSaved] = useState<SmsSettings | null>(null)
  const [server, setServer] = useState<SmsServerStatus | null>(null)
  const [form, setForm] = useState({ provider: '' as SmsProvider, login: '', sender: '', dailyLimit: '100', countries: '7', apiKey: '' })
  const [testPhone, setTestPhone] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const apply = (value: SmsSettings) => {
    setSaved(value)
    setForm({ provider: value.provider, login: value.login, sender: value.sender, dailyLimit: String(value.dailyLimit), countries: value.countries, apiKey: '' })
  }
  const refreshServer = () => { void api?.smsStatus?.().then(setServer).catch(() => setServer(null)) }
  useEffect(() => {
    void api?.sms?.().then(apply).catch(() => {})
    refreshServer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])
  if (!api?.sms || !api.setSms || !saved) return null
  const provider = PROVIDERS.find((entry) => entry.id === form.provider)
  const providerLabel = PROVIDERS.find((entry) => entry.id === saved.provider)?.label ?? ''
  const status = !saved.configured
    ? uiText('Выключено: вход и восстановление по телефону скрыты на сайте и в приложении')
    : server?.smsEnabled
      ? `${uiText('Включено')}: ${providerLabel} · ${uiText('отправлено за сутки')} ${server.sentToday} / ${server.dailyLimit}`
      : `${uiText('Настроено')}: ${providerLabel} · ${uiText('сервер ещё не применил настройки')}`

  const save = (clearKey = false) => {
    setBusy(true); setMessage(null)
    void api.setSms!({
      provider: clearKey ? '' : form.provider, login: form.login.trim(), sender: form.sender.trim(), dailyLimit: Number(form.dailyLimit || 0), countries: form.countries,
      ...(form.apiKey ? { apiKey: form.apiKey } : {}), ...(clearKey ? { clearKey } : {}),
    })
      .then((value) => { apply(value); setMessage({ ok: true, text: 'Сохранено, сервер перезапущен' }); window.setTimeout(refreshServer, 1500) })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  const sendTest = () => {
    if (!api.sendTestSms) return
    setBusy(true); setMessage(null)
    void api.sendTestSms(testPhone)
      .then((result) => { setMessage({ ok: true, text: `${uiText('Тестовое SMS отправлено')} · ${result.sentToday} / ${result.dailyLimit}` }); refreshServer() })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }

  return (
    <div className="setting-row owner-panel">
      <div className="owner-panel-head">
        <span>
          <strong><MessageSquareText size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('SMS: одноразовые коды')}</strong>
          <small>{status}</small>
        </span>
        <button className="button ghost" onClick={() => setOpen(!open)}>{uiText(open ? 'Свернуть' : 'Настроить')}</button>
      </div>
      {open && (
        <form className="owner-form" onSubmit={(event) => { event.preventDefault(); save() }}>
          <small>{uiText('Коды для привязки телефона, входа и восстановления пароля по номеру. Ключ хранится на этом компьютере в зашифрованном виде и больше не показывается. Эти настройки есть только здесь, не на сайте. Подробности: docs/sms-login.md.')}</small>
          <label><span>{uiText('Провайдер')}</span>
            <select className="input" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as SmsProvider })}>
              <option value="">{uiText('Выключено')}</option>
              {PROVIDERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </label>
          {provider?.login && <label><span>{uiText(provider.login)}</span><input className="input" value={form.login} onChange={(event) => setForm({ ...form, login: event.target.value })} autoComplete="off" spellCheck={false} /></label>}
          {provider && <label><span>{uiText('Ключ')}</span><input className="input" type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={uiText(saved.hasKey ? 'Сохранён. Оставьте пустым, чтобы не менять' : provider.key)} autoComplete="off" spellCheck={false} /></label>}
          {provider && <label><span>{uiText('Имя отправителя')}</span><input className="input" value={form.sender} maxLength={11} onChange={(event) => setForm({ ...form, sender: event.target.value })} placeholder={uiText('Пусто — имя провайдера по умолчанию')} autoComplete="off" spellCheck={false} /></label>}
          {provider && <small>{uiText('Своё имя отправителя (например RaidOS) сначала согласуйте у провайдера: без согласования SMS с ним не уходят. Пустое поле — общее имя провайдера.')}</small>}
          <label><span>{uiText('Лимит SMS в сутки')}</span><input className="input" inputMode="numeric" value={form.dailyLimit} onChange={(event) => setForm({ ...form, dailyLimit: event.target.value.replace(/\D/g, '') })} placeholder="100" /></label>
          <small>{uiText('Защита от «накрутки» SMS: после лимита коды не отправляются до следующих суток, вход по e-mail работает как обычно.')}</small>
          <label><span>{uiText('Страны (коды)')}</span><input className="input" value={form.countries} onChange={(event) => setForm({ ...form, countries: event.target.value })} placeholder="7" autoComplete="off" spellCheck={false} /></label>
          {message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
          <span className="owner-actions">
            {saved.hasKey && <button type="button" className="button ghost" disabled={busy} onClick={() => save(true)}>{uiText('Удалить ключ')}</button>}
            <button className="button primary" type="submit" disabled={busy}>{uiText('Сохранить')}</button>
          </span>
          {saved.configured && api.sendTestSms && <>
            <label><span>{uiText('Тестовое SMS на номер')}</span><input className="input" type="tel" value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="+7 999 123-45-67" autoComplete="off" /></label>
            <span className="owner-actions">
              <button type="button" className="button" disabled={busy || testPhone.replace(/\D/g, '').length < 10} onClick={sendTest}><Send size={14} />{uiText('Отправить тестовое SMS')}</button>
            </span>
          </>}
        </form>
      )}
    </div>
  )
}
