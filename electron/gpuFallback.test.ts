import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GPU_FALLBACK_FILE, readGpuFallback, shouldDrawInSoftware, writeGpuFallback } from './gpuFallback'

const folders: string[] = []
const folder = () => { const made = mkdtempSync(join(tmpdir(), 'raidos-gpu-')); folders.push(made); return made }
afterEach(() => { for (const made of folders.splice(0)) rmSync(made, { recursive: true, force: true }) })

describe('drawing without the graphics card after a dark start (owner, 23.11.2026)', () => {
  const fresh = { softwareDrawing: false, painted: false, disabledByArgument: false }

  it('a start that draws nothing, or whose graphics or page process dies first, starts again in software', () => {
    expect(shouldDrawInSoftware({ kind: 'no-picture' }, fresh)).toBe(true)
    expect(shouldDrawInSoftware({ kind: 'gpu-gone', reason: 'crashed' }, fresh)).toBe(true)
    expect(shouldDrawInSoftware({ kind: 'gpu-gone', reason: 'launch-failed' }, fresh)).toBe(true)
    expect(shouldDrawInSoftware({ kind: 'page-gone', reason: 'crashed' }, fresh)).toBe(true)
  })

  it('only once, only before the first picture, never on a clean end or with --disable-gpu', () => {
    expect(shouldDrawInSoftware({ kind: 'no-picture' }, { ...fresh, softwareDrawing: true })).toBe(false)
    expect(shouldDrawInSoftware({ kind: 'gpu-gone', reason: 'crashed' }, { ...fresh, painted: true })).toBe(false)
    expect(shouldDrawInSoftware({ kind: 'gpu-gone', reason: 'clean-exit' }, fresh)).toBe(false)
    expect(shouldDrawInSoftware({ kind: 'no-picture' }, { ...fresh, disabledByArgument: true })).toBe(false)
  })

  it('remembers it in the data folder; a missing or broken note is drawing with the card', () => {
    const data = folder()
    expect(readGpuFallback(data)).toEqual({ softwareDrawing: false })
    writeGpuFallback(data, 'no-picture', new Date('2026-11-23T01:00:00Z'))
    expect(readGpuFallback(data)).toEqual({ softwareDrawing: true, reason: 'no-picture', at: '2026-11-23T01:00:00.000Z' })
    writeFileSync(join(data, GPU_FALLBACK_FILE), '{broken')
    expect(readGpuFallback(data)).toEqual({ softwareDrawing: false })
  })
})
