/**
 * «Доступ Claude к заявкам» (routes/agentRequests.ts; owner, 14.10.2026: «2 вариант да»): the one read-only key for the
 * players' reports. The owner creates it in the owner app («Заявки», src/requests/ClaudeAccessPanel.tsx) and keeps it in
 * the Claude cloud environment's secrets as RAIDOS_REQUESTS_KEY; scripts/read-requests.mjs reads the reports with it.
 *
 * At most one key: a new one replaces the old one at once. A key is `rok_` + 32 random bytes in base64url. Only its
 * SHA-256 is stored, never the key, with when it was created and when it was last used (written at most once a minute).
 * A presented key is hashed and compared with the stored hash in constant time.
 *
 * `pseudonym`: the same short label for every report of one account (HMAC-SHA256 of the account id with a random
 * secret that stays in this database), so the reader can tell one player's reports from many players' without
 * learning anything about the account. The secret does not change with the key.
 *
 * Tables are created IF NOT EXISTS; nothing else is touched:
 *   requests_key         — the key: its SHA-256 (hex), created_at and last_used_at (ms);
 *   requests_key_secret  — the pseudonyms' secret (32 random bytes), created once.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const REQUESTS_KEY_PREFIX = 'rok_'
/** `rok_` + 32 bytes in base64url (43 characters, no padding). */
export const REQUESTS_KEY_PATTERN = /^rok_[A-Za-z0-9_-]{43}$/
/** last_used_at is written at most this often: a read is not a database write every time. */
export const LAST_USED_STEP_MS = 60_000

export interface RequestsKeyStatus { active: boolean; createdAt?: string; lastUsedAt?: string }

type Row = Record<string, unknown>

const sha256 = (key: string) => createHash('sha256').update(key, 'utf8').digest()
const iso = (ms: unknown) => new Date(Number(ms)).toISOString()

export class RequestsKeyStore {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly secret: Buffer

  constructor(db: DatabaseSync, options: { now?: () => number } = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    db.exec(`
      CREATE TABLE IF NOT EXISTS requests_key (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        key_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER);
      CREATE TABLE IF NOT EXISTS requests_key_secret (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        secret BLOB NOT NULL);`)
    db.prepare('INSERT OR IGNORE INTO requests_key_secret (id, secret) VALUES (1, ?)').run(randomBytes(32))
    this.secret = Buffer.from((db.prepare('SELECT secret FROM requests_key_secret WHERE id = 1').get() as Row).secret as Uint8Array)
  }

  /** Whether there is a key, when it was created and last used (never the key or its hash). */
  status(): RequestsKeyStatus {
    const row = this.row()
    if (!row) return { active: false }
    return { active: true, createdAt: iso(row.created_at), ...(row.last_used_at == null ? {} : { lastUsedAt: iso(row.last_used_at) }) }
  }

  /** A new key in place of the old one (which stops working at once). The key itself exists only in this answer. */
  create(): { key: string; createdAt: string; replaced: boolean } {
    const key = `${REQUESTS_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
    const at = this.now()
    const replaced = this.row() !== undefined
    this.db.prepare(`INSERT INTO requests_key (id, key_hash, created_at, last_used_at) VALUES (1, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at, last_used_at = NULL`)
      .run(sha256(key).toString('hex'), at)
    return { key, createdAt: iso(at), replaced }
  }

  /** Removes the key; true when there was one. */
  revoke() {
    return Number(this.db.prepare('DELETE FROM requests_key WHERE id = 1').run().changes) > 0
  }

  /**
   * The current key's id (its stored hash, for per-key limits) when `key` is the current key; undefined for anything
   * else. Notes the use, at most once a minute.
   */
  verify(key: string | undefined): string | undefined {
    if (!key || !REQUESTS_KEY_PATTERN.test(key)) return undefined
    const row = this.row()
    if (!row) return undefined
    const stored = Buffer.from(String(row.key_hash), 'hex')
    const presented = sha256(key)
    if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) return undefined
    const now = this.now()
    if (row.last_used_at == null || now - Number(row.last_used_at) >= LAST_USED_STEP_MS) {
      this.db.prepare('UPDATE requests_key SET last_used_at = ? WHERE id = 1 AND key_hash = ?').run(now, String(row.key_hash))
    }
    return String(row.key_hash)
  }

  /** The same short label for every report of one account; nothing about the account can be read from it. */
  pseudonym(accountId: string) {
    return `r-${createHmac('sha256', this.secret).update(accountId, 'utf8').digest('hex').slice(0, 12)}`
  }

  private row() {
    return this.db.prepare('SELECT key_hash, created_at, last_used_at FROM requests_key WHERE id = 1').get() as Row | undefined
  }
}
