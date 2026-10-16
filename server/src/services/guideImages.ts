import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDataset } from '../../../src/domain/types'

/**
 * The finished-build screenshots of the «Оружейник» guides (tarkov.help, src/data/tarkovHelpGunsmith.ts) kept on our
 * server (owner, 11.10.2026: «скачай эти картинки нам на сервер и бери их оттуда»): the desktop app shows images from
 * raidos.app only (src/app/contentSecurityPolicy.ts), so tarkov.help's own links stayed blank there. The catalog's links
 * become /v1/guide-images/<file>; each file is downloaded once — when the catalog first names it, or on the first request
 * for it — and stays next to the item images.
 */
const SOURCE = 'https://minio.tarkov.help/production/img/articles/'
/** A stored file: tarkov.help's own name (a UUID and the picture's extension). */
export const GUIDE_IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,120}\.(?:png|jpe?g|webp)$/
const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 20_000
/** A file that could not be downloaded is not asked for again sooner. */
const RETRY_MS = 30 * 60_000

export interface GuideImageMirrorOptions {
  directory: string
  /** Where the app finds the files, e.g. https://raidos.app/v1/guide-images. */
  publicBase: string
  fetcher?: typeof fetch
  now?: () => number
  log?: (message: string) => void
}

const sourceFile = (url: string) => {
  const file = url.startsWith(SOURCE) ? url.slice(SOURCE.length) : ''
  return GUIDE_IMAGE_FILE.test(file) ? file : undefined
}

const isPicture = (bytes: Buffer) => bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  || bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  || (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP')

async function readLimited(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('empty answer')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) { await reader.cancel(); throw new Error('too large') }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export class GuideImageMirror {
  /** Files the catalog names: the only ones fetched from tarkov.help. */
  private readonly named = new Set<string>()
  private readonly stored = new Set<string>()
  private readonly pending = new Map<string, Promise<boolean>>()
  private readonly failedAt = new Map<string, number>()

  constructor(private readonly options: GuideImageMirrorOptions) {}

  /** The catalog with each guide screenshot at our address; the files not stored yet are fetched in the background. */
  rewrite(catalog: AppDataset): AppDataset {
    const base = this.options.publicBase.replace(/\/$/, '')
    const fresh: string[] = []
    const quests = catalog.quests.map((quest) => {
      if (!quest.objectiveDetails?.some((objective) => objective.build?.guide?.image)) return quest
      return {
        ...quest,
        objectiveDetails: quest.objectiveDetails.map((objective) => {
          const build = objective.build
          const file = build?.guide?.image ? sourceFile(build.guide.image) : undefined
          if (!build?.guide || !file) return objective
          if (!this.named.has(file)) { this.named.add(file); fresh.push(file) }
          return { ...objective, build: { ...build, guide: { ...build.guide, image: `${base}/${file}` } } }
        }),
      }
    })
    if (fresh.length) void this.prefetch(fresh)
    return { ...catalog, quests }
  }

  /** The stored file's path, downloaded first when the catalog names it; undefined when there is none. */
  async file(name: string): Promise<string | undefined> {
    if (!GUIDE_IMAGE_FILE.test(name)) return undefined
    const path = join(this.options.directory, name)
    if (this.stored.has(name) || await stat(path).then((info) => info.isFile(), () => false)) {
      this.stored.add(name)
      return path
    }
    if (!this.named.has(name)) return undefined
    return await this.download(name) ? path : undefined
  }

  private async prefetch(names: string[]) {
    for (const name of names) await this.file(name).catch(() => undefined)
  }

  private now() { return this.options.now?.() ?? Date.now() }

  private download(name: string): Promise<boolean> {
    if (this.stored.has(name)) return Promise.resolve(true)
    const running = this.pending.get(name)
    if (running) return running
    const failed = this.failedAt.get(name)
    if (failed !== undefined && this.now() - failed < RETRY_MS) return Promise.resolve(false)
    const task = this.store(name).then(
      () => { this.stored.add(name); this.failedAt.delete(name); return true },
      (error: unknown) => {
        this.failedAt.set(name, this.now())
        this.options.log?.(`Guide image ${name}: ${error instanceof Error ? error.message : 'download failed'}`)
        return false
      },
    ).finally(() => this.pending.delete(name))
    this.pending.set(name, task)
    return task
  }

  private async store(name: string) {
    const response = await (this.options.fetcher ?? fetch)(`${SOURCE}${name}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'image/*', 'user-agent': 'RaidOS/0.6 (+https://raidos.app)' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('too large')
    const bytes = await readLimited(response, MAX_BYTES)
    if (!isPicture(bytes)) throw new Error('not a picture')
    await mkdir(this.options.directory, { recursive: true })
    const path = join(this.options.directory, name)
    const partial = `${path}.${process.pid}-${Date.now()}.part`
    try {
      await writeFile(partial, bytes)
      await rename(partial, path)
    } catch (error) {
      await rm(partial, { force: true })
      throw error
    }
  }
}
