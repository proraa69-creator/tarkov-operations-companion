import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

/**
 * «Отчёты» → «Аккаунты Таркова» (owner, 15.11.2026: «если опять входят через уже активированный, но удалённый аккаунт… какой
 * первый аккаунт, какая почта, потом актуальный сейчас, номер Таркова»): the cases of server/src/services/eftLedger.ts —
 * a game account bound to a new Raid OS account after its earlier account was deleted — and, above them, «спор за аккаунт
 * Таркова» (owner, 27.11.2026): one account's app reported a game account another account holds; the owner leaves it as it
 * is, gives the binding to the disputing account or unbinds both. The same table on the site, in the owner app and on the
 * phone; each host gives its own requests. A deleted account's e-mail is masked: deleting removes it.
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
/** How a dispute closed; 'bound' — by itself, the disputing account bound the game account once it was free. */
export type EftDisputeDecision = 'keep' | 'transfer' | 'unbind' | 'bound'
export type EftDisputeChoice = Exclude<EftDisputeDecision, 'bound'>
export interface EftDisputeAccount {
  accountId: string; email: string | null; deleted: boolean; createdAt?: string
  /** Premium now or a payment with money in it (AccountStore.eftStanding). */
  paid: boolean; paidUntil?: string; payments: number; streamer?: true
  /** Its game account now; `disputed`: the one of the case. */
  bound?: { eft: string; at: string; disputed: boolean }
}
export interface EftDispute {
  id: number; kind: 'dispute'; createdAt: string; seenAt: string; status: EftCaseStatus; decision?: EftDisputeDecision; decidedAt?: string
  eft: string; eftKey: string; holder: EftDisputeAccount; disputer: EftDisputeAccount
}
/** `disputes`: servers of 27.11.2026 on. */
export interface EftCasesPage { rows: EftCase[]; counts: Record<EftCaseStatus, number>; disputes?: { rows: EftDispute[]; counts: Record<EftCaseStatus, number> } }
/** The owner's buttons on a dispute (server/src/routes/eftCases.ts); without them a host shows the disputes only. */
export interface EftDisputeActions {
  setStatus: (id: number, status: 'active' | 'working') => Promise<unknown>
  decide: (id: number, decision: EftDisputeChoice) => Promise<unknown>
}

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
const DECISIONS: Array<{ id: EftDisputeChoice; label: string; ask?: string }> = [
  { id: 'keep', label: 'Оставить привязку' },
  { id: 'transfer', label: 'Отдать спорящему', ask: 'Отдать привязку спорящему?' },
  { id: 'unbind', label: 'Снять обе', ask: 'Снять обе привязки?' },
]
const DECIDED: Record<EftDisputeDecision, string> = {
  keep: 'Привязка оставлена', transfer: 'Отдано спорящему', unbind: 'Обе привязки сняты', bound: 'Спорящий привязал сам',
}

/** One side of a dispute: the e-mail, whether it paid; `children` — what the side adds. */
function Side({ who, t, children }: { who: EftDisputeAccount; t: Translate; children?: ReactNode }) {
  return <>
    <div>{who.email ?? t('нет почты')}{who.deleted ? <small className="dim"> · {t('удалён')}</small> : null}</div>
    <div><small className={who.paid ? undefined : 'dim'}>
      {t(who.paid ? 'Оплачен' : 'Не оплачен')}
      {who.paidUntil ? <> · {t('Premium до')} {when(who.paidUntil)}</> : null}
      {who.payments ? <> · {t('платежей:')} {who.payments}</> : null}
      {who.streamer ? <> · {t('стример')}</> : null}
    </small></div>
    {children}
  </>
}

export function EftCasesTable({ load, setStatus, disputes, t = same, reloadKey = 0 }: {
  load: (view: EftCaseStatus) => Promise<EftCasesPage>
  setStatus: (id: number, status: EftCaseStatus) => Promise<unknown>
  disputes?: EftDisputeActions
  t?: Translate
  /** Changes when the server says something moved (the reports' long polling): the list reads itself again. */
  reloadKey?: number
}) {
  const [view, setView] = useState<EftCaseStatus>('active')
  const [page, setPage] = useState<EftCasesPage | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const failed = (reason: unknown) => setError(reason instanceof Error && reason.message ? reason.message : 'Сервер недоступен')
  const read = useCallback(() => load(view).then((next) => { setPage(next); setError('') }), [load, view])
  useEffect(() => {
    let live = true
    load(view).then((next) => { if (live) { setPage(next); setError('') } }, (reason: unknown) => { if (live) failed(reason) })
    return () => { live = false }
  }, [load, view, reloadKey])

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key)
    try { await action(); await read() } catch (reason) { failed(reason) } finally { setBusy(null) }
  }
  const move = (id: number, to: EftCaseStatus) => run(`c${id}`, () => setStatus(id, to))
  const decide = (row: EftDispute, choice: (typeof DECISIONS)[number]) => {
    if (!disputes) return
    if (choice.ask && typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t(choice.ask))) return
    void run(`d${row.id}`, () => disputes.decide(row.id, choice.id))
  }
  const rows = page?.rows ?? []
  const disputed = page?.disputes?.rows ?? []
  const count = (id: EftCaseStatus) => (page?.counts[id] ?? 0) + (page?.disputes?.counts[id] ?? 0)
  return <div className="rt-eft">
    <div className="rt-views" role="group" aria-label={t('Какие случаи показать')}>
      {VIEWS.map(({ id, label }) => <button key={id} type="button" className={`button small ${view === id ? 'primary' : 'ghost'}`} aria-pressed={view === id} onClick={() => setView(id)}>
        {t(label)}{page ? <span className="rt-count"> · {count(id)}</span> : null}
      </button>)}
    </div>
    {error && <p className="rt-error" role="alert">{t(error)}</p>}
    {!page && !error && <p className="rt-empty"><LoaderCircle size={14} className="spin spinner" aria-hidden="true" /> {t('Загружаем…')}</p>}
    {page && rows.length === 0 && disputed.length === 0 && <p className="rt-empty">{t(VIEWS.find(({ id }) => id === view)!.empty)}</p>}
    {disputed.length > 0 && <>
      <h4 className="rt-eft-title">{t('Спор за аккаунт Таркова')}</h4>
      <table className="rt-table rt-eft-table">
        <thead><tr><th scope="col">№</th><th scope="col">{t('Аккаунт Таркова')}</th><th scope="col">{t('Держит')}</th><th scope="col">{t('Спорит')}</th><th scope="col">{t('Статус')}</th></tr></thead>
        <tbody>{disputed.map((row) => <tr key={`d${row.id}`} data-testid="eft-dispute">
          <td><b>{row.id}</b><br /><small className="dim">{when(row.createdAt)}</small></td>
          <td><b className="mono">{row.eft}</b><br /><small className="dim mono" title={t('Один и тот же аккаунт Таркова в разных случаях')}>#{row.eftKey}</small></td>
          <td><Side who={row.holder} t={t}>
            <small className="dim">{row.holder.bound?.disputed ? <>{t('Таркова привязан')} {when(row.holder.bound.at)}</> : t('привязка снята')}</small>
          </Side></td>
          <td><Side who={row.disputer} t={t}>
            <small className="dim">
              {t('Аккаунт создан')} {when(row.disputer.createdAt)}
              {row.seenAt !== row.createdAt ? <> · {t('последний раз')} {when(row.seenAt)}</> : null}
            </small>
            {row.disputer.bound ? <div><small className="dim">{row.disputer.bound.disputed
              ? <>{t('Таркова привязан')} {when(row.disputer.bound.at)}</>
              : <>{t('Свой аккаунт Таркова')} <span className="mono">{row.disputer.bound.eft}</span></>}</small></div> : null}
          </Side></td>
          <td>
            {row.status === 'closed'
              ? <div className="rt-stack">
                <small>{t(DECIDED[row.decision ?? 'keep'])}{row.decidedAt ? <> · {when(row.decidedAt)}</> : null}</small>
                {row.decision === 'keep' && disputes ? <div className="rt-actions"><button type="button" className="button small ghost" disabled={busy === `d${row.id}`} onClick={() => void run(`d${row.id}`, () => disputes.setStatus(row.id, 'active'))}>{t('Вернуть')}</button></div> : null}
              </div>
              : disputes ? <div className="rt-actions">
                {row.status === 'active'
                  ? <button type="button" className="button small ghost" disabled={busy === `d${row.id}`} onClick={() => void run(`d${row.id}`, () => disputes.setStatus(row.id, 'working'))}>{t('Взять')}</button>
                  : <button type="button" className="button small ghost" disabled={busy === `d${row.id}`} onClick={() => void run(`d${row.id}`, () => disputes.setStatus(row.id, 'active'))}>{t('Вернуть')}</button>}
                {DECISIONS.map((choice) => <button key={choice.id} type="button" className="button small ghost" disabled={busy === `d${row.id}` || (choice.id === 'transfer' && row.disputer.deleted)} onClick={() => decide(row, choice)}>{t(choice.label)}</button>)}
              </div> : null}
          </td>
        </tr>)}</tbody>
      </table>
    </>}
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
          <div className="rt-actions">{ACTIONS[row.status].map((action) => <button key={action.to} type="button" className="button small ghost" disabled={busy === `c${row.id}`} onClick={() => void move(row.id, action.to)}>{t(action.label)}</button>)}</div>
        </td>
      </tr>)}</tbody>
    </table>}
  </div>
}
