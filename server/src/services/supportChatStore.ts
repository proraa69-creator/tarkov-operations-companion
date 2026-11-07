/**
 * «Чат с поддержкой» (owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»): one conversation per
 * account between the player and the owner — the player writes from the app (PC or phone), the owner answers from the
 * owner app's «Заявки» → «Чаты» (routes/supportChat.ts). Plain text only.
 *
 * The table is created with IF NOT EXISTS, nothing is ever dropped:
 *   support_messages — one message: `author` 'user' (the player) or 'owner' (the answer, shown to the player as
 *                      «Raid OS»); `body` — the cleaned text (src/shared/supportChat.ts); the read marks: `owner_read_at`
 *                      (the owner has seen a player's message) and `user_read_at` (the player has seen an answer). The
 *                      author's own mark is set when the message is written, so «unread» is simply a missing mark.
 *
 * At most SUPPORT_CHAT_LIMITS.keep messages per account: the oldest ones go when a new one is written. Deleting an
 * account (AccountStore.deleteAccount) deletes its messages.
 *
 * The owner may also write first (owner, 14.10.2026: «где я отметил добавь открыть чат и туда можно будет писать», from
 * a report in «Заявки»), and «Проблема решена» deletes the whole conversation for both sides («добавь кнопку у админ
 * версии, проблема решена. и данный чат удаляется»): `deleteThread`.
 *
 * Screenshots (owner, 15.10.2026: «еще связаться с поддержкой, добавь что бы можно было добавить скриншот»): up to
 * SUPPORT_IMAGE_LIMITS.files per message, stored like the bug reports' (services/bugReportStore.ts: the bytes in the
 * database, the type by the first bytes, never by what the app declared) in
 *   support_attachments — one image: a random 24-hex id, its message, account, order, type, size, width × height
 *                         (services/imageSize.ts) and bytes;
 * and counted on the message (`images`, a column added to older tables). A message may be images only: its text is then
 * stored empty and answered as SUPPORT_IMAGE_PLACEHOLDER («[скриншот]»), so apps that know nothing of `attachments`
 * (before 15.10.2026), the owner's chat list and the website still show something. A message's images go with it (a
 * trigger: the oldest messages past `keep`, «Проблема решена», a deleted account). All images together stay under
 * SUPPORT_IMAGE_STORAGE.maxStoredBytes (507 past it; text still goes through); images older than 90 days are deleted
 * (the message stays, with its text).
 *
 * An answer about a report (owner, 04.11.2026: «прям там могу ответить, не открывая чат. У человека появляется в чате номер
 * его заявки, и название его заявки, заголовок. И пишется, что это ответ на заявку»): the message keeps the report's
 * number, kind and title as they were (`report_id`, `report_kind`, `report_title`, columns added to older tables) and
 * answers them as `report`, with the owner's words; `text` also carries them for apps that know nothing of `report`
 * (src/shared/supportChat.ts supportReportText).
 *
 * Reactions, replies and stickers (owner, 07.11.2026: «и пользователь, и я смог ставить на сообщения лайки или нажать правой
 * клавишей и нажать «Ответить» именно на это сообщение… стикеры в стиле Таркова отправлять»):
 *   support_reactions — one side's reaction on a message: its message, account, author, emoji (one of SUPPORT_REACTIONS,
 *                       src/shared/supportStickers.ts) and when; keyed by message + author + emoji, so each side sets an
 *                       emoji once. A message's reactions go with it (a trigger, as its screenshots).
 *   A reply keeps the message it answers as it read then (`reply_to`, `reply_author`, `reply_text` — a short excerpt —
 *   and `reply_sticker`, columns added to older tables), only a message of the same conversation; answered as `replyTo`.
 *   A sticker (`sticker`) is a message of its own, without text or screenshots: its text is stored empty and answered as
 *   «[стикер: Крыса]» (supportStickerText) for apps that know nothing of `sticker`.
 *
 * The owner's sticker packs (owner, 07.11.2026: «И там я буду делать паки стикеров. Которые по нажатию кнопки добавить будут
 * добавляться в приложение на ПК и телефон»; services/stickerStore.ts): a message carries a built-in sticker
 * (SUPPORT_STICKER_IDS) or one of a published pack (`stickers`); older apps read «[стикер: <pack>]». Deleted later (the
 * sticker or its pack), the message reads SUPPORT_STICKER_PLACEHOLDER («[стикер]») without `sticker`, and a quote of it
 * without its sticker; so does one of a built-in sticker that is no longer in the pack.
 */
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { randomBytes } from 'node:crypto'
import { sniffImage, type ImageMime } from './bugReportStore.js'
import { imageSize } from './imageSize.js'
import { cleanSupportText, SUPPORT_IMAGE_LIMITS, SUPPORT_IMAGE_PLACEHOLDER, SUPPORT_MESSAGE_MAX, SUPPORT_STICKER_PLACEHOLDER, supportQuoteText, supportReportText, supportStickerText, type SupportAttachment, type SupportReaction, type SupportReplyQuote, type SupportReportRef, type SupportReportReply } from '../../../src/shared/supportChat.js'
import { isOwnerStickerId, isSupportStickerId, SUPPORT_REACTIONS, SUPPORT_STICKER_IDS } from '../../../src/shared/supportStickers.js'

type Row = Record<string, unknown>

/** 'user': the player; 'owner': the answer. */
export type SupportAuthor = 'user' | 'owner'

export interface SupportMessage {
  id: number
  author: SupportAuthor
  text: string
  createdAt: string
  /** The other side has seen it: the owner a player's message, the player an answer. */
  read: boolean
  /** Its screenshots still stored, in order; only on a message that has any (older answers keep their shape). */
  attachments?: SupportAttachment[]
  /** The report this answer is about: its number, kind, title and the owner's own words. */
  report?: SupportReportReply
  /** A sticker message: the sticker's id (its `text` is «[стикер: …]» for older apps). */
  sticker?: string
  /** The message this one answers, as it read then. */
  replyTo?: SupportReplyQuote
  /** Its reactions, the first one set first; only on a message that has any. */
  reactions?: SupportReaction[]
}

/** A message's sticker and the message it answers (the bodies' `sticker` and `replyTo`). */
export interface SupportMessageExtra { sticker?: string; replyTo?: number }

export interface SupportThread {
  accountId: string
  lastMessage: SupportMessage
  lastAt: string
  /** The player's messages the owner has not seen. */
  unread: number
}

export const SUPPORT_CHAT_LIMITS = {
  /** Messages kept per account. */
  keep: 500,
  /** Messages in one answer: the newest ones (or the first ones after `after`), oldest first. */
  page: 200,
}

const DAY = 24 * 60 * 60 * 1000

export const SUPPORT_IMAGE_STORAGE = {
  /** All stored chat screenshots together. */
  maxStoredBytes: 500 * 1024 * 1024,
  retentionMs: 90 * DAY,
  pruneEveryMs: 60 * 60 * 1000,
}

export const EMPTY_MESSAGE = 'Напишите сообщение'
export const TOO_MANY_IMAGES = `Не больше ${SUPPORT_IMAGE_LIMITS.files} скриншотов`
export const IMAGE_TOO_BIG = 'Скриншот больше 5 МБ'
export const IMAGE_TYPE_MESSAGE = 'Скриншоты принимаются только в PNG, JPEG или WEBP'
export const IMAGE_STORAGE_FULL = 'Хранилище скриншотов сейчас заполнено. Отправьте сообщение без скриншотов.'
export const TOO_LONG_MESSAGE = `Сообщение длиннее ${SUPPORT_MESSAGE_MAX} символов`
/** A reply or a reaction to a message that is not in this conversation (another one's, or gone). */
export const MESSAGE_NOT_FOUND = 'Сообщение не найдено'
export const UNKNOWN_STICKER = 'Неизвестный стикер'
export const STICKER_ALONE = 'Стикер отправляется без текста и скриншотов'
export const UNKNOWN_REACTION = 'Такой реакции нет'

export class SupportChatError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    owner_read_at INTEGER,
    user_read_at INTEGER);
  CREATE INDEX IF NOT EXISTS support_messages_account ON support_messages(account_id, id);
  CREATE INDEX IF NOT EXISTS support_messages_owner_unread ON support_messages(account_id) WHERE owner_read_at IS NULL;
  CREATE TABLE IF NOT EXISTS support_attachments (
    id TEXT PRIMARY KEY,
    message_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS support_attachments_message ON support_attachments(message_id, idx);
  CREATE INDEX IF NOT EXISTS support_attachments_created ON support_attachments(created_at);
  CREATE TRIGGER IF NOT EXISTS support_messages_attachments AFTER DELETE ON support_messages
    BEGIN DELETE FROM support_attachments WHERE message_id = OLD.id; END;
  CREATE TABLE IF NOT EXISTS support_reactions (
    message_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    author TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, author, emoji));
  CREATE TRIGGER IF NOT EXISTS support_messages_reactions AFTER DELETE ON support_messages
    BEGIN DELETE FROM support_reactions WHERE message_id = OLD.id; END;
`

/**
 * Checks a message's screenshots: count, size and the real type; returns each one's type and size in pixels. Throws
 * 400 with the reason (Russian, for the apps' uiText).
 */
export function checkSupportImages(files: Buffer[]): Array<{ mime: ImageMime; width: number; height: number }> {
  if (files.length > SUPPORT_IMAGE_LIMITS.files) throw new SupportChatError(400, TOO_MANY_IMAGES)
  return files.map((file) => {
    if (file.length === 0) throw new SupportChatError(400, 'Пустой файл скриншота')
    if (file.length > SUPPORT_IMAGE_LIMITS.fileBytes) throw new SupportChatError(400, IMAGE_TOO_BIG)
    const mime = sniffImage(file)
    if (!mime) throw new SupportChatError(400, IMAGE_TYPE_MESSAGE)
    const size = imageSize(file, mime)
    if (!size || size.width > 30_000 || size.height > 30_000) throw new SupportChatError(400, 'Повреждённый файл скриншота')
    return { mime, ...size }
  })
}

/** The text as it is stored; throws 400 for an empty one or one over SUPPORT_MESSAGE_MAX characters. */
export function supportText(raw: string) {
  const text = cleanSupportText(raw)
  if (!text) throw new SupportChatError(400, EMPTY_MESSAGE)
  if (text.length > SUPPORT_MESSAGE_MAX) throw new SupportChatError(400, TOO_LONG_MESSAGE)
  return text
}

const count = (row: unknown) => Number((row as { n?: unknown } | undefined)?.n ?? 0)

/** The owner's stickers that still exist, with their pack's name and whether it is published (services/stickerStore.ts). */
export interface SupportStickerLookup {
  describe(ids: Iterable<string>): Map<string, { pack: string; published: boolean }>
}
type StickerInfo = ReturnType<SupportStickerLookup['describe']>

export interface SupportChatStoreOptions {
  now?: () => number
  /** The owner's sticker packs; without them only the built-in stickers are accepted. */
  stickers?: SupportStickerLookup
  /** Overrides SUPPORT_CHAT_LIMITS.keep (tests). */
  keep?: number
  /** Overrides SUPPORT_IMAGE_STORAGE.maxStoredBytes (tests). */
  maxStoredBytes?: number
}

export class SupportChatStore {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly keep: number
  private readonly maxStoredBytes: number
  private readonly stickers?: SupportStickerLookup
  private prunedAt = 0

  constructor(db: DatabaseSync, options: SupportChatStoreOptions = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    this.keep = options.keep ?? SUPPORT_CHAT_LIMITS.keep
    this.stickers = options.stickers
    // Deleted conversations must not remain recoverable in free SQLite pages.
    this.db.exec('PRAGMA secure_delete = ON')
    this.maxStoredBytes = options.maxStoredBytes ?? SUPPORT_IMAGE_STORAGE.maxStoredBytes
    this.db.exec(SCHEMA)
    const columns = new Set((this.db.prepare('PRAGMA table_info(support_messages)').all() as Row[]).map((row) => String(row.name)))
    if (!columns.has('images')) this.db.exec('ALTER TABLE support_messages ADD COLUMN images INTEGER NOT NULL DEFAULT 0')
    if (!columns.has('report_id')) this.db.exec('ALTER TABLE support_messages ADD COLUMN report_id INTEGER')
    if (!columns.has('report_kind')) this.db.exec('ALTER TABLE support_messages ADD COLUMN report_kind TEXT')
    if (!columns.has('report_title')) this.db.exec('ALTER TABLE support_messages ADD COLUMN report_title TEXT')
    if (!columns.has('sticker')) this.db.exec('ALTER TABLE support_messages ADD COLUMN sticker TEXT')
    if (!columns.has('reply_to')) this.db.exec('ALTER TABLE support_messages ADD COLUMN reply_to INTEGER')
    if (!columns.has('reply_author')) this.db.exec('ALTER TABLE support_messages ADD COLUMN reply_author TEXT')
    if (!columns.has('reply_text')) this.db.exec('ALTER TABLE support_messages ADD COLUMN reply_text TEXT')
    if (!columns.has('reply_sticker')) this.db.exec('ALTER TABLE support_messages ADD COLUMN reply_sticker TEXT')
    this.pruneImages()
  }

  /** Bytes of all stored chat screenshots. */
  storedImageBytes() {
    return count(this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM support_attachments').get())
  }

  /** Whether no more screenshots are accepted (checked before an upload is read, too). */
  imagesFull() {
    return this.storedImageBytes() >= this.maxStoredBytes
  }

  /** Retention: deletes screenshots older than SUPPORT_IMAGE_STORAGE.retentionMs (the messages stay); returns how many. */
  pruneImages() {
    this.prunedAt = this.now()
    return Number(this.db.prepare('DELETE FROM support_attachments WHERE created_at < ?').run(this.prunedAt - SUPPORT_IMAGE_STORAGE.retentionMs).changes)
  }

  /**
   * Writes a message of the account's conversation, with its screenshots (`files`, checked by checkSupportImages), and
   * drops its oldest ones past the limit. With screenshots the text may be empty. 507 when the screenshots do not fit
   * the storage. `report`: the report an owner's answer is about. `extra.sticker`: a sticker message (no text, no
   * screenshots); `extra.replyTo`: the message of this conversation it answers (404 for any other).
   */
  add(accountId: string, author: SupportAuthor, raw: string, files: Buffer[] = [], report?: SupportReportRef, extra: SupportMessageExtra = {}): SupportMessage {
    const sticker = extra.sticker
    let stickerPack: string | undefined
    if (sticker !== undefined) {
      if (!isSupportStickerId(sticker)) throw new SupportChatError(400, UNKNOWN_STICKER)
      // One of the owner's: only a sticker of a published pack.
      if (!SUPPORT_STICKER_IDS.has(sticker)) {
        const info = this.stickerInfo([sticker]).get(sticker)
        if (!info?.published) throw new SupportChatError(400, UNKNOWN_STICKER)
        stickerPack = info.pack
      }
      if (cleanSupportText(raw) || files.length) throw new SupportChatError(400, STICKER_ALONE)
    }
    const text = sticker !== undefined || files.length ? cleanSupportText(raw) : supportText(raw)
    if (text.length > SUPPORT_MESSAGE_MAX) throw new SupportChatError(400, TOO_LONG_MESSAGE)
    const images = checkSupportImages(files)
    const at = this.now()
    if (files.length && at - this.prunedAt >= SUPPORT_IMAGE_STORAGE.pruneEveryMs) this.pruneImages()
    return transaction(this.db, () => {
      const quoted = extra.replyTo === undefined ? undefined : this.quote(accountId, extra.replyTo)
      const quote = quoted ? quoteView(quoted, this.stickerInfo(quoted.sticker ? [quoted.sticker] : [])) : undefined
      const incoming = files.reduce((sum, file) => sum + file.length, 0)
      if (incoming > 0 && this.storedImageBytes() + incoming > this.maxStoredBytes) throw new SupportChatError(507, IMAGE_STORAGE_FULL)
      const result = this.db.prepare(`INSERT INTO support_messages (account_id, author, body, created_at, owner_read_at, user_read_at, images, report_id, report_kind,
          report_title, sticker, reply_to, reply_author, reply_text, reply_sticker) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(accountId, author, text, at, author === 'owner' ? at : null, author === 'user' ? at : null, files.length, report?.id ?? null, report?.kind ?? null,
          report?.title ?? null, sticker ?? null, quoted?.id ?? null, quoted?.author ?? null, quoted?.text ?? null, quoted?.sticker ?? null)
      const id = Number(result.lastInsertRowid)
      const insert = this.db.prepare('INSERT INTO support_attachments (id, message_id, account_id, idx, mime, size, width, height, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const attachments = files.map((file, idx) => {
        const image = images[idx]!
        const attachment = { id: randomBytes(12).toString('hex'), width: image.width, height: image.height }
        insert.run(attachment.id, id, accountId, idx, image.mime, file.length, image.width, image.height, file, at)
        return attachment
      })
      this.db.prepare(`DELETE FROM support_messages WHERE account_id = ? AND id <= (
        SELECT id FROM support_messages WHERE account_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`).run(accountId, accountId, this.keep)
      return {
        id, author, ...readable(text, files.length, report, sticker, stickerPack), createdAt: new Date(at).toISOString(), read: false,
        ...(sticker !== undefined ? { sticker } : {}),
        ...(quote ? { replyTo: quote } : {}),
        ...(attachments.length ? { attachments } : {}),
      }
    })
  }

  /** The owner's stickers among `ids` that still exist (none without the packs). */
  private stickerInfo(ids: Iterable<string>): StickerInfo {
    const owners = [...ids].filter(isOwnerStickerId)
    if (!owners.length || !this.stickers) return new Map()
    try { return this.stickers.describe(owners) } catch { return new Map() }
  }

  /** The message `id` of the account's conversation as a reply quotes it; 404 for one of another conversation or gone. */
  private quote(accountId: string, id: number): SupportReplyQuote {
    const row = Number.isSafeInteger(id) && id > 0
      ? this.db.prepare('SELECT id, author, body, sticker FROM support_messages WHERE id = ? AND account_id = ?').get(id, accountId) as Row | undefined
      : undefined
    if (!row) throw new SupportChatError(404, MESSAGE_NOT_FOUND)
    const sticker = typeof row.sticker === 'string' && row.sticker ? row.sticker : undefined
    return { id: Number(row.id), author: row.author === 'owner' ? 'owner' : 'user', text: supportQuoteText(String(row.body)), ...(sticker ? { sticker } : {}) }
  }

  /**
   * Sets (`on` true) or takes back (`on` false; absent: the other way round) `author`'s reaction `emoji` on the message
   * `id` of the account's conversation; returns the message as it reads now and whether anything changed. 400 for an
   * emoji not in SUPPORT_REACTIONS, 404 for a message of another conversation or one that is gone.
   */
  react(accountId: string, id: number, author: SupportAuthor, emoji: string, on?: boolean): { message: SupportMessage; changed: boolean } {
    if (!SUPPORT_REACTIONS.includes(emoji)) throw new SupportChatError(400, UNKNOWN_REACTION)
    return transaction(this.db, () => {
      const row = Number.isSafeInteger(id) && id > 0
        ? this.db.prepare('SELECT * FROM support_messages WHERE id = ? AND account_id = ?').get(id, accountId) as Row | undefined
        : undefined
      if (!row) throw new SupportChatError(404, MESSAGE_NOT_FOUND)
      const has = this.db.prepare('SELECT 1 FROM support_reactions WHERE message_id = ? AND author = ? AND emoji = ?').get(id, author, emoji) !== undefined
      const wanted = on ?? !has
      if (wanted && !has) this.db.prepare('INSERT INTO support_reactions (message_id, account_id, author, emoji, created_at) VALUES (?, ?, ?, ?, ?)').run(id, accountId, author, emoji, this.now())
      if (!wanted && has) this.db.prepare('DELETE FROM support_reactions WHERE message_id = ? AND author = ? AND emoji = ?').run(id, author, emoji)
      return { message: this.withExtras([row])[0]!, changed: wanted !== has }
    })
  }

  /** The conversation, oldest first: its newest messages, or only the ones after message `after`. */
  messages(accountId: string, after?: number): SupportMessage[] {
    const rows = after === undefined
      ? (this.db.prepare('SELECT * FROM support_messages WHERE account_id = ? ORDER BY id DESC LIMIT ?').all(accountId, SUPPORT_CHAT_LIMITS.page) as Row[]).reverse()
      : this.db.prepare('SELECT * FROM support_messages WHERE account_id = ? AND id > ? ORDER BY id LIMIT ?').all(accountId, after, SUPPORT_CHAT_LIMITS.page) as Row[]
    return this.withExtras(rows)
  }

  /** The messages of `rows` with their screenshots and their reactions (one query each for all of them). */
  private withExtras(rows: Row[]): SupportMessage[] {
    const ids = rows.filter((row) => Number(row.images ?? 0) > 0).map((row) => Number(row.id))
    const byMessage = new Map<number, SupportAttachment[]>()
    if (ids.length) {
      const found = this.db.prepare(`SELECT id, message_id, width, height FROM support_attachments WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY message_id, idx`).all(...ids) as Row[]
      for (const row of found) {
        const list = byMessage.get(Number(row.message_id)) ?? []
        list.push({ id: String(row.id), width: Number(row.width), height: Number(row.height) })
        byMessage.set(Number(row.message_id), list)
      }
    }
    const reactions = new Map<number, SupportReaction[]>()
    const all = rows.map((row) => Number(row.id))
    if (all.length) {
      const found = this.db.prepare(`SELECT message_id, author, emoji FROM support_reactions WHERE message_id IN (${all.map(() => '?').join(',')}) ORDER BY created_at, rowid`).all(...all) as Row[]
      for (const row of found) {
        const list = reactions.get(Number(row.message_id)) ?? []
        const emoji = String(row.emoji)
        const side: SupportAuthor = row.author === 'owner' ? 'owner' : 'user'
        const entry = list.find((reaction) => reaction.emoji === emoji)
        if (!entry) list.push({ emoji, authors: [side] })
        else if (!entry.authors.includes(side)) entry.authors.push(side)
        reactions.set(Number(row.message_id), list)
      }
    }
    const stickers = this.stickerInfo(rows.flatMap((row) => [filled(row.sticker), filled(row.reply_sticker)].filter((id): id is string => Boolean(id))))
    return rows.map((row) => view(row, stickers, byMessage.get(Number(row.id)), reactions.get(Number(row.id))))
  }

  /** One screenshot with the account whose conversation it belongs to (the routes check who may read it). */
  attachment(id: string): { accountId: string; mime: ImageMime; width: number; height: number; data: Buffer } | undefined {
    const row = this.db.prepare('SELECT account_id, mime, width, height, data FROM support_attachments WHERE id = ?').get(id) as Row | undefined
    if (!row) return undefined
    return { accountId: String(row.account_id), mime: String(row.mime) as ImageMime, width: Number(row.width), height: Number(row.height), data: Buffer.from(row.data as Uint8Array) }
  }

  /**
   * The id of the conversation's oldest message kept here; null when there is none (never written, or deleted with
   * «Проблема решена»). An app that only reads what is new drops what it still shows from before it.
   */
  oldestId(accountId: string): number | null {
    const row = this.db.prepare('SELECT MIN(id) AS n FROM support_messages WHERE account_id = ?').get(accountId) as { n?: unknown } | undefined
    return row?.n == null ? null : Number(row.n)
  }

  /** «Проблема решена»: the whole conversation goes, for both sides; returns how many messages it deleted. */
  deleteThread(accountId: string) {
    return Number(this.db.prepare('DELETE FROM support_messages WHERE account_id = ?').run(accountId).changes)
  }

  /** The owner's answers the player has not seen (the badge on «Связаться»). */
  unreadForUser(accountId: string) {
    return count(this.db.prepare('SELECT COUNT(*) AS n FROM support_messages WHERE account_id = ? AND user_read_at IS NULL').get(accountId))
  }

  /** `reader` has seen everything the other side wrote; returns how many messages it marked. */
  markRead(accountId: string, reader: SupportAuthor) {
    const column = reader === 'owner' ? 'owner_read_at' : 'user_read_at'
    return Number(this.db.prepare(`UPDATE support_messages SET ${column} = ? WHERE account_id = ? AND ${column} IS NULL`).run(this.now(), accountId).changes)
  }

  /** Conversations with a player's message the owner has not seen (the «Чаты» count and the «Заявки» badge). */
  unreadThreads() {
    return count(this.db.prepare('SELECT COUNT(DISTINCT account_id) AS n FROM support_messages WHERE owner_read_at IS NULL').get())
  }

  /** A page of conversations, the latest message first; `unread`: conversations with unseen messages. */
  threads(limit: number, offset: number): { threads: SupportThread[]; total: number; unread: number } {
    const rows = this.db.prepare(`SELECT account_id, MAX(id) AS last_id, SUM(owner_read_at IS NULL) AS unread FROM support_messages
      GROUP BY account_id ORDER BY last_id DESC LIMIT ? OFFSET ?`).all(limit, offset) as Row[]
    const last = this.db.prepare('SELECT * FROM support_messages WHERE id = ?')
    const threads = rows.map((row) => {
      const message = this.withExtras([last.get(Number(row.last_id)) as Row])[0]!
      return { accountId: String(row.account_id), lastMessage: message, lastAt: message.createdAt, unread: Number(row.unread ?? 0) }
    })
    return { threads, total: count(this.db.prepare('SELECT COUNT(DISTINCT account_id) AS n FROM support_messages').get()), unread: this.unreadThreads() }
  }

}

/**
 * What a message reads. Images only: the placeholder, also once the images themselves are gone (retention); a sticker:
 * «[стикер: …]» for apps that know nothing of `sticker` (`pack`: the name of an owner's sticker's pack; without it, one
 * that is gone reads «[стикер]»).
 */
function readable(body: string, images: number, ref: SupportReportRef | undefined, sticker?: string, pack?: string): Pick<SupportMessage, 'text' | 'report'> {
  const text = body || (sticker ? supportStickerText(sticker, pack) : images > 0 ? SUPPORT_IMAGE_PLACEHOLDER : '')
  if (!ref) return { text }
  const report = { ...ref, text }
  return { text: supportReportText(report), report }
}

const filled = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/** A sticker as a message shows it: a built-in one, or one of the owner's that still exists (with its pack's name). */
function shownSticker(id: string | undefined, stickers: StickerInfo): { id: string; pack?: string } | undefined {
  if (!id) return undefined
  if (SUPPORT_STICKER_IDS.has(id)) return { id }
  const info = stickers.get(id)
  return info ? { id, pack: info.pack } : undefined
}

/** A quote of a sticker that is gone reads «[стикер]», without it. */
function quoteView(quote: SupportReplyQuote, stickers: StickerInfo): SupportReplyQuote {
  const sticker = shownSticker(quote.sticker, stickers)
  const text = quote.sticker && !sticker && !quote.text ? SUPPORT_STICKER_PLACEHOLDER : quote.text
  return { id: quote.id, author: quote.author, text, ...(sticker ? { sticker: sticker.id } : {}) }
}

function view(row: Row, stickers: StickerInfo, attachments?: SupportAttachment[], reactions?: SupportReaction[]): SupportMessage {
  const author: SupportAuthor = row.author === 'owner' ? 'owner' : 'user'
  const report: SupportReportRef | undefined = row.report_id == null ? undefined
    : { id: Number(row.report_id), kind: row.report_kind === 'idea' ? 'idea' : 'bug', title: String(row.report_title ?? '') }
  const stored = filled(row.sticker)
  const shown = shownSticker(stored, stickers)
  const sticker = shown?.id
  const replySticker = filled(row.reply_sticker)
  const replyTo: SupportReplyQuote | undefined = row.reply_to == null ? undefined : quoteView({
    id: Number(row.reply_to), author: row.reply_author === 'owner' ? 'owner' : 'user', text: String(row.reply_text ?? ''), ...(replySticker ? { sticker: replySticker } : {}),
  }, stickers)
  return {
    id: Number(row.id),
    author,
    // A sticker that is gone still reads as one: «[стикер]».
    ...readable(String(row.body), Number(row.images ?? 0), report, stored, shown?.pack),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    read: (author === 'user' ? row.owner_read_at : row.user_read_at) != null,
    ...(sticker ? { sticker } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(reactions?.length ? { reactions } : {}),
  }
}
