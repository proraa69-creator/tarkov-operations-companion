import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore, createAccountsHandlers, type AccountView } from '../services/accountStore.js'
import { createLoginCodeHandlers, LOGIN_CODE_TTL_MS, LoginCodeStore, normalizeUserCode } from '../services/loginCodes.js'
import { createApi } from '../app.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'

function setup(limits: Parameters<typeof createLoginCodeHandlers>[2] = {}) {
  let clock = Date.parse('2026-09-30T10:00:00.000Z')
  const now = () => clock
  const store = new AccountStore({ now })
  const accounts = createAccountsHandlers(store, { now })
  const codes = new LoginCodeStore({ now })
  const api = createLoginCodeHandlers(store, codes, { now, ...limits })
  const register = async (email: string) => ((await accounts.register({ ip: 'r', body: { email, password } })).body as { token: string }).token
  return { store, accounts, codes, api, register, advance: (ms: number) => { clock += ms } }
}

const auth = (token: string) => `Bearer ${token}`

test('device hand-off: a signed-in device makes a one-time code, the phone redeems it once for a new session', async () => {
  const { api, accounts, register } = setup()
  const desktop = await register('player@example.com')
  assert.equal((await api.createHandOff({ ip: '1' })).status, 401)
  const created = await api.createHandOff({ ip: '1', authorization: auth(desktop) })
  assert.equal(created.status, 201)
  const { code, expiresAt } = created.body as { code: string; expiresAt: string }
  assert.match(code, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(code, desktop)
  assert.equal(Date.parse(expiresAt), Date.parse('2026-09-30T10:00:00.000Z') + LOGIN_CODE_TTL_MS)

  const redeemed = await api.redeemHandOff({ ip: '2', body: { code } })
  assert.equal(redeemed.status, 200)
  const { token, account } = redeemed.body as { token: string; account: AccountView }
  assert.equal(account.email, 'player@example.com')
  assert.notEqual(token, desktop)
  assert.notEqual(token, code)
  assert.equal((await accounts.me({ authorization: auth(token) })).status, 200)
  // One-time: the same code never works again, and the desktop session is untouched.
  assert.equal((await api.redeemHandOff({ ip: '2', body: { code } })).status, 404)
  assert.equal((await accounts.me({ authorization: auth(desktop) })).status, 200)
  assert.equal((await api.redeemHandOff({ ip: '2', body: { code: 'garbage' } })).status, 404)
})

test('device hand-off codes expire after two minutes', async () => {
  const { api, register, advance } = setup()
  const desktop = await register('player@example.com')
  const { code } = (await api.createHandOff({ ip: '1', authorization: auth(desktop) })).body as { code: string }
  advance(LOGIN_CODE_TTL_MS + 1)
  assert.equal((await api.redeemHandOff({ ip: '2', body: { code } })).status, 404)
})

test('browser QR sign-in: pending until a signed-in device approves, then one session for that browser only', async () => {
  const { api, accounts, register } = setup()
  const phone = await register('player@example.com')
  const opened = await api.createBrowserRequest({ ip: '9', agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140' })
  assert.equal(opened.status, 201)
  const request = opened.body as { requestId: string; pollSecret: string; code: string; expiresAt: string }
  assert.match(request.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  const poll = (body: unknown = { requestId: request.requestId, pollSecret: request.pollSecret }) => api.poll({ ip: '9', body })

  assert.equal((await poll()).status, 202)
  // The approving side must be signed in.
  assert.equal((await api.inspect({ ip: '5', body: { code: request.code } })).status, 401)
  assert.equal((await api.approve({ ip: '5', body: { code: request.code } })).status, 401)
  assert.equal((await api.approve({ ip: '5', authorization: auth('x'.repeat(43)), body: { code: request.code } })).status, 401)

  const inspected = await api.inspect({ ip: '5', authorization: auth(phone), body: { code: request.code.toLowerCase().replace('-', ' ') } })
  assert.equal(inspected.status, 200)
  assert.match((inspected.body as { agent: string }).agent, /Chrome/)
  assert.equal((await poll()).status, 202, 'inspecting does not approve')

  assert.equal((await api.approve({ ip: '5', authorization: auth(phone), body: { code: 'AAAA-AAAA' } })).status, 404)
  assert.equal((await api.approve({ ip: '5', authorization: auth(phone), body: { code: request.code } })).status, 200)
  // A second approval (e.g. another account) cannot take the request over.
  const other = await register('other@example.com')
  assert.equal((await api.approve({ ip: '6', authorization: auth(other), body: { code: request.code } })).status, 404)

  // Knowing the request id is not enough: the poll secret is required.
  assert.equal((await poll({ requestId: request.requestId, pollSecret: 'y'.repeat(43) })).status, 410)
  const done = await poll()
  assert.equal(done.status, 200)
  const { token, account } = done.body as { token: string; account: AccountView }
  assert.equal(account.email, 'player@example.com')
  assert.notEqual(token, phone)
  assert.equal((await accounts.me({ authorization: auth(token) })).status, 200)
  // The session is handed out once.
  assert.equal((await poll()).status, 410)
})

test('browser QR requests expire and cannot be approved late', async () => {
  const { api, register, advance } = setup()
  const phone = await register('player@example.com')
  const request = (await api.createBrowserRequest({ ip: '9' })).body as { requestId: string; pollSecret: string; code: string }
  advance(LOGIN_CODE_TTL_MS + 1)
  assert.equal((await api.inspect({ ip: '5', authorization: auth(phone), body: { code: request.code } })).status, 404)
  assert.equal((await api.approve({ ip: '5', authorization: auth(phone), body: { code: request.code } })).status, 404)
  assert.equal((await api.poll({ ip: '9', body: { requestId: request.requestId, pollSecret: request.pollSecret } })).status, 410)
})

test('QR sign-in endpoints are rate limited', async () => {
  const { api, register } = setup({ limits: { create: 2, redeem: 2, request: 2, poll: 3, approve: 2 } })
  const desktop = await register('player@example.com')
  assert.equal((await api.createHandOff({ ip: '1', authorization: auth(desktop) })).status, 201)
  assert.equal((await api.createHandOff({ ip: '1', authorization: auth(desktop) })).status, 201)
  assert.equal((await api.createHandOff({ ip: '1', authorization: auth(desktop) })).status, 429)
  // Per account too, not only per address.
  assert.equal((await api.createHandOff({ ip: '7', authorization: auth(desktop) })).status, 429)

  for (let attempt = 0; attempt < 2; attempt += 1) assert.equal((await api.redeemHandOff({ ip: '2', body: { code: 'z'.repeat(43) } })).status, 404)
  const limited = await api.redeemHandOff({ ip: '2', body: { code: 'z'.repeat(43) } })
  assert.equal(limited.status, 429)
  assert.ok(limited.headers?.['Retry-After'])

  assert.equal((await api.createBrowserRequest({ ip: '3' })).status, 201)
  assert.equal((await api.createBrowserRequest({ ip: '3' })).status, 201)
  assert.equal((await api.createBrowserRequest({ ip: '3' })).status, 429)

  for (let attempt = 0; attempt < 2; attempt += 1) assert.equal((await api.approve({ ip: '4', authorization: auth(desktop), body: { code: 'AAAA-AAAA' } })).status, 404)
  assert.equal((await api.approve({ ip: '4', authorization: auth(desktop), body: { code: 'AAAA-AAAA' } })).status, 429)
})

test('user codes are normalized strictly', () => {
  assert.equal(normalizeUserCode(' k7qx-m2pd '), 'K7QXM2PD')
  assert.equal(normalizeUserCode('K7QX M2PD'), 'K7QXM2PD')
  assert.equal(normalizeUserCode('K7QX-M2P'), '')
  assert.equal(normalizeUserCode('K7QX-M2P0'), '', '0 is not in the alphabet')
  assert.equal(normalizeUserCode('<script>'), '')
})

test('the QR sign-in routes are mounted on the API', async () => {
  const accounts = new AccountStore()
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, accounts).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/v1/accounts`
  const post = (path: string, body: unknown, token?: string) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  try {
    const { token } = await (await post('/register', { email: 'player@example.com', password })).json() as { token: string }
    const opened = await post('/qr-login', {})
    assert.equal(opened.status, 201)
    assert.equal(opened.headers.get('cache-control'), 'no-store')
    const request = await opened.json() as { requestId: string; pollSecret: string; code: string }
    assert.equal((await post('/qr-login/poll', { requestId: request.requestId, pollSecret: request.pollSecret })).status, 202)
    assert.equal((await post('/me/qr-login/approve', { code: request.code }, token)).status, 200)
    const signedIn = await post('/qr-login/poll', { requestId: request.requestId, pollSecret: request.pollSecret })
    assert.equal(signedIn.status, 200)
    assert.equal(((await signedIn.json()) as { account: AccountView }).account.email, 'player@example.com')

    const handOff = await (await post('/me/login-codes', {}, token)).json() as { code: string }
    const redeemed = await post('/login-codes/redeem', { code: handOff.code })
    assert.equal(redeemed.status, 200)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
})
