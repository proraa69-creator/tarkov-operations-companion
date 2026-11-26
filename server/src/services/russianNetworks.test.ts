import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore, GOOGLE_RUSSIA_MESSAGE } from './accountStore.js'
import { ProgressStore } from './progressStore.js'
import { GOOGLE_CLIENT_ID, type GoogleVerifier } from './googleSignIn.js'
import { parseAddress, parseRipeDelegated, rangesContain, RussianNetworks } from './russianNetworks.js'

// A small piece of RIPE NCC's delegated-ripencc-extended-latest (documentation addresses stand in for real blocks).
const SAMPLE = [
  '2|ripencc|1732492800|123456|19830705|20261125|+0100',
  'ripencc|*|ipv4|*|80000|summary',
  'ripencc|*|ipv6|*|30000|summary',
  '# a comment',
  'ripencc|RU|ipv4|198.51.100.0|256|20050101|allocated|abc-1',
  'ripencc|RU|ipv4|198.51.101.0|256|20060101|assigned|abc-2',
  'ripencc|RU|ipv4|203.0.113.0|128|20070101|allocated|abc-3',
  'ripencc|DE|ipv4|203.0.113.128|128|20070101|allocated|abc-4',
  'ripencc|RU|ipv4|192.0.2.0|256|20080101|reserved|abc-5',
  'ripencc||ipv4|100.64.0.0|1024||available',
  'ripencc|RU|asn|12345|1|20050101|allocated|abc-1',
  'ripencc|RU|ipv6|2001:db8:1000::|36|20100101|allocated|abc-6',
  'ripencc|RU|ipv6|2001:db8:abcd::|48|20110101|assigned|abc-7',
  'ripencc|NL|ipv6|2001:db8:2000::|36|20100101|allocated|abc-8',
  'ripencc|RU|ipv4|not-an-ip|256|20050101|allocated|abc-9',
].join('\n')

test('parses only Russia\'s allocated and assigned IPv4 and IPv6 blocks, merging neighbours', () => {
  const ranges = parseRipeDelegated(SAMPLE)
  // 198.51.100.0/24 and 198.51.101.0/24 touch: one range; 203.0.113.0/25 is another
  assert.equal(ranges.v4.length / 2, 2)
  assert.equal(ranges.v6.length / 2, 2)
  assert.equal(ranges.lines.length, 5)
})

test('finds IPv4, IPv6 and IPv4-mapped IPv6 addresses by binary search', () => {
  const ranges = parseRipeDelegated(SAMPLE)
  assert.equal(rangesContain(ranges, '198.51.100.0'), true)
  assert.equal(rangesContain(ranges, '198.51.101.255'), true)
  assert.equal(rangesContain(ranges, '198.51.102.0'), false)
  assert.equal(rangesContain(ranges, '203.0.113.127'), true)
  assert.equal(rangesContain(ranges, '203.0.113.128'), false) // Germany's half
  assert.equal(rangesContain(ranges, '192.0.2.10'), false) // reserved, not a holder in Russia
  assert.equal(rangesContain(ranges, '8.8.8.8'), false)
  assert.equal(rangesContain(ranges, '::ffff:198.51.100.7'), true)
  assert.equal(rangesContain(ranges, '::ffff:8.8.8.8'), false)
  assert.equal(rangesContain(ranges, '2001:db8:1000::1'), true)
  assert.equal(rangesContain(ranges, '2001:db8:1fff:ffff:ffff:ffff:ffff:ffff'), true)
  assert.equal(rangesContain(ranges, '2001:db8:2000::1'), false)
  assert.equal(rangesContain(ranges, '2001:DB8:ABCD:12::5%eth0'), true)
  assert.equal(rangesContain(ranges, '2001:db8:abce::1'), false)
  assert.equal(rangesContain(ranges, 'not an address'), null)
  assert.deepEqual(parseAddress('::ffff:127.0.0.1'), { v4: 0x7f000001 })
  assert.deepEqual(parseAddress('::1'), { v6: 1n })
})

test('unknown until a list is loaded; a download replaces it and is kept on disk; a failed one keeps the previous list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-ru-'))
  try {
    const file = join(dir, 'russian-networks.txt')
    let answer: () => Response = () => new Response(SAMPLE)
    const fetcher = (async () => answer()) as unknown as typeof fetch
    const networks = new RussianNetworks({ file, fetch: fetcher, minRanges: 1 })
    assert.equal(networks.isRussianAddress('198.51.100.1'), null)
    assert.equal(await networks.refresh(), true)
    assert.equal(networks.isRussianAddress('198.51.100.1'), true)
    assert.equal(networks.isRussianAddress('8.8.8.8'), false)
    assert.equal(networks.isRussianAddress(undefined), null)
    assert.match(await readFile(file, 'utf8'), /ripencc\|RU\|ipv6\|2001:db8:abcd::\|48/)

    answer = () => new Response('oops', { status: 503 })
    assert.equal(await networks.refresh(), false)
    assert.equal(networks.isRussianAddress('198.51.100.1'), true)
    answer = () => new Response('ripencc|DE|ipv4|198.51.100.0|256|20050101|allocated|x')
    assert.equal(await networks.refresh(), false) // too few Russian blocks: not RIPE's file
    assert.equal(networks.isRussianAddress('198.51.100.1'), true)

    // a restart without the internet reads the copy on disk
    const restarted = new RussianNetworks({ file, fetch: (async () => { throw new Error('offline') }) as unknown as typeof fetch })
    assert.equal(await restarted.loadSaved(), true)
    assert.equal(restarted.isRussianAddress('2001:db8:1000::5'), true)
    assert.equal(await new RussianNetworks({ file: join(dir, 'missing.txt') }).loadSaved(), false)
    await writeFile(join(dir, 'empty.txt'), '# nothing\n')
    assert.equal(await new RussianNetworks({ file: join(dir, 'empty.txt') }).loadSaved(), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// The API behind nginx on the same machine: `trust proxy` loopback, the visitor's address in X-Forwarded-For.
async function withApi(run: (base: string, verified: () => number) => Promise<void>) {
  const networks = new RussianNetworks()
  networks.use(parseRipeDelegated(SAMPLE))
  let calls = 0
  const googleVerifier: GoogleVerifier = async () => { calls += 1; throw new Error('not reached in these tests') }
  const accounts = new AccountStore()
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { googleVerifier, russianNetworks: networks }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, () => calls) } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    accounts.close()
  }
}

test('«Войти через Google» from a Russian address: 403 before the token is checked; other addresses reach the check', async () => {
  await withApi(async (base, verified) => {
    const google = (forwarded: string) => fetch(`${base}/v1/accounts/google`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': forwarded }, body: JSON.stringify({ credential: 'x.y.z', country: 'DE' }) })
    for (const address of ['198.51.100.20', '2001:db8:abcd::7']) {
      const refused = await google(address)
      assert.equal(refused.status, 403)
      assert.deepEqual(await refused.json(), { error: GOOGLE_RUSSIA_MESSAGE })
    }
    assert.equal(verified(), 0)
    const other = await google('203.0.113.200')
    assert.notEqual(other.status, 403)
    assert.equal(verified(), 1)
  })
})

test('/auth-config names no Google client for a Russian address; /v1/geo answers RU for it and null otherwise', async () => {
  await withApi(async (base) => {
    const config = async (forwarded: string) => (await fetch(`${base}/v1/accounts/auth-config`, { headers: { 'x-forwarded-for': forwarded } })).json() as Promise<{ googleClientId?: string; googleBlocked?: boolean }>
    const russian = await config('198.51.100.20')
    assert.equal(russian.googleClientId, undefined)
    assert.equal(russian.googleBlocked, true)
    const other = await config('203.0.113.200')
    assert.equal(other.googleClientId, GOOGLE_CLIENT_ID)
    assert.equal(other.googleBlocked, undefined)

    const geo = async (headers: Record<string, string>) => (await fetch(`${base}/v1/geo`, { headers })).json() as Promise<{ country: string | null }>
    assert.deepEqual(await geo({ 'x-forwarded-for': '198.51.100.20' }), { country: 'RU' })
    assert.deepEqual(await geo({ 'x-forwarded-for': '::ffff:203.0.113.5' }), { country: 'RU' })
    assert.deepEqual(await geo({ 'x-forwarded-for': '203.0.113.200' }), { country: null })
    // Cloudflare's country, when there is one, still comes first
    assert.deepEqual(await geo({ 'x-forwarded-for': '198.51.100.20', 'cf-ipcountry': 'DE' }), { country: 'DE' })
  })
})
