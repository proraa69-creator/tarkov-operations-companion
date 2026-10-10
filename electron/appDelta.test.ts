// @vitest-environment node
import * as asar from '@electron/asar'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { coalesce, deltaMismatch, parseDeltaInfo, stageDelta, type DeltaInfo, type DeltaSource } from './appDelta'
import { entryAt, headerPickleSize, integrityOf, listFiles, parseHeader, serializeHeader, type AsarFile } from './asarArchive'

const require = createRequire(import.meta.url)
const { publishAppDelta } = require('../scripts/publish-app-delta.cjs') as { publishAppDelta: (options: { root: string; appOutDir: string }) => DeltaInfo | null }

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'raidos-delta-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function tree(dir: string, files: Record<string, string | Buffer>) {
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), data)
  }
  return dir
}

async function pack(files: Record<string, string | Buffer>, out: string) {
  const src = tree(temp(), files)
  mkdirSync(dirname(out), { recursive: true })
  await asar.createPackageWithOptions(src, out, { unpack: '**/node_modules/native/**' })
  return out
}

const BIG = randomBytes(2 * 1024 * 1024)
const NATIVE = randomBytes(300 * 1024)
const OWNER_INFO = { version: '0.5.4', build: 1791000000000, commit: 'old-production', edition: 'owner', defaultServerUrl: 'https://raidos.app', ownerEmails: ['owner@example.com'] }
const PLAYERS_INFO = { version: '0.5.5', build: 1792000000000, commit: 'new-production', edition: 'client', defaultServerUrl: 'https://raidos.app' }

/** The owner's running copy (old build) and a release (new players' build) published like the VPS build does. */
async function scene() {
  const local = await pack({
    'dist/index.html': '<div id="root"></div>',
    'dist/assets/boss.glb': BIG,
    'dist-electron/build-info.json': JSON.stringify(OWNER_INFO),
    'dist-electron/electron/main.js': 'export const version = "old"\n',
    'node_modules/native/addon.node': NATIVE,
    'node_modules/native/old-only.js': 'module.exports = 1\n',
  }, join(temp(), 'running', 'app.asar'))
  const root = temp()
  tree(root, { 'website/dist/index.html': '<div id="root"></div>' })
  symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'))
  const appOutDir = temp()
  await pack({
    'dist/index.html': '<div id="root"></div>',
    'dist/assets/boss.glb': BIG,
    'dist/assets/new-chunk.js': 'console.log("new")\n',
    'dist-electron/build-info.json': JSON.stringify(PLAYERS_INFO),
    'dist-electron/electron/main.js': 'export const version = "new"\n',
    'node_modules/native/addon.node': NATIVE,
    'node_modules/native/changed.js': 'module.exports = 2\n',
  }, join(appOutDir, 'resources', 'app.asar'))
  tree(join(appOutDir, 'resources'), { 'tessdata/rus.traineddata': 'model', 'koffi/win32_x64/koffi.node': 'MZ' })
  const info = publishAppDelta({ root, appOutDir })
  if (!info) throw new Error('not published')
  const site = join(root, 'website', 'dist', 'app-delta')
  const log: Array<{ start: number; end: number } | string> = []
  const source: DeltaSource = {
    async range(start, end) { log.push({ start, end }); return readFileSync(join(site, 'app.asar')).subarray(start, end + 1) },
    async unpacked(path) { log.push(path); return readFileSync(join(site, 'app.asar.unpacked', ...path.split('/'))) },
  }
  return { local, info, site, source, log, outDir: join(temp(), 'staged') }
}

describe('partial update of the owner app (owner, 10.10.2026)', () => {
  it('publishes the players\' archive with its manifest, and only for the players\' edition', async () => {
    const { info, site } = await scene()
    expect(parseDeltaInfo(JSON.parse(readFileSync(join(site, 'info.json'), 'utf8')))).toEqual(info)
    expect(info).toMatchObject({ format: 1, build: PLAYERS_INFO.build, version: '0.5.5', commit: 'new-production', resources: { 'tessdata/rus.traineddata': expect.any(String), 'koffi/win32_x64/koffi.node': expect.any(String) } })
    expect(readFileSync(join(site, 'app.asar.unpacked', 'node_modules', 'native', 'addon.node')).equals(NATIVE)).toBe(true)
    const owner = temp()
    await pack({ 'dist-electron/build-info.json': JSON.stringify(OWNER_INFO) }, join(owner, 'resources', 'app.asar'))
    const root = temp()
    tree(root, { 'website/dist/index.html': 'x' })
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'))
    expect(publishAppDelta({ root, appOutDir: owner })).toBeNull()
  })

  it('downloads only the changed files and builds an owner archive of the new release', async () => {
    const { local, info, site, source, log, outDir } = await scene()
    const progress: number[] = []
    const result = await stageDelta({ fs, info, source, localAsar: local, localBuildInfo: OWNER_INFO, outDir, onProgress: (done) => progress.push(done) })
    // The 2 MiB model and the 300 KiB native module were already there: only the small changed files came over.
    expect(result.downloaded).toBeLessThan(10_000)
    expect(result.total).toBeGreaterThan(BIG.length + NATIVE.length)
    expect(log).toContain('node_modules/native/changed.js')
    expect(log).not.toContain('node_modules/native/addon.node')
    expect(progress.at(-1)).toBe(result.downloaded)
    const staged = join(outDir, 'app.asar')
    expect(asar.extractFile(staged, 'dist-electron/electron/main.js').toString()).toBe('export const version = "new"\n')
    expect(asar.extractFile(staged, 'dist/assets/new-chunk.js').toString()).toBe('console.log("new")\n')
    expect(asar.extractFile(staged, 'dist/assets/boss.glb').equals(BIG)).toBe(true)
    expect(JSON.parse(asar.extractFile(staged, 'dist-electron/build-info.json').toString())).toEqual({ ...PLAYERS_INFO, edition: 'owner', ownerEmails: ['owner@example.com'] })
    expect(asar.listPackage(staged, { isPack: false }).sort()).toEqual(asar.listPackage(join(site, 'app.asar'), { isPack: false }).sort())
    expect(readFileSync(join(outDir, 'app.asar.unpacked', 'node_modules', 'native', 'addon.node')).equals(NATIVE)).toBe(true)
    expect(readFileSync(join(outDir, 'app.asar.unpacked', 'node_modules', 'native', 'changed.js'), 'utf8')).toBe('module.exports = 2\n')
    // Every file's integrity in the new header is right (Electron's own format).
    const header = asar.getRawHeader(staged).header as Parameters<typeof listFiles>[0]
    for (const { path, file } of listFiles(header)) {
      if (file.unpacked) continue
      expect(integrityOf(asar.extractFile(staged, path)), path).toEqual(file.integrity)
    }
  })

  it('stops on a damaged download, a release that does not match its manifest, or a players\' copy', async () => {
    const { local, info, source, outDir } = await scene()
    const damaged: DeltaSource = { ...source, range: async (start, end) => { const data = Buffer.from(await source.range(start, end)); if (end - start > 100) data[data.length - 1] ^= 0xff; return data } }
    await expect(stageDelta({ fs, info, source: damaged, localAsar: local, localBuildInfo: OWNER_INFO, outDir })).rejects.toThrow('не совпадает с обновлением')
    await expect(stageDelta({ fs, info: { ...info, build: info.build + 1 }, source, localAsar: local, localBuildInfo: OWNER_INFO, outDir })).rejects.toThrow('build-info.json обновления')
    await expect(stageDelta({ fs, info, source, localAsar: local, localBuildInfo: { ...OWNER_INFO, edition: 'client' }, outDir })).rejects.toThrow('только для версии владельца')
  })

  it('needs the same Electron and the same files outside the archive', () => {
    const info = { electron: '44.4.5', resources: { 'tessdata/rus.traineddata': 'a'.repeat(64) } }
    expect(deltaMismatch(info as DeltaInfo, { electron: '44.4.5', resources: { 'tessdata/rus.traineddata': 'a'.repeat(64) } })).toBe('')
    expect(deltaMismatch(info as DeltaInfo, { electron: '44.4.4', resources: info.resources })).toContain('Electron')
    expect(deltaMismatch(info as DeltaInfo, { electron: '44.4.5', resources: { 'tessdata/rus.traineddata': 'b'.repeat(64) } })).toBe('resources/tessdata/rus.traineddata')
    expect(deltaMismatch(info as DeltaInfo, { electron: '44.4.5', resources: { ...info.resources, 'extra.dll': 'c'.repeat(64) } })).toBe('resources/extra.dll')
  })

  it('reads only a well-formed manifest (the site answers unknown paths with its page)', () => {
    expect(parseDeltaInfo('<!doctype html>')).toBeNull()
    expect(parseDeltaInfo({ format: 2, build: 1, version: 'x', commit: 'c', electron: '44', asar: { size: 1, dataStart: 16 }, resources: {} })).toBeNull()
    expect(parseDeltaInfo({ format: 1, build: 1, version: 'x', commit: 'c', electron: '44', asar: { size: 1, dataStart: 16 }, resources: { '../evil': 'a'.repeat(64) } })).toBeNull()
  })

  it('joins nearby downloads into one request', () => {
    expect(coalesce([{ at: 0, size: 10 }, { at: 12, size: 5 }, { at: 1_000_000, size: 1 }, { at: 50, size: 0 }], 100)).toEqual([{ start: 0, end: 16 }, { start: 1_000_000, end: 1_000_000 }])
  })
})

describe('asar header', () => {
  it('reads and writes the header exactly as @electron/asar', async () => {
    const archive = await pack({ 'a.txt': 'hello', 'dir/b.bin': randomBytes(5000) }, join(temp(), 'x.asar'))
    const bytes = readFileSync(archive)
    const size = headerPickleSize(bytes.subarray(0, 8))
    expect(size).toBe(asar.getRawHeader(archive).headerSize)
    const parsed = parseHeader(bytes.subarray(8, 8 + size))
    expect(parsed).toEqual(asar.getRawHeader(archive).header)
    expect(serializeHeader(parsed).equals(bytes.subarray(0, 8 + size))).toBe(true)
    const file = entryAt(parsed, 'dir/b.bin') as AsarFile
    expect(integrityOf(asar.extractFile(archive, 'dir/b.bin'))).toEqual(file.integrity)
    expect(integrityOf(Buffer.alloc(0)).blocks).toHaveLength(1)
  })
})
