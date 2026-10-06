/**
 * The players' app (client edition): signed entitlement, device id and the pinned server key (main process only,
 * docs/subscription-protection.md).
 *
 * - Device id: 32 random bytes, kept encrypted with Electron safeStorage (DPAPI on Windows) in userData. The server
 *   allows three active devices per account (server/src/services/entitlement.ts).
 * - Server key: Ed25519 public key per server address. A key built into the exe (build-info.json `entitlementKeys`,
 *   RAIDOS_ENTITLEMENT_PUBLIC_KEY at build time) is used as is. The players' app (client edition) trusts ONLY built-in
 *   keys: a server without one never gets a valid entitlement, so pointing the app at a self-made server cannot unlock
 *   the paid sections. The owner's app may also pin the key served at /v1/entitlement/public-key on the first sign-in
 *   to another server (trust on first use); a different key later is refused («ключ сервера изменился»). Signing out
 *   forgets the pin of that server.
 * - Token: kept encrypted (safeStorage) with the latest time this app has seen; valid only for this device, before
 *   `exp` (at most 72 h after the server issued it) and while the clock was not turned back.
 *
 * No network here: serviceGateway.ts asks the server and hands the answers to `acceptIssued` / `pinServerKey`.
 */
import { createPublicKey, verify } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { checkEntitlementClaims, DEVICE_ID, parseEntitlementToken, PUBLIC_KEY, type EntitlementClaims, type EntitlementPlan } from '../src/shared/entitlementToken.js'
import { buildDefaultServerUrl, buildEntitlementKeys, isOwnerBuild } from './buildEdition.js'

export type EntitlementReason = 'signed-out' | 'subscription' | 'device-revoked' | 'device-inactive' | 'expired' | 'clock' | 'key-mismatch' | 'no-key' | 'unavailable'

export interface EntitlementStatus {
  valid: boolean
  plan?: EntitlementPlan
  /** When this copy stops working offline unless it reaches the server. */
  expiresAt?: string
  /** End of the paid period / trial, when there is one. */
  until?: string
  reason?: EntitlementReason
  /** One-time notice: devices this sign-in switched off (the 3-device limit). */
  revokedDevices?: Array<{ name: string; lastSeenAt: string }>
  /** The server's text for a refusal (shown as is). */
  message?: string
}

/** The token is renewed this often while the app runs (and at once after sign-in). */
export const ENTITLEMENT_REFRESH_MS = 3 * 60 * 60 * 1000

interface StoredToken { server: string; token: string; refreshedAt: number }

const userFile = (name: string) => join(app.getPath('userData'), name)
const DEVICE_FILE = 'device-id.bin'
const DEVICE_PLAIN_FILE = 'device-id.json'
const TOKEN_FILE = 'entitlement.bin'
const KEYS_FILE = 'entitlement-keys.bin'
const KEYS_PLAIN_FILE = 'entitlement-keys.json'
const SEEN_FILE = 'entitlement-seen.bin'

function canEncrypt() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

async function readSecret(name: string) {
  try { return safeStorage.decryptString(await readFile(userFile(name))) } catch { return '' }
}
async function writeSecret(name: string, value: string) {
  if (!canEncrypt()) return false
  await writeFile(userFile(name), safeStorage.encryptString(value))
  return true
}

let device: string | null = null
/** This installation's device id (made once). Without OS encryption it is kept in a plain file: it is no secret. */
export async function deviceId() {
  if (device) return device
  const stored = canEncrypt() ? await readSecret(DEVICE_FILE) : await readFile(userFile(DEVICE_PLAIN_FILE), 'utf8').catch(() => '')
  if (DEVICE_ID.test(stored.trim())) { device = stored.trim(); return device }
  device = randomBytes(32).toString('base64url')
  if (!(await writeSecret(DEVICE_FILE, device).catch(() => false))) await writeFile(userFile(DEVICE_PLAIN_FILE), device, 'utf8').catch(() => {})
  return device
}

/** What the owner sees in the device list: «Windows · DESKTOP-1234 · Raid OS 0.5.4». */
export function deviceName() {
  const os = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
  let host = ''
  try { host = hostname().replace(/[^\w.-]/g, '').slice(0, 24) } catch { /* unknown */ }
  return [os, host, `Raid OS ${app.getVersion()}`].filter(Boolean).join(' · ')
}

// --------------------------------------------------------------------------------------------------------------
// Server keys (built in or pinned on first use)
// --------------------------------------------------------------------------------------------------------------

let pins: Record<string, string> | null = null
async function loadPins() {
  if (pins) return pins
  const raw = canEncrypt() ? await readSecret(KEYS_FILE) : await readFile(userFile(KEYS_PLAIN_FILE), 'utf8').catch(() => '')
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>
    pins = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && PUBLIC_KEY.test(entry[1])))
  } catch {
    pins = {}
  }
  return pins
}
async function savePins(next: Record<string, string>) {
  pins = next
  const text = JSON.stringify(next)
  if (!(await writeSecret(KEYS_FILE, text).catch(() => false))) await writeFile(userFile(KEYS_PLAIN_FILE), text, 'utf8').catch(() => {})
}

/**
 * Trust on first use is for the owner's app only. The players' app accepts only keys built into the exe, otherwise
 * anybody could run their own «server» with the same API, point the app at it and sign their own entitlement.
 */
/**
 * Trust on first use: the owner's app for any server; the players' app only for the official server baked into the
 * build (players cannot switch servers, so a self-made server can never be pinned). Without a built-in key the
 * official server's key is pinned on first sign-in and a different key is refused afterwards.
 */
export const mayPinServerKeys = (server: string) => isOwnerBuild() || (Boolean(buildDefaultServerUrl()) && server === buildDefaultServerUrl())

/** The key this app trusts for `server`: built into the exe, else (owner's app only) pinned earlier, else none. */
export async function trustedKey(server: string) {
  const builtIn = buildEntitlementKeys()[server]
  if (builtIn) return { key: builtIn, builtIn: true }
  if (!mayPinServerKeys(server)) return undefined
  const pinned = (await loadPins())[server]
  return pinned ? { key: pinned, builtIn: false } : undefined
}

/**
 * First sign-in to a server without a built-in key: the owner's app pins what it serves (a different key than the
 * pinned one is refused). The players' app never pins: without a built-in key the answer is 'no-key'.
 */
export async function pinServerKey(server: string, served: unknown): Promise<{ ok: true; key: string } | { ok: false; reason: 'key-mismatch' | 'no-key' }> {
  const known = await trustedKey(server)
  if (typeof served !== 'string' || !PUBLIC_KEY.test(served)) return known ? { ok: true, key: known.key } : { ok: false, reason: 'no-key' }
  if (known) return known.key === served ? { ok: true, key: known.key } : { ok: false, reason: 'key-mismatch' }
  if (!mayPinServerKeys(server)) return { ok: false, reason: 'no-key' }
  await savePins({ ...(await loadPins()), [server]: served })
  return { ok: true, key: served }
}

/** Signing out of a server forgets its pinned key (a new key is then accepted on the next first sign-in). */
export async function forgetServerKey(server: string) {
  const current = await loadPins()
  if (!(server in current)) return
  const { [server]: _removed, ...rest } = current
  void _removed
  await savePins(rest)
}

export function verifySignature(token: string, key: string): EntitlementClaims | null {
  const parsed = parseEntitlementToken(token)
  if (!parsed || !PUBLIC_KEY.test(key)) return null
  try {
    const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key }, format: 'jwk' })
    return verify(null, parsed.signed, publicKey, parsed.signature) ? parsed.claims : null
  } catch {
    return null
  }
}

// --------------------------------------------------------------------------------------------------------------
// Token
// --------------------------------------------------------------------------------------------------------------

let stored: StoredToken | null = null
let storedLoaded = false
let seenAt = 0
let lastRefusal: Pick<EntitlementStatus, 'reason' | 'message'> | null = null
let refusedAt = 0
/** After a refusal (no subscription…) the server is asked again at most this often (a payment unlocks within a minute). */
export const REFUSED_RETRY_MS = 60_000
let pendingNotice: EntitlementStatus['revokedDevices']

async function loadStored() {
  if (storedLoaded) return
  storedLoaded = true
  try {
    const parsed = JSON.parse(await readSecret(TOKEN_FILE) || 'null') as Partial<StoredToken> | null
    if (parsed && typeof parsed.server === 'string' && typeof parsed.token === 'string' && typeof parsed.refreshedAt === 'number') stored = parsed as StoredToken
  } catch { stored = null }
  seenAt = Number(await readSecret(SEEN_FILE)) || 0
}

/** The latest time this app has seen (server issue times, local clock): turning the clock back does not revive a token. */
async function noteTime(time: number) {
  if (time <= seenAt) return
  const step = time - seenAt > 60_000
  seenAt = time
  if (step) await writeSecret(SEEN_FILE, String(seenAt)).catch(() => false)
}

/** The current entitlement for `server`, from the stored token only (no network). */
export async function entitlementFor(server: string): Promise<EntitlementStatus> {
  await loadStored()
  const now = Date.now()
  if (!stored || stored.server !== server) return { valid: false, ...(lastRefusal ?? { reason: 'unavailable' }) }
  const trusted = await trustedKey(server)
  if (!trusted) return { valid: false, reason: 'no-key' }
  const claims = verifySignature(stored.token, trusted.key)
  if (!claims) return { valid: false, reason: 'key-mismatch' }
  const check = checkEntitlementClaims(claims, { deviceId: await deviceId(), now, seenAt })
  if (!check.ok) return { valid: false, reason: check.reason === 'device' ? 'device-inactive' : check.reason }
  await noteTime(now)
  return { valid: true, plan: claims.plan, expiresAt: new Date(claims.exp).toISOString(), ...(claims.until ? { until: new Date(claims.until).toISOString() } : {}) }
}

/** Whether the stored token should be renewed now (missing, for another server, or older than ENTITLEMENT_REFRESH_MS). */
export async function needsRefresh(server: string) {
  await loadStored()
  if (!stored && lastRefusal && lastRefusal.reason !== 'signed-out' && Date.now() - refusedAt < REFUSED_RETRY_MS && Date.now() >= refusedAt) return false
  return !stored || stored.server !== server || Date.now() - stored.refreshedAt >= ENTITLEMENT_REFRESH_MS || Date.now() < stored.refreshedAt
}

/** A token from POST /v1/entitlement: kept only when it verifies with the trusted key and is for this device. */
export async function acceptIssued(server: string, answer: unknown): Promise<EntitlementStatus> {
  const body = answer && typeof answer === 'object' ? answer as { token?: unknown; revokedDevices?: unknown } : {}
  const trusted = await trustedKey(server)
  if (!trusted) return { valid: false, reason: 'no-key' }
  const token = typeof body.token === 'string' ? body.token : ''
  const claims = verifySignature(token, trusted.key)
  if (!claims) return { valid: false, reason: 'key-mismatch' }
  if (claims.dev !== await deviceId()) return { valid: false, reason: 'device-inactive' }
  await noteTime(Math.max(claims.iat, Date.now()))
  stored = { server, token, refreshedAt: Date.now() }
  storedLoaded = true
  lastRefusal = null
  // Without OS encryption the token stays in memory only (the user signs in again after a restart).
  await writeSecret(TOKEN_FILE, JSON.stringify(stored)).catch(() => false)
  const revoked = Array.isArray(body.revokedDevices) ? body.revokedDevices.flatMap((entry) => {
    const device = entry && typeof entry === 'object' ? entry as { name?: unknown; lastSeenAt?: unknown } : {}
    return typeof device.name === 'string' && typeof device.lastSeenAt === 'string' ? [{ name: device.name.slice(0, 60), lastSeenAt: device.lastSeenAt }] : []
  }) : []
  if (revoked.length) pendingNotice = revoked
  return entitlementFor(server)
}

/** The server refused (402 no subscription, 403 device switched off, 401 signed out): drop the token at once. */
export async function refuseEntitlement(reason: EntitlementReason, message?: string) {
  lastRefusal = { reason, ...(message ? { message: message.slice(0, 300) } : {}) }
  refusedAt = Date.now()
  stored = null
  storedLoaded = true
  await rm(userFile(TOKEN_FILE), { force: true }).catch(() => {})
}

/** Sign-out: token and refusal state go; the device id stays (it is this installation). */
export async function clearEntitlement() {
  lastRefusal = { reason: 'signed-out' }
  pendingNotice = undefined
  stored = null
  storedLoaded = true
  await rm(userFile(TOKEN_FILE), { force: true }).catch(() => {})
}

/** The «devices switched off» notice, handed out once. */
export function takeDeviceNotice() {
  const notice = pendingNotice
  pendingNotice = undefined
  return notice
}
