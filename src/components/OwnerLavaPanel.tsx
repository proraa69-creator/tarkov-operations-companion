import { useEffect, useState } from 'react'
import { Copy, Globe2 } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { LavaSettings, PaymentSettings } from '../electron'

/**
 * «Оплата: другие страны (Lava.top)» under «Сервер и сайт на этом компьютере»: API key and webhook key (both encrypted
 * with safeStorage in the main process and write-only here), offer id, currency, the rouble rate for statistics and
 * streamer shares, and the webhook address to paste into lava.top. Saved through the same owner:set-payments channel
 * as the ЮKassa settings (`section: 'lava'`, electron/ownerAdmin.ts).
 */
export const LAVA_WEBHOOK_URL = 'https://raidos.app/v1/payments/lava/webhook'
const DEFAULT_OFFER_ID = 'dde8abeb-b5ae-4a23-87b8-6bda4c7789e1'
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function LavaPaymentsPanel() {
  const api = window.tarkovDesktop?.owner
  const [saved, setSaved] = useState<LavaSettings | null>(null)
  const [form, setForm] = useState({ offerId: DEFAULT_OFFER_ID, currency: 'USD' as LavaSettings['currency'], rubRate: '', paymentMethod: '' as LavaSettings['paymentMethod'], apiKey: '', webhookKey: '' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const apply = (value: PaymentSettings) => {
    if (!value.lava) return
    setSaved(value.lava)
    setForm({ offerId: value.lava.offerId || DEFAULT_OFFER_ID, currency: value.lava.currency, rubRate: value.lava.rubRate ? String(value.lava.rubRate) : '', paymentMethod: value.lava.paymentMethod, apiKey: '', webhookKey: '' })
  }
  useEffect(() => { void api?.payments().then(apply).catch(() => {}) }, [api])
  if (!api || !saved) return null
  const on = saved.hasApiKey && saved.hasWebhookKey && saved.rubRate > 0
  const save = (clearKeys = false) => {
    setBusy(true); setMessage(null)
    void api.setPayments({
      section: 'lava', offerId: form.offerId.trim(), currency: form.currency, rubRate: Number(form.rubRate.replace(',', '.') || 0), paymentMethod: form.paymentMethod,
      ...(form.apiKey ? { apiKey: form.apiKey } : {}), ...(form.webhookKey ? { webhookKey: form.webhookKey } : {}), ...(clearKeys ? { clearKeys } : {}),
    })
      .then((value) => { apply(value); setMessage({ ok: true, text: 'Сохранено, сервер перезапущен' }) })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  return (
    <div className="setting-row owner-panel">
      <div className="owner-panel-head">
        <span>
          <strong><Globe2 size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Оплата: другие страны (Lava.top)')}</strong>
          <small>{uiText(on ? `Включена: ${saved.currency}, подписка с автопродлением через Lava.top` : 'Выключена: укажите API-ключ, ключ вебхука и курс')}</small>
        </span>
        <button className="button ghost" onClick={() => setOpen(!open)}>{uiText(open ? 'Свернуть' : 'Настроить')}</button>
      </div>
      {open && (
        <form className="owner-form" onSubmit={(event) => { event.preventDefault(); save() }}>
          <small>{uiText('Для карт не из России и СНГ (Visa/Mastercard, PayPal). API-ключ: app.lava.top → Интеграция → API-ключи. Ключи хранятся на этом компьютере в зашифрованном виде и больше не показываются.')}</small>
          <label><span>{uiText('API-ключ')}</span><input className="input" type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={uiText(saved.hasApiKey ? 'Сохранён. Оставьте пустым, чтобы не менять' : 'Ключ из кабинета Lava.top')} autoComplete="off" spellCheck={false} /></label>
          <label><span>{uiText('Ключ вебхука')}</span><input className="input" type="password" value={form.webhookKey} onChange={(event) => setForm({ ...form, webhookKey: event.target.value })} placeholder={uiText(saved.hasWebhookKey ? 'Сохранён. Оставьте пустым, чтобы не менять' : 'Придумайте длинный ключ и вставьте его же в Lava.top')} autoComplete="off" spellCheck={false} /></label>
          <label><span>{uiText('offerId')}</span><input className="input" value={form.offerId} onChange={(event) => setForm({ ...form, offerId: event.target.value })} placeholder={DEFAULT_OFFER_ID} autoComplete="off" spellCheck={false} /></label>
          <label><span>{uiText('Валюта')}</span>
            <select className="input" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as LavaSettings['currency'] })}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label><span>{uiText('Курс, ₽ за 1')} {form.currency}</span><input className="input" inputMode="decimal" value={form.rubRate} onChange={(event) => setForm({ ...form, rubRate: event.target.value })} placeholder="90" /></label>
          <small>{uiText('Курс нужен только для статистики и доли стримера в рублях: Lava.top выплачивает вам рубли, укажите примерный курс выплаты.')}</small>
          <label><span>{uiText('Способ оплаты')}</span>
            <select className="input" value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as LavaSettings['paymentMethod'] })}>
              <option value="">{uiText('Выбор на странице Lava.top')}</option>
              <option value="UNLIMINT">{uiText('Карта (Unlimint)')}</option>
              <option value="PAYPAL">PayPal</option>
              <option value="STRIPE">Stripe</option>
            </select>
          </label>
          <small>{uiText('Цены в USD/EUR задаются в самом оффере Lava.top для каждой периодичности: месяц, 90 дней, 180 дней, год. Сайт показывает их, если Lava.top их отдаёт, иначе — «цена на странице оплаты».')}</small>
          <small>{uiText('Адрес вебхука в Lava.top (события: успешная оплата, неуспешная оплата, продление подписки, отмена подписки; авторизация — X-Api-Key или Basic с ключом вебхука):')}</small>
          <span className="owner-link" style={{ gridTemplateColumns: '1fr auto' }}>
            <code style={{ userSelect: 'text', wordBreak: 'break-all' }}>{LAVA_WEBHOOK_URL}</code>
            <button type="button" className="button ghost" onClick={() => void navigator.clipboard?.writeText(LAVA_WEBHOOK_URL)}><Copy size={14} />{uiText('Скопировать')}</button>
          </span>
          {message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
          <span className="owner-actions">
            {(saved.hasApiKey || saved.hasWebhookKey) && <button type="button" className="button ghost" disabled={busy} onClick={() => save(true)}>{uiText('Удалить ключи')}</button>}
            <button className="button primary" type="submit" disabled={busy}>{uiText('Сохранить')}</button>
          </span>
        </form>
      )}
    </div>
  )
}
