import cors from 'cors'
import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { fetchPlayerProfile } from '../../electron/playerProfileService'
import { getCatalogSnapshot, resolvePlayer } from './services/catalogService.js'
import type { ProgressStore } from './services/progressStore.js'
import { createGoonsRouter } from './routes/goons.js'

const modeSchema = z.enum(['pvp', 'pve', 'seasonal'])
const syncSchema = z.object({
  mode: modeSchema, accountId: z.number().int().positive(), characterId: z.string().regex(/^[a-f0-9]{24}$/i),
  events: z.array(z.object({ taskId: z.string().regex(/^[a-f0-9]{24}$/i), status: z.enum(['active', 'completed', 'failed']), timestamp: z.string().datetime().transform((date) => new Date(date).toISOString()) })).max(2000),
})

export function createApi(store: ProgressStore, token?: string) {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' }))
  app.use(express.json({ limit: '1mb' }))
  app.use('/v1/goons', createGoonsRouter())
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'tarkov-operations-api', version: '0.2.0', syncRequiresToken: true }))
  app.post('/v1/sync/events', (req, res) => {
    const supplied = req.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (!token || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) {
      res.status(401).json({ error: 'Требуется авторизация устройства' }); return
    }
    // Development owner only. Public accounts require per-user sessions before deployment.
    res.json(store.sync('local-development', syncSchema.parse(req.body)))
  })
  app.get('/v1/catalog/:mode', async (req, res) => res.json(await getCatalogSnapshot(modeSchema.parse(req.params.mode))))
  app.post('/v1/players/resolve', async (req, res) => {
    const body = z.object({ mode: modeSchema, nickname: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,15}$/) }).parse(req.body)
    res.json(await resolvePlayer(body.mode, body.nickname))
  })
  app.get('/v1/players/:mode/:accountId', async (req, res) => res.json(await fetchPlayerProfile(modeSchema.parse(req.params.mode), z.coerce.number().int().positive().parse(req.params.accountId))))
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next
    const status = error instanceof z.ZodError ? 400 : typeof error === 'object' && error && 'status' in error ? Number(error.status) : 502
    res.status(status >= 400 && status < 600 ? status : 502).json({ error: error instanceof z.ZodError ? 'Некорректные данные запроса' : error instanceof Error ? error.message : 'Сервис временно недоступен' })
  })
  return app
}
