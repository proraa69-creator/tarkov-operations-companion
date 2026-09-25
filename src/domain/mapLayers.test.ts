import { describe, expect, it } from 'vitest'
import { defaultHiddenMarkerLayers, defaultVisibleMarkerLayers } from './mapLayers'

describe('map layer defaults', () => {
  it('shows extracts, transits and quest work by default', () => {
    expect(defaultVisibleMarkerLayers).toEqual([
      'extract.pmc',
      'extract.scav',
      'extract.coop',
      'transit',
      'quest.zone',
      'quest.item',
    ])
  })

  it('keeps ordinary loot hidden on first launch', () => {
    expect(defaultHiddenMarkerLayers).toEqual(expect.arrayContaining([
      'loot.valuable',
      'loot.weapon',
      'loot.medical',
      'loot.provision',
      'loot.technical',
      'loot.container',
    ]))
  })
})
