/**
 * Signed entitlement for the phone app / browser (no main process): the same contract as electron/entitlement.ts,
 * kept in the WebView's private storage. The device id and the server key pinned on first sign-in live in
 * localStorage; the token is checked with WebCrypto Ed25519 where the WebView supports it (otherwise only its claims —
 * the server checks every data request anyway, docs/subscription-protection.md).
 */
import type { EntitlementView } from '../electron.d'
import { base64UrlEncode, checkEntitlementClaims, DEVICE_ID, parseEntitlementToken, PUBLIC_KEY, type EntitlementClaims } from '../shared/entitlementToken'

const DEVICE_KEY = 'raidos-device-id-v1'
const PINS_KEY = 'raidos-entitlement-keys-v1'
const TOKEN_KEY = 'raidos-entitlement-v1'
const SEEN_KEY = 'raidos-entitlement-seen-v1'
export const WEB_ENTITLEMENT_REFRESH_MS = 3 * 60 * 60 * 1000

function read(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* storage unavailable */ }
}

export function webDeviceId() {
  const stored = read(DEVICE_KEY)
  if (stored && DEVICE_ID.test(stored)) return stored
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const id = base64UrlEncode(bytes)
  write(DEVICE_KEY, id)
  return id
}

export function webDeviceName() {
  const agent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const os = /android/i.test(agent) ? 'Android' : /iphone|ipad|ios/i.test(agent) ? 'iOS' : 'Браузер'
  return `${os} · Raid OS`
}

function pins(): Record<string, string> {
  try {
    const parsed = JSON.parse(read(PINS_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && PUBLIC_KEY.test(entry[1])))
  } catch {
    return {}
  }
}

/** Built-in key of the default server (VITE_ENTITLEMENT_PUBLIC_KEY at build time), else the pinned one. */
export function webTrustedKey(server: string) {
  const builtIn = (import.meta.env.VITE_ENTITLEMENT_PUBLIC_KEY as string | undefined)?.trim()
  const builtInServer = (import.meta.env.VITE_TARKOV_API_URL as string | undefined)?.trim() || 'https://raidos.app'
  if (builtIn && PUBLIC_KEY.test(builtIn) && server === builtInServer) return builtIn
  return pins()[server]
}

export function webPinKey(server: string, served: unknown): boolean {
  const known = webTrustedKey(server)
  if (typeof served !== 'string' || !PUBLIC_KEY.test(served)) return Boolean(known)
  if (known) return known === served
  write(PINS_KEY, JSON.stringify({ ...pins(), [server]: served }))
  return true
}

export function webForgetKey(server: string) {
  const { [server]: _removed, ...rest } = pins()
  void _removed
  write(PINS_KEY, JSON.stringify(rest))
}

async function verifyWithWebCrypto(token: string, key: string): Promise<EntitlementClaims | null | 'unsupported'> {
  const parsed = parseEntitlementToken(token)
  if (!parsed) return null
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return 'unsupported'
  try {
    const publicKey = await subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: key }, { name: 'Ed25519' }, false, ['verify'])
    return await subtle.verify({ name: 'Ed25519' }, publicKey, parsed.signature as BufferSource, parsed.signed as BufferSource) ? parsed.claims : null
  } catch {
    return 'unsupported'
  }
}

interface Stored { server: string; token: string; refreshedAt: number }

function stored(): Stored | null {
  try {
    const parsed = JSON.parse(read(TOKEN_KEY) ?? 'null') as Partial<Stored> | null
    return parsed && typeof parsed.server === 'string' && typeof parsed.token === 'string' && typeof parsed.refreshedAt === 'number' ? parsed as Stored : null
  } catch {
    return null
  }
}

let refusal: Pick<EntitlementView, 'reason' | 'message'> | null = null
let refusedAt = 0

/** The stored token for `server`, checked (no network). */
export async function webEntitlementFor(server: string): Promise<EntitlementView> {
  const entry = stored()
  if (!entry || entry.server !== server) return { valid: false, ...(refusal ?? { reason: 'unavailable' }) }
  const key = webTrustedKey(server)
  if (!key) return { valid: false, reason: 'no-key' }
  const verified = await verifyWithWebCrypto(entry.token, key)
  const claims = verified === 'unsupported' ? parseEntitlementToken(entry.token)?.claims ?? null : verified
  if (!claims) return { valid: false, reason: 'key-mismatch' }
  const now = Date.now()
  const seenAt = Number(read(SEEN_KEY)) || 0
  const check = checkEntitlementClaims(claims, { deviceId: webDeviceId(), now, seenAt })
  if (!check.ok) return { valid: false, reason: check.reason === 'device' ? 'device-inactive' : check.reason }
  if (now > seenAt) write(SEEN_KEY, String(now))
  return { valid: true, plan: claims.plan, expiresAt: new Date(claims.exp).toISOString(), ...(claims.until ? { until: new Date(claims.until).toISOString() } : {}) }
}

export function webEntitlementDue(server: string) {
  const entry = stored()
  // After a refusal the server is asked again at most once a minute (a payment unlocks within a minute).
  if (!entry && refusal && refusal.reason !== 'signed-out' && Date.now() - refusedAt < 60_000 && Date.now() >= refusedAt) return false
  return !entry || entry.server !== server || Date.now() - entry.refreshedAt >= WEB_ENTITLEMENT_REFRESH_MS || Date.now() < entry.refreshedAt
}

/** Keeps a token from POST /v1/entitlement (only when it verifies with the trusted key, for this device). */
export async function webAcceptIssued(server: string, answer: unknown): Promise<EntitlementView> {
  const body = answer && typeof answer === 'object' ? answer as { token?: unknown; revokedDevices?: unknown } : {}
  const key = webTrustedKey(server)
  if (!key || typeof body.token !== 'string') return { valid: false, reason: key ? 'unavailable' : 'no-key' }
  const verified = await verifyWithWebCrypto(body.token, key)
  if (verified === null) return { valid: false, reason: 'key-mismatch' }
  refusal = null
  write(TOKEN_KEY, JSON.stringify({ server, token: body.token, refreshedAt: Date.now() }))
  const status = await webEntitlementFor(server)
  const revoked = Array.isArray(body.revokedDevices) ? body.revokedDevices.filter((entry): entry is { name: string; lastSeenAt: string } => Boolean(entry) && typeof (entry as { name?: unknown }).name === 'string' && typeof (entry as { lastSeenAt?: unknown }).lastSeenAt === 'string') : []
  return revoked.length ? { ...status, revokedDevices: revoked } : status
}

export function webRefuseEntitlement(reason: NonNullable<EntitlementView['reason']>, message?: string) {
  refusal = { reason, ...(message ? { message } : {}) }
  refusedAt = Date.now()
  write(TOKEN_KEY, null)
}

export function webClearEntitlement() {
  refusal = { reason: 'signed-out' }
  write(TOKEN_KEY, null)
}

/** When the stored entitlement ends (ms), for the in-memory / IndexedDB cache of the phone (src/data/gameDataCache.ts). */
export function webEntitlementExpiry(): number | null {
  const parsed = parseEntitlementToken(stored()?.token)
  return parsed ? parsed.claims.exp : null
}
