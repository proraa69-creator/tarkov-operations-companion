import { BadgeCheck, ClipboardCopy, KeyRound, Link2, LoaderCircle, Mail, RefreshCw, X } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { api, type AdminBezebeeEvent, type AdminBezebeeMail, type PlanId } from '../../api'
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
  const [manual, setManual] = useState<{ email: string; plan: PlanId; friend: boolean; amount: string }>({ email: '', plan: '1m', friend: false, amount: '' })
  const [mailUser, setMailUser] = useState('')
  const [mailPassword, setMailPassword] = useState('')
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

  /** A mailbox action: the server reads the mailbox at once and answers with its state — a reading error is shown as is. */
  async function mailAction(run: (token: string) => Promise<AdminBezebeeMail | undefined>, message: string) {
    if (!token) return
    setBusy(true)
    setError(null)
    setDone('')
    try {
      const mail = await run(token)
      if (mail?.error) setError({ message: mail.error, offline: false })
      else setDone(message)
      await panel.reload()
    } catch (reason) { setError(failure(reason)) } finally { setBusy(false) }
  }

  /** The mailbox with BZB's sale letters: saved, then read at once — a wrong password shows here right away. */
  function saveMail(event: FormEvent) {
    event.preventDefault()
    if (!mailUser.trim() && !mailPassword.trim()) return
    void mailAction(async (session) => {
      const status = await api.adminBezebeeCredentials(session, { ...(mailUser.trim() ? { mailUser: mailUser.trim() } : {}), ...(mailPassword.trim() ? { mailPassword: mailPassword.trim() } : {}) })
      setMailPassword('')
      setMailUser('')
      return status.mail
    }, 'Почта подключена: письма BZB о продажах читаются каждую минуту.')
  }

  function checkMail() {
    void mailAction(async (session) => (await api.adminBezebeeMailCheck(session)).mail, 'Почта проверена.')
  }

  function confirmManual(event: FormEvent) {
    event.preventDefault()
    const email = manual.email.trim()
    const amount = manual.amount.trim() ? Number(manual.amount.replace(',', '.')) : undefined
    if (!email || (amount !== undefined && !Number.isFinite(amount))) return
    void act(async (session) => {
      await api.adminBezebeeConfirm(session, { email, plan: manual.plan, ...(manual.friend ? { friend: true as const } : {}), ...(amount !== undefined ? { amount } : {}) })
      setManual({ email: '', plan: '1m', friend: false, amount: '' })
    }, `Оплата зачислена на ${email}.`)
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
            {(() => {
              const mail = data.status.mail
              const reading = Boolean(mail?.configured && !mail.error)
              return (
                <Notice tone={reading ? 'success' : 'warn'} title={reading ? 'Автозачисление включено' : mail?.error ? 'Почта не читается' : 'Автозачисление выключено'}>
                  {reading
                    ? `Письма BZB о продажах читаются с ${mail!.user} каждую минуту; подписка открывается сама, если покупатель указал e-mail своего аккаунта Raid OS. Последняя проверка: ${when(mail!.checkedAt)}.`
                    : mail?.error
                      ? `${mail.error}. Проверьте адрес и пароль приложения ниже.`
                      : 'BZB присылает каждую продажу письмом. Подключите ниже ящик, куда пересылаются письма «Новая продажа», — сервер будет читать его каждую минуту.'}
                </Notice>
              )
            })()}
            <form className="admin-stack" onSubmit={saveMail}>
              <strong>1. Почта с письмами BZB о продажах</strong>
              <p className="muted">Ящик Gmail, куда фильтр пересылает письма от no-reply@bezebee.com с темой «Новая продажа». Пароль — «пароль приложения» этого ящика (myaccount.google.com/apppasswords), не обычный пароль. Подписку открывают только письма, которые Gmail подтвердил как отправленные BZB.</p>
              <label className="field">
                <span>Адрес ящика {data.status.mail?.user ? `(сейчас ${data.status.mail.user} — пусто, чтобы оставить)` : '(не задан)'}</span>
                <input className="input" type="email" autoComplete="off" placeholder="raidosapp@gmail.com" value={mailUser} onChange={(event) => setMailUser(event.target.value)} />
              </label>
              <label className="field">
                <span>Пароль приложения {data.status.mail?.configured ? '(сохранён — пусто, чтобы оставить)' : '(не задан)'}</span>
                <input className="input" type="password" autoComplete="off" value={mailPassword} onChange={(event) => setMailPassword(event.target.value)} />
              </label>
              <div className="admin-chips">
                <button type="submit" className="button small primary" disabled={busy || (!mailUser.trim() && !mailPassword.trim())}>
                  {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Mail aria-hidden="true" />}Сохранить и проверить
                </button>
                <button type="button" className="button small ghost" disabled={busy || !data.status.mail?.configured} onClick={checkMail}><RefreshCw aria-hidden="true" />Проверить почту сейчас</button>
              </div>
              {data.status.mail?.configured && <p className="muted">Прочитано писем BZB: {data.status.mail.read}. Последняя проверка: {when(data.status.mail.checkedAt)}.</p>}
            </form>
            <div className="admin-stack">
              <strong>2. Уведомления по API (если BZB их пришлёт): адрес для BZB («Webhook URL» у API-ключа в кабинете BZB)</strong>
              <div className="admin-chips">
                <code>{data.status.webhookUrl}</code>
                <button type="button" className="button small ghost" onClick={() => void copyUrl()}><ClipboardCopy aria-hidden="true" />{copied ? 'Скопировано' : 'Скопировать'}</button>
              </div>
            </div>
            <form className="admin-stack" onSubmit={saveKeys}>
              <strong>3. Ключ и секрет из кабинета BZB</strong>
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
                      <button type="button" className="button small ghost" disabled={busy} onClick={() => void act((session) => api.adminBezebeeDismiss(session, event.id), 'Уведомление убрано из списка.')}>
                        <X aria-hidden="true" />Убрать
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form className="admin-stack" onSubmit={confirmManual}>
              <strong>Зачислить оплату вручную</strong>
              <p className="muted">Если по оплате уведомление от BZB не пришло: e-mail аккаунта Raid OS и оплаченный тариф. Для Global укажите полученную сумму в рублях.</p>
              <div className="admin-chips">
                <input className="input" type="email" placeholder="e-mail аккаунта" aria-label="E-mail аккаунта" value={manual.email} onChange={(input) => setManual({ ...manual, email: input.target.value })} />
                <select className="input" aria-label="Тариф" value={manual.plan} onChange={(input) => { const plan = input.target.value as PlanId; setManual({ ...manual, plan, friend: plan === '1m' && manual.friend }) }}>
                  {(['1m', '3m', '6m', '12m'] as const).map((plan) => <option key={plan} value={plan}>{PLAN_TEXT[plan]}</option>)}
                </select>
                <input className="input" inputMode="decimal" placeholder="Сумма, ₽" aria-label="Сумма в рублях" value={manual.amount} onChange={(input) => setManual({ ...manual, amount: input.target.value })} />
                <label className="admin-chips"><input type="checkbox" checked={manual.friend} disabled={manual.plan !== '1m'} onChange={(input) => setManual({ ...manual, friend: input.target.checked })} />Цена друга</label>
                <button type="submit" className="button small primary" disabled={busy || !manual.email.trim()}><BadgeCheck aria-hidden="true" />Зачислить</button>
              </div>
            </form>

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
