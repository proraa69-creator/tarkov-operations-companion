import { mkdtemp, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pruneScanFrames } from './scanFrameBuffer'

describe('scan frame buffer', () => {
  it('keeps only the newest 10 png frames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quest-scan-frames-'))
    for (let index = 0; index < 15; index += 1) {
      const stamp = String(1_700_000_000_000 + index)
      await writeFile(join(root, `frame-${stamp}.png`), Buffer.from(`frame-${index}`))
    }
    expect(await pruneScanFrames(root, 10)).toBe(10)
    const left = (await readdir(root)).filter((name) => name.endsWith('.png')).sort()
    expect(left).toHaveLength(10)
    expect(left[0]).toContain('0005')
    expect(left[9]).toContain('0014')
  })
})
