import { MessageCircle, SendHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { tr } from '../i18n'
import { loadGuestToken, markSupportRead, readSupport, sendSupport, SUPPORT_TEXT_MAX, SupportChatError, type SupportMessage, type SupportWho } from '../supportChatApi'
import './supportWidget.css'

/** The conversation is read this often while the chat is open, and while it is closed (for the badge) once it exists. */
const OPEN_EVERY_MS = 8_000
const CLOSED_EVERY_MS = 60_000

/**
 * «Поддержка» (owner, 17.11.2026): a round button in the bottom right corner opens the chat. A signed-in visitor writes from
 * the account (the same conversation as in the app); anyone else as a guest. The owner answers from «Заявки» → «Чаты».
 */
export function SupportWidget() {
  const { token, account, status } = useAuth()
  const [open, setOpen] = useState(false)
  const [guestToken, setGuestToken] = useState(loadGuestToken)
  /** The conversation as last read, and whose it is: another visitor's (signed out, signed in) is never shown. */
  const [page, setPage] = useState<{ key: string; messages: SupportMessage[]; unread: number }>({ key: '', messages: [], unread: 0 })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const signedIn = Boolean(token && account)
  const embedded = token === 'owner-app'
  // while the session is still being checked, nothing is read as a guest
  const who: SupportWho | null = signedIn ? { kind: 'account', token: token! } : status === 'loading' && token ? null : { kind: 'guest', token: guestToken }
  const whoKey = who ? `${who.kind}:${who.token ?? ''}` : ''
  const shown = page.key === whoKey ? page : { key: whoKey, messages: [] as SupportMessage[], unread: 0 }
  const { messages, unread } = shown

  const refresh = useCallback(async (current: SupportWho, key: string, markRead: boolean) => {
    try {
      const read = await readSupport(current)
      setPage({ key, messages: read.messages, unread: markRead ? 0 : read.unread })
      if (markRead && read.unread) await markSupportRead(current)
    } catch { /* the next read catches up */ }
  }, [])

  // reads on opening, then on a timer; closed, only when there is a conversation to bring an answer
  useEffect(() => {
    if (!who) return
    if (who.kind === 'guest' && !who.token) return
    const first = window.setTimeout(() => void refresh(who, whoKey, open), 0)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(who, whoKey, open) }, open ? OPEN_EVERY_MS : CLOSED_EVERY_MS)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `who` is rebuilt every render; its key says when it changed
  }, [whoKey, open, refresh])

  useLayoutEffect(() => {
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [open, messages.length])

  useEffect(() => {
    if (!open) return
    input.current?.focus({ preventScroll: true })
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || sending || !who) return
    setSending(true)
    setError('')
    try {
      const sent = await sendSupport(who, text)
      if (sent.guestToken && sent.guestToken !== guestToken) setGuestToken(sent.guestToken)
      const key = sent.guestToken ? `guest:${sent.guestToken}` : whoKey
      setPage((current) => {
        const list = current.key === key ? current.messages : messages
        return { key, unread: 0, messages: list.some((message) => message.id === sent.message.id) ? list : [...list, sent.message] }
      })
      setDraft('')
    } catch (problem) {
      setError(tr(problem instanceof SupportChatError ? problem.message : 'Не удалось отправить. Попробуйте ещё раз.'))
    } finally {
      setSending(false)
    }
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
  }

  // the site's admin tabs inside the owner app answer chats there, not here
  if (embedded) return null
  return (
    <div className={`support-widget${open ? ' is-open' : ''}`}>
      <section className="support-panel" role="dialog" aria-label={tr('Поддержка')} aria-hidden={!open} inert={!open}>
        <header className="support-panel-head">
          <div>
            <strong>{tr('Поддержка')}</strong>
            <small>{signedIn ? tr('Вы пишете из аккаунта {email}', { email: account!.email }) : <>{tr('Вы пишете как гость')} · <Link to="/login" onClick={() => setOpen(false)}>{tr('Войти')}</Link></>}</small>
          </div>
          <button type="button" className="support-close" aria-label={tr('Закрыть')} onClick={() => setOpen(false)}><X size={18} /></button>
        </header>
        <div className="support-messages" ref={list} aria-live="polite">
          {messages.length === 0
            ? <p className="support-empty">{tr('Задайте любой вопрос — ответим здесь.')}</p>
            : messages.map((message) => (
              <div key={message.id} className={`support-message ${message.author === 'owner' ? 'from-us' : 'from-you'}`}>
                {message.author === 'owner' && <span className="support-author">Raid OS</span>}
                <p>{message.text}</p>
                <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
            ))}
        </div>
        {error && <p className="support-error" role="alert">{error}</p>}
        <form className="support-form" onSubmit={(event) => void send(event)}>
          <textarea ref={input} value={draft} rows={1} maxLength={SUPPORT_TEXT_MAX} placeholder={tr('Ваш вопрос')} aria-label={tr('Ваш вопрос')}
            onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} />
          <button type="submit" className="support-send" disabled={!draft.trim() || sending} aria-label={tr('Отправить')}><SendHorizontal size={18} /></button>
        </form>
      </section>
      <button type="button" className="support-fab" aria-label={tr(open ? 'Закрыть поддержку' : 'Поддержка')} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="support-fab-icon" key={open ? 'x' : 'chat'}>{open ? <X size={24} /> : <MessageCircle size={24} />}</span>
        {!open && unread > 0 && <span className="support-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </div>
  )
}
