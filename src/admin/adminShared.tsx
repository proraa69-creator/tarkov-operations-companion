import { useState } from 'react'
import { Check, CreditCard, LoaderCircle, Undo2 } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { adminApi, type AdminPayment } from './adminApi'
import { accountText, dateTime, errorText, money, PLAN_LABEL, PROVIDER_TEXT, statusText } from './adminFormat'

/** Where the payer came from (owner, 17.10.2026: «от кого человек пришёл»): a friend with his account, a streamer's code, nobody. */
function originText(payment: AdminPayment) {
  const inviter: { email?: string; nickname?: string; deleted?: true } | undefined = payment.invitedBy ?? (payment.friendDiscount && (payment.friendDiscount.inviter || payment.friendDiscount.inviterDeleted) ? { email: payment.friendDiscount.inviter, deleted: payment.friendDiscount.inviterDeleted } : undefined)
  if (inviter) return `Пришёл по приглашению: ${accountText(inviter.deleted ? undefined : inviter.email, inviter.nickname)}`
  if (payment.friendDiscount) return 'Пришёл по коду друга'
  return payment.referralCode ? `Пришёл по коду стримера ${payment.referralCode}` : 'Пришёл без приглашения'
}

/**
 * A payment in plain words: who paid, where he came from, plan, ЮKassa / BZB, discount; with `onChanged` «Изменить сумму»
 * and «Отметить возврат», as on the site.
 */
export function PaymentRow({ payment, onChanged }: { payment: AdminPayment; onChanged?: () => Promise<unknown> | void }) {
  const [editing, setEditing] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [error, setError] = useState('')
  const details = [PLAN_LABEL[payment.plan], PROVIDER_TEXT[payment.provider] ?? payment.provider, statusText(payment.status), payment.friendDiscount ? `скидка друга −${payment.friendDiscount.percent} %` : ''].filter(Boolean).join(' · ')
  const refund = async () => {
    if (!onChanged || !window.confirm(uiText(`Отметить платёж ${payment.email} как возвращённый?\n\nОплаченные дни будут сняты, доля стримера и награда за друга отменятся.`))) return
    setRefunding(true); setError('')
    try { await adminApi.markRefunded(payment.id); await onChanged() } catch (reason) { setError(errorText(reason)) } finally { setRefunding(false) }
  }
  return <article className={`admin-payment-row${editing ? ' is-editing' : ''}`}>
    <span className={`admin-payment-icon ${payment.status}`}><CreditCard size={18} /></span>
    <span className="admin-row-copy">
      <strong title={payment.email}>{uiText('Оплатил:')} {accountText(payment.email, payment.nickname)}</strong>
      <small className="admin-payment-origin">{uiText(originText(payment))}</small>
      <small>{uiText(details)}</small>
    </span>
    <span className="admin-row-side">
      <strong>{money(payment.amount)}</strong>
      {payment.netAmount !== undefined && payment.netAmount !== payment.amount && <small className="admin-payment-net">{uiText(`чистыми ${money(payment.netAmount)}`)}</small>}
      {payment.amountEdited && <small className="admin-payment-edited">{uiText(`изменено, было ${money(payment.amountEdited.before)}`)}</small>}
      <small>{dateTime(payment.paidAt ?? payment.createdAt)}</small>
      {onChanged && payment.provider !== 'archive' && payment.provider !== 'lava' && !editing && <button type="button" className="button small ghost admin-payment-edit" onClick={() => setEditing(true)}>{uiText('Изменить сумму')}</button>}
      {onChanged && payment.status === 'succeeded' && !editing && <button type="button" className="button small ghost admin-payment-edit" disabled={refunding} onClick={() => void refund()}>{refunding ? <LoaderCircle size={13} className="spin" /> : <Undo2 size={13} />}{uiText('Отметить возврат')}</button>}
    </span>
    {error && <div className="admin-inline-error admin-payment-error">{uiText(error)}</div>}
    {editing && onChanged && <PaymentAmountEditor payment={payment} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await onChanged() }} />}
  </article>
}

/** «Изменить сумму» (owner, 17.10.2026): the new amount, an optional comment, the old amount in sight. */
function PaymentAmountEditor({ payment, onCancel, onSaved }: { payment: AdminPayment; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(String(payment.amount))
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const amount = Number(value.replace(',', '.').replace(/\s/g, ''))
  const valid = value.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000 && Math.abs(Math.round(amount * 100) - amount * 100) < 1e-6
  const save = async () => {
    if (!valid || saving) return
    setSaving(true); setError('')
    try {
      await adminApi.setPaymentAmount(payment.id, amount, comment.trim() || undefined)
      await onSaved()
    } catch (reason) { setError(errorText(reason)); setSaving(false) }
  }
  return <div className="admin-amount-editor">
    <small>{uiText(`Было: ${money(payment.amount)}${payment.amountEdited ? ` (до первого изменения ${money(payment.amountEdited.before)})` : ''}`)}</small>
    <label><span>{uiText('Новая сумма, ₽')}</span><input className="input" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} aria-invalid={!valid} autoFocus /></label>
    <label><span>{uiText('Комментарий (необязательно)')}</span><input className="input" value={comment} maxLength={200} onChange={(event) => setComment(event.target.value)} /></label>
    {error && <div className="admin-inline-error">{uiText(error)}</div>}
    <div className="admin-amount-buttons">
      <button type="button" className="button primary" disabled={!valid || saving} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{uiText('Сохранить')}</button>
      <button type="button" className="button ghost" disabled={saving} onClick={onCancel}>{uiText('Отмена')}</button>
    </div>
  </div>
}

export function AdminLoading() {
  return <div className="admin-loading" role="status"><LoaderCircle size={28} className="spin" /><span>{uiText('Загружаем данные…')}</span></div>
}

export function AdminEmpty({ text }: { text: string }) {
  return <div className="admin-empty"><span>{uiText(text)}</span></div>
}
