import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Before the app restarts itself with administrator rights (electron/experimental/elevation.ts relaunchAsAdmin) it
 * checks the native modules it unpacks next to app.asar against hashes recorded at build time (scripts/native-integrity.mjs
 * → dist-electron/native-integrity.json). Those *.node files are outside app.asar, so the asar-integrity fuse does not
 * cover them; a swapped one would otherwise run elevated. The manifest itself ships inside app.asar (sealed by the fuse),
 * so it is a trusted reference.
 */

const HEX64 = /^[a-f0-9]{64}$/
const SAFE_PATH = /^[A-Za-z0-9._@/+ -]+$/

/**
 * The manifest read from inside app.asar (dist-electron/native-integrity.json). null when there is none (a development
 * run, or a build made before this check existed) — then nothing is checked.
 */
export function readManifest(): Record<string, string> | null {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'native-integrity.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { format?: unknown; files?: unknown }
    if (!raw || raw.format !== 1 || !raw.files || typeof raw.files !== 'object' || Array.isArray(raw.files)) return null
    const out: Record<string, string> = {}
    for (const [path, hash] of Object.entries(raw.files as Record<string, unknown>)) {
      if (typeof hash !== 'string' || !HEX64.test(hash)) continue
      if (!SAFE_PATH.test(path) || path.split('/').some((part) => part === '.' || part === '..')) continue
      out[path] = hash
    }
    return out
  } catch {
    return null
  }
}

export interface NativeFileReader {
  exists(path: string): boolean
  hash(path: string): string
}

const diskReader: NativeFileReader = {
  exists: (path) => existsSync(path),
  hash: (path) => createHash('sha256').update(readFileSync(path)).digest('hex'),
}

/**
 * Checks the unpacked native files against the manifest. It fails only on a file that is present but whose bytes differ
 * (a swap) — a legitimate build always matches, so this never blocks a real start. A missing manifest, or a file that is
 * not where the manifest expects it, is treated as trustworthy (no false block): the goal is to catch a tampered native,
 * not to second-guess the packing layout.
 */
export function verifyNativeFiles(
  manifest: Record<string, string> | null,
  resourcesPath: string,
  reader: NativeFileReader = diskReader,
): boolean {
  if (!manifest) return true
  for (const [relPath, expected] of Object.entries(manifest)) {
    const file = join(resourcesPath, ...relPath.split('/'))
    try {
      if (!reader.exists(file)) continue
      if (reader.hash(file) !== expected) return false
    } catch {
      // A file that is there but cannot be read: do not block the start on it.
      continue
    }
  }
  return true
}

/** True when the exe's unpacked native modules are the ones built with it (or there is nothing to check). */
export function nativeFilesTrustworthy(): boolean {
  return verifyNativeFiles(readManifest(), process.resourcesPath)
}
