import { createHash } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import { entryAt, headerPickleSize, integrityOf, isDirectory, listFiles, parseHeader, serializeHeader, sha256, type AsarDirectory, type AsarFile } from './asarArchive.js'

/**
 * Partial update of the owner's app (owner, 10.10.2026: «обновлялись только новые файлы, попробуй на серверном
 * приложении»). The release publishes the players' app.asar unchanged next to the site (scripts/publish-app-delta.cjs →
 * /app-delta/: app.asar, app.asar.unpacked/…, info.json). The owner's copy reads the new archive's header, takes every
 * file it already has (same SHA-256) from its own archive and downloads only the rest with HTTP Range requests, checking
 * each file against the header's SHA-256. dist-electron/build-info.json becomes the owner's (edition and owner e-mails of
 * the running copy), so the staged archive is an owner build. electron/boot.ts starts it next time (electron/deltaBoot.ts).
 *
 * Only when the Electron runtime and everything in resources outside the archive (OCR models, native modules) are the
 * same as in the running exe; otherwise the owner takes the whole new exe as before. No Electron imports (tests).
 */
export const DELTA_FORMAT = 1
export const BUILD_INFO_PATH = 'dist-electron/build-info.json'

export interface DeltaInfo {
  format: 1
  build: number
  version: string
  commit: string
  /** Electron version of the release: the staged archive runs on the exe's own runtime. */
  electron: string
  /** Size of the published app.asar and where its file data starts (8 + header pickle). */
  asar: { size: number; dataStart: number }
  /** SHA-256 of every file in resources outside app.asar / app.asar.unpacked, '/'-separated relative paths. */
  resources: Record<string, string>
}

const HEX64 = /^[a-f0-9]{64}$/
const SAFE_PATH = /^[A-Za-z0-9._@+ -]+(\/[A-Za-z0-9._@+ -]+)*$/

export function parseDeltaInfo(raw: unknown): DeltaInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const info = raw as Record<string, unknown>
  const asar = info.asar as Record<string, unknown> | undefined
  const resources = info.resources as Record<string, unknown> | undefined
  if (info.format !== DELTA_FORMAT || !Number.isSafeInteger(info.build) || (info.build as number) <= 0) return null
  if (typeof info.version !== 'string' || typeof info.commit !== 'string' || typeof info.electron !== 'string' || !info.electron) return null
  if (!asar || !Number.isSafeInteger(asar.size) || !Number.isSafeInteger(asar.dataStart) || (asar.size as number) <= 0) return null
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) return null
  for (const [path, hash] of Object.entries(resources)) if (!SAFE_PATH.test(path) || path.split('/').some((part) => part === '.' || part === '..') || typeof hash !== 'string' || !HEX64.test(hash)) return null
  return { format: 1, build: info.build as number, version: info.version, commit: info.commit, electron: info.electron, asar: { size: asar.size as number, dataStart: asar.dataStart as number }, resources: resources as Record<string, string> }
}

/** Why this copy cannot take the release in parts ('' when it can). */
export function deltaMismatch(info: DeltaInfo, local: { electron: string; resources: Record<string, string> }) {
  if (info.electron !== local.electron) return `Electron ${local.electron} → ${info.electron}`
  const names = new Set([...Object.keys(info.resources), ...Object.keys(local.resources)])
  for (const name of names) if (info.resources[name] !== local.resources[name]) return `resources/${name}`
  return ''
}

/** Where the bytes come from: the server's /app-delta/ files. */
export interface DeltaSource {
  /** Bytes start…end (inclusive) of the published app.asar. */
  range(start: number, end: number): Promise<Buffer>
  /** A file of the published app.asar.unpacked ('/'-separated path). */
  unpacked(path: string): Promise<Buffer>
}

/** File access for the archives (`original-fs` in Electron, where an .asar path is otherwise a folder). */
export interface DeltaFs {
  openSync(path: string, flags: string): number
  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number): number
  writeSync(fd: number, buffer: Buffer): number
  closeSync(fd: number): void
  readFileSync(path: string): Buffer
  writeFileSync(path: string, data: Buffer): void
  mkdirSync(path: string, options: { recursive: true }): unknown
  renameSync(from: string, to: string): void
  rmSync(path: string, options: { recursive: true; force: true }): void
}

export interface LocalArchive { tree: AsarDirectory; dataStart: number }

export function readArchive(fs: DeltaFs, path: string): LocalArchive {
  const fd = fs.openSync(path, 'r')
  try {
    const prefix = Buffer.alloc(8)
    fs.readSync(fd, prefix, 0, 8, 0)
    const size = headerPickleSize(prefix)
    const pickle = Buffer.alloc(size)
    if (fs.readSync(fd, pickle, 0, size, 8) !== size) throw new Error('asar: header cut short')
    return { tree: parseHeader(pickle), dataStart: 8 + size }
  } finally {
    fs.closeSync(fd)
  }
}

function readAt(fs: DeltaFs, fd: number, position: number, size: number) {
  const buffer = Buffer.alloc(size)
  let done = 0
  while (done < size) {
    const read = fs.readSync(fd, buffer, done, size - done, position + done)
    if (!read) throw new Error('asar: file cut short')
    done += read
  }
  return buffer
}

/** A downloaded or copied file must be exactly what the new header says. */
function checked(path: string, file: AsarFile, data: Buffer) {
  if (data.length !== file.size || sha256(data) !== file.integrity?.hash) throw new Error(`Файл ${path} не совпадает с обновлением`)
  return data
}

/** The new archive's file data in order: where each file's bytes come from. */
interface Part { path: string; file: AsarFile; from: 'local' | 'remote' | 'info'; at: number }

export interface DeltaPlan { parts: Part[]; unpacked: Array<{ path: string; file: AsarFile; local: string | null }>; download: number; total: number }

/** Which files of `remote` this copy has (same SHA-256 and size, packed or unpacked) and which bytes are to download. */
export function planDelta(remote: { tree: AsarDirectory; dataStart: number }, local: LocalArchive): DeltaPlan {
  const packed = new Map<string, number>()
  const unpackedLocal = new Map<string, string>()
  for (const { path, file } of listFiles(local.tree)) {
    const hash = file.integrity?.hash
    if (!hash) continue
    if (file.unpacked) unpackedLocal.set(`${hash}:${file.size}`, path)
    else if (file.offset !== undefined) packed.set(`${hash}:${file.size}`, local.dataStart + Number(file.offset))
  }
  const parts: Part[] = []
  const unpacked: DeltaPlan['unpacked'] = []
  let download = 0, total = 0
  for (const { path, file } of listFiles(remote.tree)) {
    if (!file.integrity?.hash || !HEX64.test(file.integrity.hash) || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`asar: ${path} без контрольной суммы`)
    total += file.size
    const key = `${file.integrity.hash}:${file.size}`
    if (file.unpacked) {
      const have = unpackedLocal.get(key) ?? null
      if (!have) download += file.size
      unpacked.push({ path, file, local: have })
      continue
    }
    if (file.offset === undefined || !/^[0-9]+$/.test(file.offset)) throw new Error(`asar: ${path} без смещения`)
    const at = remote.dataStart + Number(file.offset)
    if (path === BUILD_INFO_PATH) { parts.push({ path, file, from: 'info', at }); download += file.size; continue }
    const local = packed.get(key)
    if (local !== undefined) parts.push({ path, file, from: 'local', at: local })
    else { parts.push({ path, file, from: 'remote', at }); download += file.size }
  }
  parts.sort((a, b) => Number(a.file.offset) - Number(b.file.offset))
  return { parts, unpacked, download, total }
}

/** Adjacent downloads (gap under `gap` bytes) in one Range request. */
export function coalesce(parts: Array<{ at: number; size: number }>, gap = 256 * 1024) {
  const ranges: Array<{ start: number; end: number }> = []
  for (const part of [...parts].sort((a, b) => a.at - b.at)) {
    if (!part.size) continue
    const last = ranges[ranges.length - 1]
    if (last && part.at - (last.end + 1) <= gap) last.end = Math.max(last.end, part.at + part.size - 1)
    else ranges.push({ start: part.at, end: part.at + part.size - 1 })
  }
  return ranges
}

export interface StageOptions {
  fs: DeltaFs
  info: DeltaInfo
  source: DeltaSource
  /** The archive this copy runs (its app.asar; app.asar.unpacked next to it). */
  localAsar: string
  /** build-info.json of the running copy: its edition and owner e-mails go into the new one. */
  localBuildInfo: Record<string, unknown>
  /** Empty folder the new build goes to. */
  outDir: string
  onProgress?: (done: number, total: number) => void
}

/** Builds the new archive in `outDir`; returns how many bytes were downloaded. Throws (and leaves `outDir` to delete) on any mismatch. */
export async function stageDelta(options: StageOptions) {
  const { fs, info, source, localAsar, outDir } = options
  const prefix = await source.range(0, 7)
  const pickleSize = headerPickleSize(prefix)
  if (8 + pickleSize !== info.asar.dataStart) throw new Error('Заголовок обновления не совпадает с info.json')
  const remote = { tree: parseHeader(await source.range(8, 8 + pickleSize - 1)), dataStart: 8 + pickleSize }
  const local = readArchive(fs, localAsar)
  const plan = planDelta(remote, local)

  // The players' build-info.json of the release → the owner's: same build, version and commit.
  const infoEntry = entryAt(remote.tree, BUILD_INFO_PATH)
  if (!infoEntry || isDirectory(infoEntry) || 'link' in infoEntry || infoEntry.offset === undefined) throw new Error('В обновлении нет build-info.json')
  const infoAt = remote.dataStart + Number(infoEntry.offset)
  const players = JSON.parse(checked(BUILD_INFO_PATH, infoEntry, await source.range(infoAt, infoAt + infoEntry.size - 1)).toString('utf8')) as Record<string, unknown>
  if (players.edition !== 'client' || players.build !== info.build || players.commit !== info.commit || players.version !== info.version) throw new Error('build-info.json обновления не совпадает с выпуском')
  if (options.localBuildInfo.edition !== 'owner') throw new Error('Частичное обновление только для версии владельца')
  const ownerInfo = Buffer.from(JSON.stringify({ ...players, edition: 'owner', ...(Array.isArray(options.localBuildInfo.ownerEmails) ? { ownerEmails: options.localBuildInfo.ownerEmails } : {}) }), 'utf8')

  let done = 0
  const total = plan.download
  const progress = (bytes: number) => { done += bytes; options.onProgress?.(Math.min(done, total), total) }
  progress(infoEntry.size)

  // Download what is missing, a few Range requests for the whole archive.
  const remoteParts = plan.parts.filter((part) => part.from === 'remote')
  const fetched = new Map<number, Buffer>()
  for (const range of coalesce(remoteParts.map((part) => ({ at: part.at, size: part.file.size })))) {
    const bytes = await source.range(range.start, range.end)
    if (bytes.length !== range.end - range.start + 1) throw new Error('Сервер отдал неполный кусок обновления')
    for (const part of remoteParts) if (part.at >= range.start && part.at + part.file.size - 1 <= range.end) fetched.set(part.at, bytes.subarray(part.at - range.start, part.at - range.start + part.file.size))
    progress(range.end - range.start + 1)
  }

  // The new header: the release's tree, offsets in the same order, the owner's build-info.json.
  const tree = JSON.parse(JSON.stringify(remote.tree)) as AsarDirectory
  let offset = 0
  for (const part of plan.parts) {
    const entry = entryAt(tree, part.path) as AsarFile
    if (part.from === 'info') Object.assign(entry, { size: ownerInfo.length, integrity: integrityOf(ownerInfo) })
    entry.offset = String(offset)
    offset += entry.size
  }

  fs.mkdirSync(outDir, { recursive: true })
  const target = join(outDir, 'app.asar')
  const partial = `${target}.partial`
  const out = fs.openSync(partial, 'w')
  const input = fs.openSync(localAsar, 'r')
  try {
    fs.writeSync(out, serializeHeader(tree))
    for (const part of plan.parts) {
      const data = part.from === 'info' ? ownerInfo
        : part.from === 'local' ? checked(part.path, part.file, readAt(fs, input, part.at, part.file.size))
          : checked(part.path, part.file, fetched.get(part.at) ?? Buffer.alloc(0))
      fs.writeSync(out, data)
    }
  } finally {
    fs.closeSync(input)
    fs.closeSync(out)
  }

  // Unpacked files (native modules, the local server): copied from this copy or downloaded, each checked.
  const localUnpacked = `${localAsar}.unpacked`
  for (const item of plan.unpacked) {
    const destination = join(`${target}.unpacked`, ...item.path.split('/'))
    if (relative(join(outDir, 'app.asar.unpacked'), destination).startsWith(`..${sep}`)) throw new Error('asar: unsafe path')
    let data: Buffer
    if (item.local) data = checked(item.path, item.file, fs.readFileSync(join(localUnpacked, ...item.local.split('/'))))
    else { data = checked(item.path, item.file, await source.unpacked(item.path)); progress(item.file.size) }
    fs.mkdirSync(dirname(destination), { recursive: true })
    fs.writeFileSync(destination, data)
  }
  fs.renameSync(partial, target)
  return { downloaded: done, total: plan.total, archive: target }
}

/** SHA-256 of a file (streamed in 1 MiB pieces). */
export function fileSha256(fs: DeltaFs, path: string) {
  const hash = createHash('sha256')
  const fd = fs.openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    for (let position = 0; ;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position)
      if (!read) break
      hash.update(buffer.subarray(0, read))
      position += read
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}
