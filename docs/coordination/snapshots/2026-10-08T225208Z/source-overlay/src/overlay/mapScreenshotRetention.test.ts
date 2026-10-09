// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MapScreenshotRetention } from '../../electron/experimental/mapScreenshotRetention'

const folders: string[] = []
async function folder() { const path = await mkdtemp(join(tmpdir(), 'raidos-map-retention-')); folders.push(path); return path }
const name = (index: number) => `2026-10-08[16-00]_1, 2, 3_0, 0, 0, 1_0.5 (${index}).png`
async function image(folder: string, index: number) {
  await writeFile(join(folder, name(index)), `test-image-${index}`)
  return { folder, name: name(index), withCoordinates: true, at: (await stat(join(folder, name(index)))).mtimeMs }
}
afterEach(async () => {
  for (const path of folders.splice(0)) {
    for (const entry of await readdir(path)) await unlink(join(path, entry))
    await rmdir(path)
  }
})

describe('app map screenshot retention', () => {
  it('removes only the previous verified app capture after a new coordinate capture', async () => {
    const dir = await folder(), retention = new MapScreenshotRetention()
    const manual = await image(dir, 0)
    retention.sent(await retention.prepare(dir), true)
    const first = await image(dir, 1); await retention.observe(first)
    retention.sent(await retention.prepare(dir), true)
    const second = await image(dir, 2); await retention.observe(second)
    expect((await readdir(dir)).sort()).toEqual([manual.name, second.name].sort())
  })
  it('does not claim a manual screenshot or a screenshot after a failed keypress', async () => {
    const dir = await folder(), retention = new MapScreenshotRetention()
    await retention.observe(await image(dir, 0))
    retention.sent(await retention.prepare(dir), false)
    await retention.observe(await image(dir, 1))
    retention.sent(await retention.prepare(dir), true)
    await retention.observe(await image(dir, 2))
    expect(await readdir(dir)).toHaveLength(3)
  })
  it('keeps ambiguous simultaneous screenshots and preexisting files', async () => {
    const dir = await folder(), retention = new MapScreenshotRetention()
    const existing = await image(dir, 0)
    retention.sent(await retention.prepare(dir), true)
    await retention.observe(existing)
    const first = await image(dir, 1)
    await image(dir, 2)
    await retention.observe(first)
    retention.sent(await retention.prepare(dir), true)
    await retention.observe(await image(dir, 3))
    expect(await readdir(dir)).toHaveLength(4)
  })
  it('does not delete a file modified after ownership was recorded', async () => {
    const dir = await folder(), retention = new MapScreenshotRetention()
    retention.sent(await retention.prepare(dir), true)
    const first = await image(dir, 1); await retention.observe(first)
    await writeFile(join(dir, first.name), 'user-replaced-this-file-with-a-different-image')
    retention.sent(await retention.prepare(dir), true)
    await retention.observe(await image(dir, 2))
    expect(await readdir(dir)).toHaveLength(2)
  })
  it('rejects traversal and captures from a different folder', async () => {
    const dir = await folder(), other = await folder(), retention = new MapScreenshotRetention()
    retention.sent(await retention.prepare(dir), true)
    const file = await image(other, 1)
    await retention.observe({ ...file, folder: dir, name: `../${file.name}` })
    await retention.observe(file)
    retention.sent(await retention.prepare(other), true)
    await retention.observe(await image(other, 2))
    expect(await readdir(other)).toHaveLength(2)
  })
})
