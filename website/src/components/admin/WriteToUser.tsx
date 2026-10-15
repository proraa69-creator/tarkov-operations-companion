import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, MessageSquare, Send, X } from 'lucide-react'
import { useAuth } from '../../auth'
import { errorMessage } from '../../api'
import { ownerCall } from './noticesApi'
import { dateTime } from './adminData'
import '../../payments.css'

interface ChatMessage { id: number; author: 'user' | 'owner'; text: string; createdAt: string; read: boolean }
const MAX = 2000

/**
 * «Написать» on the website (owner, 15.10.2026: from «Пользователи» and the survey answers): the same conversation as
 * the owner app's «Заявки» → «Чаты» (server/src/routes/supportChat.ts) — its latest messages and a box to write. The
 * player gets it in the app as any answer of the support chat (the toast and the badge); the owner's first message into
 * an empty conversation is audited as «Начат чат с пользователем».
 */
export function WriteToUser({ accountId, email, small = true }: { accountId: string; email: string; small?: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={`button ghost${small ? ' small' : ''}`} onClick={() => setOpen(true)}><MessageSquare aria-hidden="true" />Написать</button>
    {open && <WriteDialog accountId={accountId} email={email} onClose={() => setOpen(false)} />}
  </>
}

function WriteDialog({ accountId, email, onClose }: { accountId: string; email: string; onClose: () => void }) {
  const { token } = useAuth()
  const titleId = useId()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { box.current?.focus() }, [])
  useEffect(() => {
    if (!token) return
    let alive = true
    ownerCall<{ messages?: ChatMessage[] }>(token, 'GET', `/v1/accounts/me/admin/support/threads/${accountId}`).then(
      (answer) => { if (alive) setMessages(answer?.messages ?? []) },
      (reason: unknown) => { if (alive) { setMessages([]); setError(errorMessage(reason)) } },
    )
    return () => { alive = false }
  }, [token, accountId])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!token || !text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const answer = await ownerCall<{ message?: ChatMessage }>(token, 'POST', `/v1/accounts/me/admin/support/threads/${accountId}/messages`, { text })
      if (answer?.message) setMessages((current) => [...(current ?? []), answer.message!])
      setText('')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pay-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose() }}>
      <div className="pay-dialog admin-write-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="pay-dialog-head">
          <div><div className="eyebrow">Чат поддержки</div><h2 id={titleId}>{email}</h2></div>
          <button type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}><X aria-hidden="true" /></button>
        </div>
        <div className="admin-write-messages" aria-live="polite">
          {messages === null ? <span className="muted"><LoaderCircle className="spinner" size={14} aria-hidden="true" /> Загружаем переписку…</span>
            : !messages.length ? <span className="muted">Сообщений пока нет — вы напишете первым.</span>
            : messages.slice(-20).map((message) => (
              <div key={message.id} className={`admin-write-message is-${message.author}`}>
                <span className="admin-write-meta">{message.author === 'owner' ? 'Вы' : 'Игрок'} · {dateTime.format(new Date(message.createdAt))}</span>
                <span>{message.text}</span>
              </div>
            ))}
        </div>
        <form className="admin-write-form" onSubmit={(event) => void send(event)}>
          <textarea ref={box} className="input" rows={3} maxLength={MAX} aria-label="Сообщение" placeholder="Сообщение игроку…" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
          {error && <p className="field-error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div className="pay-dialog-actions">
            <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>{text.length}/{MAX} · игрок увидит его в приложении</span>
            <button type="submit" className="button primary small" disabled={busy || !text.trim()}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Send aria-hidden="true" />}Отправить</button>
          </div>
        </form>
      </div>
    </div>
  )
}
