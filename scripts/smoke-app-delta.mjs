// End-to-end check of the partial update on a real Electron (Linux, under xvfb-run):
//   npx tsc -p tsconfig.electron.json && xvfb-run -a node scripts/smoke-app-delta.mjs
// Builds a «packaged» owner app (the real dist-electron/electron/boot.js, deltaBoot.js and deltaInfo.js in
// resources/app.asar of a copy of node_modules/electron/dist), a newer players' release, stages the release with the real
// stageDelta (our own asar writer), then starts Electron: the staged build must start, see the owner's build-info.json,
// load an unpacked file and its page, and confirm itself; a staged build that cannot load must fall back to the exe's own
// build. Then the same for a player's copy (client edition): it starts only the release exactly as signed (a throwaway
// key stands in for the update key) and its own build when the staged archive was changed or is not signed.
import * as asar from '@electron/asar'
import { spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import * as fs from 'node:fs'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { canonicalDeltaPayload, stageDelta } = await import(join(root, 'dist-electron/electron/appDelta.js'))
const { deltaRoot, readDeltaState, writeDeltaState } = await import(join(root, 'dist-electron/electron/deltaBoot.js'))
const keys = generateKeyPairSync('ed25519')
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const work = mkdtempSync(join(tmpdir(), 'raidos-delta-smoke-'))
const OLD = 1791000000000, NEW = 1792000000000

function tree(dir, files) {
  for (const [path, data] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), data) }
  return dir
}
async function pack(files, out) {
  const src = tree(mkdtempSync(join(work, 'src-')), files)
  mkdirSync(dirname(out), { recursive: true })
  await asar.createPackageWithOptions(src, out, { unpack: '**/node_modules/native/**' })
}
const real = (name) => readFileSync(join(root, 'dist-electron/electron', name))
// A main.js that reports what it sees, loads a page and confirms itself the way electron/main.ts does.
const fakeMain = (label) => `
import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { confirmBoot, deltaRoot } from './deltaBoot.js'
import { helper } from './helper.js'
const here = dirname(fileURLToPath(import.meta.url))
const info = JSON.parse(readFileSync(join(here, '..', 'build-info.json'), 'utf8'))
const native = createRequire(import.meta.url)('../../node_modules/native/addon.cjs')
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false })
  window.webContents.once('did-finish-load', () => {
    const fs = createRequire(import.meta.url)('original-fs')
    confirmBoot(fs, deltaRoot(app.getPath('appData'), info.edition === 'client' ? 'client' : 'owner'), process.pid)
    console.log('SMOKE ' + JSON.stringify({ label: ${JSON.stringify(label)}, helper: helper(), edition: info.edition, build: info.build, emails: info.ownerEmails ?? [], native, packaged: app.isPackaged, userData: app.getPath('userData') }))
    app.quit()
  })
  window.loadFile(join(here, '..', '..', 'dist', 'index.html'))
})
`
const common = (label, info, extra = {}) => ({
  'package.json': JSON.stringify({ name: 'raidos-smoke', version: info.version, type: 'module', main: 'dist-electron/electron/boot.js' }),
  'dist/index.html': `<!doctype html><title>${label}</title>`,
  'dist-electron/build-info.json': JSON.stringify(info),
  'dist-electron/electron/boot.js': real('boot.js'),
  'dist-electron/electron/deltaBoot.js': real('deltaBoot.js'),
  'dist-electron/electron/deltaInfo.js': real('deltaInfo.js'),
  'dist-electron/electron/updateSigningKey.js': `export const UPDATE_SIGNING_PUBLIC_KEY = ${JSON.stringify(publicPem)}\n`,
  'dist-electron/electron/main.js': fakeMain(label),
  'dist-electron/electron/helper.js': `export const helper = () => ${JSON.stringify(label)}\n`,
  'node_modules/native/addon.cjs': `module.exports = ${JSON.stringify(`${label} unpacked`)}\n`,
  ...extra,
})

// The «exe»: Electron's own files with the owner's old build as resources/app.asar.
const exeDir = join(work, 'exe')
cpSync(join(root, 'node_modules/electron/dist'), exeDir, { recursive: true })
rmSync(join(exeDir, 'resources', 'default_app.asar'), { force: true })
// Electron counts itself packaged unless its binary is named «electron».
fs.renameSync(join(exeDir, 'electron'), join(exeDir, 'raidos'))
const ownerInfo = { version: '0.5.4', build: OLD, commit: 'old-production', edition: 'owner', ownerEmails: ['owner@example.com'] }
const big = { 'dist/assets/big.bin': Buffer.alloc(3 * 1024 * 1024, 7) }
await pack(common('packaged', ownerInfo, big), join(exeDir, 'resources', 'app.asar'))
const release = join(work, 'release', 'app.asar')
const playersInfo = { version: '0.5.5', build: NEW, commit: 'new-production', edition: 'client' }
await pack(common('staged', playersInfo, big), release)

const home = join(work, 'home')
const appData = join(home, '.config')
const updates = deltaRoot(appData)
const run = (exe = join(exeDir, 'raidos')) => {
  const result = spawnSync(exe, ['--no-sandbox', '--disable-gpu'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: appData }, encoding: 'utf8', timeout: 60_000 })
  const line = `${result.stdout}\n${result.stderr}`.split('\n').find((text) => text.startsWith('SMOKE '))
  if (!line) throw new Error(`Electron printed no result (exit ${result.status}):\n${result.stdout}\n${result.stderr}`)
  return JSON.parse(line.slice(6))
}
const expect = (ok, message) => { if (!ok) throw new Error(message); console.log(`ok  ${message}`) }

const first = run()
expect(first.label === 'packaged' && first.edition === 'owner' && first.packaged, 'no staged build: the exe\'s own build starts (packaged)')

// Stage the release the way the owner's app does, with our own asar writer.
const source = {
  range: async (start, end) => readFileSync(release).subarray(start, end + 1),
  unpacked: async (path) => readFileSync(join(`${release}.unpacked`, ...path.split('/'))),
}
const header = asar.getRawHeader(release)
const info = { format: 1, build: NEW, version: '0.5.5', commit: 'new-production', electron: 'x', asar: { size: fs.statSync(release).size, dataStart: 8 + header.headerSize }, resources: {} }
const staged = await stageDelta({ fs, info, source, localAsar: join(exeDir, 'resources', 'app.asar'), localBuildInfo: ownerInfo, outDir: join(updates, String(NEW)) })
expect(staged.downloaded < 64 * 1024, `staged with ${staged.downloaded} bytes downloaded of ${staged.total}`)
writeDeltaState(fs, updates, { current: { build: NEW, version: '0.5.5', commit: 'new-production', dir: String(NEW) } })

const second = run()
expect(second.label === 'staged' && second.helper === 'staged', 'the staged build starts, with its own modules')
expect(second.edition === 'owner' && second.build === NEW && second.emails[0] === 'owner@example.com', 'it is an owner build of the new release (owner e-mails kept)')
expect(second.native === 'staged unpacked', 'its unpacked files load from app.asar.unpacked next to it')
expect(readDeltaState(fs, updates).confirmed?.includes(NEW) && !readDeltaState(fs, updates).pending, 'the page loaded: the build is confirmed')

// A staged build whose code cannot load: marked bad, the exe's own build starts in the same launch.
const brokenBuild = NEW + 1
await pack(common('broken', { ...playersInfo, build: brokenBuild }, { 'dist-electron/electron/main.js': "import './missing.js'\n" }), join(updates, String(brokenBuild), 'app.asar'))
writeDeltaState(fs, updates, { current: { build: brokenBuild, version: '0.5.6', commit: 'broken', dir: String(brokenBuild) } })
const third = run()
expect(third.label === 'packaged', 'a staged build that does not load falls back to the exe\'s own build')
expect(readDeltaState(fs, updates).bad?.includes(brokenBuild), 'and is never started by itself again')

// A player's copy (owner, 11.10.2026): the players' old build in its exe, the release staged exactly as published.
const clientExeDir = join(work, 'client-exe')
cpSync(exeDir, clientExeDir, { recursive: true })
const clientOld = { ...playersInfo, version: '0.5.4', build: OLD, commit: 'old-production' }
await pack(common('client packaged', clientOld, big), join(clientExeDir, 'resources', 'app.asar'))
const clientExe = join(clientExeDir, 'raidos')
const clientUpdates = deltaRoot(appData, 'client')
const ownerState = JSON.stringify(readDeltaState(fs, updates))
const playersStart = run(clientExe)
expect(playersStart.label === 'client packaged' && playersStart.edition === 'client', 'player: no staged build, the exe\'s own build starts')

const archive = readFileSync(release)
const releaseInfo = { ...info, asar: { ...info.asar, sha256: sha256(archive), headerSha256: sha256(archive.subarray(0, info.asar.dataStart)) } }
const signedInfo = { ...releaseInfo, signature: sign(null, Buffer.from(canonicalDeltaPayload(releaseInfo), 'utf8'), keys.privateKey).toString('base64') }
const clientStaged = await stageDelta({ fs, info: signedInfo, source, localAsar: join(clientExeDir, 'resources', 'app.asar'), localBuildInfo: clientOld, outDir: join(clientUpdates, String(NEW)) })
expect(clientStaged.downloaded < 64 * 1024, `player: staged with ${clientStaged.downloaded} bytes downloaded of ${clientStaged.total}, byte for byte the release`)
writeDeltaState(fs, clientUpdates, { current: { build: NEW, version: '0.5.5', commit: 'new-production', dir: String(NEW) } })
const playersUpdated = run(clientExe)
expect(playersUpdated.label === 'staged' && playersUpdated.edition === 'client' && playersUpdated.build === NEW && playersUpdated.native === 'staged unpacked', 'player: the signed release starts, with its unpacked files')
expect(readDeltaState(fs, clientUpdates).confirmed?.includes(NEW), 'player: the page loaded, the build is confirmed')
expect(JSON.stringify(readDeltaState(fs, updates)) === ownerState, 'player: the owner\'s staged builds are kept apart')

const stagedArchive = join(clientUpdates, String(NEW), 'app.asar')
const changed = readFileSync(stagedArchive)
changed[20] ^= 0xff
writeFileSync(stagedArchive, changed)
expect(run(clientExe).label === 'client packaged', 'player: a changed staged archive never starts, the exe\'s own build does')
changed[20] ^= 0xff
writeFileSync(stagedArchive, changed)
const stagedInfo = join(clientUpdates, String(NEW), 'delta-info.json')
writeFileSync(stagedInfo, JSON.stringify(releaseInfo))
expect(run(clientExe).label === 'client packaged', 'player: an unsigned staged build never starts')
writeFileSync(stagedInfo, JSON.stringify(signedInfo))
expect(run(clientExe).label === 'staged', 'player: the signed release starts again once it is as published')

rmSync(work, { recursive: true, force: true })
console.log('partial update smoke test passed')
