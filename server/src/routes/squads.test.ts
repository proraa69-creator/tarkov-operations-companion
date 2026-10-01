import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { normalizeSquadCode, SQUAD_INVITE_TTL_MS } from '../services/squadStore.js'
import type { AppDataset } from '../models/api.js'
import type { SquadRouterOptions } from './squads.js'

const password = 'correct horse battery'
const CHARACTER = '0123456789abcdef01234567'
const Q_SHARED = '5936d90786f7742b1420ba5b'
const Q_SOLO = '5936d90786f7742b1420ba5c'
const Q_ANY = '5936d90786f7742b1420ba5d'
const Q_OTHER_MAP = '5936d90786f7742b1420ba5e'

const catalog = {
  quests: [
    { id: Q_SHARED, name: 'Shared', mapId: 'customs', raidRequirements: [{ itemId: 'flash', count: 2, purpose: 'handover', mapIds: [] }] },
    { id: Q_SOLO, name: 'Solo', mapId: 'customs', requiredItems: ['flash'] },
    { id: Q_ANY, name: 'Any', anyMap: true },
    { id: Q_OTHER_MAP, name: 'Woods', mapIds: ['woods'], requiredItems: ['axe'] },
  ],
  items: [], maps: [], markers: [], hideout: [], traders: [],
} as unknown as AppDataset

type Call = (method: string, path: string, body?: unknown, token?: string, ip?: string) => Promise<Response>
interface Ctx { call: Call; accounts: AccountStore; progress: ProgressStore; clock: { now: number }; user: (email: string) => Promise<string>; trial: (email: string) => Promise<string> }

async function withServer(run: (ctx: Ctx) => Promise<void>, limits?: SquadRouterOptions['limits']) {
  const clock = { now: Date.parse('2026-10-01T10:00:00.000Z') }
  const progress = new ProgressStore(':memory:')
  const accounts = new AccountStore({ now: () => clock.now })
  // The trial needs a streamer's referral code.
  await accounts.register('streamer@example.com', password)
  accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  const server = createApi(progress, undefined, accounts, { catalog: (mode) => (mode === 'pvp' ? catalog : undefined), squadLimits: limits }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call: Call = (method, path, body, token, ip) => fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  try {
    await run({
      call, accounts, progress, clock,
      user: async (email) => (await accounts.register(email, password)).token,
      trial: async (email) => (await accounts.register(email, password, 'HUNTER')).token,
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    progress.close()
    accounts.close()
  }
}

const json = async <T>(response: Response) => (await response.json()) as T
interface SquadView { id: string; name: string; isOwner: boolean; members: Array<{ memberId: string; nickname: string | null; isYou: boolean; isOwner: boolean; activeQuestIds?: string[] }> }

async function createSquad(call: Call, token: string) {
  const response = await call('POST', '/v1/squads', { name: 'Тройка' }, token)
  assert.equal(response.status, 201)
  return (await json<{ squad: SquadView }>(response)).squad
}
async function invite(call: Call, token: string, squadId: string) {
  const response = await call('POST', `/v1/squads/${squadId}/invites`, undefined, token)
  assert.equal(response.status, 201)
  return (await json<{ code: string; expiresAt: string }>(response)).code
}

test('squad routes need a session and a subscription, trial or streamer account', async () => {
  await withServer(async ({ call, user, accounts }) => {
    assert.equal((await call('GET', '/v1/squads/mine/pvp')).status, 401)
    assert.equal((await call('POST', '/v1/squads', {})).status, 401)
    assert.equal((await call('POST', '/v1/squads/join', { code: 'ABCDE-FGHJK' }, 'x'.repeat(43))).status, 401)
    const free = await user('free@example.com')
    const mine = await json<{ squad: unknown; access: boolean; invitations: unknown[] }>(await call('GET', '/v1/squads/mine/pvp', undefined, free))
    assert.deepEqual(mine, { squad: null, access: false, invitations: [] })
    const refused = await call('POST', '/v1/squads', {}, free)
    assert.equal(refused.status, 402)
    assert.equal((await json<{ code: string }>(refused)).code, 'subscription_required')
    assert.equal((await call('POST', '/v1/squads/join', { code: 'ABCDE-FGHJK' }, free)).status, 402)
    // Streamers use the service for free.
    const streamer = (await accounts.login('streamer@example.com', password)).token
    assert.equal((await call('POST', '/v1/squads', {}, streamer)).status, 201)
    assert.equal((await call('GET', '/v1/squads/mine/arena', undefined, streamer)).status, 400)
    assert.equal((await call('POST', '/v1/squads', { name: '<script>' }, free)).status, 400)
  })
})

test('create, invite, join, overview: shared quests, maps and items per mode, nicknames only', async () => {
  await withServer(async ({ call, trial, accounts, progress }) => {
    const a = await trial('alpha@example.com')
    const b = await trial('bravo@example.com')
    const c = await trial('charlie@example.com')
    const aId = accounts.authenticate(a)!
    accounts.setNicknames(aId, { pvp: 'AlphaPvP', pve: 'AlphaPvE' })
    accounts.setNicknames(accounts.authenticate(b)!, { pvp: 'BravoPvP' })

    const squad = await createSquad(call, a)
    assert.equal(squad.name, 'Тройка')
    assert.match(squad.id, /^[a-f0-9]{32}$/)
    const code = await invite(call, a, squad.id)
    assert.match(code, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/)
    // Members (not the commander) cannot invite.
    const joined = await json<{ squad: SquadView }>(await call('POST', '/v1/squads/join', { code: code.toLowerCase().replace('-', ' ') }, b))
    assert.equal(joined.squad.id, squad.id)
    assert.equal((await call('POST', `/v1/squads/${squad.id}/invites`, undefined, b)).status, 403)
    assert.equal((await call('POST', '/v1/squads/join', { code }, c)).status, 200)
    // Joining the same squad again is harmless; creating a second one is refused.
    assert.equal((await call('POST', '/v1/squads/join', { code }, c)).status, 200)
    assert.equal((await call('POST', '/v1/squads', {}, c)).status, 409)

    const events = (ids: string[]) => ({ accountId: 1, characterId: CHARACTER, events: ids.map((taskId) => ({ taskId, status: 'active' as const, timestamp: '2026-10-01T09:00:00.000Z' })) })
    progress.syncUser(`user:${aId}`, 'pvp', events([Q_SHARED, Q_SOLO, Q_ANY]))
    progress.syncUser(`user:${accounts.authenticate(b)!}`, 'pvp', events([Q_SHARED, Q_ANY, Q_OTHER_MAP]))
    progress.syncUser(`user:${accounts.authenticate(c)!}`, 'pve', events([Q_SHARED]))

    const overview = await json<{ squad: SquadView; mode: string; sharedQuests: Array<{ questId: string; memberIds: string[] }>; maps: Array<{ mapId: string; sharedCount: number; quests: Array<{ questId: string; memberIds: string[] }> }>; anyMap: Array<{ questId: string }>; items: Array<{ itemId: string; total: number; members: Array<{ count: number }> }> }>(await call('GET', `/v1/squads/${squad.id}/overview/pvp`, undefined, b))
    assert.equal(overview.mode, 'pvp')
    assert.deepEqual(overview.squad.members.map((member) => member.nickname), ['AlphaPvP', 'BravoPvP', null])
    assert.deepEqual(overview.squad.members.map((member) => member.isYou), [false, true, false])
    assert.deepEqual(overview.squad.members.map((member) => member.isOwner), [true, false, false])
    // Charlie's quest is in PvE: it must not count in PvP.
    assert.deepEqual(overview.squad.members[2].activeQuestIds, [])
    assert.deepEqual(overview.sharedQuests.map((entry) => [entry.questId, entry.memberIds.length]), [[Q_ANY, 2], [Q_SHARED, 2]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))))
    assert.equal(overview.maps[0].mapId, 'customs')
    assert.equal(overview.maps[0].sharedCount, 1)
    assert.deepEqual(overview.maps.map((entry) => entry.mapId), ['customs', 'woods'])
    assert.deepEqual(overview.anyMap.map((entry) => entry.questId), [Q_ANY])
    assert.deepEqual(overview.items.map((item) => [item.itemId, item.total]), [['flash', 5]])

    const pve = await json<{ squad: SquadView; sharedQuests: unknown[]; maps: unknown }>(await call('GET', `/v1/squads/${squad.id}/overview/pve`, undefined, a))
    assert.deepEqual(pve.squad.members.map((member) => member.nickname), ['AlphaPvE', null, null])
    assert.deepEqual(pve.sharedQuests, [])
    assert.equal(pve.maps, null, 'no PvE catalog on the server: the app groups by map itself')

    const text = JSON.stringify(overview) + JSON.stringify(pve) + JSON.stringify(await json(await call('GET', '/v1/squads/mine/pvp', undefined, c)))
    for (const secret of ['alpha@', 'bravo@', 'charlie@', aId]) assert.ok(!text.includes(secret), `no ${secret} in squad answers`)
  })
})

test('a non-member gets 404 for every route of a squad (IDOR)', async () => {
  await withServer(async ({ call, trial }) => {
    const owner = await trial('owner@example.com')
    const stranger = await trial('stranger@example.com')
    const squad = await createSquad(call, owner)
    const own = await json<{ squad: SquadView }>(await call('GET', '/v1/squads/mine/pvp', undefined, owner))
    const ownerMember = own.squad.members[0].memberId
    const routes: Array<[string, string, unknown?]> = [
      ['GET', `/v1/squads/${squad.id}/overview/pvp`],
      ['POST', `/v1/squads/${squad.id}/invites`],
      ['POST', `/v1/squads/${squad.id}/leave`],
      ['POST', `/v1/squads/${squad.id}/disband`],
      ['POST', `/v1/squads/${squad.id}/kick`, { memberId: ownerMember }],
    ]
    for (const [method, path, body] of routes) {
      const response = await call(method, path, body, stranger)
      assert.equal(response.status, 404, `${method} ${path}`)
      assert.ok(!JSON.stringify(await response.json()).includes('Тройка'))
    }
    // A squad of the stranger's own does not open another squad either; malformed ids are 404 too.
    const other = await createSquad(call, stranger)
    assert.equal((await call('GET', `/v1/squads/${squad.id}/overview/pvp`, undefined, stranger)).status, 404)
    assert.equal((await call('GET', `/v1/squads/${'f'.repeat(32)}/overview/pvp`, undefined, stranger)).status, 404)
    // The owner's squad is intact.
    assert.equal((await call('GET', `/v1/squads/${squad.id}/overview/pvp`, undefined, owner)).status, 200)
    assert.equal((await call('GET', `/v1/squads/${other.id}/overview/pvp`, undefined, owner)).status, 404)
  })
})

test('kick, leave (command passes on), disband and the 5-member limit', async () => {
  await withServer(async ({ call, trial }) => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => trial(`${name}@example.com`)))
    const [a, b, c, d, e, f] = tokens
    const squad = await createSquad(call, a)
    const code = await invite(call, a, squad.id)
    for (const token of [b, c, d, e]) assert.equal((await call('POST', '/v1/squads/join', { code }, token)).status, 200)
    const full = await call('POST', '/v1/squads/join', { code }, f)
    assert.equal(full.status, 409)

    const members = (await json<{ squad: SquadView }>(await call('GET', '/v1/squads/mine/pvp', undefined, a))).squad.members
    assert.equal(members.length, 5)
    // Only the commander kicks, and not himself.
    assert.equal((await call('POST', `/v1/squads/${squad.id}/kick`, { memberId: members[2].memberId }, b)).status, 403)
    assert.equal((await call('POST', `/v1/squads/${squad.id}/kick`, { memberId: members[0].memberId }, a)).status, 400)
    assert.equal((await call('POST', `/v1/squads/${squad.id}/kick`, { memberId: 'nope' }, a)).status, 400)
    assert.equal((await call('POST', `/v1/squads/${squad.id}/kick`, { memberId: members[4].memberId }, a)).status, 204)
    assert.deepEqual(await json(await call('GET', '/v1/squads/mine/pvp', undefined, e)), { squad: null, access: true, invitations: [] })
    assert.equal((await call('GET', `/v1/squads/${squad.id}/overview/pvp`, undefined, e)).status, 404)
    assert.equal((await call('POST', '/v1/squads/join', { code }, f)).status, 200, 'a free place again')

    // The commander leaves: the longest-standing member takes over; the old invite stops working.
    assert.equal((await call('POST', `/v1/squads/${squad.id}/leave`, undefined, a)).status, 204)
    const after = (await json<{ squad: SquadView }>(await call('GET', '/v1/squads/mine/pvp', undefined, b))).squad
    assert.equal(after.isOwner, true)
    assert.equal(after.members.length, 4)
    assert.equal((await call('POST', `/v1/squads/${squad.id}/leave`, undefined, a)).status, 404)
    assert.equal((await call('POST', `/v1/squads/${squad.id}/disband`, undefined, c)).status, 403)
    assert.equal((await call('POST', `/v1/squads/${squad.id}/disband`, undefined, b)).status, 204)
    for (const token of [b, c, d, f]) assert.deepEqual(await json(await call('GET', '/v1/squads/mine/pvp', undefined, token)), { squad: null, access: true, invitations: [] })
  })
})

test('invite codes expire, a new invite replaces the old one, and access ends with the trial', async () => {
  await withServer(async ({ call, trial, clock }) => {
    const a = await trial('a@example.com')
    const b = await trial('b@example.com')
    const c = await trial('c@example.com')
    const squad = await createSquad(call, a)
    const first = await invite(call, a, squad.id)
    const second = await invite(call, a, squad.id)
    assert.notEqual(first, second)
    assert.equal((await call('POST', '/v1/squads/join', { code: first }, b)).status, 404, 'replaced')
    clock.now += SQUAD_INVITE_TTL_MS + 1000
    const expired = await call('POST', '/v1/squads/join', { code: second }, b)
    assert.equal(expired.status, 404)
    assert.equal((await json<{ error: string }>(expired)).error, (await json<{ error: string }>(await call('POST', '/v1/squads/join', { code: 'ZZZZZ-ZZZZZ' }, c))).error, 'expired and unknown codes look the same')
    // After the 3-day trial the overview is a paid feature again; leaving still works.
    clock.now += 3 * 24 * 60 * 60 * 1000
    const paid = await call('GET', `/v1/squads/${squad.id}/overview/pvp`, undefined, a)
    assert.equal(paid.status, 402)
    assert.equal((await json<{ access: boolean }>(await call('GET', '/v1/squads/mine/pvp', undefined, a))).access, false)
    assert.equal((await call('POST', `/v1/squads/${squad.id}/leave`, undefined, a)).status, 204)
  })
})

test('join attempts are rate limited per IP and per account; all squad requests per IP', async () => {
  await withServer(async ({ call, trial }) => {
    const a = await trial('a@example.com')
    const b = await trial('b@example.com')
    for (let i = 0; i < 3; i += 1) assert.equal((await call('POST', '/v1/squads/join', { code: 'ZZZZZ-ZZZZZ' }, a, '203.0.113.5')).status, 404)
    const limited = await call('POST', '/v1/squads/join', { code: 'ZZZZZ-ZZZZZ' }, a, '203.0.113.6')
    assert.equal(limited.status, 429, 'per account, whatever the IP')
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    for (let i = 0; i < 2; i += 1) assert.equal((await call('POST', '/v1/squads/join', { code: 'ZZZZZ-ZZZZZ' }, b, '203.0.113.5')).status, i === 0 ? 404 : 429, 'per IP, whatever the account')
    // Another visitor behind the site proxy has its own buckets.
    assert.equal((await call('POST', '/v1/squads/join', { code: 'ZZZZZ-ZZZZZ' }, b, '198.51.100.7')).status, 404)
    for (let i = 0; i < 6; i += 1) await call('GET', '/v1/squads/mine/pvp', undefined, b, '192.0.2.1')
    assert.equal((await call('GET', '/v1/squads/mine/pvp', undefined, b, '192.0.2.1')).status, 429)
    assert.equal((await call('GET', '/v1/squads/mine/pvp', undefined, undefined, '192.0.2.1')).status, 429, 'counted before the session check')
  }, { joinIp: 4, joinAccount: 3, ip: 6, account: 100 })
})

test('invite code normalization', () => {
  assert.equal(normalizeSquadCode(' abcde-fghjk '), 'ABCDEFGHJK')
  assert.equal(normalizeSquadCode('oooooiiiii'), '0000011111')
  assert.equal(normalizeSquadCode('ABCDE-FGHJU'), null)
  assert.equal(normalizeSquadCode('ABCD'), null)
})
