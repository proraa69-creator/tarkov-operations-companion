/**
 * The owner's server exe from the website (admin panel → «Обновление» → «Серверная версия»). The owner build runs
 * without a subscription, so there is no permanent or public link: the owner's account asks for a one-time link that
 * lives 15 minutes and serves at most three downloads (a retry after a broken download), then it is gone.
 *
 *   POST /v1/accounts/me/admin/server-exe-link   owner only -> { url, expiresAt, size, name }
 *   GET  /v1/server-exe/:token                    the exe itself (Content-Disposition: attachment)
 *
 * The file is the portable exe this laptop runs (RAIDOS_SERVER_EXE, set by electron/localServer.ts in the owner build).
 */
import { createReadStream, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import express from 'express'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'

export const SERVER_LINK_TTL_MS = 15 * 60 * 1000
export const SERVER_LINK_MAX_USES = 3
const DOWNLOAD_NAME = 'Raid OS Server.exe'

export interface ServerDownloadOptions {
  /** Path of the exe; undefined when this server was not started by the owner app. */
  exePath?: () => string | undefined
  now?: () => number
  audit?: (actor: string, action: 'server.download-link', details: Record<string, unknown>) => void
}

export function createServerDownloadRouter(accounts: AccountStore, options: ServerDownloadOptions = {}) {
  const router = express.Router()
  const now = options.now ?? Date.now
  const exePath = options.exePath ?? (() => process.env.RAIDOS_SERVER_EXE || undefined)
  const links = new Map<string, { expires: number; uses: number }>()
  const limiter = new FixedWindowRateLimiter(10, 60 * 60 * 1000)
  const fileSize = () => {
    const path = exePath()
    if (!path) return undefined
    try { const info = statSync(path); return info.isFile() ? { path, size: info.size } : undefined } catch { return undefined }
  }

  router.post('/v1/accounts/me/admin/server-exe-link', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return }
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
