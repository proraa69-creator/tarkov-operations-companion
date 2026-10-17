import { Ban, CalendarMinus, CalendarPlus, ChevronDown, Gamepad2, Globe, LoaderCircle, LogOut, MessageSquare, MonitorSmartphone, Search, ShieldCheck, Trash2, Unlink, XCircle } from 'lucide-react'
import { Fragment, useCallback, useState, type FormEvent } from 'react'
import { CIS_COUNTRIES, countryName } from '../../../../src/shared/countries'
import { api, type AdminDevices, type AdminUser, type AdminUserDetail, type AdminUserFilter, type AdminUserRegion } from '../../api'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Pager } from './AdminPayments'
import { Loading } from './adminShared'
import { WriteToUser } from './WriteToUser'
import { dateOnly, dateTime, failure, formatRub, FRIEND_DISCOUNT, inviterText, numberFormat, PAYMENT_STATUS, PLAN_LABEL, PROVIDER_LABEL, useAdminData, type Failure } from './adminData'

const PAGE = 50
const FILTERS: Array<{ id: AdminUserFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Подписка' },
  { id: 'trial', label: 'Пробный' },
  { id: 'inactive', label: 'Без подписки' },
  { id: 'streamers', label: 'Стримеры' },
  { id: 'blocked', label: 'Заблокированы' },
]
/** Owner billing audiences: Russia, CIS without Russia, and every other country. */
const REGIONS: Array<{ id: AdminUserRegion; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'russia', label: 'Россия' },
  { id: 'cis', label: 'СНГ' },
  { id: 'world', label: 'Мир' },
  { id: 'none', label: 'Не указана' },
]

/** «Казахстан · СНГ» for the owner; Russia is deliberately its own billing region. */
const shownCountry = (code: string, other?: string) => (other ? `«${other}» (вручную)` : countryName(code, 'ru'))
const countryText = (code: string, other?: string) => `${shownCountry(code, other)} · ${code === 'RU' ? 'Россия' : CIS_COUNTRIES.includes(code as never) ? 'СНГ' : 'Мир'}`

function subscriptionText(user: AdminUser) {
  const sub = user.subscription
  if (sub.lifetime) return { label: 'Стример, бесплатно', tone: 'brass' }
  if (sub.status === 'active') return { label: `до ${dateOnly.format(new Date(sub.paidUntil!))}`, tone: 'green' }
  if (sub.status === 'trial') return { label: `пробный до ${dateOnly.format(new Date(sub.trialEndsAt!))}`, tone: 'brass' }
  // The free period waits for the first sign-in in the app (owner, 12.10.2026).
  if (sub.trialPendingDays) return { label: `${sub.trialPendingDays === 1 ? 'сутки' : `${sub.trialPendingDays} дн.`} — ждут входа в приложение`, tone: 'brass' }
  return { label: sub.paidUntil ? `истекла ${dateOnly.format(new Date(sub.paidUntil))}` : 'нет', tone: '' }
}

/** «Пользователи»: search by e-mail, filters, and per-user actions (each one is written to the owner's log). */
export function AdminUsers() {
  // A link from «Платежи» or «Награды за друзей» (/admin?tab=users&q=e-mail) opens the list on that account.
  const [initial] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q')?.trim().slice(0, 254) ?? ''))
  const [search, setSearch] = useState(initial)
  const [q, setQ] = useState(initial)
  const [filter, setFilter] = useState<AdminUserFilter>('all')
  const [region, setRegion] = useState<AdminUserRegion>('all')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const users = useAdminData(useCallback((token: string) => api.adminUsers(token, q, filter, PAGE, page * PAGE, region), [q, filter, page, region]))
  const data = users.data
  // Users per region within the search and the status filter (an older server sends none: the tabs go without numbers).
  const counts = data?.regions

  const submit = (event: FormEvent) => { event.preventDefault(); setQ(search.trim()); setPage(0) }
  const updated = (user: AdminUser) => users.setData((current) => current && { ...current, users: current.users.map((item) => (item.id === user.id ? user : item)) })
  // «Удалить аккаунт»: the card closes and the list is read again (the account is gone from it).
  const deleted = () => { setOpen(null); void users.reload() }

  return (
    <div className="admin-stack">
      <div className="admin-filters">
        <form className="inline-form admin-search" onSubmit={submit} role="search">
          <input className="input" type="search" aria-label="Поиск по e-mail или нику" placeholder="Поиск по e-mail, нику в игре или e-mail пригласившего" title="E-mail пригласившего друга находит и всех, кто пришёл по его коду" value={search} maxLength={254} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="button ghost"><Search aria-hidden="true" />Найти</button>
        </form>
        <div role="group" aria-label="Регион" className="admin-regions">
          {REGIONS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={region === id} aria-label={counts ? `${label}: ${numberFormat.format(counts[id])}` : undefined} className={`button small ${region === id ? 'primary' : 'ghost'}`} onClick={() => { setRegion(id); setPage(0); setOpen(null) }}>
              {label}{counts && <span className="mono admin-region-count">{numberFormat.format(counts[id])}</span>}
            </button>
          ))}
        </div>
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
                    <th scope="col" className="num">Оплаты, ₽</th><th scope="col" title="Последний вход в приложение Raid OS на компьютере">Вход с ПК</th><th scope="col"><span className="visually-hidden">Действия</span></th>
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
                            {/* The nickname the PC app found in the game logs (owner, 13.10.2026: «под каждым аккаунтом … найденный ник»). */}
                            <span className={`admin-nick${user.nickname ? '' : ' dim'}`} title="Ник в Escape from Tarkov из логов игры (приложение для ПК)">
                              <Gamepad2 aria-hidden="true" />{user.nickname ?? 'ник не найден'}
                            </span>
                            <span className="admin-badges">
                              {user.owner && <span className="tag brass admin-mini">владелец</span>}
                              {user.kind === 'streamer' && <span className="tag brass admin-mini">{user.referralCode}</span>}
                              {user.blockedAt && <span className="tag danger admin-mini">заблокирован</span>}
                              {user.autopay?.status === 'active' && <span className="tag green admin-mini">автопродление</span>}
                            </span>
                          </th>
                          {/* The country under the date: a column of its own pushed «Действия» out of the table. */}
                          <td data-label="Регистрация">
                            <span className="admin-registered">
                              <span className="mono">{dateOnly.format(new Date(user.createdAt))}</span>
                              {user.country
                                ? <span className="admin-country" title={countryText(user.country, user.countryOther)}>{shownCountry(user.country, user.countryOther)}</span>
                                : <span className="admin-country dim">страна не указана</span>}
                            </span>
                          </td>
                          <td data-label="Подписка"><span className={`tag ${sub.tone}`}>{sub.label}</span></td>
                          <td data-label="Пришёл от"><CameFrom user={user} /></td>
                          <td className="num mono" data-label="Оплаты, ₽">{user.payments.count ? `${formatRub(user.payments.total)} · ${user.payments.count}` : '—'}</td>
                          <td className="mono" data-label="Вход с ПК" title={user.lastSeenAt ? `Был в сети (сайт, телефон или ПК): ${dateTime.format(new Date(user.lastSeenAt))}` : undefined}>{user.pcSeenAt ? dateTime.format(new Date(user.pcSeenAt)) : '—'}</td>
                          <td className="admin-row-action"><button type="button" className="button ghost small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : user.id)}><ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />{expanded ? 'Скрыть' : 'Действия'}</button></td>
                        </tr>
                        {expanded && <tr className="owner-detail"><td colSpan={7}><UserActions id={user.id} onChange={updated} onDeleted={deleted} /></td></tr>}
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

/**
 * «Пришёл от»: a streamer's code (tag «стример»), or the friend whose code gave the first-month discount (owner,
 * 14.10.2026: «нужно что бы было видно от кого пришел человек по скидке») — the inviter's e-mail and game nickname, tag
 * «друг · скидка» and whether the discount was used.
 */
function CameFrom({ user }: { user: AdminUser }) {
  const inviter = user.invitedBy
  if (inviter) {
    const discount = inviter.discount ? FRIEND_DISCOUNT[inviter.discount] : undefined
    return (
      <span className="admin-came-from">
        <span className={`admin-inviter${inviter.deleted ? ' dim' : ''}`} title={inviter.deleted ? 'Аккаунт пригласившего удалён' : 'Пригласил по своему коду'}>{inviterText(inviter)}</span>
        {inviter.nickname && <span className="admin-nick" title="Ник пригласившего в Escape from Tarkov"><Gamepad2 aria-hidden="true" />{inviter.nickname}</span>}
        <span className="admin-badges"><span className="tag green admin-mini">друг · скидка</span></span>
        {discount && <span className={`admin-discount ${discount.tone}`} title={discount.hint}>{discount.label}</span>}
      </span>
    )
  }
  if (user.referredBy) return <span className="admin-came-from"><span className="mono">{user.referredBy}</span><span className="admin-badges"><span className="tag brass admin-mini">стример</span></span></span>
  return <span className="mono">—</span>
}

function UserActions({ id, onChange, onDeleted }: { id: string; onChange: (user: AdminUser) => void; onDeleted: () => void }) {
  const { token } = useAuth()
  const detail = useAdminData(useCallback((t: string) => api.adminUser(t, id), [id]))
  const [days, setDays] = useState('30')
  const [reason, setReason] = useState('')
  const [takeDays, setTakeDays] = useState('1')
  const [takeReason, setTakeReason] = useState('')
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

  /**
   * «Удалить аккаунт» (owner, 13.10.2026): irreversible, so the owner types the e-mail of the account to confirm; the server
   * erases it like the user's own «Удалить аккаунт» (payments stay, anonymously).
   */
  const remove = async (email: string) => {
    const typed = window.prompt(`Удалить аккаунт ${email} навсегда? Будут стёрты e-mail, ники, прогресс, друзья, отряды, устройства и привязка аккаунта Escape from Tarkov; платежи останутся без имени. Чтобы подтвердить, введите e-mail аккаунта:`)
    if (typed === null) return
    if (typed.trim().toLowerCase() !== email.toLowerCase()) { setError({ message: 'E-mail не совпал — аккаунт не удалён.', offline: false }); setDone(''); return }
    if (!token) return
    setBusy('delete'); setError(null); setDone('')
    try {
      await api.adminDeleteUser(token, id)
      onDeleted()
    } catch (reason) {
      setError(failure(reason))
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

  // «Списать дни» (owner, 11.10.2026: «в разделе пользователи удалять дни подписки»)
  const revoke = (event: FormEvent) => {
    event.preventDefault()
    const n = Number(takeDays)
    if (!Number.isInteger(n) || n < 1 || n > 3650) { setError({ message: 'Число дней: от 1 до 3650.', offline: false }); return }
    if (takeReason.trim().length < 3) { setError({ message: 'Укажите причину (от 3 символов) — она попадёт в журнал.', offline: false }); return }
    if (!window.confirm(`Списать ${n} дн. подписки у ${detail.data?.user.email ?? 'пользователя'}?`)) return
    void run('revoke', (t) => api.adminRevoke(t, id, n, takeReason.trim()), (result) => {
      setTakeReason('')
      const sub = result.user.subscription
      return sub.status === 'active' && sub.paidUntil ? `Подписка теперь до ${dateOnly.format(new Date(sub.paidUntil))}` : 'Оплаченных дней не осталось: подписка закончилась'
    })
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
        <form className="admin-action" onSubmit={revoke}>
          <div className="field-label"><CalendarMinus size={13} aria-hidden="true" />Списать дни подписки</div>
          <div className="inline-form">
            <input className="input mono admin-days" inputMode="numeric" aria-label="Дней списать" value={takeDays} onChange={(e) => setTakeDays(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            <input className="input" aria-label="Причина списания" placeholder="Причина (видна в журнале)" maxLength={200} value={takeReason} onChange={(e) => setTakeReason(e.target.value)} />
          </div>
          <div className="admin-chips">
            {[1, 7, 30].map((n) => <button key={n} type="button" className="button small ghost" onClick={() => setTakeDays(String(n))}>{n} дн.</button>)}
            <button type="submit" className="button small ghost admin-danger" disabled={busy !== null || user.subscription.status !== 'active' || Boolean(user.subscription.lifetime)}>{busy === 'revoke' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CalendarMinus aria-hidden="true" />}Списать</button>
          </div>
          <span className="field-hint">{user.subscription.lifetime ? 'У стримера бессрочный доступ: списывать нечего.' : user.subscription.status !== 'active' ? 'Оплаченных дней нет (пробный период здесь не списывается).' : 'Дни снимаются с конца оплаченного периода, но не раньше сегодняшнего дня.'}</span>
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
            <button type="button" className="button small ghost admin-danger" disabled={busy !== null || Boolean(user.owner)} onClick={() => void remove(user.email)}>{busy === 'delete' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}Удалить аккаунт</button>
            {user.autopay?.status === 'active' && (
              <button type="button" className="button small ghost admin-danger" disabled={busy !== null} onClick={() => { if (window.confirm(`Отменить автопродление (${PROVIDER_LABEL[user.autopay!.provider as keyof typeof PROVIDER_LABEL] ?? user.autopay!.provider}) для ${user.email}? Оплаченный период сохранится.${user.autopay!.provider === 'yookassa' ? '' : ' Сервер с прежним платёжным сервисом больше не связан: остановите подписку и там, вручную.'}`)) void run('autopay', (t) => api.adminCancelAutopay(t, id), () => 'Автопродление отменено') }}><XCircle aria-hidden="true" />Отменить автопродление</button>
            )}
          </div>
          {user.owner && <span className="field-hint">Аккаунт владельца заблокировать и удалить нельзя.</span>}
        </div>
        {/* «Написать» (owner, 15.10.2026): the support chat with this account, as in the owner app's «Чаты». */}
        <div className="admin-action">
          <div className="field-label"><MessageSquare size={13} aria-hidden="true" />Чат с пользователем</div>
          <span className="field-hint">Сообщение придёт в приложение игрока как ответ поддержки.</span>
          <div className="admin-chips"><WriteToUser accountId={id} email={user.email} /></div>
        </div>
        {/* One Escape from Tarkov account — one Raid OS account (owner, 13.10.2026): a player who changed game accounts
            writes to support, the owner frees the old one here. */}
        <div className="admin-action">
          <div className="field-label"><Gamepad2 size={13} aria-hidden="true" />Аккаунт Escape from Tarkov</div>
          <span className="field-hint admin-eft-nick">
            {user.nickname
              ? <>Ник из логов игры: <strong className="mono">{user.nickname}</strong></>
              : 'Ник ещё не найден: его находит приложение для ПК в логах игры.'}
          </span>
          {user.eftAccount
            ? <span className="field-hint">Привязан <span className="mono">{user.eftAccount.masked}</span> с {dateTime.format(new Date(user.eftAccount.boundAt))}. Другие аккаунты Raid OS с ним не откроются, а этот — с другим аккаунтом игры.</span>
            : <span className="field-hint">Не привязан: приложение для Windows привяжет аккаунт игры из логов при входе.</span>}
          {user.eftAccount && (
            <div className="admin-chips">
              <button type="button" className="button small ghost admin-danger" disabled={busy !== null} onClick={() => { if (window.confirm(`Отвязать аккаунт Escape from Tarkov ${user.eftAccount!.masked} от ${user.email}? Приложение привяжет аккаунт игры заново при следующем входе.`)) void run('eft', (t) => api.adminUnbindEft(t, id), () => 'Аккаунт Escape from Tarkov отвязан') }}>{busy === 'eft' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Unlink aria-hidden="true" />}Отвязать</button>
            </div>
          )}
        </div>
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      <div className="admin-user-lists">
        <div>
          <div className="field-label">Последние платежи</div>
          {data.payments.length === 0 ? <span className="field-hint">Платежей нет.</span> : (
            <ul className="admin-list">
              {data.payments.map((item) => <li key={item.id}><span className="mono">{dateTime.format(new Date(item.createdAt))}</span> · {PLAN_LABEL[item.plan] ?? item.plan} · {PROVIDER_LABEL[item.provider] ?? item.provider} · <span className="mono">{formatRub(item.amount)} ₽</span> · <span className={`tag admin-mini ${PAYMENT_STATUS[item.status]?.tone ?? ''}`}>{PAYMENT_STATUS[item.status]?.label ?? item.status}</span></li>)}
            </ul>
          )}
        </div>
        <div>
          <div className="field-label">Выдано и списано вручную</div>
          {data.grants.length === 0 ? <span className="field-hint">Ничего не выдавалось.</span> : (
            <ul className="admin-list">
              {data.grants.map((grant) => <li key={grant.at}><span className="mono">{dateTime.format(new Date(grant.at))}</span> · <span className={grant.days < 0 ? 'admin-danger-text' : undefined}>{grant.days < 0 ? `−${-grant.days}` : `+${grant.days}`} дн.</span> · «{grant.reason}» · {grant.actor}</li>)}
            </ul>
          )}
        </div>
        <UserDevices id={id} lastSeenAt={user.lastSeenAt} />
        <div>
          <div className="field-label"><Globe size={13} aria-hidden="true" />Страна</div>
          {user.country
            ? <span className="field-hint">{countryText(user.country, user.countryOther)} · <span className="mono">{user.country}</span></span>
            : <span className="field-hint">Не указана: аккаунт создан до вопроса о стране — пользователь может указать её в личном кабинете.</span>}
        </div>
      </div>
    </div>
  )
}

const DEVICE_OFF: Record<string, string> = { limit: 'вход на новом устройстве', owner: 'отключено владельцем', user: 'отключено пользователем' }

/** «Устройства»: at most three active per account; a switched-off device is signed out (its app shows why). */
function UserDevices({ id, lastSeenAt }: { id: string; lastSeenAt?: string }) {
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
      {lastSeenAt && <div className="field-hint">Был в сети (сайт, телефон или ПК): <span className="mono">{dateTime.format(new Date(lastSeenAt))}</span></div>}
    </div>
  )
}
