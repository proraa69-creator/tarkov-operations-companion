// @vitest-environment node
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { detectGrid } from './grid'

/** A phone photo of the owner's container on the monitor (shrunk, the stash only): 14 columns, items in 10 of its 12 rows. */
const PHOTO = fileURLToPath(new URL('./__fixtures__/stash-photo.jpg', import.meta.url))

describe.skipIf(!existsSync(PHOTO))('stash photo: a real photo of the screen', () => {
  it('finds the 14-column grid', async () => {
    const { data, info } = await sharp(PHOTO).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const grid = detectGrid({ width: info.width, height: info.height, data: new Uint8Array(data) })
    expect(grid).not.toBeNull()
    expect(grid!.columns).toBe(14)
    expect(grid!.rows).toBeGreaterThanOrEqual(10)
    // cells about square, about 56 px
    expect(grid!.pitch).toBeGreaterThan(48)
    expect(grid!.pitch).toBeLessThan(64)
  })
})
