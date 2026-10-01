import { describe, expect, it } from 'vitest'
import { presetImageFor } from './catalogSource'

const rpk = { id: 'rpk16', types: ['gun'], iconLink: 'https://assets.tarkov.dev/rpk16-icon.webp', properties: { defaultPreset: 'rpk16-preset' } }

describe('presetImageFor', () => {
  it('takes the default preset’s 512px picture (the whole gun) from json.tarkov.dev items', () => {
    const items = { rpk16: rpk, 'rpk16-preset': { id: 'rpk16-preset', image512pxLink: 'https://assets.tarkov.dev/rpk16-preset-512.webp', iconLink: 'x' } }
    expect(presetImageFor(rpk, items)).toBe('https://assets.tarkov.dev/rpk16-preset-512.webp')
  })
  it('accepts the GraphQL shape and falls back to the preset asset by id', () => {
    expect(presetImageFor({ id: 'a', properties: { defaultPreset: { id: 'p', gridImageLink: 'grid.webp' } } }, {})).toBe('grid.webp')
    expect(presetImageFor(rpk, { rpk16: rpk })).toBe('https://assets.tarkov.dev/rpk16-preset-512.webp')
  })
  it('gives nothing for items without a preset', () => {
    expect(presetImageFor({ id: 'ledx', properties: {} }, {})).toBeUndefined()
  })
})
