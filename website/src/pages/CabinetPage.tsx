import { BadgeCheck, CalendarClock, Coins, CreditCard, Download, Gift, Link2, LoaderCircle, LogOut, MousePointerClick, RefreshCw, Save, UserPlus, Users, WifiOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ApiError, api, errorMessage, type Account, type AccountMode } from '../api'
import { useAuth } from '../auth'
import { CopyButton } from '../components/CopyButton'
import { Notice } from '../components/Notice'
import { APP_VERSION } from '../config'
import { loadReferralCode, normalizeReferralCode, REFERRAL_CODE_PATTERN, saveReferralCode } from '../storage'
import { DownloadButton } from './DownloadPage'

const MODES: { id: AccountMode; label: string; color: string }[] = [
  { id: 'pvp', label: 'PvP', color: 'var(--brass)' },
  { id: 'pve', label: 'PvE', color: 'var(--green)' },
  { id: 'seasonal', label: 'Сезон', color: 'var(--blue)' },
]

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const numberFormat = new Intl.NumberFormat('ru-RU')

function formatMoney(amount: number, currency: string) {
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) } catch { return `${amount} ${currency}` }
}

export function CabinetPage() {
  const auth = useAuth()
  const location = useLocation()
  const state = (location.state ?? {}) as { welcome?: boolean; referralRejected?: boolean }

  if (auth.status === 'signed-out') return <Navigate to="/login" replace />

  if (auth.status === 'loading' || (auth.status === 'ready' && !auth.account)) {
    return (
      <div className="container page">
        <div className="panel center-state"><LoaderCircle className="spinner" aria-hidden="true" /><div>Загружаем личный кабинет…</div></div>
      </div>
    )
  }

  if (auth.status === 'error' || !auth.account) {
    const offline = auth.error?.network ?? false
    return (
      <div className="container page page-in">
        <div className="panel center-state" style={{ padding: 24 }}>
          {offline ? <WifiOff aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          <div style={{ maxWidth: 460 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 24, color: 'var(--text)' }}>{offline ? 'Нет связи с сервером' : 'Не удалось открыть кабинет'}</h1>
            <p style={{ margin: 0 }}>{auth.error?.message ?? 'Попробуйте ещё раз.'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="button primary" onClick={auth.reload}><RefreshCw aria-hidden="true" />Повторить</button>
            <button type="button" className="button ghost" onClick={() => void auth.logout()}><LogOut aria-hidden="true" />Выйти</button>
          </div>
        </div>
      </div>
    )
  }

  const account = auth.account
  return (
    <div className="page page-in">
      <div className="container">
        <div className="page-header">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Личный кабинет</div>
            <h1 className="page-title">{account.email}</h1>
            <p className="page-subtitle">Аккаунт создан {dateFormat.format(new Date(account.createdAt))}</p>
          </div>
          <button type="button" className="button ghost" onClick={() => void auth.logout()}><LogOut aria-hidden="true" />Выйти</button>
        </div>

        {(state.welcome || state.referralRejected) && (
          <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
            {state.welcome && <Notice tone="success" title="Аккаунт создан">Добро пожаловать! Привяжите никнеймы Tarkov и скачайте приложение.</Notice>}
            {state.referralRejected && <Notice tone="warn" title="Код приглашения не применён">Такой код не найден. Проверьте его и укажите ниже, в блоке «Код приглашения».</Notice>}
          </div>
        )}

        <div className="cabinet-grid">
          <div className="cabinet-col">
            <SubscriptionPanel account={account} />
            {account.kind === 'streamer' && account.referralCode && <ReferralProgramPanel account={account} />}
            <NicknamesPanel account={account} />
          </div>
          <div className="cabinet-col">
            <AppPanel />
            {account.kind === 'user' && <InviteCodePanel account={account} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function SubscriptionPanel({ account }: { account: Account }) {
  const trial = account.subscription.status === 'trial'
  return (
    <section className="panel" aria-labelledby="sub-title">
      <div className="panel-header">
        <div className="panel-title" id="sub-title"><CreditCard aria-hidden="true" />Подписка</div>
        {trial ? <span className="tag green">Пробный период</span> : <span className="tag">Не активна</span>}
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        <div className="sub-status">
          <CalendarClock aria-hidden="true" size={28} style={{ color: trial ? 'var(--success)' : 'var(--text-dim)' }} />
          <div>
            <div className="big">{trial ? 'Доступ открыт' : 'Подписка не оформлена'}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              {trial && account.subscription.trialEndsAt
                ? `Бесплатный период по приглашению действует до ${dateTimeFormat.format(new Date(account.subscription.trialEndsAt))}.`
                : 'Оформить подписку можно будет прямо здесь.'}
            </div>
          </div>
        </div>
        <Notice tone="info">Оплата подписки появится в ближайших обновлениях: тарифы на 1, 3, 6 и 12 месяцев. Статус подписки проверяется только на сервере.</Notice>
      </div>
    </section>
  )
}

function ReferralProgramPanel({ account }: { account: Account }) {
  const code = account.referralCode!
  const link = `${window.location.origin}/r/${encodeURIComponent(code)}`
  const stats = account.stats ?? { visits: 0, registrations: 0, activeSubscriptions: 0, earnings: { amount: 0, currency: 'RUB' } }
  const cards = [
    { icon: MousePointerClick, label: 'Переходы', value: numberFormat.format(stats.visits), meta: 'по вашей ссылке' },
    { icon: UserPlus, label: 'Регистрации', value: numberFormat.format(stats.registrations), meta: 'с вашим кодом' },
    { icon: BadgeCheck, label: 'Подписки', value: numberFormat.format(stats.activeSubscriptions), meta: 'активные сейчас' },
    { icon: Coins, label: 'Начисления', value: formatMoney(stats.earnings.amount, stats.earnings.currency), meta: 'за всё время' },
  ]
  return (
    <section className="panel" aria-labelledby="ref-title">
      <div className="panel-header">
        <div className="panel-title" id="ref-title"><Users aria-hidden="true" />Реферальная программа</div>
      </div>
      <div className="panel-body">
        <div className="ref-top">
          <div className="field">
            <span className="field-label">Ваш код</span>
            <div className="copy-row"><code>{code}</code><CopyButton value={code} /></div>
          </div>
          <div className="field">
            <span className="field-label"><Link2 size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />Ваша ссылка</span>
            <div className="copy-row"><code title={link}>{link}</code><CopyButton value={link} /></div>
          </div>
        </div>
        <div className="stat-grid">
          {cards.map(({ icon: Icon, label, value, meta }) => (
            <div key={label} className="stat-card">
              <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
              <div className="stat-value mono">{value}</div>
              <div className="stat-meta">{meta}</div>
            </div>
          ))}
        </div>
        <p className="dim" style={{ margin: '14px 0 0', fontSize: 13 }}>
          Приглашённые получают 3 дня бесплатного доступа. Начисления учитываются только по оплатам, подтверждённым платёжной системой.
        </p>
      </div>
    </section>
  )
}

function NicknamesPanel({ account }: { account: Account }) {
  const auth = useAuth()
  const [values, setValues] = useState<Record<AccountMode, string>>(() => ({
    pvp: account.nicknames.pvp ?? '', pve: account.nicknames.pve ?? '', seasonal: account.nicknames.seasonal ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; offline?: boolean } | null>(null)
  const dirty = MODES.some(({ id }) => values[id].trim() !== (account.nicknames[id] ?? ''))

  async function save(event: FormEvent) {
    event.preventDefault()
    const bad = MODES.find(({ id }) => values[id].trim() && !/^[a-zA-Z0-9_-]{3,15}$/.test(values[id].trim()))
    if (bad) { setResult({ ok: false, message: `Никнейм ${bad.label}: 3–15 символов, латиница, цифры, «_» или «-».` }); return }
    if (!auth.token) return
    setBusy(true)
    setResult(null)
    try {
      const next = await api.setNicknames(auth.token, { pvp: values.pvp.trim(), pve: values.pve.trim(), seasonal: values.seasonal.trim() })
      auth.setAccount(next)
      setResult({ ok: true, message: 'Никнеймы сохранены.' })
    } catch (error) {
      setResult({ ok: false, message: errorMessage(error), offline: error instanceof ApiError && error.network })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="nick-title">
      <div className="panel-header">
        <div className="panel-title" id="nick-title"><BadgeCheck aria-hidden="true" />Никнеймы Tarkov</div>
      </div>
      <form className="panel-body form" onSubmit={save}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>У каждого режима свой профиль и прогресс — укажите ник для каждого режима, в котором играете.</p>
        <div className="nick-grid">
          {MODES.map(({ id, label, color }) => (
            <label key={id} className="field">
              <span className="field-label mode-chip"><span className="mode-dot" style={{ background: color }} />{label}</span>
              <input className="input" value={values[id]} maxLength={15} spellCheck={false} autoComplete="off" placeholder="Не привязан" onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))} />
            </label>
          ))}
        </div>
        {result && <Notice tone={result.ok ? 'success' : result.offline ? 'offline' : 'error'}>{result.message}</Notice>}
        <div><button type="submit" className="button primary" disabled={busy || !dirty}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}Сохранить</button></div>
      </form>
    </section>
  )
}

function AppPanel() {
  return (
    <section className="panel" aria-labelledby="app-title">
      <div className="panel-header">
        <div className="panel-title" id="app-title"><Download aria-hidden="true" />Приложение</div>
        <span className="tag brass">v{APP_VERSION}</span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Портативная версия для Windows. Войдите в приложении с тем же e-mail и паролем.</p>
        <DownloadButton large={false} />
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>Для мини-карты поверх игры включите в Tarkov режим экрана «Оконный без рамки».</p>
      </div>
    </section>
  )
}

function InviteCodePanel({ account }: { account: Account }) {
  const auth = useAuth()
  const [code, setCode] = useState(() => loadReferralCode() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)

  async function apply(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeReferralCode(code)
    if (!REFERRAL_CODE_PATTERN.test(normalized)) { setError({ message: 'Код: 3–24 символа, латиница, цифры, «_» или «-».', offline: false }); return }
    if (!auth.token) return
    setBusy(true)
    setError(null)
    try {
      auth.setAccount(await api.applyReferral(auth.token, normalized))
      saveReferralCode(null)
    } catch (reason) {
      setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="invite-title">
      <div className="panel-header">
        <div className="panel-title" id="invite-title"><Gift aria-hidden="true" />Код приглашения</div>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
        {account.referredBy ? (
          <dl className="kv">
            <div><dt>Вы приглашены по коду</dt><dd className="mono" style={{ color: 'var(--brass-strong)' }}>{account.referredBy}</dd></div>
          </dl>
        ) : (
          <form onSubmit={apply} style={{ display: 'grid', gap: 12 }}>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Пришли от автора или стримера? Укажите его код — это можно сделать один раз.</p>
            <div className="inline-form">
              <input className="input code" aria-label="Код приглашения" value={code} maxLength={24} spellCheck={false} autoComplete="off" placeholder="КОД" onChange={(e) => setCode(e.target.value)} />
              <button type="submit" className="button primary" disabled={busy || !code.trim()}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Применить</button>
            </div>
            {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
          </form>
        )}
      </div>
    </section>
  )
}
