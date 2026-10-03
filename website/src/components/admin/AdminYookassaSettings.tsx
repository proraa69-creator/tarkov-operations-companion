import { useCallback, useState } from 'react'
import { api, errorMessage, type YookassaSettingsInput, type YookassaSettingsView } from '../../api'
import { Notice } from '../Notice'
import { useAdminData } from './adminData'
import { Loading } from './adminShared'

export function AdminYookassaSettings() {
  const view = useAdminData(useCallback((token: string) => api.adminYookassaSettings(token), []))
  const [saved, setSaved] = useState(false)
  return <section className="admin-section" aria-labelledby="yookassa-settings-title">
    <h2 id="yookassa-settings-title">Оплата через ЮKassa</h2>
    {view.error && <Notice tone="error">{view.error.message} Для этой формы нужна новая версия приложения-сервера.</Notice>}
    {!view.data && !view.error && <Loading />}
    {saved && <Notice tone="info">Настройки ЮKassa сохранены и применены.</Notice>}
    {view.data && view.token && <YookassaForm key={JSON.stringify(view.data.settings)} token={view.token} data={view.data} onSaved={next => { view.setData(next); setSaved(true) }} />}
  </section>
}

function YookassaForm({ token, data, onSaved }: { token: string; data: YookassaSettingsView; onSaved: (next: YookassaSettingsView) => void }) {
  const { hasKey, ...initial } = data.settings
  const [fields, setFields] = useState<YookassaSettingsInput>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try { onSaved(await api.adminSaveYookassaSettings(token, fields)) }
    catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  return <>
    <p>{data.configured ? 'ЮKassa подключена.' : 'Для подключения сохраните секретный ключ в приложении на ноутбуке и укажите магазин и цену.'}</p>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <fieldset disabled={busy} className="lava-settings-fields">
        <legend>Настройки подписки в рублях</legend>
        <label>shopId<input required inputMode="numeric" pattern="[0-9]{1,12}" value={fields.shopId} onChange={event => setFields({ ...fields, shopId: event.target.value })} /></label>
        <label>Цена месяца, ₽<input type="number" required min="1" max="100000" step="0.01" value={fields.monthPrice || ''} onChange={event => setFields({ ...fields, monthPrice: Number(event.target.value) })} /></label>
        <label>Доля стримера по умолчанию, %<input type="number" required min="0" max="100" step="0.1" value={fields.streamerPercent} onChange={event => setFields({ ...fields, streamerPercent: Number(event.target.value) })} /></label>
        <label><input type="checkbox" checked={fields.receipts} onChange={event => setFields({ ...fields, receipts: event.target.checked })} /> Отправлять чеки через ЮKassa</label>
        <label><input type="checkbox" checked={fields.autopay} onChange={event => setFields({ ...fields, autopay: event.target.checked })} /> Разрешить автопродление</label>
        <span className="field-hint">Автоплатежи должны быть подключены для магазина в ЮKassa. Покупатель отдельно подтверждает согласие на автопродление.</span>
        <span className="field-hint">Секретный ключ: {hasKey ? 'сохранён' : 'не сохранён'}. Ввод и изменение ключа — только в приложении на ноутбуке: «Сервер → Оплата».</span>
        <button type="submit" className="btn">{busy ? 'Подождите…' : 'Сохранить оплату ЮKassa'}</button>
      </fieldset>
    </form>
    {error && <Notice tone="error">{error}</Notice>}
    <p>Адрес уведомлений: <code>{window.location.origin}/v1/payments/yookassa/webhook</code></p>
    <p className="field-hint">Новая цена применяется к новым заказам. Сумма уже созданных платежей и сохранённых автоплатежей не меняется.</p>
  </>
}
