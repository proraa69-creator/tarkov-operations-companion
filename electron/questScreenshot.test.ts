// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { readFreshQuestScreenshot, screenshotNameTime } from './questScreenshot'

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
  const minute = (time: number) => { const d = new Date(time); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}[${p(d.getHours())}-${p(d.getMinutes())}]` }

  it('skips EFT screenshots whose name says they were taken before the watch began', async () => {
    // An old shot touched again (copied back, say) is not read; a fresh one is.
    await image(`${minute(now - 3 * 60 * 60_000)} (0).png`, now - 1000)
    expect(await readFreshQuestScreenshot(folder, now - 5000, now)).toBeNull()
    await image(`${minute(now)} (1).png`, now - 500)
    expect((await readFreshQuestScreenshot(folder, now - 5000, now))?.file).toContain(`${minute(now)} (1).png`)
  })

  it('never reads a position screenshot: coordinates in the name are a raid, the minimap\'s shot (audit P5d)', async () => {
    await image(`${minute(now)}_4.0, 5.0, 6.0_0.0, 0.0, 0.0, 1.0_10.00 (0).png`, now - 500)
    expect(await readFreshQuestScreenshot(folder, now - 5000, now)).toBeNull()
    await image(`${minute(now)} (2).png`, now - 1500)
    expect((await readFreshQuestScreenshot(folder, now - 5000, now))?.file).toContain(`${minute(now)} (2).png`)
  })
  it('reads the minute from an EFT screenshot name', () => {
    expect(screenshotNameTime('2024-06-13[11-05]_1.0, 2.0, 3.0_0.0, 0.0, 0.0, 1.0_10.00 (0).png')).toBe(new Date(2024, 5, 13, 11, 5).getTime())
    expect(screenshotNameTime('Screenshot 2024-06-13.png')).toBeNull()
  })
  it('does not list a folder nothing was added to since the watch began', async () => {
    await image('fresh.png', now - 2000)
    const past = (now - 30 * 60_000) / 1000
    await utimes(folder, past, past)
    expect(await readFreshQuestScreenshot(folder, now - 5000, now)).toBeNull()
  })
  it('handles a missing screenshot folder without crashing', async () => {
    expect(await readFreshQuestScreenshot(join(folder, 'missing'), now - 1000, now)).toBeNull()
    expect(await readFreshQuestScreenshot(folder, NaN, now)).toBeNull()
  })
})
