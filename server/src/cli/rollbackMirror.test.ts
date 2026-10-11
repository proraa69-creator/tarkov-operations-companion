import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { rollbackItemImages, rollbackSlots } from './rollbackMirror.js'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { MirrorStorage, MirrorStorageError } from '../services/mirrorStorage.js'

test('mirror rollback command swaps verified generations and refuses corruption', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-rollback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000 })
  const one = await storage.begin('prices-regular'); await one.write('prices.json', 'one'); const first = await one.publish()
  const two = await storage.begin('prices-regular'); await two.write('prices.json', 'two'); const second = await two.publish()
  assert.deepEqual(await rollbackSlots(storage, ['prices-regular']), [{ slot: 'prices-regular', current: first.id, previous: second.id }])
  await writeFile(join(root, 'snapshots', 'generations', second.id, 'prices.json'), 'broken')
  await assert.rejects(rollbackSlots(storage, ['prices-regular']), (error: unknown) => error instanceof MirrorStorageError && error.code === 'invalid-manifest')
  assert.equal((await storage.active()).slots['prices-regular']?.current, first.id)
})

test('image rollback verifies files before swapping generations', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-image-rollback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const images = join(root, 'images', 'items'), file = '5447a9cd4bdc2dbd208b4567-icon.webp'
  const previous = join(images, 'generations', 'images-previous1')
  await mkdir(previous, { recursive: true })
  const bytes = Buffer.from('verified image')
  await writeFile(join(previous, file), bytes)
  await writeFile(join(previous, 'manifest.json'), JSON.stringify({ items: { item: { images: { icon: { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } } } }))
  await writeFile(join(images, 'active.json'), JSON.stringify({ version: 1, current: 'images-current11', previous: 'images-previous1' }))
  assert.deepEqual(await rollbackItemImages(root), { slot: 'images', current: 'images-previous1', previous: 'images-current11' })
})
