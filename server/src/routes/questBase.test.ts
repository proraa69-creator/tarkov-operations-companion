import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { ProgressStore } from '../services/progressStore.js'
import { QuestBase, type QuestBaseReport } from '../services/questBase.js'

const password = 'correct horse battery'

const catalog = (mode: RaidMode, name: string) => ({
  maps: [{ id: 'customs', name: 'Таможня' }], markers: [], hideout: [], traders: [],
  quests: [{ id: 'q1', name, trader: 'Прапор', mapIds: [], level: 1, kappa: true, description: '', objectives: [], rewards: [] }],
  items: [{ id: 'gas', name: 'Газоанализатор', shortName: 'Газ', category: 'Бартер', description: '', prices: [] }],
  metadata: { source: 'json.tarkov.dev', mode, loadedAt: new Date().toISOString(), counts: {} },
}) as unknown as AppDataset

test('quest base report: owner only — 401 without a session, 404 for a player, versions and changes for the owner', async (t) => {
  const questBase = new QuestBase({ load: async (mode, locale) => catalog(mode, locale === 'ru' ? 'Дефицит' : 'Shortage'), log: () => undefined })
  t.after(() => questBase.stop())
  for (const mode of ['pvp', 'pve', 'seasonal'] as const) await questBase.snapshot(mode)
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { questBase }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const login = async (email: string) => ((await (await fetch(`${base}/accounts/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()) as { token: string }).token
  await fetch(`${base}/accounts/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'player@example.com', password, country: 'RU' }) })
  const report = (token?: string) => fetch(`${base}/accounts/me/admin/quest-base`, { headers: token ? { authorization: `Bearer ${token}` } : {} })

  const anonymous = await report()
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.headers.get('cache-control'), 'no-store')
  assert.equal((await report('not-a-session')).status, 401)
  const player = await report(await login('player@example.com'))
  assert.equal(player.status, 404, 'a player does not even learn that the route exists')
  assert.deepEqual(await player.json(), { error: 'Не найдено' })

  const owner = await report(await login('owner@example.com'))
  assert.equal(owner.status, 200)
  assert.equal(owner.headers.get('cache-control'), 'no-store')
  const body = await owner.json() as QuestBaseReport
  assert.equal(body.periodMinutes, 30)
  assert.deepEqual(Object.keys(body.modes), ['pvp', 'pve', 'seasonal'])
  assert.equal(body.modes.pvp.version, questBase.version('pvp'))
  assert.equal(body.modes.pvp.counts.quests, 1)
  assert.equal(body.modes.pvp.counts.bothTitles, 1)
  assert.equal(body.modes.pvp.counts.kappa, 1)
  assert.deepEqual(body.modes.pvp.changes, { since: null, added: [], removed: [], renamed: [] })
  assert.equal(body.modes.pvp.state.failures, 0)
  assert.equal(typeof body.modes.pvp.sources?.story.seeds, 'string')
})
