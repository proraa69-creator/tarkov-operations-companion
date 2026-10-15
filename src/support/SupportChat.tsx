import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, CheckCheck, ImageOff, LoaderCircle, LogIn, MessagesSquare, Paperclip, RefreshCw, Send, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useMobileLayout } from '../platform'
import { openAccountSignIn } from '../account/accountEvents'
import { imageFilesOf, SUPPORT_TELEGRAM_HANDLE, SUPPORT_TELEGRAM_URL } from '../app/support'
import { cleanSupportText, SUPPORT_IMAGE_LIMITS, SUPPORT_IMAGE_PLACEHOLDER, SUPPORT_IMAGE_TYPES, SUPPORT_MESSAGE_MAX, type SupportAttachment } from '../shared/supportChat'
import { prepareNoticeImage } from '../notices/imageResize'
import { cleanIpcError } from '../sync/serverSync'
import { ImageViewer, imageViewerOpen } from '../components/ImageViewer'
import { openSupportChat, supportAttachmentImage, supportTime, useSupportChat, useSupportNotice, type SupportImageUpload, type SupportMessage } from './supportChatClient'
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
 */
export function SupportChatDialog({ onClose }: { onClose: () => void }) {
  const chat = useSupportChat(true)
  const mobile = useMobileLayout()
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    // Captured on the window: over the bug report dialog, Escape closes only the chat; over a screenshot, only it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || imageViewerOpen()) return
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
        <SupportMessageList messages={chat.messages} viewer="user" otherName="Raid OS" loading={chat.loading && !chat.loaded} error={chat.loaded ? '' : chat.error} onRetry={() => void chat.reload()} emptyText="Напишите нам — ответим здесь же" />
        {/* No keyboard popping up on the phone the moment the sheet opens. */}
        <SupportComposer onSend={chat.send} placeholder="Ваше сообщение…" autoFocus={!mobile} allowImages dropZone={dialog} />
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
 * side's on the left under `otherName`, with their screenshots (MessageImages). Shared with the owner app's «Чаты»
 * (support/OwnerChats.tsx; `viewer` 'owner' reads the screenshots from the owner's route). The texts are the people's
 * own words: never passed through uiText (only «[скриншот]», the text of a message whose screenshots are gone).
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
        const attachments = message.attachments ?? []
        const placeholder = message.text === SUPPORT_IMAGE_PLACEHOLDER
        return (
          <div key={message.id} className={`support-chat-message${own ? ' is-own' : ''}${attachments.length ? ' has-images' : ''}`}>
            {!own && otherName && <span className="support-chat-author">{otherName}</span>}
            {attachments.length > 0 && <MessageImages attachments={attachments} viewer={viewer} />}
            {/* Images only: the placeholder is for apps that cannot show them. */}
            {!(placeholder && attachments.length) && <p className="support-chat-text">{placeholder ? uiText(SUPPORT_IMAGE_PLACEHOLDER) : message.text}</p>}
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
 * With `allowImages`, screenshots too (owner, 15.10.2026): the paperclip, a paste (Ctrl+V) or a drop on `dropZone` (the
 * window; else the box) adds up to four PNG / JPEG / WEBP, each at most 5 MB, scaled down to 1920 px like the photos
 * of the owner's announcements. A message may be screenshots only. They are not passed on to a dialog under the chat
 * (the bug report takes pastes too).
 */
export function SupportComposer({ onSend, placeholder, autoFocus = false, allowImages = false, dropZone }: {
  onSend: (text: string, images: SupportImageUpload[]) => Promise<unknown>
  placeholder: string
  autoFocus?: boolean
  allowImages?: boolean
  dropZone?: RefObject<HTMLElement | null>
}) {
  const [text, setText] = useState('')
  const [shots, setShots] = useState<PendingShot[]>([])
  const [preparing, setPreparing] = useState(0)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Screenshots taken and being scaled down: what is left of the four.
  const taken = useRef(0)
  const empty = !cleanSupportText(text) && !shots.length
  const full = shots.length + preparing >= SUPPORT_IMAGE_LIMITS.files

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
  const latestAdd = useRef(addFiles)
  useEffect(() => { latestAdd.current = addFiles }, [addFiles])

  // Files dropped on the window (or the box): taken here, never opened by the app nor passed to a dialog under it.
  useEffect(() => {
    const zone = dropZone?.current ?? form.current
    if (!allowImages || !zone) return
    let depth = 0
    const files = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const over = (event: DragEvent) => {
      if (!files(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const enter = (event: DragEvent) => { if (files(event)) { depth += 1; zone.classList.add('is-dropping') } }
    const leave = (event: DragEvent) => { if (files(event) && --depth <= 0) { depth = 0; zone.classList.remove('is-dropping') } }
    const drop = (event: DragEvent) => {
      if (!files(event)) return
      event.preventDefault()
      event.stopPropagation()
      depth = 0
      zone.classList.remove('is-dropping')
      void latestAdd.current(Array.from(event.dataTransfer?.files ?? []))
    }
    zone.addEventListener('dragover', over)
    zone.addEventListener('dragenter', enter)
    zone.addEventListener('dragleave', leave)
    zone.addEventListener('drop', drop)
    return () => {
      zone.removeEventListener('dragover', over)
      zone.removeEventListener('dragenter', enter)
      zone.removeEventListener('dragleave', leave)
      zone.removeEventListener('drop', drop)
      zone.classList.remove('is-dropping')
    }
  }, [allowImages, dropZone])

  const submit = async () => {
    if (empty || sending || preparing) return
    setSending(true)
    setError('')
    try {
      await onSend(text, shots.map((shot) => ({ data: shot.data })))
      setText('')
      setShots([])
      taken.current = 0
    } catch (reason) {
      setError(uiText(cleanIpcError(reason)))
    } finally {
      setSending(false)
      input.current?.focus()
    }
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
  return (
    <form ref={form} className="support-chat-compose" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      {error && <div className="support-chat-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
      {(shots.length > 0 || preparing > 0) && <ul className="support-chat-shots" aria-label={uiText('Скриншоты к сообщению')}>
        {shots.map((shot) => <li key={shot.key}>
          <img src={shot.preview} alt={shot.name} />
          <button type="button" disabled={sending} onClick={() => remove(shot.key)} aria-label={`${uiText('Убрать скриншот')} ${shot.name}`} title={uiText('Убрать скриншот')}><X size={13} /></button>
        </li>)}
        {preparing > 0 && <li className="is-preparing" role="status" aria-label={uiText('Готовим скриншот…')}><LoaderCircle className="spin" size={16} /></li>}
      </ul>}
      <div className="support-chat-compose-row">
        {allowImages && <>
          <button type="button" className="button ghost support-chat-attach" disabled={sending || full} onClick={() => fileInput.current?.click()}
            aria-label={uiText('Прикрепить скриншот')} title={uiText('Прикрепить скриншот: до 4 изображений PNG, JPEG или WEBP, каждое до 5 МБ. Можно вставить из буфера (Ctrl+V) или перетащить в окно.')}>
            <Paperclip size={17} />
          </button>
          <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label={uiText('Скриншоты')} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        </>}
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
          onPaste={(event) => {
            const files = allowImages ? imageFilesOf(event.clipboardData) : []
            if (!files.length) return
            event.preventDefault()
            event.stopPropagation()
            void addFiles(files)
          }}
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
