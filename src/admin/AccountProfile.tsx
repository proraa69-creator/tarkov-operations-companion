import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowLeft, CreditCard, Gamepad2, Globe, LoaderCircle, MessagesSquare, Monitor, RefreshCw, Smartphone, UserRound, Users, WifiOff } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { countryName } from '../shared/countries'
import { OWNER_TIME_ZONE } from '../shared/ownerTime'
import type { AdminAccountProfile, AdminDeviceKind, AdminPayment, PlanId } from './adminApi'
import { initial } from './adminFormat'
import './accountProfile.css'

/**
 * «Посмотреть профиль» (owner, 24.11.2026: «у меня открывается… посмотреть профиль, то есть я захожу и могу всю информацию
 * о нем посмотреть. Когда зарегистрирован, когда первая оплата, сколько оплат, какие тарифы, ну, по месяцам какие, потом,
 * когда был последний раз, заходил в приложение. Видна почта, ник в игре. Короче, всю информацию, которая у нас есть,
 * выдавай мне, аккуратно все там распредели… Если есть информация о том, привел ли он людей, сколько он привел, сколько
 * оплатил… Заходил ли в приложение на телефоне»): one account from GET /v1/accounts/me/admin/users/:id/profile in four
 * parts — «Аккаунт», «Оплаты», «Активность», «Рефералы». What the server does not have reads «нет данных», never a guess.
 * The owner app shows it as its own tab of «Админ панель» (pages/AdminPanelPage.tsx), the phone admin app as a full
 * screen sheet (AdminMobilePage.tsx). Times are the owner's (Bangkok), as everywhere in the admin panels.
 */
export interface AccountProfileProps {
  accountId: string
  load: (accountId: string) => Promise<AdminAccountProfile>
  onBack: () => void
  /** The back button's words: «К чату» from a conversation. */
  backLabel?: { ru: string; en: string }
  onOpenChat?: (accountId: string) => void
  /** The name the chat shows, until the profile comes. */
  name?: string
  /** 'sheet': the phone's full screen sheet, scrolled inside; 'page': a section of the owner app's page. */
  variant: 'page' | 'sheet'
}

type Tr = (ru: string, en: string) => string
type Profile = AdminAccountProfile
type SectionId = 'account' | 'payments' | 'activity' | 'referrals'

const PLAN: Record<PlanId, [string, string]> = { '1m': ['1 мес.', '1 mo'], '3m': ['3 мес.', '3 mo'], '6m': ['6 мес.', '6 mo'], '12m': ['12 мес.', '12 mo'] }
const PLAN_IDS: PlanId[] = ['1m', '3m', '6m', '12m']
const STATUS: Record<AdminPayment['status'], [string, string]> = { succeeded: ['оплачено', 'paid'], pending: ['ожидает', 'pending'], canceled: ['отменено', 'canceled'], refunded: ['возврат', 'refunded'] }
const PROVIDER: Record<string, [string, string]> = { yookassa: ['ЮKassa', 'YooKassa'], bezebee: ['BZB', 'BZB'], archive: ['архив', 'archive'], lava: ['архив', 'archive'] }
const METHOD: Record<string, [string, string]> = {
  sbp: ['СБП', 'SBP'], bank_card: ['карта', 'card'], sberbank: ['SberPay', 'SberPay'], tinkoff_bank: ['T-Pay', 'T-Pay'], yoo_money: ['ЮMoney', 'YooMoney'],
  sbp_bezebee: ['BZB', 'BZB'], bezebee: ['BZB', 'BZB'],
}
const SOURCE: Record<NonNullable<Profile['subscription']['source']>, [string, string]> = {
  money: ['оплаченная', 'paid'], grant: ['выдана владельцем', 'granted by the owner'], friend: ['награда за друзей', 'friend reward'],
  lifetime: ['навсегда', 'lifetime'], trial: ['пробный период', 'free trial'],
}
const DEVICE: Record<AdminDeviceKind, [string, string]> = { pc: ['ПК', 'PC'], android: ['Android', 'Android'], ios: ['iPhone', 'iPhone'], browser: ['Браузер', 'Browser'], other: ['Другое', 'Other'] }

/** The owner's dates, money and «N дней назад» in the chosen language. */
function formats(locale: 'ru' | 'en') {
  const tag = locale === 'en' ? 'en-GB' : 'ru-RU'
  const dateTime = new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: OWNER_TIME_ZONE })
  const date = new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: OWNER_TIME_ZONE })
  const month = new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' })
  const number = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 })
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' })
  const valid = (iso?: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso) : null)
  return {
    dateTime: (iso?: string) => { const value = valid(iso); return value ? dateTime.format(value) : '' },
    date: (iso?: string) => { const value = valid(iso); return value ? date.format(value) : '' },
    /** «Ноябрь 2026» of «2026-11». */
    month: (key: string) => {
      const name = month.format(new Date(`${key}-15T00:00:00Z`))
      return `${name.slice(0, 1).toUpperCase()}${name.slice(1)} ${key.slice(0, 4)}`
    },
    money: (rubles: number) => `${number.format(rubles)} ₽`,
    count: (value: number) => number.format(value),
    ago: (iso: string | undefined, now: number) => {
      const value = valid(iso)
      if (!value) return ''
      const seconds = Math.round((now - value.getTime()) / 1000)
      if (Math.abs(seconds) < 60) return locale === 'en' ? 'just now' : 'только что'
      const minutes = Math.round(seconds / 60)
      if (Math.abs(minutes) < 60) return relative.format(-minutes, 'minute')
      const hours = Math.round(minutes / 60)
      if (Math.abs(hours) < 24) return relative.format(-hours, 'hour')
      const days = Math.round(hours / 24)
      if (Math.abs(days) < 31) return relative.format(-days, 'day')
      const months = Math.round(days / 30.44)
      if (Math.abs(months) < 12) return relative.format(-months, 'month')
      return relative.format(-Math.round(days / 365.25), 'year')
    },
  }
}
type Formats = ReturnType<typeof formats>

/** Missing lists and parts filled with empties: an older server's answer never breaks the card. */
function complete(raw: Profile, at: number): Profile {
  const plans = Object.fromEntries(PLAN_IDS.map((plan) => [plan, raw.payments?.plans?.[plan] ?? { count: 0, revenue: 0 }])) as Profile['payments']['plans']
  return {
    ...raw,
    // «Сейчас» of every «N минут назад»: the server's moment, else the answer's.
    generatedAt: raw.generatedAt && Number.isFinite(Date.parse(raw.generatedAt)) ? raw.generatedAt : new Date(at).toISOString(),
    subscription: raw.subscription ?? { status: 'inactive' },
    autopay: raw.autopay ?? null,
    origin: raw.origin ?? {},
    payments: {
      ...raw.payments,
      count: raw.payments?.count ?? 0, total: raw.payments?.total ?? 0, refunded: raw.payments?.refunded ?? { count: 0, total: 0 }, more: Boolean(raw.payments?.more),
      months: raw.payments?.months ?? [], list: raw.payments?.list ?? [], plans,
    },
    grants: raw.grants ?? [],
    activity: { ...raw.activity, phone: raw.activity?.phone ?? { used: false, android: false, ios: false }, devices: raw.activity?.devices ?? [] },
    referrals: {
      ...raw.referrals,
      invited: raw.referrals?.invited ?? 0, deleted: raw.referrals?.deleted ?? 0, paid: raw.referrals?.paid ?? 0, revenue: raw.referrals?.revenue ?? 0, more: Boolean(raw.referrals?.more),
      friends: raw.referrals?.friends ?? [],
      rewards: raw.referrals?.rewards ?? { granted: 0, pending: 0, review: 0, canceled: 0, days: { granted: 0, pending: 0, review: 0 } },
    },
  }
}

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason ?? ''))

export function AccountProfile({ accountId, load, onBack, backLabel, onOpenChat, name, variant }: AccountProfileProps) {
  const { locale } = useLocale()
  const tr = useCallback<Tr>((ru, en) => (locale === 'en' ? en : ru), [locale])
  const f = useMemo(() => formats(locale === 'en' ? 'en' : 'ru'), [locale])
  const [attempt, setAttempt] = useState(0)
  const key = `${accountId}:${attempt}`
  const [answer, setAnswer] = useState<{ key: string; accountId: string; data?: Profile; error?: string; at: number } | null>(null)
  useEffect(() => {
    let alive = true
    load(accountId).then(
      (data) => { if (alive) setAnswer({ key, accountId, data: complete(data, Date.now()), at: Date.now() }) },
      (reason) => { if (alive) setAnswer((current) => ({ key, accountId, ...(current?.accountId === accountId && current.data ? { data: current.data } : {}), error: messageOf(reason) || 'Сервер недоступен', at: Date.now() })) },
    )
    return () => { alive = false }
  }, [accountId, attempt, key, load])
  const loading = answer?.key !== key
  const data = answer?.accountId === accountId ? answer.data : undefined
  const error = answer?.key === key ? answer.error : undefined
  const scroller = useRef<HTMLDivElement>(null)
  const cards = useRef<Partial<Record<SectionId, HTMLElement | null>>>({})
  const jump = (id: SectionId) => cards.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const account = data?.account
  const title = account?.nickname || account?.email || (account?.deleted ? tr('Аккаунт удалён', 'Deleted account') : name || tr('Пользователь', 'User'))
  const subtitle = account ? (account.deleted ? tr('аккаунт удалён', 'account deleted') : account.nickname ? account.email ?? '' : '') : tr('Загружаем профиль…', 'Loading the profile…')
  const back = backLabel ? tr(backLabel.ru, backLabel.en) : tr('Назад', 'Back')
  const sections: Array<{ id: SectionId; label: string }> = [
    { id: 'account', label: tr('Аккаунт', 'Account') }, { id: 'payments', label: tr('Оплаты', 'Payments') },
    { id: 'activity', label: tr('Активность', 'Activity') }, { id: 'referrals', label: tr('Рефералы', 'Referrals') },
  ]

  return (
    <section className={`account-profile is-${variant}`} aria-label={tr(`Профиль: ${title}`, `Profile: ${title}`)} aria-busy={loading}>
      <header className="account-profile-head">
        <button type="button" className={variant === 'sheet' ? 'icon-button account-profile-back' : 'button small ghost account-profile-back'} onClick={onBack} aria-label={back}>
          <ArrowLeft size={variant === 'sheet' ? 18 : 15} aria-hidden="true" />{variant === 'page' && <span>{back}</span>}
        </button>
        <div className="account-profile-who">
          <span className="account-profile-avatar" aria-hidden="true">{initial(title)}</span>
          <div><h2>{title}</h2>{subtitle && <small>{subtitle}</small>}</div>
        </div>
        <div className="account-profile-actions">
          {onOpenChat && !account?.deleted && <button type="button" className={variant === 'sheet' ? 'icon-button' : 'button small'} onClick={() => onOpenChat(accountId)} aria-label={tr('Открыть чат', 'Open chat')} title={tr('Открыть чат', 'Open chat')}><MessagesSquare size={variant === 'sheet' ? 18 : 14} aria-hidden="true" />{variant === 'page' && tr('Открыть чат', 'Open chat')}</button>}
          <button type="button" className="icon-button" onClick={() => setAttempt((value) => value + 1)} disabled={loading} aria-label={tr('Обновить', 'Refresh')} title={tr('Обновить', 'Refresh')}><RefreshCw size={16} className={loading ? 'spin' : undefined} aria-hidden="true" /></button>
        </div>
        {data && <ProfileTags data={data} tr={tr} f={f} />}
      </header>
      <div ref={scroller} className="account-profile-scroll">
        {data && <nav className="account-profile-jump" aria-label={tr('Разделы профиля', 'Profile sections')}>{sections.map((section) => <button key={section.id} type="button" onClick={() => jump(section.id)}>{section.label}</button>)}</nav>}
        {error && <div className="account-profile-error" role="alert"><WifiOff size={16} aria-hidden="true" /><span>{profileError(error, tr)}</span><button type="button" className="button small" onClick={() => setAttempt((value) => value + 1)}>{tr('Повторить', 'Retry')}</button></div>}
        {!data && loading && <div className="account-profile-loading" role="status"><LoaderCircle size={22} className="spin" aria-hidden="true" /><span>{tr('Загружаем профиль…', 'Loading the profile…')}</span></div>}
        {data && (
          <div className="account-profile-columns">
            <div className="account-profile-column">
              <AccountCard data={data} tr={tr} f={f} locale={locale === 'en' ? 'en' : 'ru'} cardRef={(element) => { cards.current.account = element }} />
              <ActivityCard data={data} tr={tr} f={f} cardRef={(element) => { cards.current.activity = element }} />
            </div>
            <div className="account-profile-column">
              <PaymentsCard data={data} tr={tr} f={f} open={variant === 'page'} cardRef={(element) => { cards.current.payments = element }} />
              <ReferralsCard data={data} tr={tr} f={f} cardRef={(element) => { cards.current.referrals = element }} />
            </div>
          </div>
        )}
        {data && <p className="account-profile-foot">{tr(`Данные на ${f.dateTime(data.generatedAt)} (время Бангкока). ID: ${data.account.id}`, `Data as of ${f.dateTime(data.generatedAt)} (Bangkok time). ID: ${data.account.id}`)}</p>}
      </div>
    </section>
  )
}

/** The server's refusals in plain words: an older server without the route, no network. */
function profileError(error: string, tr: Tr) {
  if (/Не найдено|Not found|404/i.test(error)) return tr('Сервер пока не отдаёт профиль: нужна новая версия сервера.', 'The server does not give profiles yet: it needs the new server version.')
  if (/Пользователь не найден/.test(error)) return tr('Аккаунт не найден.', 'Account not found.')
  if (/недоступен|unavailable|Нет связи|fetch/i.test(error)) return tr('Нет связи с сервером.', 'No connection to the server.')
  return tr(error, error)
}

function ProfileTags({ data, tr, f }: { data: Profile; tr: Tr; f: Formats }) {
  const { subscription: sub, account, activity } = data
  const tone = sub.lifetime || sub.status === 'active' ? 'good' : sub.status === 'trial' ? 'warn' : 'dim'
  const online = activity.online
  const now = online && (online.pc || online.phone)
    ? [online.pc ? tr('ПК', 'PC') : '', online.phone ? (online.platform === 'ios' ? 'iPhone' : online.platform === 'android' ? 'Android' : tr('телефон', 'phone')) : ''].filter(Boolean).join(' + ')
    : ''
  return (
    <div className="account-profile-tags">
      <span className={`account-profile-tag is-${tone}`}>{subscriptionText(sub, tr, f)}</span>
      {now && <span className="account-profile-tag is-online"><span className="account-profile-dot" aria-hidden="true" />{tr(`Сейчас в приложении: ${now}`, `In the app now: ${now}`)}</span>}
      {account.blockedAt && <span className="account-profile-tag is-bad">{tr(`Заблокирован ${f.date(account.blockedAt)}`, `Blocked ${f.date(account.blockedAt)}`)}</span>}
      {account.deletionAt && <span className="account-profile-tag is-bad">{tr(`Удалится ${f.date(account.deletionAt)}`, `Deleted on ${f.date(account.deletionAt)}`)}</span>}
      {account.kind === 'streamer' && <span className="account-profile-tag">{tr('Стример', 'Streamer')}</span>}
      {account.owner && <span className="account-profile-tag">{tr('Владелец', 'Owner')}</span>}
    </div>
  )
}

function subscriptionText(sub: Profile['subscription'], tr: Tr, f: Formats) {
  if (sub.lifetime) return tr('Подписка навсегда', 'Lifetime subscription')
  if (sub.status === 'active') return tr(`Подписка до ${f.date(sub.paidUntil)}`, `Subscribed until ${f.date(sub.paidUntil)}`)
  if (sub.status === 'trial' && sub.trialRaidDays) return tr(`Пробная ждёт первого рейда (${sub.trialRaidDays} дн.)`, `Trial waits for the first raid (${sub.trialRaidDays} d)`)
  if (sub.status === 'trial') return tr(`Пробная до ${f.date(sub.trialEndsAt)}`, `Trial until ${f.date(sub.trialEndsAt)}`)
  if (sub.trialPendingDays) return tr(`Пробная ждёт первого входа (${sub.trialPendingDays} дн.)`, `Trial waits for the first sign-in (${sub.trialPendingDays} d)`)
  if (sub.paidUntil) return tr(`Подписка кончилась ${f.date(sub.paidUntil)}`, `Subscription ended ${f.date(sub.paidUntil)}`)
  return tr('Без подписки', 'No subscription')
}

/** «нет данных»: the server has nothing for it. */
function None({ tr, text }: { tr: Tr; text?: string }) {
  return <span className="account-profile-none">{text ?? tr('нет данных', 'no data')}</span>
}

function Fact({ label, children, note, icon }: { label: string; children: ReactNode; note?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="account-profile-fact">
      <dt>{icon}{label}</dt>
      <dd><span>{children}</span>{note ? <small>{note}</small> : null}</dd>
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className="account-profile-tile"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>
}

function Card({ id, icon, title, children, cardRef }: { id: SectionId; icon: ReactNode; title: string; children: ReactNode; cardRef: (element: HTMLElement | null) => void }) {
  return (
    <section ref={cardRef} className={`account-profile-card is-${id}`} aria-labelledby={`account-profile-${id}`}>
      <h3 id={`account-profile-${id}`}>{icon}{title}</h3>
      {children}
    </section>
  )
}

function AccountCard({ data, tr, f, locale, cardRef }: { data: Profile; tr: Tr; f: Formats; locale: 'ru' | 'en'; cardRef: (element: HTMLElement | null) => void }) {
  const { account, origin } = data
  const now = Date.parse(data.generatedAt)
  const inviter = origin.invitedBy
  const inviterName = inviter ? (inviter.deleted ? tr('удалённый аккаунт', 'a deleted account') : [inviter.nickname, inviter.email].filter(Boolean).join(' · ')) : ''
  const discount = inviter?.discount === 'used' ? tr('скидкой друга воспользовался', 'used the friend discount')
    : inviter?.discount === 'unused' ? tr('скидка друга ещё не использована', 'friend discount not used yet')
      : inviter?.discount === 'lost' ? tr('первая оплата была без скидки', 'paid first without the discount') : ''
  const came = [
    inviter ? tr(`по приглашению друга: ${inviterName}`, `invited by a friend: ${inviterName}`) : '',
    origin.streamerCode ? tr(`по коду стримера ${origin.streamerCode}`, `with streamer code ${origin.streamerCode}`) : '',
    origin.streamerLink ? tr(`по ссылке стримера ${origin.streamerLink}`, `from streamer link ${origin.streamerLink}`) : '',
    origin.ad ? tr(`реклама: ${origin.ad.label}${origin.ad.campaign ? ` (${origin.ad.campaign})` : ''}`, `ad: ${origin.ad.label}${origin.ad.campaign ? ` (${origin.ad.campaign})` : ''}`) : '',
  ].filter(Boolean)
  const country = account.country ? (account.country === 'XX' && account.countryOther ? account.countryOther : countryName(account.country, locale)) : ''
  return (
    <Card id="account" icon={<UserRound size={16} aria-hidden="true" />} title={tr('Аккаунт', 'Account')} cardRef={cardRef}>
      <dl className="account-profile-facts">
        <Fact label={tr('Почта', 'E-mail')} note={account.deleted ? tr(`аккаунт удалён ${f.date(account.deletedAt)}`, `account deleted ${f.date(account.deletedAt)}`) : account.emailVerifiedAt ? tr(`подтверждена ${f.date(account.emailVerifiedAt)}`, `confirmed ${f.date(account.emailVerifiedAt)}`) : tr('не подтверждена', 'not confirmed')}>
          {account.email ? <span className="account-profile-wrap">{account.email}</span> : <None tr={tr} />}
        </Fact>
        <Fact label={tr('Ник в игре', 'In-game nickname')} icon={<Gamepad2 size={13} aria-hidden="true" />}>{account.nickname ?? <None tr={tr} />}</Fact>
        <Fact label={tr('Аккаунт Escape from Tarkov', 'Escape from Tarkov account')} note={account.eftAccount ? tr(`привязан ${f.date(account.eftAccount.boundAt)}`, `bound ${f.date(account.eftAccount.boundAt)}`) : undefined}>
          {account.eftAccount ? <span className="account-profile-mono">{account.eftAccount.masked}</span> : <None tr={tr} text={tr('не привязан', 'not bound')} />}
        </Fact>
        <Fact label={tr('Регистрация', 'Registered')} note={f.ago(account.createdAt, now)}>{f.dateTime(account.createdAt) || <None tr={tr} />}</Fact>
        <Fact label={tr('Страна', 'Country')} icon={<Globe size={13} aria-hidden="true" />}>{country || <None tr={tr} text={tr('не указана', 'not set')} />}</Fact>
        <Fact label={tr('Телефон', 'Phone')}>{account.phone ? <span className="account-profile-mono">{account.phone}</span> : <None tr={tr} text={tr('не привязан', 'not linked')} />}</Fact>
        <Fact label={tr('Откуда пришёл', 'Came from')} note={discount || undefined}>
          {came.length ? came.join('; ') : <None tr={tr} text={tr('сам, без кода и рекламы', 'on their own, no code or ad')} />}
        </Fact>
      </dl>
    </Card>
  )
}

function PaymentsCard({ data, tr, f, open, cardRef }: { data: Profile; tr: Tr; f: Formats; open: boolean; cardRef: (element: HTMLElement | null) => void }) {
  const { payments, subscription: sub, autopay, grants } = data
  const plan = (id: PlanId) => tr(PLAN[id]?.[0] ?? id, PLAN[id]?.[1] ?? id)
  const usedPlans = PLAN_IDS.filter((id) => payments.plans[id].count > 0)
  return (
    <Card id="payments" icon={<CreditCard size={16} aria-hidden="true" />} title={tr('Оплаты', 'Payments')} cardRef={cardRef}>
      <div className="account-profile-tiles">
        <Tile label={tr('Оплат', 'Payments')} value={f.count(payments.count)} note={payments.count ? f.money(payments.total) : tr('не платил', 'never paid')} />
        <Tile label={tr('Первая оплата', 'First payment')} value={payments.first ? f.date(payments.first.at) : '—'} note={payments.first ? `${plan(payments.first.plan)} · ${f.money(payments.first.amount)}${payments.first.refunded ? ` · ${tr('возврат', 'refunded')}` : ''}` : tr('нет', 'none')} />
        <Tile label={tr('Последняя', 'Latest')} value={payments.last ? f.date(payments.last.at) : '—'} note={payments.last ? `${plan(payments.last.plan)} · ${f.money(payments.last.amount)}` : tr('нет', 'none')} />
      </div>
      <dl className="account-profile-facts">
        <Fact label={tr('Подписка', 'Subscription')} note={sub.source ? tr(SOURCE[sub.source][0], SOURCE[sub.source][1]) : undefined}>{subscriptionText(sub, tr, f)}</Fact>
        <Fact label={tr('Автоплатёж', 'Auto-renewal')}>
          {autopay ? `${tr(PROVIDER[autopay.provider]?.[0] ?? autopay.provider, PROVIDER[autopay.provider]?.[1] ?? autopay.provider)} · ${PLAN[autopay.plan as PlanId] ? plan(autopay.plan as PlanId) : autopay.plan} · ${autopay.status === 'active' ? tr('включён', 'on') : tr('выключен', 'off')}` : <None tr={tr} text={tr('нет', 'none')} />}
        </Fact>
        {payments.refunded.count > 0 && <Fact label={tr('Возвраты', 'Refunds')}>{tr(`${payments.refunded.count} на ${f.money(payments.refunded.total)}`, `${payments.refunded.count} for ${f.money(payments.refunded.total)}`)}</Fact>}
        <Fact label={tr('Тарифы за всё время', 'Plans, all time')}>
          {usedPlans.length ? <span className="account-profile-chips">{usedPlans.map((id) => <span key={id} className="account-profile-chip">{plan(id)} × {payments.plans[id].count}<small>{f.money(payments.plans[id].revenue)}</small></span>)}</span> : <None tr={tr} text={tr('оплат не было', 'no payments')} />}
        </Fact>
      </dl>
      <h4>{tr('По месяцам', 'By month')}</h4>
      {payments.months.length ? (
        <div className="account-profile-table" role="table" aria-label={tr('Оплаты по месяцам', 'Payments by month')}>
          <div role="row" className="account-profile-row is-head">
            <span role="columnheader">{tr('Месяц', 'Month')}</span><span role="columnheader">{tr('Тарифы', 'Plans')}</span><span role="columnheader">{tr('Сумма', 'Sum')}</span>
          </div>
          {payments.months.map((month) => (
            <div role="row" className="account-profile-row" key={month.month}>
              <span role="cell">{f.month(month.month)}</span>
              <span role="cell" className="account-profile-chips">{PLAN_IDS.filter((id) => month.plans[id]).map((id) => <span key={id} className="account-profile-chip">{plan(id)}{(month.plans[id] ?? 0) > 1 ? ` × ${month.plans[id]}` : ''}</span>)}</span>
              <span role="cell" className="account-profile-num">{f.money(month.revenue)}</span>
            </div>
          ))}
        </div>
      ) : <p className="account-profile-empty">{tr('Оплат не было.', 'No payments.')}</p>}
      <details className="account-profile-more" open={open && payments.list.length > 0 && payments.list.length <= 12}>
        <summary>{tr(`Все платежи (${payments.list.length}${payments.more ? '+' : ''})`, `All payments (${payments.list.length}${payments.more ? '+' : ''})`)}</summary>
        {payments.list.length ? (
          <ul className="account-profile-list">
            {payments.list.map((payment) => {
              const method = METHOD[payment.method ?? '']
              const details = [
                plan(payment.plan),
                tr(PROVIDER[payment.provider]?.[0] ?? payment.provider, PROVIDER[payment.provider]?.[1] ?? payment.provider),
                method ? tr(method[0], method[1]) : '',
                payment.renewal ? tr('автопродление', 'renewal') : '',
                payment.friendDiscount ? tr(`скидка друга −${payment.friendDiscount.percent} %`, `friend discount −${payment.friendDiscount.percent}%`) : '',
                payment.referralCode ? tr(`код ${payment.referralCode}`, `code ${payment.referralCode}`) : '',
              ].filter(Boolean).join(' · ')
              return (
                <li key={payment.id} className={`account-profile-item is-${payment.status}`}>
                  <span><strong>{f.dateTime(payment.paidAt ?? payment.createdAt)}</strong><small>{details}</small></span>
                  <span className="account-profile-side"><strong>{f.money(payment.amount)}</strong><small className={`account-profile-status is-${payment.status}`}>{tr(STATUS[payment.status][0], STATUS[payment.status][1])}</small></span>
                </li>
              )
            })}
          </ul>
        ) : <p className="account-profile-empty">{tr('Платежей нет.', 'No payments.')}</p>}
      </details>
      <details className="account-profile-more">
        <summary>{tr(`Начисления владельца (${grants.length})`, `Owner's grants (${grants.length})`)}</summary>
        {grants.length ? (
          <ul className="account-profile-list">
            {grants.map((grant, index) => (
              <li key={`${grant.at}-${index}`} className="account-profile-item">
                <span><strong>{f.dateTime(grant.at)}</strong><small>{grant.reason}</small></span>
                <span className="account-profile-side"><strong>{grant.days > 0 ? '+' : ''}{tr(`${grant.days} дн.`, `${grant.days} d`)}</strong><small>{tr(`до ${f.date(grant.paidUntil)}`, `until ${f.date(grant.paidUntil)}`)}</small></span>
              </li>
            ))}
          </ul>
        ) : <p className="account-profile-empty">{tr('Владелец дней не начислял.', 'The owner granted no days.')}</p>}
      </details>
    </Card>
  )
}

function ActivityCard({ data, tr, f, cardRef }: { data: Profile; tr: Tr; f: Formats; cardRef: (element: HTMLElement | null) => void }) {
  const { activity } = data
  const now = Date.parse(data.generatedAt)
  const seen = (iso: string | undefined, never: string) => (iso ? <>{f.dateTime(iso)}</> : <None tr={tr} text={never} />)
  const phones = [activity.phone.android ? 'Android' : '', activity.phone.ios ? 'iPhone' : ''].filter(Boolean).join(', ')
  const online = activity.online
  const icon = (kind: AdminDeviceKind) => (kind === 'pc' ? <Monitor size={16} aria-hidden="true" /> : kind === 'android' || kind === 'ios' ? <Smartphone size={16} aria-hidden="true" /> : <Globe size={16} aria-hidden="true" />)
  return (
    <Card id="activity" icon={<Activity size={16} aria-hidden="true" />} title={tr('Активность', 'Activity')} cardRef={cardRef}>
      <div className="account-profile-tiles">
        <Tile label={tr('Последний раз в сети', 'Last seen')} value={activity.lastSeenAt ? f.ago(activity.lastSeenAt, now) : '—'} note={activity.lastSeenAt ? f.dateTime(activity.lastSeenAt) : tr('нет данных', 'no data')} />
        <Tile label={tr('С телефона', 'From a phone')} value={activity.phone.used ? tr('Да', 'Yes') : tr('Нет', 'No')} note={activity.phone.used ? phones : tr('не заходил', 'never signed in')} />
      </div>
      <dl className="account-profile-facts">
        <Fact label={tr('Приложение на ПК', 'PC app')} icon={<Monitor size={13} aria-hidden="true" />} note={activity.pcSeenAt ? f.ago(activity.pcSeenAt, now) : undefined}>{seen(activity.pcSeenAt, tr('не заходил', 'never'))}</Fact>
        <Fact label={tr('Приложение на телефоне', 'Phone app')} icon={<Smartphone size={13} aria-hidden="true" />} note={activity.phoneSeenAt ? `${phones} · ${f.ago(activity.phoneSeenAt, now)}` : undefined}>{seen(activity.phoneSeenAt, tr('не заходил', 'never'))}</Fact>
        <Fact label={tr('Версия в браузере', 'Browser version')} icon={<Globe size={13} aria-hidden="true" />} note={activity.browserSeenAt ? f.ago(activity.browserSeenAt, now) : undefined}>{seen(activity.browserSeenAt, tr('не заходил', 'never'))}</Fact>
        <Fact label={tr('Первый вход в приложение', 'First app sign-in')}>{seen(activity.firstAppAt, tr('нет данных', 'no data'))}</Fact>
        <Fact label={tr('Сейчас', 'Now')}>
          {online ? (online.pc || online.phone
            ? <span className="account-profile-online"><span className="account-profile-dot" aria-hidden="true" />{[online.pc ? tr('в приложении на ПК', 'in the PC app') : '', online.phone ? tr(`в приложении на телефоне${online.platform ? ` (${online.platform === 'ios' ? 'iPhone' : 'Android'})` : ''}`, `in the phone app${online.platform ? ` (${online.platform === 'ios' ? 'iPhone' : 'Android'})` : ''}`) : ''].filter(Boolean).join(', ')}</span>
            : tr('не в приложении', 'not in the app')) : <None tr={tr} />}
        </Fact>
      </dl>
      <h4>{tr(`Устройства (${activity.devices.length})`, `Devices (${activity.devices.length})`)}</h4>
      {activity.devices.length ? (
        <ul className="account-profile-list">
          {activity.devices.map((device, index) => (
            <li key={`${device.name}-${device.firstAt}-${index}`} className={`account-profile-item account-profile-device${device.active ? '' : ' is-off'}`}>
              <span className="account-profile-device-icon">{icon(device.kind)}</span>
              <span><strong>{tr(DEVICE[device.kind][0], DEVICE[device.kind][1])}<em>{device.name}</em></strong><small>{tr(`первый вход ${f.date(device.firstAt)}`, `first sign-in ${f.date(device.firstAt)}`)}{device.revokedAt ? tr(` · отключено ${f.date(device.revokedAt)}`, ` · signed out ${f.date(device.revokedAt)}`) : ''}</small></span>
              <span className="account-profile-side"><strong>{f.ago(device.lastAt, now)}</strong><small>{f.dateTime(device.lastAt)}</small></span>
            </li>
          ))}
        </ul>
      ) : <p className="account-profile-empty">{tr('В приложения не входил.', 'Never signed in to an app.')}</p>}
    </Card>
  )
}

function ReferralsCard({ data, tr, f, cardRef }: { data: Profile; tr: Tr; f: Formats; cardRef: (element: HTMLElement | null) => void }) {
  const { referrals } = data
  const plan = (id: PlanId) => tr(PLAN[id]?.[0] ?? id, PLAN[id]?.[1] ?? id)
  const rewards = referrals.rewards
  const rewardText = [
    rewards.days.granted ? tr(`выдано ${rewards.days.granted} дн.`, `${rewards.days.granted} d granted`) : '',
    rewards.days.pending ? tr(`ждут ${rewards.days.pending} дн.`, `${rewards.days.pending} d waiting`) : '',
    rewards.days.review ? tr(`на проверке ${rewards.days.review} дн.`, `${rewards.days.review} d in review`) : '',
    rewards.lifetime ? tr('доступ навсегда', 'lifetime access') : '',
  ].filter(Boolean).join(' · ')
  return (
    <Card id="referrals" icon={<Users size={16} aria-hidden="true" />} title={tr('Рефералы', 'Referrals')} cardRef={cardRef}>
      <div className="account-profile-tiles">
        <Tile label={tr('Привёл', 'Brought')} value={f.count(referrals.invited)} note={referrals.deleted ? tr(`удалено ${referrals.deleted}`, `${referrals.deleted} deleted`) : tr('по своему коду', 'with their code')} />
        <Tile label={tr('Оплатили', 'Paid')} value={f.count(referrals.paid)} note={referrals.invited ? tr(`из ${referrals.invited}`, `of ${referrals.invited}`) : '—'} />
        <Tile label={tr('Их оплаты', 'Their payments')} value={f.money(referrals.revenue)} />
      </div>
      <dl className="account-profile-facts">
        <Fact label={tr('Свой код «Пригласи друга»', '“Invite a friend” code')}>{referrals.inviteCode ? <span className="account-profile-mono">{referrals.inviteCode}</span> : <None tr={tr} text={tr('не создан', 'not created')} />}</Fact>
        <Fact label={tr('Награды за друзей', 'Friend rewards')}>{rewardText || <None tr={tr} text={tr('нет', 'none')} />}</Fact>
      </dl>
      {referrals.streamer && (
        <div className="account-profile-streamer">
          <h4>{tr(`Код стримера ${referrals.streamer.code}`, `Streamer code ${referrals.streamer.code}`)}</h4>
          <div className="account-profile-tiles">
            <Tile label={tr('Регистраций', 'Sign-ups')} value={f.count(referrals.streamer.registrations)} />
            <Tile label={tr('Оплатили', 'Payers')} value={f.count(referrals.streamer.payers)} note={tr(`оплат: ${referrals.streamer.payments}`, `payments: ${referrals.streamer.payments}`)} />
            <Tile label={tr('Выручка', 'Revenue')} value={f.money(referrals.streamer.revenue)} note={tr(`доля стримера ${f.money(referrals.streamer.earnings)}`, `streamer share ${f.money(referrals.streamer.earnings)}`)} />
          </div>
        </div>
      )}
      <h4>{tr('Приглашённые друзья', 'Invited friends')}</h4>
      {referrals.friends.length ? (
        <ul className="account-profile-list">
          {referrals.friends.map((friend) => (
            <li key={friend.id} className={`account-profile-item${friend.deleted ? ' is-off' : ''}`}>
              <span>
                <strong>{friend.deleted ? tr('удалённый аккаунт', 'deleted account') : friend.nickname ?? friend.email}</strong>
                <small>{[friend.nickname && friend.email ? friend.email : '', tr(`пришёл ${f.date(friend.invitedAt)}`, `joined ${f.date(friend.invitedAt)}`), friend.blocked ? tr('заблокирован', 'blocked') : ''].filter(Boolean).join(' · ')}</small>
              </span>
              <span className="account-profile-side">
                <strong>{friend.payments ? f.money(friend.amount) : '—'}</strong>
                <small>{friend.payments ? tr(`оплат: ${friend.payments}${friend.firstPlan ? ` · первая ${plan(friend.firstPlan)}` : ''}`, `payments: ${friend.payments}${friend.firstPlan ? ` · first ${plan(friend.firstPlan)}` : ''}`) : tr('не оплачивал', 'never paid')}</small>
              </span>
            </li>
          ))}
          {referrals.more && <li className="account-profile-empty">{tr('Показаны последние 200.', 'The latest 200 are shown.')}</li>}
        </ul>
      ) : <p className="account-profile-empty">{tr('Никого не приглашал.', 'Invited nobody.')}</p>}
    </Card>
  )
}
