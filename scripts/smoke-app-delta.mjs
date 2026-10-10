// End-to-end check of the owner's partial update on a real Electron (Linux, under xvfb-run):
//   npx tsc -p tsconfig.electron.json && xvfb-run -a node scripts/smoke-app-delta.mjs
// Builds a «packaged» owner app (the real dist-electron/electron/boot.js and deltaBoot.js in resources/app.asar of a
// copy of node_modules/electron/dist), a newer players' release, stages the release with the real stageDelta (our own
// asar writer), then starts Electron: the staged build must start, see the owner's build-info.json, load an unpacked
// file and its page, and confirm itself; a staged build that cannot load must fall back to the exe's own build.
import * as asar from '@electron/asar'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { stageDelta } = await import(join(root, 'dist-electron/electron/appDelta.js'))
const { deltaRoot, readDeltaState, writeDeltaState } = await import(join(root, 'dist-electron/electron/deltaBoot.js'))
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
    confirmBoot(fs, deltaRoot(app.getPath('appData')), process.pid)
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
const run = () => {
  const result = spawnSync(join(exeDir, 'raidos'), ['--no-sandbox', '--disable-gpu'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: appData }, encoding: 'utf8', timeout: 60_000 })
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

rmSync(work, { recursive: true, force: true })
console.log('partial update smoke test passed')
