/**
 * Signed entitlements and device binding (docs/subscription-protection.md).
 *
 * - Access is decided only here, from server data: the owner (TARKOV_OWNER_EMAILS + proven e-mail), streamers (free for
 *   good), a paid period (recorded payments and the owner's «Выдать дни» grants) or the 3-day referral trial.
 * - The app asks POST /v1/entitlement for an Ed25519-signed token {account, device, plan, iat, exp}; exp is at most
 *   72 hours ahead (offline grace) and never later than the end of the paid period + 1 day (trial: its end).
 * - The signing key: TARKOV_ENTITLEMENT_PRIVATE_KEY (PEM or base64 of it; the owner's app keeps it encrypted with
 *   safeStorage and passes it to the API process, electron/ownerAdmin.ts), else `entitlement-ed25519.pem` next to the
 *   database (created on the first start with mode 0600), else (in-memory database, tests) a key for this process only.
 *   The private key never leaves the server; the public key is served at GET /v1/entitlement/public-key.
 * - Devices: every app keeps a random device id; at most MAX_ACTIVE_DEVICES are active per account. A new device
 *   switches the least recently used one off (its session is signed out, the app shows why). The owner sees and
 *   switches off devices in the admin panel. The owner's own account has no device limit.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { DEVICE_ID, encodeEntitlementClaims, joinEntitlementToken, type EntitlementClaims, type EntitlementPlan } from '../../../src/shared/entitlementToken'
import { AccountError, FixedWindowRateLimiter, type AccountStore } from './accountStore.js'

export const ENTITLEMENT_TTL_MS = 72 * 60 * 60 * 1000
/** A token of a paid account may outlive the paid period by this much (payment processing, time zones). */
export const ENTITLEMENT_GRACE_MS = 24 * 60 * 60 * 1000
export const MAX_ACTIVE_DEVICES = 3
/** New or re-activated devices per account and day: account sharing by password swapping stays tedious. */
export const DEVICE_ACTIVATIONS_PER_DAY = 10
export const ENTITLEMENT_KEY_FILE = 'entitlement-ed25519.pem'
export const SUBSCRIPTION_REQUIRED = 'Нужна подписка'

export interface Access { plan: EntitlementPlan; until?: number }

export interface DeviceView {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string
  active: boolean
  revokedAt?: string
  revokedReason?: 'limit' | 'owner' | 'user'
}

type Row = Record<string, unknown>

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS account_devices (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    session_digest TEXT,
    revoked_at INTEGER,
    revoked_reason TEXT,
    PRIMARY KEY (account_id, device_id));
  CREATE INDEX IF NOT EXISTS account_devices_active ON account_devices(account_id, revoked_at);
`

/** `last_seen_at` of a device is written at most this often by data requests. */
const SEEN_STEP_MS = 5 * 60 * 1000

/** PEM, or base64 of a PEM (environment variables keep it on one line). */
function parsePrivateKey(raw: string): KeyObject {
  const text = raw.includes('BEGIN') ? raw : Buffer.from(raw.trim(), 'base64').toString('utf8')
  const key = createPrivateKey(text)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Entitlement key must be Ed25519')
  return key
}

/**
 * The server's signing key (see the file comment). `dir` is the data folder (next to the SQLite file); without one the
 * key lives only in this process (tests, in-memory database).
 */
export function loadEntitlementKey(options: { env?: string; dir?: string } = {}): KeyObject {
  const env = options.env ?? process.env.TARKOV_ENTITLEMENT_PRIVATE_KEY
  if (env?.trim()) return parsePrivateKey(env)
  if (!options.dir) return generateKeyPairSync('ed25519').privateKey
  const file = join(options.dir, ENTITLEMENT_KEY_FILE)
  if (existsSync(file)) return parsePrivateKey(readFileSync(file, 'utf8'))
  const { privateKey } = generateKeyPairSync('ed25519')
  // `wx`: never overwrite a key another process has just written (all issued tokens depend on it).
  try { writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' }) } catch {
    return parsePrivateKey(readFileSync(file, 'utf8'))
  }
  return privateKey
}

/** base64url `x` of the Ed25519 public key (what the apps pin). */
export function publicKeyX(privateKey: KeyObject) {
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as { x?: string }
  if (!jwk.x) throw new Error('Entitlement key has no public part')
  return jwk.x
}

export class EntitlementService {
  private readonly db: DatabaseSync
  private readonly key: KeyObject
  private readonly x: string
  private readonly now: () => number
  private readonly maxDevices: number
  private readonly ttlMs: number
  private readonly activations: FixedWindowRateLimiter

  constructor(private readonly accounts: AccountStore, options: { privateKey?: KeyObject; keyDir?: string; now?: () => number; maxDevices?: number; ttlMs?: number; activationsPerDay?: number } = {}) {
    this.db = accounts.database
    this.db.exec(SCHEMA)
    this.key = options.privateKey ?? loadEntitlementKey({ dir: options.keyDir })
    this.x = publicKeyX(this.key)
    this.now = options.now ?? accounts.clock
    this.maxDevices = options.maxDevices ?? (Number(process.env.TARKOV_MAX_DEVICES) || MAX_ACTIVE_DEVICES)
    this.ttlMs = options.ttlMs ?? ENTITLEMENT_TTL_MS
    this.activations = new FixedWindowRateLimiter(options.activationsPerDay ?? DEVICE_ACTIVATIONS_PER_DAY, 24 * 60 * 60 * 1000, this.now)
  }

  /** What the apps pin (TOFU) or have built in. */
  get publicKey() {
    return this.x
  }

  get deviceLimit() {
    return this.maxDevices
  }

  /** The account's access right now, or undefined (no subscription: 402). */
  access(accountId: string): Access | undefined {
    if (this.accounts.isOwner(accountId)) return { plan: 'owner' }
    const { subscription } = this.accounts.view(accountId)
    if (subscription.lifetime) return { plan: 'streamer' }
    if (subscription.status === 'active' && subscription.paidUntil) return { plan: 'paid', until: Date.parse(subscription.paidUntil) }
    if (subscription.status === 'trial' && subscription.trialEndsAt) return { plan: 'trial', until: Date.parse(subscription.trialEndsAt) }
    return undefined
  }

  /** A signed token for this device, or undefined when the account has no access. */
  issue(accountId: string, deviceId: string, access = this.access(accountId)) {
    if (!access) return undefined
    const now = this.now()
    let exp = now + this.ttlMs
    if (access.plan === 'paid' && access.until) exp = Math.min(exp, access.until + ENTITLEMENT_GRACE_MS)
    if (access.plan === 'trial' && access.until) exp = Math.min(exp, access.until)
    if (exp <= now) return undefined
    const claims: EntitlementClaims = { v: 1, sub: accountId, dev: deviceId, plan: access.plan, iat: now, exp, ...(access.until ? { until: access.until } : {}) }
    const { body, signed } = encodeEntitlementClaims(claims)
    return { token: joinEntitlementToken(body, new Uint8Array(sign(null, signed, this.key))), claims }
  }

  /**
   * Called by POST /v1/entitlement after sign-in and on every refresh: the device becomes (or stays) active and the
   * session it uses is remembered, so switching the device off later also signs that session out. A new or re-activated
   * device beyond the limit switches off the least recently used other ones; they are returned for the notice.
   */
  registerDevice(accountId: string, deviceId: string, name: string, sessionDigest?: string): { revoked: DeviceView[] } {
    if (!DEVICE_ID.test(deviceId)) throw new AccountError(400, 'Некорректный идентификатор устройства')
    const label = cleanName(name)
    const now = this.now()
    const existing = this.db.prepare('SELECT revoked_at FROM account_devices WHERE account_id = ? AND device_id = ?').get(accountId, deviceId) as Row | undefined
    if (!existing || existing.revoked_at != null) {
      const retry = this.activations.hit(accountId)
      if (retry) throw Object.assign(new AccountError(429, 'Слишком много новых устройств за сутки. Попробуйте завтра или напишите в поддержку.'), { retryAfter: retry })
    }
    if (!existing) {
      this.db.prepare('INSERT INTO account_devices (account_id, device_id, name, created_at, last_seen_at, session_digest) VALUES (?, ?, ?, ?, ?, ?)').run(accountId, deviceId, label, now, now, sessionDigest ?? null)
    } else {
      this.db.prepare('UPDATE account_devices SET name = ?, last_seen_at = ?, session_digest = COALESCE(?, session_digest), revoked_at = NULL, revoked_reason = NULL WHERE account_id = ? AND device_id = ?').run(label, now, sessionDigest ?? null, accountId, deviceId)
    }
    if (this.accounts.isOwner(accountId)) return { revoked: [] }
    const active = this.db.prepare('SELECT device_id FROM account_devices WHERE account_id = ? AND revoked_at IS NULL AND device_id <> ? ORDER BY last_seen_at DESC, created_at DESC').all(accountId, deviceId) as Row[]
    const excess = active.slice(Math.max(0, this.maxDevices - 1)).map((row) => String(row.device_id))
    for (const id of excess) this.revoke(accountId, id, 'limit')
    return { revoked: excess.map((id) => this.device(accountId, id)!).filter(Boolean) }
  }

  /** The data gateway's check: the device is active for this account (and its last use is noted). */
  isActiveDevice(accountId: string, deviceId: string | undefined) {
    if (!deviceId || !DEVICE_ID.test(deviceId)) return false
    const row = this.db.prepare('SELECT revoked_at, last_seen_at FROM account_devices WHERE account_id = ? AND device_id = ?').get(accountId, deviceId) as Row | undefined
    if (!row || row.revoked_at != null) return false
    const now = this.now()
    if (now - Number(row.last_seen_at) >= SEEN_STEP_MS) this.db.prepare('UPDATE account_devices SET last_seen_at = ? WHERE account_id = ? AND device_id = ?').run(now, accountId, deviceId)
    return true
  }

  /** Why a device is not active (for the app's notice), or undefined when it is active / unknown. */
  revokedReason(accountId: string, deviceId: string | undefined) {
    if (!deviceId || !DEVICE_ID.test(deviceId)) return undefined
    const row = this.db.prepare('SELECT revoked_reason FROM account_devices WHERE account_id = ? AND device_id = ? AND revoked_at IS NOT NULL').get(accountId, deviceId) as Row | undefined
    return row ? (String(row.revoked_reason) as DeviceView['revokedReason']) : undefined
  }

  devices(accountId: string): DeviceView[] {
    return (this.db.prepare('SELECT * FROM account_devices WHERE account_id = ? ORDER BY revoked_at IS NOT NULL, last_seen_at DESC').all(accountId) as Row[]).map(toView)
  }

  device(accountId: string, deviceId: string) {
    const row = this.db.prepare('SELECT * FROM account_devices WHERE account_id = ? AND device_id = ?').get(accountId, deviceId) as Row | undefined
    return row ? toView(row) : undefined
  }

  /** Switches a device off and signs out the session it used. Returns false for an unknown or already inactive device. */
  revoke(accountId: string, deviceId: string, reason: NonNullable<DeviceView['revokedReason']>) {
    const row = this.db.prepare('SELECT session_digest FROM account_devices WHERE account_id = ? AND device_id = ? AND revoked_at IS NULL').get(accountId, deviceId) as Row | undefined
    if (!row) return false
    this.db.prepare('UPDATE account_devices SET revoked_at = ?, revoked_reason = ? WHERE account_id = ? AND device_id = ?').run(this.now(), reason, accountId, deviceId)
    if (row.session_digest != null) this.accounts.revokeSessionDigest(String(row.session_digest))
    return true
  }
}

function cleanName(raw: string) {
  const name = [...String(raw ?? '')].filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f).join('').trim().slice(0, 60)
  return name || 'Устройство'
}

const iso = (value: unknown) => new Date(Number(value)).toISOString()

function toView(row: Row): DeviceView {
  const revoked = row.revoked_at != null
  return {
    id: String(row.device_id),
    name: String(row.name),
    createdAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at),
    active: !revoked,
    ...(revoked ? { revokedAt: iso(row.revoked_at), revokedReason: String(row.revoked_reason) as DeviceView['revokedReason'] } : {}),
  }
}
