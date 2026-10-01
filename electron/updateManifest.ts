import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { UPDATE_SIGNING_PUBLIC_KEY } from './updateSigningKey.js'

/**
 * The players' update manifest (/download/version.json, electron/localServer.ts) and its Ed25519 signature.
 * scripts/sign-client-release.mjs signs exactly `canonicalUpdatePayload` (it keeps its own copy of the function; a test
 * keeps the two identical) and the app (electron/appUpdate.ts) installs a build only when `verifiedUpdateManifest`
 * accepts the served fields with UPDATE_SIGNING_PUBLIC_KEY. No Electron imports: the tests and the script share it.
 */
export interface UpdateManifest { edition: 'client' | 'owner'; version: string; build: number; commit: string; size: number; sha256: string }

export const UPDATE_PAYLOAD_PREFIX = 'raidos-update-v1'

/** One line of text: a newline (or any other control character) could make two different manifests read the same. */
const isLine = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 200 && [...value].every((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** The exact text the signature covers; throws for a field that cannot be signed unambiguously. */
export function canonicalUpdatePayload(manifest: UpdateManifest): string {
  const { edition, version, build, commit, size, sha256 } = manifest
  if (edition !== 'client' && edition !== 'owner') throw new Error('update manifest: edition must be client or owner')
  if (!isLine(version) || !isLine(commit)) throw new Error('update manifest: version and commit must be one line of text')
  if (!isCount(build) || !isCount(size)) throw new Error('update manifest: build and size must be positive integers')
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('update manifest: sha256 must be 64 lowercase hex digits')
  return `${UPDATE_PAYLOAD_PREFIX}\n${edition}\n${version}\n${build}\n${commit}\n${size}\n${sha256}`
}

/** An Ed25519 signature is 64 bytes: 88 base64 characters ending in «==». */
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/

/**
 * The signed fields of a served manifest when its `signature` verifies with the public key (the one built into the app
 * unless a test passes its own); null when it is missing, malformed or does not match. Only the returned copy is to be
 * trusted: it holds exactly the values the signature covers.
 */
export function verifiedUpdateManifest(data: unknown, publicKey: string | KeyObject = UPDATE_SIGNING_PUBLIC_KEY): UpdateManifest | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  if (typeof raw.signature !== 'string' || !SIGNATURE.test(raw.signature)) return null
  const manifest = { edition: raw.edition, version: raw.version, build: raw.build, commit: raw.commit, size: raw.size, sha256: raw.sha256 } as UpdateManifest
  try {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey
    if (key.asymmetricKeyType !== 'ed25519') return null
    return verify(null, Buffer.from(canonicalUpdatePayload(manifest), 'utf8'), key, Buffer.from(raw.signature, 'base64')) ? manifest : null
  } catch {
    return null
  }
}
