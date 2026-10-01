import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { SQUAD_MAX_MEMBERS } from '../../../src/squad/squadOverview'
import { transaction } from './database.js'

/** Invite codes: 10 symbols of Crockford base32 (50 bits), shown as XXXXX-XXXXX; 24 hours; join is rate limited. */
export const SQUAD_INVITE_TTL_MS = 24 * 60 * 60 * 1000
export const SQUAD_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const SQUAD_CODE_LENGTH = 10
export const SQUAD_ID = /^[a-f0-9]{32}$/
export const SQUAD_MEMBER_ID = /^[a-f0-9]{24}$/

export class SquadError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const SQUAD_NOT_FOUND = 'Отряд не найден'
export const INVITE_INVALID = 'Код приглашения недействителен или истёк'

export interface SquadMemberRow { memberId: string; accountId: string; joinedAt: number; isOwner: boolean }
export interface SquadRow { id: string; name: string; ownerId: string; createdAt: number; members: SquadMemberRow[] }

type Row = Record<string, unknown>

/** Normalizes a typed / scanned code: case, dashes and spaces, and the look-alike letters of Crockford base32. */
export function normalizeSquadCode(raw: string) {
  const code = raw.trim().toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return code.length === SQUAD_CODE_LENGTH && [...code].every((char) => SQUAD_CODE_ALPHABET.includes(char)) ? code : null
}

export function formatSquadCode(code: string) {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

const digest = (code: string) => createHash('sha256').update(`squad-invite:${code}`).digest('hex')

/**
 * Squads («Отряд»): up to five accounts, one squad per account. Invite codes are stored only as SHA-256 digests;
 * a new invite replaces the squad's previous one. Account ids never leave the server: members are addressed by a
 * random member id.
 */
export class SquadStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS squads (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS squad_members (
        account_id TEXT PRIMARY KEY, squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS squad_members_squad ON squad_members(squad_id, joined_at);
      CREATE TABLE IF NOT EXISTS squad_invites (
        digest TEXT PRIMARY KEY, squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS squad_invites_squad ON squad_invites(squad_id);`)
  }

  /** The squad of this account, or undefined. */
  squadOf(accountId: string): SquadRow | undefined {
    const row = this.db.prepare('SELECT squad_id FROM squad_members WHERE account_id = ?').get(accountId) as Row | undefined
    return row ? this.load(String(row.squad_id)) : undefined
  }

  /** The squad only if this account is a member of it: anybody else gets 404, whether the squad exists or not. */
  memberSquad(accountId: string, squadId: string): SquadRow {
    const squad = SQUAD_ID.test(squadId) ? this.squadOf(accountId) : undefined
    if (!squad || squad.id !== squadId) throw new SquadError(404, SQUAD_NOT_FOUND)
    return squad
  }

  create(accountId: string, name: string): SquadRow {
    return transaction(this.db, () => {
      if (this.squadOf(accountId)) throw new SquadError(409, 'Вы уже в отряде. Сначала покиньте его.')
      const id = randomBytes(16).toString('hex')
      const now = this.now()
      this.db.prepare('INSERT INTO squads (id, name, owner_id, created_at) VALUES (?,?,?,?)').run(id, name, accountId, now)
      this.addMember(id, accountId, now)
      return this.load(id)!
    })
  }

  /** Owner only. Replaces the previous invite; returns the plain code once (only its digest is stored). */
  createInvite(accountId: string, squadId: string) {
    const squad = this.memberSquad(accountId, squadId)
    if (squad.ownerId !== accountId) throw new SquadError(403, 'Приглашать может только командир отряда')
    const code = Array.from({ length: SQUAD_CODE_LENGTH }, () => SQUAD_CODE_ALPHABET[randomInt(SQUAD_CODE_ALPHABET.length)]).join('')
    const now = this.now()
    const expiresAt = now + SQUAD_INVITE_TTL_MS
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM squad_invites WHERE squad_id = ? OR expires_at <= ?').run(squadId, now)
      this.db.prepare('INSERT INTO squad_invites (digest, squad_id, created_at, expires_at) VALUES (?,?,?,?)').run(digest(code), squadId, now, expiresAt)
    })
    return { code: formatSquadCode(code), expiresAt }
  }

  /** Joins by code. Unknown, expired and malformed codes get the same answer. */
  join(accountId: string, rawCode: string): SquadRow {
    const code = normalizeSquadCode(rawCode)
    if (!code) throw new SquadError(404, INVITE_INVALID)
    return transaction(this.db, () => {
      const invite = this.db.prepare('SELECT squad_id, expires_at FROM squad_invites WHERE digest = ?').get(digest(code)) as Row | undefined
      if (!invite || Number(invite.expires_at) <= this.now()) throw new SquadError(404, INVITE_INVALID)
      const squadId = String(invite.squad_id)
      const current = this.squadOf(accountId)
      if (current?.id === squadId) return current
      if (current) throw new SquadError(409, 'Вы уже в другом отряде. Сначала покиньте его.')
      const squad = this.load(squadId)
      if (!squad) throw new SquadError(404, INVITE_INVALID)
      if (squad.members.length >= SQUAD_MAX_MEMBERS) throw new SquadError(409, `В отряде уже ${SQUAD_MAX_MEMBERS} человек`)
      this.addMember(squadId, accountId, this.now())
      return this.load(squadId)!
    })
  }

  /** Leaves; the longest-standing member becomes the commander, and an empty squad is deleted. */
  leave(accountId: string, squadId: string) {
    transaction(this.db, () => {
      const squad = this.memberSquad(accountId, squadId)
      this.db.prepare('DELETE FROM squad_members WHERE account_id = ?').run(accountId)
      const rest = squad.members.filter((member) => member.accountId !== accountId)
      if (!rest.length) { this.db.prepare('DELETE FROM squads WHERE id = ?').run(squadId); return }
      if (squad.ownerId === accountId) {
        this.db.prepare('UPDATE squads SET owner_id = ? WHERE id = ?').run(rest[0].accountId, squadId)
        // The new commander starts with no open invite: the old one was handed out by somebody who left.
        this.db.prepare('DELETE FROM squad_invites WHERE squad_id = ?').run(squadId)
      }
    })
  }

  kick(accountId: string, squadId: string, memberId: string) {
    transaction(this.db, () => {
      const squad = this.memberSquad(accountId, squadId)
      if (squad.ownerId !== accountId) throw new SquadError(403, 'Исключать может только командир отряда')
      const target = squad.members.find((member) => member.memberId === memberId)
      if (!target) throw new SquadError(404, 'Участник не найден')
      if (target.accountId === accountId) throw new SquadError(400, 'Чтобы выйти самому, нажмите «Покинуть отряд»')
      this.db.prepare('DELETE FROM squad_members WHERE account_id = ? AND squad_id = ?').run(target.accountId, squadId)
    })
  }

  disband(accountId: string, squadId: string) {
    transaction(this.db, () => {
      const squad = this.memberSquad(accountId, squadId)
      if (squad.ownerId !== accountId) throw new SquadError(403, 'Распустить отряд может только командир')
      this.db.prepare('DELETE FROM squad_invites WHERE squad_id = ?').run(squadId)
      this.db.prepare('DELETE FROM squad_members WHERE squad_id = ?').run(squadId)
      this.db.prepare('DELETE FROM squads WHERE id = ?').run(squadId)
    })
  }

  private addMember(squadId: string, accountId: string, joinedAt: number) {
    this.db.prepare('INSERT INTO squad_members (account_id, squad_id, member_id, joined_at) VALUES (?,?,?,?)').run(accountId, squadId, randomBytes(12).toString('hex'), joinedAt)
  }

  private load(squadId: string): SquadRow | undefined {
    const squad = this.db.prepare('SELECT id, name, owner_id, created_at FROM squads WHERE id = ?').get(squadId) as Row | undefined
    if (!squad) return undefined
    const ownerId = String(squad.owner_id)
    const members = (this.db.prepare('SELECT account_id, member_id, joined_at FROM squad_members WHERE squad_id = ? ORDER BY joined_at, rowid').all(squadId) as Row[])
      .map((row) => ({ memberId: String(row.member_id), accountId: String(row.account_id), joinedAt: Number(row.joined_at), isOwner: String(row.account_id) === ownerId }))
    return { id: String(squad.id), name: String(squad.name), ownerId, createdAt: Number(squad.created_at), members }
  }
}
