// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DeltaInfo } from './deltaInfo'
import { httpDeltaSource } from './deltaHttp'

// A stand-in for the site: /app-delta/ files as nginx serves them, its page for any other path.
const ARCHIVE = randomBytes(300_000)
const COPY = randomBytes(5_000)
const HASH = 'c'.repeat(64)
const HELD = 'd'.repeat(64)
let mode: 'ok' | 'other-release' | 'no-range' | 'other-part' | 'stall' | 'no-copies' = 'ok'
const asked = new Map<string, number>()

function answer(request: IncomingMessage, response: ServerResponse) {
  const path = new URL(request.url ?? '/', 'http://site').pathname
  asked.set(path, (asked.get(path) ?? 0) + 1)
  // Its first request is never answered (as if the connection's packets were lost), a second one at once.
  if (path === `/app-delta/brotli/${HELD}.br`) { if (asked.get(path) === 1) return; response.end(COPY); return }
  if (path === '/app-delta/app.asar') {
    const [, from, to] = /^bytes=([0-9]+)-([0-9]+)$/.exec(String(request.headers.range ?? '')) ?? []
    if (mode === 'no-range' || from === undefined) { response.writeHead(200); response.end(ARCHIVE); return }
    const start = Number(from), end = mode === 'other-part' ? Number(to) - 1 : Number(to)
    response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${mode === 'other-release' ? ARCHIVE.length + 1 : ARCHIVE.length}` })
    // The connection stays open and nothing more comes.
    if (mode === 'stall') { response.write(ARCHIVE.subarray(start, start + 10)); return }
    response.end(ARCHIVE.subarray(start, end + 1))
    return
  }
  if (path === '/app-delta/app.asar.unpacked/node_modules/a%20b/c.js') { response.end('module.exports = 1\n'); return }
  if (path === '/app-delta/app.asar.unpacked/local-server/server.cjs') {
    const [, from, to] = /^bytes=([0-9]+)-([0-9]+)$/.exec(String(request.headers.range ?? '')) ?? []
    if (from === undefined) { response.end(ARCHIVE); return }
    response.writeHead(206, { 'content-range': `bytes ${from}-${to}/${ARCHIVE.length}` })
    response.end(ARCHIVE.subarray(Number(from), Number(to) + 1))
    return
  }
  if (path === '/app-delta/brotli/index.json' && mode !== 'no-copies') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ format: 1, build: 7, files: { [HASH]: COPY.length } })); return }
  if (path === `/app-delta/brotli/${HASH}.br`) { response.end(COPY); return }
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><div id="root"></div>')
}

const server = createServer(answer)
let base = ''
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.closeAllConnections(); server.close() })
beforeEach(() => { mode = 'ok' })

const info: DeltaInfo = { format: 1, build: 7, version: '0.6.0-197', commit: 'abc-production', electron: '44.4.5', asar: { size: ARCHIVE.length, dataStart: 16 }, resources: {} }

describe('the release\'s /app-delta/ files over HTTP (electron/deltaHttp.ts)', () => {
  it('a Range request gives exactly those bytes and reports every piece as it arrives', async () => {
    const pieces: number[] = []
    const data = await httpDeltaSource(base, info).range(1_000, 250_999, (bytes) => pieces.push(bytes))
    expect(data.equals(ARCHIVE.subarray(1_000, 251_000))).toBe(true)
    expect(pieces.reduce((sum, bytes) => sum + bytes, 0)).toBe(250_000)
  })

  it('refuses another release, a server that ignores Range and another part than asked', async () => {
    const source = httpDeltaSource(base, info)
    mode = 'other-release'
    await expect(source.range(0, 99)).rejects.toThrow('На сервере уже другой выпуск')
    mode = 'no-range'
    await expect(source.range(0, 99)).rejects.toThrow('Сервер не отдал часть обновления: HTTP 200')
    mode = 'other-part'
    await expect(source.range(0, 99)).rejects.toThrow('Сервер отдал не ту часть обновления')
  })

  it('drops a request that stops receiving (stageDelta then asks again)', async () => {
    mode = 'stall'
    const started = Date.now()
    await expect(httpDeltaSource(base, info, { stallMs: 300 }).range(0, 99_999)).rejects.toThrow('перестал отвечать')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('a request without an answer goes once more over another connection, and the first answer wins', async () => {
    const source = httpDeltaSource(base, info, { hedgeMs: 200 })
    const started = Date.now()
    expect((await source.brotli!(HELD)).equals(COPY)).toBe(true)
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(asked.get(`/app-delta/brotli/${HELD}.br`)).toBe(2)
    // One that answers in time is asked once.
    asked.clear()
    await source.brotli!(HASH)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(asked.get(`/app-delta/brotli/${HASH}.br`)).toBe(1)
  })

  it('unpacked files by their encoded path, the brotli index and copies; the site\'s page is no index', async () => {
    const source = httpDeltaSource(base, info)
    expect((await source.unpacked('node_modules/a b/c.js')).toString()).toBe('module.exports = 1\n')
    // A big one in pieces (Range requests of its own address).
    expect((await source.unpacked('local-server/server.cjs', undefined, { start: 100, end: 199_999 })).equals(ARCHIVE.subarray(100, 200_000))).toBe(true)
    expect(await source.brotliIndex!()).toEqual({ format: 1, build: 7, files: { [HASH]: COPY.length } })
    expect((await source.brotli!(HASH)).equals(COPY)).toBe(true)
    mode = 'no-copies'
    expect(await source.brotliIndex!()).toBeNull()
  })
})
