import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const SLOT = /^[a-z0-9][a-z0-9_.-]{0,79}$/
const GENERATION_ID = /^[a-z0-9][a-z0-9_.-]{0,127}$/
const PART = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
/** A lock on active.json older than this is a leftover of a process killed mid-publish. */
const LOCK_STALE_MS = 10 * 60_000
/** How long a publish waits for another process's publish before it gives up. */
const LOCK_WAIT_MS = 10 * 60_000

export interface MirrorFileRecord { bytes: number; sha256: string }
export interface MirrorGeneration {
  id: string
  slot: string
  createdAt: string
  files: Record<string, MirrorFileRecord>
  metadata?: Record<string, unknown>
}
export interface MirrorSlot { current: string; previous?: string }
export interface MirrorActive { version: 1; slots: Record<string, MirrorSlot> }
export type MirrorPublishResult = MirrorGeneration & { published: boolean }
export type MirrorSmokeCheck = (generation: MirrorGeneration) => Promise<void>

export class MirrorStorageError extends Error {
  constructor(readonly code: 'mount-missing' | 'disk-full' | 'invalid-path' | 'invalid-manifest' | 'locked', message: string) { super(message) }
}

export interface MirrorStorageOptions {
  root: string
  requireMount?: boolean
  minFreeBytes?: number
  now?: () => Date
  isMountPoint?: (path: string) => Promise<boolean>
  freeBytes?: (path: string) => Promise<number>
}

function safeRelative(path: string) {
  const parts = path.replaceAll('\\', '/').split('/')
  if (!parts.length || parts.some((part) => !PART.test(part))) throw new MirrorStorageError('invalid-path', 'Unsafe mirror path')
  return parts.join('/')
}

async function linuxMountPoint(path: string) {
  if (process.platform !== 'linux') return false
  const wanted = resolve(path)
  const text = await readFile('/proc/self/mountinfo', 'utf8').catch(() => '')
  return text.split('\n').some((line) => {
    const fields = line.split(' ')
    const mount = fields[4]?.replaceAll('\\040', ' ').replaceAll('\\134', '\\')
    return mount ? resolve(mount) === wanted : false
  })
}

async function available(path: string) {
  const info = await statfs(path)
  return info.bavail * info.bsize
}

function parseActive(value: unknown): MirrorActive {
  const row = value && typeof value === 'object' ? value as { version?: unknown; slots?: unknown } : {}
  if (row.version !== 1 || !row.slots || typeof row.slots !== 'object' || Array.isArray(row.slots)) throw new MirrorStorageError('invalid-manifest', 'Invalid active mirror manifest')
  const slots: Record<string, MirrorSlot> = {}
  for (const [slot, value] of Object.entries(row.slots as Record<string, unknown>)) {
    const entry = value && typeof value === 'object' ? value as { current?: unknown; previous?: unknown } : {}
    if (!SLOT.test(slot) || typeof entry.current !== 'string' || !GENERATION_ID.test(entry.current) || (entry.previous !== undefined && (typeof entry.previous !== 'string' || !GENERATION_ID.test(entry.previous)))) throw new MirrorStorageError('invalid-manifest', 'Invalid mirror slot')
    slots[slot] = { current: entry.current, ...(entry.previous ? { previous: entry.previous } : {}) }
  }
  return { version: 1, slots }
}

function parseGeneration(value: unknown, expectedId?: string, expectedSlot?: string): MirrorGeneration {
  const row = value && typeof value === 'object' ? value as Partial<MirrorGeneration> : {}
  if (typeof row.id !== 'string' || !GENERATION_ID.test(row.id) || typeof row.slot !== 'string' || !SLOT.test(row.slot) || typeof row.createdAt !== 'string' || !row.files || typeof row.files !== 'object' || Array.isArray(row.files)) throw new MirrorStorageError('invalid-manifest', 'Invalid mirror generation manifest')
  if ((expectedId && row.id !== expectedId) || (expectedSlot && row.slot !== expectedSlot)) throw new MirrorStorageError('invalid-manifest', 'Mirror generation identity mismatch')
  const files: Record<string, MirrorFileRecord> = {}
  for (const [path, value] of Object.entries(row.files)) {
    const record = value && typeof value === 'object' ? value as Partial<MirrorFileRecord> : {}
    const safe = safeRelative(path)
    if (!Number.isSafeInteger(record.bytes) || (record.bytes ?? -1) < 0 || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new MirrorStorageError('invalid-manifest', 'Invalid mirror file record')
    files[safe] = { bytes: record.bytes!, sha256: record.sha256 }
  }
  return { id: row.id, slot: row.slot, createdAt: row.createdAt, files, ...(row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? { metadata: row.metadata } : {}) }
}

const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/** The locks this process holds now (their tokens): a lock of this process that is not among them is a leftover. */
const heldLocks = new Set<string>()

/** The owner of a lock file (`<pid> <token> <time>`) is gone: a dead process, or this one without that lock now. */
function lockOwnerGone(text: string) {
  const [pidText, token] = text.split(' ')
  const pid = Number(pidText)
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  if (pid === process.pid) return !token || !heldLocks.has(token)
  try { process.kill(pid, 0); return false }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
}

function sameFiles(left: Record<string, MirrorFileRecord>, right: Record<string, MirrorFileRecord>) {
  const leftPaths = Object.keys(left)
  const rightPaths = Object.keys(right)
  return leftPaths.length === rightPaths.length && leftPaths.every((path) => left[path]?.bytes === right[path]?.bytes && left[path]?.sha256 === right[path]?.sha256)
}

export class MirrorStorage {
  readonly root: string
  private readonly snapshots: string
  private readonly generations: string
  private readonly staging: string
  private readonly activePath: string
  private readonly now: () => Date
  private readonly minFreeBytes: number
  private readonly mountCheck: (path: string) => Promise<boolean>
  private readonly free: (path: string) => Promise<number>
  private publication = Promise.resolve()
  private activeCache?: { key: string; active: MirrorActive }

  constructor(private readonly options: MirrorStorageOptions) {
    this.root = resolve(options.root)
    this.snapshots = join(this.root, 'snapshots')
    this.generations = join(this.snapshots, 'generations')
    this.staging = join(this.root, 'staging')
    this.activePath = join(this.snapshots, 'active.json')
    this.now = options.now ?? (() => new Date())
    this.minFreeBytes = options.minFreeBytes ?? 3 * 1024 ** 3
    this.mountCheck = options.isMountPoint ?? linuxMountPoint
    this.free = options.freeBytes ?? available
  }

  async mountReady() { return !this.options.requireMount || this.mountCheck(this.root) }

  async info() {
    const mounted = await this.mountReady()
    const freeBytes = existsSync(this.root) ? await this.free(this.root).catch(() => null) : null
    return { mounted, required: Boolean(this.options.requireMount), freeBytes }
  }

  async ensureWritable() {
    if (!await this.mountReady()) throw new MirrorStorageError('mount-missing', 'RaidNVMe mirror mount is missing')
    await mkdir(this.root, { recursive: true })
    if (await this.free(this.root) < this.minFreeBytes) throw new MirrorStorageError('disk-full', 'Mirror disk has less than the required free space')
    await Promise.all([mkdir(this.generations, { recursive: true }), mkdir(this.staging, { recursive: true })])
  }

  async active(): Promise<MirrorActive> {
    try { return parseActive(JSON.parse(await readFile(this.activePath, 'utf8'))) }
    catch (error) {
      if (!existsSync(this.activePath)) return { version: 1, slots: {} }
      if (error instanceof MirrorStorageError) throw error
      throw new MirrorStorageError('invalid-manifest', 'Invalid active mirror manifest')
    }
  }

  async begin(slot: string) {
    if (!SLOT.test(slot)) throw new MirrorStorageError('invalid-path', 'Unsafe mirror slot')
    await this.ensureWritable()
    const id = `${slot}-${this.now().getTime().toString(36)}-${randomUUID().slice(0, 8)}`
    const dir = join(this.staging, id)
    await mkdir(dir, { recursive: false })
    return new MirrorTransaction(this, slot, id, dir)
  }

  async read(slot: string, path: string) {
    const active = await this.active()
    const id = active.slots[slot]?.current
    if (!id) return undefined
    return readFile(join(this.generations, id, safeRelative(path))).catch(() => undefined)
  }

  /**
   * The current generation of a slot, cheap enough for every request (the catalog's prices): active.json is parsed
   * again only once it was replaced — every publish and rollback renames a new file over it, which moves its inode,
   * time or size. Otherwise one stat.
   */
  async currentGeneration(slot: string): Promise<string | undefined> {
    const info = await stat(this.activePath).catch(() => undefined)
    if (!info) return undefined
    const key = `${info.ino}:${info.mtimeMs}:${info.size}`
    if (this.activeCache?.key !== key) this.activeCache = { key, active: await this.active() }
    return this.activeCache.active.slots[slot]?.current
  }

  /** A file of one generation (the one currentGeneration named), even if a newer one was published in between. */
  async readGeneration(id: string, path: string) {
    if (!GENERATION_ID.test(id)) return undefined
    return readFile(join(this.generations, id, safeRelative(path))).catch(() => undefined)
  }

  async generation(slot: string): Promise<MirrorGeneration | undefined> {
    const active = await this.active()
    const id = active.slots[slot]?.current
    if (!id) return undefined
    try { return parseGeneration(JSON.parse(await readFile(join(this.generations, id, 'manifest.json'), 'utf8')), id, slot) }
    catch { return undefined }
  }

  async verify(slot: string, id?: string): Promise<MirrorGeneration> {
    const generationId = id ?? (await this.active()).slots[slot]?.current
    if (!generationId) throw new MirrorStorageError('invalid-manifest', `Mirror slot ${slot} has no generation`)
    let manifest: MirrorGeneration
    try { manifest = parseGeneration(JSON.parse(await readFile(join(this.generations, generationId, 'manifest.json'), 'utf8')), generationId, slot) }
    catch (error) {
      if (error instanceof MirrorStorageError) throw error
      throw new MirrorStorageError('invalid-manifest', `Cannot read mirror generation ${generationId}`)
    }
    for (const [path, expected] of Object.entries(manifest.files)) {
      const bytes = await readFile(join(this.generations, generationId, path)).catch(() => undefined)
      if (!bytes || bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new MirrorStorageError('invalid-manifest', `Mirror generation ${generationId} failed integrity verification`)
    }
    return manifest
  }

  async discardStaging() {
    await mkdir(this.staging, { recursive: true })
    for (const name of await readdir(this.staging)) if (SLOT.test(name)) await rm(join(this.staging, name), { recursive: true, force: true })
  }

  async publish(transaction: MirrorTransaction, metadata?: Record<string, unknown>, smoke?: MirrorSmokeCheck): Promise<MirrorPublishResult> {
    const previous = this.publication
    let release!: () => void
    this.publication = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await this.acrossProcesses(() => this.publishLocked(transaction, metadata, smoke)) }
    finally { release() }
  }

  async rollback(slot: string, smoke?: MirrorSmokeCheck): Promise<MirrorPublishResult> {
    if (!SLOT.test(slot)) throw new MirrorStorageError('invalid-path', 'Unsafe mirror slot')
    const previous = this.publication
    let release!: () => void
    this.publication = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await this.acrossProcesses(() => this.rollbackLocked(slot, smoke)) }
    finally { release() }
  }

  private async rollbackLocked(slot: string, smoke?: MirrorSmokeCheck): Promise<MirrorPublishResult> {
    const active = await this.active()
    const old = active.slots[slot]
    if (!old?.previous) throw new MirrorStorageError('invalid-manifest', `Mirror slot ${slot} has no previous generation`)
    const target = await this.verify(slot, old.previous)
    const next: MirrorActive = { version: 1, slots: { ...active.slots, [slot]: { current: old.previous, previous: old.current } } }
    await this.writeActive(next)
    try { if (smoke) await smoke(target) }
    catch (error) {
      await this.writeActive(active)
      throw error
    }
    return { ...target, published: true }
  }

  /**
   * active.json is read, changed and replaced by more than one process (the API and the background worker, `npm run
   * worker`): each change holds `active.json.lock`, made with O_EXCL, so no process replaces it with a copy that misses
   * another one's slot. A lock whose process is gone, or older than LOCK_STALE_MS, is a leftover and is removed.
   */
  private async acrossProcesses<T>(work: () => Promise<T>): Promise<T> {
    const lock = `${this.activePath}.lock`
    await mkdir(dirname(lock), { recursive: true })
    const started = Date.now()
    const token = randomUUID()
    for (let attempt = 0; ; attempt += 1) {
      const handle = await open(lock, 'wx', 0o640).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
        return undefined
      })
      if (handle) {
        heldLocks.add(token)
        try {
          await handle.writeFile(`${process.pid} ${token} ${new Date().toISOString()}\n`)
          await handle.close()
        } catch (error) {
          heldLocks.delete(token)
          await handle.close().catch(() => undefined)
          await rm(lock, { force: true })
          throw error
        }
        break
      }
      if (await this.lockIsStale(lock)) { await rm(lock, { force: true }); continue }
      if (Date.now() - started > LOCK_WAIT_MS) throw new MirrorStorageError('locked', 'Another process holds the mirror for too long')
      await pause(Math.min(200, 20 + attempt * 10))
    }
    try { return await work() }
    finally {
      heldLocks.delete(token)
      await rm(lock, { force: true })
    }
  }

  private async lockIsStale(lock: string) {
    const [text, info] = await Promise.all([readFile(lock, 'utf8').catch(() => undefined), stat(lock).catch(() => undefined)])
    // Gone between the two calls: try again.
    if (!info || text === undefined) return false
    const old = Date.now() - info.mtimeMs > LOCK_STALE_MS
    // Still being written by its owner, unless that was long ago.
    if (!text.includes('\n')) return old
    return old || lockOwnerGone(text)
  }

  private async publishLocked(transaction: MirrorTransaction, metadata?: Record<string, unknown>, smoke?: MirrorSmokeCheck): Promise<MirrorPublishResult> {
    const active = await this.active()
    const old = active.slots[transaction.slot]
    if (old?.current) {
      const current = await this.verify(transaction.slot, old.current)
      if (sameFiles(current.files, transaction.files)) {
        await rm(transaction.dir, { recursive: true, force: true })
        return { ...current, published: false }
      }
    }
    const manifest: MirrorGeneration = { id: transaction.id, slot: transaction.slot, createdAt: this.now().toISOString(), files: transaction.files, ...(metadata ? { metadata } : {}) }
    await transaction.writeManifest(manifest)
    const target = join(this.generations, transaction.id)
    await rename(transaction.dir, target)
    await this.verify(transaction.slot, transaction.id)
    const next: MirrorActive = { version: 1, slots: { ...active.slots, [transaction.slot]: { current: transaction.id, ...(old?.current ? { previous: old.current } : {}) } } }
    await this.writeActive(next)
    try { if (smoke) await smoke(manifest) }
    catch (error) {
      await this.writeActive(active)
      throw error
    }
    if (old?.previous && old.previous !== transaction.id && old.previous !== old.current) await rm(join(this.generations, old.previous), { recursive: true, force: true })
    return { ...manifest, published: true }
  }

  private async writeActive(active: MirrorActive) {
    await mkdir(dirname(this.activePath), { recursive: true })
    const temporary = `${this.activePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(active)}\n`, { mode: 0o640 })
    // Windows refuses to replace a file another process is reading at that moment (the owner's desktop server, the
    // tests); Linux never does. A few short retries, then the error.
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temporary, this.activePath); return }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (attempt >= 20 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) {
          await rm(temporary, { force: true }).catch(() => undefined)
          throw error
        }
        await pause(10 + attempt * 5)
      }
    }
  }

  assertInside(path: string) {
    const rel = relative(this.root, resolve(path))
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new MirrorStorageError('invalid-path', 'Path is outside mirror root')
  }
}

export class MirrorTransaction {
  readonly files: Record<string, MirrorFileRecord> = {}
  private closed = false
  constructor(private readonly storage: MirrorStorage, readonly slot: string, readonly id: string, readonly dir: string) {}

  async write(path: string, data: string | Buffer) {
    if (this.closed) throw new Error('Mirror transaction is closed')
    const safe = safeRelative(path)
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const target = join(this.dir, safe)
    this.storage.assertInside(target)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, { mode: 0o640 })
    this.files[safe] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }

  async publish(metadata?: Record<string, unknown>, smoke?: MirrorSmokeCheck) {
    if (this.closed) throw new Error('Mirror transaction is closed')
    this.closed = true
    return this.storage.publish(this, metadata, smoke)
  }

  async abort() {
    if (this.closed) return
    this.closed = true
    await rm(this.dir, { recursive: true, force: true })
  }

  async writeManifest(manifest: MirrorGeneration) {
    await writeFile(join(this.dir, 'manifest.json'), `${JSON.stringify(manifest)}\n`, { mode: 0o640 })
  }
}
