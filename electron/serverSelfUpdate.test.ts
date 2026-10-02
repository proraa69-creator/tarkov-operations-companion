// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalUpdatePayload } from './updateManifest'
import { canonicalServerUpdatePayload, partName, type ServerUpdateManifest } from './serverUpdateManifest'
import {
  DEFAULT_INSTALL_WINDOW, encodedCommand, GitHubReleaseSource, healthVerdict, helperEnvironment, helperLogTail, helperScript, HEALTH_RULES, HELPER_QUIT_TIMEOUT_SEC,
  HELPER_START_VERIFY_SEC, inInstallWindow, installWindowOf, launcherScript, parseLatest, READY_FOR_INSTALL_TEXT, restartArgs, ServerSelfUpdater,
  SourceError, verifyStagedRelease, writeVerified, type InstallWindow, type ReleaseSource, type StagedRelease, type UpdaterStatus,
} from './serverSelfUpdate'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const stranger = generateKeyPairSync('ed25519')
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const dirs: string[] = []
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'raidos-selfupdate-')); dirs.push(dir); return dir }

/** A release: files by repository path, signed with `key`. */
function release(build: number, options: { key?: typeof privateKey; tamper?: (files: Map<string, Buffer>) => void; latestBuild?: number } = {}) {
  const key = options.key ?? privateKey
  const ownerChunks = [Buffer.from(`owner-${build}-a`.repeat(50)), Buffer.from(`owner-${build}-b`)]
  const clientChunks = [Buffer.from(`client-${build}`.repeat(30))]
  const describe = (edition: 'owner' | 'client', chunks: Buffer[]) => {
    const whole = Buffer.concat(chunks)
    return { size: whole.length, sha256: sha(whole), parts: chunks.map((chunk, index) => ({ name: partName(edition, index), size: chunk.length, sha256: sha(chunk) })) }
  }
  const owner = describe('owner', ownerChunks)
  const client = describe('client', clientChunks)
  const base = { edition: 'client' as const, version: '0.6.0', build: build - 1, commit: 'abc1234', size: client.size, sha256: client.sha256 }
  const versionJson = { ...base, signature: sign(null, Buffer.from(canonicalUpdatePayload(base), 'utf8'), key).toString('base64') }
  const manifest: ServerUpdateManifest = { version: '0.6.0', build, commit: 'abc1234', owner, client: { ...client, versionJson } }
  const signed = { ...manifest, signature: sign(null, Buffer.from(canonicalServerUpdatePayload(manifest), 'utf8'), key).toString('base64') }
  const path = `releases/${build}`
  const files = new Map<string, Buffer>([
    ['latest.json', Buffer.from(JSON.stringify({ build: options.latestBuild ?? build, path: `releases/${options.latestBuild ?? build}` }))],
    [`${path}/RaidOS-update.json`, Buffer.from(JSON.stringify(signed))],
    ...ownerChunks.map((chunk, index) => [`${path}/${partName('owner', index)}`, chunk] as [string, Buffer]),
    ...clientChunks.map((chunk, index) => [`${path}/${partName('client', index)}`, chunk] as [string, Buffer]),
  ])
  options.tamper?.(files)
  return { files, manifest, ownerWhole: Buffer.concat(ownerChunks), clientWhole: Buffer.concat(clientChunks) }
}

/** An in-memory releases repository with request counting. */
function fakeSource(files: Map<string, Buffer>) {
  const downloads: string[] = []
  const source: ReleaseSource = {
    async latest() {
      const pointer = parseLatest(JSON.parse(files.get('latest.json')!.toString('utf8')))
      if (!pointer) throw new SourceError(0, 'bad latest.json')
      return { notModified: false as const, etag: '"x"', pointer }
    },
    async text(path) {
      const data = files.get(path)
      if (!data) throw new SourceError(404, `missing ${path}`)
      return data.toString('utf8')
    },
    async download(path, file, expected, onBytes) {
      downloads.push(path)
      const data = files.get(path)
      if (!data) throw new SourceError(404, `missing ${path}`)
      await writeVerified(Readable.from([data]), file, expected, onBytes)
    },
  }
  return { source, downloads }
}

function updater(files: Map<string, Buffer>, options: { current?: number; window?: InstallWindow; hour?: number; skipped?: number[]; key?: typeof publicKey; onStatus?: (status: UpdaterStatus) => void } = {}) {
  const root = tempDir()
  const installed: StagedRelease[] = []
  const { source, downloads } = fakeSource(files)
  const instance = new ServerSelfUpdater({
    root,
    current: () => ({ version: '0.5.4', build: options.current ?? 1000, commit: 'old' }),
    source: () => source,
    settings: () => ({ enabled: true, window: options.window ?? 'any' }),
    skipped: () => options.skipped ?? [],
    install: async (staged) => { installed.push(staged) },
    now: () => new Date(2026, 9, 1, options.hour ?? 14, 0, 0),
    publicKey: options.key ?? publicKey,
    ...(options.onStatus ? { onStatus: options.onStatus } : {}),
  })
  return { instance, installed, downloads, root }
}

describe('ServerSelfUpdater (download, verify, install)', () => {
  it('downloads a newer signed release, verifies every part and both exes, then installs it', async () => {
    const { files, ownerWhole, clientWhole } = release(2000)
    const { instance, installed } = updater(files)
    expect(await instance.check()).toBe('installing')
    expect(installed).toHaveLength(1)
    const staged = installed[0]!
    expect(readFileSync(staged.ownerExe)).toEqual(ownerWhole)
    expect(readFileSync(staged.clientExe!)).toEqual(clientWhole)
    expect(staged.versionJson?.edition).toBe('client')
    expect(JSON.parse(readFileSync(join(staged.dir, 'version.json'), 'utf8'))).toEqual(staged.versionJson)
    expect(instance.snapshot().files.every((file) => file.state === 'ok')).toBe(true)
    expect(staged.checks.every((check) => check.ok)).toBe(true)
  })

  it('refuses a release signed with another key: nothing is downloaded or installed', async () => {
    const { files } = release(2000, { key: stranger.privateKey })
    const { instance, installed, downloads } = updater(files)
    expect(await instance.check()).toBe('error')
    expect(installed).toHaveLength(0)
    expect(downloads).toHaveLength(0)
    expect(instance.snapshot().error).toMatch(/Подпись/)
  })

  it('refuses an unsigned manifest', async () => {
    const { files } = release(2000, { tamper: (map) => {
      const data = JSON.parse(map.get('releases/2000/RaidOS-update.json')!.toString('utf8')) as Record<string, unknown>
      delete data.signature
      map.set('releases/2000/RaidOS-update.json', Buffer.from(JSON.stringify(data)))
    } })
    const { instance, installed } = updater(files)
    expect(await instance.check()).toBe('error')
    expect(installed).toHaveLength(0)
  })

  it('refuses a part whose bytes differ from the signed SHA-256 and keeps nothing of it', async () => {
    const { files } = release(2000, { tamper: (map) => { const part = map.get('releases/2000/RaidOS.part1')!; map.set('releases/2000/RaidOS.part1', Buffer.from(part.toString('utf8').replace(/b$/, 'X'))) } })
    const { instance, installed, root } = updater(files)
    expect(await instance.check()).toBe('error')
    expect(installed).toHaveLength(0)
    expect(instance.snapshot().error).toMatch(/RaidOS\.part1.*SHA-256/)
    expect(existsSync(join(root, '2000', 'RaidOS.part1'))).toBe(false)
  })

  it('refuses a part longer than signed', async () => {
    const { files } = release(2000, { tamper: (map) => { map.set('releases/2000/RaidOSClient.part0', Buffer.concat([map.get('releases/2000/RaidOSClient.part0')!, Buffer.from('!')])) } })
    const { instance, installed } = updater(files)
    expect(await instance.check()).toBe('error')
    expect(installed).toHaveLength(0)
    expect(instance.snapshot().error).toMatch(/больше/)
  })

  it('refuses when latest.json points at another build than the signed one', async () => {
    const { files } = release(2000)
    const other = release(3000)
    files.set('latest.json', other.files.get('latest.json')!)
    files.set('releases/3000/RaidOS-update.json', files.get('releases/2000/RaidOS-update.json')!)
    const { instance, installed } = updater(files)
    expect(await instance.check()).toBe('error')
    expect(installed).toHaveLength(0)
    expect(instance.snapshot().error).toMatch(/3000.*2000/)
  })

  it('never downgrades: an older or the same build is not installed', async () => {
    const older = updater(release(900).files, { current: 1000 })
    expect(await older.instance.check()).toBe('latest')
    expect(older.installed).toHaveLength(0)
    const same = updater(release(1000).files, { current: 1000 })
    expect(await same.instance.check()).toBe('latest')
    expect(same.downloads).toHaveLength(0)
  })

  it('skips a build that was rolled back', async () => {
    const { instance, installed } = updater(release(2000).files, { skipped: [2000] })
    expect(await instance.check()).toBe('skipped')
    expect(installed).toHaveLength(0)
  })

  it('waits for the night window, then installs without downloading again', async () => {
    const { files } = release(2000)
    let hour = 14
    const root = tempDir()
    const installed: StagedRelease[] = []
    const { source, downloads } = fakeSource(files)
    const instance = new ServerSelfUpdater({
      root, current: () => ({ version: '0.5.4', build: 1000, commit: 'old' }), source: () => source,
      settings: () => ({ enabled: true, window: 'night' }), skipped: () => [], install: async (staged) => { installed.push(staged) },
      now: () => new Date(2026, 9, 1, hour, 30), publicKey,
    })
    expect(await instance.check()).toBe('waiting')
    expect(instance.snapshot().waitingForWindow).toBe(true)
    const fetched = downloads.length
    hour = 4
    expect(await instance.check()).toBe('installing')
    expect(installed).toHaveLength(1)
    expect(downloads.length).toBe(fetched)
  })

  it('resumes: parts already downloaded and correct are not fetched again', async () => {
    const { files } = release(2000, { tamper: (map) => map.delete('releases/2000/RaidOSClient.part0') })
    const first = updater(files)
    expect(await first.instance.check()).toBe('error')
    expect(first.downloads).toEqual(['releases/2000/RaidOS.part0', 'releases/2000/RaidOS.part1', 'releases/2000/RaidOSClient.part0'])
    files.set('releases/2000/RaidOSClient.part0', release(2000).files.get('releases/2000/RaidOSClient.part0')!)
    const { source, downloads } = fakeSource(files)
    const installed: StagedRelease[] = []
    const again = new ServerSelfUpdater({
      root: first.root, current: () => ({ version: '0.5.4', build: 1000, commit: 'old' }), source: () => source,
      settings: () => ({ enabled: true, window: 'any' }), skipped: () => [], install: async (staged) => { installed.push(staged) }, publicKey,
    })
    expect(await again.check()).toBe('installing')
    expect(downloads).toEqual(['releases/2000/RaidOSClient.part0'])
    expect(installed).toHaveLength(1)
  })

  it('re-verifies right before installing: an exe changed after the download is refused', async () => {
    const { files } = release(2000)
    const root = tempDir()
    const installed: StagedRelease[] = []
    const { source } = fakeSource(files)
    let hour = 14
    const instance = new ServerSelfUpdater({
      root, current: () => ({ version: '0.5.4', build: 1000, commit: 'old' }), source: () => source,
      settings: () => ({ enabled: true, window: 'night' }), skipped: () => [], install: async (staged) => { installed.push(staged) },
      now: () => new Date(2026, 9, 1, hour, 0), publicKey,
    })
    expect(await instance.check()).toBe('waiting')
    writeFileSync(join(root, '2000', 'owner.exe'), 'not the signed exe')
    hour = 3
    expect(await instance.check()).toBe('error')
    expect(installed).toHaveLength(0)
  })

  it('manual mode (the default): downloads and verifies, then waits for «Установить сейчас» and installs only then', async () => {
    const statuses: UpdaterStatus[] = []
    const { instance, installed, downloads } = updater(release(2000).files, { window: 'manual', onStatus: (status) => statuses.push(status) })
    expect(await instance.check()).toBe('waiting')
    expect(installed).toHaveLength(0)
    const snapshot = instance.snapshot()
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.waitingForInstall).toBe(true)
    expect(snapshot.waitingForWindow).toBeUndefined()
    expect(snapshot.message.toLowerCase()).toContain(READY_FOR_INSTALL_TEXT.toLowerCase())
    expect(statuses.some((status) => status.phase === 'ready' && status.waitingForInstall && status.latest?.build === 2000)).toBe(true)
    expect(instance.readyBuild()).toEqual({ version: '0.6.0', build: 2000, commit: 'abc1234' })
    // The timer keeps checking: still waiting, nothing downloaded again, nothing installed.
    const fetched = downloads.length
    expect(await instance.check()).toBe('waiting')
    expect(downloads.length).toBe(fetched)
    expect(installed).toHaveLength(0)
    // The owner's button.
    expect(await instance.installNow()).toBe('installing')
    expect(installed).toHaveLength(1)
    expect(installed[0]!.manifest.build).toBe(2000)
    expect(instance.readyBuild()).toBeNull()
  })

  it('«Установить сейчас» without a verified build is refused; a build changed on disk after the download is not installed', async () => {
    const empty = updater(release(2000).files, { window: 'manual', current: 2000 })
    expect(await empty.instance.check()).toBe('latest')
    await expect(empty.instance.installNow()).rejects.toThrow(/Нет скачанной и проверенной версии/)
    const { instance, installed, root } = updater(release(2000).files, { window: 'manual' })
    expect(await instance.check()).toBe('waiting')
    writeFileSync(join(root, '2000', 'owner.exe'), 'not the signed exe')
    expect(await instance.installNow()).toBe('error')
    expect(installed).toHaveLength(0)
    expect(instance.snapshot().phase).toBe('error')
  })

  it('«Установить сейчас» also works while a build waits for the night window, and refuses a build skipped meanwhile', async () => {
    const night = updater(release(2000).files, { window: 'night', hour: 14 })
    expect(await night.instance.check()).toBe('waiting')
    expect(await night.instance.installNow()).toBe('installing')
    expect(night.installed).toHaveLength(1)
    const skipped: number[] = []
    const { source } = fakeSource(release(2000).files)
    const installed: StagedRelease[] = []
    const instance = new ServerSelfUpdater({
      root: tempDir(), current: () => ({ version: '0.5.4', build: 1000, commit: 'old' }), source: () => source,
      settings: () => ({ enabled: true, window: 'manual' }), skipped: () => skipped, install: async (staged) => { installed.push(staged) }, publicKey,
    })
    expect(await instance.check()).toBe('waiting')
    skipped.push(2000)
    expect(await instance.installNow()).toBe('error')
    expect(installed).toHaveLength(0)
  })

  it('is off when switched off, and asks for settings without a source', async () => {
    const off = new ServerSelfUpdater({ root: tempDir(), current: () => ({ version: '', build: 1, commit: '' }), source: () => null, settings: () => ({ enabled: false, window: 'any' }), skipped: () => [], install: async () => {} })
    expect(await off.check()).toBe('off')
    const empty = new ServerSelfUpdater({ root: tempDir(), current: () => ({ version: '', build: 1, commit: '' }), source: () => null, settings: () => ({ enabled: true, window: 'any' }), skipped: () => [], install: async () => {} })
    expect(await empty.check()).toBe('error')
    expect(empty.snapshot().error).toMatch(/токен/)
  })
})

describe('verifyStagedRelease', () => {
  it('refuses a staging folder whose manifest does not verify with the given key', async () => {
    const dir = tempDir()
    const { files } = release(2000, { key: stranger.privateKey })
    for (const [path, data] of files) if (path.startsWith('releases/2000/')) writeFileSync(join(dir, path.slice('releases/2000/'.length)), data)
    await expect(verifyStagedRelease(dir, publicKey)).rejects.toThrow(/Подпись/)
    expect(existsSync(join(dir, 'owner.exe'))).toBe(false)
  })
})

describe('GitHubReleaseSource', () => {
  it('reads latest.json with the token, API version, User-Agent and ETag, and treats 304 as unchanged', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> })
      if ((init.headers as Record<string, string>)['if-none-match'] === '"v1"') return new Response(null, { status: 304 })
      return new Response(JSON.stringify({ build: 5, path: 'releases/5' }), { status: 200, headers: { etag: '"v1"' } })
    }) as unknown as typeof fetch
    const source = new GitHubReleaseSource({ repo: 'owner/raidos-releases', token: 'github_pat_test', fetch: fake })
    expect(await source.latest()).toEqual({ notModified: false, etag: '"v1"', pointer: { build: 5, path: 'releases/5' } })
    expect(await source.latest('"v1"')).toEqual({ notModified: true })
    expect(calls[0]!.url).toBe('https://api.github.com/repos/owner/raidos-releases/contents/latest.json')
    expect(calls[0]!.headers.authorization).toBe('Bearer github_pat_test')
    expect(calls[0]!.headers['user-agent']).toMatch(/RaidOS/)
    expect(calls[0]!.headers['x-github-api-version']).toBe('2022-11-28')
    expect(calls[0]!.headers.accept).toBe('application/vnd.github.raw')
  })

  it('explains 401 / 404 and refuses a pointer to another folder', async () => {
    const answer = (status: number, body = '') => (async () => new Response(body, { status })) as unknown as typeof fetch
    await expect(new GitHubReleaseSource({ repo: 'a/b', token: 't', fetch: answer(401) }).latest()).rejects.toThrow(/401/)
    await expect(new GitHubReleaseSource({ repo: 'a/b', token: 't', fetch: answer(404) }).latest()).rejects.toThrow(/404/)
    await expect(new GitHubReleaseSource({ repo: 'a/b', token: 't', fetch: answer(200, '{"build":5,"path":"../../etc"}') }).latest()).rejects.toThrow(/latest\.json/)
    expect(() => new GitHubReleaseSource({ repo: 'not a repo', token: 't' })).toThrow()
    expect(parseLatest({ build: 5, path: 'releases/6' })).toBeNull()
    expect(parseLatest({ build: '5', path: 'releases/5' })).toBeNull()
  })
})

describe('after the restart (rollback decision)', () => {
  const start = { startedAt: 0, okStreak: 0 }
  const healthy = { api: { ok: true, build: 2000 }, siteOk: true }

  it('is healthy after two good answers in a row from the expected build', () => {
    const first = healthVerdict(start, healthy, 2000, 3000)
    expect(first.verdict).toBe('wait')
    expect(healthVerdict(first.state, healthy, 2000, 6000).verdict).toBe('healthy')
  })

  it('starts counting again after a bad answer', () => {
    const first = healthVerdict(start, healthy, 2000, 3000)
    const bad = healthVerdict(first.state, { api: null, siteOk: false }, 2000, 6000)
    expect(bad.state.okStreak).toBe(0)
    expect(healthVerdict(bad.state, healthy, 2000, 9000).verdict).toBe('wait')
  })

  it('rolls back when two minutes pass without being healthy, with the last reason', () => {
    expect(healthVerdict(start, { api: null, siteOk: false }, 2000, HEALTH_RULES.deadlineMs)).toMatchObject({ verdict: 'rollback', reason: 'api-not-responding' })
    expect(healthVerdict(start, { api: { ok: true, build: 1000 }, siteOk: true }, 2000, HEALTH_RULES.deadlineMs)).toMatchObject({ verdict: 'rollback', reason: 'wrong-build' })
    expect(healthVerdict(start, { api: { ok: false, build: 2000 }, siteOk: true }, 2000, HEALTH_RULES.deadlineMs)).toMatchObject({ verdict: 'rollback', reason: 'api-unhealthy' })
    expect(healthVerdict(start, { api: { ok: true, build: 2000 }, siteOk: false }, 2000, HEALTH_RULES.deadlineMs)).toMatchObject({ verdict: 'rollback', reason: 'site-not-responding' })
    expect(healthVerdict(start, { api: null, siteOk: false }, 2000, HEALTH_RULES.deadlineMs - 1).verdict).toBe('wait')
  })

  it('a healthy answer exactly at the deadline still counts if it completes the streak', () => {
    const first = healthVerdict(start, healthy, 2000, HEALTH_RULES.deadlineMs - 3000)
    expect(healthVerdict(first.state, healthy, 2000, HEALTH_RULES.deadlineMs).verdict).toBe('healthy')
  })

  it('the Windows helper applies the same limits and passes only the server flags', () => {
    const script = helperScript()
    expect(script).toContain(`$deadlineSec = ${HEALTH_RULES.deadlineMs / 1000}`)
    expect(script).toContain(`$okInARow = ${HEALTH_RULES.okInARow}`)
    expect(script).toContain('http://127.0.0.1:8787/health')
    expect(script).toContain('http://127.0.0.1:5202/')
    expect(restartArgs(['x.exe', '--server-mode', '--enable-tunnel', '--evil'])).toEqual(['--server-mode', '--enable-tunnel'])
    expect(restartArgs(['x.exe'])).toEqual(['--server-mode'])
    const env = helperEnvironment({
      id: '1', exe: 'C:\\A\\Raid OS Server.exe', next: 'n', previous: 'p', clientDir: 'c', clientPrevious: 'cp', resultFile: 'r', confirmFile: 'k', pendingFile: 's', logFile: 'l',
      helperPidFile: 'h', appPidFile: 'a', appExe: 'C:\\T\\Raid OS.exe', pid: 42, expectedBuild: 2000, args: ['--server-mode', '--enable-tunnel'],
    })
    expect(env).toMatchObject({ RAIDOS_ID: '1', RAIDOS_BUILD: '2000', RAIDOS_ARGS: '--server-mode --enable-tunnel', RAIDOS_PID: '42', RAIDOS_APP_EXE: 'C:\\T\\Raid OS.exe', RAIDOS_LOG: 'l', RAIDOS_HELPER_PID: 'h', RAIDOS_APP_PID: 'a', RAIDOS_PENDING: 's' })
  })

  it('the helper logs every step, waits for both the inner exe and the portable wrapper, and verifies the start', () => {
    const script = helperScript()
    // Diagnostics: timestamped log + transcript, helper.pid at once, a log line for every step.
    expect(script).toContain('$logFile = $env:RAIDOS_LOG')
    expect(script).toContain('[System.IO.File]::AppendAllText($logFile')
    expect(script).toContain("ToString('yyyy-MM-dd HH:mm:ss.fff')")
    expect(script).toContain('Start-Transcript')
    expect(script).toContain('[System.IO.File]::WriteAllText($helperPidFile')
    expect(script).toContain('trap { Log')
    for (const step of ['waiting for the app to quit', 'the app has quit after', 'move attempt', 'moved the new exe into place', 'Start-Process ok', 'Start-Process failed', 'process is running after', "Log ('probe ", 'ROLLBACK: ', 'taskkill ', 'result: ']) {
      expect(script).toContain(step)
    }
    // Portable exe: the inner pid (only while it still runs RAIDOS_APP_EXE) AND the wrapper (Path = RAIDOS_EXE).
    expect(script).toContain('$oldPid = [int]$env:RAIDOS_PID; $oldAppExe = $env:RAIDOS_APP_EXE')
    expect(script).toMatch(/function Get-OldApp \{[\s\S]*Get-Process -Id \$oldPid[\s\S]*\$inner\.Path -eq \$oldAppExe[\s\S]*Get-ByPath \$exe/)
    expect(script).toMatch(/while \(\$true\) \{\s*\$alive = @\(Get-OldApp\)/)
    expect(script).toContain(`$quitTimeoutSec = ${HELPER_QUIT_TIMEOUT_SEC}`)
    expect(script).toContain("Stop-Processes 'the old app (inner exe and wrapper)' { Get-OldApp }")
    // Stop-App: the wrapper's whole tree and the restarted inner exe from app.pid, never «every process with this name».
    expect(script).toMatch(/function Get-NewApp \{[\s\S]*Get-ByPath \$exe[\s\S]*\$appPidFile/)
    expect(script).toContain("'/T'")
    expect(script).not.toContain('Get-Process -Name')
    // Start-Server checks within 30 s that the process exists.
    expect(HELPER_START_VERIFY_SEC).toBe(30)
    expect(script).toContain(`$startVerifySec = ${HELPER_START_VERIFY_SEC}`)
    expect(script).toMatch(/function Start-Server[\s\S]*-PassThru[\s\S]*Get-ByPath \$exe/)
    expect(script).toContain("if (-not (Start-Server 'the new version')) { Roll-Back 'start-failed'")
    // A restart the app cancelled (the helper started too late) changes nothing.
    expect(script).toContain('if (Test-Cancelled)')
    expect(script).not.toContain('${')
  })

  it("the helper is started through a launcher (Start-Process, Bypass), so it is not in the app's process tree", () => {
    const launcher = launcherScript()
    expect(launcher).toContain('Start-Process -FilePath $env:RAIDOS_POWERSHELL')
    expect(launcher).toContain("'-ExecutionPolicy', 'Bypass'")
    expect(launcher).toContain(`'-File', ('"' + $env:RAIDOS_HELPER + '"')`)
    expect(launcher).toContain('[launcher]')
    expect(Buffer.from(encodedCommand(launcher), 'base64').toString('utf16le')).toBe(launcher)
  })

  it('the log tail keeps the last lines', () => {
    const text = `\uFEFF${Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\r\n')}\r\n\r\n`
    expect(helperLogTail(text, 3)).toBe('line 97\nline 98\nline 99')
    expect(helperLogTail('x'.repeat(100), 5, 10)).toBe('x'.repeat(10))
  })

  it('install mode: manual is the default; settings saved without an explicit choice are manual', () => {
    expect(DEFAULT_INSTALL_WINDOW).toBe('manual')
    expect(installWindowOf(undefined)).toBe('manual')
    expect(installWindowOf('weird')).toBe('manual')
    expect(installWindowOf('manual')).toBe('manual')
    expect(installWindowOf('any')).toBe('any')
    expect(installWindowOf('night')).toBe('night')
    expect(inInstallWindow('manual', new Date(2026, 0, 1, 4))).toBe(false)
  })

  it('install window: any time, or only 03:00–06:00', () => {
    expect(inInstallWindow('any', new Date(2026, 0, 1, 14))).toBe(true)
    expect(inInstallWindow('night', new Date(2026, 0, 1, 2, 59))).toBe(false)
    expect(inInstallWindow('night', new Date(2026, 0, 1, 3, 0))).toBe(true)
    expect(inInstallWindow('night', new Date(2026, 0, 1, 5, 59))).toBe(true)
    expect(inInstallWindow('night', new Date(2026, 0, 1, 6, 0))).toBe(false)
  })
})
