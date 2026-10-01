import { randomBytes, randomInt } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RaidMode } from '../models/api.js'
import { transaction } from './database.js'

/**
 * Friends: a personal friend code (8 symbols of Crockford base32, shown as XXXX-XXXX; the website link /friend/<code>
 * carries the same code), requests that the other side accepts or declines, removal and blocking. Each side of a
 * friendship has its own row, so «hide my progress from this friend» is a per-person switch.
 *
 * Friends never see each other's e-mail or account id: a friend is addressed by a random public id. Adding by
 * nickname answers the same whether the nickname exists or not; a request to an unknown, ambiguous or blocking
 * account is kept as an undelivered («dangling») request that only its sender sees, so the sender's list does not
 * reveal who uses the service either.
 */
export const FRIEND_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const FRIEND_CODE_LENGTH = 8
export const FRIEND_ID = /^[a-f0-9]{24}$/
export const MAX_FRIENDS = 100
export const MAX_OUTGOING_REQUESTS = 50
export const FRIEND_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000

export class FriendError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const FRIEND_NOT_FOUND = 'Друг не найден'
const REQUEST_NOT_FOUND = 'Запрос не найден'

type Row = Record<string, unknown>

export function normalizeFriendCode(raw: string) {
  const code = raw.trim().toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return code.length === FRIEND_CODE_LENGTH && [...code].every((char) => FRIEND_CODE_ALPHABET.includes(char)) ? code : null
}
export const formatFriendCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`
const newCode = () => Array.from({ length: FRIEND_CODE_LENGTH }, () => FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)]).join('')
const newId = () => randomBytes(12).toString('hex')

export interface FriendRow { accountId: string; publicId: string; since: number; hideMyProgress: boolean; hidesFromMe: boolean }
export interface RequestRow { id: string; fromId: string; toId: string | null; label: string; createdAt: number }

export class FriendStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS friend_profiles (
        account_id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT, label TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS friend_requests_from ON friend_requests(from_id);
      CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_id);
      CREATE TABLE IF NOT EXISTS friendships (
        account_id TEXT NOT NULL, friend_id TEXT NOT NULL, since INTEGER NOT NULL, hide_progress INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, friend_id));
      CREATE TABLE IF NOT EXISTS friend_blocks (
        account_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (account_id, blocked_id));`)
  }

  /** The account's public id and friend code, created on first use. */
  profile(accountId: string) {
    const row = this.db.prepare('SELECT public_id, code FROM friend_profiles WHERE account_id = ?').get(accountId) as Row | undefined
    if (row) return { publicId: String(row.public_id), code: String(row.code) }
    const profile = { publicId: newId(), code: newCode() }
    this.db.prepare('INSERT INTO friend_profiles (account_id, public_id, code, created_at) VALUES (?,?,?,?)').run(accountId, profile.publicId, profile.code, this.now())
    return profile
  }

  publicId(accountId: string) {
    return this.profile(accountId).publicId
  }

  /** A new friend code; the old code and link stop working at once. */
  regenerateCode(accountId: string) {
    this.profile(accountId)
    const code = newCode()
    this.db.prepare('UPDATE friend_profiles SET code = ? WHERE account_id = ?').run(code, accountId)
    return code
  }

  private accountByPublicId(publicId: string) {
    if (!FRIEND_ID.test(publicId)) return undefined
    const row = this.db.prepare('SELECT account_id FROM friend_profiles WHERE public_id = ?').get(publicId) as Row | undefined
    return row ? String(row.account_id) : undefined
  }

  private accountByCode(code: string) {
    const row = this.db.prepare('SELECT account_id FROM friend_profiles WHERE code = ?').get(code) as Row | undefined
    return row ? String(row.account_id) : undefined
  }

  /** Accounts whose nickname for this mode is `nickname` (case-insensitive). */
  private accountsByNickname(mode: RaidMode, nickname: string) {
    const rows = this.db.prepare(`SELECT id FROM accounts WHERE lower(json_extract(nicknames, '$.' || ?)) = lower(?) LIMIT 2`).all(mode, nickname) as Row[]
    return rows.map((row) => String(row.id))
  }

  isBlocked(by: string, whom: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM friend_blocks WHERE account_id = ? AND blocked_id = ?').get(by, whom))
  }

  areFriends(a: string, b: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM friendships WHERE account_id = ? AND friend_id = ?').get(a, b))
  }

  /** The friend's account id for one of my friends' public ids; 404 for anybody else. */
  friendAccount(accountId: string, publicId: string) {
    const friend = this.accountByPublicId(publicId)
    if (!friend || !this.areFriends(accountId, friend)) throw new FriendError(404, FRIEND_NOT_FOUND)
    return friend
  }

  /** Whether `owner` hides their progress from `viewer`. */
  hidesProgress(owner: string, viewer: string) {
    const row = this.db.prepare('SELECT hide_progress FROM friendships WHERE account_id = ? AND friend_id = ?').get(owner, viewer) as Row | undefined
    return Number(row?.hide_progress ?? 0) === 1
  }

  friends(accountId: string): FriendRow[] {
    const rows = this.db.prepare(`SELECT f.friend_id AS friend_id, f.since AS since, f.hide_progress AS hide, b.hide_progress AS hides_me
      FROM friendships f LEFT JOIN friendships b ON b.account_id = f.friend_id AND b.friend_id = f.account_id
      WHERE f.account_id = ? ORDER BY f.since`).all(accountId) as Row[]
    return rows.map((row) => ({ accountId: String(row.friend_id), publicId: this.publicId(String(row.friend_id)), since: Number(row.since), hideMyProgress: Number(row.hide) === 1, hidesFromMe: Number(row.hides_me) === 1 }))
  }

  incoming(accountId: string): RequestRow[] {
    this.sweep()
    return (this.db.prepare('SELECT id, from_id, to_id, label, created_at FROM friend_requests WHERE to_id = ? ORDER BY created_at').all(accountId) as Row[]).map(requestRow)
  }

  outgoing(accountId: string): RequestRow[] {
    this.sweep()
    return (this.db.prepare('SELECT id, from_id, to_id, label, created_at FROM friend_requests WHERE from_id = ? ORDER BY created_at').all(accountId) as Row[]).map(requestRow)
  }

  blocked(accountId: string) {
    return (this.db.prepare('SELECT blocked_id FROM friend_blocks WHERE account_id = ? ORDER BY created_at').all(accountId) as Row[]).map((row) => String(row.blocked_id))
  }

  /**
   * Sends a request by friend code or by nickname. Returns 'friends' when the two are friends now (already, or the
   * other side had asked first), otherwise 'sent' — also for unknown targets (see the class comment).
   */
  request(accountId: string, target: { code: string } | { mode: RaidMode; nickname: string }): 'sent' | 'friends' {
    return transaction(this.db, () => {
      let toId: string | undefined
      let label: string
      if ('code' in target) {
        const code = normalizeFriendCode(target.code)
        if (!code) throw new FriendError(400, 'Код друга: 8 символов, например 7KQ2-M9XD')
        label = formatFriendCode(code)
        toId = this.accountByCode(code)
      } else {
        label = target.nickname
        const matches = this.accountsByNickname(target.mode, target.nickname)
        toId = matches.length === 1 ? matches[0] : undefined
      }
      if (toId === accountId) throw new FriendError(400, 'Это ваш собственный код')
      if (toId && this.areFriends(accountId, toId)) return 'friends'
      // The other side asked first: this is an acceptance (unless I blocked them; then it is just another request).
      const reverse = toId ? this.db.prepare('SELECT id FROM friend_requests WHERE from_id = ? AND to_id = ?').get(toId, accountId) as Row | undefined : undefined
      if (toId && reverse && !this.isBlocked(accountId, toId)) {
        this.befriend(accountId, toId)
        return 'friends'
      }
      if (this.countOutgoing(accountId) >= MAX_OUTGOING_REQUESTS) throw new FriendError(409, `Слишком много запросов в друзья (максимум ${MAX_OUTGOING_REQUESTS}). Отмените старые.`)
      if (this.countFriends(accountId) >= MAX_FRIENDS) throw new FriendError(409, `Достигнут предел: ${MAX_FRIENDS} друзей`)
      // Blocked by the target, or no such account: kept undelivered, so the answer and the list look the same.
      const deliverTo = toId && !this.isBlocked(toId, accountId) ? toId : null
      const exists = deliverTo
        ? this.db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(accountId, deliverTo)
        : this.db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id IS NULL AND label = ?').get(accountId, label)
      if (!exists) this.db.prepare('INSERT INTO friend_requests (id, from_id, to_id, label, created_at) VALUES (?,?,?,?,?)').run(newId(), accountId, deliverTo, label, this.now())
      return 'sent'
    })
  }

  accept(accountId: string, requestId: string) {
    transaction(this.db, () => {
      const request = this.incomingRequest(accountId, requestId)
      if (this.countFriends(accountId) >= MAX_FRIENDS) throw new FriendError(409, `Достигнут предел: ${MAX_FRIENDS} друзей`)
      this.befriend(accountId, request.fromId)
    })
  }

  decline(accountId: string, requestId: string) {
    this.incomingRequest(accountId, requestId)
    this.db.prepare('DELETE FROM friend_requests WHERE id = ?').run(requestId)
  }

  cancel(accountId: string, requestId: string) {
    const result = this.db.prepare('DELETE FROM friend_requests WHERE id = ? AND from_id = ?').run(requestId, accountId)
    if (Number(result.changes) === 0) throw new FriendError(404, REQUEST_NOT_FOUND)
  }

  remove(accountId: string, publicId: string) {
    const friend = this.friendAccount(accountId, publicId)
    this.db.prepare('DELETE FROM friendships WHERE (account_id = ? AND friend_id = ?) OR (account_id = ? AND friend_id = ?)').run(accountId, friend, friend, accountId)
  }

  /** Blocks a friend or somebody who sent me a request: ends the friendship and drops requests both ways. */
  block(accountId: string, publicId: string) {
    transaction(this.db, () => {
      const other = this.accountByPublicId(publicId)
      const related = other && (this.areFriends(accountId, other) || this.db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(other, accountId))
      if (!other || !related) throw new FriendError(404, FRIEND_NOT_FOUND)
      this.db.prepare('DELETE FROM friendships WHERE (account_id = ? AND friend_id = ?) OR (account_id = ? AND friend_id = ?)').run(accountId, other, other, accountId)
      this.db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(accountId, other, other, accountId)
      this.db.prepare('INSERT INTO friend_blocks (account_id, blocked_id, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(accountId, other, this.now())
    })
  }

  unblock(accountId: string, publicId: string) {
    const other = this.accountByPublicId(publicId)
    const result = other ? this.db.prepare('DELETE FROM friend_blocks WHERE account_id = ? AND blocked_id = ?').run(accountId, other) : { changes: 0 }
    if (Number(result.changes) === 0) throw new FriendError(404, FRIEND_NOT_FOUND)
  }

  setHideProgress(accountId: string, publicId: string, hide: boolean) {
    const friend = this.friendAccount(accountId, publicId)
    this.db.prepare('UPDATE friendships SET hide_progress = ? WHERE account_id = ? AND friend_id = ?').run(hide ? 1 : 0, accountId, friend)
  }

  private befriend(a: string, b: string) {
    const now = this.now()
    const insert = this.db.prepare('INSERT INTO friendships (account_id, friend_id, since) VALUES (?,?,?) ON CONFLICT DO NOTHING')
    insert.run(a, b, now)
    insert.run(b, a, now)
    this.db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(a, b, b, a)
  }

  private incomingRequest(accountId: string, requestId: string) {
    const row = FRIEND_ID.test(requestId) ? this.db.prepare('SELECT id, from_id, to_id, label, created_at FROM friend_requests WHERE id = ? AND to_id = ?').get(requestId, accountId) as Row | undefined : undefined
    if (!row || Number(row.created_at) + FRIEND_REQUEST_TTL_MS <= this.now()) throw new FriendError(404, REQUEST_NOT_FOUND)
    return requestRow(row)
  }

  private countFriends(accountId: string) {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM friendships WHERE account_id = ?').get(accountId) as Row).n)
  }

  private countOutgoing(accountId: string) {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?').get(accountId) as Row).n)
  }

  private sweep() {
    this.db.prepare('DELETE FROM friend_requests WHERE created_at <= ?').run(this.now() - FRIEND_REQUEST_TTL_MS)
  }
}

function requestRow(row: Row): RequestRow {
  return { id: String(row.id), fromId: String(row.from_id), toId: row.to_id == null ? null : String(row.to_id), label: String(row.label), createdAt: Number(row.created_at) }
}
