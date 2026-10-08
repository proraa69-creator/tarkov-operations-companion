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
  it('uses the same model standard assembly for cosmetic editions with upstream placeholders', () => {
    for (const [variant, standard] of [['6a15ae2ae5267ba21c07f98f', '5bb2475ed4351e00853264e3'], ['6a78b7f8c2016eb33e0027cd', '5cc82d76e24e8d00134b4b83']]) {
      const weapon = { id: variant, properties: { defaultPreset: 'cosmetic-preset' } }
      const raw = { [variant]: weapon, 'cosmetic-preset': { image512pxLink: 'https://assets.tarkov.dev/unknown-item-512.webp' }, [standard]: { id: standard, properties: { defaultPreset: 'standard-preset' } }, 'standard-preset': { image512pxLink: 'assembled.webp' } }
      expect(presetImageFor(weapon, raw)).toBe('assembled.webp')
    }
  })
  it('skips a placeholder before a valid grid image', () => {
    expect(presetImageFor({ id: 'gun', properties: { defaultPreset: 'p' } }, { p: { image512pxLink: 'https://assets.tarkov.dev/unknown-item-512.webp', gridImageLink: 'assembled.webp' } })).toBe('assembled.webp')
  })
})
