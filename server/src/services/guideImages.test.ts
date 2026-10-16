import assert from 'node:assert/strict'
import express from 'express'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AppDataset } from '../../../src/domain/types'
import { createGuideImagesRouter } from '../routes/guideImages.js'
import { GuideImageMirror } from './guideImages.js'

const SOURCE = 'https://minio.tarkov.help/production/img/articles'
const FILE = '01237903-b29f-417c-83f3-671060fb220b.jpg'
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const BASE = 'https://raidos.app/v1/guide-images'

const catalog = (images: Array<string | undefined>) => ({
  quests: [
    { id: 'plain', name: 'Не оружейник', objectiveDetails: [{ id: 'o', type: 'visit', description: '' }] },
    {
      id: 'master-12', name: 'Оружейник - Мастер. Часть 12',
      objectiveDetails: images.map((image, index) => ({ id: `b${index}`, type: 'buildWeapon', description: '', build: { weaponId: `w${index}`, partIds: [], attributes: [], guide: { source: 'tarkov.help', parts: [], ...(image ? { image } : {}) } } })),
    },
  ],
}) as unknown as AppDataset

async function setup(t: test.TestContext, answer: () => Response) {
  const directory = await mkdtemp(join(tmpdir(), 'raidos-guides-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const asked: string[] = []
  let now = 0
  const fetcher = (async (input: string | URL | Request) => { asked.push(String(input)); return answer() }) as typeof fetch
  const mirror = new GuideImageMirror({ directory, publicBase: BASE, fetcher, now: () => now })
  return { directory, asked, mirror, later: (ms: number) => { now += ms } }
}

const idle = () => new Promise((resolve) => setTimeout(resolve, 20))

test('guide images: the catalog points at our server and the named pictures are downloaded once', async (t) => {
  const { directory, asked, mirror } = await setup(t, () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }))
  const original = catalog([`${SOURCE}/${FILE}`, 'https://example.com/other.jpg', undefined])
  const rewritten = mirror.rewrite(original)
  assert.equal(rewritten.quests[0], original.quests[0])
  const images = rewritten.quests[1].objectiveDetails!.map((objective) => objective.build?.guide?.image)
  assert.deepEqual(images, [`${BASE}/${FILE}`, 'https://example.com/other.jpg', undefined])
  // Downloaded in the background (a request meanwhile waits for it), then served from the disk without asking again.
  assert.equal(await mirror.file(FILE), join(directory, FILE))
  assert.deepEqual(asked, [`${SOURCE}/${FILE}`])
  assert.deepEqual(await readFile(join(directory, FILE)), JPEG)
  mirror.rewrite(original)
  await idle()
  assert.equal(asked.length, 1)
  assert.deepEqual(await readdir(directory), [FILE])
})

test('guide images: nothing the catalog does not name, nothing that is not a picture, no retry storm', async (t) => {
  let answer = new Response('<html>no</html>', { headers: { 'content-type': 'text/html' } })
  const { directory, asked, mirror, later } = await setup(t, () => answer)
  assert.equal(await mirror.file('02d983c8-86e4-4a17-bf2a-aaa38714c222.jpg'), undefined)
  assert.equal(await mirror.file('../secret.jpg'), undefined)
  assert.equal(await mirror.file(`${FILE}.part`), undefined)
  assert.equal(asked.length, 0)
  mirror.rewrite(catalog([`${SOURCE}/${FILE}`]))
  await idle()
  assert.equal(await mirror.file(FILE), undefined)
  assert.equal(asked.length, 1)
  assert.deepEqual(await readdir(directory).catch(() => []), [])
  later(31 * 60_000)
  answer = new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })
  assert.equal(await mirror.file(FILE), join(directory, FILE))
  assert.equal(asked.length, 2)
})

test('guide images: the route serves the stored picture to the app', async (t) => {
  const { mirror } = await setup(t, () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }))
  mirror.rewrite(catalog([`${SOURCE}/${FILE}`]))
  const server = express().use(createGuideImagesRouter(mirror)).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve)); t.after(() => server.close())
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`
  const response = await fetch(`${base}/v1/guide-images/${FILE}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  assert.match(response.headers.get('cache-control') ?? '', /immutable/)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), JPEG)
  assert.equal((await fetch(`${base}/v1/guide-images/02d983c8-86e4-4a17-bf2a-aaa38714c222.jpg`)).status, 404)
  assert.equal((await fetch(`${base}/v1/guide-images/..%2F..%2Fetc%2Fpasswd`)).status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/v1/guide-images/${FILE}`, { method: 'HEAD' })).status, 200)
})
