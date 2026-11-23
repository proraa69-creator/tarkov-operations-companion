// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { RANGE_PACK_FILE } from './rangePack'

describe('the range pack\'s files', () => {
  it('carries the red dots: their marks, housings and data', () => {
    expect(RANGE_PACK_FILE.test('reticle-570fd721d2720bc5458b4596-m0.webp')).toBe(true)
    expect(RANGE_PACK_FILE.test('housing-570fd721d2720bc5458b4596.webp')).toBe(true)
    expect(RANGE_PACK_FILE.test('collimators.json')).toBe(true)
    expect(RANGE_PACK_FILE.test('scopes.json')).toBe(true)
  })
  it('nothing else', () => {
    expect(RANGE_PACK_FILE.test('housing-../x.webp')).toBe(false)
    expect(RANGE_PACK_FILE.test('collimators.json.bak')).toBe(false)
  })
})
