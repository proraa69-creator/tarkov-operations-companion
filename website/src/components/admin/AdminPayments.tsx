import { Download, LoaderCircle, Search } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { api, downloadAdminPaymentsCsv, type AdminPaymentFilter, type PaymentProvider, type PaymentStatus, type PlanId } from '../../api'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { AdminLavaEvents } from './AdminLavaEvents'
import { dateTime, failure, formatRub, mskDay, numberFormat, PAYMENT_STATUS, PLAN_IDS, PLAN_LABEL, PROVIDER_LABEL, useAdminData, type Failure } from './adminData'

const PAGE = 100
type Range = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'
const RANGES: Array<{ id: Range; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'month', label: 'Этот месяц' },
  { id: 'all', label: 'Всё время' },
  { id: 'custom', label: 'Даты' },
]

function rangeDates(range: Range, custom: { from: string; to: string }): Pick<AdminPaymentFilter, 'from' | 'to'> {
  if (range === 'today') return { from: mskDay(0), to: mskDay(0) }
  if (range === '7d') return { from: mskDay(6), to: mskDay(0) }
  if (range === '30d') return { from: mskDay(29), to: mskDay(0) }
  if (range === 'month') return { from: `${mskDay(0).slice(0, 7)}-01`, to: mskDay(0) }
  if (range === 'custom') return { ...(custom.from ? { from: custom.from } : {}), ...(custom.to ? { to: custom.to } : {}) }
  return {}
}

/** «Платежи»: every payment with filters, totals and CSV export (all filters apply to the file too). */
export function AdminPayments() {
  const { token } = useAuth()
  const [range, setRange] = useState<Range>('30d')
  const [custom, setCustom] = useState({ from: mskDay(29), to: mskDay(0) })
  const [status, setStatus] = useState<PaymentStatus | ''>('')
  const [provider, setProvider] = useState<PaymentProvider | ''>('')
  const [plan, setPlan] = useState<PlanId | ''>('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [csv, setCsv] = useState<{ busy: boolean; error: Failure | null }>({ busy: false, error: null })

  const filter: AdminPaymentFilter = { ...rangeDates(range, custom), ...(status ? { status } : {}), ...(provider ? { provider } : {}), ...(plan ? { plan } : {}), ...(q ? { q } : {}) }
  const key = JSON.stringify(filter)
  const payments = useAdminData(useCallback((t: string) => api.adminPayments(t, JSON.parse(key) as AdminPaymentFilter, PAGE, page * PAGE), [key, page]))
  const data = payments.data
  async function markRefunded(id: string, email: string) {
    if (!token || !window.confirm(`Отметить платёж ${email} как возвращённый?\n\nОплаченные дни будут сняты, доля стримера и награда за друга отменятся.`)) return
    try { await api.adminMarkRefunded(token, id); await payments.refresh() } catch (reason) { window.alert(failure(reason).message) }
  }

  const change = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(0) }
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setQ(search.trim()); setPage(0) }
  const exportCsv = async () => {
    if (!token) return
    setCsv({ busy: true, error: null })
    try {
      await downloadAdminPaymentsCsv(token, filter)
      setCsv({ busy: false, error: null })
    } catch (reason) {
      setCsv({ busy: false, error: failure(reason) })
    }
  }

  return (
    <div className="admin-stack">
      <AdminLavaEvents />
      <div className="admin-filters">
        <div role="group" aria-label="Период" className="admin-chips">
          {RANGES.map(({ id, label }) => <button key={id} type="button" aria-pressed={range === id} className={`button small ${range === id ? 'primary' : 'ghost'}`} onClick={() => change(setRange)(id)}>{label}</button>)}
        </div>
        {range === 'custom' && (
          <div className="admin-dates">
            <label className="field-hint">с <input className="input" type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => { setCustom({ ...custom, from: e.target.value }); setPage(0) }} /></label>
            <label className="field-hint">по <input className="input" type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => { setCustom({ ...custom, to: e.target.value }); setPage(0) }} /></label>
          </div>
        )}
        <div className="admin-selects">
          <select className="input" aria-label="Статус" value={status} onChange={(e) => change(setStatus)(e.target.value as PaymentStatus | '')}>
            <option value="">Все статусы</option>
            {(Object.keys(PAYMENT_STATUS) as PaymentStatus[]).map((id) => <option key={id} value={id}>{PAYMENT_STATUS[id].label}</option>)}
          </select>
          <select className="input" aria-label="Способ оплаты" value={provider} onChange={(e) => change(setProvider)(e.target.value as PaymentProvider | '')}>
            <option value="">ЮKassa и Lava.top</option>
            <option value="yookassa">ЮKassa</option>
            <option value="lava">Lava.top</option>
          </select>
          <select className="input" aria-label="Тариф" value={plan} onChange={(e) => change(setPlan)(e.target.value as PlanId | '')}>
            <option value="">Все тарифы</option>
            {PLAN_IDS.map((id) => <option key={id} value={id}>{PLAN_LABEL[id]}</option>)}
          </select>
        </div>
        <form className="inline-form admin-search" onSubmit={submitSearch} role="search">
          <input className="input" type="search" aria-label="Поиск по e-mail" placeholder="Поиск по e-mail" value={search} maxLength={254} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="button ghost"><Search aria-hidden="true" />Найти</button>
          <button type="button" className="button primary" onClick={() => void exportCsv()} disabled={csv.busy}>{csv.busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}CSV</button>
        </form>
      </div>
      {csv.error && <Notice tone={csv.error.offline ? 'offline' : 'error'}>{csv.error.message}</Notice>}
      {payments.error && <Notice tone={payments.error.offline ? 'offline' : 'error'}>{payments.error.message}</Notice>}
      {!data && !payments.error && <Loading text="Загружаем платежи…" />}
      {data && (
        <>
          <div className="admin-totals">
            <span>Платежей: <strong className="mono">{numberFormat.format(data.total)}</strong></span>
            <span>Оплачено: <strong className="mono">{numberFormat.format(data.totals.succeeded)}</strong></span>
            <span>Выручка: <strong className="mono accent">{formatRub(data.totals.revenue)} ₽</strong></span>
            <span>ЮKassa: <strong className="mono">{formatRub(data.totals.yookassa)} ₽</strong></span>
            <span>Lava.top: <strong className="mono">{formatRub(data.totals.lava)} ₽</strong></span>
            <span>Доля стримеров: <strong className="mono">{formatRub(data.totals.streamerEarnings)} ₽</strong></span>
          </div>
          {data.payments.length === 0 ? <div className="muted admin-empty">Платежей с такими условиями нет.</div> : (
            <div className="table-scroll">
              <table className="pay-table admin-table">
                <thead>
                  <tr>
                    <th scope="col">Создан</th><th scope="col">E-mail</th><th scope="col">Тариф</th><th scope="col">Способ</th><th scope="col">Статус</th>
                    <th scope="col" className="num">Сумма, ₽</th><th scope="col">Стример</th><th scope="col">Оплачен</th><th scope="col" aria-label="Действия" />
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((item) => (
                    <tr key={item.id}>
                      <td className="mono">{dateTime.format(new Date(item.createdAt))}</td>
                      <td className="admin-email" title={item.id}>{item.email}</td>
                      <td>{PLAN_LABEL[item.plan] ?? item.plan}{item.renewal ? <span className="tag admin-mini">автопродление</span> : null}</td>
                      <td>{PROVIDER_LABEL[item.provider]}</td>
                      <td><span className={`tag ${PAYMENT_STATUS[item.status]?.tone ?? ''}`}>{PAYMENT_STATUS[item.status]?.label ?? item.status}</span></td>
                      <td className="num mono">{formatRub(item.amount)}{item.original ? <span className="dim"> · {formatRub(item.original.amount)} {item.original.currency}</span> : null}</td>
                      <td className="mono">{item.referralCode ? <>{item.referralCode}{item.streamerEarning !== undefined ? <span className="dim"> · {formatRub(item.streamerEarning)} ₽</span> : null}</> : '—'}</td>
                      <td className="mono">{item.paidAt ? dateTime.format(new Date(item.paidAt)) : '—'}</td>
                      <td>{item.status === 'succeeded' && (
                        <button type="button" className="button small ghost" title="Деньги вернули мимо ЮKassa (банк, вручную): забрать оплаченные дни, долю стримера и награду за друга" onClick={() => void markRefunded(item.id, item.email)}>Отметить возврат</button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} total={data.total} size={PAGE} onPage={setPage} />
        </>
      )}
    </div>
  )
}

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (page: number) => void }) {
  if (total <= size) return null
  const pages = Math.ceil(total / size)
  return (
    <div className="admin-pager">
      <button type="button" className="button small ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>Назад</button>
      <span className="field-hint mono">{page + 1} / {pages}</span>
      <button type="button" className="button small ghost" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Дальше</button>
    </div>
  )
}
