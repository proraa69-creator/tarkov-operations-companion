/**
 * Encrypted game-data cache of the players' app (client edition, docs/subscription-protection.md).
 *
 * The renderer keeps nothing of the paid data on disk itself: the catalog, translations and other answers of the data
 * gateway come here over IPC (`data-cache:get` / `data-cache:set`) and are written to userData/game-cache encrypted with
 * Electron safeStorage (DPAPI on Windows). Every entry carries an expiry: the earlier of its own lifetime and the
 * expiry of the signed entitlement, so a copy that loses its subscription (or never reaches the server again) cannot
 * read old data back. Without a valid entitlement nothing is read or written; signing out or a refusal wipes the folder.
 * Without OS encryption the cache lives in memory only.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

/** Keys the renderer may use: `catalog:pvp:ru`, `translations:regular`, `graphql:<sha>`… */
export const CACHE_KEY = /^[A-Za-z0-9:._-]{1,160}$/
export const MAX_ENTRY_CHARS = 120 * 1024 * 1024
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface Entry { key: string; scope: string; exp: number; savedAt: number; value: string }

const dir = () => join(app.getPath('userData'), 'game-cache')
const memory = new Map<string, Entry>()

function canEncrypt() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

/** One file per key and scope (server + account): another account on this PC never reads this one's data. */
const fileFor = (scope: string, key: string) => join(dir(), `${createHash('sha256').update(scope).update('\0').update(key).digest('hex')}.bin`)

/**
 * `access` comes from the entitlement (serviceGateway.ts): the scope of the signed-in account on its server and when
 * the entitlement ends. Without it the cache answers nothing.
 */
export interface CacheAccess { scope: string; expiresAt: number }

export async function readGameCache(access: CacheAccess | null, key: unknown): Promise<string | null> {
  if (!access || typeof key !== 'string' || !CACHE_KEY.test(key)) return null
  const now = Date.now()
  let entry = memory.get(`${access.scope}\0${key}`)
  if (!entry && canEncrypt()) {
    try { entry = JSON.parse(safeStorage.decryptString(await readFile(fileFor(access.scope, key)))) as Entry } catch { entry = undefined }
  }
  if (!entry || entry.key !== key || entry.scope !== access.scope) return null
  if (entry.exp <= now || entry.savedAt > now + 10 * 60 * 1000) {
    memory.delete(`${access.scope}\0${key}`)
    await rm(fileFor(access.scope, key), { force: true }).catch(() => {})
    return null
  }
  return entry.value
}

export async function writeGameCache(access: CacheAccess | null, key: unknown, value: unknown, maxAgeMs: unknown): Promise<boolean> {
  if (!access || typeof key !== 'string' || !CACHE_KEY.test(key) || typeof value !== 'string' || value.length > MAX_ENTRY_CHARS) return false
  const now = Date.now()
  const age = typeof maxAgeMs === 'number' && Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? Math.min(maxAgeMs, MAX_AGE_MS) : MAX_AGE_MS
  const entry: Entry = { key, scope: access.scope, exp: Math.min(now + age, access.expiresAt), savedAt: now, value }
  if (entry.exp <= now) return false
  if (!canEncrypt()) { memory.set(`${access.scope}\0${key}`, entry); return true }
  await mkdir(dir(), { recursive: true })
  await writeFile(fileFor(access.scope, key), safeStorage.encryptString(JSON.stringify(entry)))
  return true
}

/** Sign-out, «нужна подписка», a switched-off device or «Очистить данные»: everything goes. */
export async function clearGameCache() {
  memory.clear()
  await rm(dir(), { recursive: true, force: true }).catch(() => {})
}
