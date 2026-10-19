import { CheckCircle2, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { api, ApiError, type AdminBoostyConfirm, type AdminBoostyReviewItem, type BoostyOfferKey } from '../../api'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { dateTime, failure, useAdminData, type Failure } from './adminData'

const OFFER_LABEL: Record<BoostyOfferKey, string> = {
  WORLD_STANDARD: 'Мир — обычная', WORLD_FRIEND: 'Мир — скидка друга', CIS_STANDARD: 'СНГ — обычная', CIS_FRIEND: 'СНГ — скидка друга',
}
const OFFER_KEYS = Object.keys(OFFER_LABEL) as BoostyOfferKey[]
const when = (iso?: string) => (iso ? dateTime.format(new Date(iso)) : '—')
const rubles = (value: string) => Number(value.trim().replace(/\s/g, '').replace(',', '.'))

interface Draft { email: string; offer: BoostyOfferKey | ''; period: 'months' | 'days'; months: '1' | '3' | '6' | '12'; days: string; amount: string; net: string; reference: string; reviewId?: number }
const EMPTY: Draft = { email: '', offer: '', period: 'months', months: '1', days: '', amount: '', net: '', reference: '' }

/**
 * «Boosty» (payments tab): «Подтвердить оплату Boosty» by hand — folded behind one button (owner, 20.10.2026: «блок должен
 * быть свёрнутый, просто кнопка жёлтая») — with months or days, the sum paid and the sum left after the commission; a
 * region that does not match the account is said first, then «Выдать с перерасчётом» issues the days the sum is worth
 * (server/src/services/boosty.ts confirm). The Boosty session token and the automatic issuance are not shown any more
 * (owner, 20.10.2026: «этот блок удали, оставь только ручную»); payments the server put on review are listed while any.
 */
export function AdminBoosty() {
  const panel = useAdminData(useCallback((token: string) => api.adminBoosty(token), []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [open, setOpen] = useState(false)
  const [mismatch, setMismatch] = useState<string | null>(null)
  const [done, setDone] = useState('')
  const token = panel.token
  const data = panel.data

  async function act(run: (token: string) => Promise<unknown>) {
    if (!token) return
    setBusy(true)
    setError(null)
    try { await run(token); await panel.reload() } catch (reason) {
      // Another region than the account's: said in words, then «Выдать с перерасчётом».
      if (reason instanceof ApiError && reason.code === 'region_mismatch') setMismatch(reason.message)
      else setError(failure(reason))
    } finally { setBusy(false) }
  }

  function fromReview(item: AdminBoostyReviewItem) {
    setDone('')
    setMismatch(null)
    setOpen(true)
    setDraft({ ...EMPTY, email: item.email, offer: item.offerKey ?? '', reviewId: item.id, ...(item.price ? { amount: String(item.price) } : {}) })
  }

  async function confirm(recalculate = false) {
    if (!draft.offer) return
    const offer = draft.offer
    const days = Number(draft.days)
    const input: AdminBoostyConfirm = {
      email: draft.email.trim(), offer: offer.endsWith('FRIEND') ? 'friend' : 'standard', region: offer.startsWith('CIS') ? 'CIS' : 'WORLD',
      ...(draft.period === 'months' ? { months: Number(draft.months) as 1 | 3 | 6 | 12 } : { days }),
      ...(draft.amount.trim() ? { amount: rubles(draft.amount) } : {}),
      ...(draft.net.trim() ? { netAmount: rubles(draft.net) } : {}),
      ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
      ...(draft.reviewId ? { reviewId: draft.reviewId } : {}),
      ...(recalculate ? { recalculate: true } : {}),
    }
    setDone('')
    await act(async (t) => {
      const answer = await api.adminBoostyConfirm(t, input)
      const extra = answer.recalculatedDays !== undefined ? ` · с перерасчётом: ${answer.recalculatedDays} дн.` : ''
      setDone(`Выдано: ${answer.payment.email ?? input.email}, подписка до ${when(answer.payment.paidUntilAfter)}${extra}`)
      setDraft(EMPTY)
      setMismatch(null)
      setOpen(false)
    })
  }

  const submit = (event: FormEvent) => { event.preventDefault(); setMismatch(null); void confirm() }
  const daysValid = draft.period === 'months' || (Number.isInteger(Number(draft.days)) && Number(draft.days) >= 1 && Number(draft.days) <= 400)
  const ready = Boolean(draft.offer && draft.email.trim() && daysValid)

  return (
    <section className="panel owner-panel" aria-labelledby="admin-boosty-title">
      <div className="panel-header">
        <div className="panel-title" id="admin-boosty-title">Boosty (СНГ и мир)</div>
        <button type="button" className="button small ghost" onClick={() => void panel.refresh()} disabled={panel.loading}><RefreshCw aria-hidden="true" />Обновить</button>
      </div>
      <div className="panel-body owner-body admin-stack">
        {panel.error && <Notice tone={panel.error.offline ? 'offline' : 'error'} title="Boosty не загрузился">{panel.error.message}</Notice>}
        {!data && !panel.error && <Loading />}
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title="Не получилось">{error.message}</Notice>}
        {done && <Notice tone="success" title="Оплата подтверждена">{done}</Notice>}

        {data && data.review.items.length > 0 && (
          <div>
            <div className="field-label">На проверку ({data.review.total})</div>
            {(
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

        {!open ? (
          <div className="admin-chips">
            <button type="button" className="button primary" onClick={() => { setOpen(true); setDone('') }}><CheckCircle2 aria-hidden="true" />Подтвердить оплату Boosty</button>
          </div>
        ) : (
          <form className="admin-stack" onSubmit={submit} aria-label="Подтвердить оплату Boosty">
            <div className="field-label">Подтвердить оплату Boosty{draft.reviewId ? ` (запись проверки №${draft.reviewId})` : ''}</div>
            <div className="admin-filters">
              <input className="input" type="email" required maxLength={254} placeholder="E-mail аккаунта Raid OS" aria-label="E-mail аккаунта Raid OS" value={draft.email} onChange={(e) => { setMismatch(null); setDraft({ ...draft, email: e.target.value }) }} />
              <select className="input" required aria-label="Предложение" value={draft.offer} onChange={(e) => { setMismatch(null); setDraft({ ...draft, offer: e.target.value as BoostyOfferKey | '' }) }}>
                <option value="">Предложение…</option>
                {OFFER_KEYS.map((key) => <option key={key} value={key}>{OFFER_LABEL[key]}</option>)}
              </select>
              <select className="input" aria-label="Срок" value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value as Draft['period'] })}>
                <option value="months">Месяцы</option>
                <option value="days">Дни</option>
              </select>
              {draft.period === 'months' ? (
                <select className="input" aria-label="Месяцев" value={draft.months} onChange={(e) => setDraft({ ...draft, months: e.target.value as Draft['months'] })}>
                  {['1', '3', '6', '12'].map((value) => <option key={value} value={value}>{value} мес</option>)}
                </select>
              ) : (
                <input className="input" inputMode="numeric" required placeholder="Сколько дней" aria-label="Дней" value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
              )}
              <input className="input" inputMode="decimal" placeholder="Оплатил, ₽" aria-label="Сколько оплатил человек, ₽" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
              <input className="input" inputMode="decimal" placeholder="Чистыми, ₽ (после комиссии)" aria-label="Сколько заработали чистыми, ₽" value={draft.net} onChange={(e) => setDraft({ ...draft, net: e.target.value })} />
              <input className="input" maxLength={120} placeholder="Заметка / номер платежа" aria-label="Заметка" value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
            </div>
            {mismatch && (
              <Notice tone="warn" title="Регион не совпадает с аккаунтом">
                {mismatch}. «Выдать с перерасчётом» — дни по сумме, которую он оплатил, по цене его региона{draft.amount.trim() ? '' : ' (укажите сумму)'}.
              </Notice>
            )}
            <div className="admin-chips">
              <button type="submit" className="button small primary" disabled={busy || !ready}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}Подтвердить оплату Boosty</button>
              {mismatch && <button type="button" className="button small" disabled={busy || !ready || !draft.amount.trim()} onClick={() => void confirm(true)}><RefreshCw aria-hidden="true" />Выдать с перерасчётом</button>}
              <button type="button" className="button small ghost" disabled={busy} onClick={() => { setDraft(EMPTY); setMismatch(null); setOpen(false) }}><X aria-hidden="true" />Свернуть</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
