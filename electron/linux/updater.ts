import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { appendFile, mkdir, open, readFile, readlink, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verifiedServerUpdateManifest, type ServerUpdateManifest } from '../serverUpdateManifest.js'
import { LINUX_MANIFEST_FILE, verifiedLinuxManifest, type LinuxManifest } from './linuxManifest.js'

/**
 * Auto-update of the Linux server (docs/linux-server.md), run as root by the raidos-update.timer every few minutes.
 *
 * 1. latest.json of the releases repository (GitHub REST contents API, read-only token from /etc/raidos/updater.env)
 *    says which build is current. Nothing it says is trusted beyond «where to look».
 * 2. Server: RaidOS-linux.json of that build must verify with the update key built in here; the bundle must have exactly
 *    the signed size and SHA-256. It is unpacked to /opt/raidos/releases/<build>, /opt/raidos/current is switched to it,
 *    the services restart, and the API and the site must answer /health within a minute — otherwise the previous build
 *    comes back and the new one is never installed automatically again (skipped.json).
 * 3. Players' exe: RaidOS-update.json (the Windows release manifest) must verify; every client part and the whole exe
 *    must match it; the exe and its signed version.json go to the client folder the site hands out.
 *
 * Usage: raidos-update.cjs [--once] [--force]   (--force also retries a skipped build)
 */
export interface UpdaterConfig {
  token: string
  repo: string
  home: string
  clientDir: string
  stateDir: string
  apiHealth: string
  siteHealth: string
  services: string[]
  log: (line: string) => void
  fetch: typeof fetch
  restart: (services: string[]) => void
  healthTimeoutMs: number
  force: boolean
  /** Tests only: the updater always checks with the update key built into it. */
  publicKey?: string
}

const API_VERSION = '2022-11-28'

export function configFromEnv(env: NodeJS.ProcessEnv = process.env, force = false): UpdaterConfig {
  const stateDir = env.RAIDOS_UPDATER_STATE ?? '/var/lib/raidos-updater'
  return {
    token: env.RAIDOS_GITHUB_TOKEN ?? '',
    repo: env.RAIDOS_RELEASES_REPO ?? 'proraa69-creator/raidos-releases',
    home: env.RAIDOS_HOME ?? '/opt/raidos',
    clientDir: env.CLIENT_DIR ?? '/var/lib/raidos/client',
    stateDir,
    apiHealth: env.RAIDOS_API_HEALTH ?? 'http://127.0.0.1:8787/health',
    siteHealth: env.RAIDOS_SITE_HEALTH ?? 'http://127.0.0.1:5202/health',
    services: ['raidos-api', 'raidos-site'],
    log: (line) => {
      const text = `${new Date().toISOString()} ${line}`
      console.log(text)
      void appendFile(join(stateDir, 'update.log'), `${text}\n`).catch(() => {})
    },
    fetch,
    restart: (services) => { execFileSync('systemctl', ['restart', ...services], { stdio: 'inherit' }) },
    healthTimeoutMs: 60_000,
    force,
  }
}

/** One file of the releases repository through the contents API (raw bytes). */
async function github(config: UpdaterConfig, path: string, timeoutMs = 60_000) {
  const url = `https://api.github.com/repos/${config.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`
  const response = await config.fetch(url, {
    headers: { authorization: `Bearer ${config.token}`, accept: 'application/vnd.github.raw+json', 'x-github-api-version': API_VERSION, 'user-agent': 'raidos-linux-updater' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function githubJson(config: UpdaterConfig, path: string): Promise<unknown> {
  const body = await github(config, path)
  return body ? JSON.parse(body.toString('utf8')) as unknown : null
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T } catch { return fallback }
}

/** The build /opt/raidos/current runs (its build-info.json); 0 before the first install. */
export async function installedBuild(home: string): Promise<number> {
  const info = await readJson<{ build?: unknown }>(join(home, 'current', 'build-info.json'), {})
  return Number(info.build) || 0
}

async function healthy(config: UpdaterConfig) {
  const deadline = Date.now() + config.healthTimeoutMs
  while (Date.now() < deadline) {
    try {
      const [api, site] = await Promise.all([config.apiHealth, config.siteHealth].map((url) => config.fetch(url, { signal: AbortSignal.timeout(4000) })))
      if (api.ok && site.ok) return true
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return false
}

/** Points /opt/raidos/current at `target` (a folder name in releases/) in one rename. */
async function switchCurrent(home: string, target: string) {
  const next = join(home, 'current.next')
  await rm(next, { force: true })
  await symlink(join('releases', target), next)
  await rename(next, join(home, 'current'))
}

export async function updateServer(config: UpdaterConfig, pointerPath: string, latestBuild: number) {
  const current = await installedBuild(config.home)
  if (latestBuild <= current) return 'latest'
  const skipped = await readJson<number[]>(join(config.stateDir, 'skipped.json'), [])
  if (skipped.includes(latestBuild) && !config.force) { config.log(`server: build ${latestBuild} was rolled back before, skipped`); return 'skipped' }
  const raw = await githubJson(config, `${pointerPath}/${LINUX_MANIFEST_FILE}`)
  if (!raw) { config.log(`server: build ${latestBuild} has no Linux bundle yet`); return 'no-bundle' }
  const manifest: LinuxManifest | null = verifiedLinuxManifest(raw, config.publicKey)
  if (!manifest || manifest.build !== latestBuild) throw new Error(`server: ${LINUX_MANIFEST_FILE} of build ${latestBuild} does not verify`)
  const bundle = await github(config, `${pointerPath}/${manifest.bundle.name}`, 300_000)
  if (!bundle || bundle.length !== manifest.bundle.size || sha256(bundle) !== manifest.bundle.sha256) throw new Error(`server: ${manifest.bundle.name} does not match the signed size / SHA-256`)

  const releases = join(config.home, 'releases')
  const folder = String(manifest.build)
  const staging = join(releases, `${folder}.tmp`)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  const archive = join(config.stateDir, manifest.bundle.name)
  await writeFile(archive, bundle)
  execFileSync('tar', ['-xzf', archive, '-C', staging, '--no-same-owner'])
  await rm(archive, { force: true })
  const unpacked = await readJson<{ build?: unknown }>(join(staging, 'build-info.json'), {})
  if (Number(unpacked.build) !== manifest.build) throw new Error('server: the bundle\'s build-info.json names another build')
  await rm(join(releases, folder), { recursive: true, force: true })
  await rename(staging, join(releases, folder))

  const previous = existsSync(join(config.home, 'current')) ? await readlink(join(config.home, 'current')).catch(() => '') : ''
  config.log(`server: installing build ${manifest.build} (${manifest.commit}), was ${current || 'none'}`)
  await switchCurrent(config.home, folder)
  config.restart(config.services)
  if (await healthy(config)) {
    config.log(`server: build ${manifest.build} is up`)
    // Keep the running build and the one before it.
    const keep = new Set([folder, previous.replace(/^releases\//, '')])
    for (const name of await readdir(releases)) if (!keep.has(name)) await rm(join(releases, name), { recursive: true, force: true })
    return 'installed'
  }
  config.log(`server: build ${manifest.build} did not answer /health in time — rolling back`)
  await writeFile(join(config.stateDir, 'skipped.json'), JSON.stringify([...new Set([...skipped, manifest.build])]))
  if (previous) {
    await switchCurrent(config.home, previous.replace(/^releases\//, ''))
    config.restart(config.services)
  }
  return 'rolled-back'
}

/** The players' exe of the release, assembled from its verified parts (only when the client folder has another build). */
export async function updateClient(config: UpdaterConfig, pointerPath: string) {
  const raw = await githubJson(config, `${pointerPath}/RaidOS-update.json`)
  if (!raw) return 'no-client'
  const manifest: ServerUpdateManifest | null = verifiedServerUpdateManifest(raw, config.publicKey)
  if (!manifest) throw new Error('client: RaidOS-update.json does not verify')
  const client = manifest.client
  if (!client) return 'no-client'
  const published = await readJson<{ build?: unknown }>(join(config.clientDir, 'version.json'), {})
  if (Number(published.build) === client.versionJson.build) return 'latest'
  await mkdir(config.clientDir, { recursive: true })
  const name = `Raid OS ${client.versionJson.version}.exe`
  const temp = join(config.clientDir, `.${name}.part`)
  const out = createWriteStream(temp)
  const whole = createHash('sha256')
  try {
    for (const part of client.parts) {
      const data = await github(config, `${pointerPath}/${part.name}`, 300_000)
      if (!data || data.length !== part.size || sha256(data) !== part.sha256) throw new Error(`client: ${part.name} does not match the signed manifest`)
      whole.update(data)
      if (!out.write(data)) await new Promise((resolve) => out.once('drain', resolve))
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()))
  } catch (error) {
    out.destroy()
    await rm(temp, { force: true })
    throw error
  }
  if (whole.digest('hex') !== client.sha256 || (await stat(temp)).size !== client.size) { await rm(temp, { force: true }); throw new Error('client: the assembled exe does not match') }
  for (const old of await readdir(config.clientDir)) if (old.toLowerCase().endsWith('.exe')) await rm(join(config.clientDir, old), { force: true })
  await rename(temp, join(config.clientDir, name))
  await writeFile(join(config.clientDir, 'version.json'), `${JSON.stringify(client.versionJson)}\n`)
  config.log(`client: published ${name} (build ${client.versionJson.build})`)
  return 'installed'
}

export async function runOnce(config: UpdaterConfig) {
  if (!config.token) { config.log('no RAIDOS_GITHUB_TOKEN in /etc/raidos/updater.env — nothing to do'); return }
  await mkdir(config.stateDir, { recursive: true })
  // One run at a time (a slow download must not overlap the next timer tick).
  const lockFile = join(config.stateDir, 'update.lock')
  const lock = await open(lockFile, 'wx').catch(async () => {
    const age = Date.now() - ((await stat(lockFile).catch(() => null))?.mtimeMs ?? 0)
    if (age > 30 * 60_000) { await rm(lockFile, { force: true }); return open(lockFile, 'wx') }
    return null
  })
  if (!lock) return
  try {
    const pointer = await githubJson(config, 'latest.json') as { build?: unknown; path?: unknown } | null
    const build = Number(pointer?.build)
    const path = typeof pointer?.path === 'string' && /^releases\/\d{1,16}$/.test(pointer.path) ? pointer.path : ''
    if (!build || !path) { config.log('latest.json is missing or malformed'); return }
    try { await updateClient(config, path) } catch (error) { config.log(String(error instanceof Error ? error.message : error)) }
    await updateServer(config, path, build)
  } catch (error) {
    config.log(`update failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    await lock.close()
    await rm(lockFile, { force: true })
  }
}

export function main(argv = process.argv) {
  void runOnce(configFromEnv(process.env, argv.includes('--force')))
}
