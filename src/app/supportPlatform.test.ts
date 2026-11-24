import { describe, expect, it } from 'vitest'
import { PLATFORM_MAX, withSystemBrief } from './support'

describe('a performance report carries a few words about the computer (report 227)', () => {
  const brief = 'GPU *Intel a7a0, NVIDIA 28e0; RAM 16 GB; battery'

  it('goes before « · EFT: …», which the server reads off the end', () => {
    const line = withSystemBrief('Windows 10/11 x64 · desktop app · EFT: Steam', brief)
    expect(line).toBe(`Windows 10/11 x64 · desktop app · ${brief} · EFT: Steam`)
    expect(/^(.*) · EFT: ([^·]+)$/.exec(line)?.[2]).toBe('Steam')
  })

  it('without the game edition: at the end; no brief: the line as it was', () => {
    expect(withSystemBrief('Windows 10/11 x64 · desktop app', brief)).toBe(`Windows 10/11 x64 · desktop app · ${brief}`)
    expect(withSystemBrief('Windows 10/11 x64 · desktop app', '')).toBe('Windows 10/11 x64 · desktop app')
  })

  it('never longer than the server takes, and never adds another «·» before the edition', () => {
    const line = withSystemBrief('Windows 10/11 x64 · desktop app · EFT: BSG launcher', `${'x'.repeat(200)} · y`)
    expect(line.length).toBeLessThanOrEqual(PLATFORM_MAX)
    expect(line.endsWith(' · EFT: BSG launcher')).toBe(true)
    expect(line.split(' · ').length).toBe(4)
  })
})
