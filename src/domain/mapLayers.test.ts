import { describe, expect, it } from 'vitest'
import { defaultHiddenMarkerLayers, defaultVisibleMarkerLayers, hiddenLayersFromStorage } from './mapLayers'

describe('map layer defaults', () => {
  it('shows extracts, transits, power switches, BTR stops, quest work and «Спавн 100 %» by default', () => {
    expect(defaultVisibleMarkerLayers).toEqual([
      'extract.pmc',
      'extract.scav',
      'extract.coop',
      'transit',
      'switch',
      'btr',
      'quest.zone',
      'quest.item',
      'loot.key',
      'loot.guaranteed',
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

describe('the spawns\' two buttons (owner, 07.11.2026)', () => {
  it('start hidden for a new player', () => {
    expect(defaultHiddenMarkerLayers).toEqual(expect.arrayContaining(['spawn.pmc', 'spawn.scav']))
    expect(defaultHiddenMarkerLayers).not.toContain('spawn')
  })

  it('start hidden for a player whose list was saved before them', () => {
    expect(hiddenLayersFromStorage(['boss', 'spawn', 'hazard'])).toEqual(['boss', 'hazard', 'spawn.pmc', 'spawn.scav'])
  })

  it('a player who has pressed one keeps the choice', () => {
    expect(hiddenLayersFromStorage(['boss', 'spawn.scav'])).toEqual(['boss', 'spawn.scav'])
    expect(hiddenLayersFromStorage(['boss'])).toEqual(['boss'])
  })
})
