import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, CheckCheck, LoaderCircle, LogIn, MessagesSquare, RefreshCw, Send, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useMobileLayout } from '../platform'
import { openAccountSignIn } from '../account/accountEvents'
import { SUPPORT_TELEGRAM_HANDLE, SUPPORT_TELEGRAM_URL } from '../app/support'
import { cleanSupportText, SUPPORT_MESSAGE_MAX } from '../shared/supportChat'
import { cleanIpcError } from '../sync/serverSync'
import { openSupportChat, supportTime, useSupportChat, useSupportNotice, type SupportMessage } from './supportChatClient'
import './supportChat.css'

/**
 * «Чат с поддержкой» (owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»): «Связаться» opens
 * the player's conversation with the owner (support/supportChatClient.ts) — a window over the app on the PC, a sheet
 * over the page above the tab bar on the phone. Without an account there is no chat: it asks to sign in. Telegram, the
 * only way before, stays as a small line under it.
 */
export function SupportChatDialog({ onClose }: { onClose: () => void }) {
  const chat = useSupportChat(true)
  const mobile = useMobileLayout()
  useEffect(() => {
    // Captured on the window: over the bug report dialog, Escape closes only the chat.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const title = uiText('Чат с поддержкой')
  // Rendered into <body>: the sidebar it is opened from clips and positions fixed children.
  return createPortal(<div className="registration-overlay support-overlay support-chat-overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="panel registration-dialog support-chat-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header className="support-chat-head">
        <div className="registration-icon"><MessagesSquare size={22} /></div>
        <h2>{title}</h2>
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
      </header>
      {chat.signedIn ? <>
        <SupportMessageList messages={chat.messages} viewer="user" otherName="Raid OS" loading={chat.loading && !chat.loaded} error={chat.loaded ? '' : chat.error} onRetry={() => void chat.reload()} emptyText="Напишите нам — ответим здесь же" />
        {/* No keyboard popping up on the phone the moment the sheet opens. */}
        <SupportComposer onSend={chat.send} placeholder="Ваше сообщение…" autoFocus={!mobile} />
      </> : <div className="support-chat-signin">
        <p className="muted">{uiText(chat.checking ? 'Проверяем аккаунт…' : 'Войдите в аккаунт, чтобы написать нам')}</p>
        {!chat.checking && <button type="button" className="button primary" onClick={() => { onClose(); openAccountSignIn('login') }}><LogIn size={15} />{uiText('Войти')}</button>}
      </div>}
      <p className="support-chat-telegram">{uiText('Или напишите нам в Telegram')} <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">{SUPPORT_TELEGRAM_HANDLE}</a></p>
    </section>
  </div>, document.body)
}

/**
 * «Новое сообщение от поддержки» (owner, 14.10.2026: «так же должно появляться уведомление о том что у человека новое
 * сообщение»): a small note over the app when an answer arrives and no chat window is open — top right under the top bar
 * on the PC, across the top on the phone. It stays until «Открыть» opens the chat (support/supportChatClient.ts
 * openSupportChat) or «×» closes it; either way it comes back only for a newer answer. An answer read on another device,
 * or a conversation the owner deleted, takes it away too. One note at a time, inside the app only: no system
 * notification, no sound. Under the dialogs, so it never covers one.
 */
export function SupportNotice() {
  const { message, dismiss } = useSupportNotice()
  if (!message) return null
  const open = () => {
    dismiss(message.id)
    openSupportChat()
  }
  return createPortal(<div className="support-notice" role="status" aria-live="polite">
    <MessagesSquare size={18} aria-hidden="true" />
    <strong>{uiText('Новое сообщение от поддержки')}</strong>
    <button type="button" className="button small primary" onClick={open}>{uiText('Открыть')}</button>
    <button type="button" className="icon-button support-notice-close" onClick={() => dismiss(message.id)} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={15} /></button>
  </div>, document.body)
}

/**
 * The conversation, oldest first: the reader's own messages on the right with «отправлено» / «прочитано», the other
 * side's on the left under `otherName`. Shared with the owner app's «Чаты» (support/OwnerChats.tsx). The texts are the
 * people's own words: never passed through uiText.
 */
export function SupportMessageList({ messages, viewer, otherName, loading, error, onRetry, emptyText }: {
  messages: SupportMessage[]
  viewer: SupportMessage['author']
  otherName?: string
  loading: boolean
  error: string
  onRetry: () => void
  emptyText: string
}) {
  const { locale } = useLocale()
  const log = useRef<HTMLDivElement>(null)
  const last = messages.at(-1)?.id
  // The newest message in view: on opening and whenever one arrives or is sent.
  useEffect(() => {
    const node = log.current
    if (node) node.scrollTop = node.scrollHeight
  }, [last])
  return (
    <div className="support-chat-log" ref={log} role="log" aria-live="polite" aria-label={uiText('Сообщения')}>
      {messages.length === 0 ? (
        loading ? <p className="support-chat-empty" role="status"><LoaderCircle className="spin" size={18} />{uiText('Загружаем сообщения…')}</p>
          : error ? <div className="support-chat-empty" role="alert"><AlertTriangle size={18} /><span>{uiText(error)}</span><button type="button" className="button small ghost" onClick={onRetry}><RefreshCw size={13} />{uiText('Повторить')}</button></div>
            : <p className="support-chat-empty">{uiText(emptyText)}</p>
      ) : messages.map((message) => {
        const own = message.author === viewer
        const status = message.read ? 'Прочитано' : 'Отправлено'
        return (
          <div key={message.id} className={`support-chat-message${own ? ' is-own' : ''}`}>
            {!own && otherName && <span className="support-chat-author">{otherName}</span>}
            <p className="support-chat-text">{message.text}</p>
            <span className="support-chat-meta">
              <time dateTime={message.createdAt}>{supportTime(message.createdAt, locale)}</time>
              {own && <span className={`support-chat-status${message.read ? ' is-read' : ''}`} role="img" aria-label={uiText(status)} title={uiText(status)}>{message.read ? <CheckCheck size={13} /> : <Check size={13} />}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The box under the conversation: Enter sends, Shift+Enter starts a new line, up to 2000 characters. The text stays
 * when sending fails, with the reason above it.
 */
export function SupportComposer({ onSend, placeholder, autoFocus = false }: { onSend: (text: string) => Promise<unknown>; placeholder: string; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const empty = !cleanSupportText(text)
  const submit = async () => {
    if (empty || sending) return
    setSending(true)
    setError('')
    try {
      await onSend(text)
      setText('')
    } catch (reason) {
      setError(cleanIpcError(reason))
    } finally {
      setSending(false)
      input.current?.focus()
    }
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }
  return (
    <form className="support-chat-compose" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      {error && <div className="support-chat-error" role="alert"><AlertTriangle size={15} /><span>{uiText(error)}</span></div>}
      <div className="support-chat-compose-row">
        {/* Read-only, not disabled, while sending: the cursor stays in the box for the next message. */}
        <textarea
          ref={input}
          className="input support-chat-input"
          value={text}
          rows={2}
          maxLength={SUPPORT_MESSAGE_MAX}
          readOnly={sending}
          autoFocus={autoFocus}
          enterKeyHint="send"
          placeholder={uiText(placeholder)}
          aria-label={uiText('Сообщение')}
          onChange={(event) => { setText(event.target.value); if (error) setError('') }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="button primary" disabled={empty || sending}>
          {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}<span>{uiText(sending ? 'Отправляем…' : 'Отправить')}</span>
        </button>
      </div>
      <div className="support-chat-foot">
        <small className="support-chat-hint">{uiText('Enter — отправить, Shift+Enter — новая строка')}</small>
        {text.length > SUPPORT_MESSAGE_MAX - 200 && <small className="support-chat-count">{text.length} / {SUPPORT_MESSAGE_MAX}</small>}
      </div>
    </form>
  )
}
