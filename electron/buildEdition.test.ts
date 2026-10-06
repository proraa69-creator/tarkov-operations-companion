// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { editionFromInfo } from './buildEdition'

describe('build edition (L7)', () => {
  it('takes the edition written at build time', () => {
    expect(editionFromInfo({ edition: 'owner' }, {})).toBe('owner')
    expect(editionFromInfo({ edition: 'client' }, { OWNER_BUILD: '1' })).toBe('client')
  })

  it('a build-info.json without a valid edition is a players’ copy, whatever the environment says', () => {
    expect(editionFromInfo({}, {})).toBe('client')
    expect(editionFromInfo({ edition: 'admin' }, {})).toBe('client')
    expect(editionFromInfo({}, { OWNER_BUILD: '1' })).toBe('client')
  })

  it('only a development run without build-info.json reads OWNER_BUILD', () => {
    expect(editionFromInfo(null, { OWNER_BUILD: '1' })).toBe('owner')
    expect(editionFromInfo(null, {})).toBe('client')
  })
})
