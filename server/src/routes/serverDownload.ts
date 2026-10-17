/**
 * The owner's server exe from the website (admin panel → «Обновление» → «Серверная версия»). The owner build runs
 * without a subscription, so there is no permanent or public link: the owner's account asks for a one-time link that
 * lives 15 minutes and serves at most three downloads (a retry after a broken download), then it is gone.
 *
 *   POST /v1/accounts/me/admin/server-exe-link     owner only -> { url, expiresAt, size, name }
 *   GET  /v1/server-exe/:token                      the exe itself (Content-Disposition: attachment)
 *   GET  /v1/accounts/me/admin/server-exe-manifest  owner only -> the exe's signed update manifest
 *
 * The file is the portable exe this laptop runs (RAIDOS_SERVER_EXE, set by electron/localServer.ts in the owner build),
 * or on the VPS the owner exe the release publisher puts in /opt/raidos-private.
 *
 * The owner's copy of the app updates itself with that exe (electron/appUpdate.ts): it asks for the manifest, checks its
 * Ed25519 signature with the update key built into the app, takes a one-time link and checks the download's size and
 * SHA-256 against the signed values. The manifest is written and signed by the release publisher, never here (the
 * private key is not on this server): `{ edition: 'owner', version, build, commit, size, sha256, signature }` in
 * RAIDOS_SERVER_EXE_MANIFEST, by default next to the exe with «.json» in place of «.exe». It is served only while its
 * size and SHA-256 are those of the exe on disk, so a half-finished publication never offers a mismatched pair.
 */
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, join, parse } from 'node:path'
import express from 'express'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'

export const SERVER_LINK_TTL_MS = 15 * 60 * 1000
export const SERVER_LINK_MAX_USES = 3
const DOWNLOAD_NAME = 'Raid OS Server.exe'
const MANIFEST_MAX_BYTES = 4096

/** The signed owner-exe manifest as served: the fields the signature covers and the signature (checked by the app). */
export interface OwnerExeManifest { edition: 'owner'; version: string; build: number; commit: string; size: number; sha256: string; signature: string }

/** Where the publisher writes the manifest: RAIDOS_SERVER_EXE_MANIFEST, else the exe's name with «.json». */
export function defaultManifestPath(exe: string) {
  const configured = process.env.RAIDOS_SERVER_EXE_MANIFEST?.trim()
  if (configured) return configured
  const { name } = parse(exe)
  return join(dirname(exe), `${name}.json`)
}

/** The manifest's own shape (the signature itself is checked by the app with its built-in key); null for anything else. */
export function parseOwnerExeManifest(data: unknown): OwnerExeManifest | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const raw = data as Record<string, unknown>
  const line = (value: unknown): value is string => typeof value === 'string' && /^[\x20-\x7e]{1,200}$/.test(value)
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  if (raw.edition !== 'owner' || !line(raw.version) || !line(raw.commit) || !count(raw.build) || !count(raw.size)) return null
  if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) return null
  if (typeof raw.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(raw.signature)) return null
  return { edition: 'owner', version: raw.version, build: raw.build, commit: raw.commit, size: raw.size, sha256: raw.sha256, signature: raw.signature }
}

export interface ServerDownloadOptions {
  /** Path of the exe; undefined when this server was not started by the owner app. */
  exePath?: () => string | undefined
  /** Path of the exe's signed manifest (default: defaultManifestPath). */
  manifestPath?: (exe: string) => string
  now?: () => number
  audit?: (actor: string, action: 'server.download-link', details: Record<string, unknown>) => void
}

export function createServerDownloadRouter(accounts: AccountStore, options: ServerDownloadOptions = {}) {
  const router = express.Router()
  const now = options.now ?? Date.now
  const exePath = options.exePath ?? (() => process.env.RAIDOS_SERVER_EXE || undefined)
  const manifestPath = options.manifestPath ?? defaultManifestPath
  const links = new Map<string, { expires: number; uses: number }>()
  const limiter = new FixedWindowRateLimiter(10, 60 * 60 * 1000)
  const fileSize = () => {
    const path = exePath()
    if (!path) return undefined
    try { const info = statSync(path); return info.isFile() ? { path, size: info.size, changed: `${info.ino}:${info.size}:${info.mtimeMs}` } : undefined } catch { return undefined }
  }
  // SHA-256 of the exe, computed once per file version (a release replaces the file, which changes inode / mtime).
  let hashed: { path: string; changed: string; sha256: Promise<string> } | null = null
  const exeSha256 = (file: { path: string; changed: string }) => {
    if (hashed?.path !== file.path || hashed.changed !== file.changed) {
      const sha256 = new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256')
        createReadStream(file.path).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')))
      })
      hashed = { path: file.path, changed: file.changed, sha256 }
      sha256.catch(() => { if (hashed?.sha256 === sha256) hashed = null })
    }
    return hashed.sha256
  }
  const owner = (req: express.Request, res: express.Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return null }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return null }
    return id
  }

  router.post('/v1/accounts/me/admin/server-exe-link', (req, res) => {
    const id = owner(req, res)
    if (!id) return
    const retry = limiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много ссылок. Подождите немного.' }); return }
    const file = fileSize()
    if (!file) { res.status(409).json({ error: 'Файл сервера недоступен: сервер запущен не из приложения владельца.' }); return }
    for (const [key, link] of links) if (link.expires <= now()) links.delete(key)
    const token = randomBytes(24).toString('hex')
    const expires = now() + SERVER_LINK_TTL_MS
    links.set(token, { expires, uses: 0 })
    try { options.audit?.(accounts.emailOf(id) ?? id, 'server.download-link', { size: file.size }) } catch { /* the link works anyway */ }
    res.json({ url: `/v1/server-exe/${token}`, expiresAt: new Date(expires).toISOString(), size: file.size, name: DOWNLOAD_NAME })
  })

  /** The signed manifest of the exe on disk; 404 while there is none or it describes another file. */
  router.get('/v1/accounts/me/admin/server-exe-manifest', async (req, res) => {
    if (!owner(req, res)) return
    const missing = () => res.status(404).json({ error: 'Подписанной серверной версии на сервере нет' })
    const file = fileSize()
    if (!file) { missing(); return }
    let manifest: OwnerExeManifest | null = null
    try {
      const path = manifestPath(file.path)
      if (statSync(path).size <= MANIFEST_MAX_BYTES) manifest = parseOwnerExeManifest(JSON.parse(readFileSync(path, 'utf8')))
    } catch { /* no manifest published */ }
    if (!manifest || manifest.size !== file.size) { missing(); return }
    try {
      if (await exeSha256(file) !== manifest.sha256) { missing(); return }
    } catch { missing(); return }
    res.json(manifest)
  })

  router.get('/v1/server-exe/:token', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const token = String(req.params.token)
    const link = /^[a-f0-9]{48}$/.test(token) ? links.get(token) : undefined
    if (!link || link.expires <= now() || link.uses >= SERVER_LINK_MAX_USES) {
      if (link) links.delete(token)
      res.status(404).type('text/plain; charset=utf-8').send('Ссылка устарела. Получите новую в админ-панели: «Обновление» → «Серверная версия».')
      return
    }
    const file = fileSize()
    if (!file) { res.status(404).type('text/plain; charset=utf-8').send('Файл сервера недоступен.'); return }
    link.uses += 1
    res.status(200).set({
      'Content-Type': 'application/vnd.microsoft.portable-executable',
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="${DOWNLOAD_NAME}"`,
      'X-Content-Type-Options': 'nosniff',
    })
    const stream = createReadStream(file.path)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })

  return router
}
