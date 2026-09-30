import { BadgeCheck, Banknote, ChevronDown, Coins, Crown, LoaderCircle, MousePointerClick, RefreshCw, Save, UserPlus, Users, Wallet, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type CampaignStats, type CreatedStreamerInvite, type OwnerPayouts, type OwnerStreamers, type StatsPeriod } from '../api'
import { useAuth } from '../auth'
import { CopyButton } from './CopyButton'
import { Notice } from './Notice'
import { formatRub, ReferralStatsTable } from './ReferralStatsTable'
import { PAYOUT_STATUS } from './StreamerPayouts'
import '../extras.css'

const numberFormat = new Intl.NumberFormat('ru-RU')
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

type Failure = { message: string; offline: boolean }
const failure = (reason: unknown): Failure => ({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })

/**
 * Owner section of the cabinet (only for accounts the server marks `owner`; every request is checked on the server):
 * all streamers with the same statistics they see (plus revenue), «Сгенерировать ссылку для стримера» and payouts.
 */
export function OwnerAdmin() {
  const auth = useAuth()
  const token = auth.token
  const [data, setData] = useState<OwnerStreamers | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!token) return Promise.resolve()
    return api.ownerStreamers(token).then((next) => { setData(next); setError(null) }, (reason: unknown) => setError(failure(reason)))
  }, [token])
  useEffect(() => { void load() }, [load])

  const totals = (data?.streamers ?? []).reduce((sum, row) => ({
    visits: sum.visits + row.stats.visits,
    registrations: sum.registrations + row.stats.registrations,
    active: sum.active + row.stats.activeSubscriptions,
    revenue: sum.revenue + (row.stats.revenue?.amount ?? 0),
    earnings: sum.earnings + row.stats.earnings.amount,
  }), { visits: 0, registrations: 0, active: 0, revenue: 0, earnings: 0 })
  const cards = [
    { icon: Users, label: 'Стримеры', value: numberFormat.format(data?.streamers.length ?? 0), meta: data?.invites.length ? `ещё ${data.invites.length} приглашений ждут` : 'с кабинетом стримера' },
    { icon: MousePointerClick, label: 'Переходы', value: numberFormat.format(totals.visits), meta: 'по всем ссылкам' },
    { icon: UserPlus, label: 'Регистрации', value: numberFormat.format(totals.registrations), meta: `активных подписок: ${numberFormat.format(totals.active)}` },
    { icon: Wallet, label: 'Выручка', value: `${formatRub(totals.revenue)} ₽`, meta: 'оплаты приглашённых' },
    { icon: Coins, label: 'Начисления', value: `${formatRub(totals.earnings)} ₽`, meta: 'доля стримеров' },
  ]

  return (
    <section className="panel owner-panel" aria-labelledby="owner-title">
      <div className="panel-header">
        <div className="panel-title" id="owner-title"><Crown aria-hidden="true" />Раздел владельца</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="tag brass">Владелец</span>
          <button type="button" className="button ghost small" disabled={busy} onClick={() => { setBusy(true); void load().finally(() => setBusy(false)) }}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Обновить
          </button>
        </div>
      </div>
      <div className="panel-body owner-body">
        {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
        <div className="stat-grid owner-stats">
          {cards.map(({ icon: Icon, label, value, meta }) => (
            <div key={label} className="stat-card">
              <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
              <div className="stat-value mono">{value}</div>
              <div className="stat-meta">{meta}</div>
            </div>
          ))}
        </div>
        <StreamerInviteForm onCreated={() => void load()} invites={data?.invites ?? []} />
        <StreamersTable data={data} />
        <OwnerPayoutsList />
      </div>
    </section>
  )
}

function StreamerInviteForm({ onCreated, invites }: { onCreated: () => void; invites: Array<{ code: string; expiresAt: string }> }) {
  const auth = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedStreamerInvite | null>(null)
  const [error, setError] = useState<Failure | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = code.trim().toUpperCase()
    if (!/^[A-Z0-9_-]{3,24}$/.test(value)) { setError({ message: 'Код стримера: 3–24 символа, латиница, цифры, «_» или «-».', offline: false }); return }
    if (!auth.token) return
    setBusy(true)
    setError(null)
    setCreated(null)
    try {
      setCreated(await api.ownerCreateStreamerInvite(auth.token, value))
      setCode('')
      onCreated()
    } catch (reason) {
      setError(failure(reason))
    } finally {
      setBusy(false)
    }
  }

  const link = created ? `${window.location.origin}/streamer/${created.token}` : ''
  return (
    <div className="owner-block">
      <div className="field-label">Пригласить стримера</div>
      <form className="inline-form" onSubmit={submit}>
        <input className="input code" aria-label="Код стримера" value={code} maxLength={24} spellCheck={false} autoComplete="off" placeholder="КОД СТРИМЕРА, например HUNTER_TV" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button type="submit" className="button primary" disabled={busy || code.trim().length < 3}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}Сгенерировать ссылку для стримера</button>
      </form>
      <span className="field-hint">Одноразовая секретная ссылка на 7 дней: стример открывает её, регистрируется или входит — и у него появляется кабинет стримера с этим кодом и бесплатной подпиской.</span>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {created && (
        <div className="invite-result">
          <span className="field-hint">Ссылка для <strong className="mono" style={{ color: 'var(--brass-strong)' }}>{created.code}</strong> · одноразовая, действует до {dateFormat.format(new Date(created.expiresAt))}. Показывается один раз — скопируйте её сейчас.</span>
          <div className="copy-row"><code title={link}>{link}</code><CopyButton value={link} /></div>
        </div>
      )}
      {invites.length > 0 && <span className="field-hint">Неиспользованные приглашения: {invites.map((item) => `${item.code} (до ${dateFormat.format(new Date(item.expiresAt))})`).join(', ')}</span>}
    </div>
  )
}

function StreamersTable({ data }: { data: OwnerStreamers | null }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!data) return <div className="muted" style={{ fontSize: 14 }}><LoaderCircle className="spinner" size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Загружаем стримеров…</div>
  return (
    <div className="owner-block">
      <div className="field-label">Стримеры и их статистика</div>
      {data.streamers.length === 0 ? <div className="muted" style={{ fontSize: 14 }}>Стримеров пока нет — сгенерируйте ссылку выше и отправьте её стримеру.</div> : (
        <div className="table-scroll">
          <table className="pay-table owner-table">
            <thead>
              <tr>
                <th scope="col">Стример</th><th scope="col" className="num">Переходы</th><th scope="col" className="num">Регистрации</th><th scope="col" className="num">Подписки</th>
                <th scope="col" className="num">Выручка, ₽</th><th scope="col" className="num">Начисления, ₽</th><th scope="col"><span className="visually-hidden">Подробнее</span></th>
              </tr>
            </thead>
            <tbody>
              {data.streamers.map((row) => {
                const expanded = open === row.code
                return (
                  <Fragment key={row.code}>
                    <tr className={expanded ? 'is-open' : undefined}>
                      <th scope="row"><span className="mono" style={{ color: 'var(--brass-strong)' }}>{row.code}</span><span className="owner-email">{row.email}</span></th>
                      <td className="num mono">{numberFormat.format(row.stats.visits)}</td>
                      <td className="num mono">{numberFormat.format(row.stats.registrations)}</td>
                      <td className="num mono">{numberFormat.format(row.stats.activeSubscriptions)}</td>
                      <td className="num mono">{formatRub(row.stats.revenue?.amount ?? 0)}</td>
                      <td className="num mono accent">{formatRub(row.stats.earnings.amount)}</td>
                      <td><button type="button" className="button ghost small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.code)}><ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />{expanded ? 'Скрыть' : 'Статистика'}</button></td>
                    </tr>
                    {expanded && <tr className="owner-detail"><td colSpan={7}><StreamerDetail code={row.code} /></td></tr>}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StreamerDetail({ code }: { code: string }) {
  const auth = useAuth()
  const token = auth.token
  const [campaigns, setCampaigns] = useState<CampaignStats[] | null>(null)
  const load = useCallback(async (period: StatsPeriod) => {
    if (!token) throw new ApiError(401, 'Требуется вход в аккаунт')
    const result = await api.ownerStreamerStats(token, code, period)
    setCampaigns(result.campaigns)
    return result
  }, [token, code])
  return (
    <div className="owner-detail-body">
      <ReferralStatsTable load={load} showRevenue title={`Статистика ${code} — как в его кабинете, плюс выручка`} />
      {campaigns && campaigns.length > 0 && (
        <div className="field-hint">Метки ссылок: {campaigns.map((item) => `${item.campaign} — ${numberFormat.format(item.visits)}`).join(' · ')}</div>
      )}
    </div>
  )
}

function OwnerPayoutsList() {
  const auth = useAuth()
  const token = auth.token
  const [data, setData] = useState<OwnerPayouts | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [limits, setLimits] = useState<{ min: string; max: string } | null>(null)
  const [limitsMessage, setLimitsMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    if (!token) return
    api.ownerPayouts(token).then((next) => { setData(next); setError(null); setLimits((current) => current ?? { min: String(next.limits.min), max: String(next.limits.max) }) }, (reason: unknown) => setError(failure(reason)))
  }, [token])
  useEffect(() => { load() }, [load])

  async function decide(id: string, status: 'paid' | 'rejected') {
    if (!token) return
    setBusy(id)
    try {
      await api.ownerDecidePayout(token, id, status, comments[id]?.trim() || undefined)
      load()
    } catch (reason) {
      setError(failure(reason))
    } finally {
      setBusy(null)
    }
  }

  async function saveLimits(event: FormEvent) {
    event.preventDefault()
    if (!token || !limits) return
    try {
      const result = await api.ownerSetPayoutLimits(token, Number(limits.min), Number(limits.max))
      setLimits({ min: String(result.limits.min), max: String(result.limits.max) })
      setLimitsMessage({ ok: true, text: 'Сохранено' })
    } catch (reason) {
      setLimitsMessage({ ok: false, text: errorMessage(reason) })
    }
  }

  const pending = data?.payouts.filter((item) => item.status === 'pending') ?? []
  return (
    <div className="owner-block">
      <div className="field-label"><Banknote size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Выплаты стримерам {pending.length > 0 && <span className="tag brass" style={{ marginLeft: 6 }}>ждут: {pending.length}</span>}</div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {data && data.payouts.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Заявок на выплату пока нет.</div>}
      {data && data.payouts.length > 0 && (
        <div className="payout-list">
          {data.payouts.map((item) => {
            const status = PAYOUT_STATUS[item.status]
            return (
              <div key={item.id} className={`payout-item${item.status === 'pending' ? ' is-pending' : ''}`}>
                <div className="payout-item-main">
                  <div className="payout-amount mono">{formatRub(item.amount)} ₽</div>
                  <div className="payout-who"><span className="mono" style={{ color: 'var(--brass-strong)' }}>{item.code}</span> · {item.email}</div>
                  <div className="payout-to">СБП <span className="mono" style={{ userSelect: 'all' }}>{item.phone}</span> · {item.bank} · {item.recipient}</div>
                  <div className="dim" style={{ fontSize: 12 }}>{shortDate.format(new Date(item.createdAt))}{item.auto ? ' · автовыплата' : ' · по запросу'}{item.comment ? ` · ${item.comment}` : ''}</div>
                </div>
                {item.status === 'pending' ? (
                  <div className="payout-item-actions">
                    <input className="input" aria-label="Комментарий к выплате" placeholder="Комментарий или № чека (необязательно)" maxLength={200} value={comments[item.id] ?? ''} onChange={(e) => setComments((c) => ({ ...c, [item.id]: e.target.value }))} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="button primary small" disabled={busy === item.id} onClick={() => void decide(item.id, 'paid')}><BadgeCheck aria-hidden="true" />Выплачено</button>
                      <button type="button" className="button ghost small" disabled={busy === item.id} onClick={() => void decide(item.id, 'rejected')}><X aria-hidden="true" />Отклонить</button>
                    </div>
                  </div>
                ) : <span className={`tag ${status.tone}`}>{status.label}</span>}
              </div>
            )
          })}
        </div>
      )}
      {limits && (
        <form className="limits-form" onSubmit={saveLimits}>
          <span className="field-hint">Стримеры выбирают автовыплату раз в</span>
          <input className="input mono" inputMode="numeric" aria-label="Минимум дней" value={limits.min} onChange={(e) => setLimits({ ...limits, min: e.target.value })} />
          <span className="field-hint">–</span>
          <input className="input mono" inputMode="numeric" aria-label="Максимум дней" value={limits.max} onChange={(e) => setLimits({ ...limits, max: e.target.value })} />
          <span className="field-hint">дней</span>
          <button type="submit" className="button ghost small"><Save aria-hidden="true" />Сохранить</button>
          {limitsMessage && <span className="field-hint" style={{ color: limitsMessage.ok ? 'var(--success)' : 'var(--danger)' }}>{limitsMessage.text}</span>}
        </form>
      )}
      <span className="field-hint">Деньги сервер сам не переводит: переведите сумму по СБП и нажмите «Выплачено». Автоматический перевод через ЮKassa «Выплаты» потребует отдельного договора — его можно подключить позже.</span>
    </div>
  )
}
