/**
 * Signed entitlement token (docs/subscription-protection.md): the server's Ed25519 signature over
 * «what this account may use on this device until when». Shared by the server (signing, server/src/services/entitlement.ts),
 * the desktop main process (electron/entitlement.ts) and the phone app (src/account/entitlementClient.ts).
 *
 * Format: `RE1.<base64url(JSON claims)>.<base64url(signature)>`; the signature covers `raidos-entitlement-v1.<claims part>`
 * (a fixed prefix, so a signature made for anything else can never pass as an entitlement).
 *
 * No Node or DOM specifics here (only atob/btoa/TextEncoder, available everywhere): the signature itself is checked by
 * the caller with its own crypto (node:crypto in Electron, WebCrypto on the phone).
 */
export const ENTITLEMENT_TOKEN_PREFIX = 'RE1'
export const ENTITLEMENT_SIGNING_PREFIX = 'raidos-entitlement-v1.'

/** owner: the service owner · streamer: free for good · paid: paid period (incl. owner grants) · trial: referral trial. */
export type EntitlementPlan = 'owner' | 'streamer' | 'paid' | 'trial'
export const ENTITLEMENT_PLANS: readonly EntitlementPlan[] = ['owner', 'streamer', 'paid', 'trial']

export interface EntitlementClaims {
  v: 1
  /** Account id on the issuing server. */
  sub: string
  /** The device the token was issued to (random id kept by the app, electron/entitlement.ts). */
  dev: string
  plan: EntitlementPlan
  /** Issued at / expires at, milliseconds since the epoch (server clock). */
  iat: number
  exp: number
  /** End of the paid period or trial (ms), when there is one; informational. */
  until?: number
}

/** Device ids: 22–64 URL-safe characters (the apps make 32 random bytes → 43 characters). */
export const DEVICE_ID = /^[A-Za-z0-9_-]{22,64}$/
/** Ed25519 public key as the base64url `x` of its JWK (32 bytes → 43 characters). */
export const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/
const PART = /^[A-Za-z0-9_-]+$/

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(text: string): Uint8Array {
  if (!PART.test(text)) throw new Error('base64url expected')
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** The claims part and the exact bytes the signature covers. */
export function encodeEntitlementClaims(claims: EntitlementClaims) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)))
  return { body, signed: new TextEncoder().encode(`${ENTITLEMENT_SIGNING_PREFIX}${body}`) }
}

export function joinEntitlementToken(body: string, signature: Uint8Array) {
  return `${ENTITLEMENT_TOKEN_PREFIX}.${body}.${base64UrlEncode(signature)}`
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Splits and shape-checks a token; null for anything malformed. The signature is NOT checked here. */
export function parseEntitlementToken(token: unknown): { claims: EntitlementClaims; signed: Uint8Array; signature: Uint8Array } | null {
  if (typeof token !== 'string' || token.length > 2048) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== ENTITLEMENT_TOKEN_PREFIX || !PART.test(parts[1]!) || !PART.test(parts[2]!)) return null
  try {
    const raw = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]!))) as Record<string, unknown>
    const signature = base64UrlDecode(parts[2]!)
    if (signature.length !== 64) return null
    if (raw.v !== 1 || typeof raw.sub !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.sub) || typeof raw.dev !== 'string' || !DEVICE_ID.test(raw.dev)) return null
    if (!ENTITLEMENT_PLANS.includes(raw.plan as EntitlementPlan) || !isTime(raw.iat) || !isTime(raw.exp) || raw.exp <= raw.iat) return null
    if (raw.until !== undefined && !isTime(raw.until)) return null
    const claims: EntitlementClaims = { v: 1, sub: raw.sub, dev: raw.dev, plan: raw.plan as EntitlementPlan, iat: raw.iat, exp: raw.exp, ...(raw.until !== undefined ? { until: raw.until as number } : {}) }
    return { claims, signed: new TextEncoder().encode(`${ENTITLEMENT_SIGNING_PREFIX}${parts[1]}`), signature }
  } catch {
    return null
  }
}

/** Allowed difference between this computer's clock and the server's when the token was issued. */
export const CLOCK_SKEW_MS = 10 * 60 * 1000

export type EntitlementCheck = { ok: true } | { ok: false; reason: 'device' | 'expired' | 'clock' }

/**
 * Claims of a token whose signature already verified: issued to this device, not expired, and the clock was not turned
 * back (issued «in the future», or earlier than the latest time this app has already seen — `seenAt`).
 */
export function checkEntitlementClaims(claims: EntitlementClaims, options: { deviceId: string; now: number; seenAt?: number }): EntitlementCheck {
  if (claims.dev !== options.deviceId) return { ok: false, reason: 'device' }
  if (claims.iat > options.now + CLOCK_SKEW_MS) return { ok: false, reason: 'clock' }
  if (options.seenAt !== undefined && options.now + CLOCK_SKEW_MS < options.seenAt) return { ok: false, reason: 'clock' }
  if (claims.exp <= options.now) return { ok: false, reason: 'expired' }
  return { ok: true }
}
