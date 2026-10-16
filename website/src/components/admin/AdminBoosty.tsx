import { CheckCircle2, LoaderCircle, Pause, Play, RefreshCw, X } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { api, type AdminBoostyConfirm, type AdminBoostyReviewItem, type BoostyOfferKey } from '../../api'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { dateTime, failure, useAdminData, type Failure } from './adminData'

const OFFER_LABEL: Record<BoostyOfferKey, string> = {
  WORLD_STANDARD: 'Мир — обычная', WORLD_FRIEND: 'Мир — скидка друга', CIS_STANDARD: 'СНГ — обычная', CIS_FRIEND: 'СНГ — скидка друга',
}
const OFFER_KEYS = Object.keys(OFFER_LABEL) as BoostyOfferKey[]
const when = (iso?: string) => (iso ? dateTime.format(new Date(iso)) : '—')

interface Draft { email: string; offer: BoostyOfferKey | ''; period: 'months' | 'date'; months: '1' | '3' | '6' | '12'; paidUntil: string; amount: string; reference: string; reviewId?: number }
const EMPTY: Draft = { email: '', offer: '', period: 'months', months: '1', paidUntil: '', amount: '', reference: '' }

/**
 * «Boosty» (payments tab): the automatic issuance (last check, sanitised error, pause), the review list of payments the
 * rules did not issue, unknown Boosty levels to map, and «Подтвердить оплату Boosty» by hand — the same server path as
 * the sync (server/src/services/boosty.ts grant).
 */
export function AdminBoosty() {
  const panel = useAdminData(useCallback((token: string) => api.adminBoosty(token), []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [done, setDone] = useState('')
  const token = panel.token
  const data = panel.data
  const sync = data?.sync

  async function act(run: (token: string) => Promise<unknown>) {
    if (!token) return
    setBusy(true)
    setError(null)
    try { await run(token); await panel.reload() } catch (reason) { setError(failure(reason)) } finally { setBusy(false) }
  }

  function fromReview(item: AdminBoostyReviewItem) {
    setDone('')
    setDraft({ ...EMPTY, email: item.email, offer: item.offerKey ?? '', reviewId: item.id, ...(item.periodEnd ? { period: 'date', paidUntil: item.periodEnd.slice(0, 10) } : {}), ...(item.price ? { amount: String(item.price) } : {}) })
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (!draft.offer) return
    const offer = draft.offer
    const input: AdminBoostyConfirm = {
      email: draft.email.trim(), offer: offer.endsWith('FRIEND') ? 'friend' : 'standard', region: offer.startsWith('CIS') ? 'CIS' : 'WORLD',
      ...(draft.period === 'months' ? { months: Number(draft.months) as 1 | 3 | 6 | 12 } : { paidUntil: draft.paidUntil }),
      ...(draft.amount.trim() ? { amount: Number(draft.amount.replace(',', '.')) } : {}),
      ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
      ...(draft.reviewId ? { reviewId: draft.reviewId } : {}),
    }
    setDone('')
    await act(async (t) => {
      const answer = await api.adminBoostyConfirm(t, input)
      setDone(`Выдано: ${answer.payment.email ?? input.email}, подписка до ${when(answer.payment.paidUntilAfter)}`)
      setDraft(EMPTY)
    })
  }

  return (
    <section className="panel owner-panel" aria-labelledby="admin-boosty-title">
      <div className="panel-header">
        <div className="panel-title" id="admin-boosty-title">Boosty (СНГ и мир)</div>
        <button type="button" className="button small ghost" onClick={() => void panel.refresh()} disabled={panel.loading}><RefreshCw aria-hidden="true" />Обновить</button>
      </div>
      <div className="panel-body owner-body admin-stack">
        {panel.error && <Notice tone={panel.error.offline ? 'offline' : 'error'} title="Boosty не загрузился">{panel.error.message}</Notice>}
        {!data && !panel.error && <Loading />}
        {sync && (
          <div className="admin-boosty-sync">
            {!sync.configured ? (
              <Notice tone="info" title="Автовыдача выключена">На сервере нет BOOSTY_AUTH и BOOSTY_CLIENT_ID: оплаты подтверждаются вручную ниже.</Notice>
            ) : (
              <>
                {sync.tokenDead && <Notice tone="error" title="Токен Boosty истёк — обновите BOOSTY_AUTH">Автовыдача стоит, пока на сервере не будет новый BOOSTY_AUTH. Подтверждать вручную можно.</Notice>}
                <div className="admin-totals">
                  <span>Автовыдача: <strong>{sync.paused ? 'на паузе' : 'включена'}</strong>{sync.blog ? ` · блог ${sync.blog}` : ''}{sync.periodMinutes ? ` · каждые ${sync.periodMinutes} мин` : ''}</span>
                  <span>Последняя проверка: <strong className="mono">{when(sync.lastSyncAt)}</strong></span>
                  <span>Успешная: <strong className="mono">{when(sync.lastSuccessAt)}</strong></span>
                  {sync.lastResult && <span>Подписчиков: <strong className="mono">{sync.lastResult.active}</strong> · выдано: <strong className="mono">{sync.lastResult.granted + sync.lastResult.adopted}</strong> · на проверку: <strong className="mono">{sync.lastResult.review}</strong></span>}
                </div>
                {sync.lastError && !sync.tokenDead && <Notice tone="warn" title="Последняя ошибка">{sync.lastError}</Notice>}
                <div className="admin-chips">
                  <button type="button" className="button small ghost" disabled={busy} onClick={() => void act((t) => api.adminBoostyPause(t, !sync.paused))}>
                    {sync.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{sync.paused ? 'Снять с паузы' : 'Пауза'}
                  </button>
                  <button type="button" className="button small ghost" disabled={busy || sync.running} onClick={() => void act((t) => api.adminBoostySync(t))}>
                    {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Проверить сейчас
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title="Не получилось">{error.message}</Notice>}
        {done && <Notice tone="success" title="Оплата подтверждена">{done}</Notice>}

        {data && (
          <div>
            <div className="field-label">На проверку ({data.review.total})</div>
            {data.review.items.length === 0 ? <div className="muted admin-empty">Всё выдано: спорных оплат нет.</div> : (
              <div className="table-scroll">
                <table className="pay-table admin-table">
                  <thead><tr><th scope="col">E-mail на Boosty</th><th scope="col">Причина</th><th scope="col">Уровень</th><th scope="col">Оплачено до</th><th scope="col" /></tr></thead>
                  <tbody>
                    {data.review.items.map((item) => (
                      <tr key={item.id}>
                        <td className="mono">{item.email || '—'}</td>
                        <td>{item.reasonText}</td>
                        <td>{item.offerKey ? OFFER_LABEL[item.offerKey] : `${item.levelName ?? ''} (${item.levelId ?? '—'})`}{item.price ? ` · ${item.price} ₽` : ''}</td>
                        <td className="mono">{when(item.periodEnd)}</td>
                        <td><div className="admin-bug-actions">
                          <button type="button" className="button small ghost" disabled={busy} onClick={() => fromReview(item)}><CheckCircle2 aria-hidden="true" />Подтвердить…</button>
                          <button type="button" className="button small ghost" disabled={busy} aria-label={`Скрыть ${item.email}`} onClick={() => void act((t) => api.adminBoostyDismiss(t, item.id))}><X aria-hidden="true" />Скрыть</button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {data && data.levels.length > 0 && (
          <div>
            <div className="field-label">Уровни Boosty вне таблицы предложений</div>
            {data.levels.map((level) => (
              <label key={level.levelId} className="field-hint" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>«{level.name || 'без названия'}» · id {level.levelId} · {level.price} ₽ · подписчиков {level.subscribers}</span>
                <select className="input" aria-label={`Предложение для уровня ${level.levelId}`} value={level.offerKey ?? ''} disabled={busy}
                  onChange={(event) => void act((t) => api.adminBoostyMapLevel(t, level.levelId, (event.target.value || null) as BoostyOfferKey | null))}>
                  <option value="">— не выдавать —</option>
                  {OFFER_KEYS.map((key) => <option key={key} value={key}>{OFFER_LABEL[key]}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}

        <form className="admin-stack" onSubmit={(event) => void confirm(event)} aria-label="Подтвердить оплату Boosty">
          <div className="field-label">Подтвердить оплату Boosty{draft.reviewId ? ` (запись проверки №${draft.reviewId})` : ''}</div>
          <div className="admin-filters">
            <input className="input" type="email" required maxLength={254} placeholder="E-mail аккаунта Raid OS" aria-label="E-mail аккаунта Raid OS" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <select className="input" required aria-label="Предложение" value={draft.offer} onChange={(e) => setDraft({ ...draft, offer: e.target.value as BoostyOfferKey | '' })}>
              <option value="">Предложение…</option>
              {OFFER_KEYS.map((key) => <option key={key} value={key}>{OFFER_LABEL[key]}</option>)}
            </select>
            <select className="input" aria-label="Срок" value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value as Draft['period'] })}>
              <option value="months">Месяцы</option>
              <option value="date">Оплачено до (дата Boosty)</option>
            </select>
            {draft.period === 'months' ? (
              <select className="input" aria-label="Месяцев" value={draft.months} onChange={(e) => setDraft({ ...draft, months: e.target.value as Draft['months'] })}>
                {['1', '3', '6', '12'].map((value) => <option key={value} value={value}>{value} мес</option>)}
              </select>
            ) : (
              <input className="input" type="date" required aria-label="Оплачено до" value={draft.paidUntil} onChange={(e) => setDraft({ ...draft, paidUntil: e.target.value })} />
            )}
            <input className="input" inputMode="decimal" placeholder="Сумма, ₽ (необязательно)" aria-label="Сумма, ₽" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            <input className="input" maxLength={120} placeholder="Заметка / номер платежа" aria-label="Заметка" value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Те же правила, что у автовыдачи: регион предложения = страна аккаунта, скидка друга — только по действующему приглашению (и тратится). Россия — только СБП.</p>
          <div className="admin-chips">
            <button type="submit" className="button small primary" disabled={busy || !draft.offer || !draft.email.trim()}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}Подтвердить оплату Boosty</button>
            {(draft.email || draft.reviewId) && <button type="button" className="button small ghost" disabled={busy} onClick={() => setDraft(EMPTY)}>Очистить</button>}
          </div>
        </form>
      </div>
    </section>
  )
}
