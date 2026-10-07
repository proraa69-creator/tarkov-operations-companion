import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalServerUpdatePayload, type ServerUpdateManifest } from '../serverUpdateManifest'
import { canonicalUpdatePayload } from '../updateManifest'
import { signLinuxManifest, verifiedLinuxManifest } from './linuxManifest'
import { installedBuild, runOnce, type UpdaterConfig } from './updater'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PUBLIC = publicKey.export({ format: 'pem', type: 'spki' }).toString()
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

/** A release folder in a fake raidos-releases: the Linux bundle (a tar.gz with build-info.json) and its signed manifest. */
async function release(files: Map<string, Buffer>, work: string, build: number, signer = privateKey) {
  const stage = join(work, `stage-${build}`)
  await mkdir(join(stage, 'bin'), { recursive: true })
  await writeFile(join(stage, 'build-info.json'), JSON.stringify({ version: '0.5.4', build, commit: 'abc1234', edition: 'linux' }))
  const name = `raidos-server-${build}.tar.gz`
  execFileSync('tar', ['-czf', join(work, name), '-C', stage, '.'])
  const bundle = await readFile(join(work, name))
  const path = `releases/${build}`
  files.set(`${path}/${name}`, bundle)
  files.set(`${path}/RaidOS-linux.json`, Buffer.from(JSON.stringify(signLinuxManifest({ version: '0.5.4', build, commit: 'abc1234', bundle: { name, size: bundle.length, sha256: sha(bundle) } }, signer))))
  files.set('latest.json', Buffer.from(JSON.stringify({ build, path })))
}

async function setup(healthy: () => boolean) {
  const work = await mkdtemp(join(tmpdir(), 'raidos-updater-'))
  dirs.push(work)
  const files = new Map<string, Buffer>()
  const restarts: string[][] = []
  const lines: string[] = []
  const config: UpdaterConfig = {
    token: 'test-token', repo: 'owner/releases', home: join(work, 'opt'), clientDir: join(work, 'client'), stateDir: join(work, 'state'),
    apiHealth: 'http://health/api', siteHealth: 'http://health/site', services: ['raidos-api', 'raidos-site'],
    log: (line) => lines.push(line), restart: (services) => restarts.push(services), healthTimeoutMs: 50, force: false, publicKey: PUBLIC,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://health/')) return new Response('{}', { status: healthy() ? 200 : 503 })
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token')
      const path = decodeURIComponent(url.replace('https://api.github.com/repos/owner/releases/contents/', ''))
      const body = files.get(path)
      return body ? new Response(body) : new Response('{}', { status: 404 })
    }) as typeof fetch,
  }
  await mkdir(join(config.home, 'releases'), { recursive: true })
  return { work, files, restarts, lines, config }
}

describe('Linux server updater', () => {
  it('installs a signed build, switches current and keeps the previous one for rollback', async () => {
    let up = true
    const { work, files, restarts, config } = await setup(() => up)
    await release(files, work, 100)
    await runOnce(config)
    expect(await installedBuild(config.home)).toBe(100)
    expect(restarts).toEqual([['raidos-api', 'raidos-site']])

    await release(files, work, 200)
    await runOnce(config)
    expect(await installedBuild(config.home)).toBe(200)
    expect(await readlink(join(config.home, 'current'))).toBe(join('releases', '200'))
    expect(existsSync(join(config.home, 'releases', '100'))).toBe(true)

    // Nothing new: no restart.
    await runOnce(config)
    expect(restarts).toHaveLength(2)

    // A build that does not come up is rolled back and not retried.
    up = false
    await release(files, work, 300)
    let calls = 0
    config.restart = () => { calls += 1; if (calls === 2) up = true }
    await runOnce(config)
    expect(await installedBuild(config.home)).toBe(200)
    expect(JSON.parse(await readFile(join(config.stateDir, 'skipped.json'), 'utf8'))).toEqual([300])
    await runOnce(config)
    expect(calls).toBe(2)
  })

  it('refuses a bundle signed by another key or changed after signing', async () => {
    const { work, files, config, lines } = await setup(() => true)
    await release(files, work, 100, generateKeyPairSync('ed25519').privateKey)
    await runOnce(config)
    expect(await installedBuild(config.home)).toBe(0)
    expect(lines.some((line) => line.includes('does not verify'))).toBe(true)

    await release(files, work, 101)
    const name = 'releases/101/raidos-server-101.tar.gz'
    files.set(name, Buffer.concat([files.get(name)!, Buffer.from('x')]))
    await runOnce(config)
    expect(await installedBuild(config.home)).toBe(0)
    expect(lines.some((line) => line.includes('does not match'))).toBe(true)
  })

  it('assembles the players\' exe from verified parts with its signed version.json', async () => {
    const { work, files, config } = await setup(() => true)
    await release(files, work, 100)
    const parts = [Buffer.from('MZ-first-part-'), Buffer.from('second-part')]
    const exe = Buffer.concat(parts)
    const base = { edition: 'client' as const, version: '0.5.4', build: 99, commit: 'abc1234', size: exe.length, sha256: sha(exe) }
    const versionJson = { ...base, signature: sign(null, Buffer.from(canonicalUpdatePayload(base)), privateKey).toString('base64') }
    const owner = Buffer.from('MZ-owner')
    const manifest: ServerUpdateManifest = {
      version: '0.5.4', build: 100, commit: 'abc1234',
      owner: { size: owner.length, sha256: sha(owner), parts: [{ name: 'RaidOS.part0', size: owner.length, sha256: sha(owner) }] },
      client: { size: exe.length, sha256: sha(exe), parts: parts.map((part, index) => ({ name: `RaidOSClient.part${index}`, size: part.length, sha256: sha(part) })), versionJson },
    }
    files.set('releases/100/RaidOS-update.json', Buffer.from(JSON.stringify({ ...manifest, signature: sign(null, Buffer.from(canonicalServerUpdatePayload(manifest)), privateKey).toString('base64') })))
    parts.forEach((part, index) => files.set(`releases/100/RaidOSClient.part${index}`, part))
    await runOnce(config)
    expect(await readFile(join(config.clientDir, 'Raid OS 0.5.4.exe'))).toEqual(exe)
    expect(JSON.parse(await readFile(join(config.clientDir, 'version.json'), 'utf8')).build).toBe(99)
  })

  it('the manifest signature covers the bundle name, size and hash', () => {
    const manifest = { version: '0.5.4', build: 5, commit: 'abc', bundle: { name: 'raidos-server-5.tar.gz', size: 10, sha256: 'a'.repeat(64) } }
    const signed = signLinuxManifest(manifest, privateKey)
    expect(verifiedLinuxManifest(signed, PUBLIC)).toEqual(manifest)
    expect(verifiedLinuxManifest({ ...signed, bundle: { ...manifest.bundle, size: 11 } }, PUBLIC)).toBeNull()
    expect(verifiedLinuxManifest({ ...signed, build: 6 }, PUBLIC)).toBeNull()
    expect(verifiedLinuxManifest(signed)).toBeNull()
  })
})
