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
 */
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { sniffImage, type ImageMime } from './bugReportStore.js'
import { cleanSupportText, SUPPORT_MESSAGE_MAX } from '../../../src/shared/supportChat.js'

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
  image?: { mime: ImageMime; size: number }
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

export const EMPTY_MESSAGE = 'Напишите сообщение'
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
  CREATE TABLE IF NOT EXISTS support_message_files (
    message_id INTEGER PRIMARY KEY REFERENCES support_messages(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL);
  CREATE TRIGGER IF NOT EXISTS support_messages_delete_file BEFORE DELETE ON support_messages
    BEGIN DELETE FROM support_message_files WHERE message_id = OLD.id; END;
`

export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

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
}

export class SupportChatStore {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly keep: number

  constructor(db: DatabaseSync, options: SupportChatStoreOptions = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    this.keep = options.keep ?? SUPPORT_CHAT_LIMITS.keep
    // Deleted conversations must not remain recoverable in free SQLite pages.
    this.db.exec('PRAGMA secure_delete = ON')
    this.db.exec(SCHEMA)
  }

  /** Writes a message of the account's conversation and drops its oldest ones past the limit. */
  add(accountId: string, author: SupportAuthor, raw: string): SupportMessage {
    const text = supportText(raw)
    return transaction(this.db, () => this.insert(accountId, author, text))
  }

  /** One verified screenshot/photo as its own chat message. */
  addImage(accountId: string, author: SupportAuthor, data: Buffer): SupportMessage {
    if (!data.length) throw new SupportChatError(400, 'Пустой файл изображения')
    if (data.length > SUPPORT_IMAGE_MAX_BYTES) throw new SupportChatError(400, 'Изображение больше 5 МБ')
    const mime = sniffImage(data)
    if (!mime) throw new SupportChatError(400, 'Поддерживаются PNG, JPEG и WEBP')
    return transaction(this.db, () => {
      const message = this.insert(accountId, author, 'Фото')
      this.db.prepare('INSERT INTO support_message_files (message_id, mime, size, data) VALUES (?, ?, ?, ?)').run(message.id, mime, data.length, data)
      return { ...message, image: { mime, size: data.length } }
    })
  }

  /** The conversation, oldest first: its newest messages, or only the ones after message `after`. */
  messages(accountId: string, after?: number): SupportMessage[] {
    const rows = after === undefined
      ? (this.db.prepare('SELECT * FROM support_messages WHERE account_id = ? ORDER BY id DESC LIMIT ?').all(accountId, SUPPORT_CHAT_LIMITS.page) as Row[]).reverse()
      : this.db.prepare('SELECT * FROM support_messages WHERE account_id = ? AND id > ? ORDER BY id LIMIT ?').all(accountId, after, SUPPORT_CHAT_LIMITS.page) as Row[]
    return rows.map((row) => this.view(row))
  }

  image(accountId: string, messageId: number): { mime: ImageMime; data: Buffer } | undefined {
    const row = this.db.prepare(`SELECT f.mime, f.data FROM support_message_files f
      JOIN support_messages m ON m.id = f.message_id WHERE m.account_id = ? AND m.id = ?`).get(accountId, messageId) as Row | undefined
    if (!row || !(row.data instanceof Uint8Array)) return undefined
    const data = Buffer.from(row.data)
    const mime = sniffImage(data)
    return mime ? { mime, data } : undefined
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
      const message = this.view(last.get(Number(row.last_id)) as Row)
      return { accountId: String(row.account_id), lastMessage: message, lastAt: message.createdAt, unread: Number(row.unread ?? 0) }
    })
    return { threads, total: count(this.db.prepare('SELECT COUNT(DISTINCT account_id) AS n FROM support_messages').get()), unread: this.unreadThreads() }
  }

  private view(row: Row): SupportMessage {
    const image = this.db.prepare('SELECT mime, size FROM support_message_files WHERE message_id = ?').get(Number(row.id)) as Row | undefined
    return view(row, image)
  }

  private insert(accountId: string, author: SupportAuthor, text: string): SupportMessage {
    const at = this.now()
    const result = this.db.prepare('INSERT INTO support_messages (account_id, author, body, created_at, owner_read_at, user_read_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, author, text, at, author === 'owner' ? at : null, author === 'user' ? at : null)
    this.db.prepare(`DELETE FROM support_messages WHERE account_id = ? AND id <= (
      SELECT id FROM support_messages WHERE account_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`).run(accountId, accountId, this.keep)
    return { id: Number(result.lastInsertRowid), author, text, createdAt: new Date(at).toISOString(), read: false }
  }
}

function view(row: Row, image?: Row): SupportMessage {
  const author: SupportAuthor = row.author === 'owner' ? 'owner' : 'user'
  return {
    id: Number(row.id),
    author,
    text: String(row.body),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    read: (author === 'user' ? row.owner_read_at : row.user_read_at) != null,
    ...(image ? { image: { mime: String(image.mime) as ImageMime, size: Number(image.size) } } : {}),
  }
}
