import { describe, expect, it } from 'vitest'
import { defaultHiddenMarkerLayers, defaultVisibleMarkerLayers } from './mapLayers'

describe('map layer defaults', () => {
  it('shows extracts, transits, power switches and quest work by default', () => {
    expect(defaultVisibleMarkerLayers).toEqual([
      'extract.pmc',
      'extract.scav',
      'extract.coop',
      'transit',
      'switch',
      'quest.zone',
      'quest.item',
      'loot.key',
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
