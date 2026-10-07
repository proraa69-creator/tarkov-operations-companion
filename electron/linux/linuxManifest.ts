import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { UPDATE_SIGNING_PUBLIC_KEY } from '../updateSigningKey.js'

/**
 * The Linux server (docs/linux-server.md): one signed description per release, `RaidOS-linux.json`, next to the Windows
 * parts in raidos-releases. It names the server bundle (`raidos-server-<build>.tar.gz`: API, website, site server and
 * updater) with its size and SHA-256. Signed with the same Ed25519 update key as the other manifests, under its own
 * prefix, so no other signature can be passed off as this one. No Electron imports: used by the build script, the
 * updater on the VPS (electron/linux/updater.ts) and the tests.
 *
 * Canonical text (one field per line, «\n», no trailing newline):
 *   raidos-linux-server-v1
 *   version=<version>
 *   build=<build>
 *   commit=<commit>
 *   bundle=<file name> <size> <sha256>
 */
export const LINUX_PAYLOAD_PREFIX = 'raidos-linux-server-v1'
export const LINUX_MANIFEST_FILE = 'RaidOS-linux.json'
export const MAX_LINUX_BUNDLE_BYTES = 200 * 1024 * 1024

export interface LinuxBundle { name: string; size: number; sha256: string }
export interface LinuxManifest { version: string; build: number; commit: string; bundle: LinuxBundle }

const VERSION = /^[0-9A-Za-z._+-]{1,64}$/
const COMMIT = /^[0-9A-Za-z._-]{0,64}$/
const SHA256 = /^[a-f0-9]{64}$/
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/
const BUNDLE_NAME = /^raidos-server-\d{1,16}\.tar\.gz$/

/** The exact text the signature covers; throws for anything that cannot be signed unambiguously. */
export function canonicalLinuxPayload(manifest: LinuxManifest): string {
  const { version, build, commit, bundle } = manifest
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('linux bundle: bad version')
  if (typeof build !== 'number' || !Number.isSafeInteger(build) || build <= 0) throw new Error('linux bundle: bad build')
  if (typeof commit !== 'string' || !COMMIT.test(commit)) throw new Error('linux bundle: bad commit')
  if (!bundle || typeof bundle !== 'object') throw new Error('linux bundle: the bundle is missing')
  if (typeof bundle.name !== 'string' || !BUNDLE_NAME.test(bundle.name) || bundle.name !== `raidos-server-${build}.tar.gz`) throw new Error('linux bundle: bad file name')
  if (typeof bundle.size !== 'number' || !Number.isSafeInteger(bundle.size) || bundle.size <= 0 || bundle.size > MAX_LINUX_BUNDLE_BYTES) throw new Error('linux bundle: bad size')
  if (typeof bundle.sha256 !== 'string' || !SHA256.test(bundle.sha256)) throw new Error('linux bundle: bad sha256')
  return [LINUX_PAYLOAD_PREFIX, `version=${version}`, `build=${build}`, `commit=${commit}`, `bundle=${bundle.name} ${bundle.size} ${bundle.sha256}`].join('\n')
}

/** Build session only: the manifest with its signature (the private key never leaves the build). */
export function signLinuxManifest(manifest: LinuxManifest, privateKey: KeyObject | string) {
  const signature = sign(null, Buffer.from(canonicalLinuxPayload(manifest), 'utf8'), privateKey).toString('base64')
  return { ...manifest, signature }
}

/** The signed fields when `signature` verifies with the update key (the built-in one unless a test passes its own). */
export function verifiedLinuxManifest(data: unknown, publicKey: string | KeyObject = UPDATE_SIGNING_PUBLIC_KEY): LinuxManifest | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const raw = data as Record<string, unknown>
  if (typeof raw.signature !== 'string' || !SIGNATURE.test(raw.signature)) return null
  const bundle = (raw.bundle && typeof raw.bundle === 'object' ? raw.bundle : {}) as Record<string, unknown>
  const manifest: LinuxManifest = {
    version: raw.version as string, build: raw.build as number, commit: raw.commit as string,
    bundle: { name: bundle.name as string, size: bundle.size as number, sha256: bundle.sha256 as string },
  }
  try {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey
    if (key.asymmetricKeyType !== 'ed25519') return null
    return verify(null, Buffer.from(canonicalLinuxPayload(manifest), 'utf8'), key, Buffer.from(raw.signature, 'base64')) ? manifest : null
  } catch {
    return null
  }
}
