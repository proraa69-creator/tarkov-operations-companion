// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApi } from '../server/src/app'
import { ProgressStore } from '../server/src/services/progressStore'
import { forwardedPath, proxyToApi, siteRoute, visitorAddress } from './siteProxy'

/**
 * The real API (server/src/app.ts) behind the website server's proxy (electron/localServer.ts), as on the server
 * laptop: the browser on raidos.app/login talks to the site (5202), which forwards /v1/* to the API (8787).
 */
describe('site proxy → API: QR sign-in through the website address', () => {
  let api: Server
  let site: Server
  let store: ProgressStore
  let base = ''

  beforeAll(async () => {
    store = new ProgressStore(':memory:')
    api = createApi(store).listen(0, '127.0.0.1')
    await new Promise((resolve) => api.once('listening', resolve))
    const apiPort = (api.address() as AddressInfo).port
    site = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://x').pathname
      const route = siteRoute(path)
      if (route === 'blocked') { response.writeHead(404); response.end(); return }
      if (route === 'api') { proxyToApi(request, response, apiPort); return }
      response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html>')
    }).listen(0, '127.0.0.1')
    await new Promise((resolve) => site.once('listening', resolve))
    base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    await new Promise((resolve) => site.close(resolve))
    await new Promise((resolve) => api.close(resolve))
    store.close()
  })

  const post = (path: string, body: unknown, token?: string) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  })

  it('health, QR request, approval by a signed-in device and the browser session all work through the proxy', async () => {
    const health = await (await fetch(`${base}/health`)).json() as { ok: boolean; database: boolean; service: string }
    expect(health).toMatchObject({ ok: true, database: true, service: 'tarkov-operations-api' })
    // Through the site (and so the public link) the API's version, build and flags stay hidden.
    expect(Object.keys(health).sort()).toEqual(['database', 'ok', 'service'])

    const registered = await post('/v1/accounts/register', { email: 'owner@example.com', password: 'correct horse battery' })
    expect(registered.status).toBe(201)
    const phone = (await registered.json() as { token: string }).token

    // As cloudflared delivers it: Cloudflare's own CF-Connecting-IP / CF-IPCountry (a client-sent X-Forwarded-For is dropped).
    const opened = await fetch(`${base}/v1/accounts/qr-login`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', 'cf-ipcountry': 'NL', 'x-forwarded-for': '1.2.3.4' }, body: '{}' })
    expect(opened.status).toBe(201)
    const request = await opened.json() as { requestId: string; pollSecret: string; code: string }
    expect((await post('/v1/accounts/qr-login/poll', { requestId: request.requestId, pollSecret: request.pollSecret })).status).toBe(202)

    const inspected = await post('/v1/accounts/me/qr-login/inspect', { code: request.code }, phone)
    expect(inspected.status).toBe(200)
    // The approving person sees where the request came from, approximately.
    expect(await inspected.json()).toMatchObject({ ip: '203.0.113.x', country: 'NL' })
    expect((await post('/v1/accounts/me/qr-login/approve', { code: request.code }, phone)).status).toBe(200)
    const done = await post('/v1/accounts/qr-login/poll', { requestId: request.requestId, pollSecret: request.pollSecret })
    expect(done.status).toBe(200)
    const session = await done.json() as { token: string; account: { email: string } }
    expect(session.account.email).toBe('owner@example.com')
    expect(session.token).not.toBe(phone)
  })

  it('the owner admin API is never reachable through the site', async () => {
    expect((await fetch(`${base}/v1/admin/accounts`)).status).toBe(404)
    expect(siteRoute('//v1//admin/accounts')).toBe('blocked')
    expect(siteRoute('/V1/Admin')).toBe('blocked')
    // A protocol-relative request path is parsed as another host and gets the site page, never the API.
    const odd = await fetch(`${base}//v1//admin`)
    expect(odd.headers.get('content-type')).toContain('text/html')
  })

  it('forwards the decided (decoded) path, so %-encoding cannot sneak /v1/admin past the block', async () => {
    // The test site decides on the raw pathname here; the proxy decodes it as localServer.ts does and refuses.
    expect((await fetch(`${base}/v1/%61dmin/streamers`)).status).toBe(404)
    // Real paths and their query strings arrive unchanged.
    expect((await fetch(`${base}/v1/accounts/auth-config?x=1%262`)).status).toBe(200)
  })

  it('passes Sec-Fetch-* on: <img src=/.env> from another site is answered 404 and the visitor is not banned', async () => {
    const img = { 'cf-connecting-ip': '203.0.113.80', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }
    for (let round = 0; round < 4; round += 1) {
      for (const path of ['/.env', '/x.php', '/wp-admin/', '/.git/config']) expect((await fetch(`${base}${path}`, { headers: img })).status).toBe(404)
    }
    expect((await fetch(`${base}/v1/accounts/auth-config`, { headers: { 'cf-connecting-ip': '203.0.113.80' } })).status).toBe(200)
    // Without them (a scanner) the same walk bans the address.
    for (const path of ['/.env', '/x.php', '/wp-admin/']) await fetch(`${base}${path}`, { headers: { 'cf-connecting-ip': '203.0.113.81' } })
    expect((await fetch(`${base}/v1/accounts/auth-config`, { headers: { 'cf-connecting-ip': '203.0.113.81' } })).status).toBe(403)
  })

  it('a stopped API answers 502 with a readable error, not a hang', async () => {
    const dead = createServer((request, response) => proxyToApi(request, response, 1)).listen(0, '127.0.0.1')
    await new Promise((resolve) => dead.once('listening', resolve))
    const answer = await fetch(`http://127.0.0.1:${(dead.address() as AddressInfo).port}/v1/accounts/qr-login`, { method: 'POST' })
    expect(answer.status).toBe(502)
    expect((await answer.json() as { error: string }).error).toContain('502')
    await new Promise((resolve) => dead.close(resolve))
  })
})

describe('forwardedPath', () => {
  it('re-encodes the decided path segment by segment and keeps the query', () => {
    expect(forwardedPath('/v1/accounts/me?x=1')).toEqual({ path: '/v1/accounts/me', url: '/v1/accounts/me?x=1' })
    expect(forwardedPath('/v1/%61ccounts/me')).toEqual({ path: '/v1/accounts/me', url: '/v1/accounts/me' })
    expect(forwardedPath('/v1%2Fadmin')).toEqual({ path: '/v1/admin', url: '/v1/admin' })
    // A decoded ? or # stays part of the path, never becomes a query.
    expect(forwardedPath('/v1/a%3Fb%23c')!.url).toBe('/v1/a%3Fb%23c')
    expect(forwardedPath('/v1/%E0%A4%A')).toBeUndefined()
    expect(forwardedPath('/x', '/v1/given')!.url).toBe('/v1/given')
  })
})

describe('visitorAddress', () => {
  it('takes CF-Connecting-IP only from the local tunnel and ignores a client-sent X-Forwarded-For', () => {
    expect(visitorAddress('127.0.0.1', { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })).toBe('203.0.113.7')
    expect(visitorAddress('192.168.1.5', { 'cf-connecting-ip': '203.0.113.7' })).toBe('192.168.1.5')
    expect(visitorAddress('127.0.0.1', { 'cf-connecting-ip': 'evil, 1.2.3.4' })).toBe('127.0.0.1')
  })
})
