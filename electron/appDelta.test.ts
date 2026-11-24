// @vitest-environment node
import * as asar from '@electron/asar'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { archiveChanges, classifyStagedBuild, coalesce, deltaMismatch, deltaSignatureValid, packageJsonOnlyVersion, PARALLEL_REQUESTS, parseBrotliIndex, parseDeltaInfo, pieces, RANGE_PIECE, readArchive, readPackedFile, stageDelta, STAGED_INFO, type DeltaInfo, type DeltaSource } from './appDelta'
import { entryAt, headerPickleSize, integrityOf, listFiles, parseHeader, serializeHeader, type AsarDirectory, type AsarFile } from './asarArchive'
import { stagedBuildVerified } from './deltaBoot'
import * as script from '../scripts/sign-client-release.mjs'

const require = createRequire(import.meta.url)
const { publishAppDelta } = require('../scripts/publish-app-delta.cjs') as { publishAppDelta: (options: { root: string; appOutDir: string }) => DeltaInfo | null }
/** A file of an archive; @electron/asar looks a path up by the system's separator (on Windows «\»). */
const extract = (archive: string, path: string) => asar.extractFile(archive, path.split('/').join(sep))

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

/** The owner's running copy (old build) and a release (new players' build, plus `added`) published like the VPS build does. */
async function scene(added: Record<string, string | Buffer> = {}) {
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
  symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'junction')
  const appOutDir = temp()
  await pack({
    'dist/index.html': '<div id="root"></div>',
    'dist/assets/boss.glb': BIG,
    'dist/assets/new-chunk.js': 'console.log("new")\n',
    'dist-electron/build-info.json': JSON.stringify(PLAYERS_INFO),
    'dist-electron/electron/main.js': 'export const version = "new"\n',
    'node_modules/native/addon.node': NATIVE,
    'node_modules/native/changed.js': 'module.exports = 2\n',
    ...added,
  }, join(appOutDir, 'resources', 'app.asar'))
  // elevate.exe: electron-builder's helper, signed anew by every build — never part of what a partial update must match.
  tree(join(appOutDir, 'resources'), { 'tessdata/rus.traineddata': 'model', 'koffi/win32_x64/koffi.node': 'MZ', 'elevate.exe': 'MZ helper' })
  const info = publishAppDelta({ root, appOutDir })
  if (!info) throw new Error('not published')
  const site = join(root, 'website', 'dist', 'app-delta')
  const log: Array<{ start: number; end: number } | string> = []
  const source: DeltaSource = {
    async range(start, end) { log.push({ start, end }); return readFileSync(join(site, 'app.asar')).subarray(start, end + 1) },
    async unpacked(path, _onData, range) {
      log.push(range ? `${path}@${range.start}-${range.end}` : path)
      const data = readFileSync(join(site, 'app.asar.unpacked', ...path.split('/')))
      return range ? data.subarray(range.start, range.end + 1) : data
    },
  }
  return { local, info, site, source, log, outDir: join(temp(), 'staged'), root, appOutDir }
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

describe('partial update of the owner app (owner, 10.10.2026)', () => {
  it('publishes the players\' archive with its manifest, and only for the players\' edition', async () => {
    const { info, site } = await scene()
    expect(parseDeltaInfo(JSON.parse(readFileSync(join(site, 'info.json'), 'utf8')))).toEqual(info)
    expect(info).toMatchObject({ format: 1, build: PLAYERS_INFO.build, version: '0.5.5', commit: 'new-production', resources: { 'tessdata/rus.traineddata': expect.any(String), 'koffi/win32_x64/koffi.node': expect.any(String) } })
    expect(info.resources).not.toHaveProperty(['elevate.exe'])
    // The archive's size, SHA-256 and header SHA-256: what a player's copy checks (signed by the release).
    const published = readFileSync(join(site, 'app.asar'))
    expect(info.asar).toEqual({ size: published.length, dataStart: 8 + asar.getRawHeader(join(site, 'app.asar')).headerSize, sha256: sha256(published), headerSha256: sha256(published.subarray(0, info.asar.dataStart)) })
    expect(readFileSync(join(site, 'app.asar.unpacked', 'node_modules', 'native', 'addon.node')).equals(NATIVE)).toBe(true)
    const owner = temp()
    await pack({ 'dist-electron/build-info.json': JSON.stringify(OWNER_INFO) }, join(owner, 'resources', 'app.asar'))
    const root = temp()
    tree(root, { 'website/dist/index.html': 'x' })
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'junction')
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
    expect(extract(staged, 'dist-electron/electron/main.js').toString()).toBe('export const version = "new"\n')
    expect(extract(staged, 'dist/assets/new-chunk.js').toString()).toBe('console.log("new")\n')
    expect(extract(staged, 'dist/assets/boss.glb').equals(BIG)).toBe(true)
    expect(JSON.parse(extract(staged, 'dist-electron/build-info.json').toString())).toEqual({ ...PLAYERS_INFO, edition: 'owner', ownerEmails: ['owner@example.com'] })
    expect(asar.listPackage(staged, { isPack: false }).sort()).toEqual(asar.listPackage(join(site, 'app.asar'), { isPack: false }).sort())
    expect(readFileSync(join(outDir, 'app.asar.unpacked', 'node_modules', 'native', 'addon.node')).equals(NATIVE)).toBe(true)
    expect(readFileSync(join(outDir, 'app.asar.unpacked', 'node_modules', 'native', 'changed.js'), 'utf8')).toBe('module.exports = 2\n')
    // Every file's integrity in the new header is right (Electron's own format).
    const header = asar.getRawHeader(staged).header as Parameters<typeof listFiles>[0]
    for (const { path, file } of listFiles(header)) {
      if (file.unpacked) continue
      expect(integrityOf(extract(staged, path)), path).toEqual(file.integrity)
    }
  })

  it('stops on a damaged download, a release that does not match its manifest, or a players\' copy without archive hashes', async () => {
    const { local, info, source, outDir } = await scene()
    const damaged: DeltaSource = { ...source, range: async (start, end) => { const data = Buffer.from(await source.range(start, end)); if (end - start > 100) data[data.length - 1] ^= 0xff; return data } }
    await expect(stageDelta({ fs, info, source: damaged, localAsar: local, localBuildInfo: OWNER_INFO, outDir })).rejects.toThrow('не совпадает с обновлением')
    await expect(stageDelta({ fs, info: { ...info, build: info.build + 1 }, source, localAsar: local, localBuildInfo: OWNER_INFO, outDir })).rejects.toThrow('build-info.json обновления')
    // A players' copy takes only a release whose archive hashes info.json carries (signed, electron/deltaInfo.ts).
    await expect(stageDelta({ fs, info: { ...info, asar: { size: info.asar.size, dataStart: info.asar.dataStart } }, source, localAsar: local, localBuildInfo: { ...OWNER_INFO, edition: 'client' }, outDir })).rejects.toThrow('нет контрольных сумм')
    await expect(stageDelta({ fs, info, source, localAsar: local, localBuildInfo: { ...OWNER_INFO, edition: 'other' }, outDir })).rejects.toThrow('неизвестная версия')
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

describe('partial update of a player\'s app (owner, 11.10.2026)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const PLAYERS_OLD = { ...PLAYERS_INFO, version: '0.5.4', build: OWNER_INFO.build, commit: 'old-production' }

  it('rebuilds the published archive byte for byte from its own files and keeps the signed manifest for the next start', async () => {
    const { local, info, site, source, log, outDir } = await scene()
    const signed = { ...info, signature: 'x'.repeat(86) + '==' }
    const result = await stageDelta({ fs, info: signed, source, localAsar: local, localBuildInfo: PLAYERS_OLD, outDir })
    expect(readFileSync(join(outDir, 'app.asar')).equals(readFileSync(join(site, 'app.asar')))).toBe(true)
    expect(result.downloaded).toBeLessThan(10_000)
    expect(log).not.toContain('node_modules/native/addon.node')
    expect(JSON.parse(readFileSync(join(outDir, STAGED_INFO), 'utf8'))).toEqual(signed)
    expect(readFileSync(join(outDir, 'app.asar.unpacked', 'node_modules', 'native', 'addon.node')).equals(NATIVE)).toBe(true)
    // A manifest whose archive hash is not this archive's: nothing is kept.
    await expect(stageDelta({ fs, info: { ...info, asar: { ...info.asar, sha256: 'f'.repeat(64) } }, source, localAsar: local, localBuildInfo: PLAYERS_OLD, outDir: join(temp(), 'other') })).rejects.toThrow('не совпадает с подписанным')
    await expect(stageDelta({ fs, info: { ...info, asar: { ...info.asar, headerSha256: 'f'.repeat(64) } }, source, localAsar: local, localBuildInfo: PLAYERS_OLD, outDir: join(temp(), 'other') })).rejects.toThrow('Заголовок обновления')
  })

  it('the release signs info.json only when it is the build\'s own; the staged build then starts', async () => {
    const { local, info, site, source, root, appOutDir, outDir } = await scene()
    const release = { build: info.build, version: info.version, commit: info.commit }
    const options = { deltaDir: site, resourcesDir: join(appOutDir, 'resources'), electronPackage: join(root, 'node_modules', 'electron', 'package.json'), release, privateKey, publicKey }
    const signed = script.signAppDelta(options)
    expect(signed).toEqual({ ...info, signature: expect.stringMatching(/==$/) })
    expect(deltaSignatureValid(parseDeltaInfo(signed)!, publicPem)).toBe(true)
    // Staged with the signed manifest, the build passes the start check (electron/deltaBoot.ts).
    await stageDelta({ fs, info: parseDeltaInfo(signed)!, source, localAsar: local, localBuildInfo: PLAYERS_OLD, outDir })
    expect(stagedBuildVerified(fs, outDir, info.build, publicPem)).toBe(true)
    // Another release, an info.json that does not describe the build, or an archive that is not the exe's: no signature.
    expect(() => script.signAppDelta({ ...options, release: { ...release, build: release.build + 1 } })).toThrow('differs from the signed exe')
    writeFileSync(join(site, 'info.json'), JSON.stringify({ ...info, resources: {} }))
    expect(() => script.signAppDelta(options)).toThrow('info.json differs from the build')
    writeFileSync(join(site, 'info.json'), JSON.stringify(info))
    appendFileSync(join(site, 'app.asar'), 'x')
    expect(() => script.signAppDelta(options)).toThrow('not the one the client exe was built from')
  })

  it('on the release it is signed next to the exe, and a problem with it never stops the exe\'s own signature', async () => {
    // The VPS release's layout: <build>/release-client/{exe, build-info.json, win-unpacked/resources}, <build>/website/dist.
    const { root, appOutDir } = await scene()
    const build = join(root, 'build')
    const unpacked = join(build, 'release-client', 'win-unpacked')
    cpSync(join(appOutDir, 'resources'), join(unpacked, 'resources'), { recursive: true })
    tree(build, { 'website/dist/index.html': '<div id="root"></div>', 'release-client/Raid OS 0.5.5.exe': 'MZ players exe', 'release-client/build-info.json': JSON.stringify(PLAYERS_INFO) })
    symlinkSync(join(process.cwd(), 'node_modules'), join(build, 'node_modules'), 'junction')
    expect(publishAppDelta({ root: build, appOutDir: unpacked })).not.toBeNull()
    const sign = () => script.signClientRelease({ exe: join(build, 'release-client', 'Raid OS 0.5.5.exe'), buildInfo: join(build, 'release-client', 'build-info.json'), privateKey, publicKey })
    const infoPath = join(build, 'website', 'dist', 'app-delta', 'info.json')
    expect((await sign()).signature).toMatch(/==$/)
    expect(deltaSignatureValid(parseDeltaInfo(JSON.parse(readFileSync(infoPath, 'utf8')))!, publicPem)).toBe(true)
    appendFileSync(join(build, 'website', 'dist', 'app-delta', 'app.asar'), 'x')
    expect((await sign()).signature).toMatch(/==$/)
    expect(JSON.parse(readFileSync(infoPath, 'utf8')).signature).toBeUndefined()
  })
})

describe('a faster partial update: brotli copies, several requests at once (owner, 03.11.2026: «обновление загружается очень медленно»)', () => {
  const PLAYER = { ...PLAYERS_INFO, version: '0.5.4', build: OWNER_INFO.build, commit: 'old-production' }
  // The app's own text a release changes: a page bundle and an unpacked script (the local server is one).
  const script = (name: string, kb: number) => Array.from({ length: kb * 16 }, (_, i) => `export const ${name}${i} = ${i * 7} // line\n`).join('')
  const BUNDLE = script('page', 60)
  const SERVER = script('server', 20)
  const TEXT = { 'dist/assets/index-new.js': BUNDLE, 'node_modules/native/changed.js': SERVER }
  const hashOf = (site: string, path: string) => (entryAt(asar.getRawHeader(join(site, 'app.asar')).header as AsarDirectory, path) as AsarFile).integrity!.hash
  /** The site's brotli/ as electron/deltaHttp.ts reads it. */
  const withCopies = (site: string, source: DeltaSource, log: Array<{ start: number; end: number } | string>): DeltaSource => ({
    ...source,
    async brotliIndex() { return JSON.parse(readFileSync(join(site, 'brotli', 'index.json'), 'utf8')) as unknown },
    async brotli(hash) { log.push(`br:${hash}`); return readFileSync(join(site, 'brotli', `${hash}.br`)) },
  })
  const ranges = (log: Array<{ start: number; end: number } | string>) => log.filter((entry): entry is { start: number; end: number } => typeof entry === 'object')

  it('the release publishes brotli copies of the header and of the app\'s own text files, by the SHA-256 of their bytes', async () => {
    const { info, site } = await scene(TEXT)
    const index = JSON.parse(readFileSync(join(site, 'brotli', 'index.json'), 'utf8')) as { format: number; build: number; files: Record<string, number> }
    expect(index).toMatchObject({ format: 1, build: PLAYERS_INFO.build })
    // Not the 2 MiB model (not text), small files or packed node_modules.
    expect(Object.keys(index.files).sort()).toEqual([info.asar.headerSha256, hashOf(site, 'dist/assets/index-new.js'), hashOf(site, 'node_modules/native/changed.js')].sort())
    for (const [hash, size] of Object.entries(index.files)) {
      const packed = readFileSync(join(site, 'brotli', `${hash}.br`))
      expect(packed.length).toBe(size)
      expect(sha256(brotliDecompressSync(packed))).toBe(hash)
    }
    expect(index.files[hashOf(site, 'dist/assets/index-new.js')]).toBeLessThan(BUNDLE.length / 3)
    // info.json stays exactly what the release signs.
    expect(Object.keys(JSON.parse(readFileSync(join(site, 'info.json'), 'utf8')) as object).sort()).toEqual(['asar', 'build', 'commit', 'electron', 'format', 'resources', 'version'])
  })

  it('takes the copies instead of the plain bytes and builds the same owner archive', async () => {
    const { local, info, site, source, log, outDir } = await scene(TEXT)
    const progress: number[] = []
    const result = await stageDelta({ fs, info, source: withCopies(site, source, log), localAsar: local, localBuildInfo: OWNER_INFO, outDir, onProgress: (done) => progress.push(done) })
    expect(log).toEqual(expect.arrayContaining([`br:${info.asar.headerSha256}`, `br:${hashOf(site, 'dist/assets/index-new.js')}`, `br:${hashOf(site, 'node_modules/native/changed.js')}`]))
    // Neither the header nor the two files plain.
    expect(log).not.toContain('node_modules/native/changed.js')
    const bundle = entryAt(asar.getRawHeader(join(site, 'app.asar')).header as AsarDirectory, 'dist/assets/index-new.js') as AsarFile
    const bundleAt = info.asar.dataStart + Number(bundle.offset)
    expect(ranges(log).every(({ start, end }) => start > 0 && (end < bundleAt || start >= bundleAt + bundle.size))).toBe(true)
    expect(result.downloaded).toBeLessThan((BUNDLE.length + SERVER.length) / 3)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(progress.at(-1)).toBe(result.downloaded)
    const staged = join(outDir, 'app.asar')
    expect(extract(staged, 'dist/assets/index-new.js').toString()).toBe(BUNDLE)
    expect(readFileSync(join(outDir, 'app.asar.unpacked', 'node_modules', 'native', 'changed.js'), 'utf8')).toBe(SERVER)
    expect(JSON.parse(extract(staged, 'dist-electron/build-info.json').toString())).toEqual({ ...PLAYERS_INFO, edition: 'owner', ownerEmails: ['owner@example.com'] })
    expect(asar.listPackage(staged, { isPack: false }).sort()).toEqual(asar.listPackage(join(site, 'app.asar'), { isPack: false }).sort())
  })

  it('a player\'s copy takes them too and still rebuilds the published archive byte for byte', async () => {
    const { local, info, site, source, log, outDir } = await scene(TEXT)
    await stageDelta({ fs, info, source: withCopies(site, source, log), localAsar: local, localBuildInfo: PLAYER, outDir })
    expect(readFileSync(join(outDir, 'app.asar')).equals(readFileSync(join(site, 'app.asar')))).toBe(true)
    expect(log).toContain(`br:${hashOf(site, 'dist/assets/index-new.js')}`)
  })

  it('a damaged copy, the site\'s page instead of one, or an index of another build: those bytes come plain', async () => {
    const { local, info, site, source, log, outDir } = await scene(TEXT)
    const copies = withCopies(site, source, log)
    const damaged: DeltaSource = { ...copies, brotli: async (hash, onData) => { const data = Buffer.from(await copies.brotli!(hash, onData)); data[data.length >> 1] ^= 0xff; return data } }
    await stageDelta({ fs, info, source: damaged, localAsar: local, localBuildInfo: PLAYER, outDir })
    expect(readFileSync(join(outDir, 'app.asar')).equals(readFileSync(join(site, 'app.asar')))).toBe(true)
    expect(log).toContain('node_modules/native/changed.js')
    expect(ranges(log)).toContainEqual({ start: 0, end: info.asar.dataStart - 1 })
    log.length = 0
    const page: DeltaSource = { ...copies, brotli: async () => Buffer.from('<!doctype html><div id="root"></div>') }
    await stageDelta({ fs, info, source: page, localAsar: local, localBuildInfo: PLAYER, outDir: join(temp(), 'page') })
    expect(ranges(log)).toContainEqual({ start: 0, end: info.asar.dataStart - 1 })
    log.length = 0
    const other: DeltaSource = { ...copies, brotliIndex: async () => ({ ...(await copies.brotliIndex!()) as object, build: info.build + 1 }) }
    await stageDelta({ fs, info, source: other, localAsar: local, localBuildInfo: PLAYER, outDir: join(temp(), 'other') })
    expect(log.some((entry) => typeof entry === 'string' && entry.startsWith('br:'))).toBe(false)
  })

  it('a big changed file comes in pieces over several connections at once, and a dropped request is asked again', async () => {
    const MOVIE = randomBytes(5 * 1024 * 1024)
    const MODULE = randomBytes(3 * 1024 * 1024)
    const { local, info, source, log, outDir } = await scene({ 'dist/assets/intro.mp4': MOVIE, 'node_modules/native/big.node': MODULE })
    let running = 0, most = 0
    const dropped = new Set<number>()
    const flaky: DeltaSource = { ...source, range: async (start, end, onData) => {
      most = Math.max(most, ++running)
      try {
        await new Promise((resolve) => setTimeout(resolve, 20))
        // Every request is cut once, after some bytes came.
        if (!dropped.has(start)) { dropped.add(start); onData?.(1000); throw new Error('socket hang up') }
        return await source.range(start, end)
      } finally { running-- }
    } }
    const progress: number[] = []
    const result = await stageDelta({ fs, info, source: flaky, localAsar: local, localBuildInfo: OWNER_INFO, outDir, retryDelay: 0, onProgress: (done) => progress.push(done) })
    expect(extract(join(outDir, 'app.asar'), 'dist/assets/intro.mp4').equals(MOVIE)).toBe(true)
    // The unpacked one (like the local server's 6 MB) too: 2 MiB + 1 MiB.
    expect(readFileSync(join(outDir, 'app.asar.unpacked', 'node_modules', 'native', 'big.node')).equals(MODULE)).toBe(true)
    expect(log).toEqual(expect.arrayContaining([`node_modules/native/big.node@0-${RANGE_PIECE - 1}`, `node_modules/native/big.node@${RANGE_PIECE}-${MODULE.length - 1}`]))
    const big = ranges(log).filter(({ start, end }) => end - start + 1 >= 1024 * 1024)
    expect(big).toHaveLength(3)
    expect(big.every(({ start, end }) => end - start + 1 <= RANGE_PIECE)).toBe(true)
    expect(most).toBeGreaterThan(1)
    expect(most).toBeLessThanOrEqual(PARALLEL_REQUESTS)
    expect(Math.max(...progress)).toBeLessThanOrEqual(result.downloaded)
    expect(progress.at(-1)).toBe(result.downloaded)
  })

  it('splits a request into pieces; reads only a brotli index of this build', () => {
    expect(pieces({ start: 0, end: 9 }, 4)).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 9 }])
    expect(pieces({ start: 5, end: 5 })).toEqual([{ start: 5, end: 5 }])
    expect(parseBrotliIndex({ format: 1, build: 5, files: { ['a'.repeat(64)]: 10, nothex: 5, ['b'.repeat(64)]: -1 } }, 5)).toEqual(new Map([['a'.repeat(64), 10]]))
    expect(parseBrotliIndex({ format: 1, build: 6, files: {} }, 5)).toBeNull()
    expect(parseBrotliIndex({ format: 2, build: 5, files: {} }, 5)).toBeNull()
    expect(parseBrotliIndex('<!doctype html>', 5)).toBeNull()
  })
})

describe('live update of the interface: which staged builds only change the page (owner, 17.10.2026)', () => {
  // A running build as electron-builder packs it, and a release changed in one place.
  const BASE: Record<string, string | Buffer> = {
    'package.json': JSON.stringify({ name: 'raid-os', version: '0.6.0-66', type: 'module', main: 'dist-electron/electron/boot.js', dependencies: { koffi: '2.9.0' } }),
    'dist/index.html': '<div id="root"></div><script type="module" src="./assets/index-a1.js"></script>',
    'dist/assets/index-a1.js': 'console.log("old page")\n',
    'dist/assets/boss.glb': BIG,
    'dist-electron/build-info.json': JSON.stringify({ ...PLAYERS_INFO, version: '0.6.0-66', build: 1791000000000 }),
    'dist-electron/electron/main.js': 'export const main = 1\n',
    'electron/preload.cjs': 'module.exports = 1\n',
    'node_modules/native/addon.node': NATIVE,
  }
  const release = (changes: Record<string, string | Buffer | null>) => {
    const files: Record<string, string | Buffer> = { ...BASE, 'dist-electron/build-info.json': JSON.stringify({ ...PLAYERS_INFO, version: '0.6.0-67', build: 1792000000000 }), 'package.json': String(BASE['package.json']).replace('0.6.0-66', '0.6.0-67') }
    for (const [path, data] of Object.entries(changes)) { if (data === null) delete files[path]; else files[path] = data }
    return files
  }
  async function classify(changes: Record<string, string | Buffer | null>, mismatch = '') {
    const [nextPath, runningPath] = [await pack(release(changes), join(temp(), 'next', 'app.asar')), await pack(BASE, join(temp(), 'running', 'app.asar'))]
    const [next, running] = [readArchive(fs, nextPath), readArchive(fs, runningPath)]
    const packages = [readPackedFile(fs, nextPath, next, 'package.json'), readPackedFile(fs, runningPath, running, 'package.json')]
    const packageVersionOnly = Boolean(packages[0] && packages[1] && packageJsonOnlyVersion(packages[0], packages[1]))
    return { kind: classifyStagedBuild(next.tree, running.tree, { mismatch, packageVersionOnly }), changes: archiveChanges(next.tree, running.tree).map((change) => change.path) }
  }

  it('the page and its assets (new, changed or removed files under dist/): renderer, whatever the version and build stamp say', async () => {
    const result = await classify({ 'dist/index.html': '<div id="root"></div><script type="module" src="./assets/index-b2.js"></script>', 'dist/assets/index-a1.js': null, 'dist/assets/index-b2.js': 'console.log("new page")\n' })
    expect(result.changes).toEqual(['dist-electron/build-info.json', 'dist/assets/index-a1.js', 'dist/assets/index-b2.js', 'dist/index.html', 'package.json'])
    expect(result.kind).toBe('renderer')
    // Only the version and build: nothing to switch, still safe.
    expect((await classify({})).kind).toBe('renderer')
  })

  it('the main process, preload, a dependency, an unpacked file, package.json beyond its version or another Electron: restart', async () => {
    expect((await classify({ 'dist/index.html': 'x', 'dist-electron/electron/main.js': 'export const main = 2\n' })).kind).toBe('restart')
    expect((await classify({ 'dist-electron/electron/ipcGuard.js': 'export {}\n' })).kind).toBe('restart')
    expect((await classify({ 'electron/preload.cjs': 'module.exports = 2\n' })).kind).toBe('restart')
    expect((await classify({ 'node_modules/native/addon.node': randomBytes(1024) })).kind).toBe('restart')
    expect((await classify({ 'node_modules/left-pad/index.js': 'module.exports = 1\n' })).kind).toBe('restart')
    expect((await classify({ 'package.json': String(BASE['package.json']).replace('"koffi":"2.9.0"', '"koffi":"2.10.0"') })).kind).toBe('restart')
    expect((await classify({ 'package.json': String(BASE['package.json']).replace('boot.js', 'main.js') })).kind).toBe('restart')
    expect((await classify({ 'dist/index.html': 'x' }, 'Electron 44.4.5 → 45.0.0')).kind).toBe('restart')
    // A file outside dist/ at the top level, or a release without its page.
    expect((await classify({ 'distillery.txt': 'x' })).kind).toBe('restart')
    expect((await classify({ 'dist/index.html': null })).kind).toBe('restart')
  })

  it('compares by path, kind and hash', () => {
    const file = (hash: string, extra: Partial<AsarFile> = {}): AsarFile => ({ size: 1, offset: '0', integrity: { algorithm: 'SHA256', hash, blockSize: 4194304, blocks: [hash] }, ...extra })
    const running = { files: { dist: { files: { 'a.js': file('1'.repeat(64)), 'b.js': file('2'.repeat(64)) } } } }
    // The same bytes moved to another path still count as a change at both paths; a link and an unpacked flag too.
    expect(archiveChanges({ files: { dist: { files: { 'a.js': file('1'.repeat(64)), 'c.js': file('2'.repeat(64)) } } } }, running).map((change) => change.path)).toEqual(['dist/b.js', 'dist/c.js'])
    expect(archiveChanges({ files: { dist: { files: { 'a.js': file('1'.repeat(64), { unpacked: true }), 'b.js': { link: '../x' } } } } }, running)).toEqual([{ path: 'dist/a.js', unpacked: true }, { path: 'dist/b.js', unpacked: false }])
    expect(classifyStagedBuild({ files: { dist: { files: { 'index.html': file('3'.repeat(64)), 'a.js': file('1'.repeat(64), { unpacked: true }) } } } }, { files: { dist: { files: { 'index.html': file('3'.repeat(64)), 'a.js': file('1'.repeat(64)) } } } }, { mismatch: '' })).toBe('restart')
    // A file without a hash is never «the same».
    expect(archiveChanges({ files: { 'x.js': { size: 1, offset: '0' } } }, { files: { 'x.js': { size: 1, offset: '0' } } })).toHaveLength(1)
  })

  it('package.json: only the version may differ', () => {
    expect(packageJsonOnlyVersion('{"name":"a","version":"1","main":"m"}', '{"main":"m","version":"2","name":"a"}')).toBe(true)
    expect(packageJsonOnlyVersion('{"name":"a","version":"1","type":"module"}', '{"name":"a","version":"2"}')).toBe(false)
    expect(packageJsonOnlyVersion('not json', '{}')).toBe(false)
    expect(packageJsonOnlyVersion('[]', '[]')).toBe(false)
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
    expect(integrityOf(extract(archive, 'dir/b.bin'))).toEqual(file.integrity)
    expect(integrityOf(Buffer.alloc(0)).blocks).toHaveLength(1)
  })
})
