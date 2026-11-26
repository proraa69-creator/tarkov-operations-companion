import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asksAtNextStart, DARK_WINDOW_FILE, DARK_WINDOW_MS, describeGpus, GPU_FALLBACK_FILE, nextStartStep, readDarkWindowCheck, readGpuFallback, soonAfterShown, writeDarkWindowCheck, writeGpuFallback } from './gpuFallback'
import { appendStartLog, START_LOG_FILE, START_LOG_MAX_BYTES, startLogTail } from './startLog'

const folders: string[] = []
const folder = () => { const made = mkdtempSync(join(tmpdir(), 'raidos-gpu-')); folders.push(made); return made }
afterEach(() => { for (const made of folders.splice(0)) rmSync(made, { recursive: true, force: true }) })

describe('a start that draws nothing (owner, 23.11.2026)', () => {
  const fresh = { softwareDrawing: false, noSandbox: false, painted: false, disabledByArgument: false }

  it('draws in software first, after any trouble before the first picture', () => {
    expect(nextStartStep({ kind: 'no-picture' }, fresh)).toBe('software')
    expect(nextStartStep({ kind: 'gpu-gone', reason: 'crashed' }, fresh)).toBe('software')
    expect(nextStartStep({ kind: 'gpu-gone', reason: 'launch-failed' }, fresh)).toBe('software')
    expect(nextStartStep({ kind: 'page-gone', reason: 'launch-failed' }, fresh)).toBe('software')
  })

  it('then starts without the sandbox (also at once with --disable-gpu), then reports; never after the first picture or on a clean end', () => {
    expect(nextStartStep({ kind: 'no-picture' }, { ...fresh, softwareDrawing: true })).toBe('no-sandbox')
    expect(nextStartStep({ kind: 'page-gone', reason: 'launch-failed' }, { ...fresh, disabledByArgument: true })).toBe('no-sandbox')
    expect(nextStartStep({ kind: 'no-picture' }, { ...fresh, softwareDrawing: true, noSandbox: true })).toBe('report')
    expect(nextStartStep({ kind: 'gpu-gone', reason: 'crashed' }, { ...fresh, painted: true })).toBeUndefined()
    expect(nextStartStep({ kind: 'gpu-gone', reason: 'clean-exit' }, fresh)).toBeUndefined()
  })

  it('remembers both steps in the data folder; a missing or broken note is a normal start', () => {
    const data = folder()
    expect(readGpuFallback(data)).toEqual({ softwareDrawing: false })
    writeGpuFallback(data, 'no-picture', new Date('2026-11-23T01:00:00Z'))
    expect(readGpuFallback(data)).toEqual({ softwareDrawing: true, reason: 'no-picture', at: '2026-11-23T01:00:00.000Z' })
    writeGpuFallback(data, 'page-gone: launch-failed', new Date('2026-11-23T01:01:00Z'), true)
    expect(readGpuFallback(data)).toEqual({ softwareDrawing: true, noSandbox: true, reason: 'page-gone: launch-failed', at: '2026-11-23T01:01:00.000Z' })
    writeFileSync(join(data, GPU_FALLBACK_FILE), '{broken')
    expect(readGpuFallback(data)).toEqual({ softwareDrawing: false })
  })

  // Owner, 23.11.2026: a player's window stayed black with 0.6.0.336 and no message — Chromium had drawn its first picture.
  it('the player saying the window is black counts after the first picture too: software, then no sandbox, then the report', () => {
    const painted = { ...fresh, painted: true }
    expect(nextStartStep({ kind: 'seen-black' }, painted)).toBe('software')
    expect(nextStartStep({ kind: 'seen-black' }, { ...painted, softwareDrawing: true })).toBe('no-sandbox')
    expect(nextStartStep({ kind: 'seen-black' }, { ...painted, disabledByArgument: true })).toBe('no-sandbox')
    expect(nextStartStep({ kind: 'seen-black' }, { ...painted, softwareDrawing: true, noSandbox: true })).toBe('report')
    expect(nextStartStep({ kind: 'no-picture' }, painted)).toBeUndefined()
  })

  it('asks only soon after the window appeared, on a PC where the app never worked, unless the player said it was fine', () => {
    const shownAt = 1_000_000
    expect(soonAfterShown(null, shownAt)).toBe(false)
    expect(soonAfterShown(shownAt, shownAt + 5_000)).toBe(true)
    expect(soonAfterShown(shownAt, shownAt + DARK_WINDOW_MS)).toBe(true)
    expect(soonAfterShown(shownAt, shownAt + DARK_WINDOW_MS + 1)).toBe(false)
    expect(soonAfterShown(shownAt, shownAt - 1)).toBe(false)
    const close = { shownAt, now: shownAt + 30_000, everWorked: false, check: undefined, restarting: false }
    expect(asksAtNextStart(close)).toBe(true)
    expect(asksAtNextStart({ ...close, everWorked: true })).toBe(false)
    expect(asksAtNextStart({ ...close, check: 'never' })).toBe(false)
    expect(asksAtNextStart({ ...close, restarting: true })).toBe(false)
    expect(asksAtNextStart({ ...close, now: shownAt + DARK_WINDOW_MS + 1 })).toBe(false)
    expect(asksAtNextStart({ ...close, shownAt: null })).toBe(false)
  })

  it('keeps the question for the next start in the data folder; asked, it goes; a broken note is none', () => {
    const data = folder()
    expect(readDarkWindowCheck(data)).toBeUndefined()
    writeDarkWindowCheck(data, 'ask', new Date('2026-11-23T01:00:00Z'))
    expect(readDarkWindowCheck(data)).toBe('ask')
    writeDarkWindowCheck(data, undefined)
    expect(readDarkWindowCheck(data)).toBeUndefined()
    writeDarkWindowCheck(data, undefined)
    writeDarkWindowCheck(data, 'never')
    expect(readDarkWindowCheck(data)).toBe('never')
    writeFileSync(join(data, DARK_WINDOW_FILE), '{"state":"maybe"}')
    expect(readDarkWindowCheck(data)).toBeUndefined()
  })

  it('names the graphics cards for the start log, the one in use first marked; nothing else', () => {
    expect(describeGpus({ gpuDevice: [
      { vendorId: 0x10de, deviceId: 0x2484, active: true, driverVersion: '32.0.15.6094' },
      { vendorId: 0x8086, deviceId: 0x4680, active: false, driverVersion: 'C:\\path\\leak' },
      { vendorId: 0x1414, deviceId: 0x8c },
      { vendorId: 0, deviceId: 0 },
    ] })).toBe('*NVIDIA 10de:2484 driver 32.0.15.6094, Intel 8086:4680, Microsoft 1414:008c')
    expect(describeGpus(null)).toBe('')
    expect(describeGpus({ gpuDevice: 'x' })).toBe('')
  })

  it('logs each start in one line, keeps the log small and gives its last lines for support', () => {
    const data = folder()
    expect(startLogTail(data)).toBe('')
    appendStartLog(data, 'start 0.6.0-336 · Windows 10.0.26100 x64 · normal', new Date('2026-11-23T01:00:00Z'))
    appendStartLog(data, 'no-picture\n → software', new Date('2026-11-23T01:00:25Z'))
    expect(startLogTail(data)).toBe('2026-11-23T01:00:00.000Z start 0.6.0-336 · Windows 10.0.26100 x64 · normal\n2026-11-23T01:00:25.000Z no-picture → software')
    writeFileSync(join(data, START_LOG_FILE), `${'x'.repeat(100)}\n`.repeat(Math.ceil(START_LOG_MAX_BYTES / 101) + 10))
    appendStartLog(data, 'start again')
    const size = readFileSync(join(data, START_LOG_FILE), 'utf8').length
    expect(size).toBeLessThan(START_LOG_MAX_BYTES / 2 + 200)
    expect(startLogTail(data, 1)).toMatch(/start again$/)
  })
})
