import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, BadgeCheck, Banknote, ChevronDown, Coins, Copy, Link2, Link2Off, LoaderCircle, MousePointerClick, Radio, RotateCcw, Save, UserPlus, Users, UserX, Wallet, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { apiBaseUrl } from '../sync/webAccount'
import { adminApi, type AdminStreamerSettings, type CreatedStreamerInvite, type OwnerPayouts, type OwnerStreamers, type OwnerStreamerStats, type StatsPeriod } from './adminApi'
import { count, dateOnly, dateTime, errorText, money, PLAN_IDS, PLAN_SHORT } from './adminFormat'
import { AdminEmpty, AdminLoading } from './adminShared'

const PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: 'day', label: 'По дням' },
  { id: 'month', label: 'По месяцам' },
  { id: 'year', label: 'По годам' },
]
const PAYOUT_STATUS: Record<string, string> = { pending: 'ждёт', paid: 'выплачено', rejected: 'отклонено' }
const dayLabel = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric', timeZone: 'UTC' })
/** 2026-11-03 → «03.11», 2026-11 → «нояб. 2026 г.», 2026 → «2026». */
const periodLabel = (period: string) => period.length === 10 ? dayLabel.format(new Date(`${period}T12:00:00Z`)) : period.length === 7 ? monthLabel.format(new Date(`${period}-15T12:00:00Z`)) : period

/**
 * «Стримеры» of the admin app (owner, 03.11.2026: «кнопка Стримеры, как вкладка на сайте»): the same numbers, the
 * invitation link, every streamer's statistics, his percent and link switch, and the payout requests.
 */
export function StreamersSheet({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ streamers: OwnerStreamers; settings: AdminStreamerSettings; payouts: OwnerPayouts } | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const reload = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    let active = true
    Promise.all([adminApi.streamers(), adminApi.streamerSettings(), adminApi.payouts()]).then(
      ([streamers, settings, payouts]) => { if (active) { setData({ streamers, settings, payouts }); setError('') } },
      (reason: unknown) => { if (active) setError(errorText(reason)) },
    )
    return () => { active = false }
  }, [version])

  const streamers = data?.streamers.streamers ?? []
  const totals = streamers.reduce((sum, row) => ({
    visits: sum.visits + row.stats.visits,
    registrations: sum.registrations + row.stats.registrations,
    active: sum.active + row.stats.activeSubscriptions,
    revenue: sum.revenue + (row.stats.revenue?.amount ?? 0),
    earnings: sum.earnings + row.stats.earnings.amount,
  }), { visits: 0, registrations: 0, active: 0, revenue: 0, earnings: 0 })
  const invites = data?.streamers.invites ?? []

  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet admin-wide-sheet" role="dialog" aria-modal="true" aria-label={uiText('Стримеры')}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{uiText('Стримеры')}</strong><small>{uiText('Ссылки, статистика, доля и выплаты')}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-sheet-scroll">
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {!data && !error && <AdminLoading />}
        {data && <>
          <div className="admin-overview admin-streamer-cards">
            <article><span><Users size={16} />{uiText('Стримеры')}</span><strong>{count.format(streamers.length)}</strong><small>{uiText(invites.length ? `ещё ${invites.length} приглашений ждут` : 'с кабинетом стримера')}</small></article>
            <article><span><MousePointerClick size={16} />{uiText('Переходы')}</span><strong>{count.format(totals.visits)}</strong><small>{uiText('по всем ссылкам')}</small></article>
            <article><span><UserPlus size={16} />{uiText('Регистрации')}</span><strong>{count.format(totals.registrations)}</strong><small>{uiText(`активных подписок: ${count.format(totals.active)}`)}</small></article>
            <article><span><Wallet size={16} />{uiText('Выручка')}</span><strong>{money(totals.revenue)}</strong><small>{uiText('оплаты приглашённых')}</small></article>
            <article><span><Coins size={16} />{uiText('Начисления')}</span><strong>{money(totals.earnings)}</strong><small>{uiText('доля стримеров')}</small></article>
          </div>
          <InviteForm invites={invites} onCreated={reload} />
          <h2 className="admin-sheet-title">{uiText('Стримеры и их статистика')}</h2>
          {!streamers.length && <AdminEmpty text="Стримеров пока нет — сгенерируйте ссылку выше и отправьте её стримеру." />}
          <div className="admin-streamer-list">
            {streamers.map((row) => {
              const expanded = open === row.code
              const setting = data.settings.streamers.find((item) => item.code === row.code)
              return <article className={`admin-streamer${expanded ? ' is-open' : ''}`} key={row.code}>
                <button type="button" className="admin-streamer-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.code)}>
                  <span className="admin-payment-icon succeeded"><Radio size={18} /></span>
                  <span className="admin-row-copy"><strong className="admin-streamer-code">{row.code}</strong><small>{row.email}</small></span>
                  <ChevronDown size={17} className="admin-streamer-caret" />
                </button>
                <div className="admin-mini-grid admin-streamer-stats">
                  <article><span>{uiText('Переходы')}</span><strong>{count.format(row.stats.visits)}</strong></article>
                  <article><span>{uiText('Регистрации')}</span><strong>{count.format(row.stats.registrations)}</strong></article>
                  <article><span>{uiText('Подписки')}</span><strong>{count.format(row.stats.activeSubscriptions)}</strong></article>
                  <article><span>{uiText('Выручка')}</span><strong>{money(row.stats.revenue?.amount ?? 0)}</strong></article>
                  <article><span>{uiText('Начисления')}</span><strong>{money(row.stats.earnings.amount)}</strong></article>
                  <article><span>{uiText('Доля')}</span><strong>{setting ? `${setting.percent} %` : '—'}</strong></article>
                </div>
                {expanded && <div className="admin-streamer-detail">
                  <StreamerStatsTable code={row.code} />
                  {setting && <StreamerSettingsCard setting={setting} defaultPercent={data.settings.defaultPercent} onChanged={(settings) => { setData((current) => current && { ...current, settings }); reload() }} />}
                </div>}
              </article>
            })}
          </div>
          <PayoutsBlock payouts={data.payouts} onChanged={reload} />
        </>}
      </div>
    </section>
  </div>
}

/** «Пригласить стримера»: a one-time secret link for 7 days; it is shown once. */
function InviteForm({ invites, onCreated }: { invites: OwnerStreamers['invites']; onCreated: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedStreamerInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const submit = async () => {
    const value = code.trim().toUpperCase()
    if (!/^[A-Z0-9_-]{3,24}$/.test(value)) { setError('Код стримера: 3–24 символа, латиница, цифры, «_» или «-».'); return }
    setBusy(true); setError(''); setCreated(null); setCopied(false)
    try { setCreated(await adminApi.createStreamerInvite(value)); setCode(''); onCreated() }
    catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  const link = created ? `${apiBaseUrl()}/streamer/${created.token}` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) } }
  return <div className="admin-grant-card admin-streamer-invite">
    <div className="admin-card-heading"><UserPlus size={18} /><div><strong>{uiText('Пригласить стримера')}</strong><small>{uiText('Одноразовая секретная ссылка на 7 дней: стример открывает её, регистрируется или входит — и у него появляется кабинет стримера с этим кодом и бесплатной подпиской.')}</small></div></div>
    <div className="admin-invite-row">
      <input className="input" aria-label={uiText('Код стримера')} value={code} maxLength={24} spellCheck={false} autoComplete="off" autoCapitalize="characters" placeholder="HUNTER_TV" onChange={(event) => setCode(event.target.value.toUpperCase())} />
      <button type="button" className="button primary" disabled={busy || code.trim().length < 3} onClick={() => void submit()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}{uiText('Ссылка')}</button>
    </div>
    {error && <div className="admin-inline-error">{uiText(error)}</div>}
    {created && <div className="admin-invite-result">
      <small>{uiText(`Ссылка для ${created.code} · одноразовая, действует до ${dateOnly(created.expiresAt)}. Показывается один раз — скопируйте её сейчас.`)}</small>
      <code>{link}</code>
      <button type="button" className="button ghost small" onClick={() => void copy()}><Copy size={14} />{uiText(copied ? 'Скопировано' : 'Скопировать')}</button>
    </div>}
    {invites.length > 0 && <small className="admin-invite-waiting">{uiText(`Неиспользованные приглашения: ${invites.map((item) => `${item.code} (до ${dateOnly(item.expiresAt)})`).join(', ')}`)}</small>}
  </div>
}

/** The streamer's own statistics (as in his cabinet, plus the revenue) by day, month or year. */
function StreamerStatsTable({ code }: { code: string }) {
  const [period, setPeriod] = useState<StatsPeriod>('day')
  const [result, setResult] = useState<{ key: string; data?: OwnerStreamerStats; error?: string } | null>(null)
  const key = `${code}:${period}`
  useEffect(() => {
    let active = true
    adminApi.streamerStats(code, period).then(
      (data) => { if (active) setResult({ key, data }) },
      (reason: unknown) => { if (active) setResult({ key, error: errorText(reason) }) },
    )
    return () => { active = false }
  }, [code, period, key])
  const data = result?.key === key ? result.data ?? null : null
  const error = result?.key === key ? result.error ?? '' : ''
  return <div className="admin-streamer-series">
    <div className="admin-chip-row" role="group" aria-label={uiText('Период статистики')}>
      {PERIODS.map((item) => <button type="button" key={item.id} className={period === item.id ? 'active' : ''} aria-pressed={period === item.id} onClick={() => setPeriod(item.id)}>{uiText(item.label)}</button>)}
    </div>
    {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
    {!data && !error && <AdminLoading />}
    {data && <div className="admin-series-table admin-streamer-table" role="table" aria-label={uiText(`Статистика ${code}`)}>
      <div className="admin-series-row header" role="row"><span role="columnheader">{uiText('Период')}</span><span role="columnheader">{uiText('Перех.')}</span><span role="columnheader">{uiText('Рег.')}</span><span role="columnheader">{uiText('Оплат')}</span><span role="columnheader">{uiText('Выручка')}</span></div>
      {data.rows.map((row) => {
        const months = PLAN_IDS.filter((id) => (row.months[id] ?? 0) > 0).map((id) => `${PLAN_SHORT[id]} ${row.months[id]}`).join(' · ')
        return <div className={`admin-series-row${!row.visits && !row.registrations && !row.payments ? ' is-zero' : ''}`} role="row" key={row.period}>
          <span role="rowheader">{uiText(periodLabel(row.period))}{(months || row.earnings > 0) && <small>{uiText([months, row.earnings > 0 ? `доля ${money(row.earnings)}` : ''].filter(Boolean).join(' · '))}</small>}</span>
          <strong role="cell">{count.format(row.visits)}</strong>
          <strong role="cell">{count.format(row.registrations)}</strong>
          <strong role="cell">{count.format(row.payments)}</strong>
          <strong role="cell" className="is-money">{money(row.revenue ?? 0)}</strong>
        </div>
      })}
    </div>}
    {data && data.campaigns.length > 0 && <small className="admin-streamer-campaigns">{uiText(`Метки ссылок: ${data.campaigns.map((item) => `${item.campaign} — ${count.format(item.visits)}`).join(' · ')}`)}</small>}
  </div>
}

/** «Доля и ссылки стримеров» for one streamer: his own percent, the link switch, «Удалить» (the status of a streamer). */
function StreamerSettingsCard({ setting, defaultPercent, onChanged }: { setting: AdminStreamerSettings['streamers'][number]; defaultPercent: number; onChanged: (settings: AdminStreamerSettings) => void }) {
  const [draft, setDraft] = useState(String(setting.percent))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const value = Number(draft.replace(',', '.'))
  const valid = draft.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100
  const apply = async (action: () => Promise<AdminStreamerSettings>) => {
    setBusy(true); setError('')
    try { onChanged(await action()) } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const disable = () => { if (window.confirm(uiText(`Отключить ссылку ${setting.code}? Новые переходы и регистрации по ней не будут засчитываться стримеру.`))) void apply(() => adminApi.setStreamerLink(setting.code, false)) }
  const revoke = () => { if (window.confirm(uiText(`Снять статус стримера с ${setting.email}? Кабинет стримера и бесплатная подписка исчезнут, ссылка ${setting.code} перестанет работать. Код останется за аккаунтом, история оплат сохранится.`))) void apply(() => adminApi.revokeStreamer(setting.code)) }
  return <div className="admin-streamer-settings">
    <label><span>{uiText('Доля, %')}</span>
      <span className="admin-invite-row">
        <input className="input" inputMode="decimal" aria-label={uiText(`Доля ${setting.code}, %`)} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="button" className="button ghost small" disabled={busy || !valid || value === setting.percent} onClick={() => void apply(() => adminApi.setStreamerPercent(setting.code, value))}>{busy ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{uiText('Сохранить')}</button>
        {setting.custom && <button type="button" className="button ghost small" disabled={busy} onClick={() => { setDraft(String(defaultPercent)); void apply(() => adminApi.setStreamerPercent(setting.code, null)) }}><RotateCcw size={14} />{uiText('Общая')}</button>}
      </span>
      <small>{uiText(setting.custom ? `своя доля; общая — ${defaultPercent} %` : `общая доля ${defaultPercent} %`)}</small>
    </label>
    <div className="admin-streamer-actions">
      {setting.linkEnabled
        ? <button type="button" className="button ghost small" disabled={busy} onClick={disable}><Link2Off size={14} />{uiText('Отключить ссылку')}</button>
        : <><span className="admin-link-off">{uiText(`ссылка отключена${setting.linkDisabledAt ? ` ${dateOnly(setting.linkDisabledAt)}` : ''}`)}</span><button type="button" className="button ghost small" disabled={busy} onClick={() => void apply(() => adminApi.setStreamerLink(setting.code, true))}><Link2 size={14} />{uiText('Включить')}</button></>}
      <button type="button" className="button ghost small admin-danger-text" disabled={busy} onClick={revoke}><UserX size={14} />{uiText('Удалить стримера')}</button>
    </div>
    {error && <div className="admin-inline-error">{uiText(error)}</div>}
    <small className="admin-streamer-note">{uiText('Своя доля действует только для новых оплат. Отключённая ссылка не засчитывает новых переходов и регистраций; уже приглашённые остаются за стримером.')}</small>
  </div>
}

/** «Выплаты стримерам»: requests with «Выплачено» / «Отклонить», and how often a streamer may choose an automatic payout. */
function PayoutsBlock({ payouts, onChanged }: { payouts: OwnerPayouts; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [limits, setLimits] = useState({ min: String(payouts.limits.min), max: String(payouts.limits.max) })
  const [limitsMessage, setLimitsMessage] = useState('')
  const pending = payouts.payouts.filter((item) => item.status === 'pending')
  const decide = async (id: string, status: 'paid' | 'rejected') => {
    setBusy(id); setError('')
    try { await adminApi.decidePayout(id, status, comments[id]?.trim() || undefined); onChanged() } catch (reason) { setError(errorText(reason)) } finally { setBusy(null) }
  }
  const saveLimits = async () => {
    setLimitsMessage('')
    try {
      const result = await adminApi.setPayoutLimits(Number(limits.min), Number(limits.max))
      setLimits({ min: String(result.limits.min), max: String(result.limits.max) })
      setLimitsMessage('Сохранено')
    } catch (reason) { setLimitsMessage(errorText(reason)) }
  }
  return <section className="admin-payouts">
    <h2 className="admin-sheet-title"><Banknote size={15} />{uiText('Выплаты стримерам')}{pending.length > 0 && <span className="admin-unread">{uiText(`ждут: ${pending.length}`)}</span>}</h2>
    {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
    {!payouts.payouts.length && <AdminEmpty text="Заявок на выплату пока нет." />}
    {payouts.payouts.map((item) => <article className={`admin-payout${item.status === 'pending' ? ' is-pending' : ''}`} key={item.id}>
      <div className="admin-payout-main">
        <strong>{money(item.amount)}</strong>
        <span><b className="admin-streamer-code">{item.code}</b> · {item.email}</span>
        <small>{uiText(`СБП ${item.phone} · ${item.bank} · ${item.recipient}`)}</small>
        <small>{dateTime(item.createdAt)}{uiText(item.auto ? ' · автовыплата' : ' · по запросу')}{item.comment ? ` · ${item.comment}` : ''}</small>
      </div>
      {item.status === 'pending' ? <div className="admin-payout-actions">
        <input className="input" aria-label={uiText('Комментарий к выплате')} placeholder={uiText('Комментарий или № чека (необязательно)')} maxLength={200} value={comments[item.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [item.id]: event.target.value }))} />
        <div>
          <button type="button" className="button primary small" disabled={busy === item.id} onClick={() => void decide(item.id, 'paid')}><BadgeCheck size={14} />{uiText('Выплачено')}</button>
          <button type="button" className="button ghost small" disabled={busy === item.id} onClick={() => void decide(item.id, 'rejected')}><X size={14} />{uiText('Отклонить')}</button>
        </div>
      </div> : <span className={`admin-payout-status is-${item.status}`}>{uiText(PAYOUT_STATUS[item.status] ?? item.status)}</span>}
    </article>)}
    <div className="admin-payout-limits">
      <span>{uiText('Стримеры выбирают автовыплату раз в')}</span>
      <input className="input" inputMode="numeric" aria-label={uiText('Минимум дней')} value={limits.min} onChange={(event) => setLimits({ ...limits, min: event.target.value })} />
      <span>–</span>
      <input className="input" inputMode="numeric" aria-label={uiText('Максимум дней')} value={limits.max} onChange={(event) => setLimits({ ...limits, max: event.target.value })} />
      <span>{uiText('дней')}</span>
      <button type="button" className="button ghost small" onClick={() => void saveLimits()}><Save size={14} />{uiText('Сохранить')}</button>
      {limitsMessage && <small>{uiText(limitsMessage)}</small>}
    </div>
    <small className="admin-streamer-note">{uiText('Деньги сервер сам не переводит: переведите сумму по СБП и нажмите «Выплачено».')}</small>
  </section>
}
