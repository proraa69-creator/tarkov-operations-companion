/**
 * «Доступ Claude к заявкам» (owner, 14.10.2026: «2 вариант да»): Claude, the AI assistant that works on this code in
 * cloud sessions, reads the players' reports by itself, read-only, with a key the owner creates in the owner app
 * (src/requests/ClaudeAccessPanel.tsx) and keeps in the cloud environment's secrets as RAIDOS_REQUESTS_KEY; the reader
 * is scripts/read-requests.mjs. The key: services/requestsKeyStore.ts; the reports: services/bugReportStore.ts.
 *
 * Owner only (TARKOV_OWNER_EMAILS with a confirmed e-mail): 401 without a session, 404 for everybody else, 429 past
 * 120 reads / 10 changes a minute.
 *   GET    /v1/accounts/me/admin/requests-key -> { active, createdAt?, lastUsedAt? }
 *   POST   /v1/accounts/me/admin/requests-key -> 201 { key, createdAt }: a new key; the old one stops working at once.
 *          The key is in this answer only: the server keeps its SHA-256, the audit log only whether one was replaced
 *          (audit: requests-key.create)
 *   DELETE /v1/accounts/me/admin/requests-key -> 204 (audit: requests-key.revoke, when there was a key)
 *
 * The key's holder (Authorization: Bearer rok_…), read-only. A missing, wrong or revoked key: 401 with one and the same
 * answer. 120 requests an hour per key and per address (an IPv6 /64 counts as one; the address is counted before the
 * key is checked): 429 + Retry-After. Nothing is cached.
 *   GET /v1/agent/requests?status=open|closed|all&limit=1–200&offset
 *       -> { status, total, counts: { open, closed }, limit, offset, reports }: newest first; open and 50 when not given.
 *       A report: { id, number (the «№» in the owner app), kind (bug | idea), category?, status, createdAt, closedAt?,
 *       title, text, appVersion, client? (client | owner | phone), platform, gameEdition? (steam | launcher |
 *       not-found), mode? (pvp | pve | seasonal), quest? { questId, questName?, issue, mode?, mapId?, markerId?,
 *       objectiveId?, stageIndex?, point? { x, z, floor? }, pointNote?, questNote? }, matches?, group?, images,
 *       reporter? }
 *   GET /v1/agent/requests/:id/images/:index -> the image (index from 0, below `images`; PNG / JPEG / WEBP, inline,
 *       nosniff), 404 when there is none
 *
 * Never in an answer: e-mails (an address a player typed into a report is masked too), account ids, IP addresses,
 * sessions, nicknames, subscription days, payments, the owner's mail state. `reporter` is a pseudonym of the sender's
 * account: the same for every report of one account, nothing else about it.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { BUG_REPORT_LIMITS, type BugReportStore, type RedactedReport } from '../services/bugReportStore.js'
import type { RequestsKeyStore } from '../services/requestsKeyStore.js'
import { ipRateKey } from '../services/securityGuard.js'
import type { ReportMode } from '../../../src/shared/reportCategories.js'

export type RequestsKeyAudit = (actor: string, action: 'requests-key.create' | 'requests-key.revoke', target: string, details: Record<string, unknown>) => void
export interface AgentRequestLimits { perKey: number; perIp: number; windowMs: number }
export const AGENT_REQUEST_LIMITS: AgentRequestLimits = { perKey: 120, perIp: 120, windowMs: 60 * 60 * 1000 }
/** A mode's catalog as the server has it loaded (undefined while it is not): only the quest names are read. */
export type QuestCatalog = (mode: ReportMode) => { quests: ReadonlyArray<{ id: string; name: string }> } | undefined
export interface AgentRequestsOptions { audit?: RequestsKeyAudit; limits?: Partial<AgentRequestLimits>; catalog?: QuestCatalog }

/** The one answer to a missing, wrong or revoked key. */
export const REQUESTS_KEY_REQUIRED = 'Нужен действующий ключ доступа к заявкам'

const pageSchema = z.object({
  status: z.enum(['open', 'closed', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})
const idSchema = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const indexSchema = z.coerce.number().int().min(0).max(BUG_REPORT_LIMITS.files - 1)

/** An e-mail address typed into a report, in any script. Bounded parts: no slow matching on long texts. */
const EMAIL = /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){1,8}/gu
const masked = (text: string) => text.replace(EMAIL, '[e-mail]')

/** The second part of «0.6.0.35 · client» (src/components/SupportButtons.tsx): the PC app's build or the phone. */
const CLIENTS: Record<string, 'client' | 'owner' | 'phone'> = { client: 'client', owner: 'owner', iphone: 'phone', android: 'phone', phone: 'phone' }
/** The end of «Windows 10/11 x64 · desktop app · EFT: Steam»: the game installation the PC app found. */
const GAME_EDITIONS: Record<string, 'steam' | 'launcher' | 'not-found'> = { steam: 'steam', 'bsg launcher': 'launcher', 'logs not found': 'not-found' }

function appOf(raw: string) {
  const parts = raw.split(' · ')
  const client = parts.length === 2 ? CLIENTS[parts[1]!.trim().toLowerCase()] : undefined
  return client ? { appVersion: parts[0]!.trim(), client } : { appVersion: raw }
}

function platformOf(raw: string) {
  const match = /^(.*) · EFT: ([^·]+)$/.exec(raw)
  const gameEdition = match ? GAME_EDITIONS[match[2]!.trim().toLowerCase()] : undefined
  return match && gameEdition ? { platform: match[1]!, gameEdition } : { platform: raw }
}

/** The report as the key's holder sees it: every field named here, nothing passed through unseen. */
function agentView(report: RedactedReport, questName: (questId: string, mode?: ReportMode) => string | undefined) {
  const quest = report.quest
  const name = quest ? questName(quest.questId, quest.mode) : undefined
  return {
    id: report.id,
    number: report.id,
    kind: report.kind,
    ...(report.category ? { category: report.category } : {}),
    status: report.status,
    createdAt: report.createdAt,
    ...(report.closedAt ? { closedAt: report.closedAt } : {}),
    title: masked(report.topic),
    text: masked(report.description),
    ...appOf(masked(report.appVersion)),
    ...platformOf(masked(report.platform)),
    ...(quest?.mode ? { mode: quest.mode } : {}),
    ...(quest ? {
      quest: {
        questId: quest.questId,
        ...(name ? { questName: name } : {}),
        issue: quest.issue,
        ...(quest.mode ? { mode: quest.mode } : {}),
        ...(quest.mapId ? { mapId: quest.mapId } : {}),
        ...(quest.markerId ? { markerId: quest.markerId } : {}),
        ...(quest.objectiveId ? { objectiveId: quest.objectiveId } : {}),
        ...(quest.stageIndex != null ? { stageIndex: quest.stageIndex } : {}),
        ...(quest.point ? { point: { x: quest.point.x, z: quest.point.z, ...(quest.point.floor ? { floor: masked(quest.point.floor) } : {}) } } : {}),
        ...(quest.pointNote ? { pointNote: masked(quest.pointNote) } : {}),
        ...(quest.questNote ? { questNote: masked(quest.questNote) } : {}),
      },
    } : {}),
    ...(report.matches ? { matches: report.matches, ...(report.group ? { group: report.group } : {}) } : {}),
    images: report.files,
    ...(report.reporter ? { reporter: report.reporter } : {}),
  }
}

export function createAgentRequestsRouter(accounts: AccountStore, keys: RequestsKeyStore, reports: BugReportStore, options: AgentRequestsOptions = {}) {
  const router = express.Router()
  const limits = { ...AGENT_REQUEST_LIMITS, ...options.limits }
  const ipLimiter = new FixedWindowRateLimiter(limits.perIp, limits.windowMs)
  const keyLimiter = new FixedWindowRateLimiter(limits.perKey, limits.windowMs)
  const readLimiter = new FixedWindowRateLimiter(120, 60 * 1000)
  const writeLimiter = new FixedWindowRateLimiter(10, 60 * 1000)

  /** The owner's e-mail, or an answer was already sent. */
  const owner = (kind: 'read' | 'write', req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = (kind === 'read' ? readLimiter : writeLimiter).hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
    return accounts.emailOf(id) ?? id
  }

  router.get('/v1/accounts/me/admin/requests-key', (req, res) => {
    if (!owner('read', req, res)) return
    res.json(keys.status())
  })

  router.post('/v1/accounts/me/admin/requests-key', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const created = keys.create()
    try { options.audit?.(actor, 'requests-key.create', 'requests-key', { replaced: created.replaced }) } catch { /* the key is created anyway */ }
    res.status(201).json({ key: created.key, createdAt: created.createdAt })
  })

  router.delete('/v1/accounts/me/admin/requests-key', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    if (keys.revoke()) {
      try { options.audit?.(actor, 'requests-key.revoke', 'requests-key', {}) } catch { /* revoked anyway */ }
    }
    res.status(204).end()
  })

  const tooMany = (res: Response, retry: number) => { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Повторите позже.' }) }
  /** The key's holder: the address's budget first (a wrong key spends it too), then the key and its own budget. */
  const agent: express.RequestHandler = (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const ipRetry = ipLimiter.hit(ipRateKey(req.ip))
    if (ipRetry) { tooMany(res, ipRetry); return }
    const key = keys.verify(bearer(req.get('authorization')))
    if (!key) { res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: REQUESTS_KEY_REQUIRED }); return }
    const retry = keyLimiter.hit(key)
    if (retry) { tooMany(res, retry); return }
    next()
  }

  /** Quest names from the loaded catalog, read once per answer and mode. */
  const questNames = () => {
    const byMode = new Map<ReportMode, Map<string, string> | undefined>()
    return (questId: string, mode: ReportMode = 'pvp') => {
      if (!options.catalog) return undefined
      if (!byMode.has(mode)) {
        let names: Map<string, string> | undefined
        try {
          const quests = options.catalog(mode)?.quests
          names = quests ? new Map(quests.map((quest) => [quest.id, quest.name])) : undefined
        } catch { names = undefined }
        byMode.set(mode, names)
      }
      return byMode.get(mode)?.get(questId)
    }
  }

  router.get('/v1/agent/requests', agent, (req, res) => {
    const query = pageSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'status: open, closed или all; limit: 1–200; offset: от 0' }); return }
    const { status, limit, offset } = query.data
    const page = reports.redactedPage(status === 'all' ? undefined : status, limit, offset, (accountId) => keys.pseudonym(accountId))
    const questName = questNames()
    res.json({ status, total: page.total, counts: page.counts, limit, offset, reports: page.reports.map((report) => agentView(report, questName)) })
  })

  router.get('/v1/agent/requests/:id/images/:index', agent, (req, res) => {
    const id = idSchema.safeParse(req.params.id)
    const index = indexSchema.safeParse(req.params.index)
    const file = id.success && index.success ? reports.file(id.data, index.data) : undefined
    if (!file) { res.status(404).json({ error: 'Изображение не найдено' }); return }
    const extension = file.mime.slice('image/'.length).replace('jpeg', 'jpg')
    res.set({
      'Content-Type': file.mime,
      'Content-Length': String(file.data.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="request-${id.data}-${index.data! + 1}.${extension}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    res.end(file.data)
  })

  return router
}
