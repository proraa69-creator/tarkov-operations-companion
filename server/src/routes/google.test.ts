import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { ProgressStore } from '../services/progressStore.js'
import { createGoogleVerifier, GOOGLE_CLIENT_ID } from '../services/googleSignIn.js'

// «Войти через Google» (owner, 15.11.2026: «для всех стран, кроме России»): the server checks Google's ID token itself.
const google = generateKeyPairSync('rsa', { modulusLength: 2048 })
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...google.publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' }
const keysFetch = (async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=3600' } })) as unknown as typeof fetch

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
function idToken(claims: Record<string, unknown>, key: KeyObject = google.privateKey, kid = 'key-1') {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' })
  const body = b64({ iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT_ID, sub: '1234567890', email_verified: true, iat: now, exp: now + 3600, ...claims })
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`
}

async function withApi(run: (call: (body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>, store: AccountStore, base: string) => Promise<void>) {
  const db = openDatabase(':memory:')
  const store = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, store, { googleVerifier: createGoogleVerifier({ fetcher: keysFetch }) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/accounts`
  const call = async (body: unknown) => {
    const response = await fetch(`${base}/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  try { await run(call, store, base) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

test('a new address asks for the country, then gets an account with the e-mail confirmed; the next time it just signs in', async () => {
  await withApi(async (call) => {
    const credential = idToken({ email: 'Player@Example.com' })
    const first = await call({ credential })
    assert.equal(first.status, 409)
    assert.equal(first.body.needCountry, true)
    const created = await call({ credential, country: 'DE' })
    assert.equal(created.status, 200)
    assert.equal(created.body.created, true)
    const account = created.body.account as { email: string; country?: string; emailVerifiedAt?: string }
    assert.equal(account.email, 'player@example.com')
    assert.equal(account.country, 'DE')
    assert.ok(account.emailVerifiedAt)
    const again = await call({ credential: idToken({ email: 'player@example.com' }) })
    assert.equal(again.status, 200)
    assert.equal(again.body.created, false)
    assert.notEqual(again.body.token, created.body.token)
  })
})

test('an account made with a password signs in with Google too, and its e-mail counts as confirmed', async () => {
  await withApi(async (call, store) => {
    await store.register('fan@example.com', 'long-password-1', undefined, '203.0.113.5', 'FR')
    const signedIn = await call({ credential: idToken({ email: 'fan@example.com' }) })
    assert.equal(signedIn.status, 200)
    assert.ok((signedIn.body.account as { emailVerifiedAt?: string }).emailVerifiedAt)
  })
})

test('Russia is refused: as the country of a new account and for an account of Russia', async () => {
  await withApi(async (call, store) => {
    const fresh = await call({ credential: idToken({ email: 'new@example.com' }), country: 'RU' })
    assert.equal(fresh.status, 403)
    assert.match(String(fresh.body.error), /недоступен для России/)
    await store.register('ru@example.com', 'long-password-1', undefined, '203.0.113.6', 'RU')
    const existing = await call({ credential: idToken({ email: 'ru@example.com' }) })
    assert.equal(existing.status, 403)
  })
})

test('a token that is not Google\'s sign-in for Raid OS is refused, and so is the owner\'s address', async () => {
  await withApi(async (call) => {
    const now = Math.floor(Date.now() / 1000)
    for (const credential of [
      idToken({ email: 'a@example.com', aud: 'another-app.apps.googleusercontent.com' }),
      idToken({ email: 'a@example.com', exp: now - 600 }),
      idToken({ email: 'a@example.com', iss: 'https://evil.example.com' }),
      idToken({ email: 'a@example.com', email_verified: false }),
      idToken({ email: 'a@example.com' }, stranger.privateKey),
      idToken({ email: 'a@example.com' }, google.privateKey, 'unknown-key'),
      'not-a-token',
    ]) {
      const answer = await call({ credential, country: 'DE' })
      assert.equal(answer.status, 401, credential.slice(0, 20))
    }
    const owner = await call({ credential: idToken({ email: 'owner@example.com' }), country: 'DE' })
    assert.equal(owner.status, 403)
  })
})

test('/auth-config names the Google client', async () => {
  await withApi(async (_call, _store, base) => {
    const config = await (await fetch(`${base}/auth-config`)).json() as { googleClientId?: string }
    assert.equal(config.googleClientId, GOOGLE_CLIENT_ID)
  })
})
