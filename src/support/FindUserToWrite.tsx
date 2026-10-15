import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Search, SquarePen, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { cleanIpcError } from '../sync/serverSync'
import { REGION_NAMES, type NoticeRegion } from '../shared/notices'

/** One account found by «Написать пользователю» (server/src/routes/supportChat.ts GET …/support/search). */
export interface FoundUser {
  id: string
  email: string
  nickname?: string
  country?: string
  countryOther?: string
  region: NoticeRegion
  subscription: { status: 'active' | 'trial' | 'inactive' | 'lifetime'; paidUntil?: string; trialEndsAt?: string }
  hasThread: boolean
}

const SUBSCRIPTION: Record<FoundUser['subscription']['status'], string> = { active: 'Подписка', trial: 'Пробный период', inactive: 'Без подписки', lifetime: 'Стример' }
/** Typing pauses this long before the server is asked. */
const DEBOUNCE_MS = 300

/**
 * «Написать пользователю» in «Заявки» → «Чаты» (owner, 15.10.2026: «сделай что бы прям в приложении я мог найти человека
 * по почте и написать ему»): part of an e-mail finds up to 20 accounts (the owner-only search of the server), each with
 * the nickname, the region and the subscription; picking one opens that account's conversation, empty or not, where the
 * owner writes first. The player gets it as any answer of the support chat (the toast and the badge).
 */
export function FindUserToWrite({ onPick }: { onPick: (accountId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<FoundUser[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) field.current?.focus() }, [open])
  useEffect(() => {
    const text = query.trim()
    const request = window.tarkovDesktop?.serviceRequest
    if (!open || text.length < 2 || !request) return
    let alive = true
    const timer = window.setTimeout(() => {
      setBusy(true)
      request('GET', `/v1/accounts/me/admin/support/search?q=${encodeURIComponent(text)}`).then((answer) => {
        if (!alive) return
        setUsers((answer as { users?: FoundUser[] } | null)?.users ?? [])
        setError('')
      }, (reason: unknown) => { if (alive) setError(cleanIpcError(reason)) }).finally(() => { if (alive) setBusy(false) })
    }, DEBOUNCE_MS)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [open, query])

  if (!open) {
    return <button type="button" className="button small owner-find-user-open" onClick={() => setOpen(true)}><SquarePen size={13} />{uiText('Написать пользователю')}</button>
  }
  const shown = query.trim().length >= 2 ? users : null
  return (
    <div className="owner-find-user" role="search">
      <div className="owner-find-user-field">
        <Search size={14} aria-hidden="true" />
        <input ref={field} className="input" type="search" value={query} aria-label={uiText('Почта пользователя')} placeholder={uiText('Почта пользователя')} autoComplete="off" spellCheck={false}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); setQuery(''); setUsers(null) } }} />
        {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
        <button type="button" className="icon-button owner-find-user-close" aria-label={uiText('Закрыть поиск')} onClick={() => { setOpen(false); setQuery(''); setUsers(null) }}><X size={14} /></button>
      </div>
      {error && <p className="account-error" role="alert">{uiText(error)}</p>}
      {shown && !shown.length && !busy && <p className="dim owner-find-user-empty">{uiText('Никого не нашли.')}</p>}
      {shown && shown.length > 0 && (
        <ul className="owner-find-user-list" aria-label={uiText('Найденные пользователи')}>
          {shown.map((user) => (
            <li key={user.id}>
              <button type="button" className="owner-chat-item owner-find-user-item" onClick={() => { onPick(user.id); setOpen(false); setQuery(''); setUsers(null) }}>
                <span className="owner-chat-name">{user.email}</span>
                <span className="owner-chat-preview">
                  {[user.nickname, user.countryOther ? `«${user.countryOther}»` : user.country, uiText(REGION_NAMES[user.region]), uiText(SUBSCRIPTION[user.subscription.status])].filter(Boolean).join(' · ')}
                  {user.hasThread ? ` · ${uiText('есть переписка')}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
