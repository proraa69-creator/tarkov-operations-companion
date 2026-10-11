import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MirrorStorage } from '../services/mirrorStorage.js'
import { ProgressStore } from '../services/progressStore.js'
import { createApi } from '../app.js'

test('data mirror status is public and exposes no local path', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-status-')); t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 12345 })
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, undefined, { mirrorStorage: storage }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  t.after(() => { server.close(); store.close() })
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/data/mirror/status`)
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.doesNotMatch(text, /raidos-status|tmpdir|tarkov\.dev/i)
  assert.equal(JSON.parse(text).disk.freeBytes, 12345)
})
