import { execFileSync } from 'node:child_process'
import { chmod, chown, copyFile, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { verify } from 'node:crypto'
import { approvedRun, assertLocalTree, deployPath, fileHash, hash, safeTarget, transaction } from './release-policy.mjs'
import { canonicalUpdatePayload, embeddedPublicKey, readSigningKey, signClientRelease } from './sign-client-release.mjs'

// Installed, root-owned copy only. Repository scripts are executed exclusively as raidos-build.
const config = JSON.parse(await readFile('/etc/raidos/release-config.json', 'utf8'))
const stateFile = '/var/lib/raidos-release/state.json'
const state = JSON.parse(await readFile(stateFile, 'utf8'))
const root = '/opt/tarkov-operations-companion'
const mirror = '/opt/raidos-release-mirror.git'
const command = (bin, args, options = {}) => execFileSync(bin, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, ...options })
const git = (...args) => command('git', ['--git-dir', mirror, ...args])
const repoUrl = `https://github.com/${config.repository}.git`
const head = command('git', ['ls-remote', '--exit-code', repoUrl, `refs/heads/${config.branch}`]).split(/\s/)[0]
if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid remote ref')
if (head === state.sourceCommit || head === state.failedCommit) process.exit(0)
const response = await fetch(`https://api.github.com/repos/${config.repository}/actions/workflows/production.yml/runs?branch=${encodeURIComponent(config.branch)}&event=push&per_page=10`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RaidOS-release-gate' }, signal: AbortSignal.timeout(15_000) })
if (!response.ok) throw new Error(`GitHub gate HTTP ${response.status}`)
const result = await response.json()
const green = result.workflow_runs?.find(run => approvedRun(run, head, config.repository, config.branch))
if (!green) process.exit(0)
git('fetch', '--no-tags', 'origin', `refs/heads/${config.branch}`)
if (git('rev-parse', 'FETCH_HEAD').trim() !== head) process.exit(0)
if (hash(Buffer.from(git('show', `${head}:.github/workflows/production.yml`))) !== config.workflowHash) throw new Error('Workflow changed: explicit operator review required')
git('merge-base', '--is-ancestor', state.sourceCommit, head)
const tree = git('ls-tree', '-r', head).trim().split('\n')
if (tree.some(line => line.startsWith('120000 ') || line.startsWith('160000 '))) throw new Error('Symlinks and submodules are not allowed in release source')
const files = git('diff', '--name-only', '-z', state.sourceCommit, head).split('\0').filter(Boolean).filter(deployPath)
async function pruneArtifacts(parent, pattern, keep) {
  const names = (await readdir(parent)).filter(name => pattern.test(name)).sort((a, b) => b.slice(-13).localeCompare(a.slice(-13)))
  for (const name of names.slice(keep)) {
    const path = join(parent, name)
    if (!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink()) throw new Error('Unexpected artifact path')
    await rm(path, { recursive: true })
  }
}
const changes = []
for (const file of files) {
  const target = await safeTarget(root, file)
  let before = null, after = null
  try { before = command('git', ['--git-dir', mirror, 'show', `${state.sourceCommit}:${file}`], { encoding: null }) } catch (error) { if (error.status !== 128) throw error }
  try { after = command('git', ['--git-dir', mirror, 'show', `${head}:${file}`], { encoding: null }) } catch (error) { if (error.status !== 128) throw error }
  if (await fileHash(target) !== (before === null ? null : hash(before))) throw new Error(`Production diverged: ${file}`)
  changes.push({ file, target, beforeHash: before === null ? null : hash(before), afterHash: after === null ? null : hash(after), after })
}
if (command('git', ['ls-remote', '--exit-code', repoUrl, `refs/heads/${config.branch}`]).split(/\s/)[0] !== head) process.exit(0)
if (files.length === 0 && !config.buildOnDocumentationChange) {
  await writeFile(`${stateFile}.new`, JSON.stringify({ ...state, sourceCommit: head, gateRun: green.id }), { mode: 0o600 })
  await rename(`${stateFile}.new`, stateFile)
  console.log(`Context-only update ${head.slice(0, 12)}; no release required`)
  process.exit(0)
}
const build = `/opt/raidos-builds/${head}-${Date.now()}`
await mkdir('/opt/raidos-builds', { recursive: true, mode: 0o755 })
await pruneArtifacts('/opt/raidos-builds', /^[a-f0-9]{40}-[0-9]{13}$/, 2)
const disk = await statfs('/opt')
if (disk.bavail * disk.bsize < 5 * 1024 ** 3) throw new Error('Less than 5 GiB free; stop before building')
const buildUid = Number(command('id', ['-u', 'raidos-build']).trim())
const buildGid = Number(command('id', ['-g', 'raidos-build']).trim())
await mkdir(build, { recursive: true, mode: 0o755 })
const archive = join(build, 'source.tar')
command('git', ['--git-dir', mirror, 'archive', '--format=tar', '--output', archive, head])
command('tar', ['-xf', archive, '-C', build])
await unlink(archive)
// The OCR models are vendor data, not user screenshots or database files.
await cp(join(root, 'electron/tessdata'), join(build, 'electron/tessdata'), { recursive: true, force: false })
command('chown', ['-R', 'raidos-build:raidos-build', build])
const publicResponse = await fetch('https://raidos.app/api/v1/entitlement/public-key', { signal: AbortSignal.timeout(10_000) })
if (!publicResponse.ok) throw new Error('Public entitlement key unavailable')
const publicKey = (await publicResponse.json()).publicKey
const cleanEnv = { PATH: process.env.PATH, HOME: '/var/lib/raidos-build', USER: 'raidos-build', LOGNAME: 'raidos-build', WINEDEBUG: '-all', CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_BUILDER_COMPRESSION_LEVEL: '3', RAIDOS_ENTITLEMENT_PUBLIC_KEY: publicKey }
const run = (bin, args, extra = {}, cwd = build) => command('runuser', ['-u', 'raidos-build', '--', bin, ...args], { cwd, env: { ...cleanEnv, ...extra }, timeout: 1_800_000, stdio: 'inherit' })
let backup
try {
  run('npm', ['ci'])
  run('npm', ['ci', '--prefix', 'server'])
  run('npm', ['run', 'build'], { OWNER_BUILD: '0' })
  run('npm', ['--prefix', 'website', 'run', 'build'], { VITE_API_URL: '/api', VITE_DOWNLOAD_URL: '/download/windows' })
  const version = JSON.parse(await readFile(join(build, 'package.json'), 'utf8')).version
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][a-zA-Z0-9]+)*$/.test(version)) throw new Error('Invalid application version')
  const infos = {}
  for (const edition of ['client', 'owner']) {
    run('node', ['scripts/write-build-info.mjs'], { OWNER_BUILD: edition === 'owner' ? '1' : '0', ...(edition === 'owner' ? { OWNER_EMAILS: config.ownerEmail } : {}) })
    const infoPath = join(build, 'dist-electron/build-info.json')
    const info = JSON.parse(await readFile(infoPath, 'utf8'))
    infos[edition] = { ...info, edition, version, commit: `${head}-production`, build: Date.now() }
    await writeFile(infoPath, JSON.stringify(infos[edition]))
    await chown(infoPath, buildUid, buildGid)
    run('node', ['node_modules/electron-builder/out/cli/cli.js', '--win', 'portable', '--x64', `--config.directories.output=release-${edition}`])
    await writeFile(join(build, `release-${edition}/build-info.json`), JSON.stringify(infos[edition]))
  }
  // Stop any build descendants before sealing artifacts; this user owns no other services.
  try { command('pkill', ['-u', 'raidos-build']) } catch (error) { if (error.status !== 1) throw error }
  await assertLocalTree(build)
  command('chown', ['-h', '-R', 'root:root', build])
  command('chmod', ['-R', 'go-w', build])
  const asar = createRequire(`${root}/package.json`)('@electron/asar')
  for (const edition of ['client', 'owner']) {
    const resources = join(build, `release-${edition}/win-unpacked/resources`)
    const app = join(resources, 'app.asar')
    const embedded = JSON.parse(asar.extractFile(app, 'dist-electron/build-info.json').toString())
    if (embedded.edition !== edition || embedded.commit !== infos[edition].commit || embedded.build !== infos[edition].build) throw new Error('Wrong packaged provenance')
    const updater = asar.extractFile(app, 'dist-electron/electron/appUpdate.js').toString()
    if (!updater.includes('startupConsumed') || !updater.includes('blockedByRaid')) throw new Error('Startup-only updater safety missing')
    for (const lang of ['rus', 'eng']) if ((await stat(join(resources, `tessdata/${lang}.traineddata`))).size < 1_000_000) throw new Error('OCR model missing')
    if ((await readFile(join(resources, 'koffi/win32_x64/koffi.node'))).subarray(0, 2).toString() !== 'MZ') throw new Error('Windows native module missing')
  }
  const client = join(build, `release-client/Raid OS ${version}.exe`)
  const owner = join(build, `release-owner/Raid OS ${version}.exe`)
  const manifest = await signClientRelease({ exe: client, buildInfo: join(build, 'release-client/build-info.json'), privateKey: readSigningKey({ RAIDOS_UPDATE_SIGNING_KEY_FILE: '/root/.raidos/update-signing-key.pem' }), publicKey: embeddedPublicKey(root) })
  const previous = JSON.parse(await readFile(join(root, 'website/dist/downloads/release.json'), 'utf8'))
  if (manifest.build <= previous.build) throw new Error('Non-increasing build number')
  if (git('show', `${head}:electron/updateSigningKey.ts`) !== await readFile(join(root, 'electron/updateSigningKey.ts'), 'utf8')) throw new Error('Update signing key rotation requires manual review')
  for (const change of changes) if (await fileHash(change.target) !== change.beforeHash) throw new Error(`Concurrent edit: ${change.file}`)
  backup = `/etc/raidos/auto-release-${Date.now()}`
  await mkdir(backup, { mode: 0o700 })
  const db = new DatabaseSync('/var/lib/raidos/companion.sqlite', { readOnly: true })
  try { db.exec(`VACUUM INTO '${backup}/companion.sqlite'`) } finally { db.close() }
  await chmod(join(backup, 'companion.sqlite'), 0o600)
  for (const [i, change] of changes.entries()) {
    change.saved = join(backup, `source-${i}`)
    if (change.beforeHash !== null) { const s = await stat(change.target); change.metadata = { mode: s.mode & 0o777, uid: s.uid, gid: s.gid }; await copyFile(change.target, change.saved); await chmod(change.saved, 0o600) }
  }
  await writeFile(join(backup, 'source.json'), JSON.stringify(changes.map(({ after, ...entry }) => entry)), { mode: 0o600 })
  await copyFile('/opt/raidos-private/RaidOSServer.exe', join(backup, 'owner.exe'))
  await chmod(join(backup, 'owner.exe'), 0o600)
  const dist = join(root, 'website/dist')
  const nextDist = join(root, `website/dist-next-${manifest.build}`)
  const oldDist = join(root, `website/dist-old-${manifest.build}`)
  const modules = join(root, 'server/node_modules')
  const nextModules = join(root, `server/node_modules-next-${manifest.build}`)
  const oldModules = join(root, `server/node_modules-old-${manifest.build}`)
  await cp(join(build, 'website/dist'), nextDist, { recursive: true })
  // Already-open browsers may still request chunks from the previous website build.
  await cp(join(dist, 'assets'), join(nextDist, 'assets'), { recursive: true, force: false, errorOnExist: false })
  await cp(join(dist, 'downloads'), join(nextDist, 'downloads'), { recursive: true })
  await copyFile(client, join(nextDist, 'downloads/RaidOSClient.exe'))
  await writeFile(join(nextDist, 'downloads/release.json'), JSON.stringify(manifest))
  await cp(join(build, 'server/node_modules'), nextModules, { recursive: true, dereference: false })
  let switchedDist = false, switchedModules = false
  const health = async () => {
    for (let i = 0; i < 25; i++) { try { const r = await fetch('https://raidos.app/api/health', { signal: AbortSignal.timeout(4000) }); const data = await r.json(); if (r.ok && data.ok && data.database) return } catch {} await new Promise(r => setTimeout(r, 1000)) }
    throw new Error('Production health failed')
  }
  const atomicCopy = async (source, target, mode = 0o644, uid = 0, gid = 0) => { await mkdir(dirname(target), { recursive: true }); await copyFile(source, `${target}.release-new`); await chmod(`${target}.release-new`, mode); await chown(`${target}.release-new`, uid, gid); await rename(`${target}.release-new`, target) }
  await transaction(async () => {
    for (const change of changes) {
      if (change.after === null) await unlink(change.target)
      else { const temp = join(backup, 'patch-bytes'); await writeFile(temp, change.after, { mode: 0o600 }); await atomicCopy(temp, change.target) }
    }
    await rename(modules, oldModules)
    try { await rename(nextModules, modules); switchedModules = true } catch (error) { await rename(oldModules, modules); throw error }
    command('systemctl', ['restart', 'raidos-api'])
    await health()
    const apiUid = Number(command('id', ['-u', 'raidos-api']).trim()), apiGid = Number(command('id', ['-g', 'raidos-api']).trim())
    await atomicCopy(owner, '/opt/raidos-private/RaidOSServer.exe', 0o600, apiUid, apiGid)
    await rename(dist, oldDist)
    try { await rename(nextDist, dist); switchedDist = true } catch (error) { await rename(oldDist, dist); throw error }
    const online = await fetch('https://raidos.app/download/version.json', { signal: AbortSignal.timeout(15_000) }).then(r => { if (!r.ok) throw new Error('Manifest unreachable'); return r.json() })
    if (online.build !== manifest.build || online.sha256 !== manifest.sha256 || !verify(null, Buffer.from(canonicalUpdatePayload(online)), embeddedPublicKey(root), Buffer.from(online.signature, 'base64'))) throw new Error('Published manifest mismatch')
    const download = await fetch('https://raidos.app/download/windows', { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
    if (!download.ok || Number(download.headers.get('content-length')) !== manifest.size || !download.headers.get('content-disposition')?.includes('attachment')) throw new Error('Direct download failed')
    const range = await fetch('https://raidos.app/download/windows', { headers: { Range: 'bytes=0-1' }, signal: AbortSignal.timeout(15_000) })
    if (range.status !== 206 || Buffer.from(await range.arrayBuffer()).toString() !== 'MZ') throw new Error('Executable range check failed')
    const page = await fetch('https://raidos.app/', { signal: AbortSignal.timeout(10_000) })
    if (!page.ok || !(await page.text()).includes('id="root"')) throw new Error('Website check failed')
    await health()
    await writeFile(`${stateFile}.new`, JSON.stringify({ sourceCommit: head, publishedSourceCommit: head, gateRun: green.id, build: manifest.build, releasedAt: new Date().toISOString(), backup }), { mode: 0o600 })
    await rename(`${stateFile}.new`, stateFile)
  }, async () => {
    for (const change of changes) { const current = await fileHash(change.target); if (current !== change.beforeHash && current !== change.afterHash) throw new Error(`Concurrent edit during rollback: ${change.file}`) }
    for (const change of changes) { if (change.beforeHash === null) await unlink(change.target).catch(e => { if (e.code !== 'ENOENT') throw e }); else await atomicCopy(change.saved, change.target, change.metadata.mode, change.metadata.uid, change.metadata.gid) }
    if (switchedDist) { await rename(dist, `${nextDist}-failed`); await rename(oldDist, dist) }
    if (switchedModules) { await rename(modules, `${nextModules}-failed`); await rename(oldModules, modules) }
    const s = await stat('/opt/raidos-private/RaidOSServer.exe')
    await atomicCopy(join(backup, 'owner.exe'), '/opt/raidos-private/RaidOSServer.exe', 0o600, s.uid, s.gid)
    command('systemctl', ['restart', 'raidos-api'])
    await health()
  })
  console.log(JSON.stringify({ release: 'success', commit: head, build: manifest.build, backup, databaseReplaced: false }))
  // Keep two filesystem rollback versions. Database backups are never pruned here.
  try {
    await pruneArtifacts(join(root, 'website'), /^dist-old-[0-9]{13}$/, 2)
    await pruneArtifacts(join(root, 'server'), /^node_modules-old-[0-9]{13}$/, 2)
  } catch { console.warn('Release succeeded; artifact cleanup needs operator review') }
} catch (error) {
  await writeFile(`${stateFile}.new`, JSON.stringify({ ...state, failedCommit: head, failureAt: new Date().toISOString(), ...(backup ? { failureBackup: backup } : {}) }), { mode: 0o600 })
  await rename(`${stateFile}.new`, stateFile)
  console.error(`Release ${head.slice(0, 12)} stopped: ${error.message}`)
  process.exitCode = 1
}
