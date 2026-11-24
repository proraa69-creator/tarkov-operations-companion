import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore } from './accountStore.js'
import { AdminStore } from './adminStore.js'
import { openDatabase } from './database.js'
import { PaymentStore } from './paymentStore.js'
import { SquadStore } from './squadStore.js'

/**
 * «Сводка» → «Отряды» (owner, 20.10.2026: «сколько создано, сколько расформировано, сколько сейчас и сколько человек»), only squads
 * of two or more (owner, 15.11.2026: «не бери в нее больше отряды, в которых был только один человек»).
 */
test('squads: only squads of two or more — created ever (those of before counted in), disbanded, active now and the players in them', async () => {
  let clock = Date.parse('2026-10-20T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: [] })
  const payments = new PaymentStore(db, undefined, { now, log: () => {} })
  const ids = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(async (name) => accounts.authenticate((await accounts.register(`${name}@example.com`, 'correct horse battery')).token)!))
  // Squads of before the log: a pair is taken in, a lone player is not.
  db.exec(`CREATE TABLE squads (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE squad_members (account_id TEXT PRIMARY KEY, squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE, member_id TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL)`)
  const old = (id: string, owner: string, members: string[]) => {
    db.prepare('INSERT INTO squads (id, name, owner_id, created_at) VALUES (?,?,?,?)').run(id, 'Старый', owner, clock - 86_400_000)
    members.forEach((member, index) => db.prepare('INSERT INTO squad_members (account_id, squad_id, member_id, joined_at) VALUES (?,?,?,?)').run(member, id, `${id.slice(0, 8)}${index}`, clock - 86_400_000))
  }
  old('0'.repeat(32), ids[3]!, [ids[3]!, ids[4]!])
  old('1'.repeat(32), ids[5]!, [ids[5]!])
  const squads = new SquadStore(db, now)
  const admin = new AdminStore(accounts, payments, { now })
  // alone: not counted
  const pair = squads.create(ids[0]!, 'Пара')
  const solo = squads.create(ids[1]!, 'Один')
  squads.disband(ids[1]!, solo.id)
  assert.equal(admin.overview().squads?.created, 1)
  // a second member: counted from then on, and still after the squad is gone
  clock += 1000
  squads.inviteAccount(ids[0]!, pair.id, ids[2]!)
  squads.answerInvitation(ids[2]!, squads.invitationsFor(ids[2]!)[0]!.id, true)
  assert.deepEqual(admin.overview().squads, { created: 2, disbanded: 0, active: 2, players: 4, created30: 2, since: new Date(clock - 1000 - 86_400_000).toISOString() })
  squads.disband(ids[0]!, pair.id)
  assert.deepEqual(admin.overview().squads, { created: 2, disbanded: 1, active: 1, players: 2, created30: 2, since: new Date(clock - 1000 - 86_400_000).toISOString() })
})
