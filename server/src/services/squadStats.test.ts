import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore } from './accountStore.js'
import { AdminStore } from './adminStore.js'
import { openDatabase } from './database.js'
import { PaymentStore } from './paymentStore.js'
import { SquadStore } from './squadStore.js'

/** «Сводка» → «Отряды» (owner, 20.10.2026: «сколько создано, сколько расформировано, сколько сейчас и сколько человек»). */
test('squads: created ever (those of before counted in), disbanded, active now and the players in them', async () => {
  let clock = Date.parse('2026-10-20T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: [] })
  const payments = new PaymentStore(db, undefined, { now, log: () => {} })
  const ids = await Promise.all(['a', 'b', 'c', 'd'].map(async (name) => accounts.authenticate((await accounts.register(`${name}@example.com`, 'correct horse battery')).token)!))
  // A squad of before the log: the first store of this version takes it in.
  db.exec(`CREATE TABLE squads (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL)`)
  db.prepare('INSERT INTO squads (id, name, owner_id, created_at) VALUES (?,?,?,?)').run('0'.repeat(32), 'Старый', ids[3]!, clock - 86_400_000)
  const squads = new SquadStore(db, now)
  const admin = new AdminStore(accounts, payments, { now })
  const first = squads.create(ids[0]!, 'Тройка')
  clock += 1000
  const second = squads.create(ids[1]!, 'Двойка')
  squads.disband(ids[1]!, second.id)
  assert.equal(first.members.length, 1)
  assert.deepEqual(admin.overview().squads, { created: 3, disbanded: 1, active: 2, players: 1, created30: 3, since: new Date(clock - 1000 - 86_400_000).toISOString() })
})
