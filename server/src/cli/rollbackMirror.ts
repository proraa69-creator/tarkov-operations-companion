import { MirrorStorage } from '../services/mirrorStorage.js'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const IMAGE_GENERATION = /^[a-z0-9-]{8,80}$/

export async function rollbackItemImages(root: string) {
  const activePath = join(root, 'images', 'items', 'active.json')
  const active = JSON.parse(await readFile(activePath, 'utf8')) as { version?: unknown; current?: unknown; previous?: unknown }
  if (active.version !== 1 || typeof active.current !== 'string' || typeof active.previous !== 'string' || !IMAGE_GENERATION.test(active.current) || !IMAGE_GENERATION.test(active.previous)) throw new Error('images: no valid previous generation')
  const directory = join(root, 'images', 'items', 'generations', active.previous)
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as { items?: Record<string, { images?: Record<string, { file?: string; bytes?: number; sha256?: string }> }> }
  for (const row of Object.values(manifest.items ?? {})) for (const image of Object.values(row.images ?? {})) {
    if (typeof image.file !== 'string' || !/^[a-z0-9]{16,48}-(?:icon|grid)\.(?:webp|jpg|jpeg|png)$/.test(image.file) || !Number.isSafeInteger(image.bytes) || typeof image.sha256 !== 'string') throw new Error('images: invalid previous manifest')
    const bytes = await readFile(join(directory, image.file))
    if (bytes.length !== image.bytes || createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('images: previous generation failed integrity verification')
  }
  const temporary = `${activePath}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify({ version: 1, current: active.previous, previous: active.current })}\n`)
  await rename(temporary, activePath)
  return { slot: 'images', current: active.previous, previous: active.current }
}

export async function rollbackSlots(storage: MirrorStorage, requested: string[]) {
  const active = await storage.active()
  const slots = requested.includes('--all') ? Object.keys(active.slots).filter((slot) => active.slots[slot]?.previous) : requested
  if (!slots.length) throw new Error('Usage: raidos-mirror-rollback <slot...|--all>')
  const results: Array<{ slot: string; current: string; previous?: string }> = []
  for (const slot of slots) {
    const generation = await storage.rollback(slot)
    results.push({ slot, current: generation.id, previous: (await storage.active()).slots[slot]?.previous })
  }
  return results
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const root = env.RAIDOS_MIRROR_DIR || '/var/lib/raidos/map-mirror'
  const storage = new MirrorStorage({ root, requireMount: env.RAIDOS_MIRROR_REQUIRE_MOUNT === '1' })
  const imageRequested = argv.includes('images') || argv.includes('--all')
  const slots = argv.includes('--all') ? ['--all'] : argv.filter((slot) => slot !== 'images')
  const results = slots.length ? await rollbackSlots(storage, slots) : []
  const imageResult = imageRequested ? await rollbackItemImages(root).catch((error) => {
    if (argv.includes('--all') && /no valid previous/.test(String(error))) return null
    throw error
  }) : null
  if (imageResult) results.push(imageResult)
  for (const result of results) console.log(`${result.slot}: current=${result.current} previous=${result.previous ?? 'none'}`)
}
