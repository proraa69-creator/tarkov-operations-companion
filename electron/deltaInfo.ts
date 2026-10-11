import { createPublicKey, verify, type KeyObject } from 'node:crypto'

/**
 * The manifest of a release's partial update (/app-delta/info.json, scripts/publish-app-delta.cjs) and its signature
 * (scripts/sign-app-delta.mjs). No imports besides node:crypto: electron/boot.ts checks a staged players' build with it
 * before anything of that build runs, the tests and electron/appDelta.ts share it.
 */
export const DELTA_FORMAT = 1
const HEX64 = /^[a-f0-9]{64}$/
const SAFE_PATH = /^[A-Za-z0-9._@+ -]+(\/[A-Za-z0-9._@+ -]+)*$/

export interface DeltaInfo {
  format: 1
  build: number
  version: string
  commit: string
  /** Electron version of the release: the staged archive runs on the exe's own runtime. */
  electron: string
  /**
   * Size of the published app.asar, where its file data starts (8 + header pickle), and the SHA-256 of the whole
   * archive and of its header (the first `dataStart` bytes).
   */
  asar: { size: number; dataStart: number; sha256?: string; headerSha256?: string }
  /** SHA-256 of every file in resources outside app.asar / app.asar.unpacked, '/'-separated relative paths. */
  resources: Record<string, string>
  /**
   * Ed25519 (base64) over canonicalDeltaPayload with the update key (electron/updateSigningKey.ts), added by the release
   * publisher (scripts/sign-app-delta.mjs). The players' copy takes a release in parts only when it verifies.
   */
  signature?: string
}

export const DELTA_PAYLOAD_PREFIX = 'raidos-app-delta-v1'

/** The exact text the delta signature covers (scripts/sign-app-delta.mjs keeps an identical copy; a test compares them). */
export function canonicalDeltaPayload(info: DeltaInfo): string {
  const { build, version, commit, electron, asar, resources } = info
  if (!asar.sha256 || !HEX64.test(asar.sha256) || !asar.headerSha256 || !HEX64.test(asar.headerSha256)) throw new Error('app delta: archive hashes missing')
  for (const value of [version, commit, electron]) if (!/^[\x20-\x7e]{1,200}$/.test(value)) throw new Error('app delta: version, commit and electron must be one line of text')
  for (const value of [build, asar.size, asar.dataStart]) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('app delta: build and archive sizes must be positive integers')
  for (const [name, hash] of Object.entries(resources)) if (!SAFE_PATH.test(name) || !HEX64.test(hash)) throw new Error('app delta: bad resource entry')
  const files = Object.keys(resources).sort().map((name) => `${name}=${resources[name]}`).join('\n')
  return `${DELTA_PAYLOAD_PREFIX}\n${build}\n${version}\n${commit}\n${electron}\n${asar.size}\n${asar.dataStart}\n${asar.sha256}\n${asar.headerSha256}\n${files}`
}

const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/

/** True when the delta's signature verifies with this Ed25519 public key. */
export function deltaSignatureValid(info: DeltaInfo, publicKey: string | KeyObject) {
  if (!info.signature || !SIGNATURE.test(info.signature)) return false
  try {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, Buffer.from(canonicalDeltaPayload(info), 'utf8'), key, Buffer.from(info.signature, 'base64'))
  } catch {
    return false
  }
}

export function parseDeltaInfo(raw: unknown): DeltaInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const info = raw as Record<string, unknown>
  const asar = info.asar as Record<string, unknown> | undefined
  const resources = info.resources as Record<string, unknown> | undefined
  if (info.format !== DELTA_FORMAT || !Number.isSafeInteger(info.build) || (info.build as number) <= 0) return null
  if (typeof info.version !== 'string' || typeof info.commit !== 'string' || typeof info.electron !== 'string' || !info.electron) return null
  if (!asar || !Number.isSafeInteger(asar.size) || !Number.isSafeInteger(asar.dataStart) || (asar.size as number) <= 0) return null
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) return null
  for (const [path, hash] of Object.entries(resources)) if (!SAFE_PATH.test(path) || path.split('/').some((part) => part === '.' || part === '..') || typeof hash !== 'string' || !HEX64.test(hash)) return null
  const hash = (value: unknown) => (typeof value === 'string' && HEX64.test(value) ? value : undefined)
  const sha256 = hash(asar.sha256)
  const headerSha256 = hash(asar.headerSha256)
  return {
    format: 1, build: info.build as number, version: info.version, commit: info.commit, electron: info.electron,
    asar: { size: asar.size as number, dataStart: asar.dataStart as number, ...(sha256 ? { sha256 } : {}), ...(headerSha256 ? { headerSha256 } : {}) },
    resources: resources as Record<string, string>,
    ...(typeof info.signature === 'string' && SIGNATURE.test(info.signature) ? { signature: info.signature } : {}),
  }
}
