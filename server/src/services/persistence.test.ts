import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore, createAccountsHandlers, type AccountView } from './accountStore.js'
import { SqliteGoonStore, summarizeGoons } from './goonStore.js'
import { openDatabase } from './database.js'
import { ProgressStore } from './progressStore.js'
import { UserDataStore } from './userDataStore.js'
import { promoteStreamer } from '../cli/promote-streamer.js'

const password = 'correct horse battery'

function withDbFile(run: (path: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), 'tarkov-api-'))
  return Promise.resolve(run(join(dir, 'companion.sqlite'))).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('accounts, sessions, streamer promotion and referral stats survive a store re-open', async () => {
  await withDbFile(async (path) => {
    let db = openDatabase(path)
    let store = new AccountStore({ db })
    let api = createAccountsHandlers(store)
    const streamer = (await api.register({ ip: '1', body: { email: 'streamer@example.com', password } })).body as { token: string }
    db.close()

    // The operator CLI writes to the same file while no store is open.
    assert.equal(promoteStreamer(path, 'streamer@example.com', 'hunter_tv'), 'HUNTER_TV')
    assert.throws(() => promoteStreamer(path, 'missing@example.com', 'CODE'), /not found/)

    db = openDatabase(path)
    store = new AccountStore({ db })
    api = createAccountsHandlers(store)
    const viewer = await api.register({ ip: '2', body: { email: 'viewer@example.com', password, referralCode: 'hunter_tv' } })
    assert.equal((viewer.body as { referralApplied: boolean }).referralApplied, true)
    assert.equal((await api.referralVisit({ ip: '9', body: { code: 'HUNTER_TV' } })).status, 200)
    await api.setNicknames({ authorization: `Bearer ${(viewer.body as { token: string }).token}`, body: { pve: 'Viewer_1' } })
    db.close()

    db = openDatabase(path)
    store = new AccountStore({ db })
    api = createAccountsHandlers(store)
    // A session issued before the restart is still valid.
    const me = await api.me({ authorization: `Bearer ${streamer.token}` })
    assert.equal(me.status, 200)
    const view = me.body as AccountView
    assert.equal(view.kind, 'streamer')
    assert.equal(view.referralCode, 'HUNTER_TV')
    assert.deepEqual({ visits: view.stats?.visits, registrations: view.stats?.registrations }, { visits: 1, registrations: 1 })
    // Same visitor within 24 h stays deduplicated after the restart.
    await api.referralVisit({ ip: '9', body: { code: 'HUNTER_TV' } })
    assert.equal(((await api.me({ authorization: `Bearer ${streamer.token}` })).body as AccountView).stats?.visits, 1)
    const login = await api.login({ ip: '3', body: { email: 'viewer@example.com', password } })
    assert.equal(login.status, 200)
    const viewerView = (login.body as { account: AccountView }).account
    assert.equal(viewerView.referredBy, 'HUNTER_TV')
    // Saved by a build from before the one nickname (one mode): it is the nickname of every mode after the restart.
    assert.equal(viewerView.nickname, 'Viewer_1')
    assert.deepEqual(viewerView.nicknames, { pvp: 'Viewer_1', pve: 'Viewer_1', seasonal: 'Viewer_1' })
    assert.equal((await api.register({ ip: '4', body: { email: 'VIEWER@example.com', password } })).status, 409)
    // Logout revokes the persisted session.
    await api.logout({ authorization: `Bearer ${streamer.token}` })
    db.close()
    db = openDatabase(path)
    store = new AccountStore({ db })
    assert.equal(store.authenticate(streamer.token), undefined)
    db.close()
  })
})

test('goon sightings, quest progress and user data survive a re-open, modes stay apart', async () => {
  await withDbFile((path) => {
    const now = Date.parse('2026-09-28T10:00:00.000Z')
    let db = openDatabase(path)
    let goons = new SqliteGoonStore(db)
    goons.add({ mapId: 'woods', mode: 'pvp', reportedAt: new Date(now - 60_000).toISOString(), reporter: 'a' })
    goons.add({ mapId: 'customs', mode: 'pvp', reportedAt: new Date(now).toISOString(), reporter: 'b' })
    goons.add({ mapId: 'lighthouse', mode: 'pve', reportedAt: new Date(now).toISOString(), reporter: 'a' })
    const progress = new ProgressStore(db)
    progress.syncUser('user:1', 'pvp', { accountId: 5, characterId: '0123456789abcdef01234567', events: [{ taskId: '5936d90786f7742b1420ba5b', status: 'completed', timestamp: '2026-09-25T12:00:00.000Z' }] })
    const data = new UserDataStore(db)
    data.setCollector('1', 'pve', ['a', 'b', 'a'])
    data.setPosition('1', 'seasonal', { x: 1, y: 2, z: 3, yaw: 90, at: now, map: 'woods' })
    data.setSettings('1', { theme: 'steel' })
    db.close()

    db = openDatabase(path)
    goons = new SqliteGoonStore(db)
    const pvp = summarizeGoons(goons, 'pvp', now)
    assert.deepEqual(pvp.latest, { mapId: 'customs', reportedAt: new Date(now).toISOString() })
    assert.equal(pvp.last5h.length, 2)
    assert.equal(summarizeGoons(goons, 'pve', now).last5h[0].mapId, 'lighthouse')
    assert.equal(goons.lastByReporter('a')?.mode, 'pve')
    assert.equal(goons.lastByReporterOnMap('a', 'pvp', 'woods')?.mapId, 'woods')
    goons.prune(now - 30_000)
    assert.equal(summarizeGoons(goons, 'pvp', now).last5h.length, 1)

    const reopened = new ProgressStore(db)
    assert.equal(reopened.userRecords('user:1', 'pvp').records.length, 1)
    assert.equal(reopened.userRecords('user:1', 'pve').records.length, 0)
    assert.equal(reopened.userRecords('user:2', 'pvp').records.length, 0)
    const store = new UserDataStore(db)
    assert.deepEqual(store.getCollector('1', 'pve').itemIds, ['a', 'b'])
    assert.deepEqual(store.getCollector('1', 'pvp').itemIds, [])
    assert.equal(store.getPosition('1', 'seasonal')?.map, 'woods')
    assert.equal(store.getPosition('1', 'pvp'), null)
    assert.deepEqual(store.getSettings('1').settings, { theme: 'steel' })
    db.close()
  })
})
