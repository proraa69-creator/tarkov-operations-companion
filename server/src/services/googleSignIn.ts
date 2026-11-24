/**
 * «Войти через Google» (owner, 15.11.2026: «для всех стран, кроме России»). The website shows Google's own button (Google
 * Identity Services) and sends the ID token it gets (a JWT signed by Google) to POST /v1/accounts/google; this checks it:
 * an RS256 signature by one of Google's current keys (fetched from GOOGLE_CERTS_URL and kept as long as Google says), the
 * issuer, our client ID as the audience, the time, and an e-mail Google has verified. No client secret is involved, and
 * none is kept anywhere (Google Cloud project `raidos-app`, web client «Raid OS sign-in»).
 */
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto'

/** The web client of Google Cloud project `raidos-app` (public: it is in every page that shows the button). */
export const GOOGLE_CLIENT_ID = '216349713238-prr825vbjd4f60obfrt6541uj0o2shnk.apps.googleusercontent.com'
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
/** Clocks differ a little. */
const SKEW_S = 60
const DEFAULT_KEYS_MS = 60 * 60 * 1000

export class GoogleTokenError extends Error {}

export interface GoogleIdentity { email: string; subject: string; name?: string }

interface Jwk extends JsonWebKey { kid?: string; alg?: string }

export interface GoogleVerifierOptions {
  clientId?: string
  fetcher?: typeof fetch
  now?: () => number
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>

export function createGoogleVerifier(options: GoogleVerifierOptions = {}) {
  const clientId = options.clientId ?? GOOGLE_CLIENT_ID
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? Date.now
  let keys: { list: Jwk[]; until: number } | null = null

  async function googleKeys(force = false) {
    if (!force && keys && keys.until > now()) return keys.list
    const response = await fetcher(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new GoogleTokenError(`Google keys: ${response.status}`)
    const body = await response.json() as { keys?: Jwk[] }
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')
    keys = { list: Array.isArray(body.keys) ? body.keys : [], until: now() + (maxAge ? Number(maxAge[1]) * 1000 : DEFAULT_KEYS_MS) }
    return keys.list
  }

  return async function verifyGoogleIdToken(token: unknown): Promise<GoogleIdentity> {
    if (typeof token !== 'string' || token.length > 8192) throw new GoogleTokenError('not a token')
    const parts = token.split('.')
    if (parts.length !== 3) throw new GoogleTokenError('not a JWT')
    let header: Record<string, unknown>, claims: Record<string, unknown>
    try { header = decode(parts[0]!); claims = decode(parts[1]!) } catch { throw new GoogleTokenError('unreadable JWT') }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new GoogleTokenError('unexpected algorithm')
    // A key Google has just rotated in is not in the kept list yet: ask once more.
    let key = (await googleKeys()).find((entry) => entry.kid === header.kid)
    if (!key) key = (await googleKeys(true)).find((entry) => entry.kid === header.kid)
    if (!key) throw new GoogleTokenError('unknown key')
    const signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2]!, 'base64url'))
    if (!signed) throw new GoogleTokenError('bad signature')
    if (!ISSUERS.has(String(claims.iss))) throw new GoogleTokenError('wrong issuer')
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!audience.includes(clientId)) throw new GoogleTokenError('wrong audience')
    const seconds = now() / 1000
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < seconds) throw new GoogleTokenError('expired')
    if (typeof claims.iat === 'number' && claims.iat - SKEW_S > seconds) throw new GoogleTokenError('issued in the future')
    if (claims.email_verified !== true && claims.email_verified !== 'true') throw new GoogleTokenError('e-mail not verified')
    if (typeof claims.email !== 'string' || !claims.email.includes('@') || typeof claims.sub !== 'string') throw new GoogleTokenError('no e-mail')
    return { email: claims.email.trim().toLowerCase(), subject: claims.sub, ...(typeof claims.name === 'string' ? { name: claims.name } : {}) }
  }
}

export type GoogleVerifier = ReturnType<typeof createGoogleVerifier>
