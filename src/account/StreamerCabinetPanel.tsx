import { useEffect, useState, type FormEvent } from 'react'
import { BadgeRussianRuble, Copy, Link2, LoaderCircle, RefreshCw, Save, Send, Tv } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { cleanIpcError, useServerAccount } from '../sync/serverSync'
import { apiBaseUrl as phoneApiBaseUrl } from '../sync/webAccount'
import { serviceClient } from './nicknameBinding'
import { subscriptionText } from './accountActions'
import './account.css'

/**
 * «Кабинет стримера» on the profile (desktop and phone), for a signed-in streamer account: the same numbers as the
 * streamer cabinet on the website. Only the streamer's own share and earnings are shown — never subscription prices or
 * what the viewers paid. Server routes (server/src/routes/accounts.ts, payouts.ts):
 *   GET  /v1/accounts/me                           referralCode, stats
 *   GET  /v1/accounts/me/referral-stats?period=…    table by day / month / year
 *   GET  /v1/accounts/me/referral-campaigns         visits per audience link label
 *   GET  /v1/accounts/me/payouts                    balance, details, auto-payout, history
 *   PUT  /v1/accounts/me/payout-settings            { phone?, bank?, recipient?, auto?, intervalDays? }
 *   POST /v1/accounts/me/payouts                    { amount }
 */
type Period = 'day' | 'month' | 'year'
interface Row { period: string; visits: number; registrations: number; payments: number; earnings: number }
interface Campaign { campaign: string; visits: number; visits30d: number }
interface PayoutRow { id: string; amount: number; status: 'pending' | 'paid' | 'rejected'; auto: boolean; createdAt: string; decidedAt?: string; comment?: string; destination: string }
interface Payouts {
  percent: number
  earned: number
  paidOut: number
  pending: number
  available: number
  minimum: number
  details: { phone: string; bank: string; recipient: string } | null
  autoPayout: { enabled: boolean; intervalDays: number; limits: { min: number; max: number }; nextAt: string | null }
  payouts: PayoutRow[]
}
interface MeView { referralCode?: string; stats?: { visits: number; registrations: number; activeSubscriptions: number; earnings: { amount: number } } }

const rub = (value: number) => `${(Math.round(value * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`
const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString('ru-RU') : '—')
const STATUS: Record<PayoutRow['status'], string> = { pending: 'Ожидает выплаты', paid: 'Выплачено', rejected: 'Отклонено' }
const CAMPAIGN = /^[a-z0-9_-]{1,32}$/

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const send = serviceClient()
  if (!send) throw new Error('Войдите в аккаунт')
  const answer = await send(method, path, body)
  if (!answer) throw new Error('Войдите в аккаунт')
  return answer as T
}

async function siteAddress() {
  const desktop = window.tarkovDesktop?.account?.websiteUrl
  if (desktop) return desktop()
  try { return new URL(phoneApiBaseUrl()).origin } catch { return '' }
}

export function StreamerCabinetPanel() {
  const { status } = useServerAccount()
  const [me, setMe] = useState<MeView | null>(null)
  const [payouts, setPayouts] = useState<Payouts | null>(null)
  const [period, setPeriod] = useState<Period>('day')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [site, setSite] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const streamer = Boolean(status?.signedIn && status.online && status.kind === 'streamer')

  useEffect(() => {
    if (!streamer) return
    let active = true
    const keep = <T,>(apply: (value: T) => void) => (value: T) => { if (active) apply(value) }
    void Promise.all([
      request<MeView>('GET', '/v1/accounts/me').then(keep(setMe)),
      request<Payouts>('GET', '/v1/accounts/me/payouts').then(keep(setPayouts)),
      request<{ campaigns: Campaign[] }>('GET', '/v1/accounts/me/referral-campaigns').then((value) => keep(setCampaigns)(value.campaigns ?? [])).catch(() => keep(setCampaigns)([])),
      siteAddress().then(keep(setSite)).catch(() => keep(setSite)('')),
    ]).then(() => keep(setError)(''), (reason: unknown) => keep(setError)(cleanIpcError(reason))).finally(() => keep(setLoading)(false))
    return () => { active = false }
  }, [streamer, attempt])
  const load = () => { setLoading(true); setAttempt((value) => value + 1) }

  useEffect(() => {
    if (!streamer) return
    let active = true
    void request<{ rows: Row[] }>('GET', `/v1/accounts/me/referral-stats?period=${period}`)
      .then((value) => { if (active) setRows(value.rows ?? []) }, () => { if (active) setRows([]) })
    return () => { active = false }
  }, [streamer, period])

  if (!streamer) return null
  const code = me?.referralCode ?? ''
  const link = code && site ? `${site}/r/${encodeURIComponent(code)}` : ''

  return (
    <section className="panel account-cabinet" aria-label={uiText('Кабинет стримера')}>
      <div className="panel-header">
        <div className="panel-title"><Tv size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Кабинет стримера')}</div>
        <button className="button ghost small" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} />{uiText('Обновить')}</button>
      </div>
      <div className="panel-body stack">
        {error && <p className="account-cabinet-note account-error" role="alert">{uiText(error)}</p>}
        <div className="account-cabinet-grid">
          <Cell label="Подписка" value={subscriptionText(status?.subscription)} note="Для стримеров сервис бесплатный" good />
          <Cell label="Ваша доля" value={payouts ? `${payouts.percent}%` : '—'} note="От оплат зрителей по вашим ссылкам" />
          <Cell label="Заработано всего" value={payouts ? rub(payouts.earned) : '—'} note={me?.stats ? `${uiText('Переходы по ссылкам')}: ${me.stats.visits} · ${uiText('регистрации')}: ${me.stats.registrations} · ${uiText('оплатили')}: ${me.stats.activeSubscriptions}` : ''} />
          <Cell label="Доступно к выплате" value={payouts ? rub(payouts.available) : '—'} note={payouts ? `${uiText('Выплачено')}: ${rub(payouts.paidOut)} · ${uiText('в обработке')}: ${rub(payouts.pending)}` : ''} good={Boolean(payouts && payouts.available > 0)} />
        </div>

        <h3 className="account-subtitle">{uiText('Ссылки')}</h3>
        <div className="streamer-links">
          {link && <CopyLine label="Реферальная ссылка" value={link} />}
          {!link && <p className="account-cabinet-note">{uiText(code ? 'Адрес сайта недоступен: ссылка появится, когда сервер будет доступен по интернету.' : 'Код стримера загружается…')}</p>}
          {link && <AudienceLinkMaker link={link} />}
          {campaigns.length > 0 && <p className="account-cabinet-note">{uiText('Переходы по ссылкам для аудитории:')} {campaigns.map((entry) => `${entry.campaign} — ${entry.visits}`).join(' · ')}</p>}
        </div>

        <div className="account-heading-row">
          <h3 className="account-subtitle">{uiText('Статистика')}</h3>
          <div className="mode-switch streamer-periods" role="tablist" aria-label={uiText('Период')}>
            {(['day', 'month', 'year'] as const).map((entry) => <button key={entry} role="tab" aria-selected={period === entry} className={period === entry ? 'active' : ''} onClick={() => setPeriod(entry)}>{uiText(entry === 'day' ? 'По дням' : entry === 'month' ? 'По месяцам' : 'По годам')}</button>)}
          </div>
        </div>
        <div className="streamer-table-wrap">
          <table className="streamer-table">
            <thead><tr><th>{uiText('Период')}</th><th>{uiText('Переходы по ссылкам')}</th><th>{uiText('Регистрации')}</th><th>{uiText('Оплатили')}</th><th>{uiText('Заработок')}</th></tr></thead>
            <tbody>
              {(rows ?? []).filter((row) => row.visits || row.registrations || row.payments || row.earnings).slice(0, 31).map((row) => (
                <tr key={row.period}><td>{row.period}</td><td>{row.visits}</td><td>{row.registrations}</td><td>{row.payments}</td><td>{rub(row.earnings)}</td></tr>
              ))}
              {rows && !rows.some((row) => row.visits || row.registrations || row.payments || row.earnings) && <tr><td colSpan={5}>{uiText('Пока пусто: переходов и оплат по вашим ссылкам ещё не было.')}</td></tr>}
              {!rows && <tr><td colSpan={5}>{uiText('Загружаем…')}</td></tr>}
            </tbody>
          </table>
        </div>

        {payouts && <PayoutBlock payouts={payouts} onChange={setPayouts} />}
      </div>
    </section>
  )
}

function Cell({ label, value, note, good }: { label: string; value: string; note?: string; good?: boolean }) {
  return (
    <div className={`account-cabinet-cell${good ? ' is-good' : ''}`}>
      <span>{uiText(label)}</span>
      <strong>{uiText(value)}</strong>
      {note && <small>{uiText(note)}</small>}
    </div>
  )
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  return (
    <div className="streamer-link">
      <span><small>{uiText(label)}</small><code>{value}</code></span>
      <button className="button ghost small" onClick={copy}><Copy size={13} />{uiText(copied ? 'Скопировано' : 'Скопировать')}</button>
    </div>
  )
}

/** A link for one audience (YouTube, Twitch, Telegram…): the same referral code with a label counted separately. */
function AudienceLinkMaker({ link }: { link: string }) {
  const [label, setLabel] = useState('')
  const clean = label.trim().toLowerCase()
  const valid = CAMPAIGN.test(clean)
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="streamer-auto">
        <Link2 size={14} />
        <span className="dim">{uiText('Ссылка для аудитории:')}</span>
        <input className="input" style={{ width: 180 }} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="youtube" maxLength={32} spellCheck={false} aria-label={uiText('Метка ссылки')} />
      </div>
      {valid && <CopyLine label={`${uiText('Для аудитории')} «${clean}»`} value={`${link}?c=${encodeURIComponent(clean)}`} />}
      {label && !valid && <small className="account-error">{uiText('Метка: латиница, цифры, «_» или «-», до 32 символов')}</small>}
    </div>
  )
}

function PayoutBlock({ payouts, onChange }: { payouts: Payouts; onChange: (value: Payouts) => void }) {
  const [amount, setAmount] = useState('')
  const [details, setDetails] = useState({ phone: '', bank: payouts.details?.bank ?? '', recipient: payouts.details?.recipient ?? '' })
  const [editing, setEditing] = useState(!payouts.details)
  const [interval, setIntervalDays] = useState(String(payouts.autoPayout.intervalDays))
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const limits = payouts.autoPayout.limits
  const pending = payouts.payouts.some((row) => row.status === 'pending')

  const run = (work: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setMessage(null)
    void work().then(async () => {
      onChange(await request<Payouts>('GET', '/v1/accounts/me/payouts'))
      setMessage({ ok: true, text: ok })
    }, (reason: unknown) => setMessage({ ok: false, text: cleanIpcError(reason) })).finally(() => setBusy(false))
  }
  const askPayout = (event: FormEvent) => {
    event.preventDefault()
    const value = Number(amount.replace(',', '.'))
    run(() => request('POST', '/v1/accounts/me/payouts', { amount: value }).then(() => setAmount('')), 'Заявка на выплату отправлена')
  }
  const saveDetails = (event: FormEvent) => {
    event.preventDefault()
    run(() => request('PUT', '/v1/accounts/me/payout-settings', details).then(() => setEditing(false)), 'Реквизиты сохранены')
  }
  const saveAuto = (enabled: boolean) => {
    const days = Math.round(Number(interval))
    run(() => request('PUT', '/v1/accounts/me/payout-settings', { auto: enabled, intervalDays: days }), enabled ? 'Автовыплата включена' : 'Автовыплата выключена')
  }

  return (
    <>
      <h3 className="account-subtitle"><BadgeRussianRuble size={15} />{uiText('Выплаты')}</h3>
      <div className="setting-row">
        <span>
          <strong>{uiText('Реквизиты (СБП)')}</strong>
          <small>{payouts.details ? `${payouts.details.phone} · ${payouts.details.bank} · ${payouts.details.recipient}` : uiText('Не указаны: без них выплата невозможна')}</small>
        </span>
        {!editing && <button className="button ghost small" onClick={() => setEditing(true)}>{uiText('Изменить')}</button>}
      </div>
      {editing && (
        <form className="streamer-payout-form" onSubmit={saveDetails}>
          <label>{uiText('Телефон')}<input className="input" value={details.phone} onChange={(event) => setDetails({ ...details, phone: event.target.value })} placeholder="+7 999 123-45-67" inputMode="tel" autoComplete="off" /></label>
          <label>{uiText('Банк и получатель')}<span style={{ display: 'flex', gap: 6 }}>
            <input className="input" value={details.bank} onChange={(event) => setDetails({ ...details, bank: event.target.value })} placeholder={uiText('Т-Банк')} autoComplete="off" />
            <input className="input" value={details.recipient} onChange={(event) => setDetails({ ...details, recipient: event.target.value })} placeholder={uiText('Имя Фамилия')} autoComplete="off" />
          </span></label>
          <button className="button" type="submit" disabled={busy}><Save size={14} />{uiText('Сохранить')}</button>
        </form>
      )}
      <form className="streamer-payout-form" onSubmit={askPayout}>
        <label>{uiText('Сумма, ₽')}<input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder={String(payouts.available || payouts.minimum)} /></label>
        <small className="dim">{uiText(`Доступно ${rub(payouts.available)}, минимум ${rub(payouts.minimum)}.`)}{pending ? ` ${uiText('Предыдущая заявка ещё ждёт выплаты.')}` : ''}</small>
        <button className="button primary" type="submit" disabled={busy || pending || !payouts.details || !(Number(amount.replace(',', '.')) > 0)}>{busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}{uiText('Получить выплату')}</button>
      </form>
      <div className="setting-row">
        <span>
          <strong>{uiText('Автовыплата')}</strong>
          <small>{uiText(payouts.autoPayout.enabled
            ? payouts.autoPayout.nextAt ? `Весь доступный баланс раз в ${payouts.autoPayout.intervalDays} дн. Следующая: ${day(payouts.autoPayout.nextAt)}` : `Раз в ${payouts.autoPayout.intervalDays} дн., когда указаны реквизиты`
            : 'Выключена: выплату нужно запросить вручную')}</small>
        </span>
        <span className="streamer-auto">
          <label className="dim">{uiText('раз в')} <input className="input" type="number" min={limits.min} max={limits.max} value={interval} onChange={(event) => setIntervalDays(event.target.value)} aria-label={uiText('Интервал, дней')} /> {uiText('дн.')}</label>
          {payouts.autoPayout.enabled && String(payouts.autoPayout.intervalDays) !== interval && <button className="button ghost small" disabled={busy} onClick={() => saveAuto(true)}>{uiText('Сохранить')}</button>}
          <button className={`toggle ${payouts.autoPayout.enabled ? 'on' : ''}`} disabled={busy} aria-pressed={payouts.autoPayout.enabled} aria-label={uiText('Автовыплата')} onClick={() => saveAuto(!payouts.autoPayout.enabled)}><span /></button>
        </span>
      </div>
      {message && <small className={message.ok ? 'dim' : 'account-error'} role="status">{uiText(message.text)}</small>}
      {payouts.payouts.length > 0 && (
        <div className="streamer-table-wrap">
          <table className="streamer-table">
            <thead><tr><th>{uiText('Дата')}</th><th>{uiText('Сумма')}</th><th>{uiText('Статус')}</th><th>{uiText('Куда')}</th></tr></thead>
            <tbody>{payouts.payouts.map((row) => (
              <tr key={row.id}>
                <td>{day(row.createdAt)}{row.auto ? ` · ${uiText('авто')}` : ''}</td>
                <td>{rub(row.amount)}</td>
                <td>{uiText(STATUS[row.status])}{row.comment ? ` · ${row.comment}` : ''}</td>
                <td>{row.destination}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  )
}
