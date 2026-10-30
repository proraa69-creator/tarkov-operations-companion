import tagillaUrl from '../../assets/gear/helmet-tagilla.glb?url'
import killaUrl from '../../assets/gear/helmet-killa.glb?url'
import knightUrl from '../../assets/gear/helmet-knight.glb?url'
import pumpkinUrl from '../../assets/gear/helmet-pumpkin.glb?url'

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
  // the owner's pumpkin (Tripo export, packed by scripts/gear/pack-helmet.mjs, 157k → 36k vertices by simplify-helmet.mjs)
  { id: 'pumpkin', label: 'Тыква', url: pumpkinUrl },
]

/**
 * Halloween (owner, 31.10.2026: «при запуске по умолчанию включается эта маска пока идет хэллоуин»): from `from` to `until`
 * (Moscow days, inclusive) every start shows this mask whatever was picked before; another one picked now lasts until the
 * app closes. Outside these days the player's own choice as always.
 */
export const HALLOWEEN = { helmet: 'pumpkin', from: '2026-10-24', until: '2026-11-11' }

export function seasonalHelmet(now = Date.now()) {
  const day = new Date(now + 3 * 3600_000).toISOString().slice(0, 10)
  return day >= HALLOWEEN.from && day <= HALLOWEEN.until ? HELMETS.find((helmet) => helmet.id === HALLOWEEN.helmet) : undefined
}
