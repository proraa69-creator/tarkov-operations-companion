import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MirrorStorage, MirrorStorageError } from './mirrorStorage.js'

const free = async () => 10 * 1024 ** 3

async function temporary(t: test.TestContext, options: Partial<ConstructorParameters<typeof MirrorStorage>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'raidos-mirror-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return new MirrorStorage({ root, minFreeBytes: 1, freeBytes: free, ...options })
}

test('mirror storage: publishes current and previous atomically and removes the third generation', async (t) => {
  const storage = await temporary(t)
  const one = await storage.begin('prices-pvp'); await one.write('prices.json', '{"price":1}'); const first = await one.publish()
  const two = await storage.begin('prices-pvp'); await two.write('prices.json', '{"price":2}'); const second = await two.publish()
  assert.deepEqual((await storage.active()).slots['prices-pvp'], { current: second.id, previous: first.id })
  assert.equal((await storage.read('prices-pvp', 'prices.json'))?.toString(), '{"price":2}')
  const three = await storage.begin('prices-pvp'); await three.write('prices.json', '{"price":3}'); const third = await three.publish()
  assert.deepEqual((await storage.active()).slots['prices-pvp'], { current: third.id, previous: second.id })
  await assert.rejects(readFile(join(storage.root, 'snapshots', 'generations', first.id, 'prices.json')))
})

test('mirror storage: aborted and unfinished staging never changes current', async (t) => {
  const storage = await temporary(t)
  const good = await storage.begin('dataset-regular'); await good.write('items.json', '{"ok":true}'); const generation = await good.publish()
  const failed = await storage.begin('dataset-regular'); await failed.write('items.json', '{"ok":false}'); await failed.abort()
  assert.equal((await storage.active()).slots['dataset-regular']?.current, generation.id)
  assert.equal((await storage.read('dataset-regular', 'items.json'))?.toString(), '{"ok":true}')
})

test('mirror storage: skips a generation when file content is unchanged', async (t) => {
  const storage = await temporary(t)
  const first = await storage.begin('dataset-regular'); await first.write('items.json', '{"ok":true}'); const published = await first.publish({ revision: 1 })
  const duplicate = await storage.begin('dataset-regular'); await duplicate.write('items.json', '{"ok":true}'); const skipped = await duplicate.publish({ revision: 2 })
  assert.equal(published.published, true)
  assert.equal(skipped.published, false)
  assert.equal(skipped.id, published.id)
  assert.deepEqual((await storage.active()).slots['dataset-regular'], { current: published.id })
})

test('mirror storage: verifies hashes and rejects corrupted generations', async (t) => {
  const storage = await temporary(t)
  const tx = await storage.begin('dataset-regular'); await tx.write('items.json', '{"ok":true}'); const generation = await tx.publish()
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(storage.root, 'snapshots', 'generations', generation.id, 'items.json'), '{"ok":false}')
  await assert.rejects(storage.verify('dataset-regular'), (error: unknown) => error instanceof MirrorStorageError && error.code === 'invalid-manifest')
})

test('mirror storage: restores active state when publish smoke check fails', async (t) => {
  const storage = await temporary(t)
  const first = await storage.begin('dataset-regular'); await first.write('items.json', '{"version":1}'); const good = await first.publish()
  const second = await storage.begin('dataset-regular'); await second.write('items.json', '{"version":2}')
  await assert.rejects(second.publish({}, async () => { throw new Error('smoke failed') }), /smoke failed/)
  assert.deepEqual((await storage.active()).slots['dataset-regular'], { current: good.id })
  assert.equal((await storage.read('dataset-regular', 'items.json'))?.toString(), '{"version":1}')
})

test('mirror storage: rolls back to a verified previous generation', async (t) => {
  const storage = await temporary(t)
  const first = await storage.begin('dataset-regular'); await first.write('items.json', '{"version":1}'); const one = await first.publish()
  const second = await storage.begin('dataset-regular'); await second.write('items.json', '{"version":2}'); const two = await second.publish()
  const rolledBack = await storage.rollback('dataset-regular')
  assert.equal(rolledBack.id, one.id)
  assert.deepEqual((await storage.active()).slots['dataset-regular'], { current: one.id, previous: two.id })
  assert.equal((await storage.read('dataset-regular', 'items.json'))?.toString(), '{"version":1}')
})

test('mirror storage: publish and rollback share one lock', async (t) => {
  const storage = await temporary(t)
  const first = await storage.begin('dataset-regular'); await first.write('items.json', '{"version":1}'); await first.publish()
  const second = await storage.begin('dataset-regular'); await second.write('items.json', '{"version":2}'); const current = await second.publish()
  const third = await storage.begin('prices-regular'); await third.write('prices.json', '{"price":3}')
  let releaseSmoke!: () => void
  const smoke = new Promise<void>((resolve) => { releaseSmoke = resolve })
  const publishing = third.publish({}, async () => smoke)
  const rollingBack = storage.rollback('dataset-regular')
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal((await storage.active()).slots['dataset-regular']?.current, current.id)
  releaseSmoke()
  await Promise.all([publishing, rollingBack])
  assert.notEqual((await storage.active()).slots['dataset-regular']?.current, current.id)
})

test('mirror storage: concurrent publications keep every slot', async (t) => {
  const storage = await temporary(t)
  const data = await storage.begin('dataset-regular')
  const prices = await storage.begin('prices-regular')
  await Promise.all([data.write('items.json', '{}'), prices.write('prices.json', '{}')])
  const [dataGeneration, priceGeneration] = await Promise.all([data.publish(), prices.publish()])
  const active = await storage.active()
  assert.equal(active.slots['dataset-regular']?.current, dataGeneration.id)
  assert.equal(active.slots['prices-regular']?.current, priceGeneration.id)
})

test('mirror storage: refuses writes without the required mount or free space', async (t) => {
  const missing = await temporary(t, { requireMount: true, isMountPoint: async () => false })
  await assert.rejects(missing.begin('dataset-regular'), (error: unknown) => error instanceof MirrorStorageError && error.code === 'mount-missing')
  const full = await temporary(t, { freeBytes: async () => 0 })
  await assert.rejects(full.begin('dataset-regular'), (error: unknown) => error instanceof MirrorStorageError && error.code === 'disk-full')
})

test('mirror storage: rejects traversal and malformed active manifests', async (t) => {
  const storage = await temporary(t)
  const tx = await storage.begin('dataset-regular')
  await assert.rejects(tx.write('../secret', 'bad'), (error: unknown) => error instanceof MirrorStorageError && error.code === 'invalid-path')
  await tx.abort()
  const snapshots = join(storage.root, 'snapshots')
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(snapshots, { recursive: true })
  await writeFile(join(snapshots, 'active.json'), '{"version":1,"slots":{"bad":{"current":"../x"}}}')
  await assert.rejects(storage.active(), (error: unknown) => error instanceof MirrorStorageError && error.code === 'invalid-manifest')
})
