import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BadgeCheck, ChevronDown, ChevronUp, ClipboardCopy, KeyRound, Link2, LoaderCircle, Mail, RefreshCw, X } from 'lucide-react'
import { adminApi, type PlanId } from './adminApi'
import { dateTime, errorText, PLAN_IDS, PLAN_LABEL } from './adminFormat'
import type { AdminRequest } from './ownerAccess'
import './adminNews.css'

const BASE = '/v1/accounts/me/admin/bezebee'

interface BzbMail { configured: boolean; user?: string; checkedAt?: string; error?: string; read: number }
interface BzbStatus { apiToken: boolean; webhookSecret: boolean; webhookUrl: string; mail?: BzbMail }
interface BzbEvent {
  id: number; receivedAt: string; status: 'confirmed' | 'unmatched' | 'ignored' | 'unverified' | 'duplicate'; signature: 'ok' | 'unsigned' | 'bad'
  detail?: string; email?: string; telegram?: string; plan?: PlanId; region?: 'CIS' | 'WORLD'; friend?: true; amount?: number; currency?: string; accountEmail?: string
}
interface BzbEvents { events: BzbEvent[]; total: number; unmatched: number }

const STATUS_TEXT: Record<BzbEvent['status'], string> = { confirmed: 'Зачислено', unmatched: 'Не сопоставлено', unverified: 'Без подписи', ignored: 'Пропущено', duplicate: 'Повтор' }
const when = dateTime
const planText = (event: BzbEvent) => (event.plan ? `${PLAN_LABEL[event.plan]}${event.region ? ` · ${event.region === 'CIS' ? 'СНГ' : 'Global'}` : ''}${event.friend ? ' · друг' : ''}` : 'тариф ?')

/**
 * «BZB — автозачисление оплат» of the admin app's «Платежи», as on the site (website/src/components/admin/AdminBezebee.tsx): folded to
 * its title, «Обновить» and «Разложить» (owner, 06.11.2026: «Просто БЗБ, автозачисление оплаты, она должна быть сложная, кнопка обновить
 * и разложить»; «Также в админ-приложении на телефоне»). A payment waiting for its account shows even folded.
 */
export function AdminBezebeeBlock({ request = adminApi.ownerRequest, onCredited }: { request?: AdminRequest; onCredited?: () => void }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ status: BzbStatus; events: BzbEvents } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [copied, setCopied] = useState(false)
  const [apiToken, setApiToken] = useState('')
  const [secret, setSecret] = useState('')
  const [mailUser, setMailUser] = useState('')
  const [mailPassword, setMailPassword] = useState('')
  const [attachTo, setAttachTo] = useState<Record<number, string>>({})
  const [manual, setManual] = useState<{ email: string; plan: PlanId; friend: boolean; amount: string; noDays: boolean }>({ email: '', plan: '1m', friend: false, amount: '', noDays: false })

  const read = useCallback(async () => {
    adminApi.forget()
    const [status, events] = await Promise.all([request('GET', `${BASE}/status`), request('GET', `${BASE}/events?limit=30`)])
    return { status: status as BzbStatus, events: events as BzbEvents }
  }, [request])
  useEffect(() => {
    let alive = true
    read().then((next) => { if (alive) { setData(next); setLoadError('') } }, (reason: unknown) => { if (alive) setLoadError(errorText(reason)) })
    return () => { alive = false }
  }, [read])
  const load = () => read().then((next) => { setData(next); setLoadError('') }, (reason: unknown) => setLoadError(errorText(reason)))
  const refresh = () => { setLoading(true); void load().finally(() => setLoading(false)) }

  const act = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError('')
    setDone('')
    try { await run(); setDone(message); await load() } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  /** The server reads the mailbox at once and answers with its state: a wrong password is said right here. */
  const mailAction = async (run: () => Promise<BzbMail | undefined>, message: string) => {
    setBusy(true)
    setError('')
    setDone('')
    try {
      const mail = await run()
      if (mail?.error) setError(mail.error)
      else setDone(message)
      await load()
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const saveMail = (event: FormEvent) => {
    event.preventDefault()
    if (!mailUser.trim() && !mailPassword.trim()) return
    void mailAction(async () => {
      const status = await request('PUT', `${BASE}/credentials`, { ...(mailUser.trim() ? { mailUser: mailUser.trim() } : {}), ...(mailPassword.trim() ? { mailPassword: mailPassword.trim() } : {}) }) as BzbStatus
      setMailUser('')
      setMailPassword('')
      return status.mail
    }, 'Почта подключена: письма BZB о продажах читаются каждую минуту.')
  }
  const saveKeys = (event: FormEvent) => {
    event.preventDefault()
    if (!apiToken.trim() && !secret.trim()) return
    void act(async () => {
      await request('PUT', `${BASE}/credentials`, { ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}), ...(secret.trim() ? { webhookSecret: secret.trim() } : {}) })
      setApiToken('')
      setSecret('')
    }, 'Ключи сохранены на сервере.')
  }
  const confirmManual = (event: FormEvent) => {
    event.preventDefault()
    const email = manual.email.trim()
    const amount = manual.amount.trim() ? Number(manual.amount.replace(',', '.')) : undefined
    if (!email || (amount !== undefined && !Number.isFinite(amount))) return
    void act(async () => {
      await request('POST', `${BASE}/payments`, { email, plan: manual.plan, ...(manual.friend ? { friend: true } : {}), ...(amount !== undefined ? { amount } : {}), ...(manual.noDays ? { noDays: true } : {}) })
      setManual({ email: '', plan: '1m', friend: false, amount: '', noDays: false })
      onCredited?.()
    }, manual.noDays ? `Оплата записана на ${email}, дни не зачислены.` : `Оплата зачислена на ${email}.`)
  }
  const copyUrl = async () => {
    if (!data) return
    try { await navigator.clipboard.writeText(data.status.webhookUrl); setCopied(true) } catch { setCopied(false) }
  }

  const waiting = data?.events.events.filter((event) => event.status === 'unmatched' || event.status === 'unverified') ?? []
  const mail = data?.status.mail
  const reading = Boolean(mail?.configured && !mail.error)
  return <section className="admin-block admin-bzb" aria-label="BZB">
    <header className="admin-bzb-head">
      <strong>BZB — автозачисление оплат</strong>
      {waiting.length > 0 && <span className="tag danger">Ждут привязки: {data?.events.unmatched}</span>}
      <span className="admin-bzb-buttons">
        <button type="button" className="button small ghost" disabled={loading} onClick={refresh}><RefreshCw size={13} className={loading ? 'spin' : ''} aria-hidden="true" />Обновить</button>
        <button type="button" className="button small ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}{open ? 'Сложить' : 'Разложить'}</button>
      </span>
    </header>
    {loadError && <p className="admin-news-error admin-bzb-line" role="alert">{loadError}</p>}
    {open && data && <div className="admin-bzb-body">
      {error && <p className="admin-news-error" role="alert">{error}</p>}
      {done && <p className="admin-bzb-done" role="status">{done}</p>}
      <p className={reading ? 'admin-bzb-done' : 'admin-news-error'}>
        <strong>{reading ? 'Автозачисление включено' : mail?.error ? 'Почта не читается' : 'Автозачисление выключено'}</strong>
        {reading ? ` Письма BZB о продажах читаются с ${mail!.user} каждую минуту.` : mail?.error ? ` ${mail.error}.` : ' Подключите ниже ящик с письмами BZB о продажах.'}
      </p>

      <form className="admin-bzb-form" onSubmit={saveMail}>
        <strong>1. Почта с письмами BZB о продажах</strong>
        <label><span>Адрес ящика {mail?.user ? `(сейчас ${mail.user}, пусто, чтобы оставить)` : '(не задан)'}</span><input className="input" type="email" autoComplete="off" value={mailUser} onChange={(event) => setMailUser(event.target.value)} /></label>
        <label><span>Пароль приложения {mail?.configured ? '(сохранён, пусто, чтобы оставить)' : '(не задан)'}</span><input className="input" type="password" autoComplete="off" value={mailPassword} onChange={(event) => setMailPassword(event.target.value)} /></label>
        <div className="admin-bzb-buttons">
          <button type="submit" className="button small primary" disabled={busy || (!mailUser.trim() && !mailPassword.trim())}>{busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Mail size={13} aria-hidden="true" />}Сохранить и проверить</button>
          <button type="button" className="button small ghost" disabled={busy || !mail?.configured} onClick={() => void mailAction(async () => (await request('POST', `${BASE}/mail/check`, {}) as { mail: BzbMail }).mail, 'Почта проверена.')}><RefreshCw size={13} aria-hidden="true" />Проверить почту сейчас</button>
        </div>
        {mail?.configured && <small>Прочитано писем BZB: {mail.read}. Последняя проверка: {when(mail.checkedAt)}.</small>}
      </form>

      <div className="admin-bzb-form">
        <strong>2. Адрес для BZB («Webhook URL»)</strong>
        <code>{data.status.webhookUrl}</code>
        <div className="admin-bzb-buttons"><button type="button" className="button small ghost" onClick={() => void copyUrl()}><ClipboardCopy size={13} aria-hidden="true" />{copied ? 'Скопировано' : 'Скопировать'}</button></div>
      </div>

      <form className="admin-bzb-form" onSubmit={saveKeys}>
        <strong>3. Ключ и секрет из кабинета BZB</strong>
        <label><span>API токен {data.status.apiToken ? '(сохранён, пусто, чтобы оставить)' : '(не задан)'}</span><input className="input" type="password" autoComplete="off" value={apiToken} onChange={(event) => setApiToken(event.target.value)} /></label>
        <label><span>Секрет подписи вебхуков {data.status.webhookSecret ? '(сохранён, пусто, чтобы оставить)' : '(не задан)'}</span><input className="input" type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
        <div className="admin-bzb-buttons"><button type="submit" className="button small primary" disabled={busy || (!apiToken.trim() && !secret.trim())}><KeyRound size={13} aria-hidden="true" />Сохранить</button></div>
      </form>

      {waiting.length > 0 && <div className="admin-bzb-form">
        <strong>Ждут привязки ({data.events.unmatched})</strong>
        {waiting.map((event) => <div key={event.id} className="admin-bzb-event">
          <span>{when(event.receivedAt)} · {planText(event)}{event.telegram ? ` · ${event.telegram}` : ''}</span>
          <input className="input" type="email" placeholder="e-mail аккаунта Raid OS" value={attachTo[event.id] ?? event.email ?? ''} onChange={(input) => setAttachTo({ ...attachTo, [event.id]: input.target.value })} />
          <div className="admin-bzb-buttons">
            <button type="button" className="button small primary" disabled={busy || !(attachTo[event.id] ?? event.email ?? '').trim()} onClick={() => void act(() => request('POST', `${BASE}/events/${event.id}/attach`, { email: (attachTo[event.id] ?? event.email ?? '').trim() }), 'Оплата привязана к аккаунту.')}><Link2 size={13} aria-hidden="true" />Привязать к аккаунту</button>
            <button type="button" className="button small ghost" disabled={busy} onClick={() => void act(() => request('POST', `${BASE}/events/${event.id}/dismiss`, {}), 'Уведомление убрано.')}><X size={13} aria-hidden="true" />Убрать</button>
          </div>
        </div>)}
      </div>}

      <form className="admin-bzb-form" onSubmit={confirmManual}>
        <strong>Зачислить оплату вручную</strong>
        <input className="input" type="email" placeholder="e-mail аккаунта" aria-label="E-mail аккаунта" value={manual.email} onChange={(input) => setManual({ ...manual, email: input.target.value })} />
        <select className="select" aria-label="Тариф" value={manual.plan} onChange={(input) => { const plan = input.target.value as PlanId; setManual({ ...manual, plan, friend: plan === '1m' && manual.friend }) }}>
          {PLAN_IDS.map((plan) => <option key={plan} value={plan}>{PLAN_LABEL[plan]}</option>)}
        </select>
        <input className="input" inputMode="decimal" placeholder="Сумма, ₽" aria-label="Сумма в рублях" value={manual.amount} onChange={(input) => setManual({ ...manual, amount: input.target.value })} />
        <label className="admin-bzb-check"><input type="checkbox" checked={manual.friend} disabled={manual.plan !== '1m'} onChange={(input) => setManual({ ...manual, friend: input.target.checked })} />Цена друга</label>
        {/* the payment only: the days were given by hand before (owner, 11.11.2026) */}
        <label className="admin-bzb-check"><input type="checkbox" checked={manual.noDays} onChange={(input) => setManual({ ...manual, noDays: input.target.checked })} />Не зачислять дни</label>
        <div className="admin-bzb-buttons"><button type="submit" className="button small primary" disabled={busy || !manual.email.trim()}><BadgeCheck size={13} aria-hidden="true" />Зачислить</button></div>
      </form>

      <div className="admin-bzb-form">
        <strong>Последние уведомления</strong>
        {data.events.events.length === 0 && <small>Уведомлений от BZB ещё не было.</small>}
        {data.events.events.map((event) => <div key={event.id} className="admin-bzb-event">
          <span>{when(event.receivedAt)} · <b title={event.detail}>{STATUS_TEXT[event.status]}{event.signature === 'bad' ? ' (подпись не совпала)' : ''}</b></span>
          <small>{planText(event)} · {event.accountEmail ?? event.email ?? event.telegram ?? '—'}{event.amount !== undefined ? ` · ${event.amount} ${event.currency ?? ''}` : ''}</small>
        </div>)}
      </div>
    </div>}
  </section>
}
