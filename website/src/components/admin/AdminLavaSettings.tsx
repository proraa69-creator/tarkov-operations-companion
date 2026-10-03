import { useCallback, useState } from 'react'
import { api, errorMessage, type LavaSettingsInput, type LavaSettingsView, type LavaTestResult } from '../../api'
import { Notice } from '../Notice'
import { useAdminData } from './adminData'
import { Loading } from './adminShared'

export function AdminLavaSettings() {
  const view = useAdminData(useCallback((token: string) => api.adminLavaSettings(token), []))
  const [saved, setSaved] = useState(false)
  return (
    <section className="admin-section" aria-labelledby="lava-settings-title">
      <h2 id="lava-settings-title">Оплата через Lava.top</h2>
      {view.error && <Notice tone="error">{view.error.message} Для этой формы нужна новая версия приложения-сервера.</Notice>}
      {!view.data && !view.error && <Loading />}
      {saved && <Notice tone="info">Настройки сохранены и применены. Сервер продолжает работать.</Notice>}
      {view.data && view.token && <LavaForm key={JSON.stringify(view.data.settings)} token={view.token} data={view.data} onSaved={next => { view.setData(next); setSaved(true) }} />}
    </section>
  )
}

function LavaForm({ token, data, onSaved }: { token: string; data: LavaSettingsView; onSaved: (next: LavaSettingsView) => void }) {
  const [fields, setFields] = useState<LavaSettingsInput>({ offerId: data.settings.offerId, currency: data.settings.currency, rubRate: data.settings.rubRate, paymentMethod: data.settings.paymentMethod })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [test, setTest] = useState<LavaTestResult | null>(null)
  const save = async () => {
    setBusy(true); setError(''); setTest(null)
    try {
      const next = await api.adminSaveLavaSettings(token, fields)
      onSaved(next)
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  const check = async () => {
    setBusy(true); setError(''); setTest(null)
    try { setTest(await api.adminTestLava(token)) } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  return (
    <>
      <p>{data.configured ? 'Lava.top подключена.' : 'Для подключения сохраните ключи в приложении на ноутбуке и укажите курс.'} Стоимость подписки задаётся в Lava.top.</p>
      <form onSubmit={event => { event.preventDefault(); void save() }}>
        <fieldset disabled={busy} className="lava-settings-fields">
          <legend>Настройки подписки</legend>
          <label>offerId<input required value={fields.offerId} onChange={event => setFields({ ...fields, offerId: event.target.value })} /></label>
          <label>Валюта<select value={fields.currency} onChange={event => setFields({ ...fields, currency: event.target.value as 'USD' | 'EUR' })}><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
          <label>Курс, ₽ за 1 {fields.currency}<input type="number" required min="0.01" max="100000" step="0.01" value={fields.rubRate || ''} onChange={event => setFields({ ...fields, rubRate: Number(event.target.value) })} /></label>
          <span className="field-hint">Курс используется для статистики и расчёта доли стримеров, а не для суммы списания.</span>
          <label>Способ оплаты<select value={fields.paymentMethod} onChange={event => setFields({ ...fields, paymentMethod: event.target.value as LavaSettingsInput['paymentMethod'] })}><option value="">Выбор на странице Lava.top</option><option value="UNLIMINT">UNLIMINT</option><option value="PAYPAL">PayPal</option><option value="STRIPE">Stripe</option></select></label>
          <span className="field-hint">API-ключ: {data.settings.hasApiKey ? 'сохранён' : 'не сохранён'}. Ключ вебхука: {data.settings.hasWebhookKey ? 'сохранён' : 'не сохранён'}. Ввод и изменение ключей — только в приложении на ноутбуке: «Сервер → Оплата».</span>
          <button type="submit" className="btn">{busy ? 'Подождите…' : 'Сохранить оплату Lava.top'}</button>
          <button type="button" className="btn" onClick={() => void check()}>Проверить вебхук</button>
        </fieldset>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {test && <Notice tone={test.ok && test.publicUrl === 'ok' ? 'info' : 'warn'}>{test.message}</Notice>}
      <p>Адрес вебхука: <code>{window.location.origin}/v1/payments/lava/webhook</code></p>
      <p className="field-hint">В Lava.top включите успешную и неуспешную оплату, успешное и неуспешное продление, отмену подписки. Проверка вебхука не списывает деньги и не создаёт подписку.</p>
    </>
  )
}
