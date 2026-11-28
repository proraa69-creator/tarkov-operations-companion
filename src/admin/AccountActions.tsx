import { useState } from 'react'
import { AtSign, CalendarMinus, CalendarPlus, KeyRound, LoaderCircle, Unlink, Wrench } from 'lucide-react'
import type { AdminAccountProfile } from './adminApi'

/**
 * «Действия» of a player's profile (owner, 28.11.2026: «нужно что бы в профиле можно было использовать функции отвязать
 * аккаунт таркова, изменить почту, дать ссылку на смену пароля итд. выдать дни сделай проще и без окна подписи за что,
 * окно количества дней, по умолчанию 1 … одно окно и кнопка выдать, все. списать тоже самое»): the days in one box with
 * one button, then the account's own commands. Each asks the server (POST, server/src/routes/ownerAdmin.ts) and the
 * profile is read again after it. Without `call` the profile only reads, and this card is not shown (AccountProfile.tsx).
 */
export type AccountCall = (path: string, body?: unknown) => Promise<unknown>

/** What the owner's log writes for days given or taken here: the owner asked for no reason box. */
const GRANT_REASON = 'выдано в админ-панели'
const REVOKE_REASON = 'списано в админ-панели'
const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason ?? ''))

export function AccountActions({ data, tr, dateTime, date, call, onDone, cardRef }: {
  data: AdminAccountProfile
  tr: (ru: string, en: string) => string
  dateTime: (iso?: string) => string
  date: (iso?: string) => string
  call: AccountCall
  onDone: () => void
  cardRef: (element: HTMLElement | null) => void
}) {
  const { account, subscription } = data
  const [give, setGive] = useState('1')
  const [take, setTake] = useState('1')
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const path = (tail: string) => `/v1/accounts/me/admin/users/${encodeURIComponent(account.id)}/${tail}`

  const run = async (what: string, tail: string, body: unknown, after: string) => {
    setBusy(what); setError(''); setDone(''); setLink('')
    try {
      await call(path(tail), body)
      setDone(after)
      onDone()
    } catch (reason) {
      setError(messageOf(reason) || tr('Сервер недоступен', 'The server is unavailable'))
    } finally {
      setBusy('')
    }
  }
  const countOf = (value: string) => {
    const number = Number(value)
    return Number.isInteger(number) && number >= 1 && number <= 3650 ? number : null
  }
  const grant = () => {
    const number = countOf(give)
    if (!number) { setError(tr('Число дней: от 1 до 3650.', 'Days: 1 to 3650.')); return }
    void run('grant', 'grant', { days: number, reason: GRANT_REASON }, tr(`Выдано дней: ${number}`, `Days given: ${number}`))
  }
  const revoke = () => {
    const number = countOf(take)
    if (!number) { setError(tr('Число дней: от 1 до 3650.', 'Days: 1 to 3650.')); return }
    if (!window.confirm(tr(`Списать ${number} дн. подписки?`, `Take ${number} day(s) off the subscription?`))) return
    void run('revoke', 'revoke', { days: number, reason: REVOKE_REASON }, tr(`Списано дней: ${number}`, `Days taken: ${number}`))
  }
  const changeEmail = () => {
    const now = account.email ?? ''
    const typed = window.prompt(tr(`Новый e-mail вместо ${now}. Пароль, подписка и данные сохранятся.`, `New e-mail instead of ${now}. The password, subscription and data stay.`), now)
    const next = typed?.trim().toLowerCase()
    if (!next || next === now.toLowerCase()) return
    void run('email', 'email', { email: next }, tr(`E-mail изменён: ${next}`, `E-mail changed: ${next}`))
  }
  const unbind = () => {
    if (!window.confirm(tr('Отвязать аккаунт Escape from Tarkov? Приложение привяжет аккаунт игры заново при следующем входе.', 'Unlink the Escape from Tarkov account? The app binds the game account again at the next sign-in.'))) return
    void run('eft', 'eft-account/unbind', undefined, tr('Аккаунт Escape from Tarkov отвязан', 'The Escape from Tarkov account is unlinked'))
  }
  /** «Ссылка на смену пароля»: 48 hours, copied at once and shown below in case the clipboard refused. */
  const passwordLink = async () => {
    setBusy('password'); setError(''); setDone(''); setLink('')
    try {
      const answer = await call(path('password-link')) as { url?: string; expiresAt?: string }
      const url = String(answer?.url ?? '')
      if (!url) throw new Error(tr('Сервер не дал ссылку', 'The server gave no link'))
      setLink(url)
      const copied = await Promise.resolve().then(() => navigator.clipboard.writeText(url)).then(() => true, () => false)
      const until = answer?.expiresAt ? dateTime(answer.expiresAt) : ''
      setDone(tr(
        `${copied ? 'Ссылка скопирована' : 'Скопируйте ссылку ниже'}${until ? `: действует до ${until}` : ''}`,
        `${copied ? 'The link is copied' : 'Copy the link below'}${until ? `: valid until ${until}` : ''}`,
      ))
    } catch (reason) {
      setError(messageOf(reason) || tr('Сервер недоступен', 'The server is unavailable'))
    } finally {
      setBusy('')
    }
  }

  const working = busy !== ''
  const owner = Boolean(account.owner)
  const gone = Boolean(account.deleted)
  const spin = (what: string) => busy === what
  return (
    <section ref={cardRef} className="account-profile-card is-actions" aria-labelledby="account-profile-actions">
      <h3 id="account-profile-actions"><Wrench size={15} aria-hidden="true" />{tr('Действия', 'Actions')}</h3>
      <div className="account-actions">
        <div className="account-action-row">
          <label className="account-action-days">
            <span>{tr('Выдать дней', 'Give days')}</span>
            <input className="input mono" inputMode="numeric" value={give} onChange={(event) => setGive(event.target.value.replace(/\D/g, '').slice(0, 4))} aria-label={tr('Сколько дней выдать', 'How many days to give')} />
          </label>
          <button type="button" className="button small primary" disabled={working || gone} onClick={grant}>
            {spin('grant') ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <CalendarPlus size={14} aria-hidden="true" />}{tr('Выдать', 'Give')}
          </button>
        </div>
        <div className="account-action-row">
          <label className="account-action-days">
            <span>{tr('Списать дней', 'Take days')}</span>
            <input className="input mono" inputMode="numeric" value={take} onChange={(event) => setTake(event.target.value.replace(/\D/g, '').slice(0, 4))} aria-label={tr('Сколько дней списать', 'How many days to take')} />
          </label>
          <button type="button" className="button small ghost account-action-danger" disabled={working || gone || subscription.status !== 'active' || Boolean(subscription.lifetime)} onClick={revoke}>
            {spin('revoke') ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <CalendarMinus size={14} aria-hidden="true" />}{tr('Списать', 'Take')}
          </button>
        </div>
        <div className="account-action-buttons">
          <button type="button" className="button small ghost" disabled={working || owner || gone} onClick={changeEmail}>
            {spin('email') ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <AtSign size={14} aria-hidden="true" />}{tr('Изменить почту', 'Change the e-mail')}
          </button>
          <button type="button" className="button small ghost" disabled={working || owner || gone || Boolean(account.blockedAt)} onClick={() => void passwordLink()}>
            {spin('password') ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />}{tr('Ссылка на смену пароля', 'Password reset link')}
          </button>
          {account.eftAccount && (
            <button type="button" className="button small ghost account-action-danger" disabled={working || gone} onClick={unbind}>
              {spin('eft') ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Unlink size={14} aria-hidden="true" />}{tr('Отвязать аккаунт Таркова', 'Unlink the Tarkov account')}
            </button>
          )}
        </div>
        {account.eftAccount && <small className="account-action-hint">{tr(`Аккаунт игры ${account.eftAccount.masked}, привязан ${date(account.eftAccount.boundAt)}`, `Game account ${account.eftAccount.masked}, bound ${date(account.eftAccount.boundAt)}`)}</small>}
        {done && <p className="account-action-done" role="status">{done}</p>}
        {link && <p className="account-action-link"><code>{link}</code></p>}
        {error && <p className="account-action-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
