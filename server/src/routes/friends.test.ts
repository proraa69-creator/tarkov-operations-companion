import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { normalizeFriendCode } from '../services/friendStore.js'
import { sanitizeObjectives } from '../services/sharedProgress.js'
import type { AppDataset } from '../models/api.js'
import type { FriendsRouterOptions } from './friends.js'

const password = 'correct horse battery'
const CHARACTER = '0123456789abcdef01234567'
const Q_A = '5936d90786f7742b1420ba5b'
const Q_B = '5936d90786f7742b1420ba5c'

const catalog = {
  quests: [
    { id: Q_A, name: 'A', mapId: 'customs', raidRequirements: [{ itemId: 'flash', count: 2, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'obj-a' }] },
    { id: Q_B, name: 'B', mapId: 'woods', requiredItems: ['axe'] },
  ],
  items: [], maps: [], markers: [], hideout: [], traders: [],
} as unknown as AppDataset

type Call = (method: string, path: string, body?: unknown, token?: string, ip?: string) => Promise<Response>
interface Ctx { call: Call; accounts: AccountStore; progress: ProgressStore; trial: (email: string) => Promise<string>; user: (email: string) => Promise<string> }

async function withServer(run: (ctx: Ctx) => Promise<void>, friendLimits?: FriendsRouterOptions['limits']) {
  const progress = new ProgressStore(':memory:')
  const accounts = new AccountStore()
  await accounts.register('streamer@example.com', password)
  accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  const server = createApi(progress, undefined, accounts, { catalog: (mode) => (mode === 'pvp' ? catalog : undefined), friendLimits }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call: Call = (method, path, body, token, ip) => fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  try {
    await run({
      call, accounts, progress,
      trial: async (email) => (await accounts.register(email, password, 'HUNTER')).token,
      user: async (email) => (await accounts.register(email, password)).token,
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    progress.close()
    accounts.close()
  }
}

const json = async <T>(response: Response) => (await response.json()) as T
interface Overview {
  code: string; access: boolean
  friends: Array<{ friendId: string; nicknames: Record<string, string>; hideMyProgress: boolean; sharesProgress: boolean }>
  incoming: Array<{ requestId: string; friendId: string; nicknames: Record<string, string> }>
  outgoing: Array<{ requestId: string; label: string }>
  blocked: Array<{ friendId: string }>
}
const overview = async (call: Call, token: string) => json<Overview>(await call('GET', '/v1/friends', undefined, token))
interface Person { id: string; nickname: string | null; hidden: boolean; activeQuestIds: string[]; completedCount: number; objectives: Record<string, unknown[]> }

/** a and b become friends through a's code; returns their public ids as seen by each other. */
async function befriend(call: Call, a: string, b: string) {
  const { code } = await overview(call, a)
  assert.deepEqual(await json(await call('POST', '/v1/friends/requests', { code }, b)), { status: 'sent' })
  const incoming = (await overview(call, a)).incoming
  assert.equal(incoming.length, 1)
  assert.equal((await call('POST', `/v1/friends/requests/${incoming[0].requestId}/accept`, undefined, a)).status, 204)
  return { bAsSeenByA: (await overview(call, a)).friends[0].friendId, aAsSeenByB: (await overview(call, b)).friends[0].friendId }
}

function activate(progress: ProgressStore, accounts: AccountStore, token: string, mode: 'pvp' | 'pve', ids: string[], extra: Record<string, unknown> = {}) {
  progress.syncUser(`user:${accounts.authenticate(token)!}`, mode, { accountId: 1, characterId: CHARACTER, events: ids.map((taskId) => ({ taskId, status: 'active' as const, timestamp: '2026-10-01T09:00:00.000Z', ...extra })) })
}

test('friend requests by code: accept, decline, cancel; no e-mails; self and malformed codes refused', async () => {
  await withServer(async ({ call, trial, accounts }) => {
    assert.equal((await call('GET', '/v1/friends')).status, 401)
    const a = await trial('alpha@example.com')
    const b = await trial('bravo@example.com')
    const c = await trial('charlie@example.com')
    accounts.setNicknames(accounts.authenticate(a)!, { pvp: 'AlphaPvP' })
    const mine = await overview(call, a)
    assert.match(mine.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    assert.equal((await call('POST', '/v1/friends/requests', { code: mine.code }, a)).status, 400, 'own code')
    assert.equal((await call('POST', '/v1/friends/requests', { code: 'nope' }, b)).status, 400)
    const { bAsSeenByA, aAsSeenByB } = await befriend(call, a, b)
    assert.match(bAsSeenByA, /^[a-f0-9]{24}$/)
    const seen = await overview(call, b)
    assert.deepEqual(seen.friends[0].nicknames, { pvp: 'AlphaPvP' })
    assert.equal(seen.friends[0].friendId, aAsSeenByB)
    // Asking again: already friends.
    assert.deepEqual(await json(await call('POST', '/v1/friends/requests', { code: mine.code }, b)), { status: 'friends' })

    // Decline and cancel.
    const cCode = (await overview(call, c)).code
    await call('POST', '/v1/friends/requests', { code: cCode }, a)
    const out = (await overview(call, a)).outgoing
    assert.deepEqual(out.map((entry) => entry.label), [cCode])
    const declined = (await overview(call, c)).incoming[0]
    assert.equal((await call('POST', `/v1/friends/requests/${declined.requestId}/accept`, undefined, b)).status, 404, 'somebody else cannot answer it')
    assert.equal((await call('POST', `/v1/friends/requests/${declined.requestId}/cancel`, undefined, c)).status, 404, 'the receiver cannot cancel it')
    assert.equal((await call('POST', `/v1/friends/requests/${declined.requestId}/decline`, undefined, c)).status, 204)
    assert.equal((await overview(call, a)).outgoing.length, 0)
    await call('POST', '/v1/friends/requests', { code: cCode }, a)
    const pending = (await overview(call, a)).outgoing[0]
    assert.equal((await call('POST', `/v1/friends/requests/${pending.requestId}/cancel`, undefined, a)).status, 204)
    assert.equal((await overview(call, c)).incoming.length, 0)
    // Mutual requests make friends at once.
    await call('POST', '/v1/friends/requests', { code: cCode }, a)
    assert.deepEqual(await json(await call('POST', '/v1/friends/requests', { code: mine.code }, c)), { status: 'friends' })

    const text = JSON.stringify([await overview(call, a), await overview(call, b), await overview(call, c)])
    for (const secret of ['alpha@', 'bravo@', 'charlie@', accounts.authenticate(a)!, accounts.authenticate(b)!]) assert.ok(!text.includes(secret), `no ${secret}`)
  })
})

test('adding by nickname answers the same for unknown nicknames and blocked senders', async () => {
  await withServer(async ({ call, trial, accounts }) => {
    const a = await trial('a@example.com')
    const b = await trial('b@example.com')
    accounts.setNicknames(accounts.authenticate(b)!, { pve: 'BravoPvE' })
    const unknown = await json(await call('POST', '/v1/friends/requests', { mode: 'pve', nickname: 'Nobody_123' }, a))
    const known = await json(await call('POST', '/v1/friends/requests', { mode: 'pve', nickname: 'bravopve' }, a))
    assert.deepEqual(unknown, known)
    assert.deepEqual((await overview(call, a)).outgoing.map((entry) => entry.label).sort(), ['Nobody_123', 'bravopve'])
    // The PvP nickname is a different binding: no match there.
    const incoming = (await overview(call, b)).incoming
    assert.equal(incoming.length, 1)
    // b blocks a: the friendship never happens and a's next request is kept undelivered.
    assert.equal((await call('POST', `/v1/friends/${incoming[0].friendId}/block`, undefined, b)).status, 204)
    assert.equal((await overview(call, b)).blocked.length, 1)
    assert.deepEqual(await json(await call('POST', '/v1/friends/requests', { code: (await overview(call, b)).code }, a)), { status: 'sent' })
    assert.equal((await overview(call, b)).incoming.length, 0)
    assert.equal((await call('POST', `/v1/friends/${incoming[0].friendId}/unblock`, undefined, b)).status, 204)
    assert.equal((await call('POST', `/v1/friends/${incoming[0].friendId}/unblock`, undefined, b)).status, 404)
    assert.equal((await call('POST', '/v1/friends/requests', { mode: 'pve', nickname: 'x' }, a)).status, 400)
  })
})

test('a non-friend gets 404 for progress, privacy, remove and squad invitations (IDOR)', async () => {
  await withServer(async ({ call, trial }) => {
    const a = await trial('a@example.com')
    const b = await trial('b@example.com')
    const stranger = await trial('s@example.com')
    const { bAsSeenByA } = await befriend(call, a, b)
    for (const [method, path, body] of [
      ['POST', '/v1/friends/progress/pvp', { friendIds: [bAsSeenByA] }],
      ['PUT', `/v1/friends/${bAsSeenByA}/privacy`, { hideProgress: true }],
      ['POST', `/v1/friends/${bAsSeenByA}/remove`, undefined],
      ['POST', `/v1/friends/${bAsSeenByA}/block`, undefined],
      ['POST', `/v1/friends/${'0'.repeat(24)}/remove`, undefined],
    ] as Array<[string, string, unknown]>) {
      assert.equal((await call(method, path, body, stranger)).status, 404, `${method} ${path}`)
    }
    // The stranger's own squad cannot invite somebody who is not his friend.
    const squad = (await json<{ squad: { id: string } }>(await call('POST', '/v1/squads', {}, stranger))).squad
    assert.equal((await call('POST', `/v1/squads/${squad.id}/invite-friend`, { friendId: bAsSeenByA }, stranger)).status, 404)
    // The friendship still works for its members.
    assert.equal((await call('POST', '/v1/friends/progress/pvp', { friendIds: [bAsSeenByA] }, a)).status, 200)
    assert.equal((await call('POST', `/v1/friends/${bAsSeenByA}/remove`, undefined, a)).status, 204)
    assert.equal((await call('POST', '/v1/friends/progress/pvp', { friendIds: [bAsSeenByA] }, a)).status, 404, 'removed')
  })
})

test('privacy toggle hides progress from that friend everywhere: progress, needs and the squad overview', async () => {
  await withServer(async ({ call, trial, accounts, progress }) => {
    const a = await trial('a@example.com')
    const b = await trial('b@example.com')
    const { bAsSeenByA, aAsSeenByB } = await befriend(call, a, b)
    accounts.setNicknames(accounts.authenticate(b)!, { pvp: 'BravoPvP', pve: 'BravoPvE' })
    activate(progress, accounts, b, 'pvp', [Q_A, Q_B])
    activate(progress, accounts, b, 'pve', [Q_B])

    const people = (await json<{ people: Person[] }>(await call('POST', '/v1/friends/progress/pvp', { friendIds: [bAsSeenByA] }, a))).people
    assert.equal(people[0].id, 'me')
    assert.deepEqual(people[1], { id: bAsSeenByA, nickname: 'BravoPvP', hidden: false, activeQuestIds: [Q_A, Q_B], objectives: {}, completedCount: 0, lastSyncAt: (people[1] as unknown as { lastSyncAt: string }).lastSyncAt })
    const pve = (await json<{ people: Person[] }>(await call('POST', '/v1/friends/progress/pve', { friendIds: [bAsSeenByA] }, a))).people
    assert.deepEqual([pve[1].nickname, pve[1].activeQuestIds], ['BravoPvE', [Q_B]], 'modes stay separate')
    assert.deepEqual(await json(await call('GET', '/v1/friends/needs/pvp', undefined, a)), { mode: 'pvp', itemIds: ['axe', 'flash'], questIds: [Q_A, Q_B] })
    assert.deepEqual(await json(await call('GET', '/v1/friends/needs/pve', undefined, a)), { mode: 'pve', itemIds: null, questIds: [Q_B] }, 'no PvE catalog on the server')

    // Both in one squad (through a friend invitation).
    const squad = (await json<{ squad: { id: string } }>(await call('POST', '/v1/squads', {}, a))).squad
    assert.equal((await call('POST', `/v1/squads/${squad.id}/invite-friend`, { friendId: bAsSeenByA }, a)).status, 204)
    const invitations = (await json<{ invitations: Array<{ invitationId: string; squadName: string }> }>(await call('GET', '/v1/squads/mine/pvp', undefined, b))).invitations
    assert.equal(invitations.length, 1)
    assert.equal((await call('POST', `/v1/squads/invitations/${invitations[0].invitationId}/accept`, undefined, a)).status, 404, 'only the invited friend answers')
    assert.equal((await call('POST', `/v1/squads/invitations/${invitations[0].invitationId}/accept`, undefined, b)).status, 200)
    assert.equal((await call('POST', `/v1/squads/invitations/${invitations[0].invitationId}/accept`, undefined, b)).status, 404, 'used')
    const before = await json<{ squad: { members: Array<{ hidden: boolean; activeQuestIds: string[] }> } }>(await call('GET', `/v1/squads/${squad.id}/overview/pvp`, undefined, a))
    assert.deepEqual(before.squad.members[1].activeQuestIds, [Q_A, Q_B])

    // b hides his progress from a.
    assert.equal((await call('PUT', `/v1/friends/${aAsSeenByB}/privacy`, { hideProgress: true }, b)).status, 204)
    assert.equal((await overview(call, b)).friends[0].hideMyProgress, true)
    assert.equal((await overview(call, a)).friends[0].sharesProgress, false)
    const hidden = (await json<{ people: Person[] }>(await call('POST', '/v1/friends/progress/pvp', { friendIds: [bAsSeenByA] }, a))).people[1]
    assert.deepEqual([hidden.hidden, hidden.activeQuestIds, hidden.completedCount], [true, [], 0])
    assert.deepEqual(await json(await call('GET', '/v1/friends/needs/pvp', undefined, a)), { mode: 'pvp', itemIds: [], questIds: [] })
    const after = await json<{ squad: { members: Array<{ hidden: boolean; activeQuestIds: string[] }> } }>(await call('GET', `/v1/squads/${squad.id}/overview/pvp`, undefined, a))
    assert.deepEqual([after.squad.members[1].hidden, after.squad.members[1].activeQuestIds], [true, []])
    // b still sees a (a did not hide anything).
    const reverse = (await json<{ people: Person[] }>(await call('POST', '/v1/friends/progress/pvp', { friendIds: [aAsSeenByB] }, b))).people[1]
    assert.equal(reverse.hidden, false)
  })
})

test('objective-level progress is shared when the records carry it, and finished objectives are not needed', async () => {
  await withServer(async ({ call, trial, accounts, progress }) => {
    const a = await trial('a@example.com')
    const b = await trial('b@example.com')
    const { bAsSeenByA } = await befriend(call, a, b)
    activate(progress, accounts, b, 'pvp', [Q_A])
    // Simulate the objective-level model (feat-quest-sync) adding `objectives` to records.
    const original = progress.userRecords.bind(progress)
    progress.userRecords = (owner, mode) => {
      const result = original(owner, mode)
      return { ...result, records: result.records.map((record) => ({ ...record, objectives: [{ objectiveId: 'obj-a', count: 2, target: 2 }, { objectiveId: '<bad>', count: 1 }] })) }
    }
    const person = (await json<{ people: Person[] }>(await call('POST', '/v1/friends/progress/pvp', { friendIds: [bAsSeenByA] }, a))).people[1]
    assert.deepEqual(person.objectives, { [Q_A]: [{ objectiveId: 'obj-a', count: 2, target: 2 }] })
    assert.deepEqual((await json<{ itemIds: string[] }>(await call('GET', '/v1/friends/needs/pvp', undefined, a))).itemIds, [], 'the hand-over is done')
  })
})

test('friends are a paid feature for sending requests and seeing progress; answering and safety actions stay free', async () => {
  await withServer(async ({ call, trial, user }) => {
    const paid = await trial('paid@example.com')
    const free = await user('free@example.com')
    assert.equal((await overview(call, free)).access, false)
    assert.equal((await call('POST', '/v1/friends/requests', { code: (await overview(call, paid)).code }, free)).status, 402)
    assert.equal((await call('GET', '/v1/friends/needs/pvp', undefined, free)).status, 402)
    assert.equal((await call('POST', '/v1/friends/progress/pvp', { friendIds: [] }, free)).status, 402)
    await call('POST', '/v1/friends/requests', { code: (await overview(call, free)).code }, paid)
    const request = (await overview(call, free)).incoming[0]
    assert.equal((await call('POST', `/v1/friends/requests/${request.requestId}/accept`, undefined, free)).status, 204)
    const friendId = (await overview(call, free)).friends[0].friendId
    assert.equal((await call('PUT', `/v1/friends/${friendId}/privacy`, { hideProgress: true }, free)).status, 204)
    assert.equal((await call('POST', `/v1/friends/${friendId}/block`, undefined, free)).status, 204)
  })
})

test('friend requests are rate limited per account and per IP; a new code retires the old one', async () => {
  await withServer(async ({ call, trial }) => {
    const a = await trial('a@example.com')
    const b = await trial('b@example.com')
    const c = await trial('c@example.com')
    for (let i = 0; i < 3; i += 1) assert.equal((await call('POST', '/v1/friends/requests', { code: `ZZZZ-ZZZ${i}` }, a, '203.0.113.1')).status, 200)
    assert.equal((await call('POST', '/v1/friends/requests', { code: 'ZZZZ-ZZZY' }, a, '203.0.113.2')).status, 429, 'per account')
    assert.equal((await call('POST', '/v1/friends/requests', { code: 'ZZZZ-ZZZY' }, b, '203.0.113.1')).status, 200)
    assert.equal((await call('POST', '/v1/friends/requests', { code: 'ZZZZ-ZZZX' }, b, '203.0.113.1')).status, 429, 'per IP')
    const old = (await overview(call, c)).code
    const fresh = (await json<{ code: string }>(await call('POST', '/v1/friends/code', undefined, c))).code
    assert.notEqual(old, fresh)
    await call('POST', '/v1/friends/requests', { code: old }, b, '198.51.100.9')
    assert.equal((await overview(call, c)).incoming.length, 0, 'the old code no longer reaches c')
  }, { requestsAccount: 3, requestsIp: 4 })
})

test('friend code normalization and objective sanitizing', () => {
  assert.equal(normalizeFriendCode(' 7kq2-m9xd '), '7KQ2M9XD')
  assert.equal(normalizeFriendCode('7KQ2-M9XU'), null)
  assert.deepEqual(sanitizeObjectives([{ objectiveId: 'x', count: -1, target: 3, completed: true }, { id: 'y', status: 'completed' }, null, 'z']), [{ objectiveId: 'x', target: 3, done: true }, { objectiveId: 'y', done: true }])
})
