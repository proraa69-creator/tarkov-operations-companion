/**
 * Reactions, replies, emoji and stickers of «Чат с поддержкой» (owner, 07.11.2026: «и пользователь, и я смог ставить на
 * сообщения лайки или нажать правой клавишей и нажать «Ответить» именно на это сообщение… И просто отправлять смайлики.
 * Добавь смайлики всякие… стикеры в стиле Таркова»): what support/SupportChat.tsx and its three places (the player's
 * window, the owner's «Чаты», the owner's iPhone admin) share besides the components.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { imageViewerOpen } from '../components/ImageViewer'
import { uiText } from '../i18n/renderText'
import { cleanIpcError } from '../sync/serverSync'
import { cleanSupportText, SUPPORT_IMAGE_PLACEHOLDER, SUPPORT_STICKER_PLACEHOLDER, supportQuoteText, type SupportReaction, type SupportReplyQuote, type SupportSide } from '../shared/supportChat'
import { supportSticker } from '../shared/supportStickers'
import type { SupportImageUpload, SupportMessage, SupportSendExtra } from './supportChatClient'

/** The emoji of the composer's grid: everyday ones, then the raid's (gear, blood, loot, the extract, the rat). */
export const SUPPORT_EMOJI: readonly string[] = [
  '😀', '😂', '🤣', '😅', '😊', '😉', '😍', '😎', '🤔', '😐', '🙄', '😴', '😢', '😭', '😡', '🤯',
  '😱', '🥶', '🤝', '👍', '👎', '👌', '🙏', '💪', '👀', '❤️', '🔥', '⭐', '🎉', '✅', '❌', '⚠️',
  '💀', '☠️', '🔫', '💣', '🪖', '🎒', '🩸', '🩹', '💊', '🧰', '🔑', '💰', '💵', '🚪', '🐀', '🧟',
  '🍞', '🥫', '💧', '🗺️', '📦', '🏃', '🌲', '🌙',
]

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|\s)+$/u
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/** A message of a few emoji and nothing else: shown bigger. */
export function emojiOnly(text: string) {
  return text.length <= 24 && EMOJI_ONLY.test(text) && PICTOGRAPH.test(text)
}

/**
 * A built-in sticker's caption in the reader's language (never passed through uiText: the pack has both); '' for an owner's
 * sticker (a picture only, its words drawn in) and for anything else.
 */
export function stickerCaption(id: string | undefined, locale: 'ru' | 'en') {
  const sticker = supportSticker(id)
  return sticker ? (locale === 'en' ? sticker.en : sticker.ru) : ''
}

/** How a sticker is named in a quote or a list of chats: «Стикер: Крыса», or «Стикер» for an owner's one. */
function stickerName(id: string, locale: 'ru' | 'en') {
  const caption = stickerCaption(id, locale)
  return caption ? `${uiText('Стикер')}: ${caption}` : uiText('Стикер')
}

/** A message as a reply would quote it (the server keeps the same: services/supportChatStore.ts). */
export function replyQuoteOf(message: SupportMessage): SupportReplyQuote {
  const words = message.report?.text ?? message.text
  if (message.sticker) return { id: message.id, author: message.author, text: '', sticker: message.sticker }
  return { id: message.id, author: message.author, text: words === SUPPORT_IMAGE_PLACEHOLDER ? '' : supportQuoteText(words) }
}

/** What a quote reads: the excerpt, «Стикер: Крыса» (or «Стикер», also for one that is gone), or «Скриншот» for screenshots only. */
export function quoteBody(quote: Pick<SupportReplyQuote, 'text' | 'sticker'>, locale: 'ru' | 'en') {
  if (quote.sticker) return stickerName(quote.sticker, locale)
  if (quote.text === SUPPORT_STICKER_PLACEHOLDER) return uiText('Стикер')
  return quote.text || uiText('Скриншот')
}

/** The latest message of a conversation in a list of chats: its words, «Стикер: Крыса», «Стикер», «[скриншот]» or «[стикер]». */
export function supportPreviewText(message: SupportMessage, locale: 'ru' | 'en') {
  if (message.sticker) return stickerName(message.sticker, locale)
  return message.text === SUPPORT_IMAGE_PLACEHOLDER || message.text === SUPPORT_STICKER_PLACEHOLDER ? uiText(message.text) : message.text
}

/** The reactions with `side`'s `emoji` set (`on`) or taken back: what the chips show until the server answers. */
export function toggledReactions(reactions: SupportReaction[], emoji: string, side: SupportSide, on: boolean): SupportReaction[] {
  const list = reactions.some((reaction) => reaction.emoji === emoji) ? reactions : [...reactions, { emoji, authors: [] }]
  return list
    .map((reaction) => (reaction.emoji !== emoji ? reaction : {
      emoji, authors: on ? [...reaction.authors.filter((author) => author !== side), side] : reaction.authors.filter((author) => author !== side),
    }))
    .filter((reaction) => reaction.authors.length > 0)
}

/** The message «Ответить» was chosen on, with the name its author goes by in this conversation. */
export interface SupportReplyTarget { message: SupportMessage; name: string }

/**
 * The reply being written in a conversation: set by «Ответить» (SupportMessageList), shown above the box and sent with the
 * next message (SupportComposer). Gone with its message (the owner deleted the conversation): no reply any more.
 */
export function useSupportReply(messages: SupportMessage[]) {
  const [reply, setReply] = useState<SupportReplyTarget | null>(null)
  const shown = reply && messages.some((message) => message.id === reply.message.id) ? reply : null
  return [shown, setReply] as const
}

type SupportSend = (text: string, images: SupportImageUpload[], extra: SupportSendExtra) => Promise<unknown>

/**
 * Sending without waiting (owner, 15.11.2026: «после отправки сообщения нельзя сразу отправить второе… Отправка долго
 * думает»): a message the composer hands over shows at once at the end of the conversation with a clock (`sending`), and
 * the box is free for the next one. They go to the server one after another, in the order written; each leaves the list
 * when the server's own message is in (or sending failed: the composer then gives the words back with the reason).
 * Returns the conversation with them and the `send` for SupportComposer.
 */
export function useSupportOutbox(messages: SupportMessage[], author: SupportMessage['author'], send: SupportSend) {
  const [outbox, setOutbox] = useState<SupportMessage[]>([])
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const nextId = useRef(-1)
  const latest = useRef({ send, messages })
  useEffect(() => { latest.current = { send, messages } })
  const enqueue = useCallback<SupportSend>((text, images, extra) => {
    const id = nextId.current--
    const quoted = extra.replyTo === undefined ? undefined : latest.current.messages.find((message) => message.id === extra.replyTo)
    const words = extra.sticker !== undefined ? '' : cleanSupportText(text)
    const draft: SupportMessage = {
      id, author, text: words || (images.length ? SUPPORT_IMAGE_PLACEHOLDER : ''), createdAt: new Date().toISOString(), read: false, sending: true,
      ...(extra.sticker !== undefined ? { sticker: extra.sticker } : {}), ...(quoted ? { replyTo: replyQuoteOf(quoted) } : {}),
    }
    setOutbox((current) => [...current, draft])
    const run = queue.current.catch(() => undefined).then(() => latest.current.send(text, images, extra))
    queue.current = run
    return run.finally(() => setOutbox((current) => current.filter((message) => message.id !== id)))
  }, [author])
  const shown = useMemo(() => (outbox.length ? [...messages, ...outbox] : messages), [messages, outbox])
  return [shown, enqueue] as const
}

/** The words of a message as its author wrote them (an answer about a report: without the report's card). */
export function supportOwnWords(message: SupportMessage) {
  const words = message.report?.text ?? message.text
  return words === SUPPORT_IMAGE_PLACEHOLDER ? '' : words
}

/** The owner may change the words of an own sent message (not a sticker, not one still on its way). */
export function supportEditable(message: SupportMessage, viewer: SupportMessage['author']) {
  return viewer === 'owner' && message.author === 'owner' && !message.sticker && !message.sending && message.id > 0
}

/** «Редактировать» chosen on a message; after a failed save, with the words typed and the reason. */
export interface SupportEditTarget { message: SupportMessage; draft?: string; error?: string }

/**
 * «Редактировать» (owner, 15.11.2026: «Редактирование своих сообщений только у админа… Человек не видит, что сообщение
 * отредактировано: никакой пометки, просто новый текст»): the message being edited (the composer takes its words), and the
 * conversation with the new words shown at once while the server saves them. A failed save brings the edit back with the
 * words and the reason. `save` gets the message and the new words.
 */
export function useSupportEdit(messages: SupportMessage[], save: (message: SupportMessage, text: string) => Promise<unknown>) {
  const [editing, setEditing] = useState<SupportEditTarget | null>(null)
  const [changed, setChanged] = useState<Record<number, string>>({})
  const latest = useRef(save)
  useEffect(() => { latest.current = save })
  const start = useCallback((message: SupportMessage) => setEditing({ message }), [])
  const cancel = useCallback(() => setEditing(null), [])
  const submit = useCallback(async (message: SupportMessage, text: string) => {
    setEditing(null)
    const words = cleanSupportText(text)
    setChanged((current) => ({ ...current, [message.id]: words }))
    try {
      await latest.current(message, text)
    } catch (reason) {
      setEditing({ message, draft: text, error: cleanIpcError(reason) || 'Не удалось изменить сообщение' })
    } finally {
      setChanged((current) => {
        if (current[message.id] !== words) return current
        const rest = { ...current }
        delete rest[message.id]
        return rest
      })
    }
  }, [])
  const shown = useMemo(() => (Object.keys(changed).length ? messages.map((message) => {
    const words = changed[message.id]
    if (words === undefined) return message
    if (message.report) return { ...message, report: { ...message.report, text: words } }
    return { ...message, text: words || (message.attachments?.length ? SUPPORT_IMAGE_PLACEHOLDER : '') }
  }) : messages), [changed, messages])
  const target = editing && messages.some((message) => message.id === editing.message.id) ? editing : null
  return { messages: shown, editing: target, start, cancel, submit }
}

/**
 * The chat's own small layers (a message's menu, the emoji and sticker grids, a reply being written): Escape closes the
 * newest one only, and a dialog under them leaves it to them (support/SupportChat.tsx SupportChatDialog), as for an
 * ImageViewer (which goes first: it is over everything).
 */
const layers: Array<{ close: () => void }> = []
function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !layers.length || imageViewerOpen()) return
  event.preventDefault()
  event.stopPropagation()
  layers.at(-1)!.close()
}

/** A layer of the chat is open (its Escape closes only it). */
export function supportChatLayerOpen() {
  return layers.length > 0
}

export function useEscapeLayer(open: boolean, close: () => void) {
  const latest = useRef(close)
  useEffect(() => { latest.current = close })
  useEffect(() => {
    if (!open) return
    const layer = { close: () => latest.current() }
    layers.push(layer)
    if (layers.length === 1) window.addEventListener('keydown', onEscape, true)
    return () => {
      layers.splice(layers.indexOf(layer), 1)
      if (!layers.length) window.removeEventListener('keydown', onEscape, true)
    }
  }, [open])
}

/** A report the next message of the owner answers, as «Разъяснить» opens the chat (owner, 25.11.2026). */
export interface SupportReportAnswer { id: number; title: string }

/**
 * «Разъяснить» on a bug (owner, 25.11.2026: «у меня открывается окно в чате с ним и ответ на его сообщение»): the owner's next message
 * answers the report — «Ответ на заявку №N» above it, for the player too (`reportId`). `take` hands its number to that one message;
 * «×» drops it and the message goes as a plain one.
 */
export function useSupportReportAnswer(answer?: SupportReportAnswer | null) {
  const [about, setAbout] = useState(answer ?? null)
  const pending = useRef(answer ?? null)
  const take = useCallback(() => {
    const report = pending.current
    pending.current = null
    setAbout(null)
    return report?.id
  }, [])
  const cancel = useCallback(() => { pending.current = null; setAbout(null) }, [])
  return { about, take, cancel }
}
