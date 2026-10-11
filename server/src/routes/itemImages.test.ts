import assert from 'node:assert/strict'
import express from 'express'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('item images: serves the active generation only', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-images-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const id = '5af08cf886f774223c269184', file = `${id}-icon.webp`, generation = 'images-current1'
  const active = join(dir, 'generations', generation)
  await mkdir(active, { recursive: true })
  await writeFile(join(active, file), Buffer.from('current'))
  await writeFile(join(active, 'manifest.json'), JSON.stringify({ items: { [id]: { images: { icon: { file } } } } }))
  await writeFile(join(dir, file), Buffer.from('legacy'))
  await writeFile(join(dir, 'active.json'), JSON.stringify({ version: 1, current: generation }))
  const server = express().use(createItemImagesRouter(dir)).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve)); t.after(() => server.close())
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/item-images/${file}`)
  assert.equal(await response.text(), 'current')
})
