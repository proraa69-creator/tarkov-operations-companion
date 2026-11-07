/**
 * Reactions, replies, emoji and stickers of «Чат с поддержкой» (owner, 07.11.2026: «и пользователь, и я смог ставить на
 * сообщения лайки или нажать правой клавишей и нажать «Ответить» именно на это сообщение… И просто отправлять смайлики.
 * Добавь смайлики всякие… стикеры в стиле Таркова»): what support/SupportChat.tsx and its three places (the player's
 * window, the owner's «Чаты», the owner's iPhone admin) share besides the components.
 */
import { useEffect, useRef, useState } from 'react'
import { imageViewerOpen } from '../components/ImageViewer'
import { uiText } from '../i18n/renderText'
import { SUPPORT_IMAGE_PLACEHOLDER, supportQuoteText, type SupportReaction, type SupportReplyQuote, type SupportSide } from '../shared/supportChat'
import { supportSticker } from '../shared/supportStickers'
import type { SupportMessage } from './supportChatClient'

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

/** A sticker's caption in the reader's language (never passed through uiText: the pack has both). */
export function stickerCaption(id: string | undefined, locale: 'ru' | 'en') {
  const sticker = supportSticker(id)
  return sticker ? (locale === 'en' ? sticker.en : sticker.ru) : ''
}

/** A message as a reply would quote it (the server keeps the same: services/supportChatStore.ts). */
export function replyQuoteOf(message: SupportMessage): SupportReplyQuote {
  const words = message.report?.text ?? message.text
  if (message.sticker) return { id: message.id, author: message.author, text: '', sticker: message.sticker }
  return { id: message.id, author: message.author, text: words === SUPPORT_IMAGE_PLACEHOLDER ? '' : supportQuoteText(words) }
}

/** What a quote reads: the excerpt, «Стикер: Крыса», or «Скриншот» for screenshots only. */
export function quoteBody(quote: Pick<SupportReplyQuote, 'text' | 'sticker'>, locale: 'ru' | 'en') {
  const caption = stickerCaption(quote.sticker, locale)
  if (caption) return `${uiText('Стикер')}: ${caption}`
  return quote.text || uiText('Скриншот')
}

/** The latest message of a conversation in a list of chats: its words, «Стикер: Крыса» or «[скриншот]». */
export function supportPreviewText(message: SupportMessage, locale: 'ru' | 'en') {
  const caption = stickerCaption(message.sticker, locale)
  if (caption) return `${uiText('Стикер')}: ${caption}`
  return message.text === SUPPORT_IMAGE_PLACEHOLDER ? uiText(SUPPORT_IMAGE_PLACEHOLDER) : message.text
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
