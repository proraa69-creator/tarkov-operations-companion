// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { readFreshQuestScreenshot } from './questScreenshot'

let folder: string
const now = Date.now()
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'raidos-quest-screenshot-test-')) })
afterEach(async () => {
  if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !folder.includes('raidos-quest-screenshot-test-')) throw new Error('Unsafe test cleanup')
  await rm(folder, { recursive: true, force: true })
})

async function image(name: string, modifiedAt: number) {
  await writeFile(join(folder, name), Buffer.from('test screenshot bytes'))
  await utimes(join(folder, name), modifiedAt / 1000, modifiedAt / 1000)
}

describe('automatic EFT screenshot fallback', () => {
  it('reads the newest fresh game image', async () => {
    await image('old.png', now - 6000)
    await image('fresh.png', now - 2000)
    expect((await readFreshQuestScreenshot(folder, now - 5000, now))?.file).toBe(join(folder, 'fresh.png'))
  })
  it('ignores images from before the current profile/mode watch', async () => {
    await image('previous-profile.png', now - 6000)
    expect(await readFreshQuestScreenshot(folder, now - 5000, now)).toBeNull()
  })
  it('ignores stale, future, empty and non-image files', async () => {
    await image('stale.png', now - 6 * 60_000)
    await image('future.png', now + 10_000)
    await image('account.sqlite', now - 1000)
    await writeFile(join(folder, 'empty.png'), '')
    expect(await readFreshQuestScreenshot(folder, now - 7 * 60_000, now)).toBeNull()
  })
  it('handles a missing screenshot folder without crashing', async () => {
    expect(await readFreshQuestScreenshot(join(folder, 'missing'), now - 1000, now)).toBeNull()
    expect(await readFreshQuestScreenshot(folder, NaN, now)).toBeNull()
  })
})
