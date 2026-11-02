import assert from 'node:assert/strict'
import express from 'express'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

test('quest walkthrough photos: only the files of the wiki list, full size and thumbnail, from the wiki\'s image host', async (t) => {
  const { wikiGuideSource } = await import('./guideImages.js')
  const photos = (await import('../../../src/data/questGuidePhotos.json')).default as { files: Record<string, { url: string; file: string }> }
  const [id, entry] = Object.entries(photos.files)[0]!
  const ext = entry.file.split('.').pop()!.toLowerCase()
  assert.equal(wikiGuideSource(`wiki-${id}.${ext}`), entry.url)
  assert.match(wikiGuideSource(`wiki-${id}-t.${ext}`)!, /scale-to-width-down\/400/)
  assert.equal(wikiGuideSource('wiki-0000000000000000.png'), undefined)
  assert.equal(wikiGuideSource('../wiki-x.png'), undefined)

  const directory = await mkdtemp(join(tmpdir(), 'raidos-wiki-guides-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const asked: string[] = []
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const mirror = new GuideImageMirror({ directory, publicBase: 'https://raidos.app/v1/guide-images', fetcher: (async (url: string) => { asked.push(url); return new Response(png, { status: 200 }) }) as unknown as typeof fetch })
  const path = await mirror.file(`wiki-${id}.${ext}`)
  assert.ok(path)
  assert.deepEqual(asked, [entry.url])
  assert.equal(await mirror.file('wiki-0000000000000000.png'), undefined)
  assert.equal(asked.length, 1)
})

test('the Halloween 2026 quests\' photos: the files of their own list, from tarkov.help\'s picture host, the thumbnail the picture itself', async (t) => {
  const { wikiGuideSource } = await import('./guideImages.js')
  const photos = (await import('../../../src/data/eventGuidePhotos.json')).default as { files: Record<string, { url: string; file: string }> }
  const [id, entry] = Object.entries(photos.files)[0]!
  const ext = entry.file.split('.').pop()!.toLowerCase()
  assert.match(entry.url, /^https:\/\/minio\.tarkov\.help\/production\/img\/articles\//)
  assert.equal(wikiGuideSource(`wiki-${id}.${ext}`), entry.url)
  assert.equal(wikiGuideSource(`wiki-${id}-t.${ext}`), entry.url)

  const directory = await mkdtemp(join(tmpdir(), 'raidos-event-guides-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const asked: string[] = []
  const mirror = new GuideImageMirror({ directory, publicBase: 'https://raidos.app/v1/guide-images', fetcher: (async (url: string) => { asked.push(url); return new Response(JPEG, { status: 200 }) }) as unknown as typeof fetch })
  assert.ok(await mirror.file(`wiki-${id}.${ext}`))
  assert.deepEqual(asked, [entry.url])
})

test('quest photos are kept on our server ahead of the players: every listed name, the stored ones skipped, a Halloween thumbnail copied (03.11.2026)', async (t) => {
  const { listedGuidePhotos } = await import('./guideImages.js')
  const wiki = (await import('../../../src/data/questGuidePhotos.json')).default as { files: Record<string, { url: string; file: string }> }
  const event = (await import('../../../src/data/eventGuidePhotos.json')).default as { files: Record<string, { url: string; file: string }> }
  const listed = listedGuidePhotos()
  // Each photo full size and as a thumbnail, by the names the apps ask for («.jpeg» asked as «.jpg»).
  assert.equal(listed.length, 2 * (Object.keys(wiki.files).length + Object.keys(event.files).length))
  assert.ok(listed.every((name) => /^wiki-[0-9a-f]{16}(-t)?\.(png|jpg|webp)$/.test(name)))
  // The walkthrough picture the wiki deleted («Знакомство») is no longer listed.
  assert.ok(!listed.some((name) => name.startsWith('wiki-0819edb4fbb5c9e3')))

  const [wikiId, wikiEntry] = Object.entries(wiki.files).find(([, entry]) => entry.file.endsWith('.png'))!
  const [eventId, eventEntry] = Object.entries(event.files).find(([, entry]) => entry.file.endsWith('.jpg'))!
  const names = [`wiki-${wikiId}.png`, `wiki-${wikiId}-t.png`, `wiki-${eventId}.jpg`, `wiki-${eventId}-t.jpg`, 'wiki-0000000000000000.png']
  const { directory, asked, mirror } = await setup(t, () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, names[0]!), JPEG)
  assert.deepEqual(await mirror.storeListed(names), { listed: 4, stored: 1, downloaded: 3, failed: 0 })
  // The thumbnail from the wiki's smaller copy; the Halloween one copied from its picture; nothing unlisted asked for.
  assert.deepEqual(asked, [wikiEntry.url.replace(/\/scale-to-width-down\/\d+/, '/scale-to-width-down/400'), eventEntry.url])
  assert.deepEqual(await readFile(join(directory, names[3]!)), JPEG)
  assert.deepEqual((await readdir(directory)).sort(), names.slice(0, 4).sort())
  // The next run only looks: everything is there.
  assert.deepEqual(await mirror.storeListed(names), { listed: 4, stored: 4, downloaded: 0, failed: 0 })
  assert.equal(asked.length, 2)
})

test('quest photos ahead: a photo its host refuses counts as failed and is tried again on a later run', async (t) => {
  const wiki = (await import('../../../src/data/questGuidePhotos.json')).default as { files: Record<string, { url: string; file: string }> }
  const [id] = Object.entries(wiki.files).find(([, entry]) => entry.file.endsWith('.png'))!
  let answer = new Response('gone', { status: 404 })
  const { directory, asked, mirror, later } = await setup(t, () => answer)
  assert.deepEqual(await mirror.storeListed([`wiki-${id}.png`]), { listed: 1, stored: 0, downloaded: 0, failed: 1 })
  assert.deepEqual(await readdir(directory).catch(() => []), [])
  later(6 * 60 * 60_000)
  answer = new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { status: 200 })
  assert.deepEqual(await mirror.storeListed([`wiki-${id}.png`]), { listed: 1, stored: 0, downloaded: 1, failed: 0 })
  assert.equal(asked.length, 2)
})
