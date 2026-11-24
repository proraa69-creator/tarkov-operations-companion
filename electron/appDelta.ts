import { createHash } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import { brotliDecompress } from 'node:zlib'
import { entryAt, headerPickleSize, integrityOf, isDirectory, isLink, listFiles, MAX_HEADER_SIZE, parseHeader, serializeHeader, sha256, type AsarDirectory, type AsarFile } from './asarArchive.js'
import { STAGED_INFO, type DeltaInfo } from './deltaInfo.js'

export { canonicalDeltaPayload, DELTA_FORMAT, DELTA_PAYLOAD_PREFIX, deltaSignatureValid, parseDeltaInfo, STAGED_INFO, type DeltaInfo } from './deltaInfo.js'

/**
 * Partial update of the app (owner, 10.10.2026: «обновлялись только новые файлы», first the owner's copy, then «в основное
 * клиентское приложение»). The release publishes the players' app.asar unchanged next to the site
 * (scripts/publish-app-delta.cjs → /app-delta/: app.asar, app.asar.unpacked/…, info.json, brotli/). A copy reads the new
 * archive's header, takes every file it already has (same SHA-256) from its own archive and downloads only the rest —
 * several requests at a time, brotli copies where the release has them, else HTTP Range requests — checking each file
 * against the header's SHA-256. electron/boot.ts starts the staged build next time (electron/deltaBoot.ts).
 *
 *  - The owner's copy: dist-electron/build-info.json becomes the owner's (edition and owner e-mails of the running copy),
 *    so the staged archive is an owner build.
 *  - A player's copy: the staged archive is byte for byte the published one, whose size and SHA-256 info.json carries,
 *    and info.json must be signed with the update key (scripts/sign-app-delta.mjs) like the whole exe's version.json.
 *    Anything else and the player takes the whole exe as before.
 *
 * Only when the Electron runtime and everything in resources outside the archive (OCR models, native modules) are the
 * same as in the running exe; otherwise the whole new exe as before. No Electron imports (tests).
 */
export const BUILD_INFO_PATH = 'dist-electron/build-info.json'
const HEX64 = /^[a-f0-9]{64}$/

/** Why this copy cannot take the release in parts ('' when it can). */
export function deltaMismatch(info: DeltaInfo, local: { electron: string; resources: Record<string, string> }) {
  if (info.electron !== local.electron) return `Electron ${local.electron} → ${info.electron}`
  const names = new Set([...Object.keys(info.resources), ...Object.keys(local.resources)])
  for (const name of names) if (info.resources[name] !== local.resources[name]) return `resources/${name}`
  return ''
}

/**
 * Where the bytes come from: the server's /app-delta/ files (electron/deltaHttp.ts). `onData` hears the size of every
 * piece of a response as it arrives (the update window's progress and speed).
 */
export interface DeltaSource {
  /** Bytes start…end (inclusive) of the published app.asar. */
  range(start: number, end: number, onData?: (bytes: number) => void): Promise<Buffer>
  /** A file of the published app.asar.unpacked ('/'-separated path), or its bytes start…end (inclusive). */
  unpacked(path: string, onData?: (bytes: number) => void, range?: { start: number; end: number }): Promise<Buffer>
  /** brotli/index.json of the release as it came (parseBrotliIndex reads it), or null. */
  brotliIndex?(): Promise<unknown>
  /** brotli/<sha256>.br: the brotli copy of the bytes with this SHA-256. */
  brotli?(sha256: string, onData?: (bytes: number) => void): Promise<Buffer>
}

/**
 * The release's brotli copies (owner, 03.11.2026: «обновление загружается очень медленно»): scripts/publish-app-delta.cjs
 * packs the archive's header and the app's own text files a release usually changes (dist/, dist-electron/,
 * app.asar.unpacked) into /app-delta/brotli/<sha256>.br, a third of their size or less, and lists them in
 * brotli/index.json: { format, build, files: { SHA-256 of the original bytes: size of the copy } }. Neither is signed nor
 * trusted: a copy counts only when it unpacks to exactly the bytes the archive's header (for the header itself, info.json)
 * names; otherwise those bytes come plain. An index of another build is no index.
 */
export const BROTLI_FORMAT = 1

export function parseBrotliIndex(raw: unknown, build: number): Map<string, number> | null {
  if (!raw || typeof raw !== 'object') return null
  const index = raw as Record<string, unknown>
  const files = index.files as Record<string, unknown> | undefined
  if (index.format !== BROTLI_FORMAT || index.build !== build || !files || typeof files !== 'object' || Array.isArray(files)) return null
  const out = new Map<string, number>()
  for (const [hash, size] of Object.entries(files)) if (HEX64.test(hash) && Number.isSafeInteger(size) && (size as number) > 0) out.set(hash, size as number)
  return out
}

/** A brotli copy unpacked, or null unless it is exactly `size` bytes with this SHA-256 (never more than `size` is unpacked). */
function unbrotli(packed: Buffer, size: number, hash: string) {
  return new Promise<Buffer | null>((resolve) => brotliDecompress(packed, { maxOutputLength: Math.max(1, size) }, (error, data) => {
    resolve(!error && data.length === size && sha256(data) === hash ? data : null)
  }))
}

/**
 * Requests at a time — a far server gives each connection only so much (Bangkok ↔ the VPS: ~1.5 MB/s each, 03.11.2026) —
 * and the largest Range request: a big file comes in pieces over several connections at once.
 */
export const PARALLEL_REQUESTS = 6
export const RANGE_PIECE = 2 * 1024 * 1024
/** A request that fails (network, timeout, a cut response) is asked again, this many times in all. */
const ATTEMPTS = 3

/** A Range request in pieces of at most `piece` bytes. */
export function pieces(range: { start: number; end: number }, piece = RANGE_PIECE) {
  const out: Array<{ start: number; end: number }> = []
  for (let start = range.start; start <= range.end; start += piece) out.push({ start, end: Math.min(range.end, start + piece - 1) })
  return out
}

/** Runs the tasks, at most `limit` at a time, the biggest first; after a failure none starts any more and it is thrown. */
async function runAll(tasks: Array<{ bytes: number; run: () => Promise<void> }>, limit: number) {
  const queue = [...tasks].sort((a, b) => b.bytes - a.bytes)
  const stop = { failed: false, error: undefined as unknown }
  const worker = async () => {
    for (let task = queue.shift(); task && !stop.failed; task = queue.shift()) {
      try { await task.run() } catch (error) { if (!stop.failed) Object.assign(stop, { failed: true, error }) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker))
  if (stop.failed) throw stop.error
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

/** At most this much of this copy's own files is read and written at once while the new archive is built. */
const LOCAL_RUN = 16 * 1024 * 1024

function readAt(fs: DeltaFs, fd: number, position: number, size: number) {
  // Filled to the end or it throws: never handed out with old memory in it.
  const buffer = Buffer.allocUnsafe(size)
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

/**
 * Which files of `remote` this copy has (same SHA-256 and size, packed or unpacked) and which bytes are to download.
 * `ownerInfo`: build-info.json is replaced (the owner's copy) instead of taken as it is.
 */
export function planDelta(remote: { tree: AsarDirectory; dataStart: number }, local: LocalArchive, options: { ownerInfo?: boolean } = { ownerInfo: true }): DeltaPlan {
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
    if (path === BUILD_INFO_PATH && options.ownerInfo) { parts.push({ path, file, from: 'info', at }); download += file.size; continue }
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
  /** build-info.json of the running copy: the owner's edition and e-mails go into the new one; a player's copy stays as published. */
  localBuildInfo: Record<string, unknown>
  /** Empty folder the new build goes to. */
  outDir: string
  /** Bytes received so far and in all (brotli copies count as they come over the network), as they arrive. */
  onProgress?: (done: number, total: number) => void
  /** Pause before asking a failed request again, × the attempt (ms; tests: 0). */
  retryDelay?: number
}

/**
 * Builds the new archive in `outDir`; returns how many bytes were downloaded. Throws (and leaves `outDir` to delete) on any
 * mismatch. Owner, 03.11.2026 («обновление загружается очень медленно, … не обновляешь приложение кусочками»): the header
 * in one request and the changed files PARALLEL_REQUESTS at a time, as brotli copies where the release has them.
 */
export async function stageDelta(options: StageOptions) {
  const { fs, info, source, localAsar, outDir } = options
  const edition = options.localBuildInfo.edition
  if (edition !== 'owner' && edition !== 'client') throw new Error('Частичное обновление: неизвестная версия приложения')
  // A player's copy: the archive exactly as published (its SHA-256 is signed), nothing rewritten.
  const exact = edition === 'client'
  if (exact && (!info.asar.sha256 || !info.asar.headerSha256)) throw new Error('В info.json нет контрольных сумм архива')
  if (info.asar.dataStart < 16 || info.asar.dataStart > 8 + MAX_HEADER_SIZE) throw new Error('Заголовок обновления не совпадает с info.json')
  const retryDelay = options.retryDelay ?? 500

  let done = 0, total = 0
  const progress = (bytes: number) => { done += bytes; if (total) options.onProgress?.(Math.max(0, Math.min(done, total)), total) }
  /** One request, asked again when it fails; its bytes count as they arrive and are taken back when it fails. */
  const request = async (load: (onData: (bytes: number) => void) => Promise<Buffer>, expected?: number) => {
    for (let attempt = 1; ; attempt++) {
      let got = 0
      try {
        const data = await load((bytes) => { got += bytes; progress(bytes) })
        if (expected !== undefined && data.length !== expected) throw new Error('Сервер отдал неполный кусок обновления')
        progress(data.length - got)
        return data
      } catch (error) {
        progress(-got)
        if (attempt >= ATTEMPTS) throw error
        await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt))
      }
    }
  }
  const range = (start: number, end: number) => request((onData) => source.range(start, end, onData), end - start + 1)

  // The archive's header in one request: its brotli copy (1.7 MB → 0.4 MB) when the release has one, else plain.
  const index = source.brotli && source.brotliIndex ? parseBrotliIndex(await source.brotliIndex().catch(() => null), info.build) : null
  const headerHash = info.asar.headerSha256
  const headerCopy = headerHash ? index?.get(headerHash) : undefined
  const packedHeader = headerHash && headerCopy ? await source.brotli!(headerHash).catch(() => null) : null
  let header = headerHash && packedHeader && packedHeader.length === headerCopy ? await unbrotli(packedHeader, info.asar.dataStart, headerHash) : null
  const headerBytes = header && packedHeader ? packedHeader.length : info.asar.dataStart
  header ??= await range(0, info.asar.dataStart - 1)
  const pickleSize = headerPickleSize(header.subarray(0, 8))
  if (8 + pickleSize !== info.asar.dataStart) throw new Error('Заголовок обновления не совпадает с info.json')
  if (exact && sha256(header) !== info.asar.headerSha256) throw new Error('Заголовок обновления не совпадает с info.json')
  const remote = { tree: parseHeader(header.subarray(8)), dataStart: 8 + pickleSize }
  const local = readArchive(fs, localAsar)
  const plan = planDelta(remote, local, { ownerInfo: !exact })

  // The players' build-info.json of the release must be this release; the owner's copy turns it into its own.
  const infoEntry = entryAt(remote.tree, BUILD_INFO_PATH)
  if (!infoEntry || isDirectory(infoEntry) || 'link' in infoEntry || infoEntry.offset === undefined) throw new Error('В обновлении нет build-info.json')
  const infoAt = remote.dataStart + Number(infoEntry.offset)

  // What comes over the network, all of it PARALLEL_REQUESTS at a time: a brotli copy where the release has one, the
  // rest of the archive in Range requests (near files together, a big one in pieces), unpacked files whole.
  const remoteParts: Array<{ path: string; file: AsarFile; at: number }> = plan.parts.filter((part) => part.from === 'remote')
  if (!exact) remoteParts.push({ path: BUILD_INFO_PATH, file: infoEntry, at: infoAt })
  const fetched = new Map<number, Buffer>()
  const unpackedData = new Map<string, Buffer>()
  const rangeTasks = (parts: typeof remoteParts) => coalesce(parts.map((part) => ({ at: part.at, size: part.file.size }))).flatMap((span) => {
    const bytes = Buffer.allocUnsafe(span.end - span.start + 1)
    const slices = pieces(span)
    let left = slices.length
    return slices.map((slice) => ({ bytes: slice.end - slice.start + 1, run: async () => {
      (await range(slice.start, slice.end)).copy(bytes, slice.start - span.start)
      if (--left) return
      for (const part of parts) if (part.at >= span.start && part.at + part.file.size - 1 <= span.end) fetched.set(part.at, bytes.subarray(part.at - span.start, part.at - span.start + part.file.size))
    } }))
  })
  // A big unpacked file (the local server: 6 MB) in pieces too: one connection alone brought it at ~0.5 MB/s.
  const unpackedTasks = (item: { path: string; file: AsarFile }) => {
    if (item.file.size <= RANGE_PIECE) return [{ bytes: item.file.size, run: async () => { unpackedData.set(item.path, await request((onData) => source.unpacked(item.path, onData))) } }]
    const bytes = Buffer.allocUnsafe(item.file.size)
    const slices = pieces({ start: 0, end: item.file.size - 1 })
    let left = slices.length
    return slices.map((slice) => ({ bytes: slice.end - slice.start + 1, run: async () => {
      (await request((onData) => source.unpacked(item.path, onData, slice), slice.end - slice.start + 1)).copy(bytes, slice.start)
      if (!--left) unpackedData.set(item.path, bytes)
    } }))
  }
  const copies = new Map<string, { file: AsarFile; parts: typeof remoteParts; unpacked: Array<{ path: string; file: AsarFile }> }>()
  const copyOf = (file: AsarFile) => {
    const hash = file.integrity!.hash
    if (!index?.has(hash)) return null
    if (!copies.has(hash)) copies.set(hash, { file, parts: [], unpacked: [] })
    return copies.get(hash)!
  }
  const plainParts = remoteParts.filter((part) => { const copy = copyOf(part.file); copy?.parts.push(part); return !copy })
  const plainUnpacked = plan.unpacked.filter((item) => !item.local).filter((item) => { const copy = copyOf(item.file); copy?.unpacked.push(item); return !copy })
  const tasks = [...rangeTasks(plainParts), ...plainUnpacked.flatMap(unpackedTasks)]
  for (const [hash, copy] of copies) {
    const size = index!.get(hash)!
    tasks.push({ bytes: size, run: async () => {
      const packed = await request((onData) => source.brotli!(hash, onData)).catch(() => null)
      const data = packed && packed.length === size ? await unbrotli(packed, copy.file.size, hash) : null
      if (data) {
        for (const part of copy.parts) fetched.set(part.at, data)
        for (const item of copy.unpacked) unpackedData.set(item.path, data)
        return
      }
      // No good copy: these bytes plain, one request after another (the other connections go on).
      if (packed) progress(-packed.length)
      const plain = [...rangeTasks(copy.parts), ...copy.unpacked.flatMap(unpackedTasks)]
      total += plain.reduce((sum, task) => sum + task.bytes, 0) - size
      for (const task of plain) await task.run()
    } })
  }
  done = headerBytes
  total = headerBytes + tasks.reduce((sum, task) => sum + task.bytes, 0)
  progress(0)
  await runAll(tasks, PARALLEL_REQUESTS)

  const playersPart = plan.parts.find((part) => part.path === BUILD_INFO_PATH)
  const playersBytes = () => {
    if (!exact || playersPart?.from !== 'local') return fetched.get(infoAt) ?? Buffer.alloc(0)
    const fd = fs.openSync(localAsar, 'r')
    try { return readAt(fs, fd, playersPart.at, playersPart.file.size) } finally { fs.closeSync(fd) }
  }
  const players = JSON.parse(checked(BUILD_INFO_PATH, infoEntry, playersBytes()).toString('utf8')) as Record<string, unknown>
  if (players.edition !== 'client' || players.build !== info.build || players.commit !== info.commit || players.version !== info.version) throw new Error('build-info.json обновления не совпадает с выпуском')
  const ownerInfo = exact ? null : Buffer.from(JSON.stringify({ ...players, edition: 'owner', ...(Array.isArray(options.localBuildInfo.ownerEmails) ? { ownerEmails: options.localBuildInfo.ownerEmails } : {}) }), 'utf8')

  // The new header: the release's own (a player's copy), or its tree with the owner's build-info.json, offsets in the same order.
  let newHeader: Buffer = header
  if (ownerInfo) {
    const tree = JSON.parse(JSON.stringify(remote.tree)) as AsarDirectory
    let offset = 0
    for (const part of plan.parts) {
      const entry = entryAt(tree, part.path) as AsarFile
      if (part.from === 'info') Object.assign(entry, { size: ownerInfo.length, integrity: integrityOf(ownerInfo) })
      entry.offset = String(offset)
      offset += entry.size
    }
    newHeader = serializeHeader(tree)
  }

  fs.mkdirSync(outDir, { recursive: true })
  const target = join(outDir, 'app.asar')
  const partial = `${target}.partial`
  const out = fs.openSync(partial, 'w')
  const input = fs.openSync(localAsar, 'r')
  // A player's copy checks the whole archive against its signed SHA-256, the owner's copy each file it takes.
  const whole = exact ? createHash('sha256') : null
  let written = 0
  const write = (data: Buffer) => { fs.writeSync(out, data); whole?.update(data); written += data.length }
  try {
    write(newHeader)
    for (let i = 0; i < plan.parts.length;) {
      const part = plan.parts[i]
      // The release's header is kept as it is: every file must land exactly at its offset.
      if (exact && written !== remote.dataStart + Number(part.file.offset)) throw new Error('asar: файлы обновления идут не подряд')
      if (part.from !== 'local') {
        write(part.from === 'info' ? ownerInfo! : checked(part.path, part.file, fetched.get(part.at) ?? Buffer.alloc(0)))
        i++
        continue
      }
      // Files that lie one after another in this copy's archive too: one read and one write (thousands of them otherwise).
      let end = i + 1, size = part.file.size
      while (end < plan.parts.length && plan.parts[end].from === 'local' && plan.parts[end].at === part.at + size && size + plan.parts[end].file.size <= LOCAL_RUN) size += plan.parts[end++].file.size
      const run = readAt(fs, input, part.at, size)
      if (!exact) for (let j = i, offset = 0; j < end; offset += plan.parts[j++].file.size) checked(plan.parts[j].path, plan.parts[j].file, run.subarray(offset, offset + plan.parts[j].file.size))
      write(run)
      i = end
    }
  } finally {
    fs.closeSync(input)
    fs.closeSync(out)
  }
  if (whole && (written !== info.asar.size || whole.digest('hex') !== info.asar.sha256)) throw new Error('Собранный архив не совпадает с подписанным обновлением')

  // Unpacked files (native modules, the local server): copied from this copy or downloaded above, each checked.
  const localUnpacked = `${localAsar}.unpacked`
  for (const item of plan.unpacked) {
    const destination = join(`${target}.unpacked`, ...item.path.split('/'))
    if (relative(join(outDir, 'app.asar.unpacked'), destination).startsWith(`..${sep}`)) throw new Error('asar: unsafe path')
    const data = checked(item.path, item.file, item.local ? fs.readFileSync(join(localUnpacked, ...item.local.split('/'))) : unpackedData.get(item.path) ?? Buffer.alloc(0))
    fs.mkdirSync(dirname(destination), { recursive: true })
    fs.writeFileSync(destination, data)
  }
  fs.renameSync(partial, target)
  fs.writeFileSync(join(outDir, STAGED_INFO), Buffer.from(JSON.stringify(info), 'utf8'))
  return { downloaded: done, total: plan.total, archive: target }
}

/**
 * Live update of the interface (owner, 17.10.2026: «обновлялось в реальном времени, не закрывая приложение»): the paths
 * whose content differs between the staged archive and the running one — added, removed, another SHA-256 or size, moved
 * in or out of app.asar.unpacked, another symlink target. By path, not by content: planDelta reuses a file found anywhere.
 */
export function archiveChanges(next: AsarDirectory, running: AsarDirectory): Array<{ path: string; unpacked: boolean }> {
  const flat = (tree: AsarDirectory, prefix = '', out = new Map<string, { key: string; unpacked: boolean }>()) => {
    for (const [name, node] of Object.entries(tree.files)) {
      const path = prefix ? `${prefix}/${name}` : name
      if (isDirectory(node)) flat(node, path, out)
      else if (isLink(node)) out.set(path, { key: `link:${node.link}`, unpacked: false })
      else out.set(path, { key: `${node.unpacked ? 'u' : 'p'}:${node.integrity?.hash ?? '?'}:${node.size}:${node.executable ? 'x' : ''}`, unpacked: Boolean(node.unpacked) })
    }
    return out
  }
  const [a, b] = [flat(next), flat(running)]
  const changes: Array<{ path: string; unpacked: boolean }> = []
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const [x, y] = [a.get(path), b.get(path)]
    // A file whose hash is unknown is never «the same».
    if (!x || !y || x.key !== y.key || x.key.includes(':?:')) changes.push({ path, unpacked: Boolean(x?.unpacked || y?.unpacked) })
  }
  return changes.sort((x, y) => x.path.localeCompare(y.path))
}

/** Where the renderer page lives inside an archive (electron/ipcGuard.ts APP_INDEX_FILE). */
export const RENDERER_INDEX_PATH = 'dist/index.html'

/** package.json of two builds differs only in "version" (every release bumps it; Electron reads only "main" and "type"). */
export function packageJsonOnlyVersion(next: Buffer | string, running: Buffer | string) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])])) : value
  try {
    const [a, b] = [JSON.parse(next.toString()) as unknown, JSON.parse(running.toString()) as unknown]
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false
    const [restA, restB] = [{ ...a as Record<string, unknown> }, { ...b as Record<string, unknown> }]
    delete restA.version
    delete restB.version
    return JSON.stringify(canonical(restA)) === JSON.stringify(canonical(restB))
  } catch {
    return false
  }
}

/**
 * renderer: the staged build differs from the running one only in the page (packed files under dist/), so the open
 * window can load the staged dist/index.html with the main process and preload it already runs — nothing it talks to
 * changed. restart: anything else (dist-electron/**, electron/preload.cjs, node_modules, an unpacked file, package.json
 * beyond its version, another Electron or other files outside the archive: `mismatch`, see deltaMismatch) — the staged
 * build waits for the next start. dist-electron/build-info.json always differs (the build's own stamp) and is ignored:
 * the renderer's build is tracked apart (electron/appUpdate.ts). `packageVersionOnly`: packageJsonOnlyVersion of the two.
 */
export function classifyStagedBuild(next: AsarDirectory, running: AsarDirectory, options: { mismatch: string; packageVersionOnly?: boolean }): 'renderer' | 'restart' {
  if (options.mismatch) return 'restart'
  const index = entryAt(next, RENDERER_INDEX_PATH)
  if (!index || isDirectory(index) || isLink(index) || index.unpacked) return 'restart'
  for (const { path, unpacked } of archiveChanges(next, running)) {
    if (unpacked) return 'restart'
    if (path === BUILD_INFO_PATH || (path === 'package.json' && options.packageVersionOnly)) continue
    if (!path.startsWith('dist/')) return 'restart'
  }
  return 'renderer'
}

/** A packed file's bytes from an archive read with readArchive, or null (missing, unpacked, a link). */
export function readPackedFile(fs: DeltaFs, path: string, archive: LocalArchive, name: string) {
  const entry = entryAt(archive.tree, name)
  if (!entry || isDirectory(entry) || isLink(entry) || entry.unpacked || entry.offset === undefined) return null
  const fd = fs.openSync(path, 'r')
  try {
    return readAt(fs, fd, archive.dataStart + Number(entry.offset), entry.size)
  } finally {
    fs.closeSync(fd)
  }
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
