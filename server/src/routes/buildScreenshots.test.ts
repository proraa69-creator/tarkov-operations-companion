import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { BuildScreenshotFolder, createBuildScreenshotsRouter } from './buildScreenshots.js'

// Owner, 13.11.2026: «если у нас на сервере происходит замена, то приложение берет один раз от туда новую картинку».
const TASK = '64f83bd983cfca080a362c82'
const WEAPON = '64ca3d3954fc657e230529cc'

async function serve(dir: string) {
  const app = express().use(createBuildScreenshotsRouter(new BuildScreenshotFolder(dir)))
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as { port: number }
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('lists the screenshots with a version of their bytes; a replaced file gets a new one; only such names are served', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'build-shots-'))
  const t = await serve(dir)
  try {
    writeFileSync(join(dir, `${TASK}_${WEAPON}.webp`), 'RIFF one')
    writeFileSync(join(dir, 'notes.txt'), 'not a screenshot')
    const first = await (await fetch(`${t.base}/v1/build-screenshots`)).json() as { screenshots: Array<{ task: string; weapon: string; version: string }> }
    assert.equal(first.screenshots.length, 1)
    assert.deepEqual({ task: first.screenshots[0]!.task, weapon: first.screenshots[0]!.weapon }, { task: TASK, weapon: WEAPON })
    const picture = await fetch(`${t.base}/v1/build-screenshots/${TASK}_${WEAPON}.webp?v=${first.screenshots[0]!.version}`)
    assert.equal(picture.status, 200)
    assert.match(picture.headers.get('cache-control') ?? '', /immutable/)
    assert.equal(await picture.text(), 'RIFF one')
    writeFileSync(join(dir, `${TASK}_${WEAPON}.webp`), 'RIFF two, longer')
    const second = await (await fetch(`${t.base}/v1/build-screenshots`)).json() as { screenshots: Array<{ version: string }> }
    assert.notEqual(second.screenshots[0]!.version, first.screenshots[0]!.version)
    assert.equal((await fetch(`${t.base}/v1/build-screenshots/notes.txt`)).status, 404)
    assert.equal((await fetch(`${t.base}/v1/build-screenshots/..%2Fnotes.txt`)).status, 404)
  } finally { await t.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('no folder: an empty list', async () => {
  const t = await serve(join(tmpdir(), 'no-such-build-shots-folder'))
  try { assert.deepEqual(await (await fetch(`${t.base}/v1/build-screenshots`)).json(), { screenshots: [] }) } finally { await t.close() }
})

test('a photo of a place replaced on the server: served instead of the stored one and listed with its version', async () => {
  const { createGuideImagesRouter } = await import('./guideImages.js')
  const { VersionedPictureFolder } = await import('./buildScreenshots.js')
  const { GUIDE_IMAGE_FILE } = await import('../services/guideImages.js')
  const dir = mkdtempSync(join(tmpdir(), 'guide-repl-'))
  const app = express().use(createGuideImagesRouter(undefined, new VersionedPictureFolder(dir, GUIDE_IMAGE_FILE)))
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    assert.deepEqual(await (await fetch(`${base}/v1/guide-image-versions`)).json(), { versions: {} })
    assert.equal((await fetch(`${base}/v1/guide-images/wiki-0123456789abcdef.png`)).status, 404)
    writeFileSync(join(dir, 'wiki-0123456789abcdef.png'), 'owner photo')
    const { versions } = await (await fetch(`${base}/v1/guide-image-versions`)).json() as { versions: Record<string, string> }
    assert.match(versions['wiki-0123456789abcdef.png'] ?? '', /^[0-9a-f]{16}$/)
    assert.equal(await (await fetch(`${base}/v1/guide-images/wiki-0123456789abcdef.png?v=2&r=${versions['wiki-0123456789abcdef.png']}`)).text(), 'owner photo')
  } finally { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})
