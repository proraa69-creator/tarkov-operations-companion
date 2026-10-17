import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
    await post('/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
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

test('server exe manifest: owner only; served only while it describes the exe on disk, with the exe behind a one-time link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'raidos-exe-manifest-'))
  const exe = join(dir, 'RaidOSServer.exe')
  const bytes = Buffer.from('MZ-signed-owner-exe')
  writeFileSync(exe, bytes)
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
  const manifestOf = (token?: string) => fetch(`${origin}/v1/accounts/me/admin/server-exe-manifest`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  // The publisher writes it next to the exe (RaidOSServer.json); the signature is checked by the app, not here.
  const manifest = { edition: 'owner', version: '0.6.1', build: 1792000000000, commit: 'abc-production', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), signature: `${'A'.repeat(86)}==` }
  const publish = (value: unknown) => writeFileSync(join(dir, 'RaidOSServer.json'), JSON.stringify(value))
  try {
    await post('/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
    const login = async (email: string) => ((await (await post('/accounts/login', undefined, { email, password })).json()) as { token: string }).token
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')

    assert.equal((await manifestOf()).status, 401)
    assert.equal((await manifestOf(player)).status, 404)
    assert.equal((await manifestOf(owner)).status, 404, 'nothing published yet: the app falls back to the admin panel')

    publish(manifest)
    const answer = await manifestOf(owner)
    assert.equal(answer.status, 200)
    assert.equal(answer.headers.get('cache-control'), 'no-store')
    assert.match(answer.headers.get('content-type') ?? '', /application\/json/)
    assert.deepEqual(await answer.json(), manifest)
    assert.equal((await manifestOf(player)).status, 404, 'a player never sees it')

    // Another file, another size, another edition or junk: not served.
    for (const wrong of [{ ...manifest, sha256: 'f'.repeat(64) }, { ...manifest, size: bytes.length + 1 }, { ...manifest, edition: 'client' }, { ...manifest, signature: 'x' }, 'junk']) {
      publish(wrong)
      assert.equal((await manifestOf(owner)).status, 404, JSON.stringify(wrong))
    }
    // The exe replaced but its manifest not yet: not served until both match again.
    publish(manifest)
    writeFileSync(exe, Buffer.from('MZ-swapped-owner-ex')) // same size, other bytes
    assert.equal((await manifestOf(owner)).status, 404)
    writeFileSync(exe, bytes)
    assert.equal((await manifestOf(owner)).status, 200)

    // The exe itself: behind the owner's one-time link, as the admin panel gets it.
    const link = await (await post('/accounts/me/admin/server-exe-link', owner)).json() as { url: string; size: number }
    assert.equal(link.size, bytes.length)
    const download = await fetch(`${origin}${link.url}`)
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('content-type'), 'application/vnd.microsoft.portable-executable')
    assert.equal(download.headers.get('content-length'), String(bytes.length))
    assert.equal(download.headers.get('cache-control'), 'no-store')
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
    assert.match(download.headers.get('content-disposition') ?? '', /attachment; filename="Raid OS Server\.exe"/)
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
  } finally {
    delete process.env.RAIDOS_SERVER_EXE
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
