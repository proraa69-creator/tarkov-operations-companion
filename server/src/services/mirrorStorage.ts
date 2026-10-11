import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const SLOT = /^[a-z0-9][a-z0-9_.-]{0,79}$/
const GENERATION_ID = /^[a-z0-9][a-z0-9_.-]{0,127}$/
const PART = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

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
  constructor(readonly code: 'mount-missing' | 'disk-full' | 'invalid-path' | 'invalid-manifest', message: string) { super(message) }
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

  async publish(transaction: MirrorTransaction, metadata?: Record<string, unknown>, smoke?: MirrorSmokeCheck) {
    const previous = this.publication
    let release!: () => void
    this.publication = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await this.publishLocked(transaction, metadata, smoke) }
    finally { release() }
  }

  async rollback(slot: string, smoke?: MirrorSmokeCheck): Promise<MirrorPublishResult> {
    if (!SLOT.test(slot)) throw new MirrorStorageError('invalid-path', 'Unsafe mirror slot')
    const previous = this.publication
    let release!: () => void
    this.publication = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
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
    } finally { release() }
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
    await rename(temporary, this.activePath)
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
