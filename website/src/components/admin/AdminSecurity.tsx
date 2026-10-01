import { Ban, DatabaseBackup, HardDrive, ListChecks, LoaderCircle, RefreshCw, ShieldCheck, ShieldOff, Siren, Unlock } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Pager } from './AdminPayments'
import { Loading } from './adminShared'
import { dateTime, failure, numberFormat, useAdminData, type Failure } from './adminData'
import { REASON_LABEL, securityApi, type GuardReason, type SecurityBan, type SecurityView, type SeriesRow } from './securityApi'
import '../../admin-security.css'

const EVENTS_PAGE = 50
const BAN_HOURS = [
  { hours: 1, label: '1 час' },
  { hours: 24, label: '24 часа' },
  { hours: 168, label: '7 дней' },
  { hours: 720, label: '30 дней' },
]
const LEVEL_LABEL = ['15 мин', '1 час', '24 часа']
const timeShort = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
const percent = (rate: number) => `${(Math.round(rate * 1000) / 10).toLocaleString('ru-RU')}%`
const megabytes = (bytes: number) => `${(Math.round(bytes / 1024 / 102.4) / 10).toLocaleString('ru-RU')} МБ`

/** Green / amber / red, as the «Безопасность» lamp in the owner app (electron/serverGuardian.ts). */
function lampOf(view: SecurityView): { tone: 'green' | 'amber' | 'red'; title: string; text: string } {
  const s = view.security
  if (s.bans1h >= 3 || s.credentialStuffing1h > 0) return { tone: 'red', title: 'Идёт атака', text: `За последний час заблокировано адресов: ${s.bans1h}. Сервер блокирует их сам; при необходимости снимите блокировку ниже.` }
  if (view.database.quickCheck && !view.database.quickCheck.ok) return { tone: 'red', title: 'Проверка базы не прошла', text: `quick_check: ${view.database.quickCheck.result}. Восстановите резервную копию — инструкция в docs/server-guard.md.` }
  if (s.activeBans > 0 || s.bans1h > 0 || s.events1h > 0) return { tone: 'amber', title: 'Были подозрительные запросы', text: `Активных блокировок: ${s.activeBans}, подозрительных запросов за час: ${numberFormat.format(s.events1h)}.` }
  return { tone: 'green', title: 'Спокойно', text: `За сутки подозрительных запросов: ${numberFormat.format(s.events24h)}. Ошибок сервера за 15 минут: ${view.requests.last15m.errors}.` }
}

/**
 * «Безопасность»: «Страж сервера» (docs/server-guard.md) — current bans (unban / ban by hand), the allowlist, events by
 * reason, the recent suspicious requests, the 5xx graph, the API's health and the last backup. Addresses are masked
 * (203.0.113.*): the server never stores or shows them in full.
 */
export function AdminSecurity() {
  const view = useAdminData(useCallback((token: string) => securityApi.view(token), []))
  const data = view.data
  return (
    <div className="admin-stack">
      {view.error && <Notice tone={view.error.offline ? 'offline' : 'error'}>{view.error.message}</Notice>}
      {!data && !view.error && <Loading text="Загружаем журнал безопасности…" />}
      {data && (
        <>
          <StatusStrip data={data} loading={view.loading} onRefresh={() => void view.refresh()} />
          <div className="stat-grid admin-stats">
            <Stat icon={Ban} label="Активные блокировки" value={numberFormat.format(data.security.activeBans)} meta={`за сутки: ${numberFormat.format(data.security.bans24h)} · отклонено запросов: ${numberFormat.format(data.security.blockedSinceStart)}`} accent={data.security.activeBans > 0} />
            <Stat icon={Siren} label="Подозрительные запросы" value={numberFormat.format(data.security.events24h)} meta={`за час: ${numberFormat.format(data.security.events1h)}`} />
            <Stat icon={ListChecks} label="Ошибки 5xx · 15 мин" value={numberFormat.format(data.requests.last15m.errors)} meta={`${percent(data.requests.last15m.rate)} из ${numberFormat.format(data.requests.last15m.requests)} запросов`} accent={data.requests.last15m.errors > 0} />
            <Stat icon={DatabaseBackup} label="Резервная копия" value={data.backups.lastAt ? dateTime.format(new Date(data.backups.lastAt)) : 'ещё нет'} meta={data.backups.enabled ? `копий: ${data.backups.count} · ${megabytes(data.backups.totalBytes)}` : 'база в памяти — копии выключены'} />
          </div>
          {data.backups.lastError && <Notice tone="warn" title="Последняя резервная копия не создана">{data.backups.lastError}</Notice>}
          <ErrorChart data={data} />
          <BansSection bans={data.bans} onBans={(bans) => view.setData({ ...data, bans })} />
          <ReasonsSection data={data} />
          <EventsSection />
          <HealthSection data={data} />
          <AllowlistSection data={data} onChange={(next) => view.setData(next)} />
        </>
      )}
    </div>
  )
}

function StatusStrip({ data, loading, onRefresh }: { data: SecurityView; loading: boolean; onRefresh: () => void }) {
  const lamp = lampOf(data)
  return (
    <div className={`guard-strip is-${lamp.tone}`} role="status">
      <span className={`guard-lamp is-${lamp.tone}`} aria-hidden="true" />
      <div className="guard-strip-text">
        <strong>{lamp.title}</strong>
        <span>{lamp.text}</span>
      </div>
      <button type="button" className="button small ghost" onClick={onRefresh} disabled={loading}>
        <RefreshCw aria-hidden="true" className={loading ? 'spinner' : undefined} />Обновить
      </button>
    </div>
  )
}

function Stat({ icon: Icon, label, value, meta, accent = false }: { icon: typeof Ban; label: string; value: string; meta: string; accent?: boolean }) {
  return (
    <div className={`stat-card${accent ? ' is-accent' : ''}`}>
      <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
      <div className="stat-value mono">{value}</div>
      <div className="stat-meta">{meta}</div>
    </div>
  )
}

/** 5xx answers per hour (24 h) or per 5 minutes (2 h); the hovered column shows requests, errors and the share. */
function ErrorChart({ data }: { data: SecurityView }) {
  const [range, setRange] = useState<'day' | 'recent'>('day')
  const [active, setActive] = useState<number | null>(null)
  const rows: SeriesRow[] = range === 'day' ? data.series : data.recentSeries
  const max = Math.max(1, ...rows.map((row) => row.errors))
  const hovered = active === null ? null : rows[active]
  const totals = rows.reduce((sum, row) => ({ requests: sum.requests + row.requests, errors: sum.errors + row.errors }), { requests: 0, errors: 0 })
  return (
    <section className="admin-section" aria-labelledby="guard-errors-title">
      <div className="admin-section-head">
        <h2 className="panel-title" id="guard-errors-title"><ListChecks aria-hidden="true" />Ошибки сервера (5xx)</h2>
        <div className="admin-chips">
          <button type="button" className={`button small ${range === 'day' ? 'primary' : 'ghost'}`} aria-pressed={range === 'day'} onClick={() => { setRange('day'); setActive(null) }}>24 часа</button>
          <button type="button" className={`button small ${range === 'recent' ? 'primary' : 'ghost'}`} aria-pressed={range === 'recent'} onClick={() => { setRange('recent'); setActive(null) }}>2 часа</button>
        </div>
      </div>
      <figure className="admin-chart guard-chart">
        <figcaption>
          <span className="field-label">{range === 'day' ? 'По часам' : 'По 5 минут'} (время МСК)</span>
          <span className="admin-chart-readout mono" aria-live="polite">
            {hovered
              ? <>{timeShort.format(new Date(hovered.at))}: <strong>{hovered.errors}</strong> ошибок из {numberFormat.format(hovered.requests)}{hovered.requests ? ` (${percent(hovered.errors / hovered.requests)})` : ''}</>
              : <>Итого: <strong>{numberFormat.format(totals.errors)}</strong> ошибок из {numberFormat.format(totals.requests)} запросов</>}
          </span>
        </figcaption>
        <div className="admin-chart-plot">
          <div className="admin-chart-axis mono" aria-hidden="true"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div>
          <div className="admin-chart-bars" role="list" onMouseLeave={() => setActive(null)}>
            {rows.map((row, index) => (
              <button key={row.at} type="button" role="listitem" className={`admin-chart-col${active === index ? ' is-active' : ''}`}
                aria-label={`${timeShort.format(new Date(row.at))}: ошибок ${row.errors} из ${row.requests}`}
                onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
                <span className="admin-chart-bar guard-bar" style={{ height: `${row.errors > 0 ? Math.max((row.errors / max) * 100, 3) : 0}%` }} />
              </button>
            ))}
          </div>
        </div>
        <div className="admin-chart-x mono" aria-hidden="true">
          <span>{rows[0] ? timeShort.format(new Date(rows[0].at)) : ''}</span>
          <span>{rows.length ? timeShort.format(new Date(rows[rows.length - 1]!.at)) : ''}</span>
        </div>
      </figure>
      <p className="field-hint" style={{ margin: 0 }}>Счётчики начинаются заново при каждом перезапуске сервера. Приложение-сервер перезапускает API само, если ошибок становится слишком много (сначала делает копию базы).</p>
    </section>
  )
}

function BansSection({ bans, onBans }: { bans: SecurityBan[]; onBans: (bans: SecurityBan[]) => void }) {
  const [ip, setIp] = useState('')
  const [hours, setHours] = useState(24)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<number | 'ban' | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const action = useAction()
  const run = (key: number | 'ban', work: (token: string) => Promise<{ bans: SecurityBan[] }>) => {
    setBusy(key)
    setError(null)
    void action(work).then((result) => { if (result) onBans(result.bans); if (key === 'ban') { setIp(''); setNote('') } }, (reason: unknown) => setError(failure(reason))).finally(() => setBusy(null))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ip.trim()) return
    run('ban', (token) => securityApi.ban(token, ip.trim(), hours, note.trim() || undefined))
  }
  return (
    <section className="admin-section" aria-labelledby="guard-bans-title">
      <div className="admin-section-head">
        <h2 className="panel-title" id="guard-bans-title"><Ban aria-hidden="true" />Блокировки</h2>
        <span className="muted guard-small">Автоматически: 15 мин → 1 час → 24 часа при повторе в течение 7 дней</span>
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {bans.length === 0 && <div className="muted admin-empty"><ShieldCheck size={14} aria-hidden="true" /> Блокировок за последние 7 дней не было.</div>}
      {bans.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table guard-table">
            <thead><tr><th scope="col">Адрес</th><th scope="col">Причина</th><th scope="col">Срок</th><th scope="col">С (МСК)</th><th scope="col">До (МСК)</th><th scope="col">Статус</th><th scope="col"><span className="visually-hidden">Действие</span></th></tr></thead>
            <tbody>
              {bans.map((ban) => (
                <tr key={ban.id}>
                  <td className="mono">{ban.ip}</td>
                  <td className="admin-wrap">{REASON_LABEL[ban.reason as GuardReason] ?? ban.reason}{ban.actor ? <span className="owner-email">{ban.actor}</span> : null}</td>
                  <td>{ban.source === 'manual' ? 'вручную' : LEVEL_LABEL[ban.level] ?? `${ban.level}`}</td>
                  <td className="mono">{dateTime.format(new Date(ban.createdAt))}</td>
                  <td className="mono">{dateTime.format(new Date(ban.liftedAt ?? ban.until))}</td>
                  <td>{ban.active ? <span className="tag danger">действует</span> : <span className="tag">{ban.liftedAt ? 'снята' : 'истекла'}</span>}</td>
                  <td>{ban.active && (
                    <button type="button" className="button small ghost" disabled={busy !== null} onClick={() => run(ban.id, (token) => securityApi.unban(token, ban.id))}>
                      {busy === ban.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Unlock aria-hidden="true" />}Снять
                    </button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="guard-form" onSubmit={submit} aria-label="Заблокировать адрес вручную">
        <label className="guard-field"><span className="field-label">IP-адрес</span><input className="input mono" value={ip} onChange={(event) => setIp(event.target.value)} placeholder="203.0.113.7" maxLength={64} required /></label>
        <label className="guard-field"><span className="field-label">На сколько</span>
          <select className="input" value={hours} onChange={(event) => setHours(Number(event.target.value))}>{BAN_HOURS.map((item) => <option key={item.hours} value={item.hours}>{item.label}</option>)}</select>
        </label>
        <label className="guard-field guard-grow"><span className="field-label">Заметка (необязательно)</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={120} placeholder="например: спам регистраций" /></label>
        <button type="submit" className="button admin-danger" disabled={busy !== null || !ip.trim()}>{busy === 'ban' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Ban aria-hidden="true" />}Заблокировать</button>
      </form>
    </section>
  )
}

function ReasonsSection({ data }: { data: SecurityView }) {
  const rows = (Object.entries(data.security.byReason24h) as Array<[GuardReason, number]>).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...rows.map(([, count]) => count))
  return (
    <section className="admin-section" aria-labelledby="guard-reasons-title">
      <div className="admin-section-head"><h2 className="panel-title" id="guard-reasons-title"><Siren aria-hidden="true" />Причины за сутки</h2></div>
      {rows.length === 0 ? <div className="muted admin-empty"><ShieldCheck size={14} aria-hidden="true" /> Подозрительных запросов за сутки не было.</div> : (
        <ul className="guard-reasons">
          {rows.map(([reason, count]) => (
            <li key={reason}>
              <span className="guard-reason-label">{REASON_LABEL[reason] ?? reason}</span>
              <span className="guard-reason-bar" aria-hidden="true"><span style={{ width: `${Math.max((count / max) * 100, 2)}%` }} /></span>
              <span className="mono guard-reason-count">{numberFormat.format(count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EventsSection() {
  const [page, setPage] = useState(0)
  const [reason, setReason] = useState<GuardReason | undefined>(undefined)
  const events = useAdminData(useCallback((token: string) => securityApi.events(token, EVENTS_PAGE, page * EVENTS_PAGE, reason), [page, reason]))
  const data = events.data
  return (
    <section className="admin-section" aria-labelledby="guard-events-title">
      <div className="admin-section-head">
        <h2 className="panel-title" id="guard-events-title"><ListChecks aria-hidden="true" />Подозрительные запросы</h2>
        <select className="input guard-select" aria-label="Причина" value={reason ?? ''} onChange={(event) => { setReason((event.target.value || undefined) as GuardReason | undefined); setPage(0) }}>
          <option value="">Все причины</option>
          {(Object.keys(REASON_LABEL) as GuardReason[]).map((key) => <option key={key} value={key}>{REASON_LABEL[key]}</option>)}
        </select>
      </div>
      {events.error && <Notice tone={events.error.offline ? 'offline' : 'error'}>{events.error.message}</Notice>}
      {!data && !events.error && <Loading />}
      {data && data.events.length === 0 && <div className="muted admin-empty"><ShieldCheck size={14} aria-hidden="true" /> Ничего подозрительного (хранится 30 дней).</div>}
      {data && data.events.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table guard-table admin-audit">
            <thead><tr><th scope="col">Когда (МСК)</th><th scope="col">Адрес</th><th scope="col">Причина</th><th scope="col">Путь</th><th scope="col">Раз</th></tr></thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.id}>
                  <td className="mono">{dateTime.format(new Date(event.at))}</td>
                  <td className="mono">{event.ip}</td>
                  <td className="admin-wrap">{REASON_LABEL[event.reason] ?? event.reason}{event.detail ? <span className="owner-email">{event.detail}</span> : null}</td>
                  <td className="mono guard-path" title={event.path}>{event.path}</td>
                  <td className="mono">{numberFormat.format(event.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} size={EVENTS_PAGE} onPage={setPage} />}
      <p className="field-hint" style={{ margin: 0 }}>Хранится только маскированный адрес, путь без параметров, причина, число и время — без тел запросов, e-mail и паролей. Записи старше 30 дней удаляются.</p>
    </section>
  )
}

function HealthSection({ data }: { data: SecurityView }) {
  const uptime = data.uptimeSec >= 86_400 ? `${Math.floor(data.uptimeSec / 86_400)} дн. ${Math.floor((data.uptimeSec % 86_400) / 3600)} ч` : data.uptimeSec >= 3600 ? `${Math.floor(data.uptimeSec / 3600)} ч ${Math.floor((data.uptimeSec % 3600) / 60)} мин` : `${Math.floor(data.uptimeSec / 60)} мин`
  const check = data.database.quickCheck
  return (
    <section className="admin-section" aria-labelledby="guard-health-title">
      <div className="admin-section-head"><h2 className="panel-title" id="guard-health-title"><HardDrive aria-hidden="true" />Состояние сервера</h2></div>
      <dl className="admin-facts">
        <div><dt>Работает без перезапуска</dt><dd>{uptime}</dd></div>
        <div><dt>Память</dt><dd className="mono">{data.memory.rssMb} МБ</dd></div>
        <div><dt>Задержка обработки</dt><dd className="mono">{data.eventLoop.p99Ms} мс (p99)</dd></div>
        <div><dt>База данных</dt><dd className="mono">{megabytes(data.database.bytes + data.database.walBytes)}</dd></div>
        <div><dt>Проверка базы (раз в час)</dt><dd>{check ? <><span className={`tag ${check.ok ? 'green' : 'danger'}`}>{check.ok ? 'в порядке' : 'не прошла'}</span> <span className="muted guard-small">{dateTime.format(new Date(check.at))}</span></> : <span className="muted">ещё не проводилась</span>}</dd></div>
        <div><dt>Необработанные ошибки за час</dt><dd className="mono">{data.unhandled.exceptions60m + data.unhandled.rejections60m}{data.unhandled.last ? <span className="owner-email guard-wrap">{data.unhandled.last.message}</span> : null}</dd></div>
      </dl>
      {check && !check.ok && <Notice tone="error" title="Проверка целостности базы не прошла">{check.result}. Автоматически ничего не восстанавливается: остановите сервер и восстановите последнюю копию по инструкции docs/server-guard.md («Как восстановить копию»).</Notice>}
      {data.backupFiles.length > 0 && (
        <details className="guard-details">
          <summary>Резервные копии ({data.backupFiles.length})</summary>
          <ul className="admin-list">
            {data.backupFiles.map((file) => <li key={file.name} className="mono">{dateTime.format(new Date(file.at))} · {file.kind === 'daily' ? 'ежедневная' : file.kind === 'before-restart' ? 'перед перезапуском' : 'вручную'} · {megabytes(file.bytes)} · {file.name}</li>)}
          </ul>
        </details>
      )}
    </section>
  )
}

function AllowlistSection({ data, onChange }: { data: SecurityView; onChange: (next: SecurityView) => void }) {
  const [ip, setIp] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const action = useAction()
  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!ip.trim()) return
    setBusy('add')
    setError(null)
    void action((token) => securityApi.allow(token, ip.trim(), note.trim() || undefined))
      .then((result) => { if (result) { onChange({ ...data, allowlist: result.allowlist, bans: result.bans }); setIp(''); setNote('') } }, (reason: unknown) => setError(failure(reason)))
      .finally(() => setBusy(null))
  }
  const remove = (id: string) => {
    setBusy(id)
    setError(null)
    void action((token) => securityApi.disallow(token, id))
      .then((result) => { if (result) onChange({ ...data, allowlist: result.allowlist }) }, (reason: unknown) => setError(failure(reason)))
      .finally(() => setBusy(null))
  }
  return (
    <section className="admin-section" aria-labelledby="guard-allow-title">
      <div className="admin-section-head">
        <h2 className="panel-title" id="guard-allow-title"><ShieldOff aria-hidden="true" />Белый список</h2>
        <span className="muted guard-small">Эти адреса никогда не блокируются. Этот компьютер (127.0.0.1) — всегда.</span>
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {data.allowlist.length === 0 ? <div className="muted admin-empty">Список пуст.</div> : (
        <ul className="guard-allow">
          {data.allowlist.map((entry) => (
            <li key={entry.id}>
              <span className="mono">{entry.ip}</span>
              <span className="muted">{entry.note ?? (entry.source === 'env' ? 'из настроек сервера (TARKOV_GUARD_ALLOWLIST)' : '')}</span>
              {entry.source === 'admin' && <button type="button" className="button small ghost" disabled={busy !== null} onClick={() => remove(entry.id)}>{busy === entry.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Убрать</button>}
            </li>
          ))}
        </ul>
      )}
      <form className="guard-form" onSubmit={add} aria-label="Добавить адрес в белый список">
        <label className="guard-field"><span className="field-label">IP-адрес</span><input className="input mono" value={ip} onChange={(event) => setIp(event.target.value)} placeholder="198.51.100.20" maxLength={64} required /></label>
        <label className="guard-field guard-grow"><span className="field-label">Заметка</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={120} placeholder="например: мой домашний адрес" /></label>
        <button type="submit" className="button ghost" disabled={busy !== null || !ip.trim()}>{busy === 'add' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}Добавить</button>
      </form>
    </section>
  )
}

/** Runs a write with the current session (null when signed out meanwhile). */
function useAction() {
  const { token } = useAuth()
  return useCallback(<T,>(work: (token: string) => Promise<T>) => (token ? work(token) : Promise.resolve(null)), [token])
}
