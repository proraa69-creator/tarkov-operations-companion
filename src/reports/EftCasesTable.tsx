import { useCallback, useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'

/**
 * «Отчёты» → «Аккаунты Таркова» (owner, 15.11.2026: «если опять входят через уже активированный, но удалённый аккаунт… какой
 * первый аккаунт, какая почта, потом актуальный сейчас, номер Таркова»): the cases of server/src/services/eftLedger.ts —
 * a game account bound to a new Raid OS account after its earlier account was deleted. The same table on the site, in the
 * owner app and on the phone; each host gives its own requests. A deleted account's e-mail is masked: deleting removes it.
 */
export type EftCaseStatus = 'active' | 'working' | 'closed'
export interface EftCaseAccount {
  accountId: string; email: string | null; deleted: boolean; createdAt?: string; boundAt: string; goneAt?: string; goneReason?: 'deleted' | 'unbound'; trialByThisGame: boolean
}
export interface EftCase {
  id: number; createdAt: string; status: EftCaseStatus; eft: string; eftKey: string
  current: EftCaseAccount & { trialDenied: boolean }
  previous: EftCaseAccount[]
}
export interface EftCasesPage { rows: EftCase[]; counts: Record<EftCaseStatus, number> }

type Translate = (text: string) => string
const same: Translate = (text) => text
const DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const when = (iso?: string) => { if (!iso) return ''; try { return DATE.format(new Date(iso)) } catch { return '' } }

const VIEWS: Array<{ id: EftCaseStatus; label: string; empty: string }> = [
  { id: 'active', label: 'Активные', empty: 'Новых случаев нет.' },
  { id: 'working', label: 'В процессе', empty: 'Случаев в процессе нет.' },
  { id: 'closed', label: 'Закрытые', empty: 'Закрытых случаев нет.' },
]
const ACTIONS: Record<EftCaseStatus, Array<{ to: EftCaseStatus; label: string }>> = {
  active: [{ to: 'working', label: 'Взять' }, { to: 'closed', label: 'Закрыть' }],
  working: [{ to: 'closed', label: 'Закрыть' }, { to: 'active', label: 'Вернуть' }],
  closed: [{ to: 'active', label: 'Вернуть' }],
}

export function EftCasesTable({ load, setStatus, t = same, reloadKey = 0 }: {
  load: (view: EftCaseStatus) => Promise<EftCasesPage>
  setStatus: (id: number, status: EftCaseStatus) => Promise<unknown>
  t?: Translate
  /** Changes when the server says something moved (the reports' long polling): the list reads itself again. */
  reloadKey?: number
}) {
  const [view, setView] = useState<EftCaseStatus>('active')
  const [page, setPage] = useState<EftCasesPage | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const failed = (reason: unknown) => setError(reason instanceof Error && reason.message ? reason.message : 'Сервер недоступен')
  const read = useCallback(() => load(view).then((next) => { setPage(next); setError('') }), [load, view])
  useEffect(() => {
    let live = true
    load(view).then((next) => { if (live) { setPage(next); setError('') } }, (reason: unknown) => { if (live) failed(reason) })
    return () => { live = false }
  }, [load, view, reloadKey])

  const move = async (id: number, to: EftCaseStatus) => {
    setBusy(id)
    try { await setStatus(id, to); await read() } catch (reason) { failed(reason) } finally { setBusy(null) }
  }
  const rows = page?.rows ?? []
  return <div className="rt-eft">
    <div className="rt-views" role="group" aria-label={t('Какие случаи показать')}>
      {VIEWS.map(({ id, label }) => <button key={id} type="button" className={`button small ${view === id ? 'primary' : 'ghost'}`} aria-pressed={view === id} onClick={() => setView(id)}>
        {t(label)}{page ? <span className="rt-count"> · {page.counts[id] ?? 0}</span> : null}
      </button>)}
    </div>
    {error && <p className="rt-error" role="alert">{t(error)}</p>}
    {!page && !error && <p className="rt-empty"><LoaderCircle size={14} className="spin spinner" aria-hidden="true" /> {t('Загружаем…')}</p>}
    {page && rows.length === 0 && <p className="rt-empty">{t(VIEWS.find(({ id }) => id === view)!.empty)}</p>}
    {rows.length > 0 && <table className="rt-table rt-eft-table">
      <thead><tr><th scope="col">№</th><th scope="col">{t('Аккаунт Таркова')}</th><th scope="col">{t('Сейчас')}</th><th scope="col">{t('Раньше')}</th><th scope="col">{t('Статус')}</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} data-testid="eft-case">
        <td><b>{row.id}</b><br /><small className="dim">{when(row.createdAt)}</small></td>
        <td><b className="mono">{row.eft}</b><br /><small className="dim mono" title={t('Один и тот же аккаунт Таркова в разных случаях')}>#{row.eftKey}</small></td>
        <td>
          <div>{row.current.email ?? t('нет почты')}</div>
          <small className="dim">{t('Аккаунт создан')} {when(row.current.createdAt)} · {t('Таркова привязан')} {when(row.current.boundAt)}</small>
          <div><small>{row.current.trialDenied ? t('Бонусные дни: не выданы (уже были у этого аккаунта Таркова)') : row.current.trialByThisGame ? t('Бонусные дни: выданы') : t('Бонусные дни: нет')}</small></div>
        </td>
        <td>{row.previous.map((entry) => <div key={entry.accountId} className="rt-eft-previous">
          <div>{entry.email ?? t('почта неизвестна')}</div>
          <small className="dim">
            {t('Таркова привязан')} {when(entry.boundAt)}
            {entry.goneAt ? <> · {t(entry.goneReason === 'unbound' ? 'отвязан' : 'удалён')} {when(entry.goneAt)}</> : null}
            {entry.trialByThisGame ? <> · {t('брал бонусные дни')}</> : null}
          </small>
        </div>)}</td>
        <td>
          <div className="rt-actions">{ACTIONS[row.status].map((action) => <button key={action.to} type="button" className="button small ghost" disabled={busy === row.id} onClick={() => void move(row.id, action.to)}>{t(action.label)}</button>)}</div>
        </td>
      </tr>)}</tbody>
    </table>}
  </div>
}
