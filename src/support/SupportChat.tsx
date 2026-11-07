import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, CheckCheck, Copy, ImageOff, LoaderCircle, LogIn, MessagesSquare, Paperclip, RefreshCw, Reply, Send, Smile, Sticker, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useMobileLayout } from '../platform'
import { openAccountSignIn } from '../account/accountEvents'
import { SUPPORT_TELEGRAM_HANDLE, SUPPORT_TELEGRAM_URL } from '../app/support'
import { useFileSink } from '../app/fileSink'
import { cleanSupportText, SUPPORT_IMAGE_LIMITS, SUPPORT_IMAGE_PLACEHOLDER, SUPPORT_IMAGE_TYPES, SUPPORT_MESSAGE_MAX, type SupportAttachment, type SupportReaction, type SupportReplyQuote, type SupportReportRef } from '../shared/supportChat'
import { SUPPORT_REACTIONS, SUPPORT_STICKERS } from '../shared/supportStickers'
import { prepareNoticeImage } from '../notices/imageResize'
import { cleanIpcError } from '../sync/serverSync'
import { ImageViewer, imageViewerOpen } from '../components/ImageViewer'
import { ToastDock, useToastTimer } from '../notifications/ToastDock'
import { openSupportChat, supportAttachmentImage, supportTime, useSupportChat, useSupportNotice, type SupportImageUpload, type SupportMessage, type SupportSendExtra } from './supportChatClient'
import { emojiOnly, quoteBody, replyQuoteOf, stickerCaption, SUPPORT_EMOJI, supportChatLayerOpen, toggledReactions, useEscapeLayer, useSupportReply, type SupportReplyTarget } from './supportChatTools'
import { stickerPictureUrl } from './stickers'
import './supportChat.css'

/**
 * «Чат с поддержкой» (owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»): the player's
 * conversation with the owner (support/supportChatClient.ts) — a window over the app on the PC, a sheet over the page
 * above the tab bar on the phone. One entry everywhere (owner, 15.10.2026: «у нас дублируется связаться и чат с
 * поддержкой, сделай одну кнопку чат с поддержкой, но что бы там можно было написать в чат и кнопка на телеграм»):
 * «Чат с поддержкой» in the sidebar, Settings → «Поддержка», the bug report and the phone's «Ещё».
 *
 * The player writes here, with screenshots (owner, 15.10.2026: «еще связаться с поддержкой, добавь что бы можно было
 * добавить скриншот»: the paperclip, Ctrl+V, or dropped anywhere on the window), and «Написать в Telegram» under it
 * opens the owner's Telegram — signed in or not. Without an account there is no chat: it asks to sign in.
 *
 * Reactions, «Ответить», emoji and stickers (owner, 07.11.2026): a right click (a long press on the phone) on a message
 * opens its menu; the composer has the emoji and the stickers. The same on the owner's side.
 */
export function SupportChatDialog({ onClose }: { onClose: () => void }) {
  const chat = useSupportChat(true)
  const mobile = useMobileLayout()
  const dialog = useRef<HTMLElement>(null)
  const [reply, setReply] = useSupportReply(chat.messages)
  useEffect(() => {
    // Captured on the window: over the bug report dialog, Escape closes only the chat; over a screenshot, a message's
    // menu, a grid or a reply being written, only it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || imageViewerOpen() || supportChatLayerOpen()) return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const title = uiText('Чат с поддержкой')
  // Rendered into <body>: the sidebar it is opened from clips and positions fixed children.
  return createPortal(<div className="registration-overlay support-overlay support-chat-overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="panel registration-dialog support-chat-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header className="support-chat-head">
        <div className="registration-icon"><MessagesSquare size={22} /></div>
        <h2>{title}</h2>
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
      </header>
      {chat.signedIn ? <>
        <SupportMessageList messages={chat.messages} viewer="user" otherName="Raid OS" loading={chat.loading && !chat.loaded} error={chat.loaded ? '' : chat.error} onRetry={() => void chat.reload()} emptyText="Напишите нам — ответим здесь же"
          onReact={(message, emoji, on) => chat.react(message.id, emoji, on)} onReply={setReply} />
        {/* No keyboard popping up on the phone the moment the sheet opens. */}
        <SupportComposer onSend={chat.send} placeholder="Ваше сообщение…" autoFocus={!mobile} allowImages allowEmoji allowStickers dropZone={dialog} replyTo={reply} onCancelReply={() => setReply(null)} />
      </> : <div className="support-chat-signin">
        <p className="muted">{uiText(chat.checking ? 'Проверяем аккаунт…' : 'Войдите в аккаунт, чтобы написать нам')}</p>
        {!chat.checking && <button type="button" className="button primary" onClick={() => { onClose(); openAccountSignIn('login') }}><LogIn size={15} />{uiText('Войти')}</button>}
      </div>}
      <div className="support-chat-telegram">
        <span>{uiText('Удобнее в Telegram?')}</span>
        <a className="button ghost small" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" title={SUPPORT_TELEGRAM_HANDLE}><Send size={14} aria-hidden="true" />{uiText('Написать в Telegram')}</a>
      </div>
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
  return <SupportNoticeToast key={message.id} onClose={() => dismiss(message.id)} />
}

/** It goes by itself; the unread answer still counts on «Чат с поддержкой». */
function SupportNoticeToast({ onClose }: { onClose: () => void }) {
  useToastTimer(onClose)
  const open = () => {
    onClose()
    openSupportChat()
  }
  return <ToastDock><div className="support-notice" role="status" aria-live="polite">
    <MessagesSquare size={18} aria-hidden="true" />
    <strong>{uiText('Новое сообщение от поддержки')}</strong>
    <button type="button" className="button small primary" onClick={open}>{uiText('Открыть')}</button>
    <button type="button" className="icon-button support-notice-close" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={15} /></button>
  </div></ToastDock>
}

/**
 * «Ответ на заявку №37» with the report's title (owner, 04.11.2026: «Чтобы люди понимали, на какой их заявку или сообщение
 * я отвечаю»): above the owner's words in the chat, on both sides, and above the answer box on a report's card in «Заявки».
 * The title is the player's own words: never passed through uiText.
 */
export function SupportReportCard({ report }: { report: Pick<SupportReportRef, 'id' | 'title'> }) {
  return <div className="support-chat-report">
    <span>{uiText('Ответ на заявку')} №{report.id}</span>
    <strong>{report.title}</strong>
  </div>
}

/** Held this long on the phone, a message opens its menu (as a right click does on the PC). */
const LONG_PRESS_MS = 450
/** A finger moved this far: it scrolls, no menu. */
const LONG_PRESS_SLOP = 10
/** The original of a quote stays marked this long after a click on the quote brought it into view. */
const FLASH_MS = 1600

/** A message's open menu: where it opened, and whether by a finger (it then opens above it). */
interface MenuAt { id: number; x: number; y: number; touch: boolean }

/**
 * The conversation, oldest first: the reader's own messages on the right with «отправлено» / «прочитано», the other
 * side's on the left under `otherName`, with their screenshots (MessageImages). Shared with the owner app's «Чаты»
 * (support/OwnerChats.tsx; `viewer` 'owner' reads the screenshots from the owner's route). The texts are the people's
 * own words: never passed through uiText (only «[скриншот]», the text of a message whose screenshots are gone).
 *
 * Reactions and replies (owner, 07.11.2026): with `onReact` / `onReply`, a right click (a long press on the phone) on a
 * message opens its menu — the reactions (SUPPORT_REACTIONS), «Ответить» and «Копировать». Its reactions show as chips
 * under the words, the reader's own marked; a click on a chip sets or takes back the reader's own. A message that answers
 * another shows it quoted above its words; a click on the quote brings the original into view if it is loaded. A sticker
 * shows as its picture with the caption in the reader's language. `peerName`: who the other side is in quotes and in the
 * chips' titles (default `otherName`).
 */
export function SupportMessageList({ messages, viewer, otherName, peerName, loading, error, onRetry, emptyText, onReact, onReply }: {
  messages: SupportMessage[]
  viewer: SupportMessage['author']
  otherName?: string
  peerName?: string
  loading: boolean
  error: string
  onRetry: () => void
  emptyText: string
  onReact?: (message: SupportMessage, emoji: string, on: boolean) => Promise<unknown>
  onReply?: (target: SupportReplyTarget) => void
}) {
  const { locale } = useLocale()
  const log = useRef<HTMLDivElement>(null)
  const last = messages.at(-1)?.id
  const [menu, setMenu] = useState<MenuAt | null>(null)
  // The reactions as the reader just set them, until the server's answer is in `messages`.
  const [pending, setPending] = useState<Record<number, SupportReaction[]>>({})
  const [actionError, setActionError] = useState('')
  const [flash, setFlash] = useState<{ id: number; n: number } | null>(null)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const interactive = Boolean(onReact || onReply)
  // The newest message in view: on opening and whenever one arrives or is sent.
  useEffect(() => {
    const node = log.current
    if (node) node.scrollTop = node.scrollHeight
  }, [last])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer) }, [])
  const peer = peerName || otherName || (viewer === 'user' ? 'Raid OS' : uiText('Игрок'))
  const nameOf = (author: SupportMessage['author']) => (author === viewer ? uiText('Вы') : peer)
  const reactionsOf = (message: SupportMessage) => pending[message.id] ?? message.reactions ?? []
  const closeMenu = useCallback(() => setMenu(null), [])

  const toggle = (message: SupportMessage, emoji: string) => {
    if (!onReact) return
    const current = reactionsOf(message)
    const on = !current.some((reaction) => reaction.emoji === emoji && reaction.authors.includes(viewer))
    const next = toggledReactions(current, emoji, viewer, on)
    setPending((all) => ({ ...all, [message.id]: next }))
    setActionError('')
    onReact(message, emoji, on)
      .catch((reason: unknown) => setActionError(cleanIpcError(reason) || 'Не удалось поставить реакцию'))
      .finally(() => setPending((all) => {
        if (all[message.id] !== next) return all
        const rest = { ...all }
        delete rest[message.id]
        return rest
      }))
  }
  const jump = (id: number) => {
    const node = log.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`)
    if (!node) return
    node.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    setFlash((current) => ({ id, n: (current?.n ?? 0) + 1 }))
  }
  const openMenu = (message: SupportMessage, x: number, y: number, touch: boolean) => {
    if (!interactive) return
    // A long press may have started selecting the words: the menu takes their place.
    if (touch) window.getSelection?.()?.removeAllRanges()
    setMenu((current) => (current?.id === message.id ? current : { id: message.id, x, y, touch }))
  }
  const cancelPress = () => {
    if (!press.current) return
    clearTimeout(press.current.timer)
    press.current = null
  }
  const open = menu ? messages.find((message) => message.id === menu.id) : undefined
  const words = (message: SupportMessage) => message.report?.text ?? message.text

  return (
    <div className="support-chat-log" ref={log} role="log" aria-live="polite" aria-label={uiText('Сообщения')}>
      {messages.length === 0 ? (
        loading ? <p className="support-chat-empty" role="status"><LoaderCircle className="spin" size={18} />{uiText('Загружаем сообщения…')}</p>
          : error ? <div className="support-chat-empty" role="alert"><AlertTriangle size={18} /><span>{uiText(error)}</span><button type="button" className="button small ghost" onClick={onRetry}><RefreshCw size={13} />{uiText('Повторить')}</button></div>
            : <p className="support-chat-empty">{uiText(emptyText)}</p>
      ) : messages.map((message) => {
        const own = message.author === viewer
        const status = message.read ? 'Прочитано' : 'Отправлено'
        const attachments = message.attachments ?? []
        // An answer about a report: its card and the owner's own words (`text` repeats the report for older apps).
        const text = words(message)
        const placeholder = text === SUPPORT_IMAGE_PLACEHOLDER
        const caption = stickerCaption(message.sticker, locale)
        const reactions = reactionsOf(message)
        const quote = message.replyTo
        const classes = ['support-chat-message', own && 'is-own', attachments.length && 'has-images', caption && 'is-sticker', interactive && 'has-menu', flash?.id === message.id && 'is-flash', menu?.id === message.id && 'is-menu']
        return (
          <div key={message.id} data-message-id={message.id} className={classes.filter(Boolean).join(' ')}
            onContextMenu={interactive ? (event) => {
              event.preventDefault()
              // Android opens it on a long press too: then it is a finger's.
              const touch = press.current !== null || (event.nativeEvent as PointerEvent).pointerType === 'touch'
              cancelPress()
              openMenu(message, event.clientX, event.clientY, touch)
            } : undefined}
            onTouchStart={interactive ? (event) => {
              const touch = event.touches[0]
              cancelPress()
              if (event.touches.length !== 1 || !touch) return
              const { clientX: x, clientY: y } = touch
              press.current = { x, y, timer: setTimeout(() => { press.current = null; openMenu(message, x, y, true) }, LONG_PRESS_MS) }
            } : undefined}
            onTouchMove={interactive ? (event) => {
              const touch = event.touches[0]
              if (press.current && touch && Math.hypot(touch.clientX - press.current.x, touch.clientY - press.current.y) > LONG_PRESS_SLOP) cancelPress()
            } : undefined}
            onTouchEnd={interactive ? cancelPress : undefined}
            onTouchCancel={interactive ? cancelPress : undefined}>
            {!own && otherName && <span className="support-chat-author">{otherName}</span>}
            {quote && <MessageQuote quote={quote} name={nameOf(quote.author)} locale={locale} onJump={messages.some((known) => known.id === quote.id) ? () => jump(quote.id) : undefined} />}
            {message.report && <SupportReportCard report={message.report} />}
            {attachments.length > 0 && <MessageImages attachments={attachments} viewer={viewer} />}
            {caption ? <figure className="support-chat-sticker">
              <StickerImage id={message.sticker!} />
              <figcaption>{caption}</figcaption>
            </figure>
              // Images only: the placeholder is for apps that cannot show them.
              : !(placeholder && attachments.length) && <p className={`support-chat-text${!placeholder && emojiOnly(text) ? ' is-emoji' : ''}`}>{placeholder ? uiText(SUPPORT_IMAGE_PLACEHOLDER) : text}</p>}
            {reactions.length > 0 && <div className="support-chat-reactions">
              {reactions.map((reaction) => {
                const mine = reaction.authors.includes(viewer)
                // The reader first, then the other side.
                const who = [...reaction.authors].sort((x, y) => Number(y === viewer) - Number(x === viewer)).map(nameOf).join(', ')
                const label = `${reaction.emoji} ${reaction.authors.length}`
                return onReact
                  ? <button key={reaction.emoji} type="button" className={`support-chat-reaction${mine ? ' is-mine' : ''}`} aria-pressed={mine} aria-label={label} title={who} onClick={() => toggle(message, reaction.emoji)}>
                    <span aria-hidden="true">{reaction.emoji}</span><span aria-hidden="true">{reaction.authors.length}</span>
                  </button>
                  : <span key={reaction.emoji} className={`support-chat-reaction${mine ? ' is-mine' : ''}`} role="img" aria-label={label} title={who}>
                    <span aria-hidden="true">{reaction.emoji}</span><span aria-hidden="true">{reaction.authors.length}</span>
                  </span>
              })}
            </div>}
            <span className="support-chat-meta">
              <time dateTime={message.createdAt}>{supportTime(message.createdAt, locale)}</time>
              {own && <span className={`support-chat-status${message.read ? ' is-read' : ''}`} role="img" aria-label={uiText(status)} title={uiText(status)}>{message.read ? <CheckCheck size={13} /> : <Check size={13} />}</span>}
            </span>
          </div>
        )
      })}
      {actionError && <p className="support-chat-error support-chat-action-error" role="alert"><AlertTriangle size={15} /><span>{uiText(actionError)}</span></p>}
      {menu && open && <MessageMenu at={menu} onClose={closeMenu}
        mine={new Set(reactionsOf(open).filter((reaction) => reaction.authors.includes(viewer)).map((reaction) => reaction.emoji))}
        onReact={onReact ? (emoji) => toggle(open, emoji) : undefined}
        onReply={onReply ? () => onReply({ message: open, name: nameOf(open.author) }) : undefined}
        onCopy={!open.sticker && words(open) !== SUPPORT_IMAGE_PLACEHOLDER && navigator.clipboard ? () => void navigator.clipboard.writeText(words(open)).catch(() => {}) : undefined} />}
    </div>
  )
}

/** The message a message answers, above its words: who wrote it and a short excerpt; a click shows the original. */
function MessageQuote({ quote, name, locale, onJump }: { quote: SupportReplyQuote; name: string; locale: 'ru' | 'en'; onJump?: () => void }) {
  const body = <><strong>{name}</strong><span>{quoteBody(quote, locale)}</span></>
  return onJump
    ? <button type="button" className="support-chat-quote" onClick={onJump} title={uiText('Показать сообщение')}>{body}</button>
    : <div className="support-chat-quote">{body}</div>
}

/** A sticker's picture (src/support/stickers.ts); a plain tag while it has none. */
function StickerImage({ id }: { id: string }) {
  const url = stickerPictureUrl(id)
  return url ? <img src={url} alt="" draggable={false} /> : <span className="support-chat-sticker-blank" aria-hidden="true">🏷️</span>
}

/** A finger lifted this soon after the menu opened under it is the long press ending, not a choice. */
const TOUCH_SETTLE_MS = 400

/**
 * A message's menu at the pointer (above the finger on the phone), kept inside the window: the reactions, «Ответить» and
 * «Копировать». A click outside, Escape, scrolling or the window losing focus closes it. Rendered into <body>: the
 * conversation scrolls and clips.
 */
function MessageMenu({ at, mine, onReact, onReply, onCopy, onClose }: {
  at: MenuAt
  mine: Set<string>
  onReact?: (emoji: string) => void
  onReply?: () => void
  onCopy?: () => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const settled = useRef(!at.touch)
  useEscapeLayer(true, onClose)
  useEffect(() => {
    if (!at.touch) return
    settled.current = false
    const timer = setTimeout(() => { settled.current = true }, TOUCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [at])
  useLayoutEffect(() => {
    const node = box.current
    if (!node) return
    const { width, height } = node.getBoundingClientRect()
    const above = at.y - height - 14
    const top = at.touch && above >= 8 ? above : Math.min(at.y, window.innerHeight - height - 8)
    node.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - width - 8))}px`
    node.style.top = `${Math.max(8, top)}px`
    node.style.visibility = 'visible'
  }, [at])
  useEffect(() => {
    const away = (event: Event) => { if (!(event.target instanceof Node && box.current?.contains(event.target))) onClose() }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  const choose = (action: () => void) => {
    if (!settled.current) return
    onClose()
    action()
  }
  return createPortal(<div ref={box} className="support-chat-menu" role="menu" aria-label={uiText('Действия с сообщением')} style={{ visibility: 'hidden' }}
    onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
    {onReact && <div className="support-chat-menu-reactions" role="group" aria-label={uiText('Реакции')}>
      {SUPPORT_REACTIONS.map((emoji) => <button key={emoji} type="button" role="menuitemcheckbox" aria-checked={mine.has(emoji)} aria-label={emoji}
        className={mine.has(emoji) ? 'is-mine' : undefined} onClick={() => choose(() => onReact(emoji))}>{emoji}</button>)}
    </div>}
    {onReply && <button type="button" role="menuitem" className="support-chat-menu-item" onClick={() => choose(onReply)}><Reply size={15} aria-hidden="true" />{uiText('Ответить')}</button>}
    {onCopy && <button type="button" role="menuitem" className="support-chat-menu-item" onClick={() => choose(onCopy)}><Copy size={15} aria-hidden="true" />{uiText('Копировать')}</button>}
  </div>, document.body)
}

/** A thumbnail's size: the image's own proportions within a box (smaller when there are several). */
function thumbSize(attachment: SupportAttachment, count: number) {
  const [maxWidth, maxHeight] = count === 1 ? [240, 200] : [150, 120]
  const scale = Math.min(1, maxWidth / attachment.width, maxHeight / attachment.height)
  return { width: Math.max(48, Math.round(attachment.width * scale)), height: Math.max(40, Math.round(attachment.height * scale)) }
}

/**
 * A message's screenshots as thumbnails, sized before they arrive (the conversation does not jump); a click opens them
 * full size (components/ImageViewer.tsx, the viewer of the reports' screenshots in «Заявки»).
 */
function MessageImages({ attachments, viewer }: { attachments: SupportAttachment[]; viewer: SupportMessage['author'] }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [viewing, setViewing] = useState<number | null>(null)
  const ids = attachments.map((attachment) => attachment.id).join(',')
  useEffect(() => {
    let alive = true
    for (const id of ids.split(',')) {
      supportAttachmentImage(id, viewer).then(
        (url) => { if (alive) setUrls((current) => ({ ...current, [id]: url })) },
        () => { if (alive) setFailed((current) => ({ ...current, [id]: true })) },
      )
    }
    return () => { alive = false }
  }, [ids, viewer])
  const shown = attachments.filter((attachment) => urls[attachment.id])
  return (
    <div className="support-chat-images">
      {attachments.map((attachment, index) => {
        const url = urls[attachment.id]
        const label = `${uiText('Скриншот')} ${index + 1}`
        return (
          <button key={attachment.id} type="button" className="support-chat-image" style={thumbSize(attachment, attachments.length)} disabled={!url}
            onClick={() => setViewing(shown.indexOf(attachment))} aria-label={`${uiText('Открыть скриншот')} ${index + 1}`} title={uiText(url ? 'Открыть во весь размер' : failed[attachment.id] ? 'Скриншот недоступен' : 'Загружаем скриншот…')}>
            {url ? <img src={url} alt={label} /> : failed[attachment.id] ? <ImageOff size={18} aria-hidden="true" /> : <LoaderCircle className="spin" size={16} aria-hidden="true" />}
          </button>
        )
      })}
      {viewing !== null && viewing >= 0 && viewing < shown.length && <ImageViewer images={shown.map((attachment) => urls[attachment.id]!)} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

/** A screenshot waiting in the box: scaled down already (src/notices/imageResize.ts), sent with the next message. */
interface PendingShot { key: number; name: string; preview: string; data: string }
let nextShotKey = 1
/**
 * The box under the conversation: Enter sends, Shift+Enter starts a new line, up to 2000 characters. The text stays
 * when sending fails, with the reason above it.
 *
 * With `allowImages`, screenshots too (owner, 15.10.2026): the paperclip, a paste (Ctrl+V) or a drop anywhere (app/fileSink.ts;
 * `dropZone`, else the box, lights up) adds up to four PNG / JPEG / WEBP, each at most 5 MB, scaled down to 1920 px like the photos
 * of the owner's announcements. A message may be screenshots only. They are not passed on to a dialog under the chat
 * (the bug report takes pastes too).
 *
 * Emoji and stickers (owner, 07.11.2026: «И просто отправлять смайлики. Добавь смайлики всякие… стикеры в стиле Таркова»):
 * with `allowEmoji`, the smile opens a grid of emoji put in at the cursor; with `allowStickers`, the sticker button opens the pack, and a
 * sticker is sent at once as a message of its own. `replyTo` (from «Ответить» in the conversation): shown above the box
 * with «×» (`onCancelReply`, also Escape), sent with the next message or sticker and then gone.
 */
export function SupportComposer({ onSend, placeholder, autoFocus = false, allowImages = false, allowEmoji = false, allowStickers = false, dropZone, replyTo, onCancelReply }: {
  onSend: (text: string, images: SupportImageUpload[], extra: SupportSendExtra) => Promise<unknown>
  placeholder: string
  autoFocus?: boolean
  allowImages?: boolean
  allowEmoji?: boolean
  allowStickers?: boolean
  dropZone?: RefObject<HTMLElement | null>
  replyTo?: SupportReplyTarget | null
  onCancelReply?: () => void
}) {
  const { locale } = useLocale()
  const mobile = useMobileLayout()
  const [text, setText] = useState('')
  const [shots, setShots] = useState<PendingShot[]>([])
  const [preparing, setPreparing] = useState(0)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState<'emoji' | 'sticker' | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Where the cursor goes after an emoji was put in.
  const caret = useRef<number | null>(null)
  // Screenshots taken and being scaled down: what is left of the four.
  const taken = useRef(0)
  const empty = !cleanSupportText(text) && !shots.length
  const full = shots.length + preparing >= SUPPORT_IMAGE_LIMITS.files
  const replyId = replyTo?.message.id
  const closePicker = useCallback(() => setPicker(null), [])
  const cancelReply = useCallback(() => onCancelReply?.(), [onCancelReply])
  useEscapeLayer(picker !== null, closePicker)
  useEscapeLayer(replyId !== undefined, cancelReply)
  // «Ответить»: the cursor goes to the box.
  useEffect(() => { if (replyId !== undefined) input.current?.focus() }, [replyId])
  useLayoutEffect(() => {
    const at = caret.current
    const box = input.current
    if (at === null || !box) return
    caret.current = null
    // No keyboard popping up on the phone for every emoji.
    if (!mobile) box.focus()
    box.setSelectionRange(at, at)
  }, [text, mobile])

  const addFiles = useCallback(async (files: File[]) => {
    if (!allowImages || !files.length) return
    const problems = new Set<string>()
    const accepted: File[] = []
    for (const file of files) {
      if (!SUPPORT_IMAGE_TYPES.includes(file.type)) { problems.add('Можно прикрепить только PNG, JPEG или WEBP.'); continue }
      if (file.size > SUPPORT_IMAGE_LIMITS.fileBytes) { problems.add('Каждый скриншот — не больше 5 МБ.'); continue }
      if (taken.current + accepted.length >= SUPPORT_IMAGE_LIMITS.files) { problems.add(`Не больше ${SUPPORT_IMAGE_LIMITS.files} скриншотов.`); continue }
      accepted.push(file)
    }
    const say = () => setError([...problems].map((problem) => uiText(problem)).join(' '))
    say()
    if (!accepted.length) return
    taken.current += accepted.length
    setPreparing((count) => count + accepted.length)
    const prepared = await Promise.all(accepted.map(async (file): Promise<PendingShot | null> => {
      try {
        const image = await prepareNoticeImage(file)
        return { key: nextShotKey++, name: file.name || 'screenshot.png', preview: image.preview, data: image.data }
      } catch {
        problems.add('Не удалось прочитать файл.')
        return null
      }
    }))
    const ready = prepared.filter((shot): shot is PendingShot => shot !== null)
    taken.current -= accepted.length - ready.length
    setPreparing((count) => count - accepted.length)
    if (ready.length) setShots((current) => [...current, ...ready])
    say()
  }, [allowImages])
  // Taken here wherever they land, never opened by the app nor passed to a dialog under it.
  useFileSink(allowImages, {
    take: (files) => void addFiles(files),
    area: () => dropZone?.current ?? form.current,
    focus: () => input.current?.focus(),
    dragging: (on) => (dropZone?.current ?? form.current)?.classList.toggle('is-dropping', on),
  })
  const extra = (): SupportSendExtra => (replyId !== undefined ? { replyTo: replyId } : {})
  const submit = async () => {
    if (empty || sending || preparing) return
    setSending(true)
    setError('')
    try {
      await onSend(text, shots.map((shot) => ({ data: shot.data })), extra())
      setText('')
      setShots([])
      setPicker(null)
      taken.current = 0
      onCancelReply?.()
    } catch (reason) {
      setError(uiText(cleanIpcError(reason)))
    } finally {
      setSending(false)
      input.current?.focus()
    }
  }
  /** A sticker goes at once, as a message of its own; the words and screenshots in the box stay for the next one. */
  const sendSticker = async (id: string) => {
    if (sending) return
    setSending(true)
    setError('')
    try {
      await onSend('', [], { ...extra(), sticker: id })
      setPicker(null)
      onCancelReply?.()
    } catch (reason) {
      setError(uiText(cleanIpcError(reason)))
    } finally {
      setSending(false)
    }
  }
  /** Puts an emoji in at the cursor (in place of what is selected), within the 2000 characters. */
  const insert = (emoji: string) => {
    const box = input.current
    const start = box?.selectionStart ?? text.length
    const end = box?.selectionEnd ?? text.length
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`
    if (next.length > SUPPORT_MESSAGE_MAX) return
    caret.current = start + emoji.length
    setText(next)
    if (error) setError('')
  }
  const remove = (key: number) => {
    taken.current -= 1
    setShots((current) => current.filter((shot) => shot.key !== key))
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }
  const togglePicker = (kind: 'emoji' | 'sticker') => setPicker((current) => (current === kind ? null : kind))
  return (
    <form ref={form} className="support-chat-compose" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      {error && <div className="support-chat-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
      {replyTo && <div className="support-chat-replying" role="group" aria-label={uiText('Ответ на сообщение')}>
        <Reply size={15} aria-hidden="true" />
        <div className="support-chat-quote">
          <strong>{replyTo.name}</strong>
          <span>{quoteBody(replyQuoteOf(replyTo.message), locale)}</span>
        </div>
        <button type="button" className="icon-button" onClick={cancelReply} aria-label={uiText('Отменить ответ')} title={uiText('Отменить ответ')}><X size={14} /></button>
      </div>}
      {(shots.length > 0 || preparing > 0) && <ul className="support-chat-shots" aria-label={uiText('Скриншоты к сообщению')}>
        {shots.map((shot) => <li key={shot.key}>
          <img src={shot.preview} alt={shot.name} />
          <button type="button" disabled={sending} onClick={() => remove(shot.key)} aria-label={`${uiText('Убрать скриншот')} ${shot.name}`} title={uiText('Убрать скриншот')}><X size={13} /></button>
        </li>)}
        {preparing > 0 && <li className="is-preparing" role="status" aria-label={uiText('Готовим скриншот…')}><LoaderCircle className="spin" size={16} /></li>}
      </ul>}
      {picker === 'emoji' && <div className="support-chat-picker is-emoji" role="group" aria-label={uiText('Смайлики')}>
        {SUPPORT_EMOJI.map((emoji) => <button key={emoji} type="button" aria-label={emoji} onClick={() => insert(emoji)}>{emoji}</button>)}
      </div>}
      {picker === 'sticker' && <div className="support-chat-picker is-stickers" role="group" aria-label={uiText('Стикеры')}>
        {SUPPORT_STICKERS.map((sticker) => {
          const caption = locale === 'en' ? sticker.en : sticker.ru
          return <button key={sticker.id} type="button" disabled={sending} aria-label={caption} title={caption} onClick={() => void sendSticker(sticker.id)}>
            <StickerImage id={sticker.id} />
            <span>{caption}</span>
          </button>
        })}
      </div>}
      <div className="support-chat-compose-row">
        {allowImages && <>
          <button type="button" className="button ghost support-chat-attach" disabled={sending || full} onClick={() => fileInput.current?.click()}
            aria-label={uiText('Прикрепить скриншот')} title={uiText('Прикрепить скриншот: до 4 изображений PNG, JPEG или WEBP, каждое до 5 МБ. Можно вставить из буфера (Ctrl+V) или перетащить в окно.')}>
            <Paperclip size={17} />
          </button>
          <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label={uiText('Скриншоты')} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        </>}
        {allowEmoji && <button type="button" className={`button ghost support-chat-attach support-chat-tool${picker === 'emoji' ? ' is-active' : ''}`} aria-expanded={picker === 'emoji'}
          onClick={() => togglePicker('emoji')} aria-label={uiText('Смайлики')} title={uiText('Смайлики')}>
          <Smile size={17} />
        </button>}
        {allowStickers && <button type="button" className={`button ghost support-chat-attach support-chat-tool${picker === 'sticker' ? ' is-active' : ''}`} aria-expanded={picker === 'sticker'}
          onClick={() => togglePicker('sticker')} aria-label={uiText('Стикеры')} title={uiText('Стикеры')}>
          <Sticker size={17} />
        </button>}
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
        <button type="submit" className="button primary" disabled={empty || sending || preparing > 0}>
          {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}<span>{uiText(sending ? 'Отправляем…' : 'Отправить')}</span>
        </button>
      </div>
      <div className="support-chat-foot">
        <small className="support-chat-hint">{uiText(allowImages ? 'Enter — отправить, Shift+Enter — новая строка, Ctrl+V — вставить скриншот' : 'Enter — отправить, Shift+Enter — новая строка')}</small>
        {text.length > SUPPORT_MESSAGE_MAX - 200 && <small className="support-chat-count">{text.length} / {SUPPORT_MESSAGE_MAX}</small>}
      </div>
    </form>
  )
}
