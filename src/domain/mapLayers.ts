import type { MarkerLayerId } from './types'

export const defaultVisibleMarkerLayers: MarkerLayerId[] = [
  'extract.pmc',
  'extract.scav',
  'extract.coop',
  'transit',
  'quest.zone',
  'quest.item',
]

export const defaultHiddenMarkerLayers: MarkerLayerId[] = [
  'key',
  'boss',
  'spawn',
  'hazard',
  'loot.valuable',
  'loot.weapon',
  'loot.medical',
  'loot.provision',
  'loot.technical',
  'loot.container',
  'loot.documents',
  'landmark',
]

export const allMarkerLayers: MarkerLayerId[] = [...defaultVisibleMarkerLayers, ...defaultHiddenMarkerLayers]
