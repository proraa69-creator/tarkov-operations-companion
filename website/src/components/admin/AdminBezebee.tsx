import { ClipboardCopy, KeyRound, Link2, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { api, type AdminBezebeeEvent } from '../../api'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { dateTime, failure, useAdminData, type Failure } from './adminData'

const STATUS_TEXT: Record<AdminBezebeeEvent['status'], string> = {
  confirmed: 'Зачислено',
  unmatched: 'Не сопоставлено',
  unverified: 'Без подписи',
  ignored: 'Пропущено',
  duplicate: 'Повтор',
}
const PLAN_TEXT: Record<string, string> = { '1m': '1 мес.', '3m': '3 мес.', '6m': '6 мес.', '12m': '12 мес.' }
const when = (iso?: string) => (iso ? dateTime.format(new Date(iso)) : '—')

/**
 * «BZB» (payments tab; owner, 20.10.2026: «в отчёте об оплате сумма, какая подписка и какая почта — подтверждаться должно
 * само»): the address to put in BZB's «Webhook URL», the API key and the webhook signing secret pasted here (never shown
 * again), the notifications received and «Привязать к аккаунту» for one the server could not match (Telegram only,
 * another e-mail). See server/src/services/bezebeeWebhook.ts.
 */
export function AdminBezebee() {
  const panel = useAdminData(useCallback(async (token: string) => {
    const [status, events] = await Promise.all([api.adminBezebeeStatus(token), api.adminBezebeeEvents(token)])
    return { status, events }
  }, []))
  const [apiToken, setApiToken] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [done, setDone] = useState('')
  const [copied, setCopied] = useState(false)
  const [attachTo, setAttachTo] = useState<Record<number, string>>({})
  const [payload, setPayload] = useState<{ id: number; text: string } | null>(null)
  const token = panel.token
  const data = panel.data

  async function act(run: (token: string) => Promise<unknown>, message: string) {
    if (!token) return
    setBusy(true)
    setError(null)
    setDone('')
    try { await run(token); setDone(message); await panel.reload() } catch (reason) { setError(failure(reason)) } finally { setBusy(false) }
  }

  function saveKeys(event: FormEvent) {
    event.preventDefault()
    if (!apiToken.trim() && !secret.trim()) return
    void act(async (session) => {
      await api.adminBezebeeCredentials(session, { ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}), ...(secret.trim() ? { webhookSecret: secret.trim() } : {}) })
      setApiToken('')
      setSecret('')
    }, 'Ключи сохранены на сервере.')
  }

  async function copyUrl() {
    if (!data) return
    try { await navigator.clipboard.writeText(data.status.webhookUrl); setCopied(true) } catch { setCopied(false) }
  }

  async function showPayload(id: number) {
    if (!token) return
    if (payload?.id === id) { setPayload(null); return }
    try { setPayload({ id, text: JSON.stringify(JSON.parse((await api.adminBezebeePayload(token, id)).payload), null, 2) }) } catch (reason) { setError(failure(reason)) }
  }

  const waiting = data?.events.events.filter((event) => event.status === 'unmatched' || event.status === 'unverified') ?? []
  return (
    <section className="panel owner-panel" aria-labelledby="admin-bezebee-title">
      <div className="panel-header">
        <div className="panel-title" id="admin-bezebee-title">BZB — автозачисление оплат</div>
        <button type="button" className="button small ghost" onClick={() => void panel.refresh()} disabled={panel.loading}><RefreshCw aria-hidden="true" />Обновить</button>
      </div>
      <div className="panel-body owner-body admin-stack">
        {panel.error && <Notice tone={panel.error.offline ? 'offline' : 'error'} title="BZB не загрузился">{panel.error.message}</Notice>}
        {!data && !panel.error && <Loading />}
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title="Не получилось">{error.message}</Notice>}
        {done && <Notice tone="success" title="Готово">{done}</Notice>}
        {data && (
          <>
            <Notice tone={data.status.webhookSecret ? 'success' : 'warn'} title={data.status.webhookSecret ? 'Автозачисление включено' : 'Автозачисление выключено'}>
              {data.status.webhookSecret
                ? `Оплата зачисляется сама, если покупатель указал на странице BZB e-mail своего аккаунта Raid OS. Последнее уведомление: ${when(data.status.lastEventAt)}.`
                : 'Вставьте ниже «Секрет подписи вебхуков» из кабинета BZB. Без него сервер сохраняет уведомления, но подписку не открывает: без подписи уведомление может прислать кто угодно.'}
            </Notice>
            <div className="admin-stack">
              <strong>1. Адрес для BZB («Webhook URL» у API-ключа в кабинете BZB)</strong>
              <div className="admin-chips">
                <code>{data.status.webhookUrl}</code>
                <button type="button" className="button small ghost" onClick={() => void copyUrl()}><ClipboardCopy aria-hidden="true" />{copied ? 'Скопировано' : 'Скопировать'}</button>
              </div>
            </div>
            <form className="admin-stack" onSubmit={saveKeys}>
              <strong>2. Ключ и секрет из кабинета BZB</strong>
              <label className="field">
                <span>API токен {data.status.apiToken ? '(сохранён — пусто, чтобы оставить)' : '(не задан)'}</span>
                <input className="input" type="password" autoComplete="off" value={apiToken} onChange={(event) => setApiToken(event.target.value)} />
              </label>
              <label className="field">
                <span>Секрет подписи вебхуков {data.status.webhookSecret ? '(сохранён — пусто, чтобы оставить)' : '(не задан)'}</span>
                <input className="input" type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} />
              </label>
              <div className="admin-chips">
                <button type="submit" className="button small primary" disabled={busy || (!apiToken.trim() && !secret.trim())}>
                  {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}Сохранить
                </button>
              </div>
              <p className="muted">Значения хранятся только на сервере и больше нигде не показываются. Проверка: в кабинете BZB у ссылки оплаты нажмите «Resend webhook» — уведомление появится в списке ниже.</p>
            </form>

            {waiting.length > 0 && (
              <div className="admin-stack">
                <strong>Ждут привязки ({data.events.unmatched})</strong>
                {waiting.map((event) => (
                  <div key={event.id} className="admin-stack">
                    <span>{when(event.receivedAt)} · {event.plan ? PLAN_TEXT[event.plan] : 'тариф ?'}{event.region ? ` · ${event.region === 'CIS' ? 'СНГ' : 'Global'}` : ''}{event.friend ? ' · цена друга' : ''} · {event.email ?? event.telegram ?? 'нет контакта'} — {event.detail}</span>
                    <div className="admin-chips">
                      <input className="input" type="email" placeholder="e-mail аккаунта Raid OS" value={attachTo[event.id] ?? event.email ?? ''} onChange={(input) => setAttachTo({ ...attachTo, [event.id]: input.target.value })} />
                      <button type="button" className="button small primary" disabled={busy || !(attachTo[event.id] ?? event.email ?? '').trim()} onClick={() => void act((session) => api.adminBezebeeAttach(session, event.id, (attachTo[event.id] ?? event.email ?? '').trim()), 'Оплата зачислена на аккаунт.')}>
                        <Link2 aria-hidden="true" />Привязать к аккаунту
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="admin-stack">
              <strong>Последние уведомления</strong>
              {data.events.events.length === 0 && <p className="muted">Уведомлений от BZB ещё не было.</p>}
              {data.events.events.length > 0 && (
                <table className="admin-table">
                  <thead><tr><th>Когда</th><th>Статус</th><th>Тариф</th><th>Покупатель</th><th>Сумма</th><th /></tr></thead>
                  <tbody>
                    {data.events.events.map((event) => (
                      <tr key={event.id}>
                        <td>{when(event.receivedAt)}</td>
                        <td title={event.detail}>{STATUS_TEXT[event.status]}{event.signature === 'bad' ? ' (подпись не совпала)' : ''}</td>
                        <td>{event.plan ? `${PLAN_TEXT[event.plan]}${event.region ? ` · ${event.region === 'CIS' ? 'СНГ' : 'Global'}` : ''}${event.friend ? ' · друг' : ''}` : '—'}</td>
                        <td>{event.accountEmail ?? event.email ?? event.telegram ?? '—'}</td>
                        <td>{event.amount !== undefined ? `${event.amount} ${event.currency ?? ''}` : '—'}</td>
                        <td><button type="button" className="button small ghost" onClick={() => void showPayload(event.id)}>{payload?.id === event.id ? 'Скрыть' : 'JSON'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {payload && <pre className="admin-json">{payload.text}</pre>}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
