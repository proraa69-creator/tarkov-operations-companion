import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'

test('server exe: only the owner gets a one-time link; it serves the file a few times, then it is gone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'raidos-exe-'))
  const exe = join(dir, 'Tarkov Operator Server.exe')
  writeFileSync(exe, Buffer.from('MZ-fake-server-exe'))
  process.env.RAIDOS_SERVER_EXE = exe
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = async (path: string, token?: string, body?: unknown) => fetch(`${origin}/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) })
  try {
    await post('/accounts/register', undefined, { email: 'player@example.com', password })
    const login = async (email: string) => ((await (await post('/accounts/login', undefined, { email, password })).json()) as { token: string }).token
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')

    assert.equal((await post('/accounts/me/admin/server-exe-link')).status, 401)
    assert.equal((await post('/accounts/me/admin/server-exe-link', player)).status, 404)
    const answer = await post('/accounts/me/admin/server-exe-link', owner)
    assert.equal(answer.status, 200)
    const link = await answer.json() as { url: string; size: number; name: string }
    assert.match(link.url, /^\/v1\/server-exe\/[a-f0-9]{48}$/)
    assert.equal(link.size, 18)

    for (let i = 0; i < 3; i++) {
      const download = await fetch(`${origin}${link.url}`)
      assert.equal(download.status, 200)
      assert.match(download.headers.get('content-disposition') ?? '', /attachment; filename="Raid OS Server\.exe"/)
      assert.equal(await download.text(), 'MZ-fake-server-exe')
    }
    assert.equal((await fetch(`${origin}${link.url}`)).status, 404, 'three downloads, then the link is used up')
    assert.equal((await fetch(`${origin}/v1/server-exe/${'0'.repeat(48)}`)).status, 404)

    const audit = await fetch(`${origin}/v1/accounts/me/admin/audit`, { headers: { authorization: `Bearer ${owner}` } })
    assert.ok(((await audit.json()) as { entries: Array<{ action: string }> }).entries.some((entry) => entry.action === 'server.download-link'))
  } finally {
    delete process.env.RAIDOS_SERVER_EXE
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
