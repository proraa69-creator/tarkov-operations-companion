import assert from 'node:assert/strict'
import express from 'express'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createItemImagesRouter } from './itemImages.js'

test('item images: serves only files present in the manifest', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-images-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const id = '5af08cf886f774223c269184', file = `${id}-icon.webp`
  await writeFile(join(dir, file), Buffer.from('image'))
  await writeFile(join(dir, 'secret-icon.webp'), Buffer.from('secret'))
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ items: { [id]: { images: { icon: { file } } } } }))
  const server = express().use(createItemImagesRouter(dir)).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve)); t.after(() => server.close())
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`
  assert.equal((await fetch(`${base}/v1/item-images/${file}`)).status, 200)
  assert.equal((await fetch(`${base}/v1/item-images/secret-icon.webp`)).status, 404)
  assert.equal((await fetch(`${base}/v1/item-images/..%2Fmanifest.json`)).status, 404)
})
