import { Ban, CalendarPlus, ChevronDown, LoaderCircle, LogOut, MonitorSmartphone, Search, ShieldCheck, XCircle } from 'lucide-react'
import { Fragment, useCallback, useState, type FormEvent } from 'react'
import { api, type AdminDevices, type AdminUser, type AdminUserDetail, type AdminUserFilter } from '../../api'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Pager } from './AdminPayments'
import { Loading } from './adminShared'
import { dateOnly, dateTime, failure, formatRub, numberFormat, PAYMENT_STATUS, PLAN_LABEL, PROVIDER_LABEL, useAdminData, type Failure } from './adminData'

const PAGE = 50
const FILTERS: Array<{ id: AdminUserFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Подписка' },
  { id: 'trial', label: 'Пробный' },
  { id: 'inactive', label: 'Без подписки' },
  { id: 'streamers', label: 'Стримеры' },
  { id: 'blocked', label: 'Заблокированы' },
]

function subscriptionText(user: AdminUser) {
  const sub = user.subscription
  if (sub.lifetime) return { label: 'Стример, бесплатно', tone: 'brass' }
  if (sub.status === 'active') return { label: `до ${dateOnly.format(new Date(sub.paidUntil!))}`, tone: 'green' }
  if (sub.status === 'trial') return { label: `пробный до ${dateOnly.format(new Date(sub.trialEndsAt!))}`, tone: 'brass' }
  return { label: sub.paidUntil ? `истекла ${dateOnly.format(new Date(sub.paidUntil))}` : 'нет', tone: '' }
}

/** «Пользователи»: search by e-mail, filters, and per-user actions (each one is written to the owner's log). */
export function AdminUsers() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<AdminUserFilter>('all')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const users = useAdminData(useCallback((token: string) => api.adminUsers(token, q, filter, PAGE, page * PAGE), [q, filter, page]))
  const data = users.data

  const submit = (event: FormEvent) => { event.preventDefault(); setQ(search.trim()); setPage(0) }
  const updated = (user: AdminUser) => users.setData((current) => current && { ...current, users: current.users.map((item) => (item.id === user.id ? user : item)) })

  return (
    <div className="admin-stack">
      <div className="admin-filters">
        <form className="inline-form admin-search" onSubmit={submit} role="search">
          <input className="input" type="search" aria-label="Поиск по e-mail" placeholder="Поиск по e-mail" value={search} maxLength={254} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="button ghost"><Search aria-hidden="true" />Найти</button>
        </form>
        <div role="group" aria-label="Фильтр" className="admin-chips">
          {FILTERS.map(({ id, label }) => <button key={id} type="button" aria-pressed={filter === id} className={`button small ${filter === id ? 'primary' : 'ghost'}`} onClick={() => { setFilter(id); setPage(0); setOpen(null) }}>{label}</button>)}
        </div>
      </div>
      {users.error && <Notice tone={users.error.offline ? 'offline' : 'error'}>{users.error.message}</Notice>}
      {!data && !users.error && <Loading text="Загружаем пользователей…" />}
      {data && (
        <>
          <div className="admin-totals"><span>Найдено: <strong className="mono">{numberFormat.format(data.total)}</strong></span></div>
          {data.users.length === 0 ? <div className="muted admin-empty">Никого не нашли.</div> : (
            <div className="table-scroll admin-users-wrap">
              <table className="pay-table admin-table admin-users">
                <thead>
                  <tr>
                    <th scope="col">E-mail</th><th scope="col">Регистрация</th><th scope="col">Подписка</th><th scope="col">Пришёл от</th>
                    <th scope="col" className="num">Оплаты, ₽</th><th scope="col">Был в сети</th><th scope="col"><span className="visually-hidden">Действия</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((user) => {
                    const expanded = open === user.id
                    const sub = subscriptionText(user)
                    return (
                      <Fragment key={user.id}>
                        <tr className={expanded ? 'is-open' : undefined}>
                          <th scope="row" className="admin-email">
                            {user.email}
                            <span className="admin-badges">
                              {user.owner && <span className="tag brass admin-mini">владелец</span>}
                              {user.kind === 'streamer' && <span className="tag brass admin-mini">{user.referralCode}</span>}
                              {user.blockedAt && <span className="tag danger admin-mini">заблокирован</span>}
                              {user.autopay?.status === 'active' && <span className="tag green admin-mini">автопродление</span>}
                            </span>
                          </th>
                          <td className="mono" data-label="Регистрация">{dateOnly.format(new Date(user.createdAt))}</td>
                          <td data-label="Подписка"><span className={`tag ${sub.tone}`}>{sub.label}</span></td>
                          <td className="mono" data-label="Пришёл от">{user.referredBy ?? '—'}</td>
                          <td className="num mono" data-label="Оплаты, ₽">{user.payments.count ? `${formatRub(user.payments.total)} · ${user.payments.count}` : '—'}</td>
                          <td className="mono" data-label="Был в сети">{user.lastSeenAt ? dateTime.format(new Date(user.lastSeenAt)) : '—'}</td>
                          <td className="admin-row-action"><button type="button" className="button ghost small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : user.id)}><ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />{expanded ? 'Скрыть' : 'Действия'}</button></td>
                        </tr>
                        {expanded && <tr className="owner-detail"><td colSpan={7}><UserActions id={user.id} onChange={updated} /></td></tr>}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} total={data.total} size={PAGE} onPage={(next) => { setPage(next); setOpen(null) }} />
        </>
      )}
    </div>
  )
}

function UserActions({ id, onChange }: { id: string; onChange: (user: AdminUser) => void }) {
  const { token } = useAuth()
  const detail = useAdminData(useCallback((t: string) => api.adminUser(t, id), [id]))
  const [days, setDays] = useState('30')
  const [reason, setReason] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [done, setDone] = useState('')

  const run = async (name: string, action: (t: string) => Promise<AdminUserDetail>, message: (result: AdminUserDetail) => string) => {
    if (!token) return
    setBusy(name); setError(null); setDone('')
    try {
      const result = await action(token)
      detail.setData(result)
      onChange(result.user)
      setDone(message(result))
    } catch (reason) {
      setError(failure(reason))
    } finally {
      setBusy(null)
    }
  }

  const grant = (event: FormEvent) => {
    event.preventDefault()
    const n = Number(days)
    if (!Number.isInteger(n) || n < 1 || n > 3650) { setError({ message: 'Число дней: от 1 до 3650.', offline: false }); return }
    if (reason.trim().length < 3) { setError({ message: 'Укажите причину (от 3 символов) — она попадёт в журнал.', offline: false }); return }
    void run('grant', (t) => api.adminGrant(t, id, n, reason.trim()), (result) => { setReason(''); return `Подписка до ${dateOnly.format(new Date(result.user.subscription.paidUntil!))}` })
  }

  const data = detail.data
  if (!data) return detail.error ? <Notice tone="error">{detail.error.message}</Notice> : <Loading />
  const user = data.user
  return (
    <div className="admin-user">
      <div className="admin-user-grid">
        <form className="admin-action" onSubmit={grant}>
          <div className="field-label"><CalendarPlus size={13} aria-hidden="true" />Выдать / продлить подписку</div>
          <div className="inline-form">
            <input className="input mono admin-days" inputMode="numeric" aria-label="Дней" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            <input className="input" aria-label="Причина" placeholder="Причина (видна в журнале)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="admin-chips">
            {[7, 30, 90, 365].map((n) => <button key={n} type="button" className="button small ghost" onClick={() => setDays(String(n))}>{n} дн.</button>)}
            <button type="submit" className="button small primary" disabled={busy !== null}>{busy === 'grant' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}Выдать</button>
          </div>
          <span className="field-hint">Дни добавляются к концу оплаченного периода (или с сегодня). Это не выручка: в статистике оплат не появится.</span>
        </form>
        <div className="admin-action">
          <div className="field-label"><ShieldCheck size={13} aria-hidden="true" />Доступ</div>
          {user.blockedAt
            ? <span className="field-hint">Вход заблокирован с {dateTime.format(new Date(user.blockedAt))}.</span>
            : <input className="input" aria-label="Причина блокировки" placeholder="Причина блокировки (необязательно)" maxLength={200} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />}
          <div className="admin-chips">
            {user.blockedAt
              ? <button type="button" className="button small ghost" disabled={busy !== null} onClick={() => void run('block', (t) => api.adminBlock(t, id, false), () => 'Вход разблокирован')}><ShieldCheck aria-hidden="true" />Разблокировать вход</button>
              : <button type="button" className="button small ghost admin-danger" disabled={busy !== null || Boolean(user.owner)} onClick={() => { if (window.confirm(`Заблокировать вход для ${user.email}? Все его сессии будут сброшены.`)) void run('block', (t) => api.adminBlock(t, id, true, blockReason.trim() || undefined), () => 'Вход заблокирован, сессии сброшены') }}><Ban aria-hidden="true" />Заблокировать вход</button>}
            <button type="button" className="button small ghost" disabled={busy !== null} onClick={() => void run('sessions', (t) => api.adminRevokeSessions(t, id), (result) => `Сброшено сессий: ${result.revoked ?? 0}`)}><LogOut aria-hidden="true" />Сбросить сессии</button>
            {user.autopay?.status === 'active' && (
              <button type="button" className="button small ghost admin-danger" disabled={busy !== null} onClick={() => { if (window.confirm(`Отменить автопродление (${PROVIDER_LABEL[user.autopay!.provider as 'yookassa' | 'lava'] ?? user.autopay!.provider}) для ${user.email}? Оплаченный период сохранится.`)) void run('autopay', (t) => api.adminCancelAutopay(t, id), () => 'Автопродление отменено') }}><XCircle aria-hidden="true" />Отменить автопродление</button>
            )}
          </div>
          {user.owner && <span className="field-hint">Аккаунт владельца заблокировать нельзя.</span>}
        </div>
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      <div className="admin-user-lists">
        <div>
          <div className="field-label">Последние платежи</div>
          {data.payments.length === 0 ? <span className="field-hint">Платежей нет.</span> : (
            <ul className="admin-list">
              {data.payments.map((item) => <li key={item.id}><span className="mono">{dateTime.format(new Date(item.createdAt))}</span> · {PLAN_LABEL[item.plan]} · {PROVIDER_LABEL[item.provider]} · <span className="mono">{formatRub(item.amount)} ₽</span> · <span className={`tag admin-mini ${PAYMENT_STATUS[item.status].tone}`}>{PAYMENT_STATUS[item.status].label}</span></li>)}
            </ul>
          )}
        </div>
        <div>
          <div className="field-label">Выдано вручную</div>
          {data.grants.length === 0 ? <span className="field-hint">Ничего не выдавалось.</span> : (
            <ul className="admin-list">
              {data.grants.map((grant) => <li key={grant.at}><span className="mono">{dateTime.format(new Date(grant.at))}</span> · +{grant.days} дн. · «{grant.reason}» · {grant.actor}</li>)}
            </ul>
          )}
        </div>
        <UserDevices id={id} />
      </div>
    </div>
  )
}

const DEVICE_OFF: Record<string, string> = { limit: 'вход на новом устройстве', owner: 'отключено владельцем', user: 'отключено пользователем' }

/** «Устройства»: at most three active per account; a switched-off device is signed out (its app shows why). */
function UserDevices({ id }: { id: string }) {
  const { token } = useAuth()
  const devices = useAdminData(useCallback((t: string) => api.adminDevices(t, id), [id]))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<Failure | null>(null)
  const revoke = async (deviceId: string, name: string) => {
    if (!token || !window.confirm(`Отключить устройство «${name}»? Приложение на нём выйдет из аккаунта.`)) return
    setBusy(deviceId); setError(null)
    try { devices.setData(await api.adminRevokeDevice(token, id, deviceId)) } catch (reason) { setError(failure(reason)) } finally { setBusy('') }
  }
  const data: AdminDevices | null | undefined = devices.data
  return (
    <div>
      <div className="field-label"><MonitorSmartphone size={13} aria-hidden="true" />Устройства{data ? ` (активных не больше ${data.limit})` : ''}</div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {!data ? (devices.error ? <span className="field-hint">{devices.error.message}</span> : <Loading />) : data.devices.length === 0 ? <span className="field-hint">Приложение ещё не входило в аккаунт.</span> : (
        <ul className="admin-list">
          {data.devices.map((device) => (
            <li key={device.id}>
              {device.name} · <span className="mono">{dateTime.format(new Date(device.lastSeenAt))}</span> · {device.active
                ? <button type="button" className="button small ghost admin-danger" disabled={busy !== ''} onClick={() => void revoke(device.id, device.name)}>{busy === device.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <LogOut aria-hidden="true" />}Отключить</button>
                : <span className="tag admin-mini">{DEVICE_OFF[device.revokedReason ?? ''] ?? 'отключено'}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
