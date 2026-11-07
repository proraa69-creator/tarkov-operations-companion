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
  'spawn.pmc',
  'spawn.scav',
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

/**
 * A list saved before the spawns had their two buttons holds the old «spawn», which nothing offered: both start hidden there
 * too, as a marker on hundreds of places nobody asked for would be. Once the player has pressed one, the old name is gone.
 */
export function hiddenLayersFromStorage(saved: readonly string[]): MarkerLayerId[] {
  if (!saved.includes('spawn')) return saved as MarkerLayerId[]
  return [...saved.filter((layerId) => layerId !== 'spawn' && layerId !== 'spawn.pmc' && layerId !== 'spawn.scav'), 'spawn.pmc', 'spawn.scav'] as MarkerLayerId[]
}

/** The Scavs' mark of an exit both sides share: the PMC's marker id with this after it. */
export const SCAV_TWIN_SUFFIX = '--scav'
