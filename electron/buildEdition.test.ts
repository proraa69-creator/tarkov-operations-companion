// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { editionFromInfo, resolveEdition } from './buildEdition'

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

describe('the baked edition (L7): a packaged copy decides the owner build from code, not from build-info.json', () => {
  it('uses the edition baked at build time, ignoring build-info.json and the environment', () => {
    expect(resolveEdition('client', { edition: 'owner' }, { OWNER_BUILD: '1' })).toBe('client')
    expect(resolveEdition('owner', { edition: 'client' }, {})).toBe('owner')
  })

  it('falls back to build-info.json / OWNER_BUILD only when nothing is baked (a development run)', () => {
    expect(resolveEdition(null, { edition: 'owner' }, {})).toBe('owner')
    expect(resolveEdition(null, {}, { OWNER_BUILD: '1' })).toBe('client')
    expect(resolveEdition(undefined, null, { OWNER_BUILD: '1' })).toBe('owner')
    expect(resolveEdition(null, null, {})).toBe('client')
  })
})
