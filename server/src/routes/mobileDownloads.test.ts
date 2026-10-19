import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import express from 'express'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareVersions, MOBILE_REPOSITORY, MobileDownloads, parseMobileRelease } from '../services/mobileDownloads.js'
import { createMobileDownloadsRouter } from './mobileDownloads.js'

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const RELEASES = `https://api.github.com/repos/${MOBILE_REPOSITORY}/releases?per_page=20`
const asset = (tag: string, name: string) => ({ name, browser_download_url: `https://github.com/${MOBILE_REPOSITORY}/releases/download/${tag}/${name}` })

/** A fake GitHub: the releases list and the files of each release. */
function github(releases: Array<{ tag: string; files: Record<string, Buffer | string> }>) {
  const files = new Map<string, Buffer>()
  for (const release of releases) for (const [name, body] of Object.entries(release.files)) files.set(asset(release.tag, name).browser_download_url, Buffer.from(body))
  const calls: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url === RELEASES) return new Response(JSON.stringify(releases.map((release) => ({ tag_name: release.tag, draft: false, prerelease: false, assets: Object.keys(release.files).map((name) => asset(release.tag, name)) }))))
    const body = files.get(url)
    return body ? new Response(new Uint8Array(body), { headers: { 'content-length': String(body.length) } }) : new Response('missing', { status: 404 })
  }) as typeof fetch
  return { fetcher, calls }
}

function release(version: string, apk: Buffer, zip: Buffer, change: (manifest: Record<string, unknown>) => void = () => undefined) {
  const tag = `mobile-v${version}`
  const name = version.replace('-', '.')
  const manifest: Record<string, unknown> = {
    version,
    android: { file: `raid-os-${name}.apk`, size: apk.length, sha256: sha(apk), versionCode: 600000 + Number(version.split('-')[1]), versionName: name },
    iphone: { file: `Raid-OS-iPhone-${name}.zip`, size: zip.length, sha256: sha(zip) },
  }
  change(manifest)
  return { tag, files: { 'mobile-release.json': JSON.stringify(manifest), [`raid-os-${name}.apk`]: apk, [`Raid-OS-iPhone-${name}.zip`]: zip } }
}

async function serve(t: test.TestContext, downloads: MobileDownloads) {
  const server = express().use(createMobileDownloadsRouter(downloads)).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve)); t.after(() => server.close())
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

test('mobile downloads: copies the newest release, checks it, serves the APK, the archive and the update description', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-mobile-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const apk = Buffer.from('PK apk 80'), zip = Buffer.from('PK zip 80')
  const fake = github([release('0.6.0-79', Buffer.from('PK old'), Buffer.from('PK old zip')), release('0.6.0-80', apk, zip)])
  const downloads = new MobileDownloads({ dir, fetch: fake.fetcher, now: () => 0 })
  const base = await serve(t, downloads)
  assert.equal((await fetch(`${base}/v1/downloads/android/version.json`)).status, 404, 'nothing before the first copy')
  await downloads.refresh(true)

  const description = await (await fetch(`${base}/v1/downloads/android/version.json`)).json()
  assert.deepEqual(description, { versionCode: 600080, versionName: '0.6.0.80', url: 'https://raidos.app/v1/downloads/android/raid-os-0.6.0.80.apk', sha256: sha(apk), size: apk.length })
  const byName = await fetch(`${base}/v1/downloads/android/raid-os-0.6.0.80.apk`)
  assert.equal(byName.headers.get('content-type'), 'application/vnd.android.package-archive')
  assert.deepEqual(Buffer.from(await byName.arrayBuffer()), apk)
  const latest = await fetch(`${base}/v1/downloads/android`)
  assert.match(String(latest.headers.get('content-disposition')), /attachment; filename="raid-os-0\.6\.0\.80\.apk"/)
  const archive = await fetch(`${base}/v1/downloads/iphone`)
  assert.equal(archive.headers.get('content-type'), 'application/zip')
  assert.deepEqual(Buffer.from(await archive.arrayBuffer()), zip)
  assert.deepEqual(await (await fetch(`${base}/v1/downloads/mobile.json`)).json(), { version: '0.6.0-80', android: { versionName: '0.6.0.80', size: apk.length }, iphone: { size: zip.length } })
  // Another name, a path outside the copy: nothing.
  assert.equal((await fetch(`${base}/v1/downloads/android/raid-os-0.6.0.79.apk`)).status, 404)
  assert.equal((await fetch(`${base}/v1/downloads/android/..%2Fcurrent.json`)).status, 404)

  // A server restart reads the kept copy from disk, without GitHub.
  const restarted = new MobileDownloads({ dir, fetch: (async () => { throw new Error('offline') }) as typeof fetch })
  assert.equal((await restarted.release())?.version, '0.6.0-80')
})

test('mobile downloads: a file that does not match its description never replaces the copy', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-mobile-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const good = github([release('0.6.0-80', Buffer.from('PK good'), Buffer.from('PK zip'))])
  const downloads = new MobileDownloads({ dir, fetch: good.fetcher, now: () => 0 })
  await downloads.refresh(true)
  const forged = release('0.6.0-81', Buffer.from('PK evil'), Buffer.from('PK zip'), (manifest) => { (manifest.android as { sha256: string }).sha256 = 'a'.repeat(64) })
  const messages: string[] = []
  const next = new MobileDownloads({ dir, fetch: github([forged]).fetcher, log: (message) => messages.push(message) })
  await next.refresh(true)
  assert.equal((await next.release())?.version, '0.6.0-80')
  assert.match(messages.join('\n'), /SHA-256 differs/)
  assert.deepEqual((await readdir(dir)).sort(), ['current.json', 'mobile-v0.6.0-80'])
})

test('mobile downloads: visits look at GitHub at most every ten minutes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-mobile-')); t.after(() => rm(dir, { recursive: true, force: true }))
  let now = 0
  const fake = github([])
  const downloads = new MobileDownloads({ dir, fetch: fake.fetcher, now: () => now })
  await downloads.refresh()
  await downloads.refresh()
  now += 9 * 60_000
  await downloads.refresh()
  assert.equal(fake.calls.length, 1)
  now += 2 * 60_000
  await downloads.refresh()
  assert.equal(fake.calls.length, 2)
})

test('mobile downloads: descriptions and versions', () => {
  const ok = { version: '0.6.0-80', android: { file: 'raid-os-0.6.0.80.apk', size: 10, sha256: 'a'.repeat(64), versionCode: 600080, versionName: '0.6.0.80' } }
  assert.ok(parseMobileRelease(ok, 'mobile-v0.6.0-80'))
  assert.equal(parseMobileRelease(ok, 'mobile-v0.6.0-81'), null, 'the tag must name the same version')
  assert.equal(parseMobileRelease({ ...ok, android: { ...ok.android, file: '../x.apk' } }, 'mobile-v0.6.0-80'), null)
  assert.equal(parseMobileRelease({ ...ok, android: { ...ok.android, file: 'current.json' } }, 'mobile-v0.6.0-80'), null)
  assert.equal(parseMobileRelease({ version: '0.6.0-80', iphone: { file: 'a.exe', size: 1, sha256: 'a'.repeat(64) } }, 'mobile-v0.6.0-80'), null)
  assert.ok(compareVersions('0.6.0-80', '0.6.0-9') > 0)
  assert.ok(compareVersions('0.7.0-1', '0.6.0-99') > 0)
  assert.equal(compareVersions('0.6.0-80', '0.6.0-80'), 0)
})
