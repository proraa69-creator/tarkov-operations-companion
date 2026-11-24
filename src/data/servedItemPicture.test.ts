import { describe, expect, it } from 'vitest'
import { servedItemPicture } from './servedItemPicture'

describe('servedItemPicture', () => {
  it('asks our server for a tarkov.dev item picture in the players app', () => {
    expect(servedItemPicture('https://assets.tarkov.dev/5b3b713c5acfc4330140bd8d-icon.webp', true)).toBe('https://raidos.app/v1/item-images/5b3b713c5acfc4330140bd8d-icon.webp')
    expect(servedItemPicture('https://assets.tarkov.dev/5b3b713c5acfc4330140bd8d-grid-image.webp', true)).toBe('https://raidos.app/v1/item-images/5b3b713c5acfc4330140bd8d-grid.webp')
  })

  it('leaves every other address alone', () => {
    expect(servedItemPicture('https://assets.tarkov.dev/5b3b713c5acfc4330140bd8d-icon.webp', false)).toBe('https://assets.tarkov.dev/5b3b713c5acfc4330140bd8d-icon.webp')
    expect(servedItemPicture('https://raidos.app/v1/item-images/5b3b713c5acfc4330140bd8d-icon.webp', true)).toBe('https://raidos.app/v1/item-images/5b3b713c5acfc4330140bd8d-icon.webp')
    expect(servedItemPicture('https://assets.tarkov.dev/maps/svg/Customs.svg', true)).toBe('https://assets.tarkov.dev/maps/svg/Customs.svg')
    expect(servedItemPicture(undefined, true)).toBeUndefined()
  })
})
