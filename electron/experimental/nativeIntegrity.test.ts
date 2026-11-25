// @vitest-environment node
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyNativeFiles, type NativeFileReader } from './nativeIntegrity'

function reader(files: Record<string, string>): NativeFileReader {
  return {
    exists: (path) => path in files,
    hash: (path) => {
      if (!(path in files)) throw new Error('missing')
      return files[path]
    },
  }
}

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('native integrity check before elevation', () => {
  it('no manifest: trustworthy (nothing to check)', () => {
    expect(verifyNativeFiles(null, '/res', reader({}))).toBe(true)
  })

  it('every present native matches its recorded hash: trustworthy', () => {
    const manifest = { 'koffi/win32_x64/koffi.node': A }
    const disk = reader({ [join('/res', 'koffi', 'win32_x64', 'koffi.node')]: A })
    expect(verifyNativeFiles(manifest, '/res', disk)).toBe(true)
  })

  it('a present native whose bytes differ (a swap): not trustworthy', () => {
    const manifest = { 'koffi/win32_x64/koffi.node': A }
    const disk = reader({ [join('/res', 'koffi', 'win32_x64', 'koffi.node')]: B })
    expect(verifyNativeFiles(manifest, '/res', disk)).toBe(false)
  })

  it('a native that is not where the manifest expects it is skipped, never a false block', () => {
    const manifest = { 'app.asar.unpacked/node_modules/uiohook-napi/prebuilds/win32-x64/uiohook.node': A }
    expect(verifyNativeFiles(manifest, '/res', reader({}))).toBe(true)
  })

  it('one swapped native fails the whole check even when the others match', () => {
    const manifest = { 'koffi/win32_x64/koffi.node': A, 'app.asar.unpacked/node_modules/uiohook-napi/prebuilds/win32-x64/uiohook.node': A }
    const disk = reader({
      [join('/res', 'koffi', 'win32_x64', 'koffi.node')]: A,
      [join('/res', 'app.asar.unpacked', 'node_modules', 'uiohook-napi', 'prebuilds', 'win32-x64', 'uiohook.node')]: B,
    })
    expect(verifyNativeFiles(manifest, '/res', disk)).toBe(false)
  })
})
