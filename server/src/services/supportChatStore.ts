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
 */
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { randomBytes } from 'node:crypto'
import { sniffImage, type ImageMime } from './bugReportStore.js'
import { imageSize } from './imageSize.js'
import { cleanSupportText, SUPPORT_IMAGE_LIMITS, SUPPORT_IMAGE_PLACEHOLDER, SUPPORT_MESSAGE_MAX, type SupportAttachment } from '../../../src/shared/supportChat.js'

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
}

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

export interface SupportChatStoreOptions {
  now?: () => number
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
  private prunedAt = 0

  constructor(db: DatabaseSync, options: SupportChatStoreOptions = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    this.keep = options.keep ?? SUPPORT_CHAT_LIMITS.keep
    // Deleted conversations must not remain recoverable in free SQLite pages.
    this.db.exec('PRAGMA secure_delete = ON')
    this.maxStoredBytes = options.maxStoredBytes ?? SUPPORT_IMAGE_STORAGE.maxStoredBytes
    this.db.exec(SCHEMA)
    const columns = new Set((this.db.prepare('PRAGMA table_info(support_messages)').all() as Row[]).map((row) => String(row.name)))
    if (!columns.has('images')) this.db.exec('ALTER TABLE support_messages ADD COLUMN images INTEGER NOT NULL DEFAULT 0')
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
   * the storage.
   */
  add(accountId: string, author: SupportAuthor, raw: string, files: Buffer[] = []): SupportMessage {
    const text = files.length ? cleanSupportText(raw) : supportText(raw)
    if (text.length > SUPPORT_MESSAGE_MAX) throw new SupportChatError(400, TOO_LONG_MESSAGE)
    const images = checkSupportImages(files)
    const at = this.now()
    if (files.length && at - this.prunedAt >= SUPPORT_IMAGE_STORAGE.pruneEveryMs) this.pruneImages()
    return transaction(this.db, () => {
      const incoming = files.reduce((sum, file) => sum + file.length, 0)
      if (incoming > 0 && this.storedImageBytes() + incoming > this.maxStoredBytes) throw new SupportChatError(507, IMAGE_STORAGE_FULL)
      const result = this.db.prepare('INSERT INTO support_messages (account_id, author, body, created_at, owner_read_at, user_read_at, images) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(accountId, author, text, at, author === 'owner' ? at : null, author === 'user' ? at : null, files.length)
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
        id, author, text: text || SUPPORT_IMAGE_PLACEHOLDER, createdAt: new Date(at).toISOString(), read: false,
        ...(attachments.length ? { attachments } : {}),
      }
    })
  }

  /** The conversation, oldest first: its newest messages, or only the ones after message `after`. */
  messages(accountId: string, after?: number): SupportMessage[] {
    const rows = after === undefined
      ? (this.db.prepare('SELECT * FROM support_messages WHERE account_id = ? ORDER BY id DESC LIMIT ?').all(accountId, SUPPORT_CHAT_LIMITS.page) as Row[]).reverse()
      : this.db.prepare('SELECT * FROM support_messages WHERE account_id = ? AND id > ? ORDER BY id LIMIT ?').all(accountId, after, SUPPORT_CHAT_LIMITS.page) as Row[]
    return this.withAttachments(rows)
  }

  /** The messages of `rows` with their screenshots (one query for all of them). */
  private withAttachments(rows: Row[]): SupportMessage[] {
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
    return rows.map((row) => view(row, byMessage.get(Number(row.id))))
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
      const message = this.withAttachments([last.get(Number(row.last_id)) as Row])[0]!
      return { accountId: String(row.account_id), lastMessage: message, lastAt: message.createdAt, unread: Number(row.unread ?? 0) }
    })
    return { threads, total: count(this.db.prepare('SELECT COUNT(DISTINCT account_id) AS n FROM support_messages').get()), unread: this.unreadThreads() }
  }

}

function view(row: Row, attachments?: SupportAttachment[]): SupportMessage {
  const author: SupportAuthor = row.author === 'owner' ? 'owner' : 'user'
  const text = String(row.body)
  return {
    id: Number(row.id),
    author,
    // Images only: the placeholder, also once the images themselves are gone (retention).
    text: text || (Number(row.images ?? 0) > 0 ? SUPPORT_IMAGE_PLACEHOLDER : ''),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    read: (author === 'user' ? row.owner_read_at : row.user_read_at) != null,
    ...(attachments?.length ? { attachments } : {}),
  }
}
