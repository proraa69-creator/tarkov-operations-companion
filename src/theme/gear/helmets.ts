import tagillaUrl from '../../assets/gear/helmet-tagilla.glb?url'
import killaUrl from '../../assets/gear/helmet-killa.glb?url'
import knightUrl from '../../assets/gear/helmet-knight.glb?url'

/** One helmet the player can pick for the Gear theme badge. `glass`: the model's roughness/metal texture carries a visor mask in its red channel. */
export interface HelmetVariant {
  id: string; label: string; url: string
  glass?: boolean
  /** Polished metal: render with reflections and the low sun (like glass variants) so it doesn't turn black. */
  shine?: boolean
  /** The mesh has a _SWAY attribute (scripts/gear/rig-knight.mjs): hair and strings swing as the mask turns. */
  sway?: boolean
  /**
   * Turn of this export, in degrees, so every mask faces the way the first one does at the same pose settings: the
   * GLBs come from different tools and face different ways (owner, 09.10: «все маски в одном положении»).
   */
  facing?: { yaw?: number; pitch?: number; roll?: number }
}

/**
 * Add new helmets here (GLB in src/assets/gear/); the first one is the default. «Маска Тагиллы 2» and «Сталь, царапины»
 * were removed (owner, 09.10): a saved choice of them falls back to the first mask.
 */
export const HELMETS: HelmetVariant[] = [
  // the owner's Tagilla welding mask, updated version (Tripo export, packed by scripts/gear/pack-helmet.mjs);
  // the id stays 'original' so a saved choice keeps pointing at it
  { id: 'original', label: 'Маска Тагиллы', url: tagillaUrl },
  // the owner's Killa helmet (packed by scripts/gear/pack-helmet.mjs)
  { id: 'killa', label: 'Шлем Киллы', url: killaUrl, shine: true },
  // the owner's skull mask with dreadlocks (Tripo export, packed by scripts/gear/pack-helmet.mjs, swing weights by rig-knight.mjs)
  { id: 'knight', label: 'Рыцарь', url: knightUrl, sway: true, facing: { yaw: -20 } },
]
