import { describe, expect, it } from 'vitest'
import { mobileBuildReady } from './mobileRelease'

describe('mobileBuildReady', () => {
  it('works while the answer is loading or could not be read; «скоро» only when the server has no build', () => {
    expect(mobileBuildReady(undefined, 'android')).toBe(true)
    expect(mobileBuildReady(null, 'android')).toBe(false)
    expect(mobileBuildReady({ version: '0.6.0-145', android: { versionName: '0.6.0.145', size: 1 } }, 'android')).toBe(true)
    expect(mobileBuildReady({ version: '0.6.0-145', android: { versionName: '0.6.0.145', size: 1 } }, 'iphone')).toBe(false)
  })
})
