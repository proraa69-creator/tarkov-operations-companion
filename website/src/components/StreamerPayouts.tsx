import { Banknote, CalendarClock, Coins, HandCoins, LoaderCircle, Pencil, Percent, Save, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type PayoutOverview, type PayoutStatus } from '../api'
import { useAuth } from '../auth'
import { Notice } from './Notice'
import { formatRub } from './ReferralStatsTable'
import '../extras.css'

const INTERVAL_PRESETS = [3, 7, 14, 30]
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
export const PAYOUT_STATUS: Record<PayoutStatus, { label: string; tone: string }> = {
  pending: { label: 'Ожидает выплаты', tone: 'brass' },
  paid: { label: 'Выплачено', tone: 'green' },
  rejected: { label: 'Отклонено', tone: 'danger' },
}
const days = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней'}`

type Message = { tone: 'success' | 'error' | 'offline'; text: string } | null
const failure = (reason: unknown): Message => ({ tone: reason instanceof ApiError && reason.network ? 'offline' : 'error', text: errorMessage(reason) })

/**
 * Streamer earnings and payouts: his share (percent), earned total, balance, payout details (SBP), auto-payout every
 * N days and the history. No prices or viewers' payment amounts are shown here.
 */
export function StreamerPayouts() {
  const auth = useAuth()
  const token = auth.token
  const [data, setData] = useState<PayoutOverview | null>(null)
  const [loadError, setLoadError] = useState<Message>(null)

  const load = useCallback(() => {
    if (!token) return
    api.payouts(token).then((next) => { setData(next); setLoadError(null) }, (reason: unknown) => setLoadError(failure(reason)))
  }, [token])
  useEffect(() => { load() }, [load])

  if (loadError && !data) return <Notice tone={loadError.tone === 'offline' ? 'offline' : 'error'} title="Не удалось загрузить выплаты">{loadError.text}</Notice>
  if (!data) return <div className="muted" style={{ fontSize: 14 }}><LoaderCircle className="spinner" size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Загружаем начисления…</div>

  const cards = [
    { icon: Percent, label: 'Ваша доля', value: `${String(data.percent).replace('.', ',')}%`, meta: 'от оплат приглашённых', accent: false },
    { icon: Coins, label: 'Заработано', value: `${formatRub(data.earned)} ₽`, meta: 'за всё время', accent: false },
    { icon: Wallet, label: 'Доступно к выплате', value: `${formatRub(data.available)} ₽`, meta: data.pending ? `ещё ${formatRub(data.pending)} ₽ ожидает выплаты` : `выплачено ${formatRub(data.paidOut)} ₽`, accent: true },
  ]

  return (
    <div className="payouts">
      <div className="stat-grid payout-stats">
        {cards.map(({ icon: Icon, label, value, meta, accent }) => (
          <div key={label} className={`stat-card${accent ? ' is-accent' : ''}`}>
            <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
            <div className="stat-value mono">{value}</div>
            <div className="stat-meta">{meta}</div>
          </div>
        ))}
      </div>
      <div className="payout-grid">
        <PayoutRequest data={data} onChange={setData} reload={load} />
        <PayoutSettings data={data} onChange={setData} />
      </div>
      {data.payouts.length > 0 && (
        <div className="pay-history">
          <div className="field-label">История выплат</div>
          <div className="table-scroll">
            <table className="pay-table">
              <thead><tr><th scope="col">Дата</th><th scope="col" className="num">Сумма, ₽</th><th scope="col">Куда</th><th scope="col">Статус</th></tr></thead>
              <tbody>{data.payouts.map((item) => {
                const status = PAYOUT_STATUS[item.status]
                return (
                  <tr key={item.id}>
                    <td className="mono">{shortDate.format(new Date(item.createdAt))}{item.auto && <span className="dim"> · авто</span>}</td>
                    <td className="num mono">{formatRub(item.amount)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{item.destination}</td>
                    <td><span className={`tag ${status.tone}`} title={item.comment}>{status.label}</span>{item.comment && <span className="dim" style={{ fontSize: 12 }}> · {item.comment}</span>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </div>
      )}
      <p className="dim" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
        Выплаты переводит владелец сервиса по СБП на указанный телефон; статус меняется на «Выплачено» после перевода. Для выплат, скорее всего, понадобится статус самозанятого (НПД): с полученных сумм вы сами платите налог и формируете чек в «Мой налог». Порядок выплат и налогов уточните у владельца.
      </p>
    </div>
  )
}

function PayoutRequest({ data, onChange, reload }: { data: PayoutOverview; onChange: (next: PayoutOverview) => void; reload: () => void }) {
  const auth = useAuth()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const pending = data.payouts.some((item) => item.status === 'pending')
  const canRequest = Boolean(data.details) && !pending && data.available >= data.minimum

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = Number(amount.replace(',', '.').replace(/\s/g, '') || data.available)
    if (!Number.isFinite(value) || value < data.minimum) { setMessage({ tone: 'error', text: `Минимальная выплата — ${formatRub(data.minimum)} ₽` }); return }
    if (value > data.available) { setMessage({ tone: 'error', text: `Доступно только ${formatRub(data.available)} ₽` }); return }
    if (!auth.token) return
    setBusy(true)
    setMessage(null)
    try {
      await api.requestPayout(auth.token, Math.round(value * 100) / 100)
      setAmount('')
      setMessage({ tone: 'success', text: 'Заявка создана. Статус — в истории выплат.' })
      onChange(await api.payouts(auth.token))
    } catch (reason) {
      setMessage(failure(reason))
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="payout-box" onSubmit={submit}>
      <div className="field-label"><HandCoins size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Получить выплату</div>
      <div className="inline-form">
        <input className="input mono" inputMode="decimal" aria-label="Сумма выплаты, ₽" value={amount} placeholder={formatRub(data.available)} onChange={(e) => setAmount(e.target.value)} disabled={!canRequest || busy} />
        <button type="button" className="button ghost" onClick={() => setAmount(String(data.available).replace('.', ','))} disabled={!canRequest || busy}>Всё</button>
        <button type="submit" className="button primary" disabled={!canRequest || busy}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Banknote aria-hidden="true" />}Получить выплату</button>
      </div>
      <span className="field-hint">
        {!data.details ? 'Сначала укажите реквизиты для выплаты.'
          : pending ? 'Предыдущая заявка ещё ждёт выплаты — новую можно создать после неё.'
            : data.available < data.minimum ? `Минимальная выплата — ${formatRub(data.minimum)} ₽. На балансе пока ${formatRub(data.available)} ₽.`
              : `Любая сумма от ${formatRub(data.minimum)} до ${formatRub(data.available)} ₽.`}
      </span>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  )
}

function PayoutSettings({ data, onChange }: { data: PayoutOverview; onChange: (next: PayoutOverview) => void }) {
  const auth = useAuth()
  const [editing, setEditing] = useState(!data.details)
  const [form, setForm] = useState({ phone: '', bank: data.details?.bank ?? '', recipient: data.details?.recipient ?? '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const { limits } = data.autoPayout
  const options = [...new Set([...INTERVAL_PRESETS, data.autoPayout.intervalDays, limits.min, limits.max])].filter((n) => n >= limits.min && n <= limits.max).sort((a, b) => a - b)

  async function save(patch: Parameters<typeof api.savePayoutSettings>[1], success: string) {
    if (!auth.token) return
    setBusy(true)
    setMessage(null)
    try {
      onChange(await api.savePayoutSettings(auth.token, patch))
      setMessage({ tone: 'success', text: success })
      return true
    } catch (reason) {
      setMessage(failure(reason))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault()
    if (await save({ phone: form.phone, bank: form.bank, recipient: form.recipient }, 'Реквизиты сохранены.')) { setEditing(false); setForm((f) => ({ ...f, phone: '' })) }
  }

  return (
    <div className="payout-box">
      <div className="field-label"><CalendarClock size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Реквизиты и автовыплата</div>
      {data.details && !editing ? (
        <div className="payout-details">
          <div><span className="dim">СБП:</span> <span className="mono">{data.details.phone}</span> · {data.details.bank}</div>
          <div><span className="dim">Получатель:</span> {data.details.recipient}</div>
          <button type="button" className="button ghost small" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Изменить</button>
        </div>
      ) : (
        <form className="payout-form" onSubmit={saveDetails}>
          <label className="field"><span className="field-hint">Телефон для СБП</span><input className="input" type="tel" autoComplete="tel" required value={form.phone} placeholder={data.details ? `${data.details.phone} — введите заново` : '+7 999 123-45-67'} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="field"><span className="field-hint">Банк получателя</span><input className="input" required maxLength={60} value={form.bank} placeholder="Т-Банк, Сбербанк…" onChange={(e) => setForm({ ...form, bank: e.target.value })} /></label>
          <label className="field"><span className="field-hint">Имя и фамилия, как в банке</span><input className="input" autoComplete="name" required maxLength={100} value={form.recipient} placeholder="Иван Петров" onChange={(e) => setForm({ ...form, recipient: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="button primary small" disabled={busy}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}Сохранить реквизиты</button>
            {data.details && <button type="button" className="button ghost small" onClick={() => setEditing(false)}>Отмена</button>}
          </div>
          <span className="field-hint">Номер карты не нужен и не хранится. Телефон виден только вам (скрыт) и владельцу — для перевода.</span>
        </form>
      )}
      <label className="auto-toggle">
        <input type="checkbox" checked={data.autoPayout.enabled} disabled={busy} onChange={(e) => void save({ auto: e.target.checked }, e.target.checked ? 'Автовыплата включена.' : 'Автовыплата выключена.')} />
        <span>Автовыплата раз в
          <select className="input select-inline" aria-label="Автовыплата раз в сколько дней" value={data.autoPayout.intervalDays} disabled={busy} onChange={(e) => void save({ intervalDays: Number(e.target.value) }, 'Интервал сохранён.')}>
            {options.map((n) => <option key={n} value={n}>{days(n)}</option>)}
          </select>
        </span>
      </label>
      <span className="field-hint">
        {data.autoPayout.enabled
          ? data.autoPayout.nextAt ? `Следующая — ${dateFormat.format(new Date(data.autoPayout.nextAt))}: заявка на весь доступный баланс (от ${formatRub(data.minimum)} ₽).` : 'Начнётся после сохранения реквизитов.'
          : 'Выключена: выплату можно запросить вручную в любой момент.'}
      </span>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  )
}
