/**
 * The server's quest base for the owner (services/questBase.ts):
 *
 *   GET /v1/accounts/me/admin/quest-base -> { periodMinutes, modes: { pvp | pve | seasonal: { version, builtAt, checkedAt,
 *        sources, counts, changes: { since, added, removed, renamed }, renamedQuests, state } } }
 *
 * Owner only, as the other owner routes (routes/questTexts.ts): 401 without a session, 404 for everybody else (the route
 * does not reveal that it exists). Read-only; `Cache-Control: no-store`.
 */
import express from 'express'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { QuestBaseReport } from '../services/questBase.js'

export function createQuestBaseRouter(accounts: AccountStore, base: { report: () => QuestBaseReport }) {
  const router = express.Router()
  const limiter = new FixedWindowRateLimiter(60, 60 * 1000)
  router.get('/v1/accounts/me/admin/quest-base', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return }
    const retry = limiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return }
    res.json(base.report())
  })
  return router
}
