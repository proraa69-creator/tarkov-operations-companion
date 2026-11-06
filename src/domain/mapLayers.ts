import type { MarkerLayerId } from './types'

export const defaultVisibleMarkerLayers: MarkerLayerId[] = [
  'extract.pmc',
  'extract.scav',
  'extract.coop',
  'transit',
  'switch',
  'btr',
  'quest.zone',
  'quest.item',
  'loot.key',
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

/** The Scavs' mark of an exit both sides share: the PMC's marker id with this after it. */
export const SCAV_TWIN_SUFFIX = '--scav'
